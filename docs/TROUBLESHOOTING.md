# Paperlight — if something goes wrong

Fixes for the things people actually hit. For what the extension does, see the
[README](../README.md); for how it works inside, see
[ARCHITECTURE.md](../ARCHITECTURE.md).

| Symptom | Fix |
|---|---|
| Nothing happens on a PDF | Refresh the tab once after installing or updating |
| Nothing happens on a local file | Turn on *Allow access to file URLs* in the extension's details |
| Popup says "Open a PDF to see the effect" | The current tab is not a PDF. Paperlight only acts on PDFs |
| Settings do not sync between machines | Sign into Chrome. Downloaded voices stay per-machine either way |
| "Read aloud" missing from the right-click menu | It only appears when text is selected. Reload the extension after updating |
| Read aloud stops with an audio error | The browser suspended playback. Press Stop, then start again |
| Read aloud does nothing on a PDF | The pages are probably scans, so there is no text to read. If you cannot select the text by hand, neither can Paperlight |
| Your speaker or the engine picker vanished | Version 2.7.0 removed the experimental WebGPU engine and narrowed the speaker list to four. Updating moves you to Nicole and reclaims the unused download |

## Known limits

- Depending on your Chrome version, the viewer's own toolbar may pick up the
  tint. On current Chromium it stays native.
- Images are filtered along with the page. Dark mode rotates hues after
  inverting to keep colors roughly right, but photos will not be pixel-perfect.
- Sites with their own JavaScript PDF readers are not Chrome's viewer, so they
  are unaffected.
- Fluent speaks English only, American and British. It runs on the CPU, so it
  works everywhere, just slower on older machines.
- The Robot voice is only as good as your operating system's speech engine. On
  Linux that is usually espeak-ng, which is very robotic.
- Needs Chrome 116 or newer for read aloud.
