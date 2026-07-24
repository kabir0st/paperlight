// Paperlight TTS worker pool.
// A small pool of inference workers (tts-worker.js), scaled by demand: one
// worker is kept warm, extras are spawned only while playback is at risk of
// running dry on a long document, and torn down again once idle. Each worker
// is a full copy of the model (~200 MB resident), which is why the pool is
// capped well below the core count and never scales up speculatively.
//
// ORT inference cannot be aborted, so "cancel" is cooperative: bumping the
// generation counter drops results that are still in flight, and a worker
// stuck finishing a stale chunk is terminated and respawned if a new session
// actually needs its slot (weights come back from the Cache API in seconds).

const DEBUG = false;

// One core per worker: WASM inference runs single-threaded (the extension is
// not cross-origin isolated). Leave headroom for the audio render thread,
// this coordinator with pdf.js, and the rest of the browser.
export const POOL_CAP = Math.max(1, Math.min(3, (navigator.hardwareConcurrency ?? 4) - 2));

const SCALE_UP_COOLDOWN_MS = 3000; // escalate quickly on slow machines; extras idle out anyway
const SCALE_UP_MIN_REMAINING_CHARS = 800; // ~60s of audio; less never repays warm-up
const WORKER_IDLE_TERMINATE_MS = 45000; // extras cost real RAM; survive short pauses
const IDLE_SWEEP_MS = 5000;

// Audio seconds produced per text character, seeded at ~14 chars/s (Kokoro at
// speed 1) and tracked as an EMA so speed and speaker changes self-correct.
const SEC_PER_CHAR_SEED = 1 / 14;
const SEC_PER_CHAR_ALPHA = 0.3;

export class WorkerPool {
    constructor({ workerUrl, onDownload, onEngineReady, onIdleCrash }) {
        this.workerUrl = workerUrl;
        this.onDownload = onDownload; // download progress, first fetch only
        this.onEngineReady = onEngineReady; // first time a voice becomes usable
        this.onIdleCrash = onIdleCrash; // a worker died with no one waiting on it
        this.gen = 0; // results from an older generation are dropped
        this.workers = [];
        this.nextWorkerId = 1;
        this.requestId = 0;
        this.pending = new Map(); // request id -> {resolve, reject}
        this.readyEngines = new Set(); // voices whose weights are known cached
        this.retryQueue = []; // jobs bounced by a crash/synth error, retried once
        this.lastSpawnAt = 0;
        this.noMoreSpawns = false; // set when a spare fails to init; reset per session
        this.secPerChar = SEC_PER_CHAR_SEED;
        setInterval(() => this.sweepIdle(), IDLE_SWEEP_MS);
    }

    debug(...args) {
        if (DEBUG) console.log('[tts-pool]', ...args);
    }

    // ------------------------------------------------------------ lifecycle

    spawn() {
        const entry = {
            id: this.nextWorkerId++,
            worker: new Worker(this.workerUrl, { type: 'module' }),
            ready: new Set(), // voices ensured on this worker
            ensuring: new Map(), // voice -> {promise, resolve, reject}
            job: null, // job dispatched and not yet answered
            currentRequestId: 0,
            warming: false, // spawned for scale-up, still running its ensure
            idleSince: Date.now()
        };
        entry.worker.onmessage = ({ data }) => this.onMessage(entry, data);
        entry.worker.onerror = (event) => this.onWorkerError(entry, event);
        this.workers.push(entry);
        this.lastSpawnAt = Date.now();
        this.debug(`spawned worker ${entry.id}, pool size ${this.workers.length}`);
        return entry;
    }

    removeWorker(entry, error = new Error('TTS worker terminated')) {
        const at = this.workers.indexOf(entry);
        if (at >= 0) this.workers.splice(at, 1);
        try {
            entry.worker.terminate();
        } catch {}
        if (entry.currentRequestId) {
            const p = this.pending.get(entry.currentRequestId);
            if (p) {
                this.pending.delete(entry.currentRequestId);
                p.reject(error);
            }
        }
        for (const waiter of entry.ensuring.values()) waiter.reject(error);
        entry.ensuring.clear();
        this.debug(`removed worker ${entry.id}, pool size ${this.workers.length}`);
    }

    // Extra workers that have sat idle past the timeout are torn down; the
    // last worker always stays warm so the next reading starts immediately.
    sweepIdle() {
        const now = Date.now();
        for (const entry of [...this.workers]) {
            if (this.workers.length <= 1) return;
            if (entry.job || entry.warming || !entry.idleSince) continue;
            if (now - entry.idleSince > WORKER_IDLE_TERMINATE_MS) {
                this.debug(`terminating idle worker ${entry.id}`);
                this.removeWorker(entry);
            }
        }
    }

    // ------------------------------------------------------------- messages

    onMessage(entry, data) {
        switch (data.type) {
            case 'download':
                // A worker spawned mid-session re-reads cached weights;
                // only the genuine first fetch should show a download bar.
                if (!this.readyEngines.has(data.voice)) this.onDownload?.(data);
                break;
            case 'engine-ready': {
                const waiter = entry.ensuring.get(data.voice);
                entry.ensuring.delete(data.voice);
                entry.ready.add(data.voice);
                entry.warming = false;
                waiter?.resolve();
                if (!this.readyEngines.has(data.voice)) {
                    this.readyEngines.add(data.voice);
                    this.onEngineReady?.(data.voice);
                }
                break;
            }
            case 'engine-error': {
                const waiter = entry.ensuring.get(data.voice);
                entry.ensuring.delete(data.voice);
                waiter?.reject(new Error(data.error));
                break;
            }
            case 'audio': {
                const p = this.pending.get(data.id);
                this.pending.delete(data.id);
                if (entry.currentRequestId === data.id) {
                    entry.currentRequestId = 0;
                    entry.job = null;
                    entry.idleSince = Date.now();
                }
                if (p) {
                    p.resolve({
                        samples: new Float32Array(data.samples),
                        sampleRate: data.sampleRate
                    });
                } else {
                    this.debug(`dropped stale audio for request ${data.id}`);
                }
                break;
            }
            case 'synth-error': {
                const p = this.pending.get(data.id);
                this.pending.delete(data.id);
                if (entry.currentRequestId === data.id) {
                    entry.currentRequestId = 0;
                    entry.job = null;
                    entry.idleSince = Date.now();
                }
                p?.reject(new Error(data.error));
                break;
            }
        }
    }

    onWorkerError(entry, event) {
        const error = new Error(event.message || 'TTS worker crashed');
        this.debug(`worker ${entry.id} crashed: ${error.message}`);
        // Anyone waiting on this worker gets the rejection (and the dispatch
        // loop retries the job elsewhere); a crash nobody was waiting on
        // would otherwise be invisible, so surface it - unless the worker
        // was grinding a stale chunk after a stop, where its death changes
        // nothing the user can see.
        const hadConsumers =
            entry.ensuring.size > 0 ||
            (entry.currentRequestId && this.pending.has(entry.currentRequestId));
        const staleWork = entry.job && entry.job.gen !== this.gen;
        this.removeWorker(entry, error);
        if (!hadConsumers && !staleWork) this.onIdleCrash?.(error);
    }

    // --------------------------------------------------------------- ensure

    ensureOn(entry, voice, options) {
        if (entry.ready.has(voice)) return Promise.resolve();
        let waiter = entry.ensuring.get(voice);
        if (!waiter) {
            waiter = {};
            waiter.promise = new Promise((resolve, reject) => {
                waiter.resolve = resolve;
                waiter.reject = reject;
            });
            entry.ensuring.set(voice, waiter);
            entry.worker.postMessage({ cmd: 'ensure', voice, ...options });
        }
        return waiter.promise;
    }

    // Warm the voice on the pool's long-lived worker. Once the weights are
    // known cached this is a no-op unless every worker has been replaced.
    async ensureVoice(voice, options) {
        const entry = this.workers[0] ?? this.spawn();
        if (this.readyEngines.has(voice) && entry.ready.has(voice)) return;
        await this.ensureOn(entry, voice, options);
    }

    // ------------------------------------------------------------- dispatch

    freeWorker(voice) {
        if (this.workers.length === 0) this.spawn();
        return (
            this.workers.find((w) => !w.job && !w.warming && w.ready.has(voice)) ??
            this.workers.find((w) => !w.job && !w.warming) ??
            null
        );
    }

    async dispatch(entry, job) {
        entry.job = job;
        entry.idleSince = 0;
        if (!entry.ready.has(job.voice)) {
            try {
                await this.ensureOn(entry, job.voice, job.options);
            } catch (error) {
                // The worker never started inference, it is safe to reuse.
                if (entry.job === job) {
                    entry.job = null;
                    entry.idleSince = Date.now();
                }
                throw error;
            }
        }
        if (job.gen !== this.gen) {
            // Stopped while the ensure ran; don't burn a full inference on a
            // result that would only be dropped.
            entry.job = null;
            entry.idleSince = Date.now();
            throw new Error('cancelled');
        }
        return new Promise((resolve, reject) => {
            const id = ++this.requestId;
            entry.currentRequestId = id;
            this.pending.set(id, { resolve, reject });
            this.debug(`dispatch seq ${job.seq} (${job.charLen} chars) to worker ${entry.id}`);
            entry.worker.postMessage({
                cmd: 'synthesize',
                id,
                voice: job.voice,
                text: job.text,
                options: job.options
            });
        });
    }

    // -------------------------------------------------------------- scaling

    // All conditions must hold: growth is the exception, not the rule. The
    // gate is the AUDIBLE runway - what is actually scheduled ahead of the
    // play head - not the estimate that counts in-flight synthesis: on a
    // slow machine the in-flight chunk is precisely what is not arriving in
    // time, and counting it would mask the underrun. A worker that keeps up
    // makes the real buffer climb, and this never fires.
    maybeScaleUp({ voice, options, buffered, lowWater, remainingChars }) {
        if (this.noMoreSpawns) return;
        if (this.workers.length >= POOL_CAP) return;
        if (!this.workers.every((w) => w.job || w.warming)) return;
        if (!this.readyEngines.has(voice)) return; // never race the first download
        if (buffered >= lowWater) return;
        if (remainingChars <= SCALE_UP_MIN_REMAINING_CHARS) return;
        if (Date.now() - this.lastSpawnAt < SCALE_UP_COOLDOWN_MS) return;
        const entry = this.spawn();
        entry.warming = true;
        this.debug(`scaling up: worker ${entry.id} warming (buffered ${buffered.toFixed(1)}s)`);
        this.ensureOn(entry, voice, options).catch(() => {
            // A spare that cannot init would just fail again; stop trying
            // for the rest of this session and carry on with what works.
            this.noMoreSpawns = true;
            this.removeWorker(entry);
        });
    }

    // Stop-then-read-elsewhere is a common gesture, and inference cannot be
    // aborted: a worker still finishing a chunk nobody wants could block the
    // new session's first audio for the length of that chunk. If nothing is
    // free and a stale job is hogging a slot, replace that worker.
    maybeEvictZombie() {
        if (this.workers.some((w) => !w.job && !w.warming)) return;
        const zombie = this.workers.find((w) => w.job && w.job.gen !== this.gen);
        if (!zombie) return;
        this.debug(`evicting zombie worker ${zombie.id} (stale seq ${zombie.job.seq})`);
        this.removeWorker(zombie);
        this.spawn(); // replacement; dispatch() re-ensures from cache
    }

    // ------------------------------------------------------------ session

    // Called on stop / new session. In-flight results are orphaned (their
    // rejections tell the old dispatch loop to unwind); the workers
    // themselves finish their current chunk and then read as idle.
    abortGeneration() {
        this.gen += 1;
        this.noMoreSpawns = false;
        this.retryQueue.length = 0;
        const error = new Error('cancelled');
        for (const p of this.pending.values()) p.reject(error);
        this.pending.clear();
        this.debug(`generation bumped to ${this.gen}`);
    }

    // Audio seconds the busy workers are expected to deliver. Budgeting this
    // against the buffer target keeps a full pool from overshooting it by a
    // whole chunk per worker.
    inFlightAudioEstimate(gen) {
        let seconds = 0;
        for (const w of this.workers) {
            if (w.job && w.job.gen === gen) seconds += w.job.charLen * this.secPerChar;
        }
        return seconds;
    }

    // How many workers are synthesizing for the current reading right now.
    busyWorkers(gen) {
        let n = 0;
        for (const w of this.workers) {
            if (w.job && w.job.gen === gen) n += 1;
        }
        return n;
    }

    observe(job, result) {
        if (!job.charLen || !result?.samples?.length || !result.sampleRate) return;
        const perChar = result.samples.length / result.sampleRate / job.charLen;
        this.secPerChar =
            this.secPerChar * (1 - SEC_PER_CHAR_ALPHA) + perChar * SEC_PER_CHAR_ALPHA;
    }
}
