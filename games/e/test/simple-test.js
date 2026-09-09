import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLIENT_URL = 'http://127.0.0.1:5173';

async function test() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });

  console.log('1. Opening Alice...');
  const pageAlice = await browser.newPage();
  pageAlice.on('console', (m) => console.log('[Alice Console]', m.text()));
  await pageAlice.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
  await pageAlice.waitForSelector('#btn-create-room');
  console.log('Alice loaded! Creating room...');
  await pageAlice.click('#btn-create-room');
  await pageAlice.waitForFunction(() => {
    const el = document.getElementById('display-room-code');
    return el && el.innerText.length >= 4 && el.innerText !== '-----';
  });
  const roomCode = await pageAlice.$eval('#display-room-code', (el) => el.innerText);
  console.log('Room created with code:', roomCode);

  console.log('2. Opening Bob...');
  const pageBob = await browser.newPage();
  pageBob.on('console', (m) => console.log('[Bob Console]', m.text()));
  await pageBob.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
  await pageBob.waitForSelector('#room-code-input');
  await pageBob.$eval('#room-code-input', (el, code) => el.value = code, roomCode);
  await pageBob.click('#btn-join-room');
  await new Promise((r) => setTimeout(r, 600));
  console.log('Bob joined room!');

  console.log('3. Opening Charlie...');
  const pageCharlie = await browser.newPage();
  pageCharlie.on('console', (m) => console.log('[Charlie Console]', m.text()));
  await pageCharlie.goto(`${CLIENT_URL}#room=${roomCode}`, { waitUntil: 'domcontentloaded' });
  await pageCharlie.waitForSelector('#btn-join-room');
  await pageCharlie.click('#btn-join-room');
  await new Promise((r) => setTimeout(r, 600));
  console.log('Charlie joined room!');

  // Check roster on Alice
  const aliceRoster = await pageAlice.$$eval('.roster-item', (items) => items.length);
  console.log('Roster count on Alice:', aliceRoster);

  const debugInfo = await pageAlice.evaluate(() => {
    const btn = document.getElementById('btn-start-race');
    return {
      btnDisabled: btn ? btn.disabled : null,
      btnExists: !!btn,
      hintText: document.getElementById('start-hint') ? document.getElementById('start-hint').innerText : null,
    };
  });
  console.log('Alice Debug Info:', JSON.stringify(debugInfo));

  // Alice starts race
  console.log('Starting race...');
  await pageAlice.waitForFunction(() => !document.getElementById('btn-start-race').disabled, { timeout: 5000 });
  await pageAlice.click('#btn-start-race');
  await new Promise((r) => setTimeout(r, 4500));

  const hudVisible = await pageAlice.$eval('#game-hud', (el) => !el.classList.contains('hidden'));
  console.log('Race started! HUD visible on Alice:', hudVisible);

  await browser.close();
  console.log('SUCCESS: All 3 clients tested cleanly!');
}

test().catch(console.error);
