// Paperlight offscreen document (coordinator).
// Inference runs in a small pool of Web Workers (tts-pool.js spawning
// tts-worker.js) so this thread - which is shared with the popup - stays
// responsive. This document only:
//   - cuts text into chunks sized by buffer health: tiny while the listener
//     is waiting on the first audio, long once playback is buffered ahead,
//   - dispatches chunks to the pool and commits results strictly in order,
//   - plays audio through the Web Audio API,
//   - extracts PDF text with pdf.js for whole-document reading,
//   - broadcasts status for the popup, the in-page HUD and the badge.

import * as pdfjs from 'pdfjs-dist';
import { ChunkFeed } from './tts-common.js';
import { WorkerPool } from './tts-pool.js';
import { DEFAULT_KOKORO_VOICE } from './kokoro-voices.js';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');

// Backpressure targets. Generation keeps roughly HIGH_WATER seconds of audio
// scheduled ahead (counting chunks still being synthesized); dropping under
// LOW_WATER is the signal that one worker is not keeping up.
const HIGH_WATER_SECONDS = 30;
const LOW_WATER_SECONDS = 10;

// The very first chunk of a session is cut this small so the first audio
// arrives as fast as the model can produce anything at all.
const FIRST_CHUNK_CHARS = 70;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- settings

// Voice tuning lives in chrome.storage.sync, but an offscreen document may
// only use chrome.runtime, no chrome.storage, so the service worker owns
// the settings and pushes them here with every command, plus a 'settings'
// message whenever they change. That keeps speaker/speed/volume live for the
// reading already in progress.
let settings = {
    kokoroSpeaker: DEFAULT_KOKORO_VOICE,
    kokoroSpeed: 1,
    volume: 100
};

function applySettings(incoming) {
    if (!incoming) return settings;
    settings = { ...settings, ...incoming };
    if (incoming.volume !== undefined && session) {
        session.setVolume((Number(incoming.volume) || 0) / 100);
    }
    return settings;
}

// Everything the worker needs to build and drive an engine.
function engineOptions(voice) {
    if (voice !== 'fluent') return {};
    return { speaker: settings.kokoroSpeaker, speed: settings.kokoroSpeed };
}

// ---------------------------------------------------------------- status

function setStatus(state) {
    chrome.runtime
        .sendMessage({ type: 'tts-status', state: { ...state, at: Date.now() } })
        .catch(() => {});
}

// ---------------------------------------------------------------- workers

const pool = new WorkerPool({
    workerUrl: chrome.runtime.getURL('tts-worker.js'),
    onDownload: (data) =>
        setStatus({
            phase: 'downloading',
            voice: data.voice,
            file: data.file,
            loaded: data.loaded,
            total: data.total,
            pct: data.pct
        }),
    onEngineReady: (voice) =>
        chrome.runtime.sendMessage({ type: 'tts-ready', voice }).catch(() => {}),
    // A worker that dies while a reading depends on it fails that chunk and
    // the dispatch loop deals with it; one that dies with no one waiting
    // would be invisible, so report it directly.
    onIdleCrash: (error) =>
        setStatus({
            phase: 'error',
            error: `The speech engine stopped: ${error.message}`
        })
});

// ---------------------------------------------------------------- playback

let session = null;

class PlaybackSession {
    constructor(volume = 1) {
        this.aborted = false;
        this.ctx = null;
        this.gain = null;
        this.volume = volume;
        this.paused = false;
        this.tail = 0;
        this.sources = new Set();
        this.started = false;
    }

    play(samples, sampleRate) {
        if (this.aborted) return;
        if (!this.ctx) {
            this.ctx = new AudioContext({ sampleRate });
            this.gain = this.ctx.createGain();
            this.gain.gain.value = this.volume;
            this.gain.connect(this.ctx.destination);
            this.tail = 0;
            // A context can be handed back suspended. Everything downstream
            // waits on currentTime, which a suspended context never advances,
            // so an unresumed context would look exactly like a hang.
            if (this.paused) this.ctx.suspend().catch(() => {});
            else this.ctx.resume().catch(() => {});
        }
        const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples, 0);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gain);
        const startAt = Math.max(this.tail, this.ctx.currentTime + 0.05);
        source.start(startAt);
        this.tail = startAt + buffer.duration;
        this.sources.add(source);
        source.onended = () => this.sources.delete(source);
        this.started = true;
    }

    setVolume(volume) {
        this.volume = volume;
        if (this.gain) this.gain.gain.value = volume;
    }

    // Suspending the context freezes currentTime, so the scheduled tail,
    // the drain loop below and the dispatch loop's buffer arithmetic all
    // pause with it (the dispatch loop also checks `paused` directly, or a
    // frozen buffer reading would keep it synthesizing through a pause).
    pause() {
        this.paused = true;
        if (this.ctx) this.ctx.suspend().catch(() => {});
    }

    resume() {
        this.paused = false;
        if (this.ctx) this.ctx.resume().catch(() => {});
    }

    bufferedSeconds() {
        return this.ctx ? Math.max(0, this.tail - this.ctx.currentTime) : 0;
    }

    // Waits for the scheduled audio to drain. A context that never runs never
    // will, so nudge it and eventually give up loudly rather than spinning on
    // a clock that is standing still. The test is whether currentTime is
    // actually frozen, Chrome may briefly suspend a context between buffers,
    // and that must not be mistaken for a dead one.
    async waitUntilDone() {
        let frozenMs = 0;
        let lastTime = -1;
        while (!this.aborted && (this.paused || (this.ctx && this.ctx.currentTime < this.tail))) {
            await new Promise((r) => setTimeout(r, 200));
            if (this.paused || !this.ctx) continue;
            if (this.ctx.currentTime > lastTime) {
                lastTime = this.ctx.currentTime;
                frozenMs = 0;
                continue;
            }
            if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
            frozenMs += 200;
            if (frozenMs > 15000) {
                throw new Error(
                    `Audio playback stalled (the audio context is ${this.ctx.state}).`
                );
            }
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

// Chunk size as a function of how much audio stands between the listener
// and silence: cut small while racing the play head, ramp to the full 350
// (best prosody, least per-call overhead) once there is comfortable runway.
function targetChunkLen(effectiveSeconds) {
    if (effectiveSeconds < 3) return 90;
    if (effectiveSeconds < 8) return 180;
    if (effectiveSeconds < 15) return 260;
    return 350;
}

// Results can finish out of order across the pool; audio must not. Completed
// chunks wait here until every earlier sequence number has been scheduled.
// Never more than poolSize-1 entries wait at once, so memory is bounded.
class Committer {
    constructor(mySession, voice, describe) {
        this.session = mySession;
        this.voice = voice;
        this.describe = describe;
        this.nextSeq = 0;
        this.ready = new Map(); // seq -> {job, result}
        this.readyAudioSeconds = 0;
    }

    offer(job, result) {
        this.ready.set(job.seq, { job, result });
        this.readyAudioSeconds += result.samples.length / result.sampleRate;
        while (this.ready.has(this.nextSeq)) {
            const { job: next, result: r } = this.ready.get(this.nextSeq);
            this.ready.delete(this.nextSeq);
            this.readyAudioSeconds -= r.samples.length / r.sampleRate;
            this.nextSeq += 1;
            if (this.session.aborted) continue;
            this.session.play(r.samples, r.sampleRate);
            if (this.session.started) {
                setStatus({ phase: 'speaking', voice: this.voice, detail: this.describe(next) });
            }
        }
    }
}

// Pull chunks from `source`, keep the pool busy while the buffer target has
// room, and commit results in order. `source.next(targetLen)` yields
// {text, meta} or null when drained; `source.remainingHint()` is a lower
// bound on the characters still to read (gates worker scale-up). Options are
// rebuilt per chunk, so a speaker or speed change takes effect within at
// most a pool's worth of sentences.
async function speakStream(mySession, voice, source, describe) {
    const gen = pool.gen;
    const committer = new Committer(mySession, voice, describe);
    let seq = 0;
    let inFlight = 0;
    let exhausted = false;
    let failure = null;

    const settle = (job) => (result) => {
        inFlight -= 1;
        if (gen !== pool.gen || mySession.aborted) return;
        pool.observe(job, result);
        committer.offer(job, result);
    };
    const fail = (job) => (error) => {
        inFlight -= 1;
        if (gen !== pool.gen || mySession.aborted) return;
        if (error?.message === 'cancelled') return;
        if (job.attempts < 1) {
            // One bounce absorbs a transient or a crashed worker; a chunk
            // is never silently skipped - that would splice the audio.
            job.attempts += 1;
            pool.retryQueue.push(job);
        } else {
            failure = error;
        }
    };

    while (!mySession.aborted && gen === pool.gen) {
        if (failure) throw failure;
        if (exhausted && inFlight === 0 && pool.retryQueue.length === 0) break;
        if (mySession.paused) {
            await sleep(250);
            continue;
        }

        // Budget what the busy workers will deliver against the target, or
        // a full pool would overshoot it by a whole chunk per worker.
        const effective =
            mySession.bufferedSeconds() +
            pool.inFlightAudioEstimate(gen) +
            committer.readyAudioSeconds;
        if (effective >= HIGH_WATER_SECONDS) {
            await sleep(300);
            continue;
        }

        const worker = pool.freeWorker(voice);
        if (!worker) {
            pool.maybeScaleUp({
                voice,
                options: engineOptions(voice),
                effective,
                lowWater: LOW_WATER_SECONDS,
                remainingChars: source.remainingHint()
            });
            pool.maybeEvictZombie();
            await sleep(150);
            continue;
        }

        let job = pool.retryQueue.shift();
        if (!job) {
            if (exhausted) {
                await sleep(150); // just waiting for in-flight chunks to land
                continue;
            }
            const target = seq === 0 ? FIRST_CHUNK_CHARS : targetChunkLen(effective);
            const cut = await source.next(target);
            if (mySession.aborted || gen !== pool.gen) return;
            if (!cut) {
                exhausted = true;
                continue;
            }
            job = {
                seq: seq++,
                gen,
                voice,
                text: cut.text,
                charLen: cut.text.length,
                meta: cut.meta,
                options: engineOptions(voice),
                attempts: 0
            };
        }

        // With the buffer empty the user is waiting on this synthesis, and
        // "speaking" would read as a hang, so report the wait. With audio
        // buffered, the in-order commits drive the status instead - the
        // chunk being dispatched runs ahead of what the listener hears.
        if (mySession.bufferedSeconds() <= 0.25) {
            setStatus({ phase: 'generating', voice, detail: describe(job) });
        }
        inFlight += 1;
        pool.dispatch(worker, job).then(settle(job), fail(job));
    }
    if (failure) throw failure;
}

// ---------------------------------------------------------------- actions

async function speak(text, voice) {
    stopPlayback();
    const mySession = (session = new PlaybackSession(settings.volume / 100));
    try {
        setStatus({ phase: 'loading', voice });
        await pool.ensureVoice(voice, engineOptions(voice));
        const feed = new ChunkFeed();
        feed.append(text);
        feed.end();
        const source = {
            // Chunk counts are no longer known up front, so progress is the
            // share of the text already cut when this chunk was.
            next: async (targetLen) => {
                const before = feed.consumedChars;
                const cut = feed.next(targetLen);
                if (!cut) return null;
                const pct = feed.totalChars
                    ? Math.floor((before / feed.totalChars) * 100)
                    : 0;
                return { text: cut.text, meta: { pct } };
            },
            remainingHint: () => feed.buffered()
        };
        await speakStream(mySession, voice, source, (job) =>
            job.meta.pct > 0 ? `${job.meta.pct}% read` : ''
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

// A page fetched over HTTP can be anything; pdf.js would reject an HTML page
// with "Invalid PDF structure", which reads like a bug in the extension.
function looksLikePdf(data) {
    const head = new Uint8Array(data, 0, Math.min(1024, data.byteLength));
    return String.fromCharCode(...head).includes('%PDF-');
}

// --------------------------------------------------------- start from here

// Chromium hands a context-menu selection over as bare text: no page number,
// no offsets, and truncated at about a kilobyte. Finding where it sits in the
// document therefore means searching the extracted text for it, and the two
// do not agree character for character - the viewer's copy resolves
// ligatures, joins hyphenated line breaks and spaces things differently.
//
// So matching runs on a folded form: NFKD-decomposed, lowercased, and reduced
// to letters and digits, which drops the punctuation, accents and whitespace
// the two sides disagree about. `map` carries each folded character back to
// its index in the original string, so a hit converts straight into an offset
// to start reading from.
function fold(text) {
    let folded = '';
    const map = [];
    let index = 0;
    for (const point of text) {
        for (const ch of point.normalize('NFKD').toLowerCase()) {
            if (/[\p{L}\p{N}]/u.test(ch)) {
                folded += ch;
                map.push(index);
            }
        }
        index += point.length;
    }
    return { folded, map };
}

// Folding drops the characters between words, so two adjacent folded
// characters that came from non-adjacent source indices had something
// dropped between them - a word boundary. Preferring those keeps a short
// selection like "The" from landing inside "theory".
function findFolded(hay, map, needle, atWordStart) {
    let at = hay.indexOf(needle);
    while (at >= 0) {
        if (!atWordStart || at === 0 || map[at] - map[at - 1] > 1) return at;
        at = hay.indexOf(needle, at + 1);
    }
    return -1;
}

// Prefix lengths to fall back through. A selection that runs past a page
// break, or over text pdf.js extracts in a different order, only matches on
// its opening words - but the shorter the prefix the more places it can
// match, so the longest one that hits anywhere wins.
const MATCH_PREFIXES = [96, 48, 24, 12];

async function locateText(pageText, total, selection, mySession, voice) {
    const target = fold(selection).folded;
    if (!target) return null;
    const lengths = [...new Set([target.length, ...MATCH_PREFIXES])]
        .filter((n) => n <= target.length && n >= Math.min(target.length, 12))
        .sort((a, b) => b - a);

    const folded = new Map(); // page -> {folded, map}, built at most once
    for (const length of lengths) {
        const needle = target.slice(0, length);
        for (const atWordStart of [true, false]) {
            for (let p = 1; p <= total; p++) {
                if (mySession.aborted) return null;
                if (!folded.has(p)) {
                    setStatus({
                        phase: 'loading',
                        voice,
                        detail: `finding your place · page ${p} of ${total}`
                    });
                    folded.set(p, fold(await pageText(p)));
                }
                const page = folded.get(p);
                const at = findFolded(page.folded, page.map, needle, atWordStart);
                if (at >= 0) return { page: p, offset: page.map[at] };
            }
        }
    }
    return null;
}

// fromText starts the reading at a selection instead of at a page; fromPage
// is used when there is none. Everything after the start point is read.
async function readPdf(url, { fromPage, fromText } = {}, voice) {
    stopPlayback();
    const mySession = (session = new PlaybackSession(settings.volume / 100));
    try {
        setStatus({ phase: 'loading', voice, detail: 'opening PDF' });
        const robot = voice === 'robot';
        if (!robot) await pool.ensureVoice(voice, engineOptions(voice));

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not fetch the PDF (${response.status}).`);
        const data = await response.arrayBuffer();
        if (!looksLikePdf(data)) {
            throw new Error('This page is not a PDF, so there is nothing to read through.');
        }
        const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
        const total = pdf.numPages;

        // Searching for a selection walks pages that the reading loop then
        // wants again, so extraction is memoized. Pages are dropped as they
        // are spoken, so a long document never holds its whole text at once.
        const extracted = new Map();
        const pageText = async (p) => {
            if (!extracted.has(p)) extracted.set(p, await extractPageText(pdf, p));
            return extracted.get(p);
        };

        let start = Math.min(Math.max(1, Number(fromPage) || 1), total);
        let offset = 0;
        if (fromText) {
            const found = await locateText(pageText, total, fromText, mySession, voice);
            if (mySession.aborted) return;
            if (!found) {
                throw new Error(
                    'Could not find that selection in the PDF text, so there is no place ' +
                    'to start from. Try selecting a few words that sit together on one page.'
                );
            }
            start = found.page;
            offset = found.offset;
            // Pages the search read past are never spoken.
            for (const p of extracted.keys()) if (p < start) extracted.delete(p);
        }

        // A PDF with no extractable text (a scan, or a start page past the end
        // of the text) would otherwise run to completion in silence and
        // report idle, indistinguishable from a broken extension.
        let readAnything = false;

        if (robot) {
            for (let p = start; p <= total; p++) {
                if (mySession.aborted) return;
                let text = await pageText(p);
                extracted.delete(p);
                // The selection is the start point, so the page it sits on
                // is read from it rather than from the top.
                if (p === start && offset > 0) text = text.slice(offset).trim();
                if (!text) continue;
                readAnything = true;
                setStatus({ phase: 'speaking', voice, detail: `page ${p} of ${total}` });
                chrome.runtime
                    .sendMessage({ type: 'robot-say', text, page: p, pages: total })
                    .catch(() => {});
            }
        } else {
            // Pages are pulled into the feed only as the cutter runs dry, so
            // a long document never holds much text at once, and chunks span
            // page boundaries - a sentence broken across pages reads as one.
            const feed = new ChunkFeed();
            let nextPage = start;
            const source = {
                next: async (targetLen) => {
                    for (;;) {
                        const cut = feed.next(targetLen);
                        if (cut) return cut;
                        if (feed.ended) return null;
                        if (mySession.aborted) return null;
                        if (nextPage > total) {
                            feed.end();
                            continue; // flush whatever is left in the buffer
                        }
                        const p = nextPage++;
                        let text = await pageText(p);
                        extracted.delete(p);
                        // The selection is the start point, so the page it
                        // sits on is read from it rather than from the top.
                        if (p === start && offset > 0) text = text.slice(offset).trim();
                        if (!text) continue;
                        readAnything = true;
                        feed.append(text, { page: p });
                    }
                },
                // Pages still unread are an unknown amount of text; report
                // "plenty" until the last one is in the buffer.
                remainingHint: () => (nextPage <= total ? Infinity : feed.buffered())
            };
            await speakStream(mySession, voice, source, (job) =>
                `page ${job.meta?.page ?? start} of ${total}`
            );
        }
        if (!readAnything) {
            throw new Error(
                start > 1
                    ? `No selectable text from page ${start} to ${total}. If this is a scanned PDF, ` +
                      'the text is an image and cannot be read aloud.'
                    : 'No selectable text in this PDF. It is probably a scan, so there is ' +
                      'nothing to read aloud.'
            );
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
    console.error('Paperlight TTS:', error);
    setStatus({ phase: 'error', voice, error: String(error?.message || error) });
}

function stopPlayback() {
    if (session) {
        session.stop();
        session = null;
    }
    // Drop results of any in-flight synthesis. Inference itself cannot be
    // aborted; the pool ages those workers out if a new session needs them.
    pool.abortGeneration();
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== 'tts-offscreen') return;
    // Every command carries the current settings from the service worker.
    applySettings(message.settings);
    switch (message.cmd) {
        case 'settings':
            break; // applySettings above did the work
        case 'speak':
            speak(message.text, message.voice);
            break;
        case 'read-pdf':
            readPdf(
                message.url,
                { fromPage: message.fromPage, fromText: message.fromText },
                message.voice
            );
            break;
        case 'preload':
            (async () => {
                try {
                    setStatus({ phase: 'loading', voice: message.voice });
                    await pool.ensureVoice(message.voice, engineOptions(message.voice));
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
        case 'pause':
            session?.pause();
            break;
        case 'resume':
            session?.resume();
            break;
        case 'stop':
            stopPlayback();
            setStatus({ phase: 'idle' });
            break;
    }
    sendResponse({ ok: true });
});
