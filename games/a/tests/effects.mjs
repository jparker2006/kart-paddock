import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const b=await chromium.launch({headless:false,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const pages=[],checks=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 for(let i=0;i<2;i++){const c=await b.newContext({viewport:{width:1000,height:700}}),p=await c.newPage();pages.push(p);await p.goto(process.env.TEST_URL||'http://localhost:5173/');await p.waitForFunction(()=>window.parcelDiagnostics?.().connected);await p.locator('#name').fill(i?'Horn tester':'Drift tester');if(i){await p.locator('#code').fill(await pages[0].locator('#room-code').innerText());await p.locator('#join').click({force:true});}else await p.locator('#create').click({force:true});await p.locator('#room-code').waitFor();}
 for(const p of pages)await p.evaluate(()=>{
  window.effectProof={drift:false,boost:false,turbo:false,pulse:false,hit:false};let tick=0;
  const key=(code,down)=>document.querySelector('#game').dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,bubbles:true,repeat:false}));
  setInterval(()=>{const d=window.parcelDiagnostics(),s=d.state,c=s?.players.find(p=>p.id===d.myId);if(!c||s.phase!=='racing'||c.finish!==null)return;const proof=window.effectProof;proof.drift ||= c.driftCharge>.65;proof.boost ||= c.boost>0;proof.turbo ||= c.item==='turbo';proof.pulse ||= c.item==='pulse';proof.hit ||= s.players.some(p=>p.stun>0);
   const t=((c.segment+7)%480)/480*Math.PI*2,desired=Math.atan2(90*Math.sin(t)-c.x,65*Math.sin(2*t)-c.z),err=Math.atan2(Math.sin(desired-c.heading),Math.cos(desired-c.heading));key('KeyW',true);key('KeyA',err<-.055);key('KeyD',err>.055);key('ShiftLeft',c.name==='Drift tester'&&c.segment>40&&c.segment<78);key('Space',!!c.item);
  },40);
 });
 await pages[0].locator('#start').click({force:true});
 const waiterContext=await b.newContext({viewport:{width:1000,height:700}}),waiter=await waiterContext.newPage();await waiter.goto(process.env.TEST_URL||'http://localhost:5173/');await waiter.waitForFunction(()=>window.parcelDiagnostics?.().connected);await waiter.locator('#name').fill('Next round driver');const hostRoom=await pages[0].evaluate(()=>window.parcelDiagnostics().state.code);await waiter.locator('#code').fill(hostRoom);await waiter.locator('#join').click({force:true});await waiter.getByText('Next dispatch',{exact:true}).waitFor();checks.push('Real late browser arrival displayed Next dispatch and waited outside the active race');await waiter.screenshot({path:'artifacts/late-join.png'});
 let proof=[];for(let i=0;i<80;i++){await sleep(1000);proof=await Promise.all(pages.map(p=>p.evaluate(()=>window.effectProof)));if(proof.some(p=>p.drift)&&proof.some(p=>p.boost)&&proof.some(p=>p.turbo)&&proof.some(p=>p.pulse)&&proof.some(p=>p.hit))break;}
 assert(proof.some(p=>p.drift));assert(proof.some(p=>p.boost));assert(proof.some(p=>p.turbo));assert(proof.some(p=>p.pulse));assert(proof.some(p=>p.hit));checks.push('Real Chromium keyboard drivers charged a drift, received a boost, collected both item types, used them, and observed a rival slowed by the air horn');
 await pages[0].screenshot({path:'artifacts/items-and-drift.png'});
 await pages[0].waitForFunction(()=>window.parcelDiagnostics().state?.phase==='results',null,{timeout:200000,polling:200});await pages[0].locator('#start').click({force:true});await waiter.waitForFunction(()=>{const d=window.parcelDiagnostics();return d.state?.raceId===2&&d.state.players.find(p=>p.id===d.myId)?.active;},null,{polling:100});checks.push('Late arrival became an active racer when the host rematched');
 console.log(JSON.stringify({checks,proof}));await writeFile('artifacts/effects-report.json',JSON.stringify({checks,proof},null,2));
}catch(e){console.error(e);await writeFile('artifacts/effects-report.json',JSON.stringify({checks,error:String(e.stack)},null,2));process.exitCode=1;}finally{await b.close();}
