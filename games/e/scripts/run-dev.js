import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const serverScript = path.join(__dirname, 'run-server.js');
const clientScript = path.join(__dirname, 'run-client.js');

const env = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
};

const serverProcess = spawn(process.execPath, [serverScript], {
  cwd: rootDir,
  env,
  stdio: 'inherit',
});

const clientProcess = spawn(process.execPath, [clientScript], {
  cwd: rootDir,
  env,
  stdio: 'inherit',
});

const shutdown = () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGINT');
  }
  if (clientProcess && !clientProcess.killed) {
    clientProcess.kill('SIGINT');
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

serverProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Server exited with code ${code}`);
    shutdown();
  }
});

clientProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Client exited with code ${code}`);
    shutdown();
  }
});
