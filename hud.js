// Paperlight in-page controls.
//
// Chrome closes the toolbar popup the moment focus leaves it, so everything it
// offers is also reachable from the page itself:
//   - a small launcher button on PDF tabs,
//   - which opens the full settings panel (the popup page embedded: one
//     implementation, not a copy),
//   - plus an activity card with Pause/Stop whenever something is being read.
//
// Filter caveat: the theming content script applies a CSS `filter` to <html>
// (or to the PDF <embed>), and a filter applies to every descendant, so a plain
// overlay would come out inverted under the Dark theme. This lives in the
// browser's top layer via the popover API, which is painted outside ancestor
// filter effects. Verified against Chrome's PDF viewer: both a top-layer
// element and the viewer plugin composite correctly, overlay on top.

const HOST_ID = 'gentle-page-pdf-hud';
const VOICE_LABELS = { robot: 'Robot', fluent: 'Fluent' };
const IDLE_HIDE_MS = 2500;
const PANEL_WIDTH = 318; // popup body (300) plus room for its scrollbar

const supportsPopover = typeof HTMLElement.prototype.showPopover === 'function';
const EXTENSION_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');

let host = null;
let ui = null;
let shown = false;
let panelOpen = false;
let hideTimer = null;
let cardDismissed = false;
let cardWanted = false;
let currentState = null;

// Only PDF documents get the launcher; the activity card can appear anywhere,
// since "Read aloud" works on selected text in any page.
function isPdf() {
    return (
        document.contentType === 'application/pdf' ||
        !!document.querySelector(
            'embed[type="application/pdf"], embed[type="application/x-google-chrome-pdf"]'
        )
    );
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, sans-serif;
}

/* Launcher */
.launcher {
  width: 42px; height: 42px; padding: 0;
  border: 1px solid #e7e4dc; border-radius: 50%;
  background: #faf9f6; color: #2b2a26;
  box-shadow: 0 4px 14px rgba(43, 42, 38, 0.22);
  cursor: pointer; opacity: 0.45;
  display: flex; align-items: center; justify-content: center;
  transition: opacity 150ms ease, transform 150ms ease;
}
.launcher:hover, .launcher:focus-visible { opacity: 1; transform: translateY(-1px); }
.launcher svg { width: 20px; height: 20px; }
.launcher[hidden], .card[hidden], .panel[hidden] { display: none; }

/* Settings panel, the popup page itself, embedded */
.panel {
  width: ${PANEL_WIDTH}px;
  border-radius: 12px;
  background: #faf9f6;
  box-shadow: 0 10px 34px rgba(43, 42, 38, 0.3);
  overflow: hidden;
}
.panel-bar {
  display: flex; justify-content: flex-end; align-items: center;
  height: 26px; padding: 0 6px; background: #f1efe8; border-bottom: 1px solid #e7e4dc;
}
.panel iframe { display: block; width: 100%; height: 560px; border: 0; background: #faf9f6; }

/* Activity card */
.card {
  width: 288px; padding: 12px 14px;
  border: 1px solid #e7e4dc; border-radius: 12px;
  background: #faf9f6; color: #2b2a26;
  box-shadow: 0 6px 24px rgba(43, 42, 38, 0.18);
}
.top { display: flex; align-items: flex-start; gap: 9px; }
.dot {
  width: 8px; height: 8px; margin-top: 4px; border-radius: 50%;
  background: #3e7b4f; flex: none; animation: pulse 1.6s ease-in-out infinite;
}
.dot.still { animation: none; }
.dot.bad { background: #a4442f; animation: none; }
@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none } .launcher { transition: none } }
.text { flex: 1; min-width: 0; }
.phase { font-weight: 600; }
.detail {
  margin-top: 2px; color: #75705f; font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.detail:empty { display: none; }
/* Live transcript of the sentence being spoken, three lines visible,
   scrolled so the highlighted word stays in view. */
.sentence {
  margin-top: 8px; font-size: 12px; line-height: 1.5; color: #4a463c;
  max-height: 54px; overflow: hidden; scroll-behavior: smooth;
  overflow-wrap: break-word;
}
.sentence:empty { display: none; }
.sentence .w { border-radius: 3px; padding: 0 1px; }
.sentence .w.on { background: #2b2a26; color: #faf9f6; }
/* Generation activity: the dot pulses while workers synthesize ahead. */
.genline {
  display: flex; align-items: center; gap: 6px;
  margin-top: 7px; color: #75705f; font-size: 11px;
}
.genline[hidden] { display: none; }
.gendot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: #b3ad9e; }
.gendot.live { background: #3e7b4f; animation: pulse 1.2s ease-in-out infinite; }
.icon-btn {
  flex: none; width: 20px; height: 20px; padding: 0; margin-top: -2px;
  border: 0; border-radius: 5px; background: transparent; color: #75705f;
  font-size: 13px; line-height: 1; cursor: pointer;
}
.icon-btn:hover { background: #efece4; color: #2b2a26; }
.track { margin-top: 9px; height: 5px; border-radius: 3px; background: #e7e4dc; overflow: hidden; }
.track[hidden] { display: none; }
.fill { height: 100%; width: 0; background: #2b2a26; transition: width 200ms ease; }
.actions { display: flex; gap: 8px; margin-top: 11px; }
.btn {
  flex: 1; padding: 6px 10px; border: 1px solid #e7e4dc; border-radius: 7px;
  background: #ffffff; color: #2b2a26; font: inherit; font-size: 12px; cursor: pointer;
}
.btn:hover { border-color: #cfcabc; }
.btn.primary { background: #2b2a26; border-color: #2b2a26; color: #faf9f6; }
.btn.primary:hover { background: #3c3a34; }
.actions[hidden], .btn[hidden] { display: none; }

/* Follow the reading theme, a cream card glares on a dark page. */
.dark .launcher, .dark .card {
  border-color: #3a3934; background: #232323; color: #e8e4dc;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
}
.dark .panel { box-shadow: 0 10px 34px rgba(0, 0, 0, 0.6); }
.dark .detail, .dark .icon-btn { color: #a09a8c; }
.dark .sentence { color: #c9c4b8; }
.dark .sentence .w.on { background: #e8e4dc; color: #232323; }
.dark .genline { color: #a09a8c; }
.dark .gendot { background: #575550; }
.dark .icon-btn:hover { background: #33322e; color: #e8e4dc; }
.dark .track { background: #3a3934; }
.dark .fill { background: #e8e4dc; }
.dark .btn { border-color: #3a3934; background: #2c2b28; color: #e8e4dc; }
.dark .btn:hover { border-color: #575550; }
.dark .btn.primary { background: #e8e4dc; border-color: #e8e4dc; color: #232323; }
`;

const LAUNCHER_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/>' +
    '<path d="M14.5 8.5a4 4 0 0 1 0 7"/><path d="M17.5 6a7 7 0 0 1 0 12"/></svg>';

function build() {
    if (host && host.isConnected) return;

    host = document.createElement('div');
    host.id = HOST_ID;
    if (supportsPopover) host.setAttribute('popover', 'manual');

    // Inline + !important so no page stylesheet can move or restyle the host.
    // `display` is deliberately left alone: the UA controls it for popovers.
    const hostStyle = {
        position: 'fixed', inset: 'auto 16px 16px auto', width: 'auto', height: 'auto',
        margin: '0', padding: '0', border: '0', background: 'transparent',
        overflow: 'visible', 'z-index': '2147483647', 'color-scheme': 'light'
    };
    for (const [prop, value] of Object.entries(hostStyle)) {
        host.style.setProperty(prop, value, 'important');
    }
    if (!supportsPopover) host.style.setProperty('display', 'none', 'important');

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="panel" hidden>
        <div class="panel-bar"><button class="icon-btn close-panel" type="button" title="Close" aria-label="Close">✕</button></div>
      </div>
      <div class="card" hidden>
        <div class="top">
          <span class="dot"></span>
          <div class="text"><div class="phase"></div><div class="detail"></div></div>
          <button class="icon-btn open-settings" type="button" title="Settings" aria-label="Settings">⚙</button>
          <button class="icon-btn close-card" type="button" title="Hide" aria-label="Hide">✕</button>
        </div>
        <div class="sentence"></div>
        <div class="genline" hidden><span class="gendot"></span><span class="gentext"></span></div>
        <div class="track" hidden><div class="fill"></div></div>
        <div class="actions">
          <button class="btn toggle" type="button">Pause</button>
          <button class="btn primary stop" type="button">Stop</button>
        </div>
      </div>
      <button class="launcher" type="button" title="Paperlight" aria-label="Paperlight" hidden>
        ${LAUNCHER_ICON}
      </button>`;

    root.append(style, wrap);
    (document.body || document.documentElement).appendChild(host);

    ui = {
        wrap,
        panel: wrap.querySelector('.panel'),
        launcher: wrap.querySelector('.launcher'),
        card: wrap.querySelector('.card'),
        dot: wrap.querySelector('.dot'),
        phase: wrap.querySelector('.phase'),
        detail: wrap.querySelector('.detail'),
        sentence: wrap.querySelector('.sentence'),
        genline: wrap.querySelector('.genline'),
        gendot: wrap.querySelector('.gendot'),
        gentext: wrap.querySelector('.gentext'),
        track: wrap.querySelector('.track'),
        fill: wrap.querySelector('.fill'),
        actions: wrap.querySelector('.actions'),
        toggle: wrap.querySelector('.toggle'),
        stop: wrap.querySelector('.stop')
    };

    wrap.querySelector('.close-card').addEventListener('click', () => {
        cardDismissed = true;
        cardWanted = false;
        refreshVisibility();
    });
    wrap.querySelector('.close-panel').addEventListener('click', () => setPanel(false));
    wrap.querySelector('.open-settings').addEventListener('click', () => setPanel(true));
    ui.launcher.addEventListener('click', () => setPanel(!panelOpen));
    ui.stop.addEventListener('click', () => send('stop'));
    ui.toggle.addEventListener('click', () => send(currentState?.paused ? 'resume' : 'pause'));
}

// Every call is guarded: after an extension reload the old content script is
// orphaned and messaging throws synchronously.
function send(cmd) {
    try {
        return chrome.runtime.sendMessage({ target: 'tts-bg', cmd }).catch(() => {});
    } catch {
        return Promise.resolve();
    }
}

// The panel is the popup page itself, loaded on first open so an unopened
// panel costs nothing.
function setPanel(open) {
    build();
    panelOpen = open;
    if (open && !ui.panel.querySelector('iframe')) {
        const frame = document.createElement('iframe');
        frame.src = chrome.runtime.getURL('popup.html');
        frame.title = 'Paperlight settings';
        ui.panel.appendChild(frame);
    }
    ui.panel.hidden = !open;
    refreshVisibility();
}

// The launcher belongs to PDF tabs; the card appears wherever a reading is.
function refreshVisibility() {
    build(); // idempotent, and the surfaces below need it to exist
    // The panel reports the same status and carries the same controls, so the
    // card would only be a second copy fighting it for space.
    ui.card.hidden = !cardWanted || panelOpen;
    ui.launcher.hidden = !isPdf() || panelOpen;
    const anythingVisible = !ui.launcher.hidden || !ui.card.hidden || panelOpen;
    if (anythingVisible) reveal();
    else conceal();
}

function reveal() {
    build();
    applyTheme();
    if (shown) return;
    if (supportsPopover) { try { host.showPopover(); } catch {} }
    else host.style.setProperty('display', 'block', 'important');
    shown = true;
}

function conceal() {
    if (!shown || !host) return;
    if (supportsPopover) { try { host.hidePopover(); } catch {} }
    else host.style.setProperty('display', 'none', 'important');
    shown = false;
}

// Match the surfaces to the reading theme, and, only on the fallback path,
// where this is a plain descendant of <html> and does inherit the theme
// filter, undo that filter. Just the Dark theme needs undoing; Paper and
// Sepia only tint the card, which reads as intentional.
function applyTheme() {
    if (!host || !ui) return;
    chrome.storage.sync.get({ enabled: false, theme: 'paper', intensity: 80 }, (s) => {
        const dark = s.enabled === true && s.theme === 'dark';
        ui.wrap.classList.toggle('dark', dark);

        if (supportsPopover || document.contentType !== 'application/pdf') return;
        if (!dark) {
            host.style.removeProperty('filter');
            return;
        }
        // Mirror of filterFor('dark', i) in content.js, applied in reverse.
        const i = Math.min(100, Math.max(0, Number(s.intensity) || 0)) / 100;
        const contrast = 1 - 0.08 * i;
        const brightness = 1 - 0.04 * i;
        host.style.setProperty(
            'filter',
            `brightness(${(1 / brightness).toFixed(3)}) contrast(${(1 / contrast).toFixed(3)}) ` +
            'hue-rotate(180deg) invert(1)',
            'important'
        );
    });
}

function formatMB(bytes) {
    const mb = (Number(bytes) || 0) / 1048576;
    return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
}

// Wording mirrors the popup so the two surfaces read the same.
function describe(state) {
    const label = VOICE_LABELS[state.voice] || '';
    switch (state.phase) {
        case 'starting':
            return { phase: 'Preparing…', detail: '' };
        case 'downloading':
            return {
                phase: `Downloading ${label} voice`,
                detail: `${state.pct ?? 0}% of ${formatMB(state.total)}, one time only`,
                pct: state.pct ?? 0
            };
        case 'loading':
            return { phase: `Loading ${label} voice…`, detail: state.detail || '' };
        case 'generating':
            return { phase: `Generating audio · ${label}`, detail: state.detail || '' };
        case 'speaking':
            return { phase: `Reading aloud · ${label}`, detail: state.detail || '' };
        case 'error':
            return { phase: 'Read aloud failed', detail: state.error || '', bad: true };
        default:
            return null;
    }
}

function render(state) {
    if (!state) return;
    build();
    // A fresh session re-enables a card the user dismissed earlier.
    if (state.phase === 'starting') cardDismissed = false;

    const parts = describe(state);
    const wasShowing = cardWanted;
    currentState = state;

    if (!parts) {
        clearReading();
        // Finished: acknowledge briefly instead of vanishing mid-sentence.
        if (wasShowing && state.phase === 'idle') {
            ui.phase.textContent = 'Finished reading';
            ui.detail.textContent = '';
            ui.dot.classList.add('still');
            ui.track.hidden = true;
            ui.actions.hidden = true;
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => { cardWanted = false; refreshVisibility(); }, IDLE_HIDE_MS);
        } else {
            cardWanted = false;
            refreshVisibility();
        }
        return;
    }
    if (cardDismissed) return;

    clearTimeout(hideTimer);
    cardWanted = true;
    refreshVisibility();

    ui.phase.textContent = state.paused ? `Paused · ${parts.phase}` : parts.phase;
    ui.detail.textContent = parts.detail;
    ui.dot.classList.toggle('bad', !!parts.bad);
    ui.dot.classList.toggle('still', !!state.paused);

    // The track is shared: download percentage before a reading, overall
    // reading progress (driven by the reading ticks) during one.
    const downloading = parts.pct !== undefined;
    ui.track.hidden = !downloading && readingTick?.progress == null;
    if (downloading) ui.fill.style.width = parts.pct + '%';

    ui.actions.hidden = !!parts.bad;
    // Nothing to pause until there is audio in flight.
    ui.toggle.hidden = ['starting', 'downloading'].includes(state.phase);
    ui.toggle.textContent = state.paused ? 'Resume' : 'Pause';

    if (parts.bad) {
        // Errors linger; everything else is driven by the next update.
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { cardWanted = false; refreshVisibility(); }, 12000);
    }
}

// ---- live word highlight ---------------------------------------------
// The offscreen document ticks twice a second with the chunk under the
// play head and its timing; between ticks the highlight advances on a
// local clock, so the marker moves word by word without a message per
// word. Position within the chunk is estimated by character share of the
// chunk's audio duration (the model reports no word timestamps), which is
// accurate to about a word at normal speed.

let readingTick = null; // latest tick, stamped with receivedAt
let readingWords = []; // [{start, end, el}] spans of the current sentence
let readingText = null;
let readingRaf = 0;
let readingWordIdx = -1;

function clearReading() {
    readingTick = null;
    readingText = null;
    readingWords = [];
    readingWordIdx = -1;
    if (readingRaf) {
        cancelAnimationFrame(readingRaf);
        readingRaf = 0;
    }
    if (!ui) return;
    ui.sentence.textContent = '';
    ui.genline.hidden = true;
    if (currentState?.phase !== 'downloading') ui.track.hidden = true;
}

function buildSentence(text) {
    ui.sentence.textContent = '';
    readingWords = [];
    readingWordIdx = -1;
    const frag = document.createDocumentFragment();
    const re = /\S+/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
        if (m.index > last) frag.append(text.slice(last, m.index));
        const el = document.createElement('span');
        el.className = 'w';
        el.textContent = m[0];
        frag.append(el);
        readingWords.push({ start: m.index, end: m.index + m[0].length, el });
        last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    ui.sentence.append(frag);
    ui.sentence.scrollTop = 0;
}

function setWord(idx) {
    if (idx === readingWordIdx) return;
    if (readingWordIdx >= 0) readingWords[readingWordIdx]?.el.classList.remove('on');
    readingWordIdx = idx;
    const word = idx >= 0 ? readingWords[idx] : null;
    if (!word) return;
    word.el.classList.add('on');
    // Keep the active line inside the three-line window.
    ui.sentence.scrollTop = Math.max(0, word.el.offsetTop - 18);
}

function stepReading() {
    readingRaf = 0;
    const tick = readingTick;
    if (!tick || !tick.text || !readingWords.length) return;
    let elapsed = tick.elapsedMs;
    if (!tick.paused) elapsed += performance.now() - tick.receivedAt;
    if (elapsed < 0) {
        setWord(-1); // scheduled but not audible yet (buffer underrun gap)
    } else {
        const frac = tick.durationMs > 0 ? Math.min(elapsed / tick.durationMs, 0.999) : 0;
        const pos = Math.floor(frac * tick.text.length);
        let idx = readingWords.length - 1;
        for (let i = 0; i < readingWords.length; i++) {
            if (pos < readingWords[i].end) {
                idx = i;
                break;
            }
        }
        setWord(idx);
    }
    if (!tick.paused) readingRaf = requestAnimationFrame(stepReading);
}

function renderReading(tick) {
    if (!tick) {
        clearReading();
        return;
    }
    build();
    readingTick = { ...tick, receivedAt: performance.now() };
    if (cardDismissed || !cardWanted) return; // statuses own card visibility

    const many = tick.workers > 1 ? ` ×${tick.workers}` : '';
    let genText = '';
    if (tick.generating) {
        genText = tick.buffered > 0
            ? `Generating ahead${many} · ${tick.buffered}s buffered`
            : `Generating audio${many}…`;
    } else if (tick.buffered > 0) {
        genText = `${tick.buffered}s buffered`;
    }
    ui.gentext.textContent = genText;
    ui.genline.hidden = !genText;
    ui.gendot.classList.toggle('live', !!tick.generating);

    if (tick.progress != null) {
        ui.track.hidden = false;
        ui.fill.style.width = Math.round(Math.min(1, Math.max(0, tick.progress)) * 100) + '%';
    }

    if (tick.text !== readingText) {
        readingText = tick.text;
        if (tick.text) buildSentence(tick.text);
        else {
            ui.sentence.textContent = '';
            readingWords = [];
            readingWordIdx = -1;
        }
    }
    if (readingRaf) cancelAnimationFrame(readingRaf);
    stepReading();
}

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'gentle-hud') render(message.state);
    if (message?.type === 'gentle-reading') renderReading(message.reading);
});

// Keep the surfaces in step if the theme is changed while they are on screen.
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && shown) applyTheme();
});

// The embedded popup reports its height so the panel fits its content exactly.
window.addEventListener('message', (event) => {
    if (event.origin !== EXTENSION_ORIGIN) return;
    if (event.data?.type !== 'gentle-panel-height' || !ui) return;
    const frame = ui.panel.querySelector('iframe');
    if (!frame) return;
    const height = Math.min(Number(event.data.height) || 560, Math.round(innerHeight * 0.8));
    frame.style.height = height + 'px';
});

// Show the launcher on PDF tabs. Chrome's PDF viewer attaches its content
// after document_end, so re-check for a while rather than only once.
if (isPdf()) {
    refreshVisibility();
} else {
    let tries = 0;
    const poll = setInterval(() => {
        if (isPdf()) { refreshVisibility(); clearInterval(poll); }
        else if (++tries > 10) clearInterval(poll);
    }, 500);
}

// Reloading the page mid-reading should bring the card back. This is the only
// thing the script does unprompted, so it must not cost anything at startup:
// a session restore loads every tab at once, and each message would wake the
// service worker at the worst possible moment. Ask only for a tab the user is
// actually looking at, and only once the page has gone idle.
let syncedOnce = false;

function syncIfVisible() {
    if (syncedOnce || document.visibilityState !== 'visible') return;
    syncedOnce = true;
    const ask = () => send('hud-sync').then((response) => {
        if (response?.state) render(response.state);
    });
    if (typeof requestIdleCallback === 'function') requestIdleCallback(ask, { timeout: 3000 });
    else setTimeout(ask, 500);
}

syncIfVisible();
document.addEventListener('visibilitychange', syncIfVisible);
