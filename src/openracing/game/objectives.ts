// 顶部「下一站」目标（对应原视频 WHAT'S NEXT：PHOTO SPOT / TIME TRIAL · FEATURED / FOOD DISCOVERY），
// 以及「新路段」探索（对应 ROADS DISCOVERED）。不依赖 DOM。
import { Vector3 } from 'three';
import type { Vehicle } from '../physics/vehicle.ts';
import { PEARL, SHC, SWFC, streetAt } from '../world/layout.ts';
import type { Layout } from '../world/layout.ts';

export type ObjKind = 'photo' | 'trial' | 'food';
export interface Objective {
  kind: ObjKind;
  /** 类别后缀，例如「精选」 */
  tag?: string;
  place: string;
  target: Vector3;
  radius: number;
  reward: number;
  /** true：按三维距离判定（楼顶 / 半空中的目标） */
  aerial?: boolean;
  /** 自定义判定（例如必须从洞口穿过） */
  inside?: (p: Vector3) => boolean;
  /** 计时赛终点 */
  finish?: { place: string; target: Vector3; radius: number; par: number };
}

export interface ObjEvent {
  type: 'reached' | 'trialStart' | 'trialDone' | 'trialAbort' | 'next';
  title: string;
  sub: string;
  reward: number;
}

export const KIND_LABEL: Record<ObjKind, string> = { photo: '拍照点', trial: '计时赛', food: '美食发现' };

export function buildObjectives(layout: Layout): Objective[] {
  const clock = layout.buildings.find((b) => b.roof === 'clock');
  const list: Objective[] = [
    { kind: 'photo', place: '东方明珠 · 滨江观景台', target: new Vector3(330, 0, PEARL.z), radius: 24, reward: 500 },
    {
      kind: 'trial', tag: '精选', place: '银城中路冲刺', target: new Vector3(590, 0, -560), radius: 14, reward: 1500,
      finish: { place: '银城中路南口', target: new Vector3(590, 0, 560), radius: 16, par: 26 },
    },
    {
      kind: 'photo', place: '环球金融中心 · 穿越「开瓶器」', target: new Vector3(SWFC.x, SWFC.bodyTop + 13, SWFC.z), radius: 10, reward: 3000, aerial: true,
      inside: (p) => Math.abs(p.x - SWFC.x) < SWFC.hx - SWFC.frameW && p.y > SWFC.bodyTop && p.y < SWFC.top - SWFC.beamH && Math.abs(p.z - SWFC.z) < 5,
    },
    { kind: 'photo', place: '上海中心 · 塔冠', target: new Vector3(SHC.x, SHC.height + 4, SHC.z), radius: 26, reward: 2000, aerial: true },
    { kind: 'food', place: '南京东路 · 老字号汤包馆', target: new Vector3(-640, 0, 16), radius: 16, reward: 300 },
  ];
  if (clock) list.push({ kind: 'photo', place: '外滩 · 海关钟楼', target: new Vector3(-112, clock.h + 22, clock.z), radius: 12, reward: 800, aerial: true });
  return list;
}

export class Objectives {
  readonly list: Objective[];
  index = 0;
  racing = false;
  raceT = 0;
  best: number | null = null;
  private readonly out: ObjEvent[] = [];

  constructor(list: Objective[], best: number | null = null) {
    this.list = list;
    this.best = best;
  }

  get current(): Objective {
    return this.list[this.index];
  }

  /** 当前要去的点（计时赛进行中是终点） */
  get goal(): { place: string; target: Vector3; aerial: boolean } {
    const o = this.current;
    if (this.racing && o.finish) return { place: o.finish.place, target: o.finish.target, aerial: false };
    return { place: o.place, target: o.target, aerial: !!o.aerial };
  }

  distance(p: Vector3): { flat: number; up: number } {
    const g = this.goal.target;
    return { flat: Math.hypot(g.x - p.x, g.z - p.z), up: g.y - p.y };
  }

  abort(): ObjEvent[] {
    this.out.length = 0;
    if (this.racing) {
      this.racing = false;
      this.out.push({ type: 'trialAbort', title: '计时赛中断', sub: '回到起点重新开始', reward: 0 });
    }
    return this.out;
  }

  step(v: Vehicle, dt: number): ObjEvent[] {
    const out = this.out;
    out.length = 0;
    const o = this.current;
    const p = v.pos;
    if (this.racing && o.finish) {
      this.raceT += dt;
      const f = o.finish;
      if (Math.hypot(f.target.x - p.x, f.target.z - p.z) < f.radius) {
        this.racing = false;
        const t = this.raceT;
        const record = this.best === null || t < this.best;
        if (record) this.best = t;
        const reward = Math.round(o.reward * Math.min(2, Math.max(0.5, f.par / t)));
        out.push({ type: 'trialDone', title: record ? '计时赛 · 新纪录' : '计时赛完成', sub: `${fmtTime(t)} · 标准 ${fmtTime(f.par)}`, reward });
        this.advance();
      }
      return out;
    }
    const d = o.aerial ? p.distanceTo(o.target) : Math.hypot(o.target.x - p.x, o.target.z - p.z);
    const hit = o.inside ? o.inside(p) : d < o.radius;
    if (!hit) return out;
    if (o.kind === 'trial') {
      this.racing = true;
      this.raceT = 0;
      out.push({ type: 'trialStart', title: '计时赛开始', sub: `${o.place} · 标准 ${fmtTime(o.finish!.par)}`, reward: 0 });
      return out;
    }
    out.push({ type: 'reached', title: `${KIND_LABEL[o.kind]} · 已解锁`, sub: o.place, reward: o.reward });
    this.advance();
    return out;
  }

  private advance(): void {
    this.index = (this.index + 1) % this.list.length;
    const n = this.current;
    this.out.push({ type: 'next', title: KIND_LABEL[n.kind], sub: n.place, reward: 0 });
  }
}

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

/** 街道探索：第一次开上某条路时提示「新路段」。 */
export class Discovery {
  readonly names: string[];
  readonly seen = new Set<string>();
  private readonly layout: Layout;

  constructor(layout: Layout) {
    this.layout = layout;
    this.names = [...new Set(layout.streets.map((s) => s.name).filter(Boolean))];
  }

  step(p: Vector3): { name: string; count: number; total: number } | null {
    const name = streetAt(this.layout.streets, p.x, p.z);
    if (!name || this.seen.has(name)) return null;
    this.seen.add(name);
    return { name, count: this.seen.size, total: this.names.length };
  }
}
