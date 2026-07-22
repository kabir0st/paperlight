// Paperlight — popup logic.
// Theming settings live in chrome.storage.sync; content scripts on PDF
// pages react instantly via storage.onChanged. The Read-aloud section
// talks to the service worker (target: 'tts-bg').

import { KOKORO_VOICES, DEFAULT_KOKORO_VOICE } from './src/kokoro-voices.js';

document.addEventListener('DOMContentLoaded', () => {
    const enableToggle = document.getElementById('enable-toggle');
    const themeRadios = Array.from(document.querySelectorAll('input[name="theme"]'));
    const intensitySlider = document.getElementById('intensity-slider');
    const intensityValue = document.getElementById('intensity-value');
    const controls = document.getElementById('controls');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const version = document.getElementById('version');

    const voiceRadios = Array.from(document.querySelectorAll('input[name="voice"]'));
    const voiceStates = {
        robot: document.querySelector('[data-state-for="robot"]'),
        fluent: document.querySelector('[data-state-for="fluent"]')
    };
    const progressBox = document.getElementById('tts-progress');
    const progressLabel = document.getElementById('tts-progress-label');
    const progressFill = document.getElementById('tts-progress-fill');
    const ttsNote = document.getElementById('tts-note');
    const spinner = document.getElementById('tts-spinner');
    const testBtn = document.getElementById('test-voice');
    const pauseBtn = document.getElementById('pause-voice');
    const stopBtn = document.getElementById('stop-voice');
    const readPdfRow = document.getElementById('read-pdf-row');
    const readPdfBtn = document.getElementById('read-pdf-btn');
    const fromPageInput = document.getElementById('from-page');

    const fluentOptions = document.getElementById('fluent-options');
    const speakerSelect = document.getElementById('kokoro-speaker');
    const speedSlider = document.getElementById('kokoro-speed');
    const speedValue = document.getElementById('kokoro-speed-value');
    const volumeSlider = document.getElementById('volume');
    const volumeValue = document.getElementById('volume-value');

    const DEFAULT_NOTE = ttsNote.innerHTML;
    const VOICE_LABELS = { robot: 'Robot', fluent: 'Fluent' };
    const FLUENT_SIZE = '~90 MB'; // the q8 export, the only build we load
    // Phases where the user is waiting on us rather than listening.
    const BUSY_PHASES = ['starting', 'downloading', 'loading', 'generating'];

    version.textContent = 'v' + chrome.runtime.getManifest().version;

    let tabIsPdf = null; // null = unknown
    let tabHref = null;
    let tabId = null;
    let settings = null;
    let readyFlags = {};

    // chrome.storage.sync caps writes at ~120/minute, and dragging a slider
    // fires far more `input` events than that, so slider writes are coalesced.
    // Everything downstream still reacts within a frame or two.
    let pendingWrite = null;
    let writeTimer = null;

    function flushWrites() {
        clearTimeout(writeTimer);
        if (!pendingWrite) return;
        chrome.storage.sync.set(pendingWrite);
        pendingWrite = null;
    }

    function saveSoon(values) {
        pendingWrite = { ...pendingWrite, ...values };
        clearTimeout(writeTimer);
        writeTimer = setTimeout(flushWrites, 150);
    }

    // The popup is torn down the instant it loses focus — don't lose the
    // last slider position with it.
    window.addEventListener('pagehide', flushWrites);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushWrites();
    });

    // This same page is embedded in the in-page panel (hud.js). There it has
    // to report its own height, since the framing content script cannot read
    // across the extension-origin boundary.
    if (window.parent !== window) {
        // popup.css pins the body to the toolbar popup's 300px; in the panel
        // it has to give way to the frame, or a scrollbar forces sideways
        // scrolling.
        document.body.style.width = '100%';
        const reportHeight = () => {
            const height = Math.ceil(document.documentElement.scrollHeight);
            window.parent.postMessage({ type: 'gentle-panel-height', height }, '*');
        };
        reportHeight();
        new ResizeObserver(reportHeight).observe(document.documentElement);
    }

    // ------------------------------------------------------------ theming

    function normalizeSettings(raw) {
        const enabled =
            raw.enabled !== undefined ? raw.enabled === true : raw.isEnabled === true;

        let theme = raw.theme === 'light' ? 'paper' : raw.theme;
        if (!['paper', 'sepia', 'dark'].includes(theme)) theme = 'paper';

        let intensity = Number(raw.intensity);
        if (!Number.isFinite(intensity)) intensity = 80;
        intensity = Math.min(100, Math.max(0, intensity));

        // 'natural' (Chatterbox) was removed in 2.4.0 — fall back to Fluent.
        const voice = ['robot', 'fluent'].includes(raw.voice) ? raw.voice : 'robot';

        const kokoroSpeaker = KOKORO_VOICES.some((v) => v.id === raw.kokoroSpeaker)
            ? raw.kokoroSpeaker
            : DEFAULT_KOKORO_VOICE;

        let kokoroSpeed = Number(raw.kokoroSpeed);
        if (!Number.isFinite(kokoroSpeed)) kokoroSpeed = 1;
        kokoroSpeed = Math.min(2, Math.max(0.5, kokoroSpeed));

        let volume = Number(raw.volume);
        if (!Number.isFinite(volume)) volume = 100;
        volume = Math.min(100, Math.max(0, volume));

        return { enabled, theme, intensity, voice, kokoroSpeaker, kokoroSpeed, volume };
    }

    function renderStatus() {
        const enabled = enableToggle.checked;
        controls.classList.toggle('disabled', !enabled);

        if (!enabled) {
            statusDot.classList.remove('on');
            statusText.textContent = 'Off';
        } else if (tabIsPdf === true) {
            statusDot.classList.add('on');
            statusText.textContent = 'Styling this PDF';
        } else if (tabIsPdf === false) {
            statusDot.classList.remove('on');
            statusText.textContent = 'Open a PDF to see the effect';
        } else {
            statusDot.classList.remove('on');
            statusText.textContent = 'On';
        }
    }

    function render(next) {
        settings = next;
        enableToggle.checked = next.enabled;
        themeRadios.forEach((radio) => {
            radio.checked = radio.value === next.theme;
        });
        intensitySlider.value = String(next.intensity);
        intensityValue.textContent = next.intensity + '%';
        voiceRadios.forEach((radio) => {
            radio.checked = radio.value === next.voice;
        });

        speakerSelect.value = next.kokoroSpeaker;
        speedSlider.value = String(next.kokoroSpeed);
        speedValue.textContent = next.kokoroSpeed.toFixed(1) + '×';
        volumeSlider.value = String(next.volume);
        volumeValue.textContent = next.volume + '%';

        fluentOptions.hidden = next.voice !== 'fluent';
        renderStatus();
        renderReadyFlags();
    }

    buildSpeakerOptions();

    chrome.storage.sync.get(null, (raw) => {
        const next = normalizeSettings(raw);
        // The speaker list narrowed in 2.7.0, so a stored speaker may no longer
        // exist. It already renders — and reads — as Nicole; persist that so
        // storage stops disagreeing with the dropdown.
        if (raw.kokoroSpeaker !== next.kokoroSpeaker) {
            chrome.storage.sync.set({ kokoroSpeaker: next.kokoroSpeaker });
        }
        render(next);
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || tab.id === undefined) return;
        tabId = tab.id;
        chrome.tabs.sendMessage(tab.id, { type: 'gentle-ping' }, (response) => {
            tabIsPdf = !chrome.runtime.lastError && !!(response && response.isPdf);
            tabHref = tabIsPdf ? response.href || null : null;
            readPdfRow.hidden = !tabHref;
            renderStatus();
        });
    });

    enableToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ enabled: enableToggle.checked });
        renderStatus();
    });

    themeRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            if (radio.checked) chrome.storage.sync.set({ theme: radio.value });
        });
    });

    intensitySlider.addEventListener('input', () => {
        const intensity = Number(intensitySlider.value);
        intensityValue.textContent = intensity + '%';
        saveSoon({ intensity });
    });

    // --------------------------------------------------------- read aloud

    voiceRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            chrome.storage.sync.set({ voice: radio.value });
            settings.voice = radio.value;
            fluentOptions.hidden = radio.value !== 'fluent';
            renderReadyFlags();
        });
    });

    // The command carries the tab so the service worker knows where the
    // in-page HUD belongs.
    function command(cmd, extra = {}) {
        chrome.runtime.sendMessage({ target: 'tts-bg', cmd, tabId, ...extra });
    }

    testBtn.addEventListener('click', () => command('speak-test'));
    stopBtn.addEventListener('click', () => command('stop'));
    pauseBtn.addEventListener('click', () => {
        command(pauseBtn.dataset.paused === 'true' ? 'resume' : 'pause');
    });

    readPdfBtn.addEventListener('click', () => {
        if (!tabHref) return;
        command('read-pdf', {
            url: tabHref,
            fromPage: Math.max(1, Number(fromPageInput.value) || 1)
        });
    });

    // ------------------------------------------------------ voice options

    // One speaker per accent/gender pairing, so the accent goes on the option
    // itself — four optgroups of one entry each would be pure chrome.
    function buildSpeakerOptions() {
        for (const voice of KOKORO_VOICES) {
            const option = document.createElement('option');
            option.value = voice.id;
            option.textContent =
                `${voice.name} · ${voice.accent === 'UK' ? 'British' : 'American'}`;
            speakerSelect.appendChild(option);
        }
    }

    speakerSelect.addEventListener('change', () => {
        settings.kokoroSpeaker = speakerSelect.value;
        chrome.storage.sync.set({ kokoroSpeaker: speakerSelect.value });
    });

    speedSlider.addEventListener('input', () => {
        const kokoroSpeed = Number(speedSlider.value);
        speedValue.textContent = kokoroSpeed.toFixed(1) + '×';
        settings.kokoroSpeed = kokoroSpeed;
        saveSoon({ kokoroSpeed });
    });

    volumeSlider.addEventListener('input', () => {
        const volume = Number(volumeSlider.value);
        volumeValue.textContent = volume + '%';
        settings.volume = volume;
        saveSoon({ volume });
    });

    // A voice counts as ready once its weights are cached. `ttsReady_fluent` is
    // what 2.7.0 writes; the per-device flag covers profiles upgrading from the
    // 2.3–2.6 releases that tracked CPU and WebGPU separately.
    function renderReadyFlags() {
        const fluentReady = readyFlags.ttsReady_fluent || readyFlags.ttsReady_fluent_wasm;

        voiceStates.fluent.textContent = fluentReady ? 'Ready' : FLUENT_SIZE;
        voiceStates.fluent.classList.toggle('ready', !!fluentReady);
    }

    function loadReadyFlags() {
        chrome.storage.local.get(['ttsReady_fluent', 'ttsReady_fluent_wasm'], (flags) => {
            readyFlags = flags;
            renderReadyFlags();
        });
    }

    loadReadyFlags();
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') loadReadyFlags();
    });

    function formatMB(bytes) {
        const mb = bytes / 1048576;
        return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
    }

    function renderTtsState(state) {
        if (!state) return;
        const label = VOICE_LABELS[state.voice] || '';
        progressBox.hidden = state.phase !== 'downloading';
        ttsNote.classList.remove('error');

        const detail = state.detail ? ` — ${state.detail}` : '';
        const active = !['idle', 'ready', 'error'].includes(state.phase);

        switch (state.phase) {
            case 'starting':
                ttsNote.textContent = 'Preparing…';
                break;
            case 'downloading':
                progressLabel.textContent =
                    `Downloading ${label} voice — ${state.pct}% of ${formatMB(state.total)}`;
                progressFill.style.width = state.pct + '%';
                ttsNote.textContent = 'Downloading once — cached for offline use after this.';
                break;
            case 'loading':
                ttsNote.textContent = `Loading ${label} voice${detail}…`;
                break;
            case 'generating':
                ttsNote.textContent = `Generating audio (${label})${detail}…`;
                break;
            case 'speaking':
                ttsNote.textContent = `Speaking (${label})${detail}…`;
                break;
            case 'error':
                ttsNote.textContent = state.error || 'Something went wrong.';
                ttsNote.classList.add('error');
                break;
            case 'ready':
            case 'idle':
            default:
                ttsNote.innerHTML = DEFAULT_NOTE;
        }

        if (state.paused && active) {
            ttsNote.textContent = `Paused — ${ttsNote.textContent}`;
        }
        // Spin only while the user is waiting on us — speaking is progress, not
        // a wait, and a paused reading is waiting on them.
        spinner.hidden = !!state.paused || !BUSY_PHASES.includes(state.phase);
        stopBtn.disabled = !active;
        // Nothing to pause until there is audio in flight.
        pauseBtn.disabled = !active || ['starting', 'downloading'].includes(state.phase);
        pauseBtn.dataset.paused = String(!!state.paused);
        pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    }

    chrome.storage.session.get('ttsStatus', ({ ttsStatus }) => {
        if (!ttsStatus) return;
        // Ignore stale terminal states from long ago; an in-flight one (a long
        // pause, say) stays relevant however old it is.
        const terminal = ['idle', 'ready', 'error'].includes(ttsStatus.phase);
        if (!terminal || Date.now() - (ttsStatus.at || 0) < 60_000) {
            renderTtsState(ttsStatus);
        }
    });

    // 'tts-state' is the service worker's stamped status — it carries the
    // paused flag and the robot-voice updates that never reach the raw
    // engine channel.
    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'tts-state') renderTtsState(message.state);
    });
});
