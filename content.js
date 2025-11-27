// Content script
console.log('Gentle Page PDF: Content script loaded');

// Check if the current page is a PDF
function isPdf() {
    return document.contentType === 'application/pdf' || document.querySelector('embed[type="application/pdf"]');
}

// Apply styles based on settings
function applyStyles(settings) {
    if (!settings.isEnabled) {
        document.documentElement.classList.remove('gentle-page-pdf-enabled');
        document.documentElement.classList.remove('gentle-page-pdf-light');
        document.documentElement.classList.remove('gentle-page-pdf-dark');
        return;
    }

    document.documentElement.classList.add('gentle-page-pdf-enabled');
    if (settings.theme === 'dark') {
        document.documentElement.classList.add('gentle-page-pdf-dark');
        document.documentElement.classList.remove('gentle-page-pdf-light');
    } else {
        document.documentElement.classList.add('gentle-page-pdf-light');
        document.documentElement.classList.remove('gentle-page-pdf-dark');
    }
}

// Initialize
chrome.storage.sync.get(['isEnabled', 'theme'], (settings) => {
    if (isPdf()) {
        console.log('Gentle Page PDF: PDF detected');
        applyStyles(settings);
    }
});

// Listen for changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        chrome.storage.sync.get(['isEnabled', 'theme'], (settings) => {
            applyStyles(settings);
        });
    }
});
