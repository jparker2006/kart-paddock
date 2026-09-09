import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const tscBin = path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');
const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');

const env = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
};

const run = (bin, args) => {
  const res = spawnSync(process.execPath, [bin, ...args], { cwd: rootDir, env, stdio: 'inherit' });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
};

run(tscBin, ['-p', 'tsconfig.client.json']);
run(viteBin, ['build']);
run(tscBin, ['-p', 'tsconfig.server.json']);
