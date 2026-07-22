// Gentle Page PDF — popup logic.
// Reads/writes settings in chrome.storage.sync; content scripts on PDF
// pages react to changes instantly via storage.onChanged.

document.addEventListener('DOMContentLoaded', () => {
    const enableToggle = document.getElementById('enable-toggle');
    const themeRadios = Array.from(document.querySelectorAll('input[name="theme"]'));
    const intensitySlider = document.getElementById('intensity-slider');
    const intensityValue = document.getElementById('intensity-value');
    const controls = document.getElementById('controls');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const version = document.getElementById('version');

    version.textContent = 'v' + chrome.runtime.getManifest().version;

    let tabIsPdf = null; // null = unknown

    // Accepts v1.x values (isEnabled, theme "light") as well.
    function normalizeSettings(raw) {
        const enabled =
            raw.enabled !== undefined ? raw.enabled === true : raw.isEnabled === true;

        let theme = raw.theme === 'light' ? 'paper' : raw.theme;
        if (!['paper', 'sepia', 'dark'].includes(theme)) theme = 'paper';

        let intensity = Number(raw.intensity);
        if (!Number.isFinite(intensity)) intensity = 80;
        intensity = Math.min(100, Math.max(0, intensity));

        return { enabled, theme, intensity };
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
        renderStatus();
    }

    chrome.storage.sync.get(null, (raw) => {
        render(normalizeSettings(raw));
    });

    // Ask the active tab's content script whether it is a PDF page.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || tab.id === undefined) return;
        chrome.tabs.sendMessage(tab.id, { type: 'gentle-ping' }, (response) => {
            // No listener answers on non-PDF pages; swallow the error.
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
            if (radio.checked) {
                chrome.storage.sync.set({ theme: radio.value });
            }
        });
    });

    intensitySlider.addEventListener('input', () => {
        const intensity = Number(intensitySlider.value);
        intensityValue.textContent = intensity + '%';
        chrome.storage.sync.set({ intensity });
    });
});
