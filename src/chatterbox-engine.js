// "Natural" voice — Chatterbox (0.5B) running locally via transformers.js.
// WebGPU is required: the autoregressive language model is far too slow
// on WASM to be usable.

import { ChatterboxModel, AutoProcessor } from '@huggingface/transformers';
import { cachedArrayBuffer, decodeAudio } from './tts-common.js';

const MODEL_ID = 'onnx-community/chatterbox-ONNX';
const REFERENCE_SAMPLE_RATE = 24000; // from preprocessor_config.json

export const CHATTERBOX_SAMPLE_RATE = 24000;

export class ChatterboxEngine {
    constructor(model, processor, conditioning) {
        this.model = model;
        this.processor = processor;
        this.conditioning = conditioning;
    }

    static async create({ progress_callback = null } = {}) {
        if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) {
            throw new Error(
                'WebGPU is not available in this browser, and the Natural voice needs it. ' +
                'The Fluent voice works without WebGPU.'
            );
        }

        const [model, processor] = await Promise.all([
            ChatterboxModel.from_pretrained(MODEL_ID, {
                device: 'webgpu',
                // Only the language model has quantized exports; the other
                // components ship as fp32 only.
                dtype: {
                    embed_tokens: 'fp32',
                    speech_encoder: 'fp32',
                    model: 'q4f16',
                    conditional_decoder: 'fp32'
                },
                progress_callback
            }),
            AutoProcessor.from_pretrained(MODEL_ID, { progress_callback })
        ]);

        // Encode the default reference voice ONCE; every utterance then
        // reuses the precomputed speaker conditioning tensors.
        const referenceBuffer = await cachedArrayBuffer(
            `https://huggingface.co/${MODEL_ID}/resolve/main/default_voice.wav`
        );
        const audio = await decodeAudio(referenceBuffer, REFERENCE_SAMPLE_RATE);
        const { input_values } = await processor.feature_extractor(audio);
        const conditioning = await model.encode_speech(input_values);

        return new ChatterboxEngine(model, processor, conditioning);
    }

    // Returns a Float32Array waveform at CHATTERBOX_SAMPLE_RATE.
    async synthesize(text) {
        const { input_ids, attention_mask } = this.processor.tokenizer(text);
        const waveform = await this.model.generate({
            input_ids,
            attention_mask,
            ...this.conditioning,
            max_new_tokens: 1024
        });
        return waveform.data;
    }
}
