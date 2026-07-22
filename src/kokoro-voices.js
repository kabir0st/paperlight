// Speaker list for the "Fluent" voice (Kokoro-82M).
//
// English only: the bundled phonemizer handles American ('a') and British
// ('b') English, which covers the af_/am_/bf_/bm_ files in
// onnx-community/Kokoro-82M-v1.0-ONNX/voices/. Each speaker is a ~0.5 MB
// style tensor fetched on demand, so switching is cheap — the 82M model
// itself is shared by all of them.
//
// This module is imported by the bundled engine AND loaded directly by the
// popup, so the list lives in exactly one place. Within each group speakers
// are ordered by the quality grades published with the model.

export const DEFAULT_KOKORO_VOICE = 'af_heart';

export const KOKORO_VOICES = [
    // American English — female
    { id: 'af_heart', name: 'Heart', accent: 'US', gender: 'F' },
    { id: 'af_bella', name: 'Bella', accent: 'US', gender: 'F' },
    { id: 'af_nicole', name: 'Nicole', accent: 'US', gender: 'F' },
    { id: 'af_aoede', name: 'Aoede', accent: 'US', gender: 'F' },
    { id: 'af_kore', name: 'Kore', accent: 'US', gender: 'F' },
    { id: 'af_sarah', name: 'Sarah', accent: 'US', gender: 'F' },
    { id: 'af_nova', name: 'Nova', accent: 'US', gender: 'F' },
    { id: 'af_alloy', name: 'Alloy', accent: 'US', gender: 'F' },
    { id: 'af_sky', name: 'Sky', accent: 'US', gender: 'F' },
    { id: 'af_jessica', name: 'Jessica', accent: 'US', gender: 'F' },
    { id: 'af_river', name: 'River', accent: 'US', gender: 'F' },
    // American English — male
    { id: 'am_fenrir', name: 'Fenrir', accent: 'US', gender: 'M' },
    { id: 'am_michael', name: 'Michael', accent: 'US', gender: 'M' },
    { id: 'am_puck', name: 'Puck', accent: 'US', gender: 'M' },
    { id: 'am_echo', name: 'Echo', accent: 'US', gender: 'M' },
    { id: 'am_eric', name: 'Eric', accent: 'US', gender: 'M' },
    { id: 'am_liam', name: 'Liam', accent: 'US', gender: 'M' },
    { id: 'am_onyx', name: 'Onyx', accent: 'US', gender: 'M' },
    { id: 'am_santa', name: 'Santa', accent: 'US', gender: 'M' },
    { id: 'am_adam', name: 'Adam', accent: 'US', gender: 'M' },
    // British English — female
    { id: 'bf_emma', name: 'Emma', accent: 'UK', gender: 'F' },
    { id: 'bf_isabella', name: 'Isabella', accent: 'UK', gender: 'F' },
    { id: 'bf_alice', name: 'Alice', accent: 'UK', gender: 'F' },
    { id: 'bf_lily', name: 'Lily', accent: 'UK', gender: 'F' },
    // British English — male
    { id: 'bm_george', name: 'George', accent: 'UK', gender: 'M' },
    { id: 'bm_fable', name: 'Fable', accent: 'UK', gender: 'M' },
    { id: 'bm_lewis', name: 'Lewis', accent: 'UK', gender: 'M' },
    { id: 'bm_daniel', name: 'Daniel', accent: 'UK', gender: 'M' }
];

export function isKokoroVoice(id) {
    return KOKORO_VOICES.some((voice) => voice.id === id);
}

// Phonemizer language code: 'b' for the British speakers, 'a' otherwise.
export function kokoroLang(id) {
    return String(id).startsWith('b') ? 'b' : 'a';
}
