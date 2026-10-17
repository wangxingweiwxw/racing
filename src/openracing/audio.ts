// 合成音效（WebAudio，无音频文件）：电机啸叫、冷气嘶声、轮胎尖叫、风扇嗡鸣、风噪 + 一次性音效。
import type { Vehicle, VehicleEvent } from './physics/vehicle.ts';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private motorA!: OscillatorNode;
  private motorB!: OscillatorNode;
  private motorGain!: GainNode;
  private hissGain!: GainNode;
  private hissFilter!: BiquadFilterNode;
  private squealGain!: GainNode;
  private windGain!: GainNode;
  private fanOsc!: OscillatorNode;
  private fanGain!: GainNode;
  muted = false;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;

  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // 电机：两个略微失谐的振荡器 + 低通
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motorA = ctx.createOscillator();
    this.motorA.type = 'sawtooth';
    this.motorB = ctx.createOscillator();
    this.motorB.type = 'triangle';
    const gb = ctx.createGain();
    gb.gain.value = 0.6;
    this.motorA.connect(lp);
    this.motorB.connect(gb).connect(lp);
    lp.connect(this.motorGain).connect(this.master);
    this.motorA.start();
    this.motorB.start();

    const loop = (type: BiquadFilterType, freq: number, q: number): [GainNode, BiquadFilterNode] => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return [g, f];
    };
    [this.hissGain, this.hissFilter] = loop('bandpass', 1800, 0.6);
    [this.squealGain] = loop('bandpass', 1500, 7);
    [this.windGain] = loop('lowpass', 420, 0.7);

    this.fanOsc = ctx.createOscillator();
    this.fanOsc.type = 'sawtooth';
    this.fanOsc.frequency.value = 180;
    const fbp = ctx.createBiquadFilter();
    fbp.type = 'bandpass';
    fbp.frequency.value = 900;
    fbp.Q.value = 3;
    this.fanGain = ctx.createGain();
    this.fanGain.gain.value = 0;
    this.fanOsc.connect(fbp).connect(this.fanGain).connect(this.master);
    this.fanOsc.start();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  update(v: Vehicle, throttle: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const sp = v.vel.length();
    const tc = 0.06;
    const f = 70 + sp * 9 + v.mainThrust * 60;
    this.motorA.frequency.setTargetAtTime(f, t, tc);
    this.motorB.frequency.setTargetAtTime(f * 2.01, t, tc);
    this.motorGain.gain.setTargetAtTime(v.mode === 'sunk' ? 0 : 0.035 + Math.abs(throttle) * 0.05 + Math.min(sp / 80, 1) * 0.03, t, tc);
    const thrust = Math.max(v.mainThrust, v.downThrust, Math.min(1, Math.abs(v.rcsYaw) + Math.abs(v.rcsRoll) + Math.abs(v.rcsPitch)) * 0.4);
    this.hissGain.gain.setTargetAtTime(thrust * 0.5, t, 0.03);
    this.hissFilter.frequency.setTargetAtTime(1200 + thrust * 2400, t, 0.05);
    this.squealGain.gain.setTargetAtTime(v.drifting && v.grounded ? Math.min(0.35, Math.abs(v.slip) * 0.6) : 0, t, 0.05);
    this.windGain.gain.setTargetAtTime(Math.min(sp / 90, 1) * 0.25, t, 0.1);
    this.fanGain.gain.setTargetAtTime(v.fanOn ? 0.05 + (v.mode === 'wall' || v.mode === 'ceiling' ? 0.04 : 0) : 0, t, 0.1);
    this.fanOsc.frequency.setTargetAtTime(v.fanOn ? 180 + v.fanHeat * 120 : 120, t, 0.2);
  }

  private burst(dur: number, freq: number, type: BiquadFilterType, gain: number, thump = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur);
    if (thump > 0) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
      const og = ctx.createGain();
      og.gain.setValueAtTime(thump, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(og).connect(this.master);
      o.start(t);
      o.stop(t + 0.3);
    }
  }

  /** 界面提示音：连击加分 / 结算 / 中断 / 解锁目标 */
  ui(kind: 'tick' | 'bank' | 'fail' | 'reach'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes: Record<typeof kind, [number, number, number][]> = {
      tick: [[1320, 0, 0.07]],
      bank: [[880, 0, 0.12], [1320, 0.08, 0.18], [1760, 0.16, 0.26]],
      fail: [[220, 0, 0.25], [165, 0.1, 0.35]],
      reach: [[660, 0, 0.14], [990, 0.1, 0.2], [1320, 0.2, 0.32]],
    };
    for (const [f, start, end] of notes[kind]) {
      const o = ctx.createOscillator();
      o.type = kind === 'fail' ? 'square' : 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + start);
      g.gain.linearRampToValueAtTime(kind === 'fail' ? 0.06 : 0.12, t + start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + end);
      o.connect(g).connect(this.master);
      o.start(t + start);
      o.stop(t + end + 0.02);
    }
  }

  /** 警笛：双音交替，音量随最近警车距离 */
  siren(level: number, time: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.sirenOsc) {
      this.sirenOsc = ctx.createOscillator();
      this.sirenOsc.type = 'sawtooth';
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 1.2;
      this.sirenGain = ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(bp).connect(this.sirenGain).connect(this.master);
      this.sirenOsc.start();
    }
    const t = ctx.currentTime;
    this.sirenOsc.frequency.setTargetAtTime(time % 1.1 < 0.55 ? 760 : 1020, t, 0.03);
    this.sirenGain!.gain.setTargetAtTime(level * 0.07, t, 0.1);
  }

  /** 车流按喇叭：两个失谐方波 */
  horn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.02);
    g.gain.setValueAtTime(0.07, t + 0.32);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    lp.connect(g).connect(this.master);
    for (const f of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.45);
    }
  }

  thud(k: number): void {
    this.burst(0.25, 260, 'lowpass', 0.5 * k + 0.2, 0.5 * k);
  }

  event(e: VehicleEvent): void {
    switch (e.type) {
      case 'hop':
        this.burst(0.35, 2600, 'highpass', 0.6, 0.5);
        break;
      case 'land':
        this.burst(0.2, 300, 'lowpass', Math.min(0.8, e.strength / 15), 0.4);
        break;
      case 'crash':
        this.burst(0.45, 700, 'lowpass', Math.min(1, e.strength / 12), 0.8);
        break;
      case 'attach':
        this.burst(0.15, 500, 'bandpass', 0.4, 0.3);
        break;
      case 'splash':
        this.burst(1.2, 900, 'lowpass', 0.9, 0.6);
        break;
      case 'overheat':
      case 'empty':
      case 'fanLocked':
        this.burst(0.25, 3200, 'bandpass', 0.3);
        break;
      default:
        break;
    }
  }
}
