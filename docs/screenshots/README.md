# Screenshots

The README references six images from this folder. Until they exist, GitHub
shows broken-image icons in their place, so this is worth 15 minutes.

Save each as PNG, with exactly these filenames.

| File | What to capture | Suggested width |
|---|---|---|
| `hero.png` | A full Chrome window showing a real PDF with the **Dark** theme on. This is the first thing anyone sees, so pick a good-looking document | 1600 px |
| `theme-paper.png` | The same PDF page, Paper theme, cropped to just the page content | 800 px |
| `theme-sepia.png` | The same page and crop, Sepia theme | 800 px |
| `theme-dark.png` | The same page and crop, Dark theme | 800 px |
| `popup.png` | The toolbar popup, opened on a PDF tab, with **Voice options** expanded so the speaker and speed controls are visible | 600 px |
| `reading.png` | The in-page card mid-sentence, showing the progress detail and the Pause / Stop buttons | 600 px |

## Getting them consistent

The three theme shots only work as a comparison if they line up, so use the
**same PDF, same page, same scroll position, same crop** for all three. Change
only the theme between captures. Keep the intensity slider at its default 80%.

For `popup.png`, pick the **Fluent** voice first so the speaker dropdown and
speed slider are actually on screen. Capturing it after the voice has finished
downloading is better, since the row then reads a green **Ready** instead of a
download size.

For `reading.png`, start a whole-PDF read and capture while it is a few
sentences in, so the card shows something like `page 3 of 40 - sentence 2/7`.

## Practical notes

- Capture at 2x device pixel ratio if you can, then export at the widths above.
  Scaled-down screenshots look far sharper than native-resolution ones.
- Crop out your bookmarks bar, tab strip, and any personal URLs or filenames.
- A PDF with figures shows off what Dark mode does to images, which is one of
  the harder things the extension gets right.
- Keep each file under about 500 KB so the README stays quick to load.
  `pngquant` or `oxipng` will get you most of the way there.

## Reusing these for the Chrome Web Store

The store listing wants screenshots at exactly **1280x800** or **640x400**, so
`hero.png` is worth capturing at 1280x800 from the start. The store also takes a
440x280 small promo tile, which the logo on a paper-cream background fills
nicely.
