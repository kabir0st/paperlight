// Gentle Page PDF — content script.
// Injected on every page, but only ever acts on PDF documents:
// it sets data-gentle-theme / --gentle-intensity on <html>, and
// styles.css only matches when that attribute is present.

const GENTLE_THEMES = ['paper', 'sepia', 'dark'];

function isPdf() {
    return (
        document.contentType === 'application/pdf' ||
        !!document.querySelector(
            'embed[type="application/pdf"], embed[type="application/x-google-chrome-pdf"]'
        )
    );
}

// Normalize stored settings, accepting values written by v1.x
// (isEnabled boolean, theme "light"/"dark").
function normalizeSettings(raw) {
    const enabled =
        raw.enabled !== undefined ? raw.enabled === true : raw.isEnabled === true;

    let theme = raw.theme === 'light' ? 'paper' : raw.theme;
    if (!GENTLE_THEMES.includes(theme)) theme = 'paper';

    let intensity = Number(raw.intensity);
    if (!Number.isFinite(intensity)) intensity = 80;
    intensity = Math.min(100, Math.max(0, intensity));

    return { enabled, theme, intensity };
}

function applySettings({ enabled, theme, intensity }) {
    const root = document.documentElement;
    if (!enabled) {
        delete root.dataset.gentleTheme;
        root.style.removeProperty('--gentle-intensity');
        return;
    }
    root.dataset.gentleTheme = theme;
    root.style.setProperty('--gentle-intensity', String(intensity / 100));
}

function refresh() {
    chrome.storage.sync.get(null, (raw) => {
        applySettings(normalizeSettings(raw));
    });
}

if (isPdf()) {
    refresh();

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync') refresh();
    });

    // Lets the popup show whether the active tab is a PDF.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message && message.type === 'gentle-ping') {
            sendResponse({ isPdf: true });
        }
    });
}
