// Procedural WebAudio: engine hum, effects, countdown, fanfare.
// No audio files; everything is synthesized. Starts only after a user gesture.
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  muted = false;

  /** Must be called from a user gesture at least once. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      // engine loop
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = "sawtooth";
      this.engineOsc.frequency.value = 55;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = "lowpass";
      this.engineFilter.frequency.value = 500;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
    } catch {
      this.ctx = null;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setValueAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime);
    }
    return this.muted;
  }

  engine(speed: number, racing: boolean) {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const target = racing ? 0.05 + Math.min(1, Math.abs(speed) / 40) * 0.06 : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.1);
    this.engineOsc.frequency.setTargetAtTime(50 + Math.abs(speed) * 4.2, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(400 + Math.abs(speed) * 30, t, 0.1);
  }

  private beep(freq: number, dur: number, type: OscillatorType = "square", vol = 0.25, when = 0) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  countBeep(final: boolean) {
    this.beep(final ? 880 : 440, final ? 0.5 : 0.22, "square", 0.3);
  }
  pickup() {
    this.beep(660, 0.12, "sine", 0.3);
    this.beep(990, 0.16, "sine", 0.3, 0.09);
  }
  boost() {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx!.createOscillator();
    const g = this.ctx!.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(180, t0);
    o.frequency.exponentialRampToValueAtTime(900, t0 + 0.45);
    g.gain.setValueAtTime(0.28, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.55);
  }
  spin() {
    this.beep(220, 0.35, "sawtooth", 0.3);
    this.beep(140, 0.4, "sawtooth", 0.3, 0.1);
  }
  splash() {
    this.beep(300, 0.3, "triangle", 0.35);
    this.beep(180, 0.4, "triangle", 0.3, 0.12);
  }
  fanfare(win: boolean) {
    const seq = win ? [523, 659, 784, 1046] : [392, 494, 587, 784];
    seq.forEach((f, i) => this.beep(f, 0.28, "triangle", 0.32, i * 0.16));
  }
}
