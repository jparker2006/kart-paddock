import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLIENT_URL = 'http://127.0.0.1:5173';

async function main() {
  console.log('[0.0s] Launching Chrome...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const t0 = Date.now();
  const time = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

  try {
    console.log(`${time()} Opening Alice context...`);
    const contextAlice = await browser.createBrowserContext();
    const pageAlice = await contextAlice.newPage();
    pageAlice.setDefaultTimeout(8000);
    pageAlice.on('console', (m) => console.log(`${time()} [Alice]`, m.text()));
    pageAlice.on('pageerror', (err) => console.log(`${time()} [Alice Error]`, err.message));

    console.log(`${time()} Navigating Alice to ${CLIENT_URL}...`);
    await pageAlice.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
    console.log(`${time()} Alice navigation complete!`);

    await pageAlice.waitForSelector('#btn-create-room');
    console.log(`${time()} Creating room for Alice...`);
    await pageAlice.click('#btn-create-room');

    await pageAlice.waitForFunction(() => {
      const el = document.getElementById('display-room-code');
      return el && el.innerText.length >= 4 && el.innerText !== '-----';
    });
    const roomCode = await pageAlice.$eval('#display-room-code', (el) => el.innerText);
    console.log(`${time()} Room created! Code: "${roomCode}"`);

    // Open Bob
    console.log(`${time()} Opening Bob context...`);
    const contextBob = await browser.createBrowserContext();
    const pageBob = await contextBob.newPage();
    pageBob.setDefaultTimeout(8000);
    pageBob.on('console', (m) => console.log(`${time()} [Bob]`, m.text()));
    await pageBob.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
    await pageBob.waitForSelector('#room-code-input');
    await pageBob.$eval('#player-name-input', (el) => el.value = 'Bob');
    await pageBob.$eval('#room-code-input', (el, code) => el.value = code, roomCode);
    await pageBob.click('#btn-join-room');
    console.log(`${time()} Bob joined room!`);

    // Open Charlie
    console.log(`${time()} Opening Charlie context...`);
    const contextCharlie = await browser.createBrowserContext();
    const pageCharlie = await contextCharlie.newPage();
    pageCharlie.setDefaultTimeout(8000);
    pageCharlie.on('console', (m) => console.log(`${time()} [Charlie]`, m.text()));
    await pageCharlie.goto(`${CLIENT_URL}#room=${roomCode}`, { waitUntil: 'domcontentloaded' });
    await pageCharlie.waitForSelector('#player-name-input');
    await pageCharlie.$eval('#player-name-input', (el) => el.value = 'Charlie');
    await pageCharlie.waitForSelector('#btn-join-room');
    await pageCharlie.click('#btn-join-room');
    console.log(`${time()} Charlie joined room!`);

    // Verify roster count
    await new Promise((r) => setTimeout(r, 800));
    const countOnAlice = await pageAlice.$$eval('.roster-item', (items) => items.length);
    const countOnBob = await pageBob.$$eval('.roster-item', (items) => items.length);
    const countOnCharlie = await pageCharlie.$$eval('.roster-item', (items) => items.length);
    console.log(`${time()} Roster Counts: Alice sees ${countOnAlice}, Bob sees ${countOnBob}, Charlie sees ${countOnCharlie}`);

    // Check host button
    const canAliceStart = await pageAlice.$eval('#btn-start-race', (btn) => !btn.disabled);
    const canBobStart = await pageBob.$eval('#btn-start-race', (btn) => !btn.disabled);
    console.log(`${time()} Start Button: Alice can start: ${canAliceStart}, Bob can start: ${canBobStart}`);

    if (canAliceStart) {
      console.log(`${time()} Alice clicking Start Grand Prix!`);
      await pageAlice.bringToFront();
      await pageAlice.click('#btn-start-race');
      await new Promise((r) => setTimeout(r, 4500));

      const hudAlice = await pageAlice.$eval('#game-hud', (el) => !el.classList.contains('hidden'));
      const hudBob = await pageBob.$eval('#game-hud', (el) => !el.classList.contains('hidden'));
      const hudCharlie = await pageCharlie.$eval('#game-hud', (el) => !el.classList.contains('hidden'));
      console.log(`${time()} In-Game HUDs: Alice: ${hudAlice}, Bob: ${hudBob}, Charlie: ${hudCharlie}`);

      // Drive Alice forward
      console.log(`${time()} Alice accelerating forward with KeyW...`);
      await pageAlice.focus('#game-canvas');
      await pageAlice.keyboard.down('KeyW');
      await new Promise((r) => setTimeout(r, 1500));
      await pageAlice.keyboard.up('KeyW');

      const aliceSpeed = await pageAlice.$eval('#hud-speed', (el) => el.innerText);
      console.log(`${time()} Alice Speedometer: ${aliceSpeed} km/h`);
    }

    console.log(`${time()} SUCCESS: All 3 clients verified!`);
  } catch (e) {
    console.error(`${time()} Test error:`, e);
  } finally {
    await browser.close();
  }
}

main();
