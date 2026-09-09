// E2E: 3 real headless-Chrome clients — lobby, race, sync, 3 laps, results, rematch.
// Usage: node test/e2e-race.mjs [frontendUrl] [outDir]
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const FRONT_RAW = process.argv[2] ?? "http://localhost:4173/";
const FRONT = FRONT_RAW.includes("?") ? FRONT_RAW : `${FRONT_RAW}?lowfx`;
const OUT = process.argv[3] ?? "test/evidence";
mkdirSync(OUT, { recursive: true });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const errors = [];

async function newPage(browser, name) {
  // Separate browser context per client: isolated localStorage/cookies,
  // like separate computers (also prevents session cross-talk).
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on("pageerror", (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${name}] console: ${m.text()}`);
  });
  return page;
}

const state = (page) => page.evaluate(() => window.__cpr.state());
async function waitFor(page, fn, timeout, label) {
  console.log(`… waiting: ${label}`);
  await page.waitForFunction(fn, { timeout, polling: 500 }).catch((e) => {
    throw new Error(`timeout waiting: ${label} (${e.message.split("\n")[0]})`);
  });
  console.log(`  ok: ${label}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function join(page, name, code) {
  console.log(`  [${name}] goto`);
  await page.goto(FRONT, { waitUntil: "domcontentloaded", timeout: 45000 });
  console.log(`  [${name}] wait __cpr`);
  await page.waitForFunction(() => !!window.__cpr, { timeout: 30000, polling: 500 });
  console.log(`  [${name}] type/click`);
  await page.$eval("#input-name", (el, v) => { el.value = v; }, name);
  if (code) {
    await page.$eval("#input-code", (el, v) => { el.value = v; }, code);
    await page.$eval("#btn-join", (el) => el.click());
  } else {
    await page.$eval("#btn-create", (el) => el.click());
  }
  await page.waitForFunction(
    () => !document.getElementById("screen-lobby").classList.contains("hidden"),
    { timeout: 20000, polling: 500 },
  );
  return await page.$eval("#lobby-code", (el) => el.textContent);
}

const results = {};
let failed = false;
function check(label, cond, extra = "") {
  results[label] = cond ? `PASS ${extra}` : "FAIL";
  console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
  if (!cond) failed = true;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  protocolTimeout: 180000,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--window-size=1280,800",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

try {
  const A = await newPage(browser, "A");
  const B = await newPage(browser, "B");
  const C = await newPage(browser, "C");

  console.log("joining A (create)…");
  const code = await join(A, "Alpha", null);
  console.log("room:", code);
  check("room code issued", /^[A-Z0-9]{4}$/.test(code), code);
  await join(B, "Bravo", code);
  await join(C, "Charlie", code);
  await sleep(1500);
  const lobbyCount = await A.evaluate(() => document.querySelectorAll("#lobby-players li").length);
  check("lobby shows 3 players", lobbyCount === 3, `count=${lobbyCount}`);
  const link = await A.$eval("#lobby-link", (el) => el.href);
  check("share link carries room code", link.includes(`#/room/${code}`), link);
  await A.screenshot({ path: `${OUT}/lobby.png` });

  // start race (host = A)
  await A.$eval("#btn-start", (el) => el.click());
  for (const [p, n] of [[A, "A"], [B, "B"], [C, "C"]]) {
    await waitFor(p, () => window.__cpr.state().phase === "racing", 25000, `${n} racing`);
  }
  check("all 3 reach racing phase", true);
  for (const [p] of [[A], [B], [C]]) {
    await p.evaluate(() => window.__cpr.setAutopilot(true));
  }
  await sleep(20000);
  const [sa, sb, sc] = [await state(A), await state(B), await state(C)];
  check("racers see each other (2 remotes)", sa.remotes === 2 && sb.remotes === 2 && sc.remotes === 2,
    `A:${sa.remotes} B:${sb.remotes} C:${sc.remotes}`);
  check("karts moving on track", [sa, sb, sc].every((s) => s.speed > 5 && s.onTrack),
    `speeds=${[sa.speed, sb.speed, sc.speed].map((v) => v.toFixed(1))}`);
  check("all connected, none stale", [sa, sb, sc].every((s) => s.connected && s.staleSec < 5),
    `stale=${[sa.staleSec, sb.staleSec, sc.staleSec].map((v) => v.toFixed(1))}`);
  await A.screenshot({ path: `${OUT}/race.png` });

  // full-race observation: jump, bridge height, underpass level, then 3-lap finish
  let jumped = false;
  let maxY = 0;
  let minUnderY = 99;
  let maxSpeed = 0;
  for (let i = 0; i < 210; i++) {
    const s = await state(A);
    maxY = Math.max(maxY, s.y);
    maxSpeed = Math.max(maxSpeed, s.speed);
    if (s.t > 0.68 && s.t < 0.74) minUnderY = Math.min(minUnderY, s.y);
    if (s.jumps > 0) jumped = true;
    if (s.finished) break;
    await sleep(2000);
  }
  check("jump ramp launched kart (airborne over lava gap)", jumped);
  check("bridge elevation reached (~7m)", maxY > 5.5, `maxY=${maxY.toFixed(1)}`);
  check("underpass level driven (~0m)", minUnderY < 2, `minUnderY=${minUnderY.toFixed(1)}`);
  check("race speed reaches top end", maxSpeed > 24, `max=${maxSpeed.toFixed(1)}`);

  // run to full 3-lap results
  for (const [p, n] of [[A, "A"], [B, "B"], [C, "C"]]) {
    await waitFor(p, () => window.__cpr.state().finished, 420000, `${n} finished`);
  }
  check("all 3 finished 3 laps", true);
  await sleep(2500); // allow results screen
  const ra = await A.evaluate(() => document.querySelectorAll("#results-list li").length);
  check("results screen lists 3 racers", ra === 3, `rows=${ra}`);
  const orderA = JSON.stringify((await state(A)).standings.map((s) => s.name));
  const orderB = JSON.stringify((await state(B)).standings.map((s) => s.name));
  const orderC = JSON.stringify((await state(C)).standings.map((s) => s.name));
  check("consistent results across clients", orderA === orderB && orderB === orderC, orderA);
  await A.screenshot({ path: `${OUT}/results.png` });

  // rematch flow
  await A.$eval("#btn-rematch", (el) => el.click());
  for (const [p, n] of [[A, "A"], [B, "B"], [C, "C"]]) {
    await waitFor(p, () => window.__cpr.state().phase === "lobby", 20000, `${n} back to lobby`);
  }
  check("rematch returns all to lobby", true);
} catch (e) {
  failed = true;
  console.log("ERROR", e.message);
} finally {
  await browser.close();
}

const gameErrors = errors.filter((e) => !/favicon|AudioContext|user gesture/i.test(e));
check("no game-breaking page errors", gameErrors.length === 0, gameErrors.slice(0, 5).join(" | "));
writeFileSync(`${OUT}/e2e-race.json`, JSON.stringify({ results, errors: gameErrors }, null, 2));
process.exit(failed ? 1 : 0);
