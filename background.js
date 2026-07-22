// Gentle Page PDF — service worker.
// Owns default settings, the "Read aloud" context menu, the robot voice
// (chrome.tts), and the offscreen document that runs the AI voices.

const DEFAULTS = {
    enabled: false,
    theme: 'paper', // 'paper' | 'sepia' | 'dark'
    intensity: 80, // 0–100
    voice: 'robot' // 'robot' | 'fluent' | 'natural'
};

const MENU_ID = 'gentle-read-aloud';
const MENU_PDF_ID = 'gentle-read-pdf';
const TEST_SENTENCE =
    'This is your Gentle Page PDF reading voice. Select text in a PDF, ' +
    'right click, and choose Read aloud.';

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get(null, (existing) => {
        const missing = {};
        for (const [key, value] of Object.entries(DEFAULTS)) {
            if (existing[key] === undefined) missing[key] = value;
        }
        // Respect the v1.x enable flag if it is all we have.
        if (missing.enabled !== undefined && existing.isEnabled !== undefined) {
            missing.enabled = existing.isEnabled === true;
        }
        if (Object.keys(missing).length > 0) {
            chrome.storage.sync.set(missing);
        }
    });

    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: MENU_ID,
            title: 'Read aloud',
            contexts: ['selection']
        });
        chrome.contextMenus.create({
            id: MENU_PDF_ID,
            title: 'Read this PDF aloud',
            contexts: ['page'],
            documentUrlPatterns: [
                '*://*/*.pdf', '*://*/*.pdf?*', '*://*/*.pdf#*',
                'file://*/*.pdf', 'file://*/*.pdf#*'
            ]
        });
    });
    chrome.action.setBadgeBackgroundColor({ color: '#2b2a26' });
});

chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === MENU_ID && info.selectionText) {
        speak(info.selectionText);
    } else if (info.menuItemId === MENU_PDF_ID && info.pageUrl) {
        readPdf(info.pageUrl, 1);
    }
});

// ---------------------------------------------------------------- speaking

async function speak(text) {
    const { voice } = await chrome.storage.sync.get({ voice: DEFAULTS.voice });
    await stopAll();
    setStatus({ phase: 'starting', voice });
    if (voice === 'robot') {
        setStatus({ phase: 'speaking', voice: 'robot' });
        chrome.tts.speak(text, {
            enqueue: false,
            onEvent: (event) => {
                if (['end', 'interrupted', 'cancelled', 'error'].includes(event.type)) {
                    setStatus({ phase: 'idle' });
                }
            }
        });
    } else {
        await ensureOffscreen();
        chrome.runtime
            .sendMessage({ target: 'tts-offscreen', cmd: 'speak', text, voice })
            .catch(() => {});
    }
}

// Whole-document reading. Text extraction always happens in the offscreen
// document (pdf.js); for the robot voice it streams pages back here and
// chrome.tts queues them.
async function readPdf(url, fromPage) {
    const { voice } = await chrome.storage.sync.get({ voice: DEFAULTS.voice });
    await stopAll();
    setStatus({ phase: 'starting', voice });
    await ensureOffscreen();
    chrome.runtime
        .sendMessage({ target: 'tts-offscreen', cmd: 'read-pdf', url, fromPage, voice })
        .catch(() => {});
}

async function stopAll() {
    chrome.tts.stop();
    if (await hasOffscreen()) {
        chrome.runtime.sendMessage({ target: 'tts-offscreen', cmd: 'stop' }).catch(() => {});
    }
}

// ------------------------------------------------------------- offscreen

let creatingOffscreen = null;

async function hasOffscreen() {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    return contexts.length > 0;
}

async function ensureOffscreen() {
    if (await hasOffscreen()) return;
    creatingOffscreen ??= chrome.offscreen
        .createDocument({
            url: 'offscreen.html',
            reasons: ['AUDIO_PLAYBACK', 'BLOBS'],
            justification:
                'Runs local text-to-speech models and plays the synthesized audio.'
        })
        .finally(() => {
            creatingOffscreen = null;
        });
    await creatingOffscreen;
}

// ---------------------------------------------------------------- status

// Mirror the latest TTS status into session storage so the popup can
// render current state when it opens (the SW may restart at any time),
// and reflect activity on the toolbar badge so there is feedback even
// with the popup closed.
function badgeFor(state) {
    switch (state?.phase) {
        case 'downloading': return (state.pct ?? 0) + '%';
        case 'starting':
        case 'loading':
        case 'generating': return '…';
        case 'speaking': return '▶';
        case 'error': return '!';
        default: return '';
    }
}

function setStatus(state) {
    const stamped = { ...state, at: state.at || Date.now() };
    chrome.storage.session.set({ ttsStatus: stamped }).catch(() => {});
    chrome.action.setBadgeText({ text: badgeFor(stamped) }).catch(() => {});
}

// Robot whole-PDF reading: the offscreen document extracts pages and
// streams them here; chrome.tts queues one utterance per page.
function robotSay(text, page, pages) {
    chrome.tts.speak(text, {
        enqueue: true,
        onEvent: (event) => {
            if (event.type === 'start') {
                setStatus({ phase: 'speaking', voice: 'robot', detail: `page ${page} of ${pages}` });
            } else if (['end', 'cancelled', 'error'].includes(event.type)) {
                chrome.tts.isSpeaking((speaking) => {
                    if (!speaking) setStatus({ phase: 'idle' });
                });
            }
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'tts-status') {
        setStatus(message.state);
        return;
    }
    if (message?.type === 'tts-ready') {
        chrome.storage.local.set({ [`ttsReady_${message.voice}`]: true }).catch(() => {});
        return;
    }
    if (message?.type === 'robot-say') {
        robotSay(message.text, message.page, message.pages);
        return;
    }
    if (message?.target !== 'tts-bg') return;
    switch (message.cmd) {
        case 'speak-test':
            speak(TEST_SENTENCE);
            break;
        case 'speak':
            if (message.text) speak(message.text);
            break;
        case 'read-pdf':
            if (message.url) readPdf(message.url, message.fromPage || 1);
            break;
        case 'stop':
            stopAll().then(() => setStatus({ phase: 'idle' }));
            break;
        case 'preload':
            ensureOffscreen().then(() => {
                chrome.runtime.sendMessage({
                    target: 'tts-offscreen',
                    cmd: 'preload',
                    voice: message.voice
                });
            });
            break;
    }
    sendResponse({ ok: true });
});
