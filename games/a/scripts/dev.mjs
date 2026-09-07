import { spawn } from 'node:child_process';
const children = [spawn(process.execPath,['--env-file-if-exists=.env','--import','tsx','src/server/index.ts'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'})];
let closing=false;
function stop(code=0){if(closing)return;closing=true;for(const c of children)c.kill('SIGTERM');setTimeout(()=>process.exit(code),200);}
children.forEach(c=>c.on('exit',code=>stop(code??1)));process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
