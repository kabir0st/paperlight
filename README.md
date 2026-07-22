# Gentle Page PDF

A Chrome extension that makes PDFs comfortable to read. It applies gentle color filters to Chrome's built-in PDF viewer — softening the harsh white background into paper-like tones, or flipping the page into a proper dark mode — with an intensity slider to dial the effect in.

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

## How it works

Chrome renders PDFs in an out-of-process plugin, which rules out most page-styling tricks (blend-mode overlays and SVG filter references can't reach the plugin's pixels). What does work — and what this extension does — is applying plain CSS `filter` functions directly to the PDF `<embed>` element:

- The content script runs on every page but immediately exits unless the document is a PDF (`document.contentType === 'application/pdf'` or a PDF `<embed>` is present).
- On PDF pages it sets `data-gentle-theme="paper|sepia|dark"` and a `--gentle-intensity` custom property on `<html>`.
- `styles.css` contains only rules scoped to `html[data-gentle-theme]`, so no styling can ever leak onto regular websites.
- Each theme is a combination of `sepia()`, `invert()`, `hue-rotate()`, `contrast()`, and `brightness()` filters, scaled by the intensity value via `calc()`.

### Project structure

```
Banana-Gentle-PDF/
├── manifest.json    # Manifest V3 definition
├── content.js       # Detects PDFs, applies theme attribute + intensity
├── styles.css       # The three theme filters (scoped to PDF pages only)
├── popup.html       # Popup UI
├── popup.css        # Popup styling
├── popup.js         # Settings read/write, PDF status check
├── background.js    # Fills in default settings on install
└── images/          # Toolbar icons and logo
```

### Permissions

| Permission | Why |
|---|---|
| `storage` | Save and sync your theme, intensity, and on/off preference |
| Host access (`<all_urls>`) | PDFs can live at any URL; the content script needs to load everywhere to detect them (it exits immediately on non-PDF pages) |

## Limitations

- The filter applies to Chrome's whole PDF viewer, so the viewer toolbar is tinted along with the page.
- Images inside PDFs are filtered along with everything else. Dark mode uses `hue-rotate(180deg)` after inversion to keep image colors approximately correct, but photos will not look pixel-perfect.
- Sites that embed their own JavaScript PDF viewers (e.g., PDF.js-based readers that draw to a `<canvas>`) are not Chrome's native viewer and are unaffected.
- Works in Chrome and Chromium-based browsers with Manifest V3 (Chrome 88+).

## Troubleshooting

- **Nothing happens on a PDF** — refresh the tab once after installing or updating the extension (content scripts only attach on page load).
- **Nothing happens on a local file** — enable *Allow access to file URLs* in the extension's details.
- **Popup says "Open a PDF to see the effect"** — the current tab isn't a PDF document; the extension only acts on PDFs.
- **Settings don't sync between machines** — sign into Chrome so `chrome.storage.sync` can sync.

## License

Open source — use, modify, and distribute freely.

## Author

Created by [kabir0st](https://kabir0st.info/)
