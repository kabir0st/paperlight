// Shared helpers for the TTS engines.

// Default speaker for the "Natural" (Chatterbox) voice. Decoded on the
// offscreen document (workers have no AudioContext) and handed to the worker.
export const REFERENCE_VOICE_URL =
    'https://huggingface.co/onnx-community/chatterbox-ONNX/resolve/main/default_voice.wav';
export const REFERENCE_SAMPLE_RATE = 24000;

const ASSET_CACHE = 'gentle-tts-assets';

// Fetch with Cache API persistence, so voice files and reference audio
// are only ever downloaded once.
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

// Decode an audio file (wav/mp3/...) to mono Float32Array at targetRate.
export async function decodeAudio(arrayBuffer, targetRate) {
    const probe = new AudioContext();
    const decoded = await probe.decodeAudioData(arrayBuffer);
    await probe.close();

    const length = Math.ceil((decoded.duration + 0.01) * targetRate);
    const offline = new OfflineAudioContext(1, length, targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
}

// Split text into speakable chunks: sentences, merged up to maxLen chars,
// with a hard split for pathological run-on sentences.
export function splitSentences(text, maxLen = 350) {
    const sentences = text
        .replace(/\s+/g, ' ')
        .trim()
        .split(/(?<=[.!?…;:])\s+/);

    const chunks = [];
    let current = '';
    for (let sentence of sentences) {
        while (sentence.length > maxLen) {
            const cut =
                sentence.lastIndexOf(',', maxLen) > maxLen / 2
                    ? sentence.lastIndexOf(',', maxLen) + 1
                    : sentence.lastIndexOf(' ', maxLen);
            const head = sentence.slice(0, cut > 0 ? cut : maxLen).trim();
            if (head) chunks.push(current ? `${current} ${head}` : head);
            current = '';
            sentence = sentence.slice(cut > 0 ? cut : maxLen).trim();
        }
        if ((current + ' ' + sentence).trim().length > maxLen) {
            if (current) chunks.push(current);
            current = sentence;
        } else {
            current = (current + ' ' + sentence).trim();
        }
    }
    if (current) chunks.push(current);
    return chunks.filter(Boolean);
}
