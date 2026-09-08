/**
 * Lap-integrity checks with direct key control (no autopilot):
 *  1. Reverse back and forth across the finish line -> no laps, no cps.
 *  2. Drive forward over the line at race start -> still lap 0 cps 0
 *     (the first crossing starts the race, it does not complete a lap).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('/Users/jakeparker/.claude/skills/gstack/node_modules/playwright-core'));
} catch {
  ({ chromium } = require('playwright-core'));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log('[lapcheck]', ...m);

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
page.on('pageerror', (e) => log('PAGE ERROR:', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('harvest-rush:name', 'Reverser');
  localStorage.setItem('harvest-rush:char', '0');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#name-input');
await page.click('#btn-create');
await page.waitForSelector('#room-code');
const code = (await page.textContent('#room-code')).trim();
const page2 = await ctx.newPage();
await page2.goto(`http://localhost:5173/?room=${code}`, { waitUntil: 'domcontentloaded' });
await page2.waitForSelector('#btn-join');
await page2.click('#btn-join');
await sleep(800);
await page.click('#btn-start');
await sleep(7200); // countdown + GO

const kd = (k) => page.evaluate((key) => window.dispatchEvent(new KeyboardEvent('keydown', { key })), k);
const ku = (k) => page.evaluate((key) => window.dispatchEvent(new KeyboardEvent('keyup', { key })), k);

// drive forward across the line, then reverse back across, then forward again
const states = [];
for (let i = 0; i < 4; i++) {
  // forward
  await kd('w');
  await sleep(2600);
  await ku('w');
  // reverse
  await kd('s');
  await sleep(2400);
  await ku('s');
  const k = await page.evaluate(() => window.__hr.getKart());
  states.push({ x: +k.x.toFixed(1), lap: k.lap, cps: k.cps });
  log(`cycle ${i + 1}:`, JSON.stringify(states[i]));
}
const ok = states.every((s) => s.lap === 0 && s.cps === 0);
log(ok ? 'NO FALSE LAPS ✓ (reverse + forward crossings never counted)' : 'FALSE LAP DETECTED ✗');
await browser.close();
process.exit(ok ? 0 : 1);
