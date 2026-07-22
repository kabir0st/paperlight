// "Fluent" voice — Kokoro-82M running locally via transformers.js.
// A thin reimplementation of kokoro-js on transformers v4 (kokoro-js pins
// v3, which would force two copies of the runtime into the bundle).

import { StyleTextToSpeech2Model, AutoTokenizer, Tensor } from '@huggingface/transformers';
import { phonemize } from './vendor/phonemize.js';
import { cachedArrayBuffer } from './tts-common.js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const VOICE = 'af_heart';
const STYLE_DIM = 256;
const MAX_PHONEME_TOKENS = 509;

export const KOKORO_SAMPLE_RATE = 24000;

export class KokoroEngine {
    constructor(model, tokenizer, voiceData) {
        this.model = model;
        this.tokenizer = tokenizer;
        this.voiceData = voiceData;
    }

    static async create({ device = 'wasm', progress_callback = null } = {}) {
        const [model, tokenizer, voiceBuffer] = await Promise.all([
            StyleTextToSpeech2Model.from_pretrained(MODEL_ID, {
                dtype: 'q8',
                device,
                progress_callback
            }),
            AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback }),
            cachedArrayBuffer(
                `https://huggingface.co/${MODEL_ID}/resolve/main/voices/${VOICE}.bin`
            )
        ]);
        return new KokoroEngine(model, tokenizer, new Float32Array(voiceBuffer));
    }

    // Returns a Float32Array waveform at KOKORO_SAMPLE_RATE.
    async synthesize(text) {
        const phonemes = await phonemize(text, 'a');
        const { input_ids } = this.tokenizer(phonemes, { truncation: true });

        // Voice style vector is selected by input length (as in kokoro-js).
        const numTokens = Math.min(
            Math.max(input_ids.dims.at(-1) - 2, 0),
            MAX_PHONEME_TOKENS
        );
        const offset = numTokens * STYLE_DIM;
        const style = this.voiceData.slice(offset, offset + STYLE_DIM);

        const { waveform } = await this.model({
            input_ids,
            style: new Tensor('float32', style, [1, STYLE_DIM]),
            speed: new Tensor('float32', [1], [1])
        });
        return waveform.data;
    }
}
