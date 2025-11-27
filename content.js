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

// Inject SVG Filters
function injectSvgFilters() {
    if (document.getElementById('gentle-page-pdf-filters')) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'gentle-page-pdf-filters';
    svg.style.display = 'none';
    svg.innerHTML = `
    <defs>
      <!-- Light Mode Filter: Lifts blacks to dark gray for softer text -->
      <filter id="gentle-light-mode">
        <feColorMatrix type="matrix" values="
          0.85 0 0 0 0.15
          0 0.85 0 0 0.15
          0 0 0.85 0 0.15
          0 0 0 1 0
        "/>
      </filter>

      <!-- Dark Mode Filter: Maps White to Charcoal, Black to Cream -->
      <filter id="gentle-dark-mode">
        <feColorMatrix type="matrix" values="
          -0.85 0 0 0 0.95
          0 -0.85 0 0 0.95
          0 0 -0.85 0 0.95
          0 0 0 1 0
        "/>
      </filter>
    </defs>
  `;
    document.body.appendChild(svg);
}

// Initialize
chrome.storage.sync.get(['isEnabled', 'theme'], (settings) => {
    if (isPdf()) {
        console.log('Gentle Page PDF: PDF detected');
        injectSvgFilters();
        applyStyles(settings);
    }
});

// Listen for changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        chrome.storage.sync.get(['isEnabled', 'theme'], (settings) => {
            injectSvgFilters();
            applyStyles(settings);
        });
    }
});
