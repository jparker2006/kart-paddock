import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('/Users/jakeparker/.claude/skills/gstack/node_modules/playwright-core'));
} catch {
  ({ chromium } = require('playwright-core'));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  headless: false,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=IntensiveWakeUpThrottling',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('harvest-rush:name', 'Solo');
  localStorage.setItem('harvest-rush:char', '0');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#name-input');
await page.click('#btn-create');
await page.waitForSelector('#room-code');
const code = (await page.textContent('#room-code')).trim();
console.log('room', code, '- P2 joining, starting race');
const page2 = await ctx.newPage();
await page2.goto(`http://localhost:5173/?room=${code}`, { waitUntil: 'domcontentloaded' });
await page2.waitForSelector('#btn-join');
await page2.click('#btn-join');
await sleep(800);
await page.click('#btn-start');
await sleep(7000);
const before = await page.evaluate(() => (window.__hr ? JSON.stringify(window.__hr.getKart()) : 'NO __hr'));
console.log('before:', before);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })));
await sleep(3000);
const after = await page.evaluate(() => JSON.stringify(window.__hr.getKart()));
console.log('after 3s hold w:', after);
// rAF check
const raf = await page.evaluate(
  () =>
    new Promise((r) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => {
        n++;
        if (n < 20 && performance.now() - t0 < 2000) requestAnimationFrame(f);
        else r(`${n} frames in ${Math.round(performance.now() - t0)}ms vis=${document.visibilityState}`);
      };
      requestAnimationFrame(f);
    })
);
console.log('rAF:', raf);
await browser.close();
