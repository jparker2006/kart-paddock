const screen=document.querySelector('#game-loading');
const title=document.querySelector('#loading-title');
const message=document.querySelector('#loading-message');
const retry=document.querySelector('#retry-game');
const frame=document.querySelector('#game-frame');
const fullWindow=document.querySelector('#full-window');
let controller,timer,deadline,opening=false,stopped=false;

function clear(){clearTimeout(timer);controller?.abort();}
function failed(heading,detail){
  clear();opening=false;screen.dataset.state='error';
  title.textContent=heading;message.textContent=detail;retry.hidden=false;
}
function openGame(){
  opening=true;title.textContent='Opening game';
  message.textContent='The server is ready. Loading the game…';
  // Query strings and room-link fragments belong to the original game.
  frame.src=frame.dataset.src+location.search+location.hash;
  fullWindow.href=frame.src;
  timer=setTimeout(()=>failed('The game is taking a while','Try again, or open it in a full window.'),30000);
  fullWindow.hidden=false;
}
async function check(){
  if(stopped)return;
  const remaining=deadline-Date.now();
  if(remaining<=0){failed('The server hasn’t responded yet','It may still be starting. Try again in a moment.');return;}
  controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Math.min(12000,remaining));
  let ready=false;
  try{
    const response=await fetch(`/api/game-health?game=${screen.dataset.game}`,{signal:controller.signal,cache:'no-store'});
    ready=response.ok&&(await response.json()).ready===true;
  }catch{/* A sleeping or unreachable server gets another bounded attempt. */}
  finally{clearTimeout(timeout);}
  if(stopped)return;
  if(ready){openGame();return;}
  if(Date.now()>=deadline){failed('The server hasn’t responded yet','It may still be starting. Try again in a moment.');return;}
  timer=setTimeout(check,2000);
}
function start(){
  clear();stopped=false;opening=false;retry.hidden=true;
  frame.hidden=true;frame.removeAttribute('src');fullWindow.hidden=true;
  screen.hidden=false;screen.dataset.state='loading';
  title.textContent='Starting the game server';
  message.textContent='This can take about a minute. Your game will open automatically.';
  deadline=Date.now()+90000;check();
}
frame.addEventListener('load',()=>{
  if(!opening||!frame.hasAttribute('src'))return;
  if(frame.contentDocument?.URL==='about:blank')return;
  clear();opening=false;screen.hidden=true;frame.hidden=false;
});
retry.addEventListener('click',start);
window.addEventListener('pagehide',()=>{stopped=true;clear();});
window.addEventListener('pageshow',event=>{if(event.persisted&&!screen.hidden)start();});
start();
