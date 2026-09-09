import { gsap } from 'gsap';

// Motion is optional. The existing controls own state, navigation and API calls.
const active = new Set();
const media = gsap.matchMedia();
let enabled = !matchMedia('(prefers-reduced-motion: reduce)').matches;
function track(animation) {
  active.add(animation);
  const finish = animation.eventCallback('onComplete');
  animation.eventCallback('onComplete', () => { active.delete(animation); finish?.(); });
  return animation;
}
function stop(targets) {
  gsap.killTweensOf(targets);
  for (const animation of active) if (!animation.isActive()) active.delete(animation);
}
function settle() {
  for (const animation of [...active]) { animation.totalProgress(1); animation.kill(); }
  active.clear();
}
media.add({ normal: '(prefers-reduced-motion: no-preference)', reduced: '(prefers-reduced-motion: reduce)' }, context => {
  enabled = !context.conditions.reduced;
  if (!enabled) { settle(); gsap.set(document.querySelectorAll('.screenshot'), { clearProps: 'transform' }); }
});
const visible = element => element.getClientRects().length > 0;
const clean = 'transform,opacity,visibility';
function enter(targets, distance = 8, duration = .22) {
  stop(targets);
  gsap.set(targets, { clearProps: clean });
  if (!enabled) return;
  track(gsap.fromTo(targets, { y: distance, opacity: .65 }, {
    y: 0, opacity: 1, duration, ease: 'power3.out', clearProps: clean, overwrite: true
  }));
}

for (const heading of document.querySelectorAll('.model h3')) {
  const name = document.createElement('span');
  name.className = 'reveal-name';
  name.textContent = heading.textContent;
  heading.replaceChildren(name);
}
let revealSequence;
function reveal(show) {
  revealSequence?.kill();
  const all = [...document.querySelectorAll('.reveal-name')];
  stop(all);
  gsap.set(all, { clearProps: clean });
  if (!show || !enabled) return;
  const targets = all.filter(visible);
  revealSequence = track(gsap.timeline({ defaults: { ease: 'power3.out' } }));
  revealSequence.fromTo(targets, { yPercent: 110, opacity: .5 }, {
    yPercent: 0, opacity: 1, duration: .3, stagger: .04, clearProps: clean
  });
}

const tabList = document.querySelector('.view-tabs');
let indicator;
if (tabList) {
  indicator = document.createElement('span');
  indicator.className = 'tab-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  tabList.append(indicator);
  tabList.classList.add('motion-tabs');
}
function positionIndicator(tab, animate = true) {
  if (!indicator || !tab) return;
  const parent = tabList.getBoundingClientRect();
  const rect = tab.getBoundingClientRect();
  const vars = { x: rect.left - parent.left, scaleX: rect.width, transformOrigin: 'left center' };
  stop(indicator);
  if (enabled && animate) track(gsap.to(indicator, { ...vars, duration: .22, ease: 'power3.out', overwrite: true }));
  else gsap.set(indicator, vars);
}
function tabChange(tab, panel) {
  positionIndicator(tab);
  // A rapid switch must never leave the previous panel partially transparent.
  const panels = document.querySelectorAll('[role="tabpanel"]');
  stop(panels);
  gsap.set(panels, { clearProps: clean });
  enter(panel, 6, .2);
}
positionIndicator(document.querySelector('[role="tab"][aria-selected="true"]'), false);
window.addEventListener('resize', () => positionIndicator(document.querySelector('[role="tab"][aria-selected="true"]'), false));

function openDialog(dialog) {
  stop(dialog);
  gsap.set(dialog, { clearProps: clean });
  if (!dialog.open) dialog.showModal();
  enter(dialog, 20, .22);
}
function closeDialog(dialog) {
  stop(dialog);
  if (!dialog.open) return;
  if (!enabled) { dialog.close(); gsap.set(dialog, { clearProps: clean }); return; }
  track(gsap.to(dialog, { y: 12, opacity: 0, duration: .15, ease: 'power2.in', overwrite: true,
    onComplete: () => { dialog.close(); gsap.set(dialog, { clearProps: clean }); }
  }));
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.classList.add('motion-dialog');
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog); });
}

function saved(form) {
  const stars = [...form.querySelectorAll('.filled span')];
  stop(stars);
  gsap.set(stars, { clearProps: 'transform' });
  if (!enabled) return;
  track(gsap.timeline().to(stars, { scale: 1.14, duration: .1, stagger: .02, ease: 'power2.out' })
    .to(stars, { scale: 1, duration: .18, stagger: .015, ease: 'power3.out', clearProps: 'transform' }));
}
function number(element, value) {
  const previous = element.dataset.value === undefined ? value : Number(element.dataset.value);
  element.dataset.value = value;
  if (element._countTween) { element._countTween.kill(); active.delete(element._countTween); }
  if (!enabled || previous === value || !visible(element)) { element.textContent = value.toFixed(1); return; }
  const counter = { value: Number(element.textContent) || previous };
  element._countTween = track(gsap.to(counter, { value, duration: .25, ease: 'power2.out',
    onUpdate: () => { element.textContent = counter.value.toFixed(1); }
  }));
}
function bar(element, ratio) {
  element.dataset.ratio = ratio;
  stop(element);
  if (!enabled || !visible(element)) gsap.set(element, { scaleX: ratio });
  else track(gsap.to(element, { scaleX: ratio, duration: .25, ease: 'power3.out', overwrite: true }));
}
function distribution(row) {
  const bars = [...row.querySelectorAll('.bar-fill')];
  stop(bars);
  if (!enabled) { for (const bar of bars) gsap.set(bar, { scaleX: Number(bar.dataset.ratio || 0) }); return; }
  track(gsap.fromTo(bars, { scaleX: 0 }, {
    scaleX: (i, bar) => Number(bar.dataset.ratio || 0), duration: .25, stagger: .025, ease: 'power3.out'
  }));
}
function captureRows(board) {
  return enabled && board && visible(board) ? new Map([...board.children].map(row => [row, row.getBoundingClientRect().top])) : null;
}
function moveRows(before) {
  if (!before || !enabled) return;
  const movements = [...before].map(([row, top]) => [row, top - row.getBoundingClientRect().top]);
  for (const [row, distance] of movements) if (Math.abs(distance) > 1) {
    stop(row);
    track(gsap.fromTo(row, { y: distance }, { y: 0, duration: .28, ease: 'power3.out', clearProps: 'transform' }));
  }
}
window.KartMotion = { reveal, tabChange, openDialog, closeDialog, saved, number, bar, distribution, captureRows, moveRows };

let pressed;
function release() {
  if (!pressed) return;
  stop(pressed);
  if (enabled) track(gsap.to(pressed, { scale: 1, duration: .16, ease: 'power3.out', clearProps: 'transform', overwrite: true }));
  else gsap.set(pressed, { clearProps: 'transform' });
  pressed = null;
}
function press(event) {
  if (!enabled) return;
  const target = event.target.closest('button:not(:disabled), a.play');
  if (!target) return;
  release(); pressed = target;
  track(gsap.to(target, { scale: .97, duration: .08, ease: 'power2.out', overwrite: true }));
}
document.addEventListener('pointerdown', press);
document.addEventListener('pointerup', release);
document.addEventListener('pointercancel', release);
document.addEventListener('keydown', event => { if (!event.repeat && ['Enter', ' '].includes(event.key)) press(event); });
document.addEventListener('keyup', release);
window.addEventListener('blur', release);
const hover = matchMedia('(hover: hover) and (pointer: fine)');
for (const card of document.querySelectorAll('.game')) {
  const picture = card.querySelector('.screenshot');
  const zoom = scale => { if (!enabled || !hover.matches) return; stop(picture); track(gsap.to(picture, { scale, duration: .25, ease: 'power3.out', overwrite: true, ...(scale === 1 ? { clearProps: 'transform' } : {}) })); };
  card.addEventListener('pointerenter', () => zoom(1.025));
  card.addEventListener('pointerleave', () => zoom(1));
}

let firstVisit = true;
try { firstVisit = sessionStorage.getItem('kart-arrival') !== 'seen'; if (document.querySelector('.games')) sessionStorage.setItem('kart-arrival', 'seen'); } catch { /* Storage is optional. */ }
if (firstVisit && enabled && document.querySelector('.games')) {
  const targets = [...document.querySelectorAll('.intro h1, .intro p, .game')].filter(element => visible(element) && element.getBoundingClientRect().top < innerHeight);
  track(gsap.fromTo(targets, { y: 10, opacity: .8 }, { y: 0, opacity: 1, duration: .35, stagger: .035, ease: 'power3.out', clearProps: clean }));
}
// Finish transient states before a page enters the back/forward cache.
window.addEventListener('pagehide', settle);
