import {io} from 'socket.io-client';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const port=3102,url=`http://localhost:${port}`,clients=[],checks=[];
const server=spawn(process.execPath,['dist/server/server/index.js'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ALLOWED_ORIGINS:'http://localhost:4173'},stdio:['ignore','pipe','pipe']});
let output='';server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(transport='websocket',origin='http://localhost:4173') {const c=io(url,{transports:[transport],extraHeaders:{Origin:origin},reconnection:false,timeout:1500});clients.push(c);await new Promise((resolve,reject)=>{c.once('connect',resolve);c.once('connect_error',reject);});c.on('state',s=>c.state=s);return c;}
const emit=(c,event,data)=>new Promise((resolve,reject)=>c.timeout(2500).emit(event,data,(e,r)=>e?reject(e):resolve(r)));
try{
 for(let i=0;i<50;i++){try{const r=await fetch(url+'/health');if(r.status===200)break;}catch{}await pause(100);}
 assert.equal((await fetch(url+'/health')).status,200);checks.push('GET /health HTTP 200');
 const a=await connect();const host=await emit(a,'enter',{name:'Host',create:true});assert(host.ok);
 const room=[a],sessions=[host];
 for(let i=1;i<8;i++){const c=await connect(i===2?'polling':'websocket');const r=await emit(c,'enter',{name:`Driver ${i}`,code:host.code});assert(r.ok);room.push(c);sessions.push(r);}
 await pause(100);assert.equal(a.state.players.length,8);checks.push('Eight independent protocol clients joined; both WebSocket and long-polling worked');
 const ninth=await connect();assert.equal((await emit(ninth,'enter',{name:'Ninth',code:host.code})).ok,false);checks.push('Ninth driver rejected at eight-player capacity');
 const other=await connect();const otherRoom=await emit(other,'enter',{name:'Other',create:true});assert(otherRoom.ok);assert.notEqual(otherRoom.code,host.code);await pause(100);assert.equal(other.state?.code,otherRoom.code);assert.equal((await emit(other,'start',{})).ok,false);checks.push('Separate room isolated; single-player start rejected');
 assert.equal((await emit(room[1],'start',{})).ok,false);assert((await emit(a,'start',{})).ok);checks.push('Only the host can start');
 await pause(4200);assert.equal(a.state.phase,'racing');assert.equal(other.state.phase,'lobby');assert.equal(a.state.players.filter(p=>p.active).length,8);checks.push('Eight-player authoritative race started; other room stayed in lobby');
 const old=room[3].state.players.find(p=>p.id===sessions[3].id);room[3].disconnect();await pause(250);const reconnect=await connect();const resumed=await emit(reconnect,'enter',{name:'Driver 3',code:host.code,token:sessions[3].token});assert.equal(resumed.id,sessions[3].id);await pause(100);assert.equal(reconnect.state.raceId,1);checks.push('Token reconnect restored same driver and active race');
 // Create a two-driver race with space for a late join.
 const lateHost=await connect(),lh=await emit(lateHost,'enter',{name:'Late host',create:true});const friend=await connect();await emit(friend,'enter',{name:'Friend',code:lh.code});await emit(lateHost,'start',{});const late=await connect();await emit(late,'enter',{name:'Late arrival',code:lh.code});await pause(100);const waiter=late.state.players.find(p=>p.name==='Late arrival');assert.equal(waiter.active,false);checks.push('Mid-race join waits and cannot become an active entrant');
 const initial=a.state.players.find(p=>p.id===host.id);a.emit('input',{throttle:NaN,steer:Infinity,seq:0,x:999,lap:3});await pause(200);const stable=a.state.players.find(p=>p.id===host.id);assert.equal(stable.lap,0);assert(Number.isFinite(stable.x));assert(Math.abs(stable.x-initial.x)<.5);checks.push('Malformed and position-forging input rejected');
 await assert.rejects(()=>connect('websocket','http://unpermitted.invalid'));checks.push('Unpermitted WebSocket origin rejected');
 const cors=await fetch(url+'/socket.io/?EIO=4&transport=polling',{headers:{Origin:'http://unpermitted.invalid'}});assert.equal(cors.status,403);checks.push('Unpermitted HTTP polling origin rejected');
 a.disconnect();await pause(100);assert.notEqual(room[1].state.host,host.id);checks.push('Connected driver elected host after host disconnect');
 console.log(checks.join('\n'));
}catch(e){console.error(e);process.exitCode=1;checks.push('FAILED: '+e.stack);}
finally{for(const c of clients)c.disconnect();server.kill('SIGTERM');await writeFile('artifacts/network-report.json',JSON.stringify({checks,serverOutput:output},null,2));}
