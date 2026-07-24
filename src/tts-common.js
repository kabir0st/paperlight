// Shared helpers for the TTS engines.

const ASSET_CACHE = 'gentle-tts-assets';

// Fetch with Cache API persistence, so speaker files are only ever
// downloaded once.
export async function cachedArrayBuffer(url) {
    const cache = await caches.open(ASSET_CACHE);
    let response = await cache.match(url);
    if (!response) {
        response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
        await cache.put(url, response.clone());
    }
    return response.arrayBuffer();
}

// The longest chunk ever cut. 350 chars stays comfortably under the model's
// 509-phoneme ceiling (the tokenizer truncates past it), and is the size the
// fixed splitter always used.
export const CHUNK_HARD_MAX = 350;

const SENTENCE_END = /[.!?…;:]/;

// Incremental chunk cutter. Text is appended as it becomes available (PDF
// pages, a selection) and cut into speakable chunks on demand, each sized by
// the caller: small chunks while the listener is waiting on the first audio,
// long ones once playback is buffered ahead. Each append can carry a meta
// value (a page number); a cut reports the meta of the range its first
// character came from.
export class ChunkFeed {
    constructor() {
        this.buf = '';
        this.metas = []; // {start, end, meta} ranges over buf
        this.ended = false;
        this.totalChars = 0;
        this.consumedChars = 0;
    }

    append(text, meta = null) {
        const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
        if (!normalized) return;
        const start = this.buf ? this.buf.length + 1 : 0;
        this.buf = this.buf ? `${this.buf} ${normalized}` : normalized;
        this.metas.push({ start, end: start + normalized.length, meta });
        this.totalChars += normalized.length + (start > 0 ? 1 : 0);
    }

    end() {
        this.ended = true;
    }

    buffered() {
        return this.buf.length;
    }

    // Returns {text, meta} or null. Null means "append more text first" until
    // end() is called; after that it means the feed is drained. While more
    // text may still arrive, nothing shorter than CHUNK_HARD_MAX is cut, so a
    // page boundary never produces a runt chunk mid-sentence.
    next(targetLen) {
        if (!this.buf) return null;
        if (!this.ended && this.buf.length < CHUNK_HARD_MAX) return null;
        const limit = Math.max(1, Math.min(targetLen, CHUNK_HARD_MAX, this.buf.length));
        const cut = this.buf.length <= limit ? this.buf.length : this.cutPoint(limit);
        const meta = this.metas.length ? this.metas[0].meta : null;
        const text = this.buf.slice(0, cut).trim();
        // Consume the cut plus the space that follows it.
        let shift = cut;
        while (this.buf[shift] === ' ') shift += 1;
        this.buf = this.buf.slice(shift);
        this.consumedChars += shift;
        const metas = [];
        for (const m of this.metas) {
            if (m.end - shift <= 0) continue;
            metas.push({ start: Math.max(0, m.start - shift), end: m.end - shift, meta: m.meta });
        }
        this.metas = metas;
        return { text, meta };
    }

    // Prefer a sentence end, then a clause comma past the midpoint, then a
    // word boundary; a hard cut only for pathological unbroken runs. The
    // same fallback ladder the fixed splitter used.
    cutPoint(limit) {
        for (let i = limit; i >= 1; i--) {
            if (this.buf[i] === ' ' && SENTENCE_END.test(this.buf[i - 1])) return i;
        }
        const comma = this.buf.lastIndexOf(',', limit - 1);
        if (comma > limit / 2) return comma + 1;
        const space = this.buf.lastIndexOf(' ', limit);
        if (space > 0) return space;
        return limit;
    }
}
