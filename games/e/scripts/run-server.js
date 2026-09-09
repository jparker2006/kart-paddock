import { spawn } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const tsxBin = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = path.join(rootDir, 'src', 'server', 'index.ts');

const env = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
};

const child = spawn(process.execPath, [tsxBin, serverEntry], {
  cwd: rootDir,
  env,
  stdio: 'inherit',
});

const killChild = () => {
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
};

process.on('SIGINT', killChild);
process.on('SIGTERM', killChild);
process.on('exit', killChild);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
