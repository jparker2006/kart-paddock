import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= 'artifacts/browsers';
const url=process.env.TEST_URL||'http://localhost:5173/';
const report={url,started:new Date().toISOString(),browsers:[],checks:[],errors:[],telemetry:[]};
const browsers=[],contexts=[],pages=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const diag=p=>p.evaluate(()=>window.parcelDiagnostics());
async function ready(p){await p.goto(url);await p.waitForFunction(()=>window.parcelDiagnostics?.().connected);}
async function enter(p,name,code){await p.locator('#name').fill(name);if(code){await p.locator('#code').fill(code);await p.locator('#join').click({force:true});}else await p.locator('#create').click({force:true});await p.locator('#room-code').waitFor();return p.locator('#room-code').innerText();}
async function installDriver(p,offset=0){await p.evaluate(({offset})=>{
 const held=new Set();window.testDrive=true;window.testEvents={ticks:0,jump:0,land:0,under:0,over:0,items:[],boost:false,drift:false,maxLap:0};let airborne=false,lastRespawn=0;
 const key=(code,down)=>{if(down){document.querySelector('#game').dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true,repeat:held.has(code)}));held.add(code);}if(!down&&held.has(code)){document.querySelector('#game').dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));held.delete(code);}};
 window.testDriverTimer=setInterval(()=>{
  const d=window.parcelDiagnostics(),s=d.state,c=s?.players.find(p=>p.id===d.myId);if(!c)return;const e=window.testEvents;e.ticks++;
  if(c.segment>100&&c.segment<120&&!c.grounded)e.jump++;
  if(airborne&&c.grounded)e.land++;airborne=!c.grounded;if(c.segment<8&&c.y<8)e.under++;if(c.segment>235&&c.segment<245&&c.y>17)e.over++;
  e.maxLap=Math.max(e.maxLap,c.lap);if(c.item&&!e.items.includes(c.item))e.items.push(c.item);if(c.boost>0)e.boost=true;if(c.driftCharge>.65)e.drift=true;
  if(!window.testDrive||s.phase!=='racing'||c.finish!==null||c.dnf||!d.connected){for(const k of held)key(k,false);return;}
  const t=((c.segment+7)%480)/480*Math.PI*2,tx=90*Math.sin(t),tz=65*Math.sin(2*t),heading=Math.atan2(tx-c.x,tz-c.z),err=Math.atan2(Math.sin(heading-c.heading),Math.cos(heading-c.heading));
  key('KeyW',true);key('KeyA',err<-.055);key('KeyD',err>.055);
  // Test-only driver uses the same keyboard events as a person, never writes kart state.
  if(window.testUse&&c.item)key('Space',true);else key('Space',false);
  key('ShiftLeft',!!window.testDrift&&c.segment>30&&c.segment<80);
 },40);
 },{offset});}
try{
 await mkdir('artifacts',{recursive:true});
 for(const [name,type]of [['Chromium',chromium],['Firefox',firefox],['WebKit',webkit]]){
  console.log('Launching',name); const b=await type.launch({headless:name!=='Chromium', ...(name==='Chromium'?{args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']}:{}), ...(name==='Firefox'?{firefoxUserPrefs:{'dom.min_background_timeout_value':10,'dom.timeout.enable_budget_timer_throttling':false}}:{})});browsers.push(b);const context=await b.newContext({viewport:{width:1280,height:800}});contexts.push(context);const p=await context.newPage();pages.push(p);p.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));await ready(p);report.browsers.push({name,version:b.version()});console.log('Ready',name);
 }
 await pages[0].screenshot({path:'artifacts/home-chromium.png'});
 const code=await enter(pages[0],'Cora');await enter(pages[1],'Finley',code);await enter(pages[2],'Wren',code);
 for(const p of pages)await p.waitForFunction(()=>window.parcelDiagnostics().state?.players.length===3);
 report.checks.push('Three independent browser engines joined the same lobby');
 await pages[0].screenshot({path:'artifacts/lobby-three.png'});
 for(let i=0;i<pages.length;i++)await installDriver(pages[i],i);
 await pages[0].locator('#start').click({force:true});
 for(const p of pages)await p.waitForFunction(()=>window.parcelDiagnostics().state?.phase==='racing');
 await sleep(3000);await pages[0].screenshot({path:'artifacts/race-start.png'});
 const begin=Date.now();let lastLog=0,airShot=false,bridgeShot=false;
 while(Date.now()-begin<240000){
  const ds=await Promise.all(pages.map(diag));const c=ds[0].state.players.find(p=>p.id===ds[0].myId);
  if(!airShot&&c.segment>101&&c.segment<120){await pages[0].screenshot({path:'artifacts/jump.png'});airShot=true;}
  if(!bridgeShot&&c.segment>230&&c.segment<245){await pages[0].screenshot({path:'artifacts/overpass.png'});bridgeShot=true;}
  if(Date.now()-lastLog>10000){const log=ds.map(d=>{const c=d.state.players.find(p=>p.id===d.myId);return {name:c.name,lap:c.lap,gate:c.passed,seg:Math.round(c.segment),rescue:c.respawns,finish:c.finish,phase:d.state.phase,speed:Math.round(c.speed),heading:+c.heading.toFixed(2),x:+c.x.toFixed(1),z:+c.z.toFixed(1)};});console.log(JSON.stringify(log));report.telemetry.push(log);lastLog=Date.now();}
  if(ds.every(d=>d.state.phase==='results'))break;await sleep(200);
 }
 const finals=await Promise.all(pages.map(diag));assert(finals.every(d=>d.state.phase==='results'),'All browsers must show results');
 const result=d=>d.state.players.filter(p=>p.active).sort((a,b)=>a.place-b.place).map(p=>({id:p.id,name:p.name,place:p.place,lap:p.lap,passed:p.passed,finish:p.finish,dnf:p.dnf}));
 const expected=result(finals[0]);assert(expected.every(p=>p.lap===3&&p.passed===48&&p.finish!==null&&!p.dnf),'Every browser must finish three valid laps');for(const d of finals)assert.deepEqual(result(d),expected);
 report.results=expected;report.checks.push('All three real browser clients completed 48 ordered gates / three valid laps and displayed identical results');
 report.driving=await Promise.all(pages.map(p=>p.evaluate(()=>window.testEvents)));report.checks.push('Jump launch and landing plus upper/lower crossing traversed by automated keyboard drivers');
 for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:`artifacts/results-${report.browsers[i].name.toLowerCase()}.png`});
 await pages[0].locator('#start').click({force:true});for(const p of pages)await p.waitForFunction(()=>window.parcelDiagnostics().state?.raceId===2&&window.parcelDiagnostics().state?.phase==='racing');report.checks.push('Host rematch reset all three browsers into race 2');
 // Reload is a true client disconnection and restores the same race token.
 await pages[1].evaluate(()=>{window.testDrive=false;});const before=await diag(pages[1]);await pages[1].reload();await pages[1].waitForFunction(()=>window.parcelDiagnostics().state?.phase==='racing');const after=await diag(pages[1]);assert.equal(after.myId,before.myId);assert.equal(after.state.raceId,2);report.checks.push('Firefox reload rejoined the same driver in the ongoing rematch');
 await installDriver(pages[1]);
 // Rescue through actual keyboard control, checking no unearned progress.
 await pages[2].evaluate(()=>{window.testDrive=false;});await sleep(200);const beforeR=await diag(pages[2]);await pages[2].locator('#game').focus();await pages[2].keyboard.press('r');await pages[2].waitForFunction(n=>window.parcelDiagnostics().state.players.find(p=>p.id===window.parcelDiagnostics().myId).respawns>n,beforeR.state.players.find(p=>p.id===beforeR.myId).respawns);const afterR=await diag(pages[2]);assert.equal(afterR.state.players.find(p=>p.id===afterR.myId).passed,beforeR.state.players.find(p=>p.id===beforeR.myId).passed);report.checks.push('WebKit keyboard rescue preserved checkpoints');
 report.checks.push('No uncaught client JavaScript errors: '+report.errors.length);assert.equal(report.errors.length,0);
 console.log('PASS',JSON.stringify(report.checks));
}catch(e){report.failure=String(e.stack||e);console.error(e);process.exitCode=1;for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:`artifacts/failure-${i}.png`}).catch(()=>{});}
finally{report.ended=new Date().toISOString();await writeFile('artifacts/browser-report.json',JSON.stringify(report,null,2));for(const b of browsers)await b.close();}
