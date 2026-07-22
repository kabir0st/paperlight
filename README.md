# Gentle Page PDF

A Chrome extension that makes PDFs comfortable to read. It applies gentle color filters to Chrome's built-in PDF viewer — softening the harsh white background into paper-like tones, or flipping the page into a proper dark mode — with an intensity slider to dial the effect in. It can also **read your PDFs aloud**, using voices that run entirely on your machine — no cloud APIs.

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
- **Read aloud (local TTS)** — select text and right-click → *Read aloud*, or read the **whole PDF** from any page (popup button or right-click → *Read this PDF aloud*). Two voices:
  - **Robot** — the system voice via `chrome.tts`. No download, quality depends on your OS.
  - **Fluent** — [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), a small neural TTS model with 28 English speakers. **~90 MB** one-time download on CPU (WASM); the optional WebGPU engine is faster but loads full-precision weights (~310 MB).
  - Model downloads are cached (Cache API), so the AI voice downloads once and then works offline. The popup shows download size, live progress, and a Ready badge per voice; the toolbar icon shows a badge (`42%` downloading, `…` generating, `▶` speaking, `⏸` paused) so you get feedback even with the popup closed.
  - Inference runs in a dedicated Web Worker, so the browser and popup stay fully responsive while downloading and speaking.
- **In-page player** — Chrome closes the popup the moment you click the page, so read-aloud progress also appears in a small card docked in the corner of the tab you're reading, with **Pause** and **Stop**. It follows the Dark theme and disappears a moment after the reading ends.
- **Voice options** (popup → *Voice options*) — pick any of Kokoro's 28 English speakers (American/British, female/male), set the speaking speed from 0.5× to 2×, choose CPU or WebGPU for the Fluent voice, and set the playback volume.
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

1. Pick a voice in the popup's **Read aloud** section (Robot / Fluent — download size is shown per voice)
2. Click **Test voice** to hear it (AI voices download and cache on first use, with a progress bar)
3. Select text in any PDF (or web page), right-click → **Read aloud**
4. Or read the whole document: on a PDF tab the popup shows **Read this PDF** with a *from page* field (also available as right-click → **Read this PDF aloud**)
5. Once reading starts, a small player appears in the corner of the page with **Pause** and **Stop** — it stays put when you click away, unlike the popup. The same controls are in the popup, and the toolbar badge shows what's happening at any time.
6. Open **Voice options** in the popup to change the Fluent speaker, speed, engine (CPU/WebGPU), and volume. Speed and volume apply to the reading already in progress.

## How it works

Chrome renders PDFs in an out-of-process viewer, which rules out most page-styling tricks: blend-mode overlays, `backdrop-filter`, and SVG filter references can't reach the viewer's pixels, and in current Chromium the viewer isn't even an element in the wrapper document (its `<body>` is empty), with content scripts blocked from the inner plugin frame. What does work — verified against the current out-of-process viewer — is applying plain CSS `filter` functions to the wrapper document's `<html>` element, inside which the viewer is composited:

- The content script runs in every page and frame but immediately exits unless the document is a PDF (`document.contentType === 'application/pdf'` or a PDF `<embed>` is present).
- On a PDF tab it filters the wrapper document's `<html>` element; for a PDF `<embed>` inside a normal web page it filters just that element, so the surrounding site is untouched.
- Chromium doesn't reliably apply manifest-declared content CSS to PDF wrapper documents, so the script injects its own `<style>` node and mirrors the filter as an inline style.
- Each theme is a combination of `sepia()`, `invert()`, `hue-rotate()`, `contrast()`, and `brightness()` filters, with the intensity value baked into the numbers.
- Because styling is only ever injected on PDF documents, regular websites are never touched.

### How read-aloud works

- The **Robot** voice uses `chrome.tts` (your operating system's speech engine) straight from the service worker.
- The Fluent voice runs in an **offscreen document** that spawns a **dedicated Web Worker** for inference — extension pages share one renderer thread, so running models on it would freeze the popup; the worker keeps everything responsive. Text is split into sentences, synthesized chunk-by-chunk by [transformers.js](https://github.com/huggingface/transformers.js) (ONNX Runtime WASM/WebGPU), and streamed into the Web Audio API — sentence *n+1* is generated while sentence *n* plays, with ~30 s of audio buffered ahead as backpressure for long documents.
- **Whole-PDF reading** fetches the PDF bytes and extracts text page-by-page with [pdf.js](https://mozilla.github.io/pdf.js/); for the Robot voice, pages stream to `chrome.tts` as queued utterances.
- Model weights download from the Hugging Face Hub on first use and are stored in the browser's Cache API — nothing is re-downloaded afterwards, and no text or audio ever leaves your machine. Kokoro's speakers are separate ~0.5 MB style tensors, so switching speaker costs one small fetch, not a model reload; the WebGPU engine loads full-precision weights (~310 MB) rather than the CPU build's quantized ones (~90 MB), so the two are tracked as separate downloads.
- The **in-page player** is a content script that stays inert until the service worker sends it a status update. Chromium applies a CSS `filter` to every descendant of the element it is set on, so an ordinary overlay would be inverted along with the page under the Dark theme; the player instead renders in the browser's **top layer** (the popover API), which is painted outside ancestor filter effects, inside a shadow root so no page stylesheet can reach it.
- **Pause** suspends the offscreen `AudioContext`, which freezes the scheduled playback tail and the backpressure loops with it — so synthesis stops too, rather than racing ahead while you're paused. The Robot voice uses `chrome.tts.pause()`.
- All executable code (transformers.js bundle, ONNX Runtime WASM, pdf.js) ships inside the extension, as Manifest V3 requires.

### Project structure

```
Banana-Gentle-PDF/
├── manifest.json    # Manifest V3 definition
├── content.js       # Detects PDFs, builds and injects the theme filters
├── hud.js           # In-page read-aloud player (top layer + shadow DOM)
├── popup.html/css/js# Popup UI: themes, intensity, voice picker, voice options
├── background.js    # Defaults, context menu, robot voice, offscreen lifecycle,
│                    # status fan-out to popup + badge + HUD
├── offscreen.html   # Offscreen document hosting playback + PDF extraction
├── offscreen.js     # BUILT coordinator bundle (pdf.js, playback, worker mgmt)
├── tts-worker.js    # BUILT inference worker bundle (transformers.js + engines)
├── src/             # Sources for the built bundles
│   ├── offscreen-main.js    # Playback queue, pdf.js extraction, statuses
│   ├── tts-worker.js        # Inference worker: model download + synthesis
│   ├── kokoro-engine.js     # "Fluent" voice (Kokoro-82M)
│   ├── kokoro-voices.js     # Speaker list, shared by the engine and popup
│   ├── tts-common.js        # Caching, audio decode, sentence splitting
│   └── vendor/phonemize.js  # Vendored from kokoro-js (Apache-2.0)
├── vendor/          # ONNX Runtime WASM + pdf.js worker (copied by build.mjs)
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
| Host access (`<all_urls>`) | PDFs can live at any URL; the content scripts need to load everywhere to detect them (the theming one exits immediately on non-PDF pages, and the player stays inert until something is being read) |
| `contextMenus` | The right-click **Read aloud** item on selected text |
| `tts` | The Robot voice (system speech engine) |
| `offscreen` | A hidden extension page that runs the AI voices and plays audio |

## Limitations

- Depending on the Chrome version, the viewer toolbar may be tinted along with the page (on current Chromium the toolbar stays native).
- Images inside PDFs are filtered along with everything else. Dark mode uses `hue-rotate(180deg)` after inversion to keep image colors approximately correct, but photos will not look pixel-perfect.
- Sites that embed their own JavaScript PDF viewers (e.g., PDF.js-based readers that draw to a `<canvas>`) are not Chrome's native viewer and are unaffected.
- The **Fluent** voice is English-only (American and British), and runs anywhere — synthesis is just slower on old CPUs. Its optional WebGPU engine needs a usable GPU adapter (on Linux that may mean `chrome://flags/#enable-unsafe-webgpu` or an up-to-date driver); the popup greys the option out when there is none.
- The Robot voice's quality depends on your OS speech engine — on Linux it is typically espeak-ng (very robotic).
- Works in Chrome and Chromium-based browsers with Manifest V3 (Chrome 116+ for the read-aloud feature, which uses the Offscreen API).

## Troubleshooting

- **Nothing happens on a PDF** — refresh the tab once after installing or updating the extension (content scripts only attach on page load).
- **Nothing happens on a local file** — enable *Allow access to file URLs* in the extension's details.
- **Popup says "Open a PDF to see the effect"** — the current tab isn't a PDF document; the extension only acts on PDFs.
- **Settings don't sync between machines** — sign into Chrome so `chrome.storage.sync` can sync. (Downloaded voice models are per-machine.)
- **"Read aloud" is missing from the right-click menu** — it only appears when text is selected; reload the extension after updating.
- **Read aloud stops with an audio error** — the browser blocked or suspended playback. Press Stop and start the reading again.
- **A "Natural" voice used to be here** — Chatterbox (0.5B, ~1.4 GB, WebGPU-only) was removed in 2.4.0: it was a multi-gigabyte download that could stall the browser. Updating evicts its cached weights and moves you to Fluent.

## License

Open source — use, modify, and distribute freely.

## Author

Created by [kabir0st](https://kabir0st.info/)
