import './style.css';
import { Net } from './net';
import { loadSession, loadStr, saveSession, saveStr, clearSession } from './storage';
import {
  CHARACTERS,
  CHARACTER_COUNT,
  type JoinAck,
  type RoomView,
} from '../shared/protocol';
import { AudioEngine } from './game/audio';
import { GameSession } from './game/race';

const net = new Net();
const audio = new AudioEngine();

const el = {
  app: document.getElementById('app')!,
  menu: document.getElementById('screen-menu')!,
  lobby: document.getElementById('screen-lobby')!,
  game: document.getElementById('screen-game')!,
  name: document.getElementById('name-input') as HTMLInputElement,
  code: document.getElementById('code-input') as HTMLInputElement,
  create: document.getElementById('btn-create') as HTMLButtonElement,
  join: document.getElementById('btn-join') as HTMLButtonElement,
  menuError: document.getElementById('menu-error')!,
  charPicker: document.getElementById('char-picker')!,
  charPickerLobby: document.getElementById('char-picker-lobby')!,
  leave: document.getElementById('btn-leave') as HTMLButtonElement,
  copy: document.getElementById('btn-copy') as HTMLButtonElement,
  roomCode: document.getElementById('room-code')!,
  lobbyPlayers: document.getElementById('lobby-players')!,
  start: document.getElementById('btn-start') as HTMLButtonElement,
  lobbyNote: document.getElementById('lobby-note')!,
  hud: document.getElementById('hud')!,
  results: document.getElementById('screen-results')!,
  resultsRows: document.getElementById('results-rows')!,
  rematch: document.getElementById('btn-rematch') as HTMLButtonElement,
  toLobby: document.getElementById('btn-to-lobby') as HTMLButtonElement,
  resultsNote: document.getElementById('results-note')!,
  waiting: document.getElementById('screen-waiting')!,
  waitingList: document.getElementById('waiting-list')!,
  conn: document.getElementById('screen-conn')!,
  connTitle: document.getElementById('conn-title')!,
  connText: document.getElementById('conn-text')!,
  connRetry: document.getElementById('btn-conn-retry') as HTMLButtonElement,
  connMenu: document.getElementById('btn-conn-menu') as HTMLButtonElement,
};

// ---------- local state ----------

let meId = '';
let room: RoomView | null = null;
let session: GameSession | null = null;
let clockOffset = 0;
let connecting = false;
let inRoom = false;

const myName = () => loadStr('name') || '';
const myChar = () => Number(loadStr('char') ?? '0') || 0;

// ---------- helpers ----------

function show(screen: 'menu' | 'lobby' | 'game'): void {
  el.menu.classList.toggle('hidden', screen !== 'menu');
  el.lobby.classList.toggle('hidden', screen !== 'lobby');
  el.game.classList.toggle('hidden', screen !== 'game');
}

function setErr(msg: string): void {
  el.menuError.textContent = msg;
  el.menuError.classList.toggle('hidden', !msg);
}

function shareLink(code: string): string {
  const base = new URL(import.meta.env.BASE_URL, location.origin);
  base.searchParams.set('room', code);
  return base.toString();
}

function buildCharPicker(container: HTMLElement, selected: number, onPick: (c: number) => void): void {
  container.innerHTML = '';
  for (let i = 0; i < CHARACTER_COUNT; i++) {
    const sw = document.createElement('button');
    sw.className = 'char-swatch' + (i === selected ? ' sel' : '');
    sw.style.background = `#${CHARACTERS[i].color.toString(16).padStart(6, '0')}`;
    sw.title = CHARACTERS[i].name;
    sw.textContent = CHARACTERS[i].name[0];
    sw.setAttribute('role', 'option');
    sw.addEventListener('click', () => {
      container.querySelectorAll('.char-swatch').forEach((n) => n.classList.remove('sel'));
      sw.classList.add('sel');
      onPick(i);
    });
    container.appendChild(sw);
  }
}

function renderLobby(view: RoomView): void {
  el.roomCode.textContent = view.code;
  const seats = el.lobbyPlayers;
  seats.innerHTML = '';
  const max = Math.max(8, view.players.length);
  for (let i = 0; i < max; i++) {
    const p = view.players[i];
    const seat = document.createElement('div');
    seat.className = 'lobby-seat' + (p ? ' filled' : '');
    if (p) {
      const color = `#${CHARACTERS[p.character]?.color?.toString(16).padStart(6, '0')}`;
      const tags = [
        p.isHost ? '<span class="tag host">Host</span>' : '',
        p.waiting ? '<span class="tag waiting">Next race</span>' : '',
        !p.connected ? '<span class="tag off">Reconnecting…</span>' : '',
      ].join('');
      seat.innerHTML = `<span class="dot" style="background:${color}"></span><span class="who">${escapeHtml(p.name)}</span>${tags}`;
    } else {
      seat.innerHTML = `<span class="dot" style="background:#e8dcc4"></span><span class="who dim">Open seat</span>`;
    }
    seats.appendChild(seat);
  }
  const amHost = view.hostId === view.youId;
  el.start.classList.toggle('hidden', !amHost);
  el.lobbyNote.classList.toggle('hidden', amHost);
  const connected = view.players.filter((p) => p.connected);
  if (amHost) {
    el.start.disabled = connected.length < 2;
    el.start.textContent =
      view.phase === 'results' || view.phase === 'racing' || view.phase === 'countdown'
        ? 'Start next race 🏁'
        : connected.length < 2
          ? 'Need at least 2 racers'
          : 'Start race 🏁';
    if (view.phase === 'racing' || view.phase === 'countdown') {
      el.lobbyNote.textContent = '';
    }
  } else {
    el.lobbyNote.textContent =
      view.phase === 'racing' || view.phase === 'countdown'
        ? 'Race in progress — you’ll race next round.'
        : 'Waiting for the host to start…';
  }
  // waiting overlay for mid-race joiners
  const meWaiting = view.players.find((p) => p.id === view.youId)?.waiting;
  if (meWaiting && (view.phase === 'racing' || view.phase === 'countdown')) {
    el.waiting.classList.remove('hidden');
    el.waitingList.innerHTML = view.players
      .filter((p) => !p.waiting)
      .map(
        (p) =>
          `<div class="wait-row"><span class="dot" style="background:#${CHARACTERS[p.character]?.color
            .toString(16)
            .padStart(6, '0')}"></span>${escapeHtml(p.name)}</div>`
      )
      .join('');
  } else {
    el.waiting.classList.add('hidden');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function enterRaceSession(view: RoomView): void {
  show('game');
  audio.unlock();
  session?.dispose();
  session = new GameSession({
    canvas: document.getElementById('gl') as HTMLCanvasElement,
    net,
    meId: view.youId,
    players: new Map(view.players.map((p) => [p.id, { name: p.name, character: p.character }])),
    roomCode: view.code,
    audio,
    clockOffset,
    onResults: () => {
      /* results are shown via room view / results event */
    },
    onLeftRace: () => {
      /* handled via conn overlay */
    },
  });
}

function leaveRoom(localOnly = false): void {
  if (!localOnly) net.leave();
  clearSession('token');
  clearSession('code');
  inRoom = false;
  room = null;
  session?.dispose();
  session = null;
  el.hud.classList.add('hidden');
  el.results.classList.add('hidden');
  el.waiting.classList.add('hidden');
  show('menu');
}

// ---------- connection handling ----------

net.onConn = (state, detail) => {
  if (state === 'reconnecting' && inRoom) {
    el.conn.classList.remove('hidden');
    el.connTitle.textContent = 'Reconnecting…';
    el.connText.innerHTML = '<span class="spin"></span>Holding your seat…';
    el.connRetry.classList.add('hidden');
  } else if (state === 'down') {
    if (inRoom) {
      el.conn.classList.remove('hidden');
      el.connTitle.textContent = 'Connection lost';
      el.connText.textContent =
        detail ||
        'The game server restarted, so this room was reset. You can start a fresh room from the menu.';
      el.connRetry.classList.remove('hidden');
    } else if (detail) {
      setErr(detail);
    }
  } else if (state === 'online') {
    if (inRoom && !el.conn.classList.contains('hidden')) {
      el.connTitle.textContent = 'Back online';
      el.connText.textContent = 'Restoring your session…';
    }
  }
};

net.onEvent = (e: { ev: string; payload: any }) => {
  if (e.ev === 'race:start') {
    el.results.classList.add('hidden');
    el.waiting.classList.add('hidden');
    if (!session && room) enterRaceSession(room);
    session?.startRace(e.payload);
    return;
  }
  if (e.ev === 'shutdown') {
    el.conn.classList.remove('hidden');
    el.connTitle.textContent = 'Server restarting';
    el.connText.textContent = (e.payload?.reason ?? 'The game server is restarting.') +
      ' Rooms were reset — start or join a new room from the menu.';
    el.connRetry.classList.remove('hidden');
    return;
  }
  if (e.ev === 'reconnected') {
    // socket is back; rejoin by token
    const token = loadSession('token');
    const code = loadSession('code');
    if (token && code) {
      void rejoinWithToken(token, code);
    }
    return;
  }
  if (session) session.onEvent(e);
  if (e.ev === 'results') {
    el.results.classList.remove('hidden');
    const amHost = room?.hostId === meId;
    el.rematch.classList.toggle('hidden', !amHost);
    el.toLobby.classList.toggle('hidden', !amHost);
    el.resultsNote.textContent = amHost ? '' : 'Waiting for the host…';
  }
};

net.onRoom = (view: RoomView) => {
  room = view;
  meId = view.youId;
  if (!inRoom) return;
  if (view.phase === 'lobby' || (view.phase === 'results' && !session)) {
    if (view.phase === 'lobby') {
      show('lobby');
      el.results.classList.add('hidden');
      renderLobby(view);
    }
    return;
  }
  if (view.phase === 'results') {
    renderLobbySeatsIfVisible(view);
    if (session) session.handleRoom(view);
    return;
  }
  // countdown / racing: make sure a session exists
  if (!session) enterRaceSession(view);
  session!.handleRoom(view);
  renderLobbySeatsIfVisible(view);
};

function renderLobbySeatsIfVisible(view: RoomView): void {
  if (!el.lobby.classList.contains('hidden')) renderLobby(view);
}

net.onStateBatch = (b) => session?.onStateBatch(b);

net.onSnapshot = (snap) => {
  if (session) session.applySnapshot(snap);
};

async function rejoinWithToken(token: string, code: string): Promise<void> {
  const ack: JoinAck = await net.join({
    name: myName(),
    character: myChar(),
    code,
    token,
  });
  if (ack.ok && ack.room) {
    clockOffset = (ack.room.serverNow ?? Date.now()) - Date.now();
    inRoom = true;
    room = ack.room;
    meId = ack.room.youId;
    saveSession('token', ack.token!);
    saveSession('code', ack.room.code);
    el.conn.classList.add('hidden');
    if (ack.room.phase === 'lobby' || ack.room.phase === 'results') {
      session?.dispose();
      session = null;
      show('lobby');
      renderLobby(ack.room);
      if (ack.room.phase === 'results' && ack.room.results) {
        el.results.classList.remove('hidden');
      }
    } else {
      enterRaceSession(ack.room);
      session!.handleRoom(ack.room);
    }
  } else {
    clearSession('token');
    clearSession('code');
    inRoom = false;
    el.conn.classList.add('hidden');
    if (ack.error) setErr(ack.error);
    show('menu');
  }
}

// ---------- wire up UI ----------

buildCharPicker(el.charPicker, myChar(), (c) => {
  saveStr('char', String(c));
  buildCharPicker(el.charPickerLobby, c, (c2) => {
    saveStr('char', String(c2));
    net.setCharacter({ character: c2 });
  });
});
buildCharPicker(el.charPickerLobby, myChar(), (c) => {
  saveStr('char', String(c));
  net.setCharacter({ character: c });
});
el.name.value = myName();
el.name.addEventListener('input', () => saveStr('name', el.name.value.trim()));

document.getElementById('btn-create')!.addEventListener('click', async () => {
  audio.unlock();
  if (connecting) return;
  setErr('');
  connecting = true;
  net.connect();
  const ack = await net.create({ name: myName(), character: myChar() });
  connecting = false;
  handleJoinAck(ack);
});

document.getElementById('btn-join')!.addEventListener('click', async () => {
  audio.unlock();
  if (connecting) return;
  setErr('');
  const code = el.code.value.trim().toUpperCase();
  if (code.length < 3) {
    setErr('Enter the 4-character room code.');
    return;
  }
  connecting = true;
  net.connect();
  const ack = await net.join({ name: myName(), character: myChar(), code });
  connecting = false;
  handleJoinAck(ack);
});

el.code.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (document.getElementById('btn-join') as HTMLButtonElement).click();
});
el.name.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (document.getElementById('btn-create') as HTMLButtonElement).click();
});

function handleJoinAck(ack: JoinAck): void {
  if (!ack.ok || !ack.room) {
    setErr(ack.error ?? 'Could not reach the game server.');
    return;
  }
  clockOffset = (ack.room.serverNow ?? Date.now()) - Date.now();
  inRoom = true;
  room = ack.room;
  meId = ack.room.youId;
  saveSession('token', ack.token!);
  saveSession('code', ack.room.code);
  el.conn.classList.add('hidden');
  show('lobby');
  renderLobby(ack.room);
}

el.leave.addEventListener('click', () => leaveRoom());

el.copy.addEventListener('click', async () => {
  if (!room) return;
  const link = shareLink(room.code);
  try {
    await navigator.clipboard.writeText(link);
    el.copy.textContent = 'Link copied! ✓';
  } catch {
    window.prompt('Copy this invite link:', link);
  }
  window.setTimeout(() => (el.copy.textContent = 'Copy invite link'), 1800);
});

el.start.addEventListener('click', async () => {
  if (!room) return;
  audio.unlock();
  const ack = room.phase === 'results' ? await net.rematch() : await net.start();
  if (!ack.ok && ack.error) el.lobbyNote.textContent = ack.error;
});

el.rematch.addEventListener('click', async () => {
  const ack = await net.rematch();
  if (!ack.ok) el.resultsNote.textContent = ack.error ?? 'Could not start the rematch.';
});

el.toLobby.addEventListener('click', async () => {
  const ack = await net.backToLobby();
  if (ack.ok) {
    el.results.classList.add('hidden');
    session?.dispose();
    session = null;
    el.hud.classList.add('hidden');
  }
});

el.connMenu.addEventListener('click', () => {
  el.conn.classList.add('hidden');
  leaveRoom(true);
  net.disconnect();
});

el.connRetry.addEventListener('click', () => {
  el.conn.classList.add('hidden');
  leaveRoom(true);
  net.disconnect();
  setErr('');
  show('menu');
});

// keyboard focus for iframe embedding + audio unlock on any gesture
el.app.addEventListener('pointerdown', () => {
  el.app.focus();
  audio.unlock();
});
window.addEventListener('keydown', () => audio.unlock(), { once: true });

// ---------- boot ----------

function boot(): void {
  const params = new URLSearchParams(location.search);
  const roomParam = params.get('room');
  if (roomParam) {
    el.code.value = roomParam.toUpperCase();
    el.code.focus();
  }
  const token = loadSession('token');
  const code = loadSession('code');
  if (token && (code || roomParam)) {
    // auto-rejoin an ongoing session after a page reload
    net.connect();
    void rejoinWithToken(token, roomParam ? roomParam.toUpperCase() : (code as string));
    return;
  }
  show('menu');
}

boot();
