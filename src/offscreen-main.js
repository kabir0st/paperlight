// Gentle Page PDF — offscreen document.
// Hosts the local TTS engines (Kokoro / Chatterbox) and plays the audio.
// The "robot" voice (chrome.tts) never reaches this document — the
// service worker handles it directly.

import { env } from '@huggingface/transformers';
import { KokoroEngine, KOKORO_SAMPLE_RATE } from './kokoro-engine.js';
import { ChatterboxEngine, CHATTERBOX_SAMPLE_RATE } from './chatterbox-engine.js';
import { splitSentences } from './tts-common.js';

// All runtime assets ship inside the extension — nothing executable is
// fetched remotely (MV3 requirement). Model *weights* come from the HF Hub
// and are cached by transformers.js in the Cache API ('transformers-cache').
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/');
env.useBrowserCache = true;

const VOICES = {
    fluent: {
        sampleRate: KOKORO_SAMPLE_RATE,
        create: (opts) => KokoroEngine.create(opts)
    },
    natural: {
        sampleRate: CHATTERBOX_SAMPLE_RATE,
        create: (opts) => ChatterboxEngine.create(opts)
    }
};

const engines = {}; // voice -> Promise<engine>
let session = null; // current playback session

// ---------------------------------------------------------------- status

let lastBroadcast = 0;
function setStatus(state) {
    const message = { type: 'tts-status', state: { ...state, at: Date.now() } };
    // Throttle high-frequency download progress, always send phase changes.
    const now = Date.now();
    if (state.phase === 'downloading' && now - lastBroadcast < 250) return;
    lastBroadcast = now;
    chrome.runtime.sendMessage(message).catch(() => {});
}

// Aggregate transformers.js per-file progress events into one percentage.
function makeProgressTracker(voice) {
    const files = new Map();
    return (event) => {
        if (!event.file) return;
        if (event.status === 'progress' || event.status === 'initiate') {
            files.set(event.file, {
                loaded: event.loaded ?? 0,
                total: event.total ?? 0
            });
        } else if (event.status === 'done') {
            const entry = files.get(event.file);
            if (entry) entry.loaded = entry.total;
        }
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
            loaded += f.loaded;
            total += f.total;
        }
        if (total > 0) {
            setStatus({
                phase: 'downloading',
                voice,
                file: event.file,
                loaded,
                total,
                pct: Math.min(100, Math.round((loaded / total) * 100))
            });
        }
    };
}

// ---------------------------------------------------------------- engines

function getEngine(voice) {
    if (!VOICES[voice]) throw new Error(`Unknown voice: ${voice}`);
    if (!engines[voice]) {
        engines[voice] = VOICES[voice]
            .create({ progress_callback: makeProgressTracker(voice) })
            .then((engine) => {
                // Offscreen documents can only use chrome.runtime — the
                // service worker persists the ready flag for the popup.
                chrome.runtime.sendMessage({ type: 'tts-ready', voice }).catch(() => {});
                return engine;
            })
            .catch((error) => {
                delete engines[voice]; // allow retry
                throw error;
            });
    }
    return engines[voice];
}

// ---------------------------------------------------------------- playback

class PlaybackSession {
    constructor(sampleRate) {
        this.aborted = false;
        this.ctx = new AudioContext({ sampleRate });
        this.tail = 0;
        this.sources = new Set();
    }

    play(waveform) {
        if (this.aborted) return;
        const buffer = this.ctx.createBuffer(1, waveform.length, this.ctx.sampleRate);
        buffer.copyToChannel(waveform, 0);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);
        const startAt = Math.max(this.tail, this.ctx.currentTime + 0.05);
        source.start(startAt);
        this.tail = startAt + buffer.duration;
        this.sources.add(source);
        source.onended = () => this.sources.delete(source);
    }

    async waitUntilDone() {
        while (!this.aborted && this.ctx.currentTime < this.tail) {
            await new Promise((r) => setTimeout(r, 200));
        }
    }

    stop() {
        this.aborted = true;
        for (const source of this.sources) {
            try {
                source.stop();
            } catch {}
        }
        this.sources.clear();
        this.ctx.close().catch(() => {});
    }
}

async function speak(text, voice) {
    stopPlayback();
    const mySession = (session = new PlaybackSession(VOICES[voice].sampleRate));
    try {
        setStatus({ phase: 'loading', voice });
        const engine = await getEngine(voice);
        const chunks = splitSentences(text);
        for (let i = 0; i < chunks.length; i++) {
            if (mySession.aborted) return;
            setStatus({
                phase: 'speaking',
                voice,
                chunk: i + 1,
                chunks: chunks.length
            });
            const waveform = await engine.synthesize(chunks[i]);
            mySession.play(waveform);
        }
        await mySession.waitUntilDone();
        if (!mySession.aborted) setStatus({ phase: 'idle' });
    } catch (error) {
        console.error('Gentle Page PDF TTS:', error);
        setStatus({ phase: 'error', voice, error: String(error?.message || error) });
    }
}

async function preload(voice) {
    try {
        setStatus({ phase: 'loading', voice });
        await getEngine(voice);
        setStatus({ phase: 'ready', voice });
    } catch (error) {
        console.error('Gentle Page PDF TTS:', error);
        setStatus({ phase: 'error', voice, error: String(error?.message || error) });
    }
}

function stopPlayback() {
    if (session) {
        session.stop();
        session = null;
    }
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== 'tts-offscreen') return;
    switch (message.cmd) {
        case 'speak':
            speak(message.text, message.voice);
            break;
        case 'preload':
            preload(message.voice);
            break;
        case 'stop':
            stopPlayback();
            setStatus({ phase: 'idle' });
            break;
    }
    sendResponse({ ok: true });
});
