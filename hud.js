// Gentle Page PDF — in-page activity HUD.
//
// Chrome closes the toolbar popup the moment focus leaves it, so clicking the
// PDF to scroll or select text takes the only progress readout with it. This
// script puts a small player in the page itself: it is inert until the service
// worker sends a `gentle-hud` status update, and it reports downloading /
// generating / speaking with Pause and Stop controls.
//
// Filter caveat: the theming content script applies a CSS `filter` to <html>
// (or to the PDF <embed>), and a filter applies to every descendant — a plain
// overlay would come out inverted under the Dark theme. The HUD therefore
// lives in the browser's top layer via the popover API, which is painted
// outside ancestor filter effects. Where the popover API is missing we fall
// back to a normal fixed element plus a counter-filter that undoes the theme.

const HOST_ID = 'gentle-page-pdf-hud';
const VOICE_LABELS = { robot: 'Robot', fluent: 'Fluent', natural: 'Natural' };
const IDLE_HIDE_MS = 2500;

const supportsPopover = typeof HTMLElement.prototype.showPopover === 'function';

let host = null;
let ui = null; // resolved shadow-root nodes
let shown = false;
let hideTimer = null;
let dismissed = false;
let currentState = null;

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.card {
  width: 288px;
  padding: 12px 14px;
  border: 1px solid #e7e4dc;
  border-radius: 12px;
  background: #faf9f6;
  color: #2b2a26;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, sans-serif;
  box-shadow: 0 6px 24px rgba(43, 42, 38, 0.18);
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 160ms ease, transform 160ms ease;
}
.card.visible { opacity: 1; transform: none; }
/* Follow the reading theme — a cream card glares on a dark page. */
.card.dark {
  border-color: #3a3934;
  background: #232323;
  color: #e8e4dc;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
}
.card.dark .detail, .card.dark .close { color: #a09a8c; }
.card.dark .close:hover { background: #33322e; color: #e8e4dc; }
.card.dark .track { background: #3a3934; }
.card.dark .fill { background: #e8e4dc; }
.card.dark .btn { border-color: #3a3934; background: #2c2b28; color: #e8e4dc; }
.card.dark .btn:hover { border-color: #575550; }
.card.dark .btn.primary { background: #e8e4dc; border-color: #e8e4dc; color: #232323; }
.card.dark .btn.primary:hover { background: #ffffff; }
.top { display: flex; align-items: flex-start; gap: 9px; }
.dot {
  width: 8px; height: 8px; margin-top: 4px; border-radius: 50%;
  background: #3e7b4f; flex: none; animation: pulse 1.6s ease-in-out infinite;
}
.dot.still { animation: none; }
.dot.bad { background: #a4442f; animation: none; }
@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
@media (prefers-reduced-motion: reduce) {
  .dot { animation: none; }
  .card { transition: none; }
}
.text { flex: 1; min-width: 0; }
.phase { font-weight: 600; }
.detail {
  margin-top: 2px; color: #75705f; font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.detail:empty { display: none; }
.close {
  flex: none; width: 20px; height: 20px; padding: 0; margin: -2px -4px 0 0;
  border: 0; border-radius: 5px; background: transparent; color: #75705f;
  font-size: 13px; line-height: 1; cursor: pointer;
}
.close:hover { background: #efece4; color: #2b2a26; }
.track {
  margin-top: 9px; height: 5px; border-radius: 3px;
  background: #e7e4dc; overflow: hidden;
}
.track[hidden] { display: none; }
.fill { height: 100%; width: 0; background: #2b2a26; transition: width 200ms ease; }
.actions { display: flex; gap: 8px; margin-top: 11px; }
.btn {
  flex: 1; padding: 6px 10px; border: 1px solid #e7e4dc; border-radius: 7px;
  background: #ffffff; color: #2b2a26; font: inherit; font-size: 12px;
  cursor: pointer;
}
.btn:hover { border-color: #cfcabc; }
.btn.primary { background: #2b2a26; border-color: #2b2a26; color: #faf9f6; }
.btn.primary:hover { background: #3c3a34; }
.actions[hidden], .btn[hidden] { display: none; }
`;

function build() {
    if (host && host.isConnected) return;

    host = document.createElement('div');
    host.id = HOST_ID;
    if (supportsPopover) host.setAttribute('popover', 'manual');

    // Inline + !important so no page stylesheet can move or restyle the host.
    // `display` is deliberately left alone: the UA controls it for popovers.
    const hostStyle = {
        position: 'fixed',
        inset: 'auto 16px 16px auto',
        width: 'auto',
        height: 'auto',
        margin: '0',
        padding: '0',
        border: '0',
        background: 'transparent',
        overflow: 'visible',
        'z-index': '2147483647',
        'color-scheme': 'light'
    };
    for (const [prop, value] of Object.entries(hostStyle)) {
        host.style.setProperty(prop, value, 'important');
    }
    if (!supportsPopover) host.style.setProperty('display', 'none', 'important');

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="top">
        <span class="dot"></span>
        <div class="text">
          <div class="phase"></div>
          <div class="detail"></div>
        </div>
        <button class="close" type="button" title="Hide" aria-label="Hide">✕</button>
      </div>
      <div class="track" hidden><div class="fill"></div></div>
      <div class="actions">
        <button class="btn toggle" type="button">Pause</button>
        <button class="btn primary stop" type="button">Stop</button>
      </div>`;

    root.append(style, card);
    (document.body || document.documentElement).appendChild(host);

    ui = {
        card,
        dot: card.querySelector('.dot'),
        phase: card.querySelector('.phase'),
        detail: card.querySelector('.detail'),
        track: card.querySelector('.track'),
        fill: card.querySelector('.fill'),
        actions: card.querySelector('.actions'),
        toggle: card.querySelector('.toggle'),
        stop: card.querySelector('.stop'),
        close: card.querySelector('.close')
    };

    ui.close.addEventListener('click', () => {
        dismissed = true;
        hide();
    });
    ui.stop.addEventListener('click', () => send('stop'));
    ui.toggle.addEventListener('click', () => {
        send(currentState?.paused ? 'resume' : 'pause');
    });
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

// Match the card to the reading theme, and — only on the fallback path, where
// the HUD is a plain descendant of <html> and does inherit the theme filter —
// undo that filter. Just the Dark theme needs undoing; Paper and Sepia only
// tint the card, which reads as intentional.
function applyTheme() {
    if (!host) return;
    chrome.storage.sync.get({ enabled: false, theme: 'paper', intensity: 80 }, (s) => {
        const dark = s.enabled === true && s.theme === 'dark';
        ui.card.classList.toggle('dark', dark);

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

function show() {
    build();
    applyTheme();
    if (!shown) {
        if (supportsPopover) {
            try { host.showPopover(); } catch {}
        } else {
            host.style.setProperty('display', 'block', 'important');
        }
        shown = true;
        // Next frame, so the entrance transition actually runs.
        requestAnimationFrame(() => ui.card.classList.add('visible'));
    }
    clearTimeout(hideTimer);
}

function hide() {
    if (!shown || !host) return;
    ui.card.classList.remove('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        if (supportsPopover) {
            try { host.hidePopover(); } catch {}
        } else {
            host.style.setProperty('display', 'none', 'important');
        }
        shown = false;
    }, 180);
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
                detail: `${state.pct ?? 0}% of ${formatMB(state.total)} — one time only`,
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
    // A fresh session re-enables a HUD the user dismissed earlier.
    if (state.phase === 'starting') dismissed = false;

    const parts = describe(state);
    const wasShowing = shown;
    currentState = state;

    if (!parts) {
        // Finished: acknowledge briefly instead of vanishing mid-sentence.
        if (wasShowing && state.phase === 'idle') {
            ui.phase.textContent = 'Finished reading';
            ui.detail.textContent = '';
            ui.dot.classList.add('still');
            ui.track.hidden = true;
            ui.actions.hidden = true;
            clearTimeout(hideTimer);
            hideTimer = setTimeout(hide, IDLE_HIDE_MS);
        } else {
            hide();
        }
        return;
    }
    if (dismissed) return;

    show();

    ui.phase.textContent = state.paused ? `Paused · ${parts.phase}` : parts.phase;
    ui.detail.textContent = parts.detail;
    ui.dot.classList.toggle('bad', !!parts.bad);
    ui.dot.classList.toggle('still', !!state.paused);

    const downloading = parts.pct !== undefined;
    ui.track.hidden = !downloading;
    if (downloading) ui.fill.style.width = parts.pct + '%';

    ui.actions.hidden = !!parts.bad;
    // Nothing to pause until there is audio in flight.
    ui.toggle.hidden = ['starting', 'downloading'].includes(state.phase);
    ui.toggle.textContent = state.paused ? 'Resume' : 'Pause';

    if (parts.bad) {
        // Errors linger; everything else is driven by the next update.
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 12000);
    }
}

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'gentle-hud') render(message.state);
});

// Keep the card in step if the theme is changed while it is on screen.
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && shown) applyTheme();
});

// Reloading the page mid-reading should bring the HUD back.
send('hud-sync').then((response) => {
    if (response?.state) render(response.state);
});
