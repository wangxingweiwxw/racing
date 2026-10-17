// 车流：IDM 跟车模型沿车道段行驶，路口按红绿灯停车，会给玩家让行；每辆车是一个可撞开的动态碰撞体。
// 不依赖 DOM。
import { Quaternion, Vector3 } from 'three';
import { makeBox, setBoxPose, sphereBox } from '../physics/colliders.ts';
import type { BoxCollider, ColliderWorld, Contact, DynamicSource } from '../physics/colliders.ts';
import type { Vehicle } from '../physics/vehicle.ts';
import { mulberry32 } from '../world/layout.ts';
import { bezier, bezierTangent, lightFor, makeTurn } from './network.ts';
import type { Network, Seg, Turn } from './network.ts';

export interface CarType {
  name: string;
  len: number;
  wid: number;
  hgt: number;
  mass: number;
  colors: number[];
}

export const CAR_TYPES: CarType[] = [
  { name: 'sedan', len: 4.7, wid: 1.85, hgt: 1.45, mass: 0.8, colors: [0xe8e8e6, 0x1c1d20, 0xa9adb3, 0x23324f, 0x7a1d22, 0x5c5f63, 0xd9d4c5] },
  { name: 'suv', len: 4.85, wid: 1.95, hgt: 1.75, mass: 1.0, colors: [0xf0f0ee, 0x16171a, 0x6d7177, 0x2e3a2c, 0x3b4a63] },
  { name: 'taxi', len: 4.7, wid: 1.8, hgt: 1.5, mass: 0.8, colors: [0x2fb7a8, 0x2fb7a8, 0xf2c230, 0x2d6fd0] },
  { name: 'van', len: 5.3, wid: 2.0, hgt: 2.2, mass: 1.3, colors: [0xf2f2f0, 0xdedede, 0x2f5d8c] },
  { name: 'bus', len: 12, wid: 2.5, hgt: 3.1, mass: 6, colors: [0xc8282e, 0x2c8a4a, 0x2a62b8, 0xe6e6e6] },
];

export const IDM = { a: 2.2, b: 3.2, s0: 2.5, T: 1.15 };
/** 车流只在玩家周围的「气泡」里：跑出 BUBBLE 的车重新放到 RESPAWN 环带里 */
export const BUBBLE = 420;
export const RESPAWN: [number, number] = [160, 380];

export type TrafficEvent =
  | { type: 'nearMiss'; clear: number; rel: number; car: number }
  | { type: 'hit'; car: number; speed: number }
  | { type: 'honk'; car: number };

export interface TCar {
  id: number;
  type: number;
  color: number;
  seg: number;
  s: number;
  v: number;
  v0f: number;
  next: number;
  /** s < 0 时所在的转弯曲线（从上一段进入本段） */
  turn: Turn | null;
  nextTurn: Turn;
  x: number;
  z: number;
  yaw: number;
  brake: boolean;
  state: 'drive' | 'knocked';
  kvx: number;
  kvz: number;
  kyaw: number;
  kt: number;
  nearT: number;
  honkT: number;
  box: BoxCollider;
}

const _p = new Vector3();

function idm(v: number, v0: number, gap: number, dv: number): number {
  const { a, b, s0, T } = IDM;
  const sStar = s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(a * b)));
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  const inter = gap === Infinity ? 0 : gap > 0.05 ? (sStar / gap) ** 2 : 400;
  return Math.max(-9, Math.min(a, a * (free - inter)));
}

export class Traffic implements DynamicSource {
  readonly cars: TCar[] = [];
  readonly net: Network;
  time = 0;
  private readonly rng: () => number;
  private readonly lists: TCar[][];
  private readonly world: ColliderWorld | null;
  private readonly events: TrafficEvent[] = [];
  /** 玩家物理步里发生的撞击，下一次 step() 时一起返回 */
  private readonly pending: TrafficEvent[] = [];
  private readonly pool: Contact[] = [];

  constructor(net: Network, count: number, seed = 1, world: ColliderWorld | null = null) {
    this.net = net;
    this.rng = mulberry32(seed);
    this.world = world;
    this.lists = net.segs.map(() => []);
    const total = net.segs.reduce((s, g) => s + g.len, 0);
    for (let i = 0; i < count; i++) {
      const type = this.pickType();
      const t = CAR_TYPES[type];
      const box = makeBox(new Vector3(), new Vector3(t.wid / 2, t.hgt / 2, t.len / 2), 'vehicle', new Quaternion());
      const car: TCar = {
        id: i, type, color: t.colors[Math.floor(this.rng() * t.colors.length)], seg: 0, s: 0, v: 0, v0f: 0.85 + this.rng() * 0.3,
        next: 0, turn: null, nextTurn: { p: [[0, 0], [0, 0], [0, 0], [0, 0]], len: 1, kind: 'straight' },
        x: 0, z: 0, yaw: 0, brake: false, state: 'drive', kvx: 0, kvz: 0, kyaw: 0, kt: 0, nearT: 0, honkT: 0, box,
      };
      box.dyn = {
        vel: new Vector3(),
        mass: t.mass,
        onHit: (impulse, _point, speed) => this.knock(car, impulse, speed),
      };
      this.cars.push(car);
      this.place(car, total, null);
    }
    this.pose();
  }

  private pickType(): number {
    const r = this.rng();
    return r < 0.5 ? 0 : r < 0.68 ? 1 : r < 0.86 ? 2 : r < 0.95 ? 3 : 4;
  }

  /** 随机放到一条车道上。avoid：离这个点小于 minDist 的位置不要；maxDist：只在这个半径内找 */
  private place(car: TCar, total: number, avoid: Vector3 | null, minDist = 0, maxDist = Infinity): void {
    const t = CAR_TYPES[car.type];
    for (let tries = 0; tries < 80; tries++) {
      let seg = this.net.segs[0];
      if (avoid && maxDist < Infinity) {
        seg = this.net.segs[Math.floor(this.rng() * this.net.segs.length)];
        const mx = (seg.sx + seg.ex) / 2;
        const mz = (seg.sz + seg.ez) / 2;
        const d = Math.hypot(mx - avoid.x, mz - avoid.z);
        if (d > maxDist + seg.len / 2 || d < minDist - seg.len / 2) continue;
        // 主干道车更多：外滩 ×3，次干道 ×2
        const w = seg.speed >= 16 ? 3 : seg.speed >= 15 ? 2 : 1;
        if (this.rng() * 3 > w) continue;
      } else {
        let r = this.rng() * total;
        for (const g of this.net.segs) {
          r -= g.len;
          if (r <= 0) {
            seg = g;
            break;
          }
        }
      }
      if (t.name === 'bus' && (seg.lane !== 1 || seg.speed < 15)) continue;
      const s = 4 + this.rng() * Math.max(0, seg.len - 8);
      const px = seg.sx + seg.dx * s;
      const pz = seg.sz + seg.dz * s;
      if (avoid) {
        const d = Math.hypot(px - avoid.x, pz - avoid.z);
        if (d < minDist || d > maxDist) continue;
      }
      const clash = this.cars.some((o) => o !== car && o.state === 'drive' && o.seg === seg.id && Math.abs(o.s - s) < (t.len + CAR_TYPES[o.type].len) / 2 + 6);
      if (clash) continue;
      car.seg = seg.id;
      car.s = s;
      car.v = seg.speed * car.v0f * 0.6;
      car.turn = null;
      car.state = 'drive';
      this.chooseNext(car);
      return;
    }
  }

  private chooseNext(car: TCar): void {
    const seg = this.net.segs[car.seg];
    const out = seg.out;
    car.next = out[Math.floor(this.rng() * out.length)];
    car.nextTurn = makeTurn(seg, this.net.segs[car.next]);
  }

  /** 外部障碍（警车）：车流会给它们让行 */
  obstacles: readonly { x: number; z: number; vx: number; vz: number }[] = [];

  knock(car: TCar, impulse: Vector3, speed: number): void {
    const t = CAR_TYPES[car.type];
    if (car.state === 'drive') {
      const seg = this.net.segs[car.seg];
      const f = car.s >= 0 ? [seg.dx, seg.dz] : [Math.sin(car.yaw), Math.cos(car.yaw)];
      car.kvx = f[0] * car.v;
      car.kvz = f[1] * car.v;
      car.state = 'knocked';
      car.kt = 0;
      car.brake = true;
    }
    car.kvx += impulse.x / t.mass;
    car.kvz += impulse.z / t.mass;
    car.kyaw += (this.rng() - 0.5) * Math.min(6, speed * 0.25) / Math.sqrt(t.mass);
    this.pending.push({ type: 'hit', car: car.id, speed });
  }

  // ---- DynamicSource ----
  contacts(p: Vector3, r: number, margin: number, pool: Contact[], start: number): number {
    let n = start;
    for (const car of this.cars) {
      const b = car.box;
      const reach = r + margin + b.half.z + 0.5;
      const dx = p.x - b.center.x;
      const dz = p.z - b.center.z;
      if (dx * dx + dz * dz > reach * reach || p.y - r - margin > b.max.y || p.y + r + margin < b.min.y) continue;
      if (n >= pool.length) pool.push({ normal: new Vector3(), point: new Vector3(), depth: 0, collider: b });
      if (sphereBox(p, r, margin, b, pool[n])) n++;
    }
    return n;
  }

  step(dt: number, player: Vehicle | null): TrafficEvent[] {
    const ev = this.events;
    ev.length = 0;
    for (const e of this.pending) ev.push(e);
    this.pending.length = 0;
    this.time += dt;
    const segs = this.net.segs;
    for (const l of this.lists) l.length = 0;
    for (const c of this.cars) if (c.state === 'drive') this.lists[c.seg].push(c);
    for (const l of this.lists) if (l.length > 1) l.sort((a, b) => a.s - b.s);

    const knocked = this.cars.filter((c) => c.state === 'knocked');
    const pv = player?.vel;
    const pp = player?.pos;
    const playerLow = !!player && player.mode !== 'sunk';

    for (const car of this.cars) {
      if (car.state !== 'drive') continue;
      const t = CAR_TYPES[car.type];
      const seg = segs[car.seg];
      const list = this.lists[car.seg];
      const i = list.indexOf(car);
      let gap = Infinity;
      let vLead = 0;
      if (i < list.length - 1) {
        const L = list[i + 1];
        gap = L.s - car.s - (CAR_TYPES[L.type].len + t.len) / 2;
        vLead = L.v;
      } else {
        const nl = this.lists[car.next];
        if (nl.length) {
          const L = nl[0];
          gap = seg.len - car.s + car.nextTurn.len + L.s - (CAR_TYPES[L.type].len + t.len) / 2;
          vLead = L.v;
        }
      }
      // 红灯 / 来不及停的黄灯
      const node = this.net.nodes[seg.to];
      if (node.signal && car.s < seg.len - 0.3) {
        const light = lightFor(node, seg.axis, this.time);
        const toLine = seg.len - car.s;
        if (light === 'red' || (light === 'yellow' && toLine > (car.v * car.v) / (2 * 3.5) + 1.5)) {
          const g = toLine - 1 - t.len / 2;
          if (g < gap) {
            gap = g;
            vLead = 0;
          }
        }
      }
      // 车头前方走廊里的障碍：玩家、被撞开的车
      const fx = car.s >= 0 ? seg.dx : Math.sin(car.yaw);
      const fz = car.s >= 0 ? seg.dz : Math.cos(car.yaw);
      let playerBlocks = false;
      const corridor = (ox: number, oz: number, halfL: number, halfW: number, vAlong: number): boolean => {
        const rx = ox - car.x;
        const rz = oz - car.z;
        const along = rx * fx + rz * fz;
        if (along <= 0 || along > 45) return false;
        const lat = Math.abs(rx * fz - rz * fx);
        if (lat > halfW + t.wid / 2 + 0.4) return false;
        const g = along - t.len / 2 - halfL;
        if (g < gap) {
          gap = g;
          vLead = Math.max(0, vAlong);
          return true;
        }
        return false;
      };
      if (playerLow && pp && pv && pp.y < 4) playerBlocks = corridor(pp.x, pp.z, 2.3, 1.1, pv.x * fx + pv.z * fz);
      for (const k of knocked) corridor(k.x, k.z, CAR_TYPES[k.type].len / 2, CAR_TYPES[k.type].wid / 2, 0);
      for (const o of this.obstacles) corridor(o.x, o.z, 2.4, 1.0, o.vx * fx + o.vz * fz);

      // 目标速度：转弯前减速
      let v0 = seg.speed * car.v0f;
      if (car.s < 0 && car.turn && car.turn.kind !== 'straight') v0 = Math.min(v0, 6.5);
      const remain = seg.len - car.s;
      if (car.nextTurn.kind !== 'straight' && remain < 30) v0 = Math.min(v0, 6.5 + (v0 - 6.5) * (remain / 30));
      const a = idm(car.v, v0, gap, car.v - vLead);
      car.brake = a < -1;
      if (playerBlocks && a < -4 && car.honkT <= 0) {
        car.honkT = 6;
        ev.push({ type: 'honk', car: car.id });
      }
      car.honkT -= dt;
      car.nearT -= dt;
      car.v = Math.max(0, car.v + a * dt);
      car.s += car.v * dt;
      if (car.s >= seg.len) {
        const over = car.s - seg.len;
        car.turn = car.nextTurn;
        car.seg = car.next;
        car.s = over - car.turn.len;
        this.chooseNext(car);
      }
    }

    // 被撞开的车：滑行 + 自转，碰到建筑会被推开；离玩家远了以后回到车流
    const total = segs.reduce((s, g) => s + g.len, 0);
    for (const car of knocked) {
      car.kt += dt;
      car.x += car.kvx * dt;
      car.z += car.kvz * dt;
      car.yaw += car.kyaw * dt;
      const damp = Math.exp(-1.1 * dt);
      car.kvx *= damp;
      car.kvz *= damp;
      car.kyaw *= Math.exp(-1.4 * dt);
      if (this.world) {
        _p.set(car.x, 1, car.z);
        const n = this.world.contacts(_p, 1.2, 0, this.pool);
        for (let i = 0; i < n; i++) {
          const c = this.pool[i];
          if (c.depth <= 0 || c.collider.tag === 'ground' || Math.abs(c.normal.y) > 0.6) continue;
          car.x += c.normal.x * c.depth;
          car.z += c.normal.z * c.depth;
          const vn = car.kvx * c.normal.x + car.kvz * c.normal.z;
          if (vn < 0) {
            car.kvx -= c.normal.x * vn * 1.4;
            car.kvz -= c.normal.z * vn * 1.4;
          }
        }
      }
      const far = !pp || Math.hypot(pp.x - car.x, pp.z - car.z) > 90;
      if (car.kt > 7 && far) {
        car.kvx = car.kvz = car.kyaw = 0;
        if (pp) this.place(car, total, pp, RESPAWN[0], RESPAWN[1]);
        else this.place(car, total, null);
      }
    }

    this.pose();

    // 气泡：离玩家太远的车搬到玩家附近（看不见的距离上）
    if (pp) {
      let moved = 0;
      for (const car of this.cars) {
        if (car.state !== 'drive' || moved > 12) continue;
        if (Math.hypot(pp.x - car.x, pp.z - car.z) > BUBBLE) {
          this.place(car, total, pp, RESPAWN[0], RESPAWN[1]);
          moved++;
        }
      }
    }

    if (pp) this.pose();

    // 擦车：高速贴着车身掠过但没有接触
    if (player && pp && pv && (player.mode === 'ground' || (player.mode === 'air' && pp.y < 4))) {
      for (const car of this.cars) {
        if (car.state !== 'drive' || car.nearT > 0) continue;
        const dx = pp.x - car.x;
        const dz = pp.z - car.z;
        if (dx * dx + dz * dz > 100) continue;
        const t = CAR_TYPES[car.type];
        const cy = Math.cos(car.yaw);
        const sy = Math.sin(car.yaw);
        const lx = dx * cy - dz * sy;
        const lz = dx * sy + dz * cy;
        // 只算并排侧向擦过（车头 / 车尾方向的逼近不算）
        if (Math.abs(lz) > t.len / 2 + 0.4) continue;
        const clear = Math.abs(lx) - t.wid / 2 - 1.0;
        const rel = Math.hypot(pv.x - car.box.dyn!.vel.x, pv.z - car.box.dyn!.vel.z);
        if (clear > 0.02 && clear < 1.4 && rel > 12) {
          car.nearT = 4;
          ev.push({ type: 'nearMiss', clear, rel, car: car.id });
        }
      }
    }
    return ev;
  }

  /** 由车道位置计算位姿，并同步碰撞盒 */
  private pose(): void {
    for (const car of this.cars) {
      const t = CAR_TYPES[car.type];
      if (car.state === 'drive') {
        const seg: Seg = this.net.segs[car.seg];
        if (car.s >= 0 || !car.turn) {
          const s = Math.max(0, car.s);
          car.x = seg.sx + seg.dx * s;
          car.z = seg.sz + seg.dz * s;
          car.yaw = Math.atan2(seg.dx, seg.dz);
        } else {
          const u = Math.min(1, Math.max(0, 1 + car.s / car.turn.len));
          const p = bezier(car.turn.p, u);
          const d = bezierTangent(car.turn.p, u);
          car.x = p[0];
          car.z = p[1];
          car.yaw = Math.atan2(d[0], d[1]);
        }
        car.box.dyn!.vel.set(Math.sin(car.yaw) * car.v, 0, Math.cos(car.yaw) * car.v);
      } else car.box.dyn!.vel.set(car.kvx, 0, car.kvz);
      setBoxPose(car.box, car.x, t.hgt / 2, car.z, car.yaw);
    }
  }
}
