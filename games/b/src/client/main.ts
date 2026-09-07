import './style.css';
import { Game } from './game/Game.ts';
import { Net, type ConnectionStatus } from './net.ts';
import { UI } from './ui.ts';
import { local, session } from './storage.ts';
import { normaliseRoomCode, sanitisePlayerName, type JoinAck, type RoomState, type Snapshot } from '../shared/protocol.ts';
import { GAME_NAME } from '../shared/constants.ts';

const SESSION_KEY = 'session-token';

class App {
  private ui: UI;
  private net: Net;
  private game: Game;
  private room: RoomState | null = null;
  private localId = '';
  private raceNumberInGame = -1;
  private pendingResume = false;
  private staleTimer: number;

  constructor() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const uiRoot = document.getElementById('ui') as HTMLElement;
    const hudRoot = document.createElement('div');
    hudRoot.id = 'hud-root';
    document.getElementById('app')!.insertBefore(hudRoot, uiRoot);

    this.ui = new UI(uiRoot, {
      onCreate: (name) => void this.create(name),
      onJoin: (name, code) => void this.join(name, code),
      onStart: () => void this.start(),
      onRematch: () => void this.rematch(),
      onLobby: () => this.net.backToLobby(),
      onLeave: () => this.leave(),
      onDismissNotice: () => {
        if (!this.room) this.ui.show('home');
      },
    });

    this.net = new Net({
      onStatus: (s, d) => this.onStatus(s, d),
      onRoomState: (s) => this.onRoomState(s),
      onSnapshot: (s) => this.onSnapshot(s),
      onEvent: (e) => this.game.applyEvent(e),
      onKicked: (reason) => {
        this.clearSeat();
        this.ui.showNotice('Disconnected from the room', reason);
      },
      onConnected: () => void this.onConnected(),
    });

    this.game = new Game(canvas, hudRoot, {
      sendKart: (m) => this.net.sendKart(m),
      requestRespawn: () => this.net.respawn(),
      useItem: () => this.net.useItem(),
      serverNow: () => this.net.serverNow(),
      onLocalFinished: (place) => this.ui.showFinished(place, 'Waiting for the other racers…'),
    });

    this.game.hud.onLeave = () => {
      if (window.confirm('Leave this room? Your kart will be removed from the race.')) this.leave();
    };

    // prefill
    const params = new URL(window.location.href).searchParams;
    const codeFromUrl = normaliseRoomCode(params.get('room') ?? '');
    if (codeFromUrl) this.ui.setCode(codeFromUrl);
    this.ui.setName(local.get('name') ?? '');
    this.ui.show('home');
    document.title = GAME_NAME;

    this.net.connect();
    this.staleTimer = window.setInterval(() => this.checkStale(), 500);
    void this.staleTimer;

    if (import.meta.env.DEV) {
      // Debug handle for local development only (stripped from production builds).
      (window as unknown as { __bumble: unknown }).__bumble = {
        game: this.game,
        net: this.net,
        room: () => this.room,
      };
    }
  }

  // ------------------------------------------------------------ connection

  private onStatus(status: ConnectionStatus, detail: string): void {
    switch (status) {
      case 'connecting':
        this.ui.setConnectionStatus(detail, 'warn');
        break;
      case 'connected':
        this.ui.setConnectionStatus(`Connected to the game server`, 'ok');
        if (this.room) this.ui.toast('Reconnected');
        this.ui.setBanner('', 'none');
        break;
      case 'reconnecting':
        this.ui.setConnectionStatus(detail, 'warn');
        this.ui.setBanner(`⚠ ${detail} Your kart keeps its place while we reconnect.`, 'warn');
        break;
      case 'offline':
        this.ui.setConnectionStatus(detail, 'bad');
        if (this.room) this.ui.setBanner(`⚠ ${detail}`, 'bad');
        break;
    }
  }

  private async onConnected(): Promise<void> {
    const token = session.get(SESSION_KEY);
    if (!token) return;
    this.ui.setBusy(true);
    try {
      const ack = await this.net.resume(token);
      this.handleJoinAck(ack, true);
    } catch (err) {
      this.ui.toast(`Could not resume: ${(err as Error).message}`);
    } finally {
      this.ui.setBusy(false);
    }
  }

  private checkStale(): void {
    if (!this.room || (this.room.phase !== 'racing' && this.room.phase !== 'countdown')) return;
    if (this.net.connected && !this.game.hasRecentSnapshot()) {
      this.ui.setBanner('⚠ No updates from the game server for a moment - the race view may be stale…', 'warn');
    } else if (this.net.connected) {
      this.ui.setBanner('', 'none');
    }
  }

  // ------------------------------------------------------------- room flow

  private async create(rawName: string): Promise<void> {
    const name = sanitisePlayerName(rawName);
    if (!name) return this.ui.showHomeError('Please enter a name first.');
    local.set('name', name);
    this.game.audio.unlock();
    this.ui.setBusy(true);
    this.ui.showHomeError('');
    try {
      this.handleJoinAck(await this.net.createRoom(name), false);
    } catch (err) {
      this.ui.showHomeError((err as Error).message);
    } finally {
      this.ui.setBusy(false);
    }
  }

  private async join(rawName: string, rawCode: string): Promise<void> {
    const name = sanitisePlayerName(rawName);
    const code = normaliseRoomCode(rawCode);
    if (!name) return this.ui.showHomeError('Please enter a name first.');
    if (code.length !== 5) return this.ui.showHomeError('Room codes are 5 characters, like BZK7Q.');
    local.set('name', name);
    this.game.audio.unlock();
    this.ui.setBusy(true);
    this.ui.showHomeError('');
    try {
      this.handleJoinAck(await this.net.joinRoom(name, code), false);
    } catch (err) {
      this.ui.showHomeError((err as Error).message);
    } finally {
      this.ui.setBusy(false);
    }
  }

  private handleJoinAck(ack: JoinAck, resuming: boolean): void {
    if (!ack.ok) {
      if (resuming) {
        this.clearSeat();
        this.ui.show('none');
        this.ui.showNotice(
          'Your room is gone',
          ack.code === 'expired'
            ? 'The game server restarted (or the room closed), so the race and lobby were lost. Create or join a new room to keep playing.'
            : ack.message,
        );
      } else {
        this.ui.showHomeError(ack.message);
      }
      return;
    }
    session.set(SESSION_KEY, ack.token);
    this.localId = ack.playerId;
    const me = ack.room.players.find((p) => p.id === ack.playerId);
    this.game.setLocal(ack.playerId, me?.name ?? 'You', me?.color ?? '#ffb703');
    this.pendingResume = ack.resumed && (ack.room.phase === 'racing' || ack.room.phase === 'countdown') && me?.status !== 'waiting';
    if (ack.resumed && ack.item) this.game.setHeldItem(ack.item);
    // keep the room code in the URL (within the base path) so a refresh or share works
    const url = new URL(window.location.href);
    url.searchParams.set('room', ack.room.code);
    window.history.replaceState(null, '', url);
    this.onRoomState(ack.room);
    if (ack.resumed) this.ui.toast('Welcome back - you are back in your room.');
  }

  private async start(): Promise<void> {
    this.game.audio.unlock();
    this.ui.setBusy(true);
    try {
      const r = await this.net.startRace();
      if (!r.ok) this.ui.toast(r.message ?? 'Could not start the race.');
    } catch (err) {
      this.ui.toast((err as Error).message);
    } finally {
      this.ui.setBusy(false);
    }
  }

  private async rematch(): Promise<void> {
    this.game.audio.unlock();
    this.ui.setBusy(true);
    try {
      const r = await this.net.rematch();
      if (!r.ok) this.ui.toast(r.message ?? 'Could not start a rematch.');
    } catch (err) {
      this.ui.toast((err as Error).message);
    } finally {
      this.ui.setBusy(false);
    }
  }

  private leave(): void {
    this.net.leaveRoom();
    this.clearSeat();
    this.ui.show('home');
  }

  private clearSeat(): void {
    session.remove(SESSION_KEY);
    this.room = null;
    this.localId = '';
    this.raceNumberInGame = -1;
    this.pendingResume = false;
    this.game.goIdle();
    this.ui.renderWaiting({ players: [] } as unknown as RoomState, '', false);
    this.ui.hideFinished();
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', url);
  }

  // ------------------------------------------------------------- room state

  private onRoomState(state: RoomState): void {
    this.room = state;
    this.game.setPlayers(state.players);
    const me = state.players.find((p) => p.id === this.localId);
    if (!me) {
      // we are no longer part of this room
      this.clearSeat();
      this.ui.show('home');
      return;
    }
    const shareLink = this.shareLink(state.code);
    switch (state.phase) {
      case 'lobby':
        this.raceNumberInGame = -1;
        this.ui.hideFinished();
        this.ui.renderWaiting(state, this.localId, false);
        this.ui.renderLobby(state, this.localId, shareLink);
        this.ui.show('lobby');
        if (this.game.mode !== 'idle') this.game.goIdle();
        break;
      case 'countdown':
      case 'racing': {
        this.ui.show('none');
        const racing = me.status === 'racing' || me.status === 'finished' || me.status === 'dnf';
        if (racing) {
          this.ui.renderWaiting(state, this.localId, false);
          if (this.raceNumberInGame !== state.raceNumber && !this.pendingResume) {
            this.raceNumberInGame = state.raceNumber;
            this.ui.hideFinished();
            this.game.beginRace(state.raceStartAt ?? Date.now(), me.slot);
          }
        } else {
          this.raceNumberInGame = -1;
          if (this.game.mode !== 'spectate') this.game.beginSpectate();
          this.ui.renderWaiting(state, this.localId, true);
        }
        break;
      }
      case 'results':
        this.raceNumberInGame = -1;
        this.pendingResume = false;
        this.ui.hideFinished();
        this.ui.renderWaiting(state, this.localId, false);
        this.ui.renderResults(state, this.localId);
        this.ui.show('results');
        this.game.endRace();
        break;
    }
  }

  private onSnapshot(snap: Snapshot): void {
    if (this.pendingResume && this.room) {
      // first snapshot after a reconnect: rejoin the race where the server left us
      const me = this.room.players.find((p) => p.id === this.localId);
      const mine = snap.karts.find((k) => k.id === this.localId);
      this.pendingResume = false;
      this.raceNumberInGame = this.room.raceNumber;
      this.game.beginRace(this.room.raceStartAt ?? Date.now(), me?.slot ?? 0, mine);
      if (me?.status === 'finished') this.ui.showFinished(me.place, 'Waiting for the other racers…');
    }
    this.game.applySnapshot(snap);
    if (this.room && this.room.phase === 'racing') {
      const me = this.room.players.find((p) => p.id === this.localId);
      if (me?.status === 'waiting') this.ui.renderWaiting(this.room, this.localId, true);
    }
  }

  private shareLink(code: string): string {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', code);
    return url.toString();
  }
}

new App();
