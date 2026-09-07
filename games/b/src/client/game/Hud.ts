import { ITEM_INFO, type ItemKind } from '../../shared/constants.ts';
import { Minimap } from './Minimap.ts';

export interface StandingRow {
  id: string;
  name: string;
  color: string;
  lap: number;
  place: number;
  finished: boolean;
  connected: boolean;
  isLocal: boolean;
  finishTimeMs: number | null;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}

export function formatTime(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const t = Math.floor((total % 1000) / 100);
  return `${m}:${s.toString().padStart(2, '0')}.${t}`;
}

/** Race heads-up display (plain DOM on top of the canvas). */
export class Hud {
  readonly root: HTMLElement;
  readonly minimap: Minimap;
  private lapEl: HTMLElement;
  private placeEl: HTMLElement;
  private standingsEl: HTMLElement;
  private itemEl: HTMLElement;
  private itemIcon: HTMLElement;
  private itemLabel: HTMLElement;
  private speedBar: HTMLElement;
  private speedText: HTMLElement;
  private driftBar: HTMLElement;
  private driftWrap: HTMLElement;
  private countdownEl: HTMLElement;
  private messageEl: HTMLElement;
  private wrongWayEl: HTMLElement;
  private timerEl: HTMLElement;
  private respawnHint: HTMLElement;
  private messageTimer: number | null = null;
  private lastStandingsKey = '';
  /** set by the app: leaves the room from inside a race */
  onLeave: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-lap">LAP <b>1</b><span>/3</span></div>
        <div class="hud-place"><b>1</b><sup>st</sup></div>
        <div class="hud-timer">0:00.0</div>
      </div>
      <div class="hud-top-right">
        <canvas class="hud-minimap" width="180" height="180" aria-label="track map"></canvas>
        <ol class="hud-standings"></ol>
      </div>
      <div class="hud-bottom-left">
        <div class="hud-item empty">
          <div class="hud-item-icon">·</div>
          <div class="hud-item-text"><div class="hud-item-label">No item</div><div class="hud-item-hint">Drive through a honey jar</div></div>
        </div>
      </div>
      <div class="hud-bottom-right">
        <div class="hud-drift"><i></i></div>
        <div class="hud-speed"><div class="hud-speed-bar"><i></i></div><span>0 km/h</span></div>
      </div>
      <div class="hud-center">
        <div class="hud-countdown"></div>
        <div class="hud-message"></div>
        <div class="hud-wrongway">WRONG WAY</div>
        <div class="hud-respawn-hint">Stuck? Press <kbd>R</kbd> to respawn</div>
      </div>
      <button class="hud-leave" type="button" title="Leave this room">Leave room</button>
      <div class="hud-controls">
        <span><kbd>W</kbd>/<kbd>↑</kbd> accelerate</span><span><kbd>S</kbd>/<kbd>↓</kbd> brake</span>
        <span><kbd>A</kbd><kbd>D</kbd>/<kbd>←</kbd><kbd>→</kbd> steer</span><span><kbd>Shift</kbd> drift → boost</span>
        <span><kbd>E</kbd> item</span><span><kbd>R</kbd> respawn</span><span><kbd>M</kbd> mute</span>
      </div>`;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.lapEl = q('.hud-lap');
    this.placeEl = q('.hud-place');
    this.standingsEl = q('.hud-standings');
    this.itemEl = q('.hud-item');
    this.itemIcon = q('.hud-item-icon');
    this.itemLabel = q('.hud-item-label');
    this.speedBar = q('.hud-speed-bar i');
    this.speedText = q('.hud-speed span');
    this.driftBar = q('.hud-drift i');
    this.driftWrap = q('.hud-drift');
    this.countdownEl = q('.hud-countdown');
    this.messageEl = q('.hud-message');
    this.wrongWayEl = q('.hud-wrongway');
    this.timerEl = q('.hud-timer');
    this.respawnHint = q('.hud-respawn-hint');
    this.minimap = new Minimap(q<HTMLCanvasElement>('.hud-minimap'));
    q('.hud-leave').addEventListener('click', () => this.onLeave?.());
    window.addEventListener('resize', () => this.minimap.resize());
  }

  show(): void {
    this.root.hidden = false;
    this.minimap.resize();
  }

  hide(): void {
    this.root.hidden = true;
    this.showCountdown('');
    this.setWrongWay(false);
    this.messageEl.textContent = '';
  }

  setLap(lap: number, total: number): void {
    this.lapEl.innerHTML = lap > total ? `<b>FINISHED</b>` : `LAP <b>${lap}</b><span>/${total}</span>`;
  }

  setPlace(place: number): void {
    if (place <= 0) {
      this.placeEl.innerHTML = '<b>–</b>';
      return;
    }
    this.placeEl.innerHTML = `<b>${place}</b><sup>${ordinal(place)}</sup>`;
  }

  setTimer(ms: number): void {
    this.timerEl.textContent = formatTime(ms);
  }

  setStandings(rows: StandingRow[]): void {
    const key = rows.map((r) => `${r.id}${r.place}${r.lap}${r.finished}${r.connected}`).join('|');
    if (key === this.lastStandingsKey) return;
    this.lastStandingsKey = key;
    this.standingsEl.innerHTML = rows
      .slice()
      .sort((a, b) => a.place - b.place)
      .map(
        (r) =>
          `<li class="${r.isLocal ? 'me' : ''} ${r.connected ? '' : 'offline'}">
            <span class="pos">${r.place}</span>
            <span class="swatch" style="background:${r.color}"></span>
            <span class="name">${escapeHtml(r.name)}</span>
            <span class="lap">${r.finished ? (r.finishTimeMs !== null ? formatTime(r.finishTimeMs) : '✓') : r.connected ? `L${r.lap}` : '…'}</span>
          </li>`,
      )
      .join('');
  }

  setItem(item: ItemKind | null): void {
    if (!item) {
      this.itemEl.classList.add('empty');
      this.itemIcon.textContent = '·';
      this.itemLabel.textContent = 'No item';
      return;
    }
    const info = ITEM_INFO[item];
    this.itemEl.classList.remove('empty');
    this.itemIcon.textContent = info.emoji;
    this.itemLabel.textContent = info.label;
    this.itemEl.classList.remove('pop');
    void this.itemEl.offsetWidth;
    this.itemEl.classList.add('pop');
  }

  setSpeed(ratio: number, kmh: number, boosting: boolean): void {
    this.speedBar.style.width = `${Math.min(100, ratio * 100)}%`;
    this.speedBar.classList.toggle('boost', boosting);
    this.speedText.textContent = `${Math.round(kmh)} km/h`;
  }

  setDrift(charge: number, active: boolean): void {
    this.driftWrap.classList.toggle('active', active);
    this.driftBar.style.width = `${Math.min(100, charge * 100)}%`;
    this.driftBar.classList.toggle('super', charge >= 1);
    this.driftBar.classList.toggle('mini', charge >= 0.45 && charge < 1);
  }

  showCountdown(text: string, cls = ''): void {
    this.countdownEl.textContent = text;
    this.countdownEl.className = `hud-countdown ${cls}`;
    if (text) {
      this.countdownEl.classList.remove('pulse');
      void this.countdownEl.offsetWidth;
      this.countdownEl.classList.add('pulse');
    }
  }

  showMessage(text: string, ms = 2200, cls = ''): void {
    this.messageEl.textContent = text;
    this.messageEl.className = `hud-message show ${cls}`;
    if (this.messageTimer) window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => {
      this.messageEl.classList.remove('show');
    }, ms);
  }

  setWrongWay(on: boolean): void {
    this.wrongWayEl.classList.toggle('show', on);
  }

  setRespawnHint(on: boolean): void {
    this.respawnHint.classList.toggle('show', on);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
