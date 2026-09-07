import { local } from '../storage.ts';

/**
 * All sound is synthesised with the Web Audio API - no audio files, nothing to
 * attribute.  The context is created lazily on the first user gesture, which
 * is what browsers (and iframes) require before audio may play.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private windNoise: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  muted = local.get('muted') === '1';
  private engineOn = false;

  /** Call from a click/keydown handler. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    local.set('muted', this.muted ? '1' : '0');
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  startEngine(): void {
    if (!this.ctx || !this.master || this.engineOn) return;
    const ctx = this.ctx;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 60;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 30;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(g2).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();

    // wind / rolling noise
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    this.windNoise = ctx.createBufferSource();
    this.windNoise.buffer = buffer;
    this.windNoise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 900;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windNoise.connect(windFilter).connect(this.windGain).connect(this.master);
    this.windNoise.start();
    this.engineOn = true;
  }

  stopEngine(): void {
    if (!this.engineOn || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain?.gain.setTargetAtTime(0, t, 0.1);
    this.windGain?.gain.setTargetAtTime(0, t, 0.1);
    const osc = this.engineOsc;
    const osc2 = this.engineOsc2;
    const wind = this.windNoise;
    setTimeout(() => {
      try {
        osc?.stop();
        osc2?.stop();
        wind?.stop();
      } catch {
        /* already stopped */
      }
    }, 300);
    this.engineOn = false;
  }

  /** @param speedRatio 0..1 (>1 while boosting) */
  updateEngine(speedRatio: number, throttle: boolean, boosting: boolean, airborne: boolean): void {
    if (!this.engineOn || !this.ctx || !this.engineOsc || !this.engineOsc2 || !this.engineGain || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const rpm = 55 + speedRatio * 150 + (throttle ? 12 : 0) + (boosting ? 40 : 0) + (airborne ? 25 : 0);
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(rpm / 2, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(400 + speedRatio * 1400 + (throttle ? 300 : 0), t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.09 + speedRatio * 0.08, t, 0.1);
    this.windGain?.gain.setTargetAtTime(Math.min(0.25, speedRatio * speedRatio * 0.22), t, 0.15);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.25, slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    g.gain.value = gain;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  private noise(dur: number, gain = 0.3, freq = 1200): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }

  countdownBeep(final: boolean): void {
    this.tone(final ? 880 : 440, final ? 0.5 : 0.18, 'square', 0.2);
  }

  driftBoost(kind: 'mini' | 'super'): void {
    this.tone(kind === 'super' ? 500 : 380, 0.35, 'sawtooth', 0.18, kind === 'super' ? 1400 : 900);
  }

  boostPad(): void {
    this.tone(300, 0.4, 'sawtooth', 0.18, 1200);
  }

  pickup(): void {
    this.tone(660, 0.08, 'square', 0.15);
    setTimeout(() => this.tone(990, 0.12, 'square', 0.15), 80);
  }

  useItem(): void {
    this.tone(520, 0.12, 'triangle', 0.2, 260);
  }

  hit(): void {
    this.noise(0.35, 0.35, 500);
    this.tone(220, 0.4, 'sawtooth', 0.2, 60);
  }

  wallHit(strength: number): void {
    this.noise(0.12, 0.15 + strength * 0.2, 300);
  }

  land(): void {
    this.noise(0.1, 0.18, 250);
  }

  lap(finalLap: boolean): void {
    this.tone(660, 0.12, 'square', 0.18);
    setTimeout(() => this.tone(880, 0.12, 'square', 0.18), 120);
    if (finalLap) setTimeout(() => this.tone(1100, 0.25, 'square', 0.18), 240);
  }

  finish(place: number): void {
    const notes = place === 1 ? [523, 659, 784, 1047] : [523, 494, 440];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.25, 'square', 0.2), i * 140));
  }

  respawn(): void {
    this.tone(200, 0.3, 'triangle', 0.15, 600);
  }

  waspBuzz(): void {
    this.tone(180, 0.6, 'sawtooth', 0.12, 240);
  }

  click(): void {
    this.tone(700, 0.05, 'square', 0.08);
  }
}
