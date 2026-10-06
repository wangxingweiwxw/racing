// Synthesised sound (Web Audio): electric drive, tyres, wind, impacts.
// No sample files are needed, so the game ships without third party audio.

export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engOsc1!: OscillatorNode;
  private engOsc2!: OscillatorNode;
  private engFilter!: BiquadFilterNode;
  private engGain!: GainNode;
  private lfo!: OscillatorNode;
  private squealGain!: GainNode;
  private windGain!: GainNode;
  private rumbleGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private _volume = 0.7;
  muted = false;

  get volume() {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  /** must be called from a user gesture */
  start() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this._volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // engine
    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = "sine";
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = "triangle";
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6);
    }
    shaper.curve = curve;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = "lowpass";
    this.engFilter.Q.value = 3;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const g2 = ctx.createGain();
    g2.gain.value = 0.45;
    this.engOsc1.connect(shaper);
    this.engOsc2.connect(g2).connect(shaper);
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.master);
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 23;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.25;
    this.lfo.connect(lfoGain);
    lfoGain.connect(this.engOsc1.frequency);
    lfoGain.connect(this.engOsc2.frequency);
    this.engOsc1.start();
    this.engOsc2.start();
    this.lfo.start();

    const loopNoise = (type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return g;
    };
    this.squealGain = loopNoise("bandpass", 1350, 9);
    this.windGain = loopNoise("lowpass", 700, 0.5);
    this.rumbleGain = loopNoise("lowpass", 140, 1);
  }

  update(speed: number, maxSpeed: number, throttle: number, slip: number, offTrack: boolean, airborne: boolean, paused: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const r = Math.min(1.6, Math.abs(speed) / maxSpeed);
    // A single-speed electric drive rises smoothly with road speed.
    const rpm = 0.22 + r * 0.78 + (airborne ? 0.08 * throttle : 0);
    const f = 160 + r * 680;
    this.engOsc1.frequency.setTargetAtTime(f, t, 0.05);
    this.engOsc2.frequency.setTargetAtTime(f * 1.99, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(500 + rpm * 2400 * (0.5 + 0.5 * Math.max(0, throttle)), t, 0.05);
    const eg = paused ? 0 : Math.min(0.09, r * 0.05 + 0.035 * Math.max(0, throttle));
    this.engGain.gain.setTargetAtTime(eg, t, 0.08);
    this.squealGain.gain.setTargetAtTime(paused || airborne ? 0 : Math.min(0.22, Math.max(0, slip - 0.15) * 0.25), t, 0.06);
    this.windGain.gain.setTargetAtTime(paused ? 0 : Math.min(0.25, r * r * 0.22), t, 0.2);
    this.rumbleGain.gain.setTargetAtTime(paused || !offTrack || airborne ? 0 : Math.min(0.5, 0.15 + r * 0.5), t, 0.05);
  }

  beep(freq: number, dur = 0.18, vol = 0.25) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "square";
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, vol: number, type: BiquadFilterType = "lowpass", sweepTo?: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  impact(strength: number) {
    this.burst(0.25, 900, Math.min(0.9, 0.15 + strength * 0.06));
    this.burst(0.08, 3500, Math.min(0.4, strength * 0.03), "highpass");
  }

  landing(strength: number) {
    this.burst(0.18, 260, Math.min(0.7, strength * 0.12));
  }

  explosion(distance: number) {
    const v = Math.max(0.05, 1 - distance / 120);
    this.burst(1.2, 600, 0.9 * v, "lowpass", 60);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.6 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.75);
  }

  launch() {
    this.burst(0.35, 1200, 0.25, "bandpass", 300);
  }

  chime() {
    this.beep(880, 0.08, 0.12);
    setTimeout(() => this.beep(1320, 0.12, 0.12), 70);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this._volume;
  }
}
