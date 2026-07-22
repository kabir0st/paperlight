# Privacy Policy — Paperlight

**Effective date:** 22 July 2026
**Applies to:** Paperlight (“PDF Dark Mode & Read Aloud”), Chrome extension, version 2.7.0 and later

## Summary

Paperlight has no backend. There is no account, no analytics, no telemetry, and
no server operated by the developer. The extension never transmits the contents
of your PDFs, your selected text, your browsing history, or any identifier
anywhere.

The only data that leaves your machine is the one-time download of the speech
model files from Hugging Face, and only if you choose the **Fluent** voice.

## What the extension stores, and where

All of it stays in your browser. None of it is readable by the developer.

| What | Where | Why |
|---|---|---|
| On/off state, theme, intensity | `chrome.storage.sync` | Remember your reading preferences |
| Voice choice, speaker, speed, volume | `chrome.storage.sync` | Remember your read-aloud preferences |
| “Voice downloaded” flags | `chrome.storage.local` | Show a *Ready* badge instead of a download size |
| Current reading status, active tab id | `chrome.storage.session` | Restore the progress card if the service worker restarts; cleared when Chrome closes |
| Speech model weights and speaker files | Cache API (`gentle-tts-assets`, `transformers-cache`) | So the voice downloads once and then works offline |

`chrome.storage.sync` is synchronised by **Chrome itself** across devices where
you are signed into the same Google account. That is a Chrome feature, governed
by [Google's Privacy Policy](https://policies.google.com/privacy); the extension
only writes the preference values listed above into it. If you are not signed
into Chrome, this data stays on the one device. Model weights are never synced —
they are per-device.

## Network connections

The extension makes exactly three kinds of outbound request. There are no
others.

| Request | When | What the other end sees |
|---|---|---|
| `huggingface.co` — model weights (~90 MB, one time) | First use of the **Fluent** voice | Your IP address and which file was requested. No text, no PDF, no identifier is sent. |
| `huggingface.co` — speaker style file (~0.5 MB) | First use of each speaker | Same as above |
| The PDF's own URL | Only when you use **Read this PDF aloud** | The server already hosting that PDF receives one additional request for it, from your browser as usual |

Hugging Face is the model host and is a third party; their handling of request
logs is covered by the [Hugging Face Privacy Policy](https://huggingface.co/privacy).
Once the files are cached, the extension works with the network off and makes no
further requests.

## The two voices

- **Fluent** runs the [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)
  model entirely inside your browser, on your CPU. Your text is turned into
  audio locally and is never transmitted.
- **Robot** hands your text to `chrome.tts`, Chrome's own speech API. Depending
  on your operating system and which system voice is selected, Chrome may
  synthesize that speech locally **or** through a network speech service. That
  behaviour belongs to Chrome and your OS, not to this extension, and is outside
  the developer's control. **If you want a guarantee that no text ever leaves
  your device, use the Fluent voice.**

## Permissions, and why each one exists

| Permission | Why it is needed |
|---|---|
| `storage` | Save the preferences listed above |
| Host access (`<all_urls>`) | PDFs can be served from any address, so the detection script must be allowed to load anywhere. It checks whether the document is a PDF and **exits immediately if it is not**. It does not read, collect, or transmit page content. |
| `contextMenus` | Add the right-click **Read aloud** item |
| `tts` | The Robot voice |
| `offscreen` | A hidden extension page that runs the Fluent voice and plays the audio |

The broad host permission is the part worth understanding: it is required
because Chrome cannot filter content scripts by document *type*, only by URL,
and a PDF may live at any URL. Selected text is read only at the moment you
explicitly choose **Read aloud**, and it travels only to the extension's own
offscreen page for synthesis.

## What the extension does not do

- No analytics, telemetry, crash reporting, or usage statistics
- No advertising, tracking pixels, fingerprinting, or cookies
- No collection of browsing history, page content, form data, or credentials
- No sale, sharing, or transfer of any data to anyone
- No remote code execution — all executable code ships inside the extension, as
  Manifest V3 requires

## Chrome Web Store data disclosures

For the store listing, Paperlight declares that it collects **none** of the
disclosure categories (personally identifiable information, health information,
financial information, authentication information, personal communications,
location, web history, or user activity), and it does not sell or transfer user
data, use it for anything unrelated to its single purpose, or use it to
determine creditworthiness.

## Deleting your data

- **Preferences:** remove the extension, or clear its data from
  `chrome://extensions` → Paperlight → *Details*.
- **Downloaded voice files:** removing the extension deletes its caches. You can
  also clear cached site data for the extension from Chrome's settings.

## Children

Paperlight is a document-reading utility, is not directed at children, and
collects no personal information from anyone.

## Changes

If this policy changes materially, the effective date above is updated and the
change appears in the repository's commit history, which serves as the public
revision record.

## Contact

Questions or concerns: open an issue at
<https://github.com/kabir0st/paperlight/issues>, or reach the developer via
<https://kabirtamari.com/>.
