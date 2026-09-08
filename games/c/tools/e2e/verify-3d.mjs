/**
 * Verifies the two 3D track features with a bot-driven client:
 *  1. THE JUMP — a >600ms airborne flight over the Cider Creek gap that lands
 *     on the landing road on the far side.
 *  2. THE OVERPASS — the kart drives the start straight UNDER the deck
 *     (y < 1.5 near the apex plan position) and also drives the deck above
 *     (y > 5 on the approach).
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
  localStorage.setItem('harvest-rush:name', 'Jumper');
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

let jumpFlight = null;
const flightLog = [];
let bestFlight = null;
let maxAir = 0;
let underY = null;
let overY = null;
const deadline = Date.now() + 220000;
while (Date.now() < deadline) {
  await sleep(150);
  const k = await page.evaluate(() => window.__hr.getKart()).catch(() => null);
  if (!k) continue;
  // the creek gap: road absent between crest (5,102.6) and landing (-19,100)
  const overGap = k.x > -34 && k.x < 9 && k.z > 92 && k.z < 112;
  if (overGap && !k.grounded) {
    if (!jumpFlight) jumpFlight = { t: Date.now(), splash: false };
    maxAir = Math.max(maxAir, k.y);
    if (k.y < -2) jumpFlight.splash = true;
    flightLog.push({ x: +k.x.toFixed(1), z: +k.z.toFixed(1), y: +k.y.toFixed(1), g: k.grounded ? 1 : 0, sp: Math.round(k.speed) });
  } else if (overGap) {
    flightLog.push({ x: +k.x.toFixed(1), z: +k.z.toFixed(1), y: +k.y.toFixed(1), g: 1, sp: Math.round(k.speed) });
  }
  if (jumpFlight && k.grounded) {
    const dur = Date.now() - jumpFlight.t;
    if (dur > 600 && !jumpFlight.splash && k.x < -17 && k.z > 90 && k.z < 112 && k.y < 3) {
      bestFlight = { durMs: dur, landedX: +k.x.toFixed(1), landedZ: +k.z.toFixed(1), landedY: +k.y.toFixed(1) };
    }
    jumpFlight = null;
  }
  // under the overpass on the start straight
  if (Math.abs(k.x + 18) < 6 && Math.abs(k.z) < 8 && k.grounded) {
    underY = underY === null ? k.y : Math.min(underY, k.y);
  }
  // on the overpass deck itself (approach region around the apex)
  if (k.x > -60 && k.x < -30 && k.z > 10 && k.z < 45 && k.grounded && k.y > 4.5) {
    overY = Math.max(overY ?? 0, k.y);
  }
  if (k.lap >= 2 && bestFlight) break;
}
const air = await page.evaluate(() => ({
  airSec: window.__hr.getKart().airSec,
  maxAirHeight: window.__hr.getKart().maxAirHeight,
}));
console.log('FLIGHTLOG:', JSON.stringify(flightLog.slice(0, 60)));
console.log('JUMP:', JSON.stringify({ bestFlight, maxAirOverCreek: maxAir && +maxAir.toFixed(2) }));
console.log('OVERPASS:', JSON.stringify({ underDeckY: underY !== null ? +underY.toFixed(2) : null, onDeckMaxY: overY !== null ? +overY.toFixed(2) : null }));
console.log('AIRTIME TOTAL:', JSON.stringify(air));
const jumpOk = !!bestFlight && bestFlight.durMs > 600 && bestFlight.landedX < -18;
const overOk = underY !== null && underY < 1.5 && overY !== null && overY > 5;
console.log(jumpOk ? 'JUMP VERIFIED ✓' : 'JUMP FAILED ✗');
console.log(overOk ? 'OVERPASS VERIFIED ✓ (drove under deck y<1.5 and on deck y>5)' : 'OVERPASS CHECK INCOMPLETE ✗');
await browser.close();
process.exit(jumpOk && overOk ? 0 : 1);
