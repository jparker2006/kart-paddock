import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCar,grid,stepCar,advanceGates,respawn,neutral,DT,rank} from '../src/server/physics.js';
import {TRACK,sample,surfaces,angleDiff,N,GATES,WIDTH} from '../src/shared/track.js';
function car(){const c=makeCar('driver','Driver',0);grid(c,0);return c;}
test('overpass has two real surfaces 14m apart',()=>{const levels=surfaces(0,0).map(s=>s.y);assert(levels.some(y=>Math.abs(y-5)<.1));assert(levels.some(y=>Math.abs(y-19)<.1));});
test('crossing finish early or backward cannot complete a lap',()=>{const c=car();const p=TRACK[0]!;c.segment=0;c.y=p.y+.65;c.x=p.x+p.tx;c.z=p.z+p.tz;advanceGates(c,{x:p.x-p.tx,y:c.y,z:p.z-p.tz},5,0);assert.equal(c.lap,0);assert.equal(c.passed,0);c.nextGate=0;c.x=p.x-p.tx;c.z=p.z-p.tz;advanceGates(c,{x:p.x+p.tx,y:c.y,z:p.z+p.tz},6,0);assert.equal(c.lap,0);});
test('wrong vertical level and unordered checkpoints are rejected',()=>{const c=car();c.nextGate=0;c.segment=240;c.y=19.65;const p=TRACK[0]!;c.x=p.tx;c.z=p.tz;advanceGates(c,{x:-p.tx,y:c.y,z:-p.tz},5,0);assert.equal(c.passed,0);c.nextGate=4;const wrong=TRACK[150]!;c.segment=150;c.x=wrong.x+wrong.tx;c.z=wrong.z+wrong.tz;c.y=wrong.y+.65;advanceGates(c,{x:wrong.x-wrong.tx,y:c.y,z:wrong.z-wrong.tz},6,0);assert.equal(c.passed,0);});
test('rescue preserves earned checkpoint count and does not award a lap',()=>{const c=car();c.passed=20;c.nextGate=5;c.lap=1;respawn(c,10);assert.equal(c.passed,20);assert.equal(c.nextGate,5);assert.equal(c.lap,1);assert.equal(c.segment,122);});
test('ground support never snaps between overpass decks',()=>{for(const i of [0,240]){const c=car(),p=TRACK[i]!;Object.assign(c,{x:p.x,y:p.y+.65,z:p.z,segment:i,heading:Math.atan2(p.tx,p.tz),speed:10});for(let j=0;j<10;j++)stepCar(c,j*DT,0);assert(Math.abs(c.y-p.y-.65)<1);}});
test('three complete laps are driveable with real physics, including jump landings',()=>{
 const c=car();let airborne=false,landed=false,wasAir=false,maxY=0,t=0;
 for(let step=0;step<60*220&&c.finish===null;step++){
  t=step*DT;const target=sample(c.segment+7);const desired=Math.atan2(target.x-c.x,target.z-c.z);const e=angleDiff(desired,c.heading);
  c.input={...neutral(),throttle:1,steer:Math.max(-1,Math.min(1,e*2.4))};c.lastInput=t;
  stepCar(c,t,0);maxY=Math.max(maxY,c.y);if(!c.grounded)airborne=true;if(wasAir&&c.grounded)landed=true;wasAir=!c.grounded;
 }
 assert.equal(c.lap,3,JSON.stringify({lap:c.lap,passed:c.passed,segment:c.segment,respawns:c.respawns,x:c.x,y:c.y,z:c.z,t}));assert.equal(c.passed,48);assert(airborne&&landed);assert(maxY>19);assert.equal(c.respawns,0);assert(c.finish!==null);
});
test('rank prioritizes consistent finish times then earned progress',()=>{const a=car(),b=makeCar('b','B',1);grid(b,1);a.finish=99;b.finish=90;rank([a,b]);assert.equal(b.place,1);assert.equal(a.place,2);});
