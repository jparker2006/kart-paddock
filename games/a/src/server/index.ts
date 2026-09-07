import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { COLORS,ITEM_SPOTS,sample } from '../shared/track.js';
import type { Reply,Snapshot,Input } from '../shared/types.js';
import {type Car,makeCar,grid,stepCar,rank,collide,neutral,DT} from './physics.js';
const origins=new Set((process.env.ALLOWED_ORIGINS||'http://localhost:5173,http://localhost:4173').split(',').map(s=>s.trim()).filter(Boolean));
const allowed=(origin:string|undefined)=>!origin||origins.has(origin);
const http=createServer((req,res)=>{
 if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({status:'ok',game:'parcel-panic'}));return;}
 res.writeHead(404,{'Content-Type':'text/plain'});res.end('Parcel Panic game server. Open the separate browser client to play.');
});
const io=new Server(http,{cors:{origin:(origin,cb)=>cb(null,allowed(origin)),methods:['GET','POST']},allowRequest:(req,cb)=>cb(null,allowed(req.headers.origin)),maxHttpBufferSize:8192,pingInterval:5000,pingTimeout:10000});
type Room={code:string;host:string;phase:Snapshot['phase'];cars:Map<string,Car>;tokens:Map<string,string>;sockets:Map<string,string>;startAt:number;endAt:number;raceId:number;items:number[];effects:Snapshot['effects'];updated:number};
const rooms=new Map<string,Room>();
const now=()=>performance.now()/1000;
function snapshot(r:Room):Snapshot{return {code:r.code,host:r.host,phase:r.phase,players:[...r.cars.values()].map(c=>{
 const {input,lastInput,lastRespawn,launchLock,itemLock,lastGateAt,disconnectedAt,offTrack,...publicCar}=c;return publicCar;
}),serverTime:now(),startAt:r.startAt,endAt:r.endAt,raceId:r.raceId,items:r.items.map(t=>t<=now()),effects:r.effects};}
function broadcast(r:Room){io.to(r.code).emit('state',snapshot(r));}
function newCode(){let code='';do{code=Array.from(randomBytes(5),v=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[v%31]).join('');}while(rooms.has(code));return code;}
function hostElection(r:Room){if(!r.cars.get(r.host)?.connected)r.host=[...r.cars.values()].find(c=>c.connected)?.id||r.host;}
function detach(id:string,code:string,explicit=false){const r=rooms.get(code),c=r?.cars.get(id);if(!r||!c)return;c.connected=false;c.disconnectedAt=now();c.input=neutral();r.sockets.delete(id);
 if(explicit){if(c.active&&(r.phase==='racing'||r.phase==='countdown')){c.dnf=true;}else{r.cars.delete(id);r.tokens.delete(id);}}
 hostElection(r);r.updated=now();broadcast(r);
}
io.on('connection',socket=>{
 let joined:{code:string;id:string}|null=null;let lastAction=-Infinity;let rateAt=now(),rateCount=0;
 const ack=(fn:unknown,result:Reply)=>{if(typeof fn==='function')fn(result);};
 socket.on('enter',(data:unknown,fn:unknown)=>{
  const t=now();if(t-lastAction<.35){ack(fn,{ok:false,error:'Give it a moment, then try again.'});return;}lastAction=t;
  if(!data||typeof data!=='object'){ack(fn,{ok:false,error:'Invalid room request.'});return;}
  const d=data as Record<string,unknown>;const code=typeof d.code==='string'?d.code.trim().toUpperCase():'';
  const name=typeof d.name==='string'?d.name.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,18):'';
  if(!name){ack(fn,{ok:false,error:'Enter a driver name first.'});return;}
  let r:Room|undefined;
  if(d.create===true){if(rooms.size>=200){ack(fn,{ok:false,error:'The depot is full. Try again later.'});return;}
   const c=newCode();r={code:c,host:'',phase:'lobby',cars:new Map(),tokens:new Map(),sockets:new Map(),startAt:0,endAt:0,raceId:0,items:ITEM_SPOTS.map(()=>0),effects:[],updated:t};rooms.set(c,r);
  }else r=rooms.get(code);
  if(!r){lastAction=-Infinity;ack(fn,{ok:false,error:'Room no longer exists. The server may have restarted, or the room expired. Create a new room.'});return;}
  let car:Car|undefined;
  if(typeof d.token==='string')for(const [id,token]of r.tokens){if(token===d.token){car=r.cars.get(id);break;}}
  if(!car&&r.cars.size>=8){ack(fn,{ok:false,error:'This room is full (8 drivers).'});return;}
  if(joined&&(joined.code!==r.code||joined.id!==car?.id)){socket.leave(joined.code);detach(joined.id,joined.code,true);}
  if(!car){const id=randomUUID();const used=new Set([...r.cars.values()].map(c=>c.color));car=makeCar(id,name,COLORS.find(c=>!used.has(c))??COLORS[0]!);grid(car,r.cars.size);car.active=false;r.cars.set(id,car);r.tokens.set(id,randomBytes(24).toString('hex'));}
  const previous=r.sockets.get(car.id);if(previous&&previous!==socket.id){const old=io.sockets.sockets.get(previous);if(old){old.emit('replaced');old.disconnect(true);}}
  car.connected=true;car.disconnectedAt=0;car.input=neutral();r.sockets.set(car.id,socket.id);if(!r.host||!r.cars.get(r.host)?.connected)r.host=car.id;
  joined={code:r.code,id:car.id};socket.join(r.code);r.updated=t;
  ack(fn,{ok:true,id:car.id,token:r.tokens.get(car.id),code:r.code});broadcast(r);
 });
 socket.on('start',(_data:unknown,fn:unknown)=>{
  if(!joined){ack(fn,{ok:false,error:'Join a room first.'});return;}const r=rooms.get(joined.code);if(!r)return;
  if(r.host!==joined.id){ack(fn,{ok:false,error:'Only the host can start.'});return;}
  if(r.phase!=='lobby'&&r.phase!=='results'){ack(fn,{ok:false,error:'A race is already running.'});return;}
  const racers=[...r.cars.values()].filter(c=>c.connected);if(racers.length<2){ack(fn,{ok:false,error:'Bring at least one friend. Two drivers are needed.'});return;}
  for(const [id,c]of r.cars){if(!c.connected){r.cars.delete(id);r.tokens.delete(id);}}
  racers.forEach((c,i)=>grid(c,i));r.phase='countdown';r.startAt=now()+4;r.endAt=0;r.raceId++;r.items=ITEM_SPOTS.map(()=>0);r.effects=[];r.updated=now();ack(fn,{ok:true});broadcast(r);
 });
 socket.on('input',(data:unknown)=>{
  if(!joined||!data||typeof data!=='object')return;const r=rooms.get(joined.code),c=r?.cars.get(joined.id);if(!c||r?.sockets.get(c.id)!==socket.id)return;
  if(now()-rateAt>1){rateAt=now();rateCount=0;}if(++rateCount>100)return;
  const d=data as Record<string,unknown>;if(!Number.isFinite(d.throttle)||!Number.isFinite(d.steer)||!Number.isSafeInteger(d.seq))return;
  c.input={throttle:Math.max(-1,Math.min(1,Number(d.throttle))),steer:Math.max(-1,Math.min(1,Number(d.steer))),drift:d.drift===true,use:c.input.use||d.use===true,respawn:c.input.respawn||d.respawn===true,seq:Number(d.seq)};c.lastInput=now();
 });
 socket.on('leave',()=>{if(joined){const j=joined;joined=null;socket.leave(j.code);detach(j.id,j.code,true);}});
 socket.on('disconnect',()=>{if(joined){const r=rooms.get(joined.code);if(r?.sockets.get(joined.id)===socket.id)detach(joined.id,joined.code);}});
});
function tick(t:number){for(const r of rooms.values()){
 if(r.phase==='countdown'&&t>=r.startAt){r.phase='racing';for(const c of r.cars.values()){c.input.use=false;c.input.respawn=false;}}
 if(r.phase==='racing'){
 const cars=[...r.cars.values()];
 for(const c of cars){
  if(c.active&&!c.connected&&t-c.disconnectedAt>90)c.dnf=true;
  if(!c.active||c.finish!==null||c.dnf)continue;
  if(c.input.use&&c.item&&c.connected){
   if(c.item==='turbo')c.boost=3;
   else{r.effects.push({x:c.x,y:c.y,z:c.z,until:t+.7,owner:c.id});for(const other of cars){if(other.id!==c.id&&other.active&&other.finish===null&&!other.dnf&&Math.hypot(c.x-other.x,c.z-other.z)<18&&Math.abs(c.y-other.y)<4){other.stun=2;other.speed*=.45;other.driftCharge=0;}}}
   c.item=null;c.itemLock=t+.6;
  }c.input.use=false;
  stepCar(c,t,r.startAt);
  if(!c.item&&t>c.itemLock)ITEM_SPOTS.forEach((index,i)=>{const p=sample(index);if(r.items[i]!<=t&&Math.hypot(c.x-p.x,c.z-p.z)<5&&Math.abs(c.y-p.y-.65)<2.5){c.item=((r.raceId+c.passed+i)%2)?'turbo':'pulse';r.items[i]=t+5;c.itemLock=t+1;}});
 }
 collide(cars);rank(cars);
 const active=cars.filter(c=>c.active);
 if(active.some(c=>c.finish!==null)&&!r.endAt)r.endAt=t+75;
 if(t-r.startAt>600&&!r.endAt)r.endAt=t;
 if((r.endAt&&t>=r.endAt)||active.every(c=>c.finish!==null||c.dnf)){
  for(const c of active)if(c.finish===null)c.dnf=true;rank(cars);r.phase='results';r.updated=t;broadcast(r);
 }
 }r.effects=r.effects.filter(e=>e.until>t);
 }}
let previous=now(),accumulator=0,frames=0;
setInterval(()=>{const t=now();accumulator+=Math.min(.2,t-previous);previous=t;while(accumulator>=DT){tick(t-accumulator+DT);accumulator-=DT;}if(++frames%3===0)for(const r of rooms.values())broadcast(r);},1000/60);
setInterval(()=>{const t=now();for(const [code,r]of rooms){for(const [id,c]of r.cars){if(!c.connected&&t-c.disconnectedAt>90&&(r.phase==='lobby'||r.phase==='results'||!c.active)){r.cars.delete(id);r.tokens.delete(id);}}hostElection(r);if(![...r.cars.values()].some(c=>c.connected)&&t-r.updated>180)rooms.delete(code);}},10000);
const port=Number(process.env.PORT||3001),host=process.env.HOST||'0.0.0.0';
http.on('error',e=>{console.error('Backend failed to bind:',e.message);process.exit(1);});
http.listen(port,host,()=>console.log(`Parcel Panic backend ready on ${host}:${port}. Allowed origins: ${[...origins].join(', ')}`));
function shutdown(){io.emit('serverClosing');io.close();http.close(()=>process.exit(0));setTimeout(()=>process.exit(0),500).unref();}process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
