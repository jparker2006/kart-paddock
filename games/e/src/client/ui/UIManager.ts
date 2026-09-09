import { KartColorId, PlayerState, RaceResultEntry, RoomState } from '../../shared/types.js';
import { KART_COLORS, TOTAL_LAPS } from '../../shared/constants.js';
import { soundSystem } from '../audio/SoundSystem.js';

export class UIManager {
  public selectedColor: KartColorId = 'cyan';
  public playerName: string = 'Racer';

  // DOM Elements
  private menuOverlay = document.getElementById('menu-overlay')!;
  private setupView = document.getElementById('setup-view')!;
  private lobbyView = document.getElementById('lobby-view')!;
  private gameHud = document.getElementById('game-hud')!;
  private resultsOverlay = document.getElementById('results-overlay')!;
  private connectionBanner = document.getElementById('connection-banner')!;
  private connectionText = document.getElementById('connection-text')!;
  private errorModal = document.getElementById('error-modal')!;
  private errorTitle = document.getElementById('error-title')!;
  private errorMessage = document.getElementById('error-message')!;
  private btnErrorDismiss = document.getElementById('btn-error-dismiss')!;

  private playerNameInput = document.getElementById('player-name-input') as HTMLInputElement;
  private roomCodeInput = document.getElementById('room-code-input') as HTMLInputElement;
  private colorPickerContainer = document.getElementById('color-picker')!;
  private btnCreateRoom = document.getElementById('btn-create-room')!;
  private btnJoinRoom = document.getElementById('btn-join-room')!;
  private displayRoomCode = document.getElementById('display-room-code')!;
  private btnCopyLink = document.getElementById('btn-copy-link')!;
  private playerCountBadge = document.getElementById('player-count-badge')!;
  private rosterList = document.getElementById('roster-list')!;
  private btnStartRace = document.getElementById('btn-start-race') as HTMLButtonElement;
  private startHint = document.getElementById('start-hint')!;
  private btnLeaveRoom = document.getElementById('btn-leave-room')!;

  private hudPlacement = document.getElementById('hud-placement')!;
  private hudTotalPlayers = document.getElementById('hud-total-players')!;
  private hudLap = document.getElementById('hud-lap')!;
  private itemSlot = document.getElementById('item-slot')!;
  private itemIcon = document.getElementById('item-icon')!;
  private itemPrompt = document.getElementById('item-prompt')!;
  private hudSpeed = document.getElementById('hud-speed')!;
  private driftTierBar = document.getElementById('drift-tier-bar')!;
  private announcementBox = document.getElementById('announcement-box')!;
  private announcementText = document.getElementById('announcement-text')!;
  private liveStandings = document.getElementById('live-standings')!;
  private spectatorBanner = document.getElementById('spectator-banner')!;
  private btnMute = document.getElementById('btn-mute')!;
  private btnCamera = document.getElementById('btn-camera')!;

  private resultsWinner = document.getElementById('results-winner')!;
  private resultsBody = document.getElementById('results-body')!;
  private btnRematch = document.getElementById('btn-rematch')!;
  private btnResultsLobby = document.getElementById('btn-results-lobby')!;
  private rematchStatus = document.getElementById('rematch-status')!;

  // Event Callbacks
  public onCreateRoom?: (name: string, color: KartColorId) => void;
  public onJoinRoom?: (code: string, name: string, color: KartColorId) => void;
  public onColorChanged?: (color: KartColorId) => void;
  public onStartRace?: () => void;
  public onLeaveRoom?: () => void;
  public onCameraToggle?: () => void;
  public onRematch?: () => void;

  constructor() {
    this.loadSavedPreferences();
    this.renderColorPicker();
    this.bindEvents();
  }

  private loadSavedPreferences() {
    const savedName = localStorage.getItem('hyperkart_playerName');
    if (savedName) {
      this.playerName = savedName;
      this.playerNameInput.value = savedName;
    } else {
      this.playerName = `Racer_${Math.floor(100 + Math.random() * 900)}`;
      this.playerNameInput.value = this.playerName;
    }

    const savedColor = localStorage.getItem('hyperkart_kartColor') as KartColorId;
    if (savedColor && KART_COLORS[savedColor]) {
      this.selectedColor = savedColor;
    }
  }

  private renderColorPicker() {
    this.colorPickerContainer.innerHTML = '';
    const colorIds = Object.keys(KART_COLORS) as KartColorId[];

    for (const id of colorIds) {
      const c = KART_COLORS[id];
      const swatch = document.createElement('div');
      swatch.className = `color-swatch ${id === this.selectedColor ? 'selected' : ''}`;
      swatch.style.background = `linear-gradient(135deg, #${c.primary.toString(16).padStart(6, '0')} 0%, #${c.secondary.toString(16).padStart(6, '0')} 100%)`;
      swatch.title = c.name;
      swatch.dataset.colorId = id;

      swatch.addEventListener('click', () => {
        this.selectedColor = id;
        localStorage.setItem('hyperkart_kartColor', id);
        this.renderColorPicker();
        this.onColorChanged?.(id);
      });

      this.colorPickerContainer.appendChild(swatch);
    }
  }

  private bindEvents() {
    this.playerNameInput.addEventListener('input', () => {
      this.playerName = this.playerNameInput.value.trim() || 'Racer';
      localStorage.setItem('hyperkart_playerName', this.playerName);
    });

    this.btnCreateRoom.addEventListener('click', () => {
      soundSystem.resume();
      this.onCreateRoom?.(this.playerName, this.selectedColor);
    });

    this.btnJoinRoom.addEventListener('click', () => {
      const code = this.roomCodeInput.value.trim().toUpperCase();
      if (!code) {
        this.showError('Missing Room Code', 'Please enter a valid 5-character room code.');
        return;
      }
      soundSystem.resume();
      this.onJoinRoom?.(code, this.playerName, this.selectedColor);
    });

    this.btnCopyLink.addEventListener('click', () => {
      const code = this.displayRoomCode.innerText;
      const basePath = (import.meta as any).env?.BASE_PATH || '/';
      const cleanBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
      const url = `${window.location.origin}${cleanBase}#room=${code}`;

      navigator.clipboard.writeText(url).then(() => {
        this.btnCopyLink.innerText = '✅ Copied!';
        setTimeout(() => {
          this.btnCopyLink.innerText = '📋 Share Link';
        }, 2000);
      }).catch(() => {
        prompt('Copy room link:', url);
      });
    });

    this.btnStartRace.addEventListener('click', () => {
      soundSystem.resume();
      this.onStartRace?.();
    });

    this.btnLeaveRoom.addEventListener('click', () => {
      this.showSetupView();
      this.onLeaveRoom?.();
    });

    this.btnMute.addEventListener('click', () => {
      const muted = soundSystem.toggleMute();
      this.btnMute.innerText = muted ? '🔇' : '🔊';
    });

    this.btnCamera.addEventListener('click', () => {
      this.onCameraToggle?.();
    });

    this.btnRematch.addEventListener('click', () => {
      this.onRematch?.();
      this.btnRematch.setAttribute('disabled', 'true');
      this.rematchStatus.innerText = 'Vote recorded! Waiting for racers...';
    });

    this.btnResultsLobby.addEventListener('click', () => {
      this.showSetupView();
      this.onLeaveRoom?.();
    });

    this.btnErrorDismiss.addEventListener('click', () => {
      this.errorModal.classList.add('hidden');
      this.showSetupView();
    });
  }

  public showSetupView() {
    this.menuOverlay.classList.remove('hidden');
    this.setupView.classList.remove('hidden');
    this.lobbyView.classList.add('hidden');
    this.gameHud.classList.add('hidden');
    this.resultsOverlay.classList.add('hidden');
    soundSystem.stopMusic();
  }

  public showLobbyView(state: RoomState, localPlayerId: string) {
    this.menuOverlay.classList.remove('hidden');
    this.setupView.classList.add('hidden');
    this.lobbyView.classList.remove('hidden');
    this.gameHud.classList.add('hidden');
    this.resultsOverlay.classList.add('hidden');

    this.displayRoomCode.innerText = state.code;
    const players = Object.values(state.players);
    this.playerCountBadge.innerText = `Racers: ${players.length}/8`;

    // Render roster
    this.rosterList.innerHTML = '';
    for (const p of players) {
      const item = document.createElement('div');
      item.className = 'roster-item';
      const c = KART_COLORS[p.color] || KART_COLORS.cyan;
      item.style.borderLeftColor = `#${c.primary.toString(16).padStart(6, '0')}`;

      item.innerHTML = `
        <div class="pilot-info">
          <span class="pilot-name">${p.name} ${p.id === localPlayerId ? '(You)' : ''}</span>
          ${p.isHost ? '<span class="host-tag">HOST</span>' : ''}
        </div>
        <span class="status-tag">${p.connected ? 'Ready' : 'Reconnecting...'}</span>
      `;
      this.rosterList.appendChild(item);
    }

    const isHost = state.hostId === localPlayerId;
    if (isHost) {
      const canStart = players.length >= 2;
      this.btnStartRace.disabled = !canStart;
      this.startHint.innerText = canStart
        ? 'Ready to launch! Click START to begin.'
        : `Need at least 2 racers to start (${players.length}/2 joined).`;
    } else {
      this.btnStartRace.disabled = true;
      this.startHint.innerText = 'Waiting for room host to start the race...';
    }
  }

  public showGameHUD(isSpectator: boolean = false) {
    this.menuOverlay.classList.add('hidden');
    this.resultsOverlay.classList.add('hidden');
    this.gameHud.classList.remove('hidden');

    if (isSpectator) {
      this.spectatorBanner.classList.remove('hidden');
    } else {
      this.spectatorBanner.classList.add('hidden');
    }

    soundSystem.startMusic();
  }

  public showAnnouncement(text: string, duration: number = 1.2) {
    this.announcementText.innerText = text;
    this.announcementBox.classList.remove('hidden');
    setTimeout(() => {
      this.announcementBox.classList.add('hidden');
    }, duration * 1000);
  }

  public updateHUD(
    speed: number,
    placement: number,
    totalPlayers: number,
    lap: number,
    driftLevel: number
  ) {
    const kmh = Math.max(0, Math.round(speed * 3.6));
    this.hudSpeed.innerText = String(kmh);

    const suffix = placement === 1 ? '1st' : placement === 2 ? '2nd' : placement === 3 ? '3rd' : `${placement}th`;
    this.hudPlacement.innerText = suffix;
    this.hudTotalPlayers.innerText = String(totalPlayers);
    this.hudLap.innerText = `${Math.min(lap, TOTAL_LAPS)}/${TOTAL_LAPS}`;

    // Drift Gauge
    if (driftLevel === 1) {
      this.driftTierBar.className = 'drift-tier-bar tier-1';
      this.driftTierBar.style.width = '33%';
    } else if (driftLevel === 2) {
      this.driftTierBar.className = 'drift-tier-bar tier-2';
      this.driftTierBar.style.width = '66%';
    } else if (driftLevel === 3) {
      this.driftTierBar.className = 'drift-tier-bar tier-3';
      this.driftTierBar.style.width = '100%';
    } else {
      this.driftTierBar.style.width = '0%';
    }
  }

  public updateItemSlot(item: string | null, isSpinning: boolean) {
    if (isSpinning) {
      this.itemSlot.classList.add('spinning');
      this.itemIcon.innerText = '🎲';
      this.itemPrompt.innerText = 'SPINNING';
    } else if (item) {
      this.itemSlot.classList.remove('spinning');
      const iconMap: Record<string, string> = {
        rocket: '🚀',
        mine: '💣',
        boost: '⚡',
        shield: '🛡️',
      };
      this.itemIcon.innerText = iconMap[item] || '❓';
      this.itemPrompt.innerText = 'PRESS [E]';
    } else {
      this.itemSlot.classList.remove('spinning');
      this.itemIcon.innerText = '';
      this.itemPrompt.innerText = '';
    }
  }

  public updateStandings(players: PlayerState[], localPlayerId: string) {
    const sorted = [...players].sort((a, b) => a.placement - b.placement);
    this.liveStandings.innerHTML = '';

    for (const p of sorted.slice(0, 5)) {
      const row = document.createElement('div');
      row.className = `standing-row ${p.id === localPlayerId ? 'local-player' : ''}`;
      row.innerHTML = `
        <span>${p.placement}. ${p.name}</span>
        <span>L${Math.min(p.currentLap, TOTAL_LAPS)}</span>
      `;
      this.liveStandings.appendChild(row);
    }
  }

  public showResults(results: RaceResultEntry[]) {
    this.gameHud.classList.add('hidden');
    this.resultsOverlay.classList.remove('hidden');
    soundSystem.stopMusic();
    soundSystem.playFinishFanfare();

    if (results.length > 0) {
      this.resultsWinner.innerText = `🏆 WINNER: ${results[0].playerName.toUpperCase()}!`;
    }

    this.resultsBody.innerHTML = '';
    for (const r of results) {
      const tr = document.createElement('tr');
      const bestLap =
        r.lapTimes.length > 0 ? `${Math.min(...r.lapTimes).toFixed(2)}s` : '--';
      tr.innerHTML = `
        <td class="rank-${r.placement}">${r.placement}</td>
        <td><strong>${r.playerName}</strong></td>
        <td>${r.totalTime.toFixed(2)}s</td>
        <td>${bestLap}</td>
      `;
      this.resultsBody.appendChild(tr);
    }

    this.btnRematch.removeAttribute('disabled');
    this.rematchStatus.innerText = '';
  }

  public updateRematchStatus(votes: number, needed: number) {
    this.rematchStatus.innerText = `Rematch votes: ${votes} / ${needed} required`;
  }

  public showConnectionStatus(connected: boolean, message?: string) {
    if (connected) {
      this.connectionBanner.classList.add('hidden');
    } else {
      this.connectionBanner.classList.remove('hidden');
      if (message) this.connectionText.innerText = message;
    }
  }

  public showError(title: string, msg: string) {
    this.errorTitle.innerText = title;
    this.errorMessage.innerText = msg;
    this.errorModal.classList.remove('hidden');
  }
}
