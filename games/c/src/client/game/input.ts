export class Input {
  throttle = 0;
  brake = 0;
  steer = 0;
  drift = false;
  private keys = new Set<string>();
  private onAction: (a: 'item' | 'respawn' | 'mute') => void;

  constructor(onAction: (a: 'item' | 'respawn' | 'mute') => void) {
    this.onAction = onAction;
    window.addEventListener('keydown', this.keydown, { passive: false });
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', () => this.keys.clear());
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
  }

  private keydown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (k === 'e' || k === 'control') this.onAction('item');
    else if (k === 'r') this.onAction('respawn');
    else if (k === 'm') this.onAction('mute');
    this.keys.add(k);
    this.poll();
  };

  private keyup = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
    this.poll();
  };

  private poll(): void {
    const k = this.keys;
    const up = k.has('w') || k.has('arrowup');
    const down = k.has('s') || k.has('arrowdown');
    const left = k.has('a') || k.has('arrowleft');
    const right = k.has('d') || k.has('arrowright');
    this.throttle = up ? 1 : 0;
    this.brake = down ? 1 : 0;
    this.steer = (left ? -1 : 0) + (right ? 1 : 0);
    this.drift = k.has(' ') || k.has('shift');
  }
}
