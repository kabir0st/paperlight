document.addEventListener('DOMContentLoaded', () => {
    const enableToggle = document.getElementById('enable-toggle');
    const lightBtn = document.getElementById('light-btn');
    const darkBtn = document.getElementById('dark-btn');

    // Load saved settings
    chrome.storage.sync.get(['isEnabled', 'theme'], (data) => {
        enableToggle.checked = data.isEnabled === true; // Default to false
        updateThemeButtons(data.theme || 'light');
    });

    // Enable toggle handler
    enableToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ isEnabled: enableToggle.checked });
    });

    // Theme button handlers
    lightBtn.addEventListener('click', () => {
        setTheme('light');
    });

    darkBtn.addEventListener('click', () => {
        setTheme('dark');
    });

    function setTheme(theme) {
        chrome.storage.sync.set({ theme: theme });
        updateThemeButtons(theme);
    }

    function updateThemeButtons(activeTheme) {
        if (activeTheme === 'dark') {
            darkBtn.classList.add('active');
            lightBtn.classList.remove('active');
        } else {
            lightBtn.classList.add('active');
            darkBtn.classList.remove('active');
        }
    }
});
