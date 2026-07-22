// Gentle Page PDF — content script.
// Injected on every page (and frame), but only ever acts on PDF documents.
//
// Chromium's PDF viewer is an out-of-process frame that is NOT an element
// in the wrapper document (its <body> is empty), and content scripts are
// blocked from the inner plugin frame. What does work — verified against
// the OOPIF viewer — is applying the CSS filter to the wrapper document's
// <html> element: the viewer composites inside it. For PDFs embedded in
// normal web pages we filter the <embed> element itself instead, so the
// surrounding site is never affected.
//
// Manifest-declared content CSS is also unreliable on PDF wrapper
// documents, so this script injects its own <style> node and mirrors the
// filter as an inline style.

const GENTLE_THEMES = ['paper', 'sepia', 'dark'];
const STYLE_ID = 'gentle-page-pdf-style';
const EMBED_SELECTOR =
    'embed[type="application/pdf"], embed[type="application/x-google-chrome-pdf"], body > embed';

const GRAIN =
    'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 400 400\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.35\'/%3E%3C/svg%3E")';

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

function round(n) {
    return Math.round(n * 1000) / 1000;
}

// i is 0–1. Values are baked into the string — no var()/calc() so there
// is nothing the PDF wrapper document can fail to resolve.
function filterFor(theme, i) {
    if (theme === 'dark') {
        // White pages -> charcoal, ink -> off-white; hue-rotate keeps
        // image colors close to correct after inversion.
        return (
            `invert(${round(0.82 + 0.13 * i)}) hue-rotate(180deg) ` +
            `contrast(${round(1 - 0.08 * i)}) brightness(${round(1 - 0.04 * i)})`
        );
    }
    if (theme === 'sepia') {
        return (
            `sepia(${round(0.65 * i)}) saturate(${round(1 - 0.15 * i)}) ` +
            `contrast(${round(1 - 0.07 * i)}) brightness(${round(1 - 0.05 * i)})`
        );
    }
    // paper
    return (
        `sepia(${round(0.35 * i)}) contrast(${round(1 - 0.06 * i)}) ` +
        `brightness(${round(1 - 0.03 * i)})`
    );
}

// Chrome's PDF viewer wrapper document (the whole tab IS the PDF).
function isPdfViewerDocument() {
    return document.contentType === 'application/pdf';
}

function cssFor(theme, i) {
    const target = isPdfViewerDocument() ? 'html' : EMBED_SELECTOR;
    let css = `${target} { filter: ${filterFor(theme, i)} !important; }\n`;
    if (theme !== 'dark') {
        // Subtle paper grain over the light themes.
        css +=
            'body::before { content: ""; position: fixed; inset: 0; ' +
            'pointer-events: none; z-index: 2147483647; ' +
            `background-image: ${GRAIN}; opacity: ${round(0.06 * i)}; }\n`;
    }
    return css;
}

let styleNode = null;
let currentFilter = '';

function ensureStyleNode() {
    if (!styleNode || !styleNode.isConnected) {
        styleNode = document.createElement('style');
        styleNode.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(styleNode);
    }
    return styleNode;
}

function applyToEmbeds(filter) {
    document.querySelectorAll(EMBED_SELECTOR).forEach((embed) => {
        if (filter) {
            embed.style.setProperty('filter', filter, 'important');
        } else {
            embed.style.removeProperty('filter');
        }
    });
}

function applySettings({ enabled, theme, intensity }) {
    if (!enabled) {
        currentFilter = '';
        if (styleNode) styleNode.textContent = '';
        document.documentElement.style.removeProperty('filter');
        applyToEmbeds('');
        return;
    }
    currentFilter = filterFor(theme, intensity / 100);
    ensureStyleNode().textContent = cssFor(theme, intensity / 100);
    if (isPdfViewerDocument()) {
        document.documentElement.style.setProperty('filter', currentFilter, 'important');
    } else {
        applyToEmbeds(currentFilter);
    }
}

function refresh() {
    chrome.storage.sync.get(null, (raw) => {
        applySettings(normalizeSettings(raw));
    });
}

if (isPdf()) {
    refresh();

    // The viewer's <embed> can be (re)attached after document_end.
    new MutationObserver(() => {
        if (currentFilter) applyToEmbeds(currentFilter);
    }).observe(document.documentElement, { childList: true, subtree: true });

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
