import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('/Users/jakeparker/.claude/skills/gstack/node_modules/playwright-core'));
} catch {
  ({ chromium } = require('playwright-core'));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOT_JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bot.js'), 'utf8');
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
const page2 = await ctx.newPage();
await page2.goto(`http://localhost:5173/?room=${code}`, { waitUntil: 'domcontentloaded' });
await page2.waitForSelector('#btn-join');
await page2.click('#btn-join');
await sleep(800);
await page.click('#btn-start');
await sleep(7000);
await page.evaluate(BOT_JS);
await page.evaluate(() => window.__bot(3));
for (let i = 0; i < 14; i++) {
  await sleep(2500);
  const s = await page.evaluate(() => JSON.stringify(window.__botState().log.slice(-1)[0]));
  console.log(i, s);
}
await browser.close();
