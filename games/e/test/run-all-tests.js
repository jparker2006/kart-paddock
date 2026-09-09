import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const waitForUrl = (url, timeoutMs = 15000) => {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(url, (res) => {
        if (res.statusCode && res.statusCode < 500) {
          resolve(true);
        } else {
          retry();
        }
      }).on('error', retry);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout waiting for ${url}`));
      } else {
        setTimeout(check, 300);
      }
    };
    check();
  });
};

async function run() {
  const env = {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
  };

  console.log('[Test Runner] Starting dev server...');
  const devProc = spawn(process.execPath, [path.join(rootDir, 'scripts', 'run-dev.js')], {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  });

  const cleanup = () => {
    if (devProc && !devProc.killed) {
      devProc.kill('SIGINT');
    }
  };

  process.on('SIGINT', () => { cleanup(); setTimeout(() => process.exit(1), 500); });
  process.on('SIGTERM', () => { cleanup(); setTimeout(() => process.exit(1), 500); });

  try {
    console.log('[Test Runner] Waiting for backend (http://127.0.0.1:3001/health)...');
    await waitForUrl('http://127.0.0.1:3001/health');
    console.log('[Test Runner] Waiting for frontend (http://127.0.0.1:5173)...');
    await waitForUrl('http://127.0.0.1:5173');

    console.log('[Test Runner] Servers ready. Running verification suite...\n');
    const testProc = spawn(process.execPath, [path.join(__dirname, 'full-verification.js')], {
      cwd: rootDir,
      env,
      stdio: 'inherit',
    });

    testProc.on('exit', (code) => {
      cleanup();
      process.exit(code ?? 0);
    });
  } catch (err) {
    console.error('[Test Runner Failed]', err);
    cleanup();
    process.exit(1);
  }
}

run();
