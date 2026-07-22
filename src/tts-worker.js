// Gentle Page PDF — TTS inference worker.
// All transformers.js work (model download, session init, synthesis) runs
// here, in a dedicated thread. Extension pages of the same extension share
// one renderer main thread — running inference there froze the popup.
//
// Protocol (single in-flight synthesize; the offscreen doc orchestrates):
//   in : {cmd:'ensure', voice, speaker?}                 -> engine-ready | engine-error
//   in : {cmd:'synthesize', id, voice, text, options?}   -> audio | synth-error
//   out: {type:'download', voice, file, loaded, total, pct}  (progress)

import { env } from '@huggingface/transformers';
import { KokoroEngine, KOKORO_SAMPLE_RATE } from './kokoro-engine.js';

// Worker location is chrome-extension://<id>/tts-worker.js — resolve the
// bundled ONNX runtime assets relative to it (no chrome.* APIs in workers).
env.backends.onnx.wasm.wasmPaths = new URL('vendor/', self.location.href).href;
env.useBrowserCache = true;

const SAMPLE_RATES = { fluent: KOKORO_SAMPLE_RATE };
const engines = {}; // voice -> Promise<engine>

function makeProgressTracker(voice) {
    const files = new Map();
    let lastPost = 0;
    return (event) => {
        if (!event.file) return;
        if (event.status === 'progress' || event.status === 'initiate') {
            files.set(event.file, { loaded: event.loaded ?? 0, total: event.total ?? 0 });
        } else if (event.status === 'done') {
            const entry = files.get(event.file);
            if (entry) entry.loaded = entry.total;
        }
        const now = Date.now();
        if (event.status === 'progress' && now - lastPost < 250) return;
        lastPost = now;
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        if (total > 0) {
            self.postMessage({
                type: 'download', voice, file: event.file, loaded, total,
                pct: Math.min(100, Math.round((loaded / total) * 100))
            });
        }
    };
}

function getEngine(voice, { speaker } = {}) {
    if (!engines[voice]) {
        const progress_callback = makeProgressTracker(voice);
        engines[voice] = KokoroEngine.create({ speaker, progress_callback });
        engines[voice].catch(() => { delete engines[voice]; });
    }
    return engines[voice];
}

self.onmessage = async ({ data }) => {
    if (data.cmd === 'ensure') {
        try {
            await getEngine(data.voice, data);
            self.postMessage({ type: 'engine-ready', voice: data.voice });
        } catch (error) {
            self.postMessage({
                type: 'engine-error', voice: data.voice,
                error: String(error?.message || error)
            });
        }
    } else if (data.cmd === 'synthesize') {
        try {
            const engine = await getEngine(data.voice, data.options || {});
            const samples = await engine.synthesize(data.text, data.options || {});
            // Transfer the buffer — no copy across the thread boundary.
            self.postMessage(
                {
                    type: 'audio', id: data.id,
                    sampleRate: SAMPLE_RATES[data.voice], samples: samples.buffer
                },
                [samples.buffer]
            );
        } catch (error) {
            self.postMessage({
                type: 'synth-error', id: data.id,
                error: String(error?.message || error)
            });
        }
    }
};
