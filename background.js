// Paperlight service worker.
// Owns default settings, the "Read aloud" context menu, the robot voice
// (chrome.tts), the offscreen document that runs the AI voices, and the
// status fan-out to the popup, the toolbar badge and the in-page HUD.

const DEFAULTS = {
    enabled: false,
    theme: 'paper', // 'paper' | 'sepia' | 'dark'
    intensity: 80, // 0–100
    voice: 'robot', // 'robot' | 'fluent'
    kokoroSpeaker: 'af_nicole', // any id from src/kokoro-voices.js
    kokoroSpeed: 1, // 0.5–2.0
    volume: 100 // 0–100
};

const MENU_ID = 'gentle-read-aloud';
const MENU_FROM_ID = 'gentle-read-from-here';
const MENU_PDF_ID = 'gentle-read-pdf';
const TEST_SENTENCE =
    'This is your Paperlight reading voice. Select text in a PDF, ' +
    'right click, and choose Read aloud.';

// Weights no longer reachable by any code path, reclaimed on update:
//   - Chatterbox, the "Natural" voice dropped in 2.4.0, gigabytes of weights,
//     WebGPU-only, and it could stall the browser.
//   - Kokoro's fp32 (model.onnx) and fp16 (model_fp16.onnx) exports, which fed
//     the WebGPU engine dropped in 2.7.0. The CPU build the extension actually
//     uses is model_quantized.onnx, so it is deliberately not matched here.
// Anyone who had a removed voice selected moves to Fluent, and every readiness
// flag is dropped so each engine re-verifies against what is actually cached.
const DEAD_WEIGHTS = [/chatterbox-ONNX/, /Kokoro-82M[\s\S]*\/model(_fp16)?\.onnx$/];

async function reclaimRemovedVoices() {
    chrome.storage.sync.get({ voice: DEFAULTS.voice }, ({ voice }) => {
        if (voice === 'natural') chrome.storage.sync.set({ voice: 'fluent' });
    });
    chrome.storage.local.get(null, (all) => {
        const stale = Object.keys(all).filter((key) => key.startsWith('ttsReady_'));
        if (stale.length) chrome.storage.local.remove(stale);
    });
    try {
        for (const name of ['transformers-cache', 'gentle-tts-assets']) {
            const cache = await caches.open(name);
            for (const request of await cache.keys()) {
                if (DEAD_WEIGHTS.some((re) => re.test(request.url))) {
                    await cache.delete(request);
                }
            }
        }
    } catch {
        // No cache yet, or storage is unavailable, nothing to reclaim.
    }
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'update') reclaimRemovedVoices();

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
        // Deliberately not restricted to *.pdf URLs: plenty of PDFs are served
        // from extensionless paths (arxiv.org/pdf/1706.03762), and the
        // offscreen document reports a clear message if the page is not one.
        chrome.contextMenus.create({
            id: MENU_FROM_ID,
            title: 'Start from here',
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID && info.selectionText) {
        speak(info.selectionText, tab?.id);
    } else if (info.menuItemId === MENU_FROM_ID && info.selectionText && info.pageUrl) {
        readPdf(info.pageUrl, { fromText: info.selectionText }, tab?.id);
    } else if (info.menuItemId === MENU_PDF_ID && info.pageUrl) {
        readPdf(info.pageUrl, {}, tab?.id);
    }
});

// ---------------------------------------------------------------- speaking

// chrome.tts has no volume setter for a queued utterance, so the robot
// voice picks the volume up per utterance from here.
let robotVolume = 1;

// An offscreen document may only use chrome.runtime, not chrome.storage -
// so the voice settings are read here and pushed to it with every command,
// and again whenever they change so a reading in progress follows along.
const VOICE_KEYS = ['kokoroSpeaker', 'kokoroSpeed', 'volume'];

async function voiceSettings() {
    const defaults = { voice: DEFAULTS.voice };
    for (const key of VOICE_KEYS) defaults[key] = DEFAULTS[key];
    return chrome.storage.sync.get(defaults);
}

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace !== 'sync') return;
    if (changes.volume) robotVolume = (Number(changes.volume.newValue) || 0) / 100;
    if (!VOICE_KEYS.some((key) => changes[key])) return;
    if (!(await hasOffscreen())) return;
    const settings = await voiceSettings();
    chrome.runtime
        .sendMessage({ target: 'tts-offscreen', cmd: 'settings', settings })
        .catch(() => {});
});

async function speak(text, tabId) {
    const settings = await voiceSettings();
    const { voice, volume } = settings;
    robotVolume = volume / 100;
    await stopAll();
    await setTtsTab(tabId);
    setStatus({ phase: 'starting', voice }, { paused: false });
    if (voice === 'robot') {
        setStatus({ phase: 'speaking', voice: 'robot' });
        chrome.tts.speak(text, {
            enqueue: false,
            volume: robotVolume,
            onEvent: (event) => {
                if (['end', 'interrupted', 'cancelled', 'error'].includes(event.type)) {
                    setStatus({ phase: 'idle' });
                }
            }
        });
    } else {
        await ensureOffscreen();
        chrome.runtime
            .sendMessage({ target: 'tts-offscreen', cmd: 'speak', text, voice, settings })
            .catch(() => {});
    }
}

// Whole-document reading, from a page or from a selection ("Start from
// here") through to the end. Text extraction always happens in the offscreen
// document (pdf.js); for the robot voice it streams pages back here and
// chrome.tts queues them.
async function readPdf(url, { fromPage = 1, fromText = '' } = {}, tabId) {
    const settings = await voiceSettings();
    const { voice, volume } = settings;
    robotVolume = volume / 100;
    await stopAll();
    await setTtsTab(tabId);
    setStatus({ phase: 'starting', voice }, { paused: false });
    await ensureOffscreen();
    chrome.runtime
        .sendMessage({
            target: 'tts-offscreen',
            cmd: 'read-pdf',
            url,
            fromPage,
            fromText,
            voice,
            settings
        })
        .catch(() => {});
}

async function stopAll() {
    chrome.tts.stop();
    if (await hasOffscreen()) {
        chrome.runtime.sendMessage({ target: 'tts-offscreen', cmd: 'stop' }).catch(() => {});
    }
}

// Pause/resume the current utterance. chrome.tts has its own pair; the AI
// voices suspend the offscreen AudioContext, which also stalls synthesis.
async function setPaused(paused) {
    const state = await currentStatus();
    if (!state || state.phase === 'idle' || state.phase === 'error') return;
    if (state.voice === 'robot') {
        if (paused) chrome.tts.pause();
        else chrome.tts.resume();
    } else if (await hasOffscreen()) {
        chrome.runtime
            .sendMessage({ target: 'tts-offscreen', cmd: paused ? 'pause' : 'resume' })
            .catch(() => {});
    }
    setStatus(state, { paused });
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

// The service worker can be torn down between two status updates, so the
// live state lives in session storage and is lazily restored here.
let lastStatus = null;
let ttsTabId = null;
let restoring = null;

function restoreState() {
    restoring ??= chrome.storage.session
        .get(['ttsStatus', 'ttsTabId'])
        .then((stored) => {
            lastStatus ??= stored.ttsStatus ?? null;
            ttsTabId ??= stored.ttsTabId ?? null;
        })
        .catch(() => {});
    return restoring;
}

async function currentStatus() {
    await restoreState();
    return lastStatus;
}

// The tab that asked for the reading, where the HUD belongs.
async function setTtsTab(tabId) {
    await restoreState();
    ttsTabId = tabId ?? null;
    await chrome.storage.session.set({ ttsTabId }).catch(() => {});
}

// Mirror the latest TTS status into session storage so the popup can
// render current state when it opens, reflect activity on the toolbar
// badge, and push it to the in-page HUD so there is feedback even with
// the popup closed.
function badgeFor(state) {
    if (state?.paused) return '⏸';
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

// paused is sticky: engine updates that arrive while paused keep the flag,
// so resuming restores whatever phase was actually running.
async function setStatus(state, { paused } = {}) {
    await restoreState();
    const terminal = ['idle', 'ready', 'error'].includes(state.phase);
    const stamped = {
        ...state,
        paused: paused !== undefined ? paused : lastStatus?.paused === true && !terminal,
        at: Date.now()
    };
    lastStatus = stamped;
    chrome.storage.session.set({ ttsStatus: stamped }).catch(() => {});
    chrome.action.setBadgeText({ text: badgeFor(stamped) }).catch(() => {});
    // The popup listens for this rather than the raw engine status, so it
    // also sees the states that originate here (the robot voice, pausing).
    // sendMessage never delivers back to its sender, so this cannot loop.
    chrome.runtime.sendMessage({ type: 'tts-state', state: stamped }).catch(() => {});
    if (ttsTabId != null) {
        chrome.tabs.sendMessage(ttsTabId, { type: 'gentle-hud', state: stamped }).catch(() => {});
    }
}

// Robot whole-PDF reading: the offscreen document extracts pages and
// streams them here; chrome.tts queues one utterance per page.
function robotSay(text, page, pages) {
    chrome.tts.speak(text, {
        enqueue: true,
        volume: robotVolume,
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
        chrome.storage.local.set({ [`ttsReady_${message.key || message.voice}`]: true }).catch(() => {});
        return;
    }
    if (message?.type === 'robot-say') {
        robotSay(message.text, message.page, message.pages);
        return;
    }
    if (message?.target !== 'tts-bg') return;
    switch (message.cmd) {
        // The HUD asks for the current state on load, so a page reload
        // mid-reading brings it back.
        case 'hud-sync':
            (async () => {
                const state = await currentStatus();
                const mine = sender.tab && sender.tab.id === ttsTabId;
                // A live reading stamps a status every sentence, so anything
                // older than a minute is a leftover, not something in flight.
                const live =
                    state && (state.paused === true || Date.now() - (state.at || 0) < 60_000);
                sendResponse({ state: mine && live ? state : null });
            })();
            return true;
        case 'speak-test':
            speak(TEST_SENTENCE, message.tabId);
            break;
        case 'speak':
            if (message.text) speak(message.text, message.tabId);
            break;
        case 'read-pdf':
            if (message.url) {
                readPdf(
                    message.url,
                    { fromPage: message.fromPage || 1, fromText: message.fromText },
                    message.tabId
                );
            }
            break;
        case 'pause':
            setPaused(true);
            break;
        case 'resume':
            setPaused(false);
            break;
        case 'stop':
            stopAll().then(() => setStatus({ phase: 'idle' }, { paused: false }));
            break;
        case 'preload':
            (async () => {
                const settings = await voiceSettings();
                await ensureOffscreen();
                chrome.runtime
                    .sendMessage({
                        target: 'tts-offscreen',
                        cmd: 'preload',
                        voice: message.voice,
                        settings
                    })
                    .catch(() => {});
            })();
            break;
    }
    sendResponse({ ok: true });
});
