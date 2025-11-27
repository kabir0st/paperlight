// Background service worker
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.set({
        isEnabled: false,
        theme: 'light' // 'light' or 'dark'
    });
    console.log('Gentle Page PDF Extension Installed');
});
