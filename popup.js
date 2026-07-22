// Gentle Page PDF — popup logic.
// Theming settings live in chrome.storage.sync; content scripts on PDF
// pages react instantly via storage.onChanged. The Read-aloud section
// talks to the service worker (target: 'tts-bg').

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
        fluent: document.querySelector('[data-state-for="fluent"]'),
        natural: document.querySelector('[data-state-for="natural"]')
    };
    const naturalRow = document.querySelector('.voice[data-voice="natural"]');
    const progressBox = document.getElementById('tts-progress');
    const progressLabel = document.getElementById('tts-progress-label');
    const progressFill = document.getElementById('tts-progress-fill');
    const ttsNote = document.getElementById('tts-note');
    const testBtn = document.getElementById('test-voice');
    const stopBtn = document.getElementById('stop-voice');

    const DEFAULT_NOTE = ttsNote.innerHTML;
    const VOICE_LABELS = { robot: 'Robot', fluent: 'Fluent', natural: 'Natural' };
    const VOICE_SIZES = { fluent: '~90 MB', natural: '~1.4 GB' };

    version.textContent = 'v' + chrome.runtime.getManifest().version;

    let tabIsPdf = null; // null = unknown

    // ------------------------------------------------------------ theming

    function normalizeSettings(raw) {
        const enabled =
            raw.enabled !== undefined ? raw.enabled === true : raw.isEnabled === true;

        let theme = raw.theme === 'light' ? 'paper' : raw.theme;
        if (!['paper', 'sepia', 'dark'].includes(theme)) theme = 'paper';

        let intensity = Number(raw.intensity);
        if (!Number.isFinite(intensity)) intensity = 80;
        intensity = Math.min(100, Math.max(0, intensity));

        const voice = ['robot', 'fluent', 'natural'].includes(raw.voice)
            ? raw.voice
            : 'robot';

        return { enabled, theme, intensity, voice };
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

    function render(settings) {
        enableToggle.checked = settings.enabled;
        themeRadios.forEach((radio) => {
            radio.checked = radio.value === settings.theme;
        });
        intensitySlider.value = String(settings.intensity);
        intensityValue.textContent = settings.intensity + '%';
        voiceRadios.forEach((radio) => {
            radio.checked = radio.value === settings.voice;
        });
        renderStatus();
    }

    chrome.storage.sync.get(null, (raw) => {
        render(normalizeSettings(raw));
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || tab.id === undefined) return;
        chrome.tabs.sendMessage(tab.id, { type: 'gentle-ping' }, (response) => {
            tabIsPdf = !chrome.runtime.lastError && !!(response && response.isPdf);
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
        chrome.storage.sync.set({ intensity });
    });

    // --------------------------------------------------------- read aloud

    voiceRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            if (radio.checked) chrome.storage.sync.set({ voice: radio.value });
        });
    });

    testBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ target: 'tts-bg', cmd: 'speak-test' });
    });

    stopBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ target: 'tts-bg', cmd: 'stop' });
    });

    // WebGPU requirement for the Natural voice — the navigator.gpu object
    // can exist with no usable adapter behind it, so actually ask for one.
    if (navigator.gpu) {
        navigator.gpu.requestAdapter().then((adapter) => {
            if (!adapter) markNoWebGpu();
        }).catch(markNoWebGpu);
    } else {
        markNoWebGpu();
    }
    function markNoWebGpu() {
        naturalRow.classList.add('unavailable');
        voiceStates.natural.textContent = 'No WebGPU';
        naturalRow.title = 'This browser has no WebGPU, which the Natural voice requires.';
    }

    function renderReadyFlags(flags) {
        for (const voice of ['fluent', 'natural']) {
            if (voice === 'natural' && naturalRow.classList.contains('unavailable')) continue;
            if (flags[`ttsReady_${voice}`]) {
                voiceStates[voice].textContent = 'Ready';
                voiceStates[voice].classList.add('ready');
            } else {
                voiceStates[voice].textContent = VOICE_SIZES[voice];
                voiceStates[voice].classList.remove('ready');
            }
        }
    }

    chrome.storage.local.get(['ttsReady_fluent', 'ttsReady_natural'], renderReadyFlags);
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            chrome.storage.local.get(['ttsReady_fluent', 'ttsReady_natural'], renderReadyFlags);
        }
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

        switch (state.phase) {
            case 'downloading':
                progressLabel.textContent =
                    `Downloading ${label} voice — ${state.pct}% of ${formatMB(state.total)}`;
                progressFill.style.width = state.pct + '%';
                ttsNote.innerHTML = 'Downloading once — cached for offline use after this.';
                stopBtn.disabled = true;
                break;
            case 'loading':
                ttsNote.innerHTML = `Loading ${label} voice…`;
                stopBtn.disabled = true;
                break;
            case 'speaking':
                ttsNote.innerHTML =
                    `Speaking (${label})` +
                    (state.chunks > 1 ? ` — part ${state.chunk} of ${state.chunks}` : '') +
                    '…';
                stopBtn.disabled = false;
                break;
            case 'error':
                ttsNote.textContent = state.error || 'Something went wrong.';
                ttsNote.classList.add('error');
                stopBtn.disabled = true;
                break;
            case 'ready':
            case 'idle':
            default:
                ttsNote.innerHTML = DEFAULT_NOTE;
                stopBtn.disabled = true;
        }
    }

    chrome.storage.session.get('ttsStatus', ({ ttsStatus }) => {
        // Ignore stale terminal states from long ago.
        if (ttsStatus && Date.now() - (ttsStatus.at || 0) < 60_000) {
            renderTtsState(ttsStatus);
        }
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'tts-status') renderTtsState(message.state);
    });
});
