const tabs=[...document.querySelectorAll('[role="tab"]')];
function selectTab(tab,updateHash=true){for(const item of tabs){const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;document.getElementById(item.getAttribute('aria-controls')).hidden=!selected;}if(updateHash)history.replaceState(null,'',tab.id==='tab-results'?'#community':location.pathname);}
for(const [i,tab] of tabs.entries()){tab.addEventListener('click',()=>selectTab(tab));tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=tabs[(i+1)%tabs.length];if(event.key==='ArrowLeft')next=tabs[(i+tabs.length-1)%tabs.length];if(event.key==='Home')next=tabs[0];if(event.key==='End')next=tabs.at(-1);if(next){event.preventDefault();selectTab(next);next.focus();}});}
if(location.hash==='#community')selectTab(tabs[1],false);
window.addEventListener('hashchange',()=>selectTab(location.hash==='#community'?tabs[1]:tabs[0],false));

// A narrow laptop window is not a phone. Prefer the browser's mobile signal,
// then phone user agents, with a small touch-only screen as the final fallback.
const phoneNote = document.querySelector('#phone-note');
const mobileSignal = navigator.userAgentData?.mobile;
const phoneAgent = /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent);
const smallTouchScreen = matchMedia('(hover: none) and (pointer: coarse)').matches
  && Math.min(screen.width, screen.height) < 600;
if (phoneNote) phoneNote.hidden = !(mobileSignal === true || phoneAgent || (mobileSignal === undefined && smallTouchScreen));
