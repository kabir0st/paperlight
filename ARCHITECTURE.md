# How Paperlight works

Implementation notes for anyone reading or modifying the code. The
[README](README.md) covers what the extension does; this covers how.

## Install from source

Most people should just [install from the Chrome Web Store](https://chromewebstore.google.com/detail/banana-gentle-pdf-color-c/nohjlbaknldmblndcecdimedeogfojfc).
To run the checkout instead:

```bash
git clone https://github.com/kabir0st/paperlight.git
```

1. Open `chrome://extensions` in Chrome
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** and pick the `paperlight` folder
4. Pin Paperlight from the puzzle-piece menu so it is one click away

Reading PDFs saved on your computer? Open the extension's details page and switch
on **Allow access to file URLs**.

## Permissions, and why

| Permission | Why |
|---|---|
| `storage` | Remember your theme, intensity, and voice |
| Host access (`<all_urls>`) | PDFs live at unpredictable URLs, so the detector has to be allowed to load anywhere. It exits immediately on anything that is not a PDF |
| `contextMenus` | The right-click **Read aloud** and **Start from here** items |
| `tts` | The Robot voice |
| `offscreen` | A hidden page that runs the Fluent voice and plays audio |

## Theming Chrome's PDF viewer

Chrome renders PDFs in an out-of-process viewer, which rules out most
page-styling tricks. Blend-mode overlays, `backdrop-filter`, and SVG filter
references cannot reach the viewer's pixels, and in current Chromium the viewer
is not even an element in the wrapper document (its `<body>` is empty), with
content scripts blocked from the inner plugin frame.

What does work, verified against the current out-of-process viewer, is applying
plain CSS `filter` functions to the wrapper document's `<html>` element, inside
which the viewer is composited.

- The content script runs in every page and frame, but exits immediately unless
  the document is a PDF (`document.contentType === 'application/pdf'`, or a PDF
  `<embed>` is present).
- On a PDF tab it filters the wrapper document's `<html>` element. For a PDF
  `<embed>` inside a normal web page it filters just that element, so the
  surrounding site is untouched.
- Chromium does not reliably apply manifest-declared content CSS to PDF wrapper
  documents, so the script injects its own `<style>` node and mirrors the filter
  as an inline style.
- Each theme is a combination of `sepia()`, `invert()`, `hue-rotate()`,
  `contrast()`, and `brightness()`, with the intensity value baked into the
  numbers.
- Because styling is only ever injected on PDF documents, regular websites are
  never touched.

## Read-aloud

- The **Robot** voice uses `chrome.tts` (your operating system's speech engine)
  straight from the service worker.
- The **Fluent** voice runs in an offscreen document that spawns a dedicated Web
  Worker for inference. Extension pages share one renderer thread, so running
  models on it would freeze the popup; the worker keeps everything responsive.
  Text is split into sentences, synthesized chunk by chunk by
  [transformers.js](https://github.com/huggingface/transformers.js) (ONNX
  Runtime WASM), and streamed into the Web Audio API. Sentence *n+1* is
  generated while sentence *n* plays, with about 30 seconds of audio buffered
  ahead as backpressure for long documents.
- **Whole-PDF reading** fetches the PDF bytes and extracts text page by page
  with [pdf.js](https://mozilla.github.io/pdf.js/). For the Robot voice, pages
  stream back to the service worker as queued `chrome.tts` utterances.
- **Start from here** reads from a selection to the end of the document.
  Chromium hands a context-menu selection over as bare text — no page number,
  no offsets, truncated at about a kilobyte — so the offscreen document has to
  search the extracted text for it. The two sides do not agree character for
  character (the viewer's copy resolves ligatures, joins hyphenated line
  breaks, and spaces things differently), so matching runs on a folded form:
  NFKD-decomposed, lowercased, reduced to letters and digits, with an index
  map back to the original text. Progressively shorter prefixes are tried, and
  a word-aligned hit is preferred so a short selection like "The" does not land
  inside "theory". Text repeated verbatim across pages resolves to the first
  copy, which is as far as a bare selection string can go.
- Model weights download from the Hugging Face Hub on first use and are stored
  in the browser's Cache API. Nothing is re-downloaded afterwards, and no text
  or audio ever leaves your machine. Kokoro's speakers are separate 0.5 MB style
  tensors, so switching speaker costs one small fetch rather than a model
  reload. Only the q8 export is ever loaded (`model_quantized.onnx`), so there
  is exactly one set of weights to download and track.
- **Pause** suspends the offscreen `AudioContext`. That freezes the scheduled
  playback tail and the backpressure loops with it, so synthesis stops too
  rather than racing ahead while you are paused. The Robot voice uses
  `chrome.tts.pause()`.

## In-page controls

- The launcher, settings panel, and activity card are a content script rendering
  into a shadow root, so no page stylesheet can reach them.
- Chromium applies a CSS `filter` to every descendant of the element it is set
  on, so an ordinary overlay would be inverted along with the page under the
  Dark theme. These render in the browser's top layer via the popover API, which
  is painted outside ancestor filter effects. Verified against Chrome's PDF
  viewer, where a top-layer element composites cleanly above the plugin.
- The settings panel is not a second copy of the popup. It embeds `popup.html`
  itself in an iframe (hence `web_accessible_resources`), so the popup logic
  runs unchanged and the two surfaces can never drift apart. The framed page
  reports its own height by `postMessage`, since a content script cannot read
  across the extension-origin boundary.

All executable code (the transformers.js bundle, ONNX Runtime WASM, pdf.js)
ships inside the extension, as Manifest V3 requires.

## Project structure

```
paperlight/
├── manifest.json    # Manifest V3 definition
├── content.js       # Detects PDFs, builds and injects the theme filters
├── hud.js           # In-page launcher, settings panel, activity card
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
│   ├── tts-common.js        # Asset caching + sentence splitting
│   └── vendor/phonemize.js  # Vendored from kokoro-js (Apache-2.0)
├── vendor/          # ONNX Runtime WASM + pdf.js worker (copied by build.mjs)
├── build.mjs        # esbuild bundling script (npm run build)
└── images/          # Toolbar icons and logo
```

`offscreen.js` and `tts-worker.js` at the repo root are build outputs. Edit the
sources under `src/` and rebuild:

```bash
npm install
npm run build
```

Both bundles and `vendor/` are committed, so a plain load-unpacked install works
without Node installed.

## Internal naming

Message types and DOM ids still use a `gentle-` prefix (`gentle-ping`,
`gentle-hud`, `gentle-panel-height`, `gentle-page-pdf-hud`), left over from the
extension's former name. They are an internal namespace only, never shown to
users, and renaming them means changing senders and listeners across files in
lockstep.
