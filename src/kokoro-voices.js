// Speaker list for the "Fluent" voice (Kokoro-82M).
//
// English only: the bundled phonemizer handles American ('a') and British
// ('b') English, which covers the af_/am_/bf_/bm_ files in
// onnx-community/Kokoro-82M-v1.0-ONNX/voices/. Each speaker is a ~0.5 MB
// style tensor fetched on demand, so switching is cheap, the 82M model
// itself is shared by all of them.
//
// Kokoro publishes 28 English speakers; this is a curated four, one per
// accent/gender pairing, because picking a reading voice is a one-time
// decision and a 28-entry dropdown made it feel like a chore.
//
// This module is imported by the bundled engine AND loaded directly by the
// popup, so the list lives in exactly one place.

export const DEFAULT_KOKORO_VOICE = 'af_nicole';

export const KOKORO_VOICES = [
    { id: 'af_nicole', name: 'Nicole', accent: 'US', gender: 'F' },
    { id: 'am_santa', name: 'Santa', accent: 'US', gender: 'M' },
    { id: 'bf_isabella', name: 'Isabella', accent: 'UK', gender: 'F' },
    { id: 'bm_george', name: 'George', accent: 'UK', gender: 'M' }
];

export function isKokoroVoice(id) {
    return KOKORO_VOICES.some((voice) => voice.id === id);
}

// Phonemizer language code: 'b' for the British speakers, 'a' otherwise.
export function kokoroLang(id) {
    return String(id).startsWith('b') ? 'b' : 'a';
}
