// Build script: bundles the offscreen TTS document and copies the ONNX
// Runtime WASM assets into vendor/ so the extension is fully self-contained
// (MV3 forbids remotely hosted code). Run with: npm run build
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

await build({
    entryPoints: ['src/offscreen-main.js'],
    outfile: 'offscreen.js',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    logLevel: 'info',
    // Node-only optional deps of transformers.js — never reached in browser.
    external: ['onnxruntime-node', 'sharp', 'fs', 'path', 'url', 'module', 'worker_threads', 'perf_hooks', 'os']
});

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
console.log('vendor/ ONNX runtime assets copied');
