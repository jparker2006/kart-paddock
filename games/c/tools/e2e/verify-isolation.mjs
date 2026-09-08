/**
 * Verifies room isolation: two separate rooms racing at the same time; each
 * client only sees its own room's players, and state batches don't cross.
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
const log = (...m) => console.log('[isolation]', ...m);

const browser = await chromium.launch({
  headless: false,
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=IntensiveWakeUpThrottling',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 900, height: 640 } });

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

// Room A
const a1 = await freshPage('Alice', 0);
await a1.click('#btn-create');
await a1.waitForSelector('#room-code');
const codeA = (await a1.textContent('#room-code')).trim();
const a2 = await freshPage('Ash', 1);
await a2.goto(`http://localhost:5173/?room=${codeA}`, { waitUntil: 'domcontentloaded' });
await a2.waitForSelector('#btn-join');
await a2.click('#btn-join');
await sleep(600);

// Room B
const b1 = await freshPage('Bob', 2);
await b1.click('#btn-create');
await b1.waitForSelector('#room-code');
const codeB = (await b1.textContent('#room-code')).trim();
const b2 = await freshPage('Bea', 3);
await b2.goto(`http://localhost:5173/?room=${codeB}`, { waitUntil: 'domcontentloaded' });
await b2.waitForSelector('#btn-join');
await b2.click('#btn-join');
await sleep(600);

log(`room A=${codeA}, room B=${codeB}`);
const seatsA = (await a1.textContent('#lobby-players')).replace(/\s+/g, ' ');
const seatsB = (await b1.textContent('#lobby-players')).replace(/\s+/g, ' ');
log('A sees:', seatsA);
log('B sees:', seatsB);

const isolatedLobby = seatsA.includes('Alice') && !seatsA.includes('Bob') && seatsB.includes('Bob') && !seatsB.includes('Alice');
log(isolatedLobby ? 'lobby isolation ✓' : 'LOBBY LEAK ✗');

// start both races
await a1.click('#btn-start');
await sleep(1500);
await b1.click('#btn-start');
await sleep(7000);
for (const pg of [a1, a2, b1, b2]) {
  await pg.evaluate(BOT_JS);
  await pg.evaluate(() => window.__bot(1)); // one lap is enough here
}
await sleep(15000);

// each client's standings must contain only its room's players
const rowsA = await a1.evaluate(() => document.getElementById('hud-standings').innerText.replace(/\s+/g, ' '));
const rowsB = await b1.evaluate(() => document.getElementById('hud-standings').innerText.replace(/\s+/g, ' '));
log('A standings:', rowsA);
log('B standings:', rowsB);
const isolatedRace = rowsA.includes('Alice') && rowsA.includes('Ash') && !rowsA.includes('Bob') && !rowsA.includes('Bea') && rowsB.includes('Bob') && rowsB.includes('Bea') && !rowsB.includes('Alice') && !rowsB.includes('Ash');
log(isolatedRace ? 'race isolation ✓' : 'RACE LEAK ✗');

console.log(isolatedLobby && isolatedRace ? 'ISOLATION VERIFIED ✓' : 'ISOLATION FAILED ✗');
await browser.close();
process.exit(isolatedLobby && isolatedRace ? 0 : 1);
