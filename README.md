# Gentle Page PDF

A Chrome extension that makes PDFs comfortable to read. It applies gentle color filters to Chrome's built-in PDF viewer — softening the harsh white background into paper-like tones, or flipping the page into a proper dark mode — with an intensity slider to dial the effect in. It can also **read your PDFs aloud**, with a choice of three voices that run entirely on your machine — no cloud APIs.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=google-chrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?logo=google-chrome&logoColor=white)

## Features

- **Three reading themes**
  - **Paper** — a soft cream tint with slightly lifted blacks
  - **Sepia** — a warmer, old-book tone
  - **Dark** — white pages become charcoal, ink becomes off-white (image colors stay close to correct)
- **Intensity slider** — scale any theme from barely-there to full strength
- **Instant** — changes apply live to open PDFs, no reload needed
- **PDF-only by design** — the extension activates only on PDF documents and never touches normal websites
- **Read aloud (local TTS)** — select text, right-click → *Read aloud*. Three voices:
  - **Robot** — the system voice via `chrome.tts`. No download, quality depends on your OS.
  - **Fluent** — [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), a small neural TTS model. **~90 MB** one-time download, runs on CPU (WASM) or WebGPU.
  - **Natural** — [Chatterbox](https://huggingface.co/onnx-community/chatterbox-ONNX) (0.5B), near-human quality. **~1.4 GB** one-time download, **requires WebGPU**.
  - Model downloads are cached (Cache API), so each AI voice downloads once and then works offline. The popup shows download size, live progress, and a Ready badge per voice.
- **Synced settings** — preferences are saved with `chrome.storage.sync` and follow your Chrome profile

## Installation

1. Clone or download this repository
   ```bash
   git clone https://github.com/kabir0st/Banana-Gentle-PDF.git
   ```
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `Banana-Gentle-PDF` folder
5. (Optional) Pin **Gentle Page PDF** from the puzzle-piece menu

> **Local PDFs:** to use the extension on `file://` PDFs, open the extension's details page and enable **Allow access to file URLs**.

## Usage

1. Open any PDF in Chrome
2. Click the Gentle Page PDF icon
3. Flip the switch on — the popup also tells you whether the current tab is a PDF
4. Pick a theme (Paper / Sepia / Dark) and adjust the intensity

Settings apply immediately and persist across sessions.

### Read aloud

1. Pick a voice in the popup's **Read aloud** section (Robot / Fluent / Natural — download size is shown per voice)
2. Click **Test voice** to hear it (AI voices download and cache on first use, with a progress bar)
3. Select text in any PDF (or web page), right-click → **Read aloud**
4. **Stop** in the popup halts playback

## How it works

Chrome renders PDFs in an out-of-process viewer, which rules out most page-styling tricks: blend-mode overlays, `backdrop-filter`, and SVG filter references can't reach the viewer's pixels, and in current Chromium the viewer isn't even an element in the wrapper document (its `<body>` is empty), with content scripts blocked from the inner plugin frame. What does work — verified against the current out-of-process viewer — is applying plain CSS `filter` functions to the wrapper document's `<html>` element, inside which the viewer is composited:

- The content script runs in every page and frame but immediately exits unless the document is a PDF (`document.contentType === 'application/pdf'` or a PDF `<embed>` is present).
- On a PDF tab it filters the wrapper document's `<html>` element; for a PDF `<embed>` inside a normal web page it filters just that element, so the surrounding site is untouched.
- Chromium doesn't reliably apply manifest-declared content CSS to PDF wrapper documents, so the script injects its own `<style>` node and mirrors the filter as an inline style.
- Each theme is a combination of `sepia()`, `invert()`, `hue-rotate()`, `contrast()`, and `brightness()` filters, with the intensity value baked into the numbers.
- Because styling is only ever injected on PDF documents, regular websites are never touched.

### How read-aloud works

- The **Robot** voice uses `chrome.tts` (your operating system's speech engine) straight from the service worker.
- The AI voices run in an **offscreen document**: text is split into sentences, synthesized chunk-by-chunk by [transformers.js](https://github.com/huggingface/transformers.js) (ONNX Runtime WASM/WebGPU), and streamed into the Web Audio API. Sentence *n+1* is generated while sentence *n* plays.
- Model weights download from the Hugging Face Hub on first use and are stored in the browser's Cache API — nothing is re-downloaded afterwards, and no text or audio ever leaves your machine.
- All executable code (transformers.js bundle, ONNX Runtime WASM) ships inside the extension, as Manifest V3 requires.

### Project structure

```
Banana-Gentle-PDF/
├── manifest.json    # Manifest V3 definition
├── content.js       # Detects PDFs, builds and injects the theme filters
├── popup.html/css/js# Popup UI: themes, intensity, voice picker
├── background.js    # Defaults, context menu, robot voice, offscreen lifecycle
├── offscreen.html   # Offscreen document hosting the AI voices
├── offscreen.js     # BUILT bundle (transformers.js + engines) — see build.mjs
├── src/             # Source for the offscreen bundle
│   ├── offscreen-main.js    # Message handling, playback queue, progress
│   ├── kokoro-engine.js     # "Fluent" voice (Kokoro-82M)
│   ├── chatterbox-engine.js # "Natural" voice (Chatterbox 0.5B, WebGPU)
│   ├── tts-common.js        # Caching, audio decode, sentence splitting
│   └── vendor/phonemize.js  # Vendored from kokoro-js (Apache-2.0)
├── vendor/          # ONNX Runtime WASM assets (copied by build.mjs)
├── build.mjs        # esbuild bundling script (npm run build)
└── images/          # Toolbar icons and logo
```

Rebuilding after changing `src/`: `npm install && npm run build` (the built
`offscreen.js` and `vendor/` are committed, so plain load-unpacked works
without Node).

### Permissions

| Permission | Why |
|---|---|
| `storage` | Save and sync your theme, intensity, and voice preferences |
| Host access (`<all_urls>`) | PDFs can live at any URL; the content script needs to load everywhere to detect them (it exits immediately on non-PDF pages) |
| `contextMenus` | The right-click **Read aloud** item on selected text |
| `tts` | The Robot voice (system speech engine) |
| `offscreen` | A hidden extension page that runs the AI voices and plays audio |

## Limitations

- Depending on the Chrome version, the viewer toolbar may be tinted along with the page (on current Chromium the toolbar stays native).
- Images inside PDFs are filtered along with everything else. Dark mode uses `hue-rotate(180deg)` after inversion to keep image colors approximately correct, but photos will not look pixel-perfect.
- Sites that embed their own JavaScript PDF viewers (e.g., PDF.js-based readers that draw to a `<canvas>`) are not Chrome's native viewer and are unaffected.
- The AI voices are English-focused. The **Natural** voice needs WebGPU (on Linux this may require enabling `chrome://flags/#enable-unsafe-webgpu` or an up-to-date GPU driver); the popup greys it out when no GPU adapter is available. The **Fluent** voice runs anywhere, but synthesis is slower on old CPUs.
- The Robot voice's quality depends on your OS speech engine — on Linux it is typically espeak-ng (very robotic).
- Works in Chrome and Chromium-based browsers with Manifest V3 (Chrome 116+ for the read-aloud feature, which uses the Offscreen API).

## Troubleshooting

- **Nothing happens on a PDF** — refresh the tab once after installing or updating the extension (content scripts only attach on page load).
- **Nothing happens on a local file** — enable *Allow access to file URLs* in the extension's details.
- **Popup says "Open a PDF to see the effect"** — the current tab isn't a PDF document; the extension only acts on PDFs.
- **Settings don't sync between machines** — sign into Chrome so `chrome.storage.sync` can sync. (Downloaded voice models are per-machine.)
- **"Read aloud" is missing from the right-click menu** — it only appears when text is selected; reload the extension after updating.
- **Natural voice errors immediately** — your browser has no usable WebGPU adapter. Use Fluent, or enable WebGPU.

## License

Open source — use, modify, and distribute freely.

## Author

Created by [kabir0st](https://kabir0st.info/)
