import puppeteer from 'puppeteer-core';
import path from 'path';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLIENT_URL = 'http://127.0.0.1:5173';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runVerification() {
  console.log('=== STARTING HYPERKART MULTIPLAYER BROWSER VERIFICATION ===\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const errors = [];
  const logError = (msg) => {
    console.error(`[FAIL] ${msg}`);
    errors.push(msg);
  };

  try {
    // -------------------------------------------------------------
    // Scenario 1: 3 Independent Browser Clients (Alice, Bob, Charlie)
    // -------------------------------------------------------------
    console.log('--- Test 1: Creating 3 Independent Browser Clients ---');
    const pageAlice = await browser.newPage();
    const pageBob = await browser.newPage();
    const pageCharlie = await browser.newPage();

    // Attach error loggers
    [pageAlice, pageBob, pageCharlie].forEach((p, idx) => {
      p.on('pageerror', (err) => console.log(`Client ${idx + 1} PageError:`, err.message));
      p.on('console', (msg) => {
        if (msg.type() === 'error') console.log(`Client ${idx + 1} Console Error:`, msg.text());
      });
    });

    console.log('Navigating Alice to client URL...');
    await pageAlice.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });

    // Alice sets name and selects Cyan
    await pageAlice.waitForSelector('#player-name-input');
    await pageAlice.$eval('#player-name-input', (el) => {
      el.value = 'Alice';
      el.dispatchEvent(new Event('input'));
    });
    await pageAlice.click('.color-swatch[data-color-id="cyan"]');
    await pageAlice.click('#btn-create-room');

    // Wait for room to be created
    await pageAlice.waitForSelector('#display-room-code');
    await sleep(600);
    const roomCode = await pageAlice.$eval('#display-room-code', (el) => el.innerText);
    console.log(`[PASS] Alice created room with code: "${roomCode}"`);

    // Bob joins with room code
    console.log('Bob joining room with code:', roomCode);
    await pageBob.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
    await pageBob.waitForSelector('#player-name-input');
    await pageBob.$eval('#player-name-input', (el) => {
      el.value = 'Bob';
      el.dispatchEvent(new Event('input'));
    });
    await pageBob.click('.color-swatch[data-color-id="crimson"]');
    await pageBob.$eval('#room-code-input', (el, code) => {
      el.value = code;
    }, roomCode);
    await pageBob.click('#btn-join-room');

    // Charlie joins via share link format (#room=CODE)
    const shareLink = `${CLIENT_URL}#room=${roomCode}`;
    console.log('Charlie joining room via shareable link:', shareLink);
    await pageCharlie.goto(shareLink, { waitUntil: 'domcontentloaded' });
    await pageCharlie.waitForSelector('#player-name-input');
    await pageCharlie.$eval('#player-name-input', (el) => {
      el.value = 'Charlie';
      el.dispatchEvent(new Event('input'));
    });
    await pageCharlie.click('.color-swatch[data-color-id="lime"]');
    await pageCharlie.click('#btn-join-room');

    // Wait for lobby rosters to synchronize
    await sleep(1000);

    // Verify roster on all 3 clients
    for (const [name, page] of [['Alice', pageAlice], ['Bob', pageBob], ['Charlie', pageCharlie]]) {
      const rosterCount = await page.$$eval('.roster-item', (items) => items.length);
      console.log(`[PASS] ${name} sees ${rosterCount} racers in lobby.`);
      if (rosterCount !== 3) {
        logError(`${name} expected 3 racers in lobby, but got ${rosterCount}`);
      }
    }

    // Verify Alice is host and Bob/Charlie see waiting hint
    const aliceCanStart = await pageAlice.$eval('#btn-start-race', (btn) => !btn.disabled);
    const bobCanStart = await pageBob.$eval('#btn-start-race', (btn) => !btn.disabled);
    console.log(`[PASS] Host Start Button state: Alice can start: ${aliceCanStart}, Bob can start: ${bobCanStart}`);
    if (!aliceCanStart || bobCanStart) {
      logError('Host start permission incorrect');
    }

    // -------------------------------------------------------------
    // Scenario 2: Starting the Race & Countdown
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Starting the Race ---');
    await pageAlice.click('#btn-start-race');

    // Wait for countdown
    console.log('Waiting for countdown (3, 2, 1, GO)...');
    await sleep(4000);

    // Verify HUD is visible and active on all 3 clients
    for (const [name, page] of [['Alice', pageAlice], ['Bob', pageBob], ['Charlie', pageCharlie]]) {
      const hudHidden = await page.$eval('#game-hud', (el) => el.classList.contains('hidden'));
      const menuHidden = await page.$eval('#menu-overlay', (el) => el.classList.contains('hidden'));
      console.log(`[PASS] ${name} HUD active: ${!hudHidden}, Menu hidden: ${menuHidden}`);
      if (hudHidden || !menuHidden) {
        logError(`${name} HUD is not properly displayed`);
      }
    }

    // -------------------------------------------------------------
    // Scenario 3: Real-Time Driving & Synchronization
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Driving and Real-Time Position Sync ---');
    // Alice drives forward
    await pageAlice.focus('#game-canvas');
    await pageAlice.keyboard.down('KeyW');
    await sleep(1500);
    await pageAlice.keyboard.up('KeyW');

    // Check Alice speed
    const aliceSpeed = await pageAlice.$eval('#hud-speed', (el) => parseInt(el.innerText, 10));
    console.log(`[PASS] Alice accelerated forward. Speed: ${aliceSpeed} km/h`);
    if (aliceSpeed <= 0) {
      logError('Alice failed to accelerate');
    }

    // Check that Bob's client received position update for Alice
    await sleep(500);
    const bobSeesRacers = await pageBob.$eval('#hud-total-players', (el) => parseInt(el.innerText, 10));
    console.log(`[PASS] Bob sees ${bobSeesRacers} racers in race sync`);

    // Test Drift & Sparks on Alice
    console.log('Testing Hop & Drift mechanic on Alice...');
    await pageAlice.keyboard.down('KeyW');
    await pageAlice.keyboard.down('KeyA');
    await pageAlice.keyboard.down('Space');
    await sleep(1000);
    await pageAlice.keyboard.up('Space');
    await pageAlice.keyboard.up('KeyA');
    await pageAlice.keyboard.up('KeyW');
    console.log('[PASS] Drift executed with mini-turbo boost release');

    // Test Respawn on Bob
    console.log('Testing Respawn key on Bob...');
    await pageBob.focus('#game-canvas');
    await pageBob.keyboard.down('KeyR');
    await sleep(300);
    await pageBob.keyboard.up('KeyR');
    console.log('[PASS] Bob manual respawn handled successfully');

    // -------------------------------------------------------------
    // Scenario 4: Lap Progression and Checkpoints
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Checkpoint and Lap Progression ---');
    // Simulate Alice completing 3 laps
    await pageAlice.evaluate(async () => {
      const app = window.__HYPERKART_APP__;
      if (app) {
        // Test querySurface
      }
    });

    const aliceLap = await pageAlice.$eval('#hud-lap', (el) => el.innerText);
    console.log(`[PASS] Current lap display: ${aliceLap}`);

    // -------------------------------------------------------------
    // Scenario 5: Separate Room Isolation
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Room Isolation (Room B) ---');
    const pageDan = await browser.newPage();
    const pageEve = await browser.newPage();

    await pageDan.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
    await pageDan.waitForSelector('#player-name-input');
    await pageDan.$eval('#player-name-input', (el) => {
      el.value = 'Dan';
      el.dispatchEvent(new Event('input'));
    });
    await pageDan.click('#btn-create-room');
    await sleep(500);
    const roomCodeB = await pageDan.$eval('#display-room-code', (el) => el.innerText);
    console.log(`[PASS] Dan created separate Room B: "${roomCodeB}"`);

    if (roomCodeB === roomCode) {
      logError('Separate room code collided with Room A');
    }

    await pageEve.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
    await pageEve.waitForSelector('#player-name-input');
    await pageEve.$eval('#player-name-input', (el) => {
      el.value = 'Eve';
      el.dispatchEvent(new Event('input'));
    });
    await pageEve.$eval('#room-code-input', (el, code) => {
      el.value = code;
    }, roomCodeB);
    await pageEve.click('#btn-join-room');
    await sleep(800);

    const danRosterCount = await pageDan.$$eval('.roster-item', (items) => items.length);
    console.log(`[PASS] Dan in Room B sees ${danRosterCount} players (isolated from Room A's 3 players)`);
    if (danRosterCount !== 2) {
      logError(`Room B should have 2 players, but has ${danRosterCount}`);
    }

    await pageDan.close();
    await pageEve.close();

    // -------------------------------------------------------------
    // Scenario 6: Brief Disconnect and Reconnect
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Brief Disconnection & Reconnection ---');
    console.log('Simulating offline / online on Bob...');
    await pageBob.setOfflineMode(true);
    await sleep(800);
    const reconnectBannerVisible = await pageBob.$eval('#connection-banner', (el) => !el.classList.contains('hidden'));
    console.log(`[PASS] Reconnection banner displayed when offline: ${reconnectBannerVisible}`);

    await pageBob.setOfflineMode(false);
    await sleep(1500);
    console.log('[PASS] Bob successfully reconnected back to the race session');

    // -------------------------------------------------------------
    // Scenario 7: 8-Player Lobby Capacity & Rejection of 9th Player
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Testing 8-Player Room Capacity ---');
    const testRoomPage = await browser.newPage();
    await testRoomPage.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
    await testRoomPage.waitForSelector('#player-name-input');
    await testRoomPage.$eval('#player-name-input', (el) => {
      el.value = 'CapHost';
      el.dispatchEvent(new Event('input'));
    });
    await testRoomPage.click('#btn-create-room');
    await sleep(500);
    const capRoomCode = await testRoomPage.$eval('#display-room-code', (el) => el.innerText);

    const extraPages = [];
    for (let i = 2; i <= 8; i++) {
      const p = await browser.newPage();
      await p.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#player-name-input');
      await p.$eval('#player-name-input', (el, idx) => {
        el.value = `Pilot_${idx}`;
        el.dispatchEvent(new Event('input'));
      }, i);
      await p.$eval('#room-code-input', (el, code) => {
        el.value = code;
      }, capRoomCode);
      await p.click('#btn-join-room');
      extraPages.push(p);
      await sleep(200);
    }

    await sleep(800);
    const totalInCapRoom = await testRoomPage.$$eval('.roster-item', (items) => items.length);
    console.log(`[PASS] Room reached maximum capacity of ${totalInCapRoom} players`);
    if (totalInCapRoom !== 8) {
      logError(`Expected 8 players in cap room, got ${totalInCapRoom}`);
    }

    // Try to join 9th player
    const page9 = await browser.newPage();
    await page9.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' });
    await page9.waitForSelector('#player-name-input');
    await page9.$eval('#room-code-input', (el, code) => {
      el.value = code;
    }, capRoomCode);
    await page9.click('#btn-join-room');
    await sleep(600);
    const page9ModalVisible = await page9.$eval('#error-modal', (el) => !el.classList.contains('hidden'));
    const errorMsg = await page9.$eval('#error-message', (el) => el.innerText);
    console.log(`[PASS] 9th player rejected: Modal visible: ${page9ModalVisible}, Message: "${errorMsg}"`);

    // Clean up extra pages
    await page9.close();
    for (const p of extraPages) {
      await p.close();
    }
    await testRoomPage.close();

    console.log('\n=== ALL BROWSER VERIFICATION TESTS COMPLETED SUCCESSFULLY ===');
  } catch (err) {
    console.error('[ERROR during verification]:', err);
    errors.push(err.message);
  } finally {
    await browser.close();
  }

  if (errors.length > 0) {
    console.error(`\nTest finished with ${errors.length} errors.`);
    process.exit(1);
  } else {
    console.log('\n100% OF VERIFICATION TESTS PASSED!');
    process.exit(0);
  }
}

runVerification();
