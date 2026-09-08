/** Tiny WebAudio synth: engine drone, skid noise, and UI/race one-shots. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private skidGain: GainNode | null = null;
  muted = false;
  private started = false;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.started) {
      this.ctx?.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      this.started = true;
    } catch {
      return;
    }
    // engine: two detuned saws through a lowpass
    const ctx = this.ctx;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 700;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();

    // skid noise loop
    const len = ctx.sampleRate * 0.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = 'bandpass';
    nFilter.frequency.value = 900;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    noise.connect(nFilter);
    nFilter.connect(this.skidGain);
    this.skidGain.connect(this.master);
    noise.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  engine(speed: number, throttle: number, drifting: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.engineFilter || !this.engineOsc2) return;
    const s = Math.abs(speed);
    const f = 55 + s * 4.6;
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.06);
    this.engineOsc2.frequency.setTargetAtTime(f * 1.5, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(400 + s * 40 + throttle * 500, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.05 + Math.min(0.06, throttle * 0.05), t, 0.1);
    this.skidGain?.gain.setTargetAtTime(drifting ? 0.12 : 0, t, 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol = 0.3, slideTo?: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noiseBurst(dur: number, vol: number, freq: number): void {
    if (!this.ctx || !this.master) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
  }

  countdownTick(last: boolean): void {
    this.tone(last ? 880 : 440, last ? 0.5 : 0.18, 'square', 0.25);
  }
  pickup(): void {
    this.tone(660, 0.09, 'triangle', 0.25);
    this.tone(990, 0.12, 'triangle', 0.22, undefined, 0.07);
  }
  boost(): void {
    this.tone(180, 0.5, 'sawtooth', 0.22, 720);
  }
  boostTier(tier: number): void {
    this.tone(320 + tier * 90, 0.32, 'square', 0.2, 660 + tier * 160);
  }
  hop(): void {
    this.tone(300, 0.08, 'sine', 0.15, 480);
  }
  land(): void {
    this.noiseBurst(0.12, 0.3, 400);
  }
  hit(): void {
    this.tone(160, 0.25, 'square', 0.3, 60);
    this.noiseBurst(0.18, 0.25, 900);
  }
  splash(): void {
    this.noiseBurst(0.4, 0.35, 700);
    this.tone(240, 0.3, 'sine', 0.15, 90);
  }
  pad(): void {
    this.tone(420, 0.25, 'triangle', 0.2, 840);
  }
  lap(): void {
    this.tone(523, 0.12, 'triangle', 0.25);
    this.tone(659, 0.12, 'triangle', 0.25, undefined, 0.1);
  }
  finalLap(): void {
    this.tone(523, 0.1, 'square', 0.22);
    this.tone(659, 0.1, 'square', 0.22, undefined, 0.1);
    this.tone(784, 0.2, 'square', 0.22, undefined, 0.2);
  }
  finishFanfare(place: number): void {
    const base = place === 1 ? 523 : place <= 3 ? 440 : 330;
    this.tone(base, 0.16, 'triangle', 0.28);
    this.tone(base * 1.25, 0.16, 'triangle', 0.28, undefined, 0.15);
    this.tone(base * 1.5, 0.3, 'triangle', 0.28, undefined, 0.3);
    this.tone(base * 2, 0.5, 'triangle', 0.25, undefined, 0.5);
  }
  rocketFire(): void {
    this.noiseBurst(0.3, 0.3, 1400);
    this.tone(200, 0.3, 'sawtooth', 0.18, 500);
  }
  drop(): void {
    this.tone(260, 0.15, 'sine', 0.2, 130);
  }
}
