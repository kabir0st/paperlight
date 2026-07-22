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
    });
});

chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === MENU_ID && info.selectionText) {
        speak(info.selectionText);
    }
});

// ---------------------------------------------------------------- speaking

async function speak(text) {
    const { voice } = await chrome.storage.sync.get({ voice: DEFAULTS.voice });
    await stopAll();
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
        chrome.runtime.sendMessage({ target: 'tts-offscreen', cmd: 'speak', text, voice });
    }
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
// render current state when it opens (the SW may restart at any time).
function setStatus(state) {
    chrome.storage.session
        .set({ ttsStatus: { ...state, at: Date.now() } })
        .catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'tts-status') {
        chrome.storage.session.set({ ttsStatus: message.state }).catch(() => {});
        return;
    }
    if (message?.type === 'tts-ready') {
        chrome.storage.local.set({ [`ttsReady_${message.voice}`]: true }).catch(() => {});
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
