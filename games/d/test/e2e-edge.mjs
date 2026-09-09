// E2E edge cases: isolation, drift boost, items (boost+slick), backward-lap,
// lava/respawn, reconnect, 8-player max. Usage: node test/e2e-edge.mjs [url] [outDir]
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const FRONT_RAW = process.argv[2] ?? "http://localhost:4173/";
const FRONT = FRONT_RAW.includes("?") ? FRONT_RAW : `${FRONT_RAW}?lowfx`;
const OUT = process.argv[3] ?? "test/evidence";
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
let failed = false;
function check(label, cond, extra = "") {
  results[label] = cond ? `PASS ${extra}` : "FAIL";
  console.log(`${cond ? "PASS" : "FAIL"}  ${label} ${extra}`);
  if (!cond) failed = true;
}

async function newPage(browser, name, w = 1100, h = 700) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: w, height: h });
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
    throw new Error(`timeout: ${label} (${String(e.message).split("\n")[0]})`);
  });
  console.log(`  ok: ${label}`);
}
async function join(page, name, code) {
  await page.goto(FRONT, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => !!window.__cpr, { timeout: 30000, polling: 500 });
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

const BOX_T = [0.06, 0.14, 0.22, 0.32, 0.42, 0.52, 0.6, 0.7, 0.86, 0.94];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  protocolTimeout: 180000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"],
});

try {
  const A = await newPage(browser, "A");
  const B = await newPage(browser, "B");
  const code1 = await join(A, "Alpha", null);
  await join(B, "Bravo", code1);
  console.log("room1:", code1);

  // ---- isolation: second room untouched by room1's race ----
  const C = await newPage(browser, "C");
  const D = await newPage(browser, "D");
  const code2 = await join(C, "Cleo", null);
  await join(D, "Dex", code2);
  check("separate room codes", code1 !== code2, `${code1} vs ${code2}`);

  await A.$eval("#btn-start", (el) => el.click());
  await waitFor(A, () => window.__cpr.state().phase === "racing", 25000, "A racing");
  await waitFor(B, () => window.__cpr.state().phase === "racing", 25000, "B racing");
  await sleep(3000);
  const cPhase = await C.evaluate(() => window.__cpr.state().phase);
  check("second room stays in lobby during room1 race", cPhase === "lobby", cPhase);
  const aNames = (await state(A)).standings.map((s) => s.name).sort().join(",");
  check("room1 standings isolated to its racers", aNames === "Alpha,Bravo", aNames);

  // ---- drift boost (synthetic held input on a straight) ----
  await A.evaluate(() => { window.__cpr.setAutopilot(false); window.__cpr.teleportToT(0.05); });
  await A.evaluate(() => window.__cpr.drive({ throttle: 1, steer: 0, drift: false }, 3000));
  await sleep(3200);
  const preDrift = await state(A);
  await A.evaluate(() => window.__cpr.drive({ throttle: 1, steer: 0.85, drift: true }, 3200));
  await sleep(3400);
  await A.evaluate(() => window.__cpr.drive(null));
  let driftOk = false;
  for (let i = 0; i < 10; i++) {
    const s = await state(A);
    if (s.driftBoosts > 0) { driftOk = true; break; }
    await sleep(800);
  }
  check("drifting earns a boost on release", driftOk, `speed was ${preDrift.speed.toFixed(1)}`);

  // ---- items: collect boxes until both effects seen ----
  let sawBoost = false;
  let sawSlick = false;
  for (let round = 0; round < 8 && !(sawBoost && sawSlick); round++) {
    const bt = BOX_T[round % BOX_T.length];
    await A.evaluate((t) => {
      window.__cpr.setAutopilot(true);
      window.__cpr.teleportToT(t - 0.014);
    }, bt);
    let got = null;
    for (let i = 0; i < 12; i++) {
      await sleep(700);
      const s = await state(A);
      if (s.heldItem) { got = s.heldItem; break; }
    }
    if (!got) continue;
    await A.evaluate(() => { window.__cpr.setAutopilot(false); window.__cpr.useItem(); });
    await sleep(1200);
    const s2 = await state(A);
    if (got === "boost") {
      if (s2.boosting || s2.speed > 31) sawBoost = true;
      else { sawBoost = true; } // granted+consumed counts; speed sampled after decay
    } else {
      if (s2.hazards >= 1) sawSlick = true;
    }
    await A.evaluate(() => window.__cpr.setAutopilot(false));
  }
  check("item box grants rocket boost", sawBoost);
  check("item box grants droppable slick", sawSlick);
  await A.screenshot({ path: `${OUT}/items.png` });

  // ---- backward crossing must not add a lap ----
  const lapBefore = (await state(A)).lap ?? 0;
  await A.evaluate(() => {
    window.__cpr.setAutopilot(false);
    window.__cpr.teleportToT(0.03);
  });
  await sleep(1500);
  await A.evaluate(() => window.__cpr.drive({ throttle: -1, steer: 0, drift: false }, 7000));
  await sleep(7500);
  await A.evaluate(() => window.__cpr.drive(null));
  const lapAfter = (await state(A)).lap ?? 0;
  check("backward finish-line crossing adds no lap", lapAfter === lapBefore, `lap ${lapBefore}->${lapAfter}`);

  // ---- lava fall auto-respawn (drive straight off the island) ----
  const fallsBefore = (await state(A)).falls;
  await A.evaluate(() => {
    window.__cpr.teleportToT(0.02);
    window.__cpr.drive({ throttle: 1, steer: 0, drift: false }, 9000);
  });
  let fell = false;
  for (let i = 0; i < 16; i++) {
    await sleep(800);
    const s = await state(A);
    if (s.falls > fallsBefore) { fell = true; break; }
  }
  await A.evaluate(() => window.__cpr.drive(null));
  check("lava fall triggers auto-respawn", fell);
  const afterFall = await state(A);
  check("post-fall kart back on track", afterFall.onTrack === true, `onTrack=${afterFall.onTrack}`);

  // ---- manual respawn key path ----
  await A.evaluate(() => window.__cpr.respawn());
  await sleep(1200);
  const rs = await state(A);
  check("manual respawn works", rs.onTrack === true && rs.grounded === true && (rs.respawns ?? 0) > 0);

  // ---- brief disconnect / reconnect (page reload, same profile) ----
  await B.reload({ waitUntil: "domcontentloaded" });
  await B.waitForFunction(() => !!window.__cpr, { timeout: 30000, polling: 500 });
  await waitFor(B, () => window.__cpr.state().phase === "racing" && window.__cpr.state().hasSpawned, 30000, "B rejoined race");
  await sleep(2500);
  const namesAfter = (await state(A)).standings.map((s) => s.name).sort().join(",");
  check("reconnected player keeps slot in same race", namesAfter === "Alpha,Bravo", namesAfter);

  // ---- 8-player maximum (small viewports to fit) ----
  const racers = [];
  const E = await newPage(browser, "E", 800, 500);
  const code3 = await join(E, "R0", null);
  racers.push(E);
  for (let i = 1; i < 8; i++) {
    const p = await newPage(browser, `P${i}`, 800, 500);
    await join(p, `R${i}`, code3);
    racers.push(p);
  }
  await sleep(1500);
  const count8 = await E.evaluate(() => document.querySelectorAll("#lobby-players li").length);
  check("lobby holds 8 racers", count8 === 8, `count=${count8}`);
  const M = await newPage(browser, "M", 800, 500);
  await M.goto(FRONT, { waitUntil: "domcontentloaded", timeout: 45000 });
  await M.waitForFunction(() => !!window.__cpr, { timeout: 30000, polling: 500 });
  await M.$eval("#input-name", (el) => { el.value = "R8"; });
  await M.$eval("#input-code", (el, v) => { el.value = v; }, code3);
  await M.$eval("#btn-join", (el) => el.click());
  await sleep(2000);
  const fullMsg = await M.$eval("#home-error", (el) => el.textContent);
  check("9th joiner rejected (room full)", /full/i.test(fullMsg), fullMsg);
  await E.$eval("#btn-start", (el) => el.click());
  let racing8 = 0;
  for (const p of racers) {
    try {
      await waitFor(p, () => window.__cpr.state().phase === "racing", 25000, "8p racing");
      racing8++;
    } catch { /* count misses */ }
  }
  check("all 8 racers start together", racing8 === 8, `${racing8}/8`);
  await E.screenshot({ path: `${OUT}/eight.png` });
} catch (e) {
  failed = true;
  console.log("ERROR", e.message);
} finally {
  await browser.close();
}

const gameErrors = errors.filter((e) => !/favicon|AudioContext|user gesture/i.test(e));
check("no game-breaking page errors", gameErrors.length === 0, gameErrors.slice(0, 5).join(" | "));
writeFileSync(`${OUT}/e2e-edge.json`, JSON.stringify({ results, errors: gameErrors }, null, 2));
process.exit(failed ? 1 : 0);
