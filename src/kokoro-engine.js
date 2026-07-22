// "Fluent" voice — Kokoro-82M running locally via transformers.js.
// A thin reimplementation of kokoro-js on transformers v4 (kokoro-js pins
// v3, which would force two copies of the runtime into the bundle).

import { StyleTextToSpeech2Model, AutoTokenizer, Tensor } from '@huggingface/transformers';
import { phonemize } from './vendor/phonemize.js';
import { cachedArrayBuffer } from './tts-common.js';
import { DEFAULT_KOKORO_VOICE, isKokoroVoice, kokoroLang } from './kokoro-voices.js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const STYLE_DIM = 256;
const MAX_PHONEME_TOKENS = 509;

// Weights are chosen per device, not fixed:
//   wasm   — q8 (~90 MB). int8 has no WebGPU kernel, so this is CPU-only.
//   webgpu — fp16 (~156 MB) when the adapter reports shader-f16, else fp32
//            (~310 MB). 2.4.0 hardcoded fp32 here and produced garbled audio
//            on at least one machine, so the precision now follows what the
//            GPU actually advertises rather than a guess.
const WASM_DTYPE = 'q8';

async function webgpuDtype() {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) {
        throw new Error(
            'WebGPU is not available in this browser. Switch the Fluent engine ' +
            'back to CPU in the extension popup.'
        );
    }
    return adapter.features?.has('shader-f16') ? 'fp16' : 'fp32';
}

export const KOKORO_SAMPLE_RATE = 24000;

export class KokoroEngine {
    constructor(model, tokenizer) {
        this.model = model;
        this.tokenizer = tokenizer;
        this.styles = new Map(); // speaker id -> Float32Array
    }

    static async create({
        device = 'wasm',
        speaker = DEFAULT_KOKORO_VOICE,
        progress_callback = null
    } = {}) {
        const dtype = device === 'webgpu' ? await webgpuDtype() : WASM_DTYPE;
        const [model, tokenizer] = await Promise.all([
            StyleTextToSpeech2Model.from_pretrained(MODEL_ID, {
                dtype,
                device,
                progress_callback
            }),
            AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback })
        ]);
        const engine = new KokoroEngine(model, tokenizer);
        await engine.loadSpeaker(speaker);
        return engine;
    }

    // Style tensors are per-speaker ~0.5 MB files, cached by cachedArrayBuffer,
    // so the first switch to a speaker is a blip and later ones are instant.
    async loadSpeaker(speaker) {
        const id = isKokoroVoice(speaker) ? speaker : DEFAULT_KOKORO_VOICE;
        let style = this.styles.get(id);
        if (!style) {
            const buffer = await cachedArrayBuffer(
                `https://huggingface.co/${MODEL_ID}/resolve/main/voices/${id}.bin`
            );
            style = new Float32Array(buffer);
            this.styles.set(id, style);
        }
        return { id, style };
    }

    // Returns a Float32Array waveform at KOKORO_SAMPLE_RATE.
    // speed > 1 talks faster without shifting pitch — the model takes it as
    // an input, so this is not resampling.
    async synthesize(text, { speaker = DEFAULT_KOKORO_VOICE, speed = 1 } = {}) {
        const { id, style: voiceData } = await this.loadSpeaker(speaker);
        const phonemes = await phonemize(text, kokoroLang(id));
        const { input_ids } = this.tokenizer(phonemes, { truncation: true });

        // Voice style vector is selected by input length (as in kokoro-js).
        const numTokens = Math.min(
            Math.max(input_ids.dims.at(-1) - 2, 0),
            MAX_PHONEME_TOKENS
        );
        const offset = numTokens * STYLE_DIM;
        const style = voiceData.slice(offset, offset + STYLE_DIM);

        const { waveform } = await this.model({
            input_ids,
            style: new Tensor('float32', style, [1, STYLE_DIM]),
            speed: new Tensor('float32', [Math.min(2, Math.max(0.5, Number(speed) || 1))], [1])
        });
        return waveform.data;
    }
}
