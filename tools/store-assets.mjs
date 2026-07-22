// Generates the Chrome Web Store listing images into store/.
//
//   5 screenshots    1280x800
//   small promo      440x280
//   marquee promo    1400x560
//
// All are 24-bit PNG with no alpha channel, which is what the store requires.
// Chromium writes opaque RGB PNGs when the page has a background, and the
// script verifies the colour type of every file before exiting.
//
// Setup:
//   npm install --no-save puppeteer-core
//   node tools/store-assets.mjs

import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = `${ROOT}/docs/screenshots`;
const OUT = `${ROOT}/store`;

const BROWSER = [
    process.env.BROWSER,
    '/opt/brave.com/brave/brave',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
].filter(Boolean).find((p) => existsSync(p));
if (!BROWSER) throw new Error('No Chromium-based browser found. Set BROWSER=/path/to/binary');

for (const f of ['theme-paper.png', 'theme-sepia.png', 'theme-dark.png', 'popup.png', 'reading.png']) {
    if (!existsSync(`${SHOTS}/${f}`)) {
        throw new Error(`Missing ${SHOTS}/${f}. Run tools/capture-screenshots.mjs first.`);
    }
}
mkdirSync(OUT, { recursive: true });

// The page is written into docs/screenshots/ and loaded over file://, so these
// stay relative. A setContent() page sits on about:blank, which cannot pull in
// file:// subresources at all.
const img = (n) => n;

// The stacked-sheets mark, built from the same three theme swatches the popup
// uses for its theme picker. Deliberately not the old banana logo.
// Only the front sheet carries the "Aa". Lettering on the sheets behind it
// peeks out through the gaps and reads as garbled text.
const mark = (size) => `
<div class="mark" style="--m:${size}px">
  <span class="sh dk"></span><span class="sh sp"></span><span class="sh pa">Aa</span>
</div>`;

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#888}
.cv{position:relative;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Ubuntu,sans-serif;
    color:#2b2a26;display:flex}
.w1280{width:1280px;height:800px}
.w440{width:440px;height:280px}
.w1400{width:1400px;height:560px}
.cream{background:#faf9f6}
.warm{background:#f1efe8}
.ink{background:#1c1b19;color:#f0ece3}
h1{font-family:Georgia,'Times New Roman',serif;font-weight:600;letter-spacing:-0.01em;line-height:1.08}
.eyebrow{font-size:15px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#8b8574}
.ink .eyebrow{color:#8f887a}
.sub{font-size:25px;line-height:1.5;color:#6d6858;font-weight:400}
.ink .sub{color:#a8a094}
.shot{border-radius:12px;border:1px solid rgba(0,0,0,.10);box-shadow:0 26px 60px rgba(20,19,17,.30)}
.ink .shot{border-color:#3a3833;box-shadow:0 26px 70px rgba(0,0,0,.6)}

/* stacked sheet mark */
.mark{position:relative;width:calc(var(--m)*1.30);height:var(--m);flex:none}
.sh{position:absolute;top:0;width:calc(var(--m)*.74);height:var(--m);border-radius:calc(var(--m)*.12);
    display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;
    font-size:calc(var(--m)*.34);box-shadow:0 5px 16px rgba(43,42,38,.16)}
.sh.dk{left:calc(var(--m)*.56);background:#232323;transform:rotate(8deg)}
.sh.sp{left:calc(var(--m)*.30);background:#efe0c4;transform:rotate(4deg)}
.sh.pa{left:0;background:#f6efe3;color:#3b3630;border:1px solid #e7e4dc}

.wordmark{font-family:Georgia,serif;font-weight:600;letter-spacing:-0.015em}
.pill{display:inline-flex;align-items:center;gap:9px;padding:9px 17px;border-radius:999px;
      background:#fff;border:1px solid #e7e4dc;font-size:19px;color:#4a463c}
.dot{width:9px;height:9px;border-radius:50%;background:#3e7b4f;flex:none}
`;

// ------------------------------------------------------------------ slides
const SLIDES = [
{ id: 'screenshot-1-dark', w: 1280, h: 800, html: `
<div class="cv w1280 ink" style="align-items:center;gap:56px;padding:0 0 0 84px">
  <div style="width:470px;flex:none">
    <div class="eyebrow" style="margin-bottom:24px">Paperlight</div>
    <h1 style="font-size:63px;margin-bottom:26px">Read PDFs<br>without the glare</h1>
    <p class="sub">Chrome's PDF viewer is a wall of white. Turn it to paper,
       sepia, or a true dark mode, and dial the strength to taste.</p>
  </div>
  <img class="shot" src="${img('theme-dark.png')}" style="width:600px">
</div>`},

{ id: 'screenshot-2-themes', w: 1280, h: 800, html: `
<div class="cv w1280 cream" style="flex-direction:column;align-items:center;justify-content:center;padding:0 60px">
  <h1 style="font-size:57px;margin-bottom:14px">Three themes, one slider</h1>
  <p class="sub" style="margin-bottom:52px;text-align:center;max-width:800px">
     Every theme scales from barely there to full strength, and lands instantly with no page reload.</p>
  <div style="display:flex;gap:26px;align-items:flex-start">
    ${[['paper', 'Paper', 'Soft cream, blacks lifted'],
       ['sepia', 'Sepia', 'Warmer, old book tone'],
       ['dark', 'Dark', 'Charcoal page, off-white ink']]
      .map(([k, label, desc]) => `
      <div style="width:372px">
        <img class="shot" src="${img(`theme-${k}.png`)}" style="width:372px;display:block">
        <div style="font-size:26px;font-weight:700;margin:20px 0 5px">${label}</div>
        <div style="font-size:19px;color:#75705f">${desc}</div>
      </div>`).join('')}
  </div>
</div>`},

{ id: 'screenshot-3-popup', w: 1280, h: 800, html: `
<div class="cv w1280 warm" style="align-items:center;gap:70px;padding:0 84px">
  <div style="flex:1">
    <h1 style="font-size:57px;margin-bottom:26px">Every control,<br>one click away</h1>
    <p class="sub" style="margin-bottom:38px">Themes, intensity, voice, speaker, speed and volume,
       all in one small panel.</p>
    ${[['Works on any PDF, and only on PDFs', ''],
       ['Settings follow your Chrome profile', ''],
       ['Live status while a voice is reading', '']]
      .map(([t]) => `<div class="pill" style="margin:0 12px 14px 0"><span class="dot"></span>${t}</div>`).join('')}
  </div>
  <img class="shot" src="${img('popup.png')}" style="height:706px;flex:none">
</div>`},

{ id: 'screenshot-4-readaloud', w: 1280, h: 800, html: `
<div class="cv w1280 ink" style="flex-direction:column;justify-content:center;align-items:center;padding:0 84px">
  <div class="eyebrow" style="margin-bottom:22px">Read aloud</div>
  <h1 style="font-size:59px;margin-bottom:20px;text-align:center">Let it read to you</h1>
  <p class="sub" style="text-align:center;max-width:830px;margin-bottom:46px">
     Select text and right-click, or hand over the whole document.
     Four natural voices run on your own machine, offline.</p>
  <img class="shot" src="${img('reading.png')}" style="width:576px;margin-bottom:44px">
  <div style="display:flex;gap:14px">
    ${['Nicole', 'Santa', 'Isabella', 'George'].map((n) => `
      <span style="padding:12px 26px;border-radius:999px;background:#2a2926;border:1px solid #3d3b35;
                   font-size:21px;color:#e5e0d6;font-family:Georgia,serif">${n}</span>`).join('')}
  </div>
</div>`},

{ id: 'screenshot-5-privacy', w: 1280, h: 800, html: `
<div class="cv w1280 cream" style="flex-direction:column;justify-content:center;align-items:center;padding:0 84px">
  ${mark(120)}
  <h1 style="font-size:57px;margin:46px 0 20px;text-align:center">Runs entirely on your machine</h1>
  <p class="sub" style="text-align:center;max-width:860px;margin-bottom:54px">
     No account, no analytics, no server. Your PDFs and the text you select never leave your computer.</p>
  <div style="display:flex;gap:22px">
    ${[['No tracking', 'Nothing is measured, logged, or sent'],
       ['No sign-in', 'Install it and it works'],
       ['Offline voices', 'One 90 MB download, then no network at all']]
      .map(([t, d]) => `
      <div style="width:340px;background:#fff;border:1px solid #e7e4dc;border-radius:14px;padding:28px 26px">
        <div style="display:flex;align-items:center;gap:10px;font-size:24px;font-weight:700;margin-bottom:10px">
          <span class="dot"></span>${t}</div>
        <div style="font-size:19px;line-height:1.5;color:#75705f">${d}</div>
      </div>`).join('')}
  </div>
</div>`},

{ id: 'promo-small', w: 440, h: 280, html: `
<div class="cv w440 cream" style="flex-direction:column;justify-content:center;align-items:center">
  ${mark(62)}
  <div class="wordmark" style="font-size:43px;margin:22px 0 9px">Paperlight</div>
  <div style="font-size:16px;color:#75705f;text-align:center;line-height:1.45">
     PDF dark mode, sepia<br>and read aloud</div>
</div>`},

{ id: 'promo-marquee', w: 1400, h: 560, html: `
<div class="cv w1400 cream" style="align-items:center;padding:0 0 0 90px;gap:40px">
  <div style="width:610px;flex:none">
    <div style="display:flex;align-items:center;gap:20px;margin-bottom:26px">
      ${mark(72)}
      <div class="wordmark" style="font-size:60px">Paperlight</div>
    </div>
    <div style="font-size:31px;line-height:1.35;color:#4a463c;margin-bottom:20px">
       Comfortable PDF reading for Chrome,<br>with voices that run offline.</div>
    <div style="font-size:20px;color:#75705f">Paper, sepia and dark themes &nbsp;·&nbsp; read aloud &nbsp;·&nbsp; no tracking</div>
  </div>
  <div style="position:relative;flex:1;height:560px">
    <img class="shot" src="${img('theme-dark.png')}"
         style="position:absolute;top:84px;left:8px;width:472px;transform:rotate(-4deg)">
    <img class="shot" src="${img('theme-paper.png')}"
         style="position:absolute;top:250px;left:206px;width:432px;transform:rotate(5deg)">
  </div>
</div>`}
];

const HTML = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
${SLIDES.map((s) => `<div id="${s.id}">${s.html}</div>`).join('\n')}`;

// ------------------------------------------------------------------ render
const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: 'new',
    args: ['--no-sandbox', '--no-first-run', '--allow-file-access-from-files', '--font-render-hinting=none']
});
const PAGE_FILE = `${SHOTS}/_store-assets.html`;
writeFileSync(PAGE_FILE, HTML);

const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 });
await page.goto(`file://${PAGE_FILE}`, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
// Every <img> must have decoded, or a slide renders with a broken-image glyph.
await page.evaluate(() => Promise.all(
    [...document.images].map((i) => (i.complete && i.naturalWidth
        ? Promise.resolve()
        : new Promise((res, rej) => { i.onload = res; i.onerror = () => rej(new Error(i.src)); })))
));
const broken = await page.evaluate(
    () => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src)
);
if (broken.length) throw new Error(`Images failed to load:\n  ${broken.join('\n  ')}`);
await new Promise((r) => setTimeout(r, 400));

for (const s of SLIDES) {
    const el = await page.$(`#${s.id} > .cv`);
    await el.screenshot({ path: `${OUT}/${s.id}.png`, optimizeForSpeed: false });
    console.log(`${s.id}.png  ${s.w}x${s.h}`);
}
await browser.close();
unlinkSync(PAGE_FILE);

// ------------------------------------------------------------------ verify
// PNG colour type 2 is truecolour with no alpha, which is what the store wants.
const NAMES = { 0: 'grayscale', 2: 'RGB 24-bit (no alpha)', 3: 'palette', 4: 'gray+alpha', 6: 'RGBA 32-bit' };
let bad = 0;
console.log('');
for (const f of readdirSync(OUT).filter((n) => n.endsWith('.png')).sort()) {
    const d = readFileSync(`${OUT}/${f}`);
    const w = d.readUInt32BE(16), h = d.readUInt32BE(20), type = d[25];
    const expect = SLIDES.find((s) => `${s.id}.png` === f);
    const sizeOk = !expect || (expect.w === w && expect.h === h);
    const alphaOk = type === 2;
    if (!sizeOk || !alphaOk) bad++;
    console.log(
        `${sizeOk && alphaOk ? 'ok  ' : 'FAIL'} ${f.padEnd(26)} ${String(w).padStart(4)}x${String(h).padEnd(4)}  ${NAMES[type] || type}`
    );
}
if (bad) throw new Error(`${bad} file(s) failed the store requirements`);
console.log('\nAll files meet the Chrome Web Store requirements.');
