import { CHARACTERS, type ItemKind, type ResultRow, type StateBatch } from '../../shared/protocol';

export const ITEM_META: Record<ItemKind, { icon: string; label: string; desc: string }> = {
  boost: { icon: '🧃', label: 'Cider Turbo', desc: 'A swig of cider — instant speed!' },
  slick: { icon: '🍯', label: 'Honey Drop', desc: 'Drops sticky honey behind you' },
  rocket: { icon: '🌽', label: 'Corn Cobber', desc: 'Fires forward, spins out the first kart it meets' },
};

const PLACE_SUFFIX = ['st', 'nd', 'rd'];

export function placeSuffix(p: number): string {
  return PLACE_SUFFIX[p - 1] ?? 'th';
}

function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}

interface HudRefs {
  hud: HTMLElement;
  lapNow: HTMLElement;
  lapTotal: HTMLElement;
  time: HTMLElement;
  place: HTMLElement;
  standings: HTMLElement;
  item: HTMLElement;
  itemIcon: HTMLElement;
  speedNum: HTMLElement;
  minimap: HTMLCanvasElement;
  notify: HTMLElement;
  countdown: HTMLElement;
  banner: HTMLElement;
}

export class Hud {
  private refs: HudRefs;
  private minimapBase: HTMLCanvasElement;
  private mapScale = 1;
  private mapOffX = 0;
  private mapOffZ = 0;
  private notifyTimers: number[] = [];
  private lastCountdown: string | null = null;

  constructor(trackSamples: { x: number; z: number }[]) {
    this.refs = {
      hud: document.getElementById('hud')!,
      lapNow: document.getElementById('lap-now')!,
      lapTotal: document.getElementById('lap-total')!,
      time: document.getElementById('hud-time')!,
      place: document.getElementById('hud-place')!,
      standings: document.getElementById('hud-standings')!,
      item: document.getElementById('hud-item')!,
      itemIcon: document.getElementById('item-icon')!,
      speedNum: document.getElementById('speed-num')!,
      minimap: document.getElementById('minimap') as HTMLCanvasElement,
      notify: document.getElementById('hud-notify')!,
      countdown: document.getElementById('hud-countdown')!,
      banner: document.getElementById('hud-banner')!,
    };
    this.laps(3);
    // pre-render the minimap path
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of trackSamples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    const pad = 14;
    const w = this.refs.minimap.width;
    const h = this.refs.minimap.height;
    this.mapScale = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
    this.mapOffX = (w - (maxX - minX) * this.mapScale) / 2 - minX * this.mapScale;
    this.mapOffZ = (h - (maxZ - minZ) * this.mapScale) / 2 - minZ * this.mapScale;
    this.minimapBase = document.createElement('canvas');
    this.minimapBase.width = w;
    this.minimapBase.height = h;
    const g = this.minimapBase.getContext('2d')!;
    g.fillStyle = 'rgba(46,28,12,0.66)';
    g.beginPath();
    g.roundRect(0, 0, w, h, 14);
    g.fill();
    g.strokeStyle = 'rgba(255,236,200,0.85)';
    g.lineWidth = 5;
    g.lineJoin = 'round';
    g.beginPath();
    trackSamples.forEach((s, i) => {
      const [mx, my] = this.mapXY(s.x, s.z);
      if (i === 0) g.moveTo(mx, my);
      else g.lineTo(mx, my);
    });
    g.closePath();
    g.stroke();
    // finish line tick
    const [fx, fy] = this.mapXY(trackSamples[0].x, trackSamples[0].z);
    g.fillStyle = '#fff';
    g.fillRect(fx - 3, fy - 3, 6, 6);
  }

  show(v: boolean): void {
    this.refs.hud.classList.toggle('hidden', !v);
  }

  private mapXY(x: number, z: number): [number, number] {
    return [x * this.mapScale + this.mapOffX, z * this.mapScale + this.mapOffZ];
  }

  laps(total: number): void {
    this.refs.lapTotal.textContent = String(total);
    this.lap(1);
  }

  lap(n: number): void {
    this.refs.lapNow.textContent = String(Math.min(n, Number(this.refs.lapTotal.textContent)));
  }

  time(ms: number): void {
    this.refs.time.textContent = fmtTime(Math.max(0, ms));
  }

  place(p: number, of: number): void {
    this.refs.place.innerHTML = `${p}<sup>${placeSuffix(p)}</sup><span class="dim" style="font-size:1.1rem">/${of}</span>`;
  }

  speed(spd: number): void {
    this.refs.speedNum.textContent = String(Math.max(0, Math.round(spd * 3.4)));
  }

  item(kind: ItemKind | null): void {
    if (!kind) {
      this.refs.item.classList.add('hidden');
      return;
    }
    this.refs.item.classList.remove('hidden');
    this.refs.itemIcon.textContent = ITEM_META[kind].icon;
  }

  standings(batch: StateBatch, meId: string, players: Map<string, { name: string; character: number }>): void {
    const rows: string[] = [];
    batch.order.forEach((id, i) => {
      const st = batch.p.find((s) => s.id === id);
      const info = players.get(id);
      const me = id === meId;
      const color = info ? CHARACTERS[info.character]?.color ?? 0x888888 : 0x888888;
      const sw = `#${color.toString(16).padStart(6, '0')}`;
      rows.push(
        `<div class="stand-row${me ? ' me' : ''}"><span class="pos">${i + 1}</span><span class="sw" style="background:${sw}"></span><span class="nm">${escapeHtml(info?.name ?? '?')}</span><span class="dim">L${Math.min((st?.lap ?? 0) + 1, 3)}</span></div>`
      );
    });
    this.refs.standings.innerHTML = rows.join('');
  }

  notify(text: string, gold = false, ms = 2600): void {
    const el = document.createElement('div');
    el.className = 'notify' + (gold ? ' gold' : '');
    el.textContent = text;
    this.refs.notify.appendChild(el);
    const t = window.setTimeout(() => el.remove(), ms);
    this.notifyTimers.push(t);
    while (this.refs.notify.children.length > 3) this.refs.notify.firstChild?.remove();
  }

  banner(text: string | null, ms = 2200): void {
    if (text === null) {
      this.refs.banner.classList.add('hidden');
      return;
    }
    this.refs.banner.textContent = text;
    this.refs.banner.classList.remove('hidden');
    window.setTimeout(() => this.refs.banner.classList.add('hidden'), ms);
  }

  countdown(display: string | null): void {
    if (display === this.lastCountdown) return;
    this.lastCountdown = display;
    if (!display) {
      this.refs.countdown.classList.add('hidden');
      return;
    }
    this.refs.countdown.classList.remove('hidden');
    this.refs.countdown.classList.toggle('go', display === 'GO!');
    this.refs.countdown.textContent = display;
  }

  minimapDot(x: number, z: number, color: string, me: boolean, heading?: number): void {
    const g = this.refs.minimap.getContext('2d')!;
    const [mx, my] = this.mapXY(x, z);
    g.beginPath();
    g.arc(mx, my, me ? 4.5 : 3.5, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    if (me) {
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.stroke();
      if (heading !== undefined) {
        g.beginPath();
        g.moveTo(mx, my);
        g.lineTo(mx + Math.sin(heading) * 9, my + Math.cos(heading) * 9);
        g.stroke();
      }
    }
  }

  beginMap(): void {
    const g = this.refs.minimap.getContext('2d')!;
    g.clearRect(0, 0, this.refs.minimap.width, this.refs.minimap.height);
    g.drawImage(this.minimapBase, 0, 0);
  }

  results(rows: ResultRow[], meId: string): void {
    const el = document.getElementById('results-rows')!;
    el.innerHTML = rows
      .map((r) => {
        const medal = r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : `${r.place}`;
        const color = `#${CHARACTERS[r.character]?.color?.toString(16).padStart(6, '0')}`;
        return `<div class="result-row${r.id === meId ? ' me' : ''}${r.timeMs === null ? ' dnf' : ''}">
          <span class="place">${medal}</span>
          <span class="dot" style="background:${color}"></span>
          <span class="nm">${escapeHtml(r.name)}</span>
          <span class="tm">${r.timeMs === null ? 'DNF' : fmtTime(r.timeMs)}</span>
        </div>`;
      })
      .join('');
  }

  dispose(): void {
    for (const t of this.notifyTimers) clearTimeout(t);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
