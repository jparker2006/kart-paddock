// Opt-in production smoke test. No gameplay source changes or ratings writes.
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const require=createRequire(new URL('../games/a/package.json',import.meta.url));
const {io}=require('socket.io-client');
if(!process.argv.includes('--live'))throw Error('Requires --live: creates two disposable rooms per game.');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(value,why)=>{if(!value)throw Error(why);};
const events={a:['state','state'],b:['room:state','race:snapshot'],c:['room','s'],d:['room:snapshot','kart:peers'],e:['room_state','race_sync']};
const selected=process.argv.find(x=>x.startsWith('--games='))?.slice(8)||'abcde';
assert(/^[a-e]+$/.test(selected),'Invalid game selection');
const reportURL=new URL('../verification/small-multiplayer.json',import.meta.url);
const previous=selected==='abcde'?{results:[]}:JSON.parse(await readFile(reportURL,'utf8'));
const results=previous.results.filter(r=>!selected.includes(r.game));
function until(check,label,ms=12000){return new Promise((resolve,reject)=>{const start=Date.now();const t=setInterval(()=>{if(check()){clearInterval(t);resolve();}else if(Date.now()-start>ms){clearInterval(t);reject(Error('Timeout: '+label));}},50);});}
function ack(c,event,...args){return new Promise((resolve,reject)=>c.socket.timeout(10000).emit(event,...args,(err,r)=>err?reject(err):r?.ok===false?reject(Error(JSON.stringify(r))):resolve(r)));}
function once(c,event,emit){return new Promise((resolve,reject)=>{const t=setTimeout(()=>{c.socket.off(event,done);reject(Error('No '+event));},10000);function done(r){clearTimeout(t);resolve(r);}c.socket.once(event,done);emit();});}
function seat(c,r){c.roomCode=r.code||r.roomCode||r.room?.code;c.id=r.id||r.playerId||r.room?.youId||c.id;c.token=r.token||r.reconnectToken||c.token;}
async function enter(c,code,resume=false){
 const old=c.id;let r;
 if(c.game==='a')r=await ack(c,'enter',{name:c.name,create:!code,code,token:resume?c.token:undefined});
 if(c.game==='b')r=resume?await ack(c,'room:resume',{token:c.token}):await ack(c,code?'room:join':'room:create',{name:c.name,code});
 if(c.game==='c')r=await ack(c,code?'room:join':'room:create',{name:c.name,code,character:0,token:resume?c.token:undefined});
 if(c.game==='d')r=await once(c,'room:snapshot',()=>c.socket.emit(code?'room:join':'room:create',{name:c.name,code,playerId:c.id}));
 if(c.game==='e')r=await once(c,'joined_room',()=>c.socket.emit(resume?'rejoin_room':code?'join_room':'create_room',{playerName:c.name,color:'cyan',roomCode:code,playerId:c.id,reconnectToken:resume?c.token:undefined}));
 seat(c,r);if(resume)assert(c.id===old,'Reconnect changed player identity');
}
function playerList(c){const p=c.room?.players;return Array.isArray(p)?p:Object.values(p||{});}
function packetIds(c,data){if(c.game==='a')return data.players.map(p=>p.id);if(c.game==='b')return data.karts.map(p=>p.id);if(c.game==='c')return data.p.map(p=>p.id);return Object.keys(data);}
function createClient(game,index,all){
 const c={game,index,id:randomUUID(),name:`LaunchTest-${index+1}`,last:0,gaps:[],packets:0,errors:[],unexpectedDisconnects:[],intentional:false,room:null,state:null,seq:0};
 c.socket=io(`https://kart-paddock-${game}.onrender.com`,{autoConnect:false,transports:['websocket'],reconnection:false,timeout:15000,extraHeaders:{Origin:'https://kart-paddock.vercel.app'}});
 c.socket.on(events[game][0],s=>{c.room=s;});
 c.socket.on(events[game][1],s=>{c.state=s;if(c.measuring){const now=performance.now();if(c.last)c.gaps.push(now-c.last);c.last=now;c.packets++;const ids=packetIds(c,s);const allowed=new Set(all.filter(x=>x.roomCode===c.roomCode).map(x=>x.id));if(ids.some(id=>!allowed.has(id)))c.errors.push('foreign player in state packet');if(ids.length===3)c.sawThree=true;}});
 for(const event of ['room:error','error_message'])c.socket.on(event,e=>c.errors.push(JSON.stringify(e)));
 c.socket.on('disconnect',why=>{if(!c.intentional)c.unexpectedDisconnects.push(why);c.last=0;});
 return c;
}
async function connect(c){c.socket.connect();await until(()=>c.socket.connected,'socket connection',18000);}
function send(c){
 if(!c.socket.connected)return;const wobble=Math.sin(c.seq++/20)*.5;
 if(c.game==='a'){c.socket.emit('input',{throttle:.2,steer:Math.sin(c.seq/30)*.1,drift:false,use:false,respawn:c.seq%200===0,seq:c.seq});return;}
 if(c.game==='b'){const p=c.state?.karts?.find(p=>p.id===c.id);if(p){c.base??={...p};c.socket.emit('kart:state',{...c.base,x:c.base.x+wobble,v:1,f:0,d:0});}return;}
 if(c.game==='c'){c.socket.emit('state',{id:c.id,x:c.index*3+wobble,y:1,z:0,yaw:0,sp:1,lap:0,cps:0,prog:0,dr:0,tp:0,bo:0});return;}
 if(c.game==='d'){c.socket.emit('kart:state',{x:c.index*3+wobble,y:1,z:0,yaw:0,speed:1});return;}
 const p=c.room?.players?.[c.id];if(p){c.base??={...p.transform};c.socket.emit('kart_update',{...c.base,x:c.base.x+wobble,currentLap:1,lastCheckpoint:0,progressDistance:0});}
}
async function run(game){
 const started=Date.now(),all=[],timers=[];const result={game,clients:6,rooms:2,startedAt:new Date().toISOString()};
 try{
  // Wake only this selected server, with a bounded wait.
  for(let n=0;n<12;n++){try{const r=await fetch(`https://kart-paddock.vercel.app/api/game-health?game=${game}`,{signal:AbortSignal.timeout(12000)});if(r.ok)break;}catch{}if(n===11)throw Error('Backend unavailable');await sleep(2000);}
  for(let n=0;n<6;n++){const c=createClient(game,n,all);all.push(c);await connect(c);await enter(c,n%3?all[n-n%3].roomCode:undefined);}
  assert(all[0].roomCode!==all[3].roomCode,'Rooms must differ');
  await until(()=>all.every(c=>playerList(c).length===3),'three players in each room');
  for(const c of all){const expected=all.filter(x=>x.roomCode===c.roomCode).map(x=>x.id);assert(playerList(c).every(p=>expected.includes(p.id||p.playerId)),'Lobby isolation');}
  for(const host of [all[0],all[3]]){
   if(game==='a')await ack(host,'start',{});
   else if(game==='b')await ack(host,'race:start');
   else if(game==='c')await ack(host,'room:start');
   else host.socket.emit(game==='d'?'race:start':'start_race');
  }
  await until(()=>all.every(c=>(c.room?.phase||c.room?.status)==='racing'),'both rooms racing');
  result.racesStarted=true;
  for(const c of all){c.measuring=true;timers.push(setInterval(()=>send(c),game==='c'?67:50));}
  console.log(game+': six clients racing in two isolated rooms');
  await sleep(15000);
  const c=all[2];c.intentional=true;c.socket.disconnect();await sleep(1500);
  if(game==='e'){
   await until(()=>all[0].state&&!Object.hasOwn(all[0].state,c.id),'disconnected player absent from live sync');
   result.disconnectRosterFlagUpdated=playerList(all[0]).some(p=>p.id===c.id&&p.connected===false);
  }else await until(()=>playerList(all[0]).some(p=>(p.id||p.playerId)===c.id&&p.connected===false),'disconnect visible to peer');
  await connect(c);await enter(c,c.roomCode,true);c.intentional=false;
  await until(()=>playerList(all[0]).some(p=>(p.id||p.playerId)===c.id&&p.connected===true),'rejoin visible to peer');
  const before=c.packets;await until(()=>c.packets>before+5,'rejoined player receiving updates');result.sameSeatReconnect=true;
  await sleep(15000);
  assert(all.every(c=>c.sawThree),'Each client must receive all three racers');
  assert(all.every(c=>c.packets>50),'Insufficient sustained state updates');
  assert(all.every(c=>!c.errors.length&&!c.unexpectedDisconnects.length),'Unexpected errors/disconnects');
  const gaps=all.flatMap(c=>c.gaps).sort((a,b)=>a-b);
  Object.assign(result,{pass:true,isolation:true,unexpectedDisconnects:0,statePackets:all.map(c=>c.packets),stateGapP95Ms:Math.round(gaps[Math.floor(gaps.length*.95)]),stateGapMaxMs:Math.round(gaps.at(-1)),note:'Synthetic state/input traffic; no full laps, rendering performance, or physical-device coverage.'});
 }catch(e){result.pass=false;result.error=e.message;result.clientErrors=all.map(c=>({index:c.index,errors:c.errors,disconnects:c.unexpectedDisconnects}));}
 finally{timers.forEach(clearInterval);for(const c of all){c.intentional=true;if(c.socket.connected&&game!=='e')c.socket.emit(game==='a'?'leave':'room:leave');}await sleep(300);for(const c of all)c.socket.disconnect();}
 result.elapsedSeconds=Math.round((Date.now()-started)/1000);results.push(result);console.log(JSON.stringify(result));
 await writeFile(new URL('../verification/small-multiplayer.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),mode:'production WebSocket clients, sequential games, max six concurrent clients, two rooms per game',results},null,2)+'\n');
}
for(const game of selected)await run(game);
