import {TRACK,N,GATES,WIDTH,LAUNCH,sample,surfaces,angleDiff,clamp,wrap} from '../shared/track.js';
import type {Input,Kart} from '../shared/types.js';
export const DT=1/60;
export const neutral=():Input=>({throttle:0,steer:0,drift:false,use:false,respawn:false,seq:0});
export type Car=Kart & { input:Input;lastInput:number;lastRespawn:number;launchLock:number;itemLock:number;lastGateAt:number;disconnectedAt:number;offTrack:number };
export function makeCar(id:string,name:string,color:number):Car {
 return {id,name,color,connected:true,active:false,x:0,y:0,z:0,heading:0,speed:0,vx:0,vz:0,vy:0,grounded:true,segment:0,lap:0,nextGate:1,passed:0,driftCharge:0,drifting:false,boost:0,stun:0,item:null,finish:null,dnf:false,place:1,respawns:0,airTime:0,input:neutral(),lastInput:0,lastRespawn:-10,launchLock:0,itemLock:0,lastGateAt:0,disconnectedAt:0,offTrack:0};
}
export function grid(car:Car,index:number){
 const p=sample(6-Math.floor(index/2)*1.8),side=index%2===0?-2.8:2.8;
 Object.assign(car,{x:p.x+p.nx*side,y:p.y+.65,z:p.z+p.nz*side,heading:Math.atan2(p.tx,p.tz),speed:0,vx:0,vz:0,vy:0,grounded:true,segment:p.index,lap:0,nextGate:1,passed:0,driftCharge:0,drifting:false,boost:0,stun:0,item:null,finish:null,dnf:false,respawns:0,active:true,airTime:0,offTrack:0,input:neutral(),lastGateAt:0});
}
export function respawn(car:Car,now:number){
 if(now-car.lastRespawn<1.5)return;
 // Return to the last earned checkpoint, just after its plane. No gate is awarded.
 const index=car.passed===0?5:wrap((car.nextGate+GATES-1)%GATES*(N/GATES)+2);
 const p=sample(index),side=((car.color%3)-1)*2;
 Object.assign(car,{x:p.x+p.nx*side,y:p.y+.65,z:p.z+p.nz*side,heading:Math.atan2(p.tx,p.tz),speed:0,vx:0,vz:0,vy:0,grounded:true,segment:index,driftCharge:0,drifting:false,boost:0,stun:0,airTime:0,offTrack:0,lastRespawn:now,launchLock:now+1});car.respawns++;
}
export function advanceGates(car:Car,old:{x:number;y:number;z:number},now:number,startAt:number){
 const p=TRACK[car.nextGate*(N/GATES)]!;
 const before=(old.x-p.x)*p.tx+(old.z-p.z)*p.tz,after=(car.x-p.x)*p.tx+(car.z-p.z)*p.tz;
 const lateral=Math.abs((car.x-p.x)*p.nx+(car.z-p.z)*p.nz);
 const near=Math.min(wrap(car.segment-p.index),wrap(p.index-car.segment))<9;
 if(before<=0&&after>0&&lateral<WIDTH/2&&Math.abs(car.y-.65-p.y)<3&&near&&now-car.lastGateAt>.25){
  car.passed++;car.nextGate=(car.nextGate+1)%GATES;car.lastGateAt=now;
  if(p.index===0){car.lap++;if(car.lap===3){car.finish=Math.max(0,now-startAt);car.speed=0;car.input=neutral();}}
 }
}
export function stepCar(car:Car,now:number,startAt:number,dt=DT){
 if(!car.active||car.finish!==null||car.dnf)return;
 const input=car.connected&&now-car.lastInput<.65?car.input:neutral();
 if(input.respawn){respawn(car,now);input.respawn=false;return;}
 const old={x:car.x,y:car.y,z:car.z};
 car.boost=Math.max(0,car.boost-dt);car.stun=Math.max(0,car.stun-dt);
 const drifting=input.drift&&Math.abs(car.speed)>9&&car.grounded&&Math.abs(input.steer)>.15;
 if(drifting){car.driftCharge=clamp(car.driftCharge+dt*(.45+Math.abs(input.steer)*.3),0,1.5);}
 else if(car.drifting){if(car.driftCharge>.65)car.boost=Math.max(car.boost,.7+car.driftCharge);car.driftCharge=0;}
 car.drifting=drifting;
 const maxSpeed=car.stun>0?10:car.boost>0?43:29;
 if(input.throttle>0)car.speed+= (car.boost>0?24:15)*dt;
 else if(input.throttle<0)car.speed-= (car.speed>0?30:9)*dt;
 else car.speed*=Math.pow(.48,dt);
 car.speed=clamp(car.speed,-9,maxSpeed);
 if(Math.abs(car.speed)<.05)car.speed=0;
 const handling=(drifting?1.95:1.5)*clamp(Math.abs(car.speed)/9,0,1)*(car.speed<0?-1:1)*(car.grounded?1:.38);
 car.heading+=input.steer*handling*dt;
 const targetX=Math.sin(car.heading)*car.speed,targetZ=Math.cos(car.heading)*car.speed;
 const grip=car.grounded?(drifting?4.0:11):1.4;
 const blend=1-Math.exp(-grip*dt);
 car.vx+=(targetX-car.vx)*blend;car.vz+=(targetZ-car.vz)*blend;
 car.x+=car.vx*dt;car.z+=car.vz*dt;
 const candidates=surfaces(car.x,car.z);
 // Ground contact must be vertically continuous; overlapping road decks never teleport the kart.
 const support=candidates.filter(s=>Math.abs(s.y+.65-car.y)<1.3).sort((a,b)=>a.distance-b.distance)[0];
 if(car.grounded&&support&&support.distance<=WIDTH/2){
  const prev=car.segment;car.segment=support.index;car.y=support.y+.65;car.vy=0;car.offTrack=0;
  if(prev<LAUNCH&&car.segment>=LAUNCH&&car.speed>12&&now>car.launchLock){car.grounded=false;car.vy=8.2;car.launchLock=now+3;}
 }else{
  car.grounded=false;car.vy-=22*dt;car.y+=car.vy*dt;car.airTime+=dt;car.offTrack+=dt;
  const land=candidates.filter(s=>s.distance<=WIDTH/2&&car.vy<=0&&old.y>=s.y+.5&&car.y<=s.y+.75).sort((a,b)=>b.y-a.y)[0];
  if(land){car.y=land.y+.65;car.vy=0;car.grounded=true;car.segment=land.index;car.airTime=0;car.offTrack=0;}
 }
 if(car.grounded&&support&&Math.abs(support.lateral)>WIDTH/2-.75){
  // Soft curbs forgive small mistakes; deliberate departures still fall off the physical road.
  car.speed*=Math.pow(.45,dt);
 }
 if(car.y < -5||car.offTrack>4){respawn(car,now);return;}
 advanceGates(car,old,now,startAt);
}
export function collide(cars:Car[]){
 for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
 const a=cars[i]!,b=cars[j]!;if(!a.active||!b.active||a.finish!==null||b.finish!==null||a.dnf||b.dnf)continue;
 const dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
 if(d<2.05&&d>.001&&Math.abs(a.y-b.y)<1.5){const push=(2.05-d)*.5,nx=dx/d,nz=dz/d;a.x-=nx*push;a.z-=nz*push;b.x+=nx*push;b.z+=nz*push;a.vx-=nx*1.3;a.vz-=nz*1.3;b.vx+=nx*1.3;b.vz+=nz*1.3;}
 }
}
export function rank(cars:Car[]){
 const progress=(c:Car)=>c.passed*30+clamp(wrap(c.segment-((c.nextGate+15)%16)*30),0,29.99);
 cars.filter(c=>c.active).sort((a,b)=>{
 if(a.finish!==null&&b.finish!==null)return a.finish-b.finish||a.id.localeCompare(b.id);
 if(a.finish!==null)return -1;if(b.finish!==null)return 1;if(a.dnf!==b.dnf)return a.dnf?1:-1;return progress(b)-progress(a)||a.id.localeCompare(b.id);
 }).forEach((c,i)=>c.place=i+1);
}
