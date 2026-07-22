// Regenerates every image in docs/screenshots/.
//
// The popup and the in-page card are captured from the real extension, loaded
// unpacked into a Chromium-based browser, so they cannot drift from what ships.
// The theme shots render a real PDF with pdf.js and then apply the exact filter
// string content.js produces, read out of content.js at runtime for the same
// reason.
//
// One-off setup (deliberately not a project dependency):
//   npm install --no-save puppeteer-core
//   node tools/capture-screenshots.mjs [path/to/sample.pdf]
//
// Set BROWSER to override the detected Chrome/Chromium/Brave binary.

import puppeteer from 'puppeteer-core';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = `${EXT}/docs/screenshots`;
const PDF = process.argv[2] || `${EXT}/docs/screenshots/sample.pdf`;

const CANDIDATES = [
    process.env.BROWSER,
    '/opt/brave.com/brave/brave',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
].filter(Boolean);
const BROWSER = CANDIDATES.find((p) => existsSync(p));

if (!BROWSER) throw new Error(`No browser found. Tried:\n  ${CANDIDATES.join('\n  ')}`);
if (!existsSync(PDF)) {
    throw new Error(
        `No sample PDF at ${PDF}.\nPass one as an argument, or drop one at that path.\n` +
        'Use a document you are happy to publish: these end up in a public README.'
    );
}
mkdirSync(OUT, { recursive: true });

// Pull filterFor() straight out of content.js rather than copying the numbers.
const src = readFileSync(`${EXT}/content.js`, 'utf8');
const slice = src.slice(
    src.indexOf('function round(n)'),
    src.indexOf("// Chrome's PDF viewer wrapper")
);
const filterFor = new Function(`${slice}; return filterFor;`)();

const PDF_B64 = readFileSync(PDF).toString('base64');
const PDFJS = 'https://unpkg.com/pdfjs-dist@6.1.200/build/pdf.min.mjs';

// Renders page 1 of the sample PDF into a canvas sized by `scale`.
async function renderPdf(page, scale) {
    await page.goto('about:blank');
    await page.evaluate(
        async (b64, scl, pdfjsUrl) => {
            const mod = await import(pdfjsUrl);
            mod.GlobalWorkerOptions.workerSrc = pdfjsUrl.replace('pdf.min.mjs', 'pdf.worker.min.mjs');
            const raw = atob(b64);
            const data = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
            const pdf = await mod.getDocument({ data }).promise;
            const p = await pdf.getPage(1);
            const viewport = p.getViewport({ scale: scl });
            const canvas = document.createElement('canvas');
            canvas.id = 'page';
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            Object.assign(document.body.style, {
                margin: '0', background: '#ffffff', display: 'flex',
                justifyContent: 'center', alignItems: 'flex-start',
                height: '100vh', overflow: 'hidden'
            });
            document.body.appendChild(canvas);
            await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        },
        PDF_B64, scale, PDFJS
    );
}

const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: 'new',
    args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        '--no-sandbox',
        '--no-first-run'
    ]
});

// ------------------------------------------------------------------ popup
const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker', {
    timeout: 30000
});
const extId = new URL(swTarget.url()).host;

const popup = await browser.newPage();
await popup.setViewport({ width: 340, height: 900, deviceScaleFactor: 2 });
await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'load' });
await popup.evaluate(() => new Promise((done) => {
    chrome.storage.sync.set(
        {
            enabled: true, theme: 'dark', intensity: 80,
            voice: 'fluent', kokoroSpeaker: 'af_nicole', kokoroSpeed: 1, volume: 100
        },
        () => chrome.storage.local.set({ ttsReady_fluent: true }, done)
    );
}));
await popup.reload({ waitUntil: 'load' });
await popup.evaluate(() => { document.getElementById('voice-options').open = true; });
await new Promise((r) => setTimeout(r, 400));
await (await popup.$('.popup')).screenshot({ path: `${OUT}/popup.png` });
console.log('popup.png');

// ------------------------------------------------------------------ themes
// Cropped to the top of the page so the text stays legible as a thumbnail.
const themes = await browser.newPage();
await themes.setViewport({ width: 700, height: 900, deviceScaleFactor: 1.5 });
await renderPdf(themes, 1.0);
for (const theme of ['paper', 'sepia', 'dark']) {
    const filter = filterFor(theme, 0.8);
    await themes.evaluate((f) => { document.documentElement.style.filter = f; }, filter);
    await new Promise((r) => setTimeout(r, 250));
    await (await themes.$('#page')).screenshot({
        path: `${OUT}/theme-${theme}.png`,
        clip: { x: 0, y: 0, width: 612, height: 430 }
    });
    console.log(`theme-${theme}.png   ${filter}`);
}

// ------------------------------------------------------------------- hero
// 1280x800 at scale 1 is exactly the Chrome Web Store screenshot size, so this
// file doubles as the store asset.
const hero = await browser.newPage();
await hero.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await renderPdf(hero, 1.15);
await hero.evaluate((f) => { document.documentElement.style.filter = f; }, filterFor('dark', 0.8));
await new Promise((r) => setTimeout(r, 300));
await hero.screenshot({ path: `${OUT}/hero.png` });
console.log('hero.png');

// ------------------------------------------------------------ reading card
const card = await browser.newPage();
// hud.js mirrors the stored reading theme, so this comes out as the dark card
// because the popup step above saved theme: 'dark'. Change that to 'paper' if
// you want the cream variant.
//
// The HUD stops its pulsing dot under reduced-motion, which keeps the capture
// from catching the dot mid-fade.
await card.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await card.setViewport({ width: 900, height: 600, deviceScaleFactor: 2 });
await card.goto('https://example.com', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 1200));

const sw = await swTarget.worker();
await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://example.com/*' });
    for (const t of tabs) {
        await chrome.tabs.sendMessage(t.id, {
            type: 'gentle-hud',
            state: {
                phase: 'speaking', voice: 'fluent',
                detail: 'page 3 of 12, sentence 2/7', paused: false, at: 1
            }
        }).catch(() => {});
    }
});
await new Promise((r) => setTimeout(r, 800));
const el = await card.$('div#gentle-page-pdf-hud >>> .card');
if (el) {
    await el.screenshot({ path: `${OUT}/reading.png` });
    console.log('reading.png');
} else {
    console.warn('reading.png SKIPPED: HUD card not found');
}

await browser.close();
console.log('\nDone. Six files in docs/screenshots/');
