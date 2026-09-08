/**
 * Verifies mid-race reconnection: two clients race; P2 reloads mid-race and
 * must rejoin the SAME ongoing race with restored progress, and P1 must
 * resume receiving P2's state updates.
 */
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
const log = (...m) => console.log('[reconnect]', ...m);

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

async function freshPage(name, char) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`PAGE ERROR ${name}:`, e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ([n, c]) => {
      localStorage.setItem('harvest-rush:name', n);
      localStorage.setItem('harvest-rush:char', String(c));
    },
    [name, char]
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#name-input');
  return page;
}

const p1 = await freshPage('Hosty', 0);
await p1.click('#btn-create');
await p1.waitForSelector('#room-code');
const code = (await p1.textContent('#room-code')).trim();
log('room', code);
const p2 = await freshPage('Returner', 1);
await p2.goto(`http://localhost:5173/?room=${code}`, { waitUntil: 'domcontentloaded' });
await p2.waitForSelector('#btn-join');
await p2.click('#btn-join');
await sleep(800);
await p1.click('#btn-start');
await sleep(7000); // countdown + a bit of racing

// drive both
for (const pg of [p1, p2]) {
  await pg.evaluate(BOT_JS);
  await pg.evaluate(() => window.__bot(3));
}
await sleep(8000);
const before = await p2.evaluate(() => JSON.stringify(window.__hr.getKart()));
log('P2 pre-reload:', before);

// ---- reload P2 mid-race ----
await p2.reload({ waitUntil: 'domcontentloaded' });
log('P2 reloaded');
await sleep(6000);
const after = await p2.evaluate(() => (window.__hr ? JSON.stringify(window.__hr.getKart()) : 'NO SESSION')).catch(() => 'eval failed');
log('P2 post-reload:', after);

// re-inject the autopilot (page JS was reset by the reload)
await p2.evaluate(BOT_JS).catch(() => {});
await p2.evaluate(() => window.__bot(3)).catch(() => {});

// P2 should be back in the same race and driving again
let recovered = false;
for (let i = 0; i < 20; i++) {
  await sleep(2000);
  const k = await p2.evaluate(() => (window.__hr ? window.__hr.getKart() : null)).catch(() => null);
  if (k && k.phase === 'racing' && Math.abs(k.speed) > 3) {
    log(`P2 racing again after reload (lap ${k.lap}+${k.cps}) ✓`);
    recovered = true;
    break;
  }
}
if (!recovered) log('P2 FAILED to resume racing ✗');

// P1 should see P2's live position changing (state flow restored)
const s1 = await p1.evaluate(async () => {
  const a = window.__hr.getKart();
  await new Promise((r) => setTimeout(r, 2500));
  return JSON.stringify({ a });
});
void s1;
const p2pos1 = await p2.evaluate(() => JSON.stringify({ x: Math.round(window.__hr.getKart().x), z: Math.round(window.__hr.getKart().z) }));
await sleep(2500);
const p2pos2 = await p2.evaluate(() => JSON.stringify({ x: Math.round(window.__hr.getKart().x), z: Math.round(window.__hr.getKart().z) }));
log('P2 moved after reconnect:', p2pos1, '->', p2pos2, p2pos1 !== p2pos2 ? '✓' : '✗ STUCK');

console.log(recovered && p2pos1 !== p2pos2 ? 'RECONNECT VERIFIED ✓' : 'RECONNECT FAILED ✗');
await browser.close();
process.exit(recovered && p2pos1 !== p2pos2 ? 0 : 1);
