import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
function command(args){return new Promise((resolve,reject)=>{const p=spawn('npm',args,{stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>output+=d);const timer=setTimeout(()=>{p.kill('SIGTERM');reject(new Error('Command did not exit on conflict'));},12000);p.on('exit',code=>{clearTimeout(timer);resolve({command:'npm '+args.join(' '),code,output});});});}
const reports=[];
for(const args of [['start'],['run','preview'],['run','dev']]){const r=await command(args);assert.notEqual(r.code,0);assert.match(r.output,/in use|EADDRINUSE|address already in use/);reports.push(r);}
await writeFile('artifacts/commands-report.json',JSON.stringify({node:process.version,reports},null,2));console.log('PASS: backend, preview and combined dev all fail explicitly on occupied ports');
