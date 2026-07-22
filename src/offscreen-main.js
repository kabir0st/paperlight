// Gentle Page PDF — offscreen document (coordinator).
// Inference runs in a dedicated Web Worker (tts-worker.js) so this thread —
// which is shared with the popup — stays responsive. This document only:
//   - orchestrates the worker (one synthesize request in flight),
//   - plays audio through the Web Audio API,
//   - extracts PDF text with pdf.js for whole-document reading,
//   - broadcasts status for the popup and the toolbar badge.

import * as pdfjs from 'pdfjs-dist';
import {
    cachedArrayBuffer,
    decodeAudio,
    splitSentences,
    REFERENCE_VOICE_URL,
    REFERENCE_SAMPLE_RATE
} from './tts-common.js';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');

const MAX_BUFFERED_SECONDS = 30; // synth backpressure for long documents

// ---------------------------------------------------------------- status

function setStatus(state) {
    chrome.runtime
        .sendMessage({ type: 'tts-status', state: { ...state, at: Date.now() } })
        .catch(() => {});
}

// ---------------------------------------------------------------- worker

let worker = null;
let requestId = 0;
const pending = new Map(); // id -> {resolve, reject}
const readyVoices = new Set();

function getWorker() {
    if (!worker) {
        worker = new Worker(chrome.runtime.getURL('tts-worker.js'), { type: 'module' });
        worker.onmessage = ({ data }) => {
            switch (data.type) {
                case 'download':
                    setStatus({
                        phase: 'downloading',
                        voice: data.voice,
                        file: data.file,
                        loaded: data.loaded,
                        total: data.total,
                        pct: data.pct
                    });
                    break;
                case 'audio': {
                    const p = pending.get(data.id);
                    if (p) {
                        pending.delete(data.id);
                        p.resolve({
                            samples: new Float32Array(data.samples),
                            sampleRate: data.sampleRate
                        });
                    }
                    break;
                }
                case 'synth-error': {
                    const p = pending.get(data.id);
                    if (p) {
                        pending.delete(data.id);
                        p.reject(new Error(data.error));
                    }
                    break;
                }
            }
        };
        worker.onerror = (event) => {
            const error = new Error(event.message || 'TTS worker crashed');
            for (const p of pending.values()) p.reject(error);
            pending.clear();
        };
    }
    return worker;
}

async function ensureVoice(voice) {
    if (readyVoices.has(voice)) return;
    const w = getWorker();
    let referenceAudio;
    if (voice === 'natural') {
        const buffer = await cachedArrayBuffer(REFERENCE_VOICE_URL);
        referenceAudio = await decodeAudio(buffer, REFERENCE_SAMPLE_RATE);
    }
    await new Promise((resolve, reject) => {
        const onMessage = ({ data }) => {
            if (data.type === 'engine-ready' && data.voice === voice) {
                w.removeEventListener('message', onMessage);
                resolve();
            } else if (data.type === 'engine-error' && data.voice === voice) {
                w.removeEventListener('message', onMessage);
                reject(new Error(data.error));
            }
        };
        w.addEventListener('message', onMessage);
        w.postMessage(
            { cmd: 'ensure', voice, referenceAudio },
            referenceAudio ? [referenceAudio.buffer] : []
        );
    });
    readyVoices.add(voice);
    chrome.runtime.sendMessage({ type: 'tts-ready', voice }).catch(() => {});
}

function synthesize(voice, text) {
    return new Promise((resolve, reject) => {
        const id = ++requestId;
        pending.set(id, { resolve, reject });
        getWorker().postMessage({ cmd: 'synthesize', id, voice, text });
    });
}

// ---------------------------------------------------------------- playback

let session = null;

class PlaybackSession {
    constructor() {
        this.aborted = false;
        this.ctx = null;
        this.tail = 0;
        this.sources = new Set();
        this.started = false;
    }

    play(samples, sampleRate) {
        if (this.aborted) return;
        if (!this.ctx) {
            this.ctx = new AudioContext({ sampleRate });
            this.tail = 0;
        }
        const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples, 0);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);
        const startAt = Math.max(this.tail, this.ctx.currentTime + 0.05);
        source.start(startAt);
        this.tail = startAt + buffer.duration;
        this.sources.add(source);
        source.onended = () => this.sources.delete(source);
        this.started = true;
    }

    bufferedSeconds() {
        return this.ctx ? Math.max(0, this.tail - this.ctx.currentTime) : 0;
    }

    async waitForRoom() {
        while (!this.aborted && this.bufferedSeconds() > MAX_BUFFERED_SECONDS) {
            await new Promise((r) => setTimeout(r, 500));
        }
    }

    async waitUntilDone() {
        while (!this.aborted && this.ctx && this.ctx.currentTime < this.tail) {
            await new Promise((r) => setTimeout(r, 200));
        }
    }

    stop() {
        this.aborted = true;
        for (const source of this.sources) {
            try { source.stop(); } catch {}
        }
        this.sources.clear();
        if (this.ctx) this.ctx.close().catch(() => {});
    }
}

// Synthesize a list of chunks into the session, with backpressure.
// describe(i) renders the status detail for chunk i.
async function speakChunks(mySession, voice, chunks, describe) {
    for (let i = 0; i < chunks.length; i++) {
        if (mySession.aborted) return;
        setStatus({
            phase: mySession.started ? 'speaking' : 'generating',
            voice,
            detail: describe(i)
        });
        await mySession.waitForRoom();
        if (mySession.aborted) return;
        const { samples, sampleRate } = await synthesize(voice, chunks[i]);
        mySession.play(samples, sampleRate);
        if (mySession.started) {
            setStatus({ phase: 'speaking', voice, detail: describe(i) });
        }
    }
}

// ---------------------------------------------------------------- actions

async function speak(text, voice) {
    stopPlayback();
    const mySession = (session = new PlaybackSession());
    try {
        setStatus({ phase: 'loading', voice });
        await ensureVoice(voice);
        const chunks = splitSentences(text);
        await speakChunks(mySession, voice, chunks, (i) =>
            chunks.length > 1 ? `sentence ${i + 1} of ${chunks.length}` : ''
        );
        await mySession.waitUntilDone();
        if (!mySession.aborted) setStatus({ phase: 'idle' });
    } catch (error) {
        reportError(voice, error, mySession);
    }
}

async function extractPageText(pdf, pageNumber) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
        text += item.str + (item.hasEOL ? ' ' : ' ');
    }
    return text.replace(/\s+/g, ' ').trim();
}

async function readPdf(url, fromPage, voice) {
    stopPlayback();
    const mySession = (session = new PlaybackSession());
    try {
        setStatus({ phase: 'loading', voice, detail: 'opening PDF' });
        const robot = voice === 'robot';
        if (!robot) await ensureVoice(voice);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not fetch the PDF (${response.status}).`);
        const data = await response.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
        const total = pdf.numPages;
        const start = Math.min(Math.max(1, Number(fromPage) || 1), total);

        for (let p = start; p <= total; p++) {
            if (mySession.aborted) return;
            const text = await extractPageText(pdf, p);
            if (!text) continue;
            if (robot) {
                setStatus({ phase: 'speaking', voice, detail: `page ${p} of ${total}` });
                chrome.runtime
                    .sendMessage({ type: 'robot-say', text, page: p, pages: total })
                    .catch(() => {});
            } else {
                const chunks = splitSentences(text);
                await speakChunks(mySession, voice, chunks, (i) =>
                    `page ${p} of ${total} · sentence ${i + 1}/${chunks.length}`
                );
            }
        }
        if (!robot) {
            await mySession.waitUntilDone();
            if (!mySession.aborted) setStatus({ phase: 'idle' });
        }
        // Robot mode: the service worker reports idle when chrome.tts drains.
    } catch (error) {
        reportError(voice, error, mySession);
    }
}

function reportError(voice, error, mySession) {
    if (mySession.aborted) return;
    console.error('Gentle Page PDF TTS:', error);
    setStatus({ phase: 'error', voice, error: String(error?.message || error) });
}

function stopPlayback() {
    if (session) {
        session.stop();
        session = null;
    }
    // Drop results of any in-flight synthesis.
    for (const p of pending.values()) p.reject(new Error('cancelled'));
    pending.clear();
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== 'tts-offscreen') return;
    switch (message.cmd) {
        case 'speak':
            speak(message.text, message.voice);
            break;
        case 'read-pdf':
            readPdf(message.url, message.fromPage, message.voice);
            break;
        case 'preload':
            (async () => {
                try {
                    setStatus({ phase: 'loading', voice: message.voice });
                    await ensureVoice(message.voice);
                    setStatus({ phase: 'ready', voice: message.voice });
                } catch (error) {
                    setStatus({
                        phase: 'error',
                        voice: message.voice,
                        error: String(error?.message || error)
                    });
                }
            })();
            break;
        case 'stop':
            stopPlayback();
            setStatus({ phase: 'idle' });
            break;
    }
    sendResponse({ ok: true });
});
