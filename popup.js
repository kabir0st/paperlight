// Gentle Page PDF — popup logic.
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
        fluent: document.querySelector('[data-state-for="fluent"]'),
        natural: document.querySelector('[data-state-for="natural"]')
    };
    const naturalRow = document.querySelector('.voice[data-voice="natural"]');
    const progressBox = document.getElementById('tts-progress');
    const progressLabel = document.getElementById('tts-progress-label');
    const progressFill = document.getElementById('tts-progress-fill');
    const ttsNote = document.getElementById('tts-note');
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
    const deviceSelect = document.getElementById('kokoro-device');
    const deviceNote = document.getElementById('device-note');
    const volumeSlider = document.getElementById('volume');
    const volumeValue = document.getElementById('volume-value');

    const DEFAULT_NOTE = ttsNote.innerHTML;
    const VOICE_LABELS = { robot: 'Robot', fluent: 'Fluent', natural: 'Natural' };
    // The Fluent download depends on the engine: the WebGPU path needs the
    // fp32 weights, the CPU path the much smaller q8 ones.
    const FLUENT_SIZES = { wasm: '~90 MB', webgpu: '~310 MB' };
    const NATURAL_SIZE = '~1.4 GB';

    version.textContent = 'v' + chrome.runtime.getManifest().version;

    let tabIsPdf = null; // null = unknown
    let tabHref = null;
    let tabId = null;
    let settings = null;
    let readyFlags = {};
    let webgpuOk = null; // null while the adapter probe is in flight

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

        const kokoroSpeaker = KOKORO_VOICES.some((v) => v.id === raw.kokoroSpeaker)
            ? raw.kokoroSpeaker
            : DEFAULT_KOKORO_VOICE;

        let kokoroSpeed = Number(raw.kokoroSpeed);
        if (!Number.isFinite(kokoroSpeed)) kokoroSpeed = 1;
        kokoroSpeed = Math.min(2, Math.max(0.5, kokoroSpeed));

        const kokoroDevice = raw.kokoroDevice === 'webgpu' ? 'webgpu' : 'wasm';

        let volume = Number(raw.volume);
        if (!Number.isFinite(volume)) volume = 100;
        volume = Math.min(100, Math.max(0, volume));

        return { enabled, theme, intensity, voice, kokoroSpeaker, kokoroSpeed, kokoroDevice, volume };
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
        deviceSelect.value = next.kokoroDevice;
        volumeSlider.value = String(next.volume);
        volumeValue.textContent = next.volume + '%';

        fluentOptions.hidden = next.voice !== 'fluent';
        renderStatus();
        renderReadyFlags();
        dropWebGpuDevice();
    }

    buildSpeakerOptions();

    chrome.storage.sync.get(null, (raw) => {
        render(normalizeSettings(raw));
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

    function buildSpeakerOptions() {
        const groups = [
            ['American · Female', 'US', 'F'],
            ['American · Male', 'US', 'M'],
            ['British · Female', 'UK', 'F'],
            ['British · Male', 'UK', 'M']
        ];
        for (const [label, accent, gender] of groups) {
            const group = document.createElement('optgroup');
            group.label = label;
            for (const voice of KOKORO_VOICES) {
                if (voice.accent !== accent || voice.gender !== gender) continue;
                const option = document.createElement('option');
                option.value = voice.id;
                option.textContent = voice.name;
                group.appendChild(option);
            }
            speakerSelect.appendChild(group);
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

    deviceSelect.addEventListener('change', () => {
        settings.kokoroDevice = deviceSelect.value;
        chrome.storage.sync.set({ kokoroDevice: deviceSelect.value });
        renderReadyFlags();
    });

    volumeSlider.addEventListener('input', () => {
        const volume = Number(volumeSlider.value);
        volumeValue.textContent = volume + '%';
        settings.volume = volume;
        saveSoon({ volume });
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
        webgpuOk = false;
        naturalRow.classList.add('unavailable');
        voiceStates.natural.textContent = 'No WebGPU';
        naturalRow.title = 'This browser has no WebGPU, which the Natural voice requires.';

        const webgpuOption = deviceSelect.querySelector('option[value="webgpu"]');
        webgpuOption.disabled = true;
        webgpuOption.textContent = 'WebGPU · unavailable';
        dropWebGpuDevice();
    }

    // The adapter probe and the settings read race each other, so whichever
    // lands second falls back to the CPU engine.
    function dropWebGpuDevice() {
        if (webgpuOk !== false || !settings) return;
        if (settings.kokoroDevice === 'webgpu') {
            settings.kokoroDevice = 'wasm';
            deviceSelect.value = 'wasm';
            chrome.storage.sync.set({ kokoroDevice: 'wasm' });
        }
        renderReadyFlags();
    }

    // A voice counts as ready once its weights are cached. Fluent is tracked
    // per engine, since CPU and WebGPU download different files.
    function fluentReadyKey(device) {
        return `ttsReady_fluent_${device}`;
    }

    function renderReadyFlags() {
        if (!settings) return;
        const device = settings.kokoroDevice;
        // ttsReady_fluent is the pre-2.3 flag, which was always the CPU build.
        const fluentReady =
            readyFlags[fluentReadyKey(device)] ||
            (device === 'wasm' && readyFlags.ttsReady_fluent);

        if (fluentReady) {
            voiceStates.fluent.textContent = 'Ready';
            voiceStates.fluent.classList.add('ready');
        } else {
            voiceStates.fluent.textContent = FLUENT_SIZES[device];
            voiceStates.fluent.classList.remove('ready');
        }

        if (!naturalRow.classList.contains('unavailable')) {
            if (readyFlags.ttsReady_natural) {
                voiceStates.natural.textContent = 'Ready';
                voiceStates.natural.classList.add('ready');
            } else {
                voiceStates.natural.textContent = NATURAL_SIZE;
                voiceStates.natural.classList.remove('ready');
            }
        }

        const needsDownload = device === 'webgpu' && !fluentReady;
        deviceNote.hidden = !needsDownload;
        if (needsDownload) {
            deviceNote.textContent =
                'WebGPU runs the full-precision model — a separate ' +
                FLUENT_SIZES.webgpu + ' download the first time.';
        }
    }

    function loadReadyFlags() {
        chrome.storage.local.get(
            ['ttsReady_fluent', 'ttsReady_fluent_wasm', 'ttsReady_fluent_webgpu', 'ttsReady_natural'],
            (flags) => {
                readyFlags = flags;
                renderReadyFlags();
            }
        );
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
