// HUD（版式对照原视频）：左上车库通知 · 顶部「下一站」目标卡 · 右上现金/增量/事件卡 · 右侧动作标签 ·
// 左侧连击面板 · 左下小地图+罗盘+区域/街道 · 底部三个读数圆 · 右下速度表（外圈绿弧=压缩空气）。
import type { Combo } from '../game/combo.ts';
import { COMBO } from '../game/combo.ts';
import type { ObjKind, Objectives } from '../game/objectives.ts';
import { KIND_LABEL, fmtTime } from '../game/objectives.ts';
import { TUNING } from '../physics/vehicle.ts';
import type { Vehicle } from '../physics/vehicle.ts';
import { districtAt, streetAt } from '../world/layout.ts';
import type { Layout } from '../world/layout.ts';
import { Minimap } from './minimap.ts';

const MODE_LABEL: Record<Vehicle['mode'], string> = { ground: '地面', wall: '贴墙', ceiling: '倒挂', air: '滞空', sunk: '落水' };
const KIND_ICON: Record<ObjKind, string> = { photo: '◉', trial: '⏱', food: '◆' };
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const RING = 276.5;

export type CardKind = 'info' | 'good' | 'warn' | 'gold';

export class Hud {
  private readonly layout: Layout;
  private readonly minimap: Minimap;
  private acc = 0;
  private frames = 0;
  private fpsT = 0;
  private shake = 0;
  private comboShown = 0;
  private cashShown: number;
  private cashTarget: number;
  private deltaT = 0;
  private noticeT = 10;
  private objIndex = -1;
  private bankFlash = 0;
  private readonly live: { el: HTMLElement; t: number }[] = [];
  private readonly el = {
    root: $('hud'),
    notice: $('notice'),
    obj: $('objective'),
    objIcon: $('obj-icon'),
    objKind: $('obj-kind'),
    objPlace: $('obj-place'),
    objDist: $('obj-dist'),
    cash: $('cash-val'),
    delta: $('cash-delta'),
    cards: $('cards'),
    callout: $('callout'),
    combo: $('combo'),
    comboLabel: $('combo-label'),
    comboScore: $('combo-score'),
    comboMult: $('combo-mult'),
    comboBar: $('combo-bar'),
    compass: $('compass-arrow'),
    district: $('district'),
    street: $('street'),
    sub: $('street-sub'),
    tDrift: $('t-drift'),
    tAir: $('t-air'),
    tFan: $('t-fan'),
    mode: $('mode'),
    fps: $('fps'),
    speed: $('speed'),
    gear: $('gear'),
    ring: $('ring'),
    airRing: $('air-ring'),
    airVal: $('air-val'),
  };

  constructor(layout: Layout, cash: number) {
    this.layout = layout;
    this.minimap = new Minimap($('minimap') as HTMLCanvasElement, layout);
    this.cashShown = this.cashTarget = cash;
    this.el.cash.textContent = `¥${fmt(cash)}`;
  }

  kick(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** 右上事件卡（对照 ROADS DISCOVERED / UNIT DISABLED / SPIKE STRIP AHEAD） */
  card(title: string, sub: string, kind: CardKind = 'info', seconds = 2.4): void {
    const c = document.createElement('div');
    c.className = `ev ${kind}`;
    const t = document.createElement('b');
    t.textContent = title;
    c.appendChild(t);
    if (sub) {
      const s = document.createElement('span');
      s.textContent = sub;
      c.appendChild(s);
    }
    const box = this.el.cards;
    box.prepend(c);
    void c.offsetWidth;
    c.classList.add('in');
    this.live.unshift({ el: c, t: seconds });
    while (this.live.length > 3) this.live.pop()!.el.remove();
  }

  /** 卡片按游戏时间计时（暂停时不会消失） */
  private tickCards(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const c = this.live[i];
      c.t -= dt;
      if (c.t <= 0 && !c.el.classList.contains('out')) {
        c.el.classList.remove('in');
        c.el.classList.add('out');
      }
      if (c.t <= -0.3) {
        c.el.remove();
        this.live.splice(i, 1);
      }
    }
  }

  /** 现金变动：数字滚动 + 绿色增量条（对照 +$200 POLICE UNIT DISABLED） */
  money(delta: number, reason: string): void {
    this.cashTarget += delta;
    this.el.delta.textContent = `${delta < 0 ? '−' : '+'}¥${fmt(Math.abs(delta))} ${reason}`;
    this.el.delta.classList.toggle('neg', delta < 0);
    this.el.delta.classList.remove('show');
    void this.el.delta.offsetWidth;
    this.el.delta.classList.add('show');
    this.deltaT = 2.6;
  }

  get cash(): number {
    return this.cashTarget;
  }

  /** 结算瞬间：面板转绿并显示本次总分（分数 × 倍率） */
  banked(total: number): void {
    this.bankFlash = 0.6;
    this.el.combo.className = 'on banked';
    this.el.comboScore.textContent = fmt(total);
  }

  update(
    dt: number, v: Vehicle, combo: Combo, objs: Objectives, seen: Set<string>,
    world: { cars: readonly { x: number; z: number }[]; time: number },
  ): void {
    const cars = world.cars;
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      this.el.fps.textContent = `${Math.round(this.frames / this.fpsT)} FPS`;
      this.frames = 0;
      this.fpsT = 0;
    }
    // HUD 跟随撞击轻微抖动
    if (this.shake > 0.01) {
      const s = this.shake * 7;
      this.el.root.style.transform = `translate(${(Math.random() - 0.5) * s}px, ${(Math.random() - 0.5) * s}px)`;
      this.shake *= Math.exp(-7 * dt);
    } else if (this.el.root.style.transform) this.el.root.style.transform = '';

    this.tickCards(dt);
    if (this.noticeT > 0) {
      this.noticeT -= dt;
      if (this.noticeT <= 0) this.el.notice.classList.add('gone');
    }
    if (this.deltaT > 0) {
      this.deltaT -= dt;
      if (this.deltaT <= 0) this.el.delta.classList.remove('show');
    }
    if (Math.abs(this.cashTarget - this.cashShown) > 0.5) {
      this.cashShown += (this.cashTarget - this.cashShown) * Math.min(1, dt * 6);
      if (Math.abs(this.cashTarget - this.cashShown) < 1) this.cashShown = this.cashTarget;
      this.el.cash.textContent = `¥${fmt(this.cashShown)}`;
    }

    // 连击面板：每帧更新，撞击时同一帧变红
    const el = this.el;
    if (combo.active) {
      this.comboShown += (combo.score - this.comboShown) * Math.min(1, dt * 14);
      el.combo.className = 'on';
      el.comboLabel.textContent = `${combo.lastLabel}  +${fmt(combo.lastPts)}`;
      el.comboScore.textContent = fmt(this.comboShown);
      el.comboMult.textContent = `×${combo.mult.toFixed(2)}`;
      el.comboBar.style.width = `${(combo.timer / COMBO.window) * 100}%`;
    } else if (combo.failed > 0) {
      el.combo.className = 'on failed';
      el.comboScore.textContent = fmt(combo.failedScore);
      this.comboShown = 0;
    } else if (this.bankFlash > 0) {
      this.bankFlash -= dt;
      if (this.bankFlash <= 0) el.combo.className = '';
    } else {
      el.combo.className = '';
      this.comboShown = 0;
    }
    el.callout.textContent = combo.liveLabel;
    el.callout.classList.toggle('on', !!combo.live);

    this.acc += dt;
    if (this.acc < 0.05) return;
    this.acc = 0;

    // 速度表（三位补零）+ 外圈压缩空气
    const kmh = Math.round(v.speedKmh);
    el.speed.textContent = String(Math.min(kmh, 999)).padStart(3, '0');
    el.gear.textContent = v.forwardSpeed < -0.5 ? 'R' : 'D';
    el.ring.style.strokeDashoffset = String(RING * (1 - Math.min(kmh / 360, 1) * 0.75));
    const air = v.air / TUNING.tank;
    el.airRing.style.strokeDashoffset = String(RING * (1 - air * 0.25));
    el.airRing.classList.toggle('low', air < 0.2);
    el.airVal.textContent = `${Math.round(v.air)} L`;
    el.mode.textContent = v.stuntActive?'空中翻滚':v.landingAssist?'着陆缓冲':v.showcase?'展车':v.mode==='air'?'空中转向辅助':MODE_LABEL[v.mode];
    const bottle=$('gas-bottle'),percent=Math.round(v.air/TUNING.tank*100);
    bottle.style.setProperty('--fuel',String(v.air/TUNING.tank));bottle.setAttribute('aria-valuenow',String(percent));bottle.classList.toggle('low',percent<20);$('gas-percent').textContent=percent+'%';
    const action=document.querySelector<HTMLElement>('[data-control=action]');if(action)action.textContent=v.mode==='air'?'翻滚':v.showcase?'收起':'展车';
    document.querySelector('[data-control=fan]')?.classList.toggle('on',v.fanOn);
    el.mode.dataset.mode = v.fanOn && v.mode === 'ground' ? 'fan' : v.mode;

    // 底部读数圆
    this.dial(el.tDrift, v.grounded && v.drifting ? Math.abs(v.slip) * 57.3 : 0, 60, (x) => `${Math.round(x)}°`);
    this.dial(el.tAir, v.mode === 'air' ? v.airTime : 0, 5, (x) => x.toFixed(1));
    this.dial(el.tFan, v.fanHeat * 100, 100, (x) => `${Math.round(x)}`, v.fanOn || v.fanLock, v.fanHeat > 0.7);

    // 目标卡
    if (objs.index !== this.objIndex) {
      this.objIndex = objs.index;
      el.obj.classList.remove('swap');
      void el.obj.offsetWidth;
      el.obj.classList.add('swap');
      el.obj.dataset.kind = objs.current.kind;
      el.objIcon.textContent = KIND_ICON[objs.current.kind];
    }
    const o = objs.current;
    const goal = objs.goal;
    const dist = objs.distance(v.pos);
    if (objs.racing) {
      el.objKind.textContent = `计时赛进行中 · ${fmtTime(objs.raceT)}`;
    } else {
      el.objKind.textContent = `下一站 · ${KIND_LABEL[o.kind]}${o.tag ? ` · ${o.tag}` : ''}`;
    }
    el.objPlace.textContent = goal.place;
    el.objDist.textContent = goal.aerial && Math.abs(dist.up) > 8 ? `${fmt(dist.flat)} m · ${dist.up > 0 ? '↑' : '↓'}${fmt(Math.abs(dist.up))} m` : `${fmt(dist.flat)} m`;

    // 小地图 + 罗盘
    const f = v.fwd();
    let fx = f.x;
    let fz = f.z;
    const fl = Math.hypot(fx, fz);
    if (fl < 1e-3) {
      fx = 0;
      fz = 1;
    } else {
      fx /= fl;
      fz /= fl;
    }
    this.minimap.draw(v.pos.x, v.pos.z, fx, fz, { x: goal.target.x, z: goal.target.z }, seen, cars);
    const dx = goal.target.x - v.pos.x;
    const dz = goal.target.z - v.pos.z;
    const ang = Math.atan2(-fz * dx + fx * dz, fx * dx + fz * dz);
    el.compass.style.transform = `rotate(${(ang * 180) / Math.PI}deg)`;

    el.district.textContent = districtAt(v.pos.x, v.pos.z);
    const st = streetAt(this.layout.streets, v.pos.x, v.pos.z);
    el.street.textContent = st || ' ';
    el.sub.textContent = v.mode === 'air' ? `离地 ${Math.max(0, Math.round(v.pos.y))} m` : v.mode === 'wall' || v.mode === 'ceiling' ? `外墙 ${Math.round(v.pos.y)} m` : v.pos.y > 6 ? `楼顶 ${Math.round(v.pos.y)} m` : ' ';
  }

  private dial(node: HTMLElement, value: number, max: number, label: (x: number) => string, forceOn = false, hot = false): void {
    const on = value > 0.05 || forceOn;
    node.classList.toggle('on', on);
    node.classList.toggle('hot', hot);
    const ring = node.querySelector('circle.v') as SVGCircleElement;
    ring.style.strokeDashoffset = String(119.4 * (1 - Math.min(value / max, 1)));
    (node.querySelector('b') as HTMLElement).textContent = on ? label(value) : '0';
  }
}
