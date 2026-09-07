export interface InputState {
  accel: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
}

/**
 * Keyboard input.  Listens on the window so the game works both standalone and
 * inside an iframe (the iframe must have focus, which the canvas click gives it).
 */
export class Input {
  state: InputState = { accel: false, brake: false, left: false, right: false, drift: false };
  /** one-shot presses consumed by the game loop */
  private pressed = new Set<string>();
  private keys = new Set<string>();
  enabled = true;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }

  private isTypingTarget(ev: KeyboardEvent): boolean {
    const t = ev.target as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (this.isTypingTarget(ev)) return;
    const code = ev.code;
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
    if (this.isGameKey(code)) ev.preventDefault();
    this.refresh();
  };

  private onKeyUp = (ev: KeyboardEvent): void => {
    this.keys.delete(ev.code);
    this.refresh();
  };

  private isGameKey(code: string): boolean {
    return (
      code.startsWith('Arrow') ||
      code === 'Space' ||
      code === 'ShiftLeft' ||
      code === 'ShiftRight' ||
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'KeyE' ||
      code === 'KeyR' ||
      code === 'KeyM' ||
      code === 'Enter'
    );
  }

  private refresh(): void {
    const k = this.keys;
    this.state.accel = k.has('ArrowUp') || k.has('KeyW');
    this.state.brake = k.has('ArrowDown') || k.has('KeyS');
    this.state.left = k.has('ArrowLeft') || k.has('KeyA');
    this.state.right = k.has('ArrowRight') || k.has('KeyD');
    this.state.drift = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('Space');
  }

  /** Returns true once per physical key press. */
  consume(code: string): boolean {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  /** Drop stale one-shot presses at the end of a frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  clear(): void {
    this.keys.clear();
    this.pressed.clear();
    this.refresh();
  }
}
