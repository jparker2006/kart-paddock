import { GAME_NAME, ITEM_INFO, MAX_PLAYERS, MIN_PLAYERS, TOTAL_LAPS } from '../shared/constants.ts';
import type { PlayerPublic, RaceResultEntry, RoomState } from '../shared/protocol.ts';
import { escapeHtml, formatTime, ordinal } from './game/Hud.ts';

export interface UICallbacks {
  onCreate(name: string): void;
  onJoin(name: string, code: string): void;
  onStart(): void;
  onRematch(): void;
  onLobby(): void;
  onLeave(): void;
  onDismissNotice(): void;
}

type Screen = 'none' | 'home' | 'lobby' | 'results';

const CONTROLS_HTML = `
  <ul class="controls">
    <li><kbd>W</kbd> / <kbd>↑</kbd><span>Accelerate</span></li>
    <li><kbd>S</kbd> / <kbd>↓</kbd><span>Brake / reverse</span></li>
    <li><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd><span>Steer</span></li>
    <li><kbd>Shift</kbd> or <kbd>Space</kbd><span>Hold while turning to drift, release for a boost</span></li>
    <li><kbd>E</kbd> / <kbd>Enter</kbd><span>Use item</span></li>
    <li><kbd>R</kbd><span>Respawn at the last checkpoint</span></li>
    <li><kbd>M</kbd><span>Mute</span></li>
  </ul>`;

const ITEMS_HTML = `
  <ul class="items">
    ${Object.values(ITEM_INFO)
      .map((i) => `<li><span class="emoji">${i.emoji}</span><b>${i.label}</b><span>${i.hint}</span></li>`)
      .join('')}
  </ul>`;

export class UI {
  private root: HTMLElement;
  private screens: Record<Exclude<Screen, 'none'>, HTMLElement>;
  private banner: HTMLElement;
  private toastEl: HTMLElement;
  private notice: HTMLElement;
  private waiting: HTMLElement;
  private finishedPill: HTMLElement;
  private current: Screen = 'none';
  private toastTimer: number | null = null;
  private busy = false;

  constructor(
    parent: HTMLElement,
    private cb: UICallbacks,
  ) {
    this.root = parent;
    this.root.innerHTML = `
      <div id="banner" class="banner" hidden></div>
      <div id="toast" class="toast" hidden></div>
      <div id="finished-pill" class="finished-pill" hidden></div>

      <section id="screen-home" class="screen" hidden>
        <div class="panel home">
          <h1 class="logo"><span>🐝</span> ${GAME_NAME}</h1>
          <p class="tagline">Online 3D kart racing for ${MIN_PLAYERS}–${MAX_PLAYERS} friends. ${TOTAL_LAPS} laps around the Garden Loop.</p>
          <div class="conn" id="conn-status">Connecting…</div>
          <label class="field">
            <span>Your name</span>
            <input id="name-input" maxlength="16" placeholder="e.g. Buzz" autocomplete="off" />
          </label>
          <div class="row">
            <button id="create-btn" class="primary">Create a room</button>
          </div>
          <div class="divider"><span>or join a friend</span></div>
          <div class="row join">
            <input id="code-input" maxlength="5" placeholder="ROOM CODE" autocomplete="off" spellcheck="false" />
            <button id="join-btn">Join</button>
          </div>
          <div id="home-error" class="error" hidden></div>
          <details class="help">
            <summary>Controls &amp; items</summary>
            ${CONTROLS_HTML}
            ${ITEMS_HTML}
          </details>
        </div>
      </section>

      <section id="screen-lobby" class="screen" hidden>
        <div class="panel lobby">
          <div class="lobby-head">
            <div>
              <div class="label">Room code</div>
              <div class="code" id="lobby-code">-----</div>
            </div>
            <div class="share">
              <div class="label">Invite link</div>
              <div class="share-row"><input id="share-link" readonly /><button id="copy-btn">Copy</button></div>
            </div>
          </div>
          <div class="label" id="lobby-count">Racers</div>
          <ul class="players" id="lobby-players"></ul>
          <div id="lobby-hint" class="hint"></div>
          <div class="row actions">
            <button id="start-btn" class="primary">Start race</button>
            <button id="leave-btn" class="ghost">Leave room</button>
          </div>
          <details class="help">
            <summary>Controls &amp; items</summary>
            ${CONTROLS_HTML}
            ${ITEMS_HTML}
          </details>
        </div>
      </section>

      <section id="screen-results" class="screen" hidden>
        <div class="panel results">
          <h2 id="results-title">Race results</h2>
          <ol class="results-list" id="results-list"></ol>
          <div id="results-hint" class="hint"></div>
          <div class="row actions">
            <button id="rematch-btn" class="primary">Rematch</button>
            <button id="lobby-btn">Back to lobby</button>
            <button id="results-leave-btn" class="ghost">Leave room</button>
          </div>
        </div>
      </section>

      <div id="waiting" class="waiting" hidden>
        <div class="panel small">
          <h2>Race in progress</h2>
          <p>You joined while a race was running - you will line up for the next one. Meanwhile, enjoy the view.</p>
          <ol class="results-list compact" id="waiting-standings"></ol>
          <button id="waiting-leave-btn" class="ghost">Leave room</button>
        </div>
      </div>

      <div id="notice" class="notice" hidden>
        <div class="panel small">
          <h2 id="notice-title"></h2>
          <p id="notice-text"></p>
          <button id="notice-btn" class="primary">OK</button>
        </div>
      </div>`;

    const q = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    this.screens = { home: q('screen-home'), lobby: q('screen-lobby'), results: q('screen-results') };
    this.banner = q('banner');
    this.toastEl = q('toast');
    this.notice = q('notice');
    this.waiting = q('waiting');
    this.finishedPill = q('finished-pill');

    const nameInput = q<HTMLInputElement>('name-input');
    const codeInput = q<HTMLInputElement>('code-input');
    nameInput.addEventListener('focus', () => setTimeout(() => nameInput.select(), 0));
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    });
    q('create-btn').addEventListener('click', () => this.cb.onCreate(nameInput.value));
    q('join-btn').addEventListener('click', () => this.cb.onJoin(nameInput.value, codeInput.value));
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.cb.onJoin(nameInput.value, codeInput.value);
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (codeInput.value.length === 5) this.cb.onJoin(nameInput.value, codeInput.value);
        else this.cb.onCreate(nameInput.value);
      }
    });
    q('start-btn').addEventListener('click', () => this.cb.onStart());
    q('leave-btn').addEventListener('click', () => this.cb.onLeave());
    q('results-leave-btn').addEventListener('click', () => this.cb.onLeave());
    q('waiting-leave-btn').addEventListener('click', () => this.cb.onLeave());
    q('rematch-btn').addEventListener('click', () => this.cb.onRematch());
    q('lobby-btn').addEventListener('click', () => this.cb.onLobby());
    q('notice-btn').addEventListener('click', () => {
      this.notice.hidden = true;
      this.cb.onDismissNotice();
    });
    q('copy-btn').addEventListener('click', () => void this.copyShareLink());
    q<HTMLInputElement>('share-link').addEventListener('focus', (e) => (e.target as HTMLInputElement).select());
  }

  // ---------------------------------------------------------------- screens

  show(screen: Screen): void {
    if (this.current === screen) return;
    this.current = screen;
    for (const [name, el] of Object.entries(this.screens)) el.hidden = name !== screen;
    if (screen === 'home') {
      this.finishedPill.hidden = true;
      setTimeout(() => (document.getElementById('name-input') as HTMLInputElement | null)?.focus(), 50);
    }
  }

  get screen(): Screen {
    return this.current;
  }

  setName(name: string): void {
    (document.getElementById('name-input') as HTMLInputElement).value = name;
  }

  getName(): string {
    return (document.getElementById('name-input') as HTMLInputElement).value;
  }

  setCode(code: string): void {
    (document.getElementById('code-input') as HTMLInputElement).value = code;
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    for (const id of ['create-btn', 'join-btn', 'start-btn', 'rematch-btn']) {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (el) el.disabled = busy || el.dataset.locked === '1';
    }
  }

  setConnectionStatus(text: string, state: 'ok' | 'warn' | 'bad'): void {
    const el = document.getElementById('conn-status')!;
    el.textContent = text;
    el.className = `conn ${state}`;
    const canAct = state === 'ok' && !this.busy;
    (document.getElementById('create-btn') as HTMLButtonElement).disabled = !canAct;
    (document.getElementById('join-btn') as HTMLButtonElement).disabled = !canAct;
  }

  showHomeError(msg: string): void {
    const el = document.getElementById('home-error')!;
    el.textContent = msg;
    el.hidden = !msg;
  }

  // ----------------------------------------------------------------- banner

  setBanner(text: string, kind: 'warn' | 'bad' | 'ok' | 'none'): void {
    if (kind === 'none' || !text) {
      this.banner.hidden = true;
      return;
    }
    this.banner.hidden = false;
    this.banner.textContent = text;
    this.banner.className = `banner ${kind}`;
  }

  toast(text: string, ms = 2500): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), ms);
  }

  showNotice(title: string, text: string): void {
    document.getElementById('notice-title')!.textContent = title;
    document.getElementById('notice-text')!.textContent = text;
    this.notice.hidden = false;
  }

  showFinished(place: number, text: string): void {
    this.finishedPill.hidden = false;
    this.finishedPill.innerHTML = `<b>${place}${ordinal(place)}</b> ${escapeHtml(text)}`;
  }

  hideFinished(): void {
    this.finishedPill.hidden = true;
  }

  // ------------------------------------------------------------------ lobby

  renderLobby(state: RoomState, localId: string, shareLink: string): void {
    const isHost = state.hostId === localId;
    document.getElementById('lobby-code')!.textContent = state.code;
    (document.getElementById('share-link') as HTMLInputElement).value = shareLink;
    const connected = state.players.filter((p) => p.connected);
    document.getElementById('lobby-count')!.textContent = `Racers (${connected.length}/${state.maxPlayers})`;
    document.getElementById('lobby-players')!.innerHTML = state.players.map((p) => playerRow(p, localId, state.hostId)).join('');
    const hint = document.getElementById('lobby-hint')!;
    const start = document.getElementById('start-btn') as HTMLButtonElement;
    start.hidden = !isHost;
    if (isHost) {
      const enough = connected.length >= MIN_PLAYERS;
      start.dataset.locked = enough ? '0' : '1';
      start.disabled = !enough || this.busy;
      hint.textContent = enough
        ? `You are the host. Everyone is here? Hit Start race!`
        : `You are the host. Need at least ${MIN_PLAYERS} connected racers to start (${connected.length} here). Share the code or link!`;
    } else {
      const host = state.players.find((p) => p.id === state.hostId);
      hint.textContent = `Waiting for ${host ? escapeHtml(host.name) : 'the host'} to start the race…`;
    }
  }

  renderWaiting(state: RoomState, localId: string, show: boolean): void {
    this.waiting.hidden = !show;
    if (!show) return;
    const racers = state.players.filter((p) => p.status === 'racing' || p.status === 'finished' || p.status === 'dnf');
    racers.sort((a, b) => (a.place || 99) - (b.place || 99));
    document.getElementById('waiting-standings')!.innerHTML = racers
      .map(
        (p) => `<li><span class="pos">${p.place || '–'}</span><span class="swatch" style="background:${p.color}"></span>
          <span class="name">${escapeHtml(p.name)}${p.id === localId ? ' (you)' : ''}</span>
          <span class="time">${p.finishTimeMs !== null ? formatTime(p.finishTimeMs) : `Lap ${p.lap}/${state.totalLaps}`}</span></li>`,
      )
      .join('');
  }

  // ---------------------------------------------------------------- results

  renderResults(state: RoomState, localId: string): void {
    const results: RaceResultEntry[] = state.results ?? [];
    const isHost = state.hostId === localId;
    const me = results.find((r) => r.playerId === localId);
    const title = document.getElementById('results-title')!;
    if (me) {
      title.textContent =
        me.finishTimeMs !== null
          ? me.place === 1
            ? '🏆 You won!'
            : `You finished ${me.place}${ordinal(me.place)}`
          : 'Race over - you did not finish';
    } else title.textContent = 'Race results';
    document.getElementById('results-list')!.innerHTML = results
      .map(
        (r) => `<li class="${r.playerId === localId ? 'me' : ''}">
          <span class="pos">${r.place}</span>
          <span class="swatch" style="background:${r.color}"></span>
          <span class="name">${escapeHtml(r.name)}</span>
          <span class="time">${r.finishTimeMs !== null ? formatTime(r.finishTimeMs) : `DNF · ${r.lapsDone}/${state.totalLaps} laps`}</span>
        </li>`,
      )
      .join('');
    const rematch = document.getElementById('rematch-btn') as HTMLButtonElement;
    const lobby = document.getElementById('lobby-btn') as HTMLButtonElement;
    rematch.hidden = !isHost;
    lobby.hidden = !isHost;
    const connected = state.players.filter((p) => p.connected).length;
    const hint = document.getElementById('results-hint')!;
    if (isHost) {
      const enough = connected >= MIN_PLAYERS;
      rematch.dataset.locked = enough ? '0' : '1';
      rematch.disabled = !enough || this.busy;
      const waitingCount = state.players.filter((p) => p.status === 'waiting').length;
      hint.textContent =
        (enough ? 'Rematch starts a new race right away with everyone in the room.' : `Need ${MIN_PLAYERS} connected racers for a rematch.`) +
        (waitingCount ? ` ${waitingCount} new racer${waitingCount > 1 ? 's' : ''} joined and will be on the grid.` : '');
    } else {
      const host = state.players.find((p) => p.id === state.hostId);
      hint.textContent = `Waiting for ${host ? escapeHtml(host.name) : 'the host'} to start a rematch or return to the lobby…`;
    }
  }

  private async copyShareLink(): Promise<void> {
    const input = document.getElementById('share-link') as HTMLInputElement;
    try {
      await navigator.clipboard.writeText(input.value);
      this.toast('Invite link copied!');
    } catch {
      input.select();
      this.toast('Press Ctrl/Cmd+C to copy the link');
    }
  }
}

function playerRow(p: PlayerPublic, localId: string, hostId: string): string {
  const tags: string[] = [];
  if (p.id === hostId) tags.push('<span class="tag host">host</span>');
  if (p.id === localId) tags.push('<span class="tag you">you</span>');
  if (!p.connected) tags.push('<span class="tag off">reconnecting…</span>');
  if (p.status === 'waiting') tags.push('<span class="tag">next race</span>');
  if (p.wins > 0) tags.push(`<span class="tag wins">🏆 ${p.wins}</span>`);
  return `<li class="${p.connected ? '' : 'offline'}"><span class="swatch" style="background:${p.color}"></span><span class="name">${escapeHtml(p.name)}</span>${tags.join('')}</li>`;
}
