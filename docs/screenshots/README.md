# Screenshots

The six PNGs here are referenced by the main [README](../../README.md). They are
generated, not hand-captured, so they stay in step with the code.

| File | What it shows | Size |
|---|---|---|
| `hero.png` | A real PDF under the Dark theme | 1280x800 |
| `theme-paper.png` | Same page, Paper theme | 918x645 |
| `theme-sepia.png` | Same page, Sepia theme | 918x645 |
| `theme-dark.png` | Same page, Dark theme | 918x645 |
| `popup.png` | The toolbar popup, Voice options expanded | 600x1280 |
| `reading.png` | The in-page card mid-sentence | 576x210 |

`hero.png` is deliberately 1280x800, which is exactly the Chrome Web Store
screenshot size, so it doubles as the store asset.

## Regenerating

```bash
npm install --no-save puppeteer-core
node tools/capture-screenshots.mjs path/to/document.pdf
```

The script needs a Chromium-based browser. It looks for Brave, Chrome, then
Chromium, and `BROWSER=/path/to/binary` overrides that.

If you omit the PDF argument it falls back to `docs/screenshots/sample.pdf`,
which is gitignored. **Supply a document you are happy to publish.** These
images go into a public README, so do not point it at anything personal. A paper
with figures works best, since it shows what Dark mode does to images.

## How faithful are they

- `popup.png` and `reading.png` are captured from the **real extension**, loaded
  unpacked into the browser. The popup is the actual `popup.html` running with
  real `chrome.*` APIs, and the card is drawn by `hud.js` in response to the
  same `gentle-hud` message the service worker sends during a real reading.
- The theme shots render a real PDF with pdf.js and then apply the filter string
  produced by `filterFor()`, which the script reads out of `content.js` at
  runtime rather than copying. Change a theme's numbers and the screenshots
  follow on the next run.
- The one difference from a live browser: these render the PDF to a canvas
  rather than going through Chrome's built-in PDF viewer, so the viewer's own
  toolbar is not in frame. The colors and the filter maths are identical.
