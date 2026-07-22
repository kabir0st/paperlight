// Build script: bundles the offscreen coordinator and the TTS inference
// worker, and copies WASM assets into vendor/ so the extension is fully
// self-contained (MV3 forbids remotely hosted code). Run with: npm run build
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const common = {
    bundle: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    logLevel: 'info',
    // Node-only optional deps of transformers.js, never reached in browser.
    external: ['onnxruntime-node', 'sharp', 'fs', 'path', 'url', 'module', 'worker_threads', 'perf_hooks', 'os']
};

// Coordinator: playback, pdf.js extraction, worker orchestration.
await build({ ...common, entryPoints: ['src/offscreen-main.js'], outfile: 'offscreen.js' });
// Inference worker: transformers.js + engines (runs off the shared UI thread).
await build({ ...common, entryPoints: ['src/tts-worker.js'], outfile: 'tts-worker.js' });

mkdirSync('vendor', { recursive: true });
const ORT_DIST = 'node_modules/onnxruntime-web/dist';
// asyncify = WASM (CPU) backend, jsep = WebGPU backend. The plain and
// jspi variants are not requested by onnxruntime-web 1.24 in either path.
for (const file of [
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.asyncify.wasm',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm'
]) {
    cpSync(`${ORT_DIST}/${file}`, `vendor/${file}`);
}
cpSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'vendor/pdf.worker.min.mjs');
console.log('vendor/ assets copied');
