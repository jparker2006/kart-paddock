/**
 * E2E test harness for Harvest Rush: launches N real Chromium clients,
 * creates/joins a room, starts a race, drives every client with the
 * in-page autopilot and verifies the shared race state.
 *
 * Usage: node tools/e2e/run-race.mjs [--players 3] [--url http://localhost:5173/]
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

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : [])).filter(Boolean)
);
const PLAYERS = Number(args.players ?? 3);
const URL = args.url ?? 'http://localhost:5173/';
const BOT_JS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bot.js'), 'utf8');

const launchArgs = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-features=IntensiveWakeUpThrottling',
  '--window-size=1100,760',
];

const log = (...m) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshPage(ctx, name, charIdx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`PAGE ERROR ${name}:`, e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ([n, c]) => {
      localStorage.setItem('harvest-rush:name', n);
      localStorage.setItem('harvest-rush:char', String(c));
    },
    [name, charIdx]
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#name-input', { timeout: 10000 });
  return page;
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: launchArgs });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });

  log('booting host');
  const pages = [];
  const host = await freshPage(ctx, 'Maple', 0);
  pages.push(host);
  await host.click('#btn-create');
  await host.waitForSelector('#room-code', { timeout: 10000 });
  const code = (await host.textContent('#room-code')).trim();
  log('room', code);

  for (let i = 2; i <= PLAYERS; i++) {
    const p = await freshPage(ctx, `P${i}`, i % 8);
    pages.push(p);
    await p.goto(`${URL}?room=${code}`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-join', { timeout: 10000 });
    await p.click('#btn-join');
    await sleep(700);
    log(`P${i} joined`);
  }

  // verify lobby seats
  await sleep(500);
  const seats = await host.textContent('#lobby-players');
  log('seats:', seats.replace(/\s+/g, ' ').trim());

  await host.click('#btn-start');
  log('race started');
  await sleep(1500);

  // inject the bot into every client
  for (let i = 0; i < pages.length; i++) {
    await pages[i].evaluate(BOT_JS);
    await pages[i].evaluate(() => window.__bot(3));
  }
  log('bots driving');

  const deadline = Date.now() + (args.timeout ? Number(args.timeout) * 1000 : 420000);
  let lastReport = 0;
  let resultsSeen = false;
  const kartLogs = pages.map(() => []);
  while (Date.now() < deadline) {
    await sleep(3000);
    const states = [];
    for (let i = 0; i < pages.length; i++) {
      const k = await pages[i]
        .evaluate(() => (window.__hr ? window.__hr.getKart() : null))
        .catch(() => null);
      kartLogs[i].push(k);
      states.push(k);
    }
    if (Date.now() - lastReport > 15000 || states.every((s) => s && s.lap >= 3)) {
      log(
        'state:',
        states.map((s, i) => `P${i + 1}:${s ? `L${s.lap}+${s.cps}cps@(${Math.round(s.x)},${Math.round(s.z)})sp${Math.round(s.speed)}` : 'dead'}`).join(' ')
      );
      lastReport = Date.now();
    }
    const allDone = states.every((s) => s && s.lap >= 3);
    const overlay = resultsSeen
      ? false
      : await pages[0].evaluate(() => !document.getElementById('screen-results').classList.contains('hidden')).catch(() => false);
    if ((allDone || overlay) && !resultsSeen) {
      // wait for the results overlay
      for (let w = 0; w < 80; w++) {
        await sleep(1000);
        const visible = await pages[0].evaluate(() => !document.getElementById('screen-results').classList.contains('hidden')).catch(() => false);
        if (visible) break;
      }
      const rows = await pages[0].evaluate(() => document.getElementById('results-rows').innerText.replace(/\n+/g, ' | '));
      log('RESULTS:', rows);
      // verify all clients agree
      for (let i = 1; i < pages.length; i++) {
        const rowsI = await pages[i].evaluate(() => document.getElementById('results-rows').innerText.replace(/\n+/g, ' | '));
        if (rowsI !== rows) log(`MISMATCH client ${i + 1}: ${rowsI}`);
      }
      log('results consistent across clients ✓');
      resultsSeen = true;
      if (!args.rematch) break;
      // ---- rematch flow ----
      try {
        log('host clicking rematch…');
        await host.click('#btn-rematch');
        for (const pg of pages) {
          await pg.evaluate(BOT_JS).catch(() => {});
          await pg.evaluate(() => window.__bot(3)).catch(() => {});
        }
        let rematchOk = false;
        for (let w = 0; w < 45; w++) {
          await sleep(2000);
          const ks = [];
          for (const pg of pages) {
            ks.push(await pg.evaluate(() => (window.__hr ? window.__hr.getKart() : null)).catch(() => null));
          }
          if (w % 5 === 0) log('rematch poll:', JSON.stringify(ks.map((k) => (k ? { ph: k.phase, lk: k.locked, sp: Math.round(k.speed), lap: k.lap } : null))));
          if (ks.every((k) => k && !k.locked && k.phase === 'racing' && Math.abs(k.speed) > 3)) {
            log('REMATCH RACING ✓ all clients in the second race:', JSON.stringify(ks.map((k) => ({ sp: Math.round(k.speed), lap: k.lap }))));
            rematchOk = true;
            break;
          }
        }
        if (!rematchOk) log('REMATCH FAILED ✗ (no client reached racing state)');
      } catch (e) {
        log('REMATCH ERROR:', e.message);
      }
      break;
    }
    if (states.every((s) => s && s.speed < 0.5 && s.lap < 3 && Date.now() - lastReport > 60000)) {
      log('WARNING: karts may be stuck');
      await pages[0].screenshot({ path: '/tmp/e2e-stuck.png' });
    }
  }
  if (!resultsSeen) log('TIMEOUT waiting for results');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
