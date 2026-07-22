// Gentle Page PDF — service worker.
// Fills in default settings without clobbering anything the user
// already saved (including values from v1.x, which are migrated
// on read by the content script and popup).

const DEFAULTS = {
    enabled: false,
    theme: 'paper', // 'paper' | 'sepia' | 'dark'
    intensity: 80 // 0–100
};

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get(null, (existing) => {
        const missing = {};
        for (const [key, value] of Object.entries(DEFAULTS)) {
            if (existing[key] === undefined) missing[key] = value;
        }
        // Respect the v1.x enable flag if it is all we have.
        if (missing.enabled !== undefined && existing.isEnabled !== undefined) {
            missing.enabled = existing.isEnabled === true;
        }
        if (Object.keys(missing).length > 0) {
            chrome.storage.sync.set(missing);
        }
    });
});
