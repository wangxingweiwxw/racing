// 碰撞层：OBB 盒子 + 球体，按 XZ 平面网格做空间索引。不依赖 DOM，可在 Node 里跑测试。
import { Matrix4, Quaternion, Vector3 } from 'three';

export type ColliderTag = 'ground' | 'platform' | 'ramp' | 'building' | 'landmark' | 'bound' | 'vehicle';

interface ColliderBase {
  tag: ColliderTag;
  min: Vector3;
  max: Vector3;
}
export interface BoxCollider extends ColliderBase {
  kind: 'box';
  center: Vector3;
  half: Vector3;
  rot: Quaternion;
  inv: Quaternion;
  /** 会动、可以被撞开的物体（车流） */
  dyn?: DynInfo;
}

export interface DynInfo {
  vel: Vector3;
  /** 以玩家车质量为 1 */
  mass: number;
  /** impulse 以玩家质量为单位；对方的速度变化 = impulse / mass */
  onHit(impulse: Vector3, point: Vector3, speed: number): void;
}

/** 动态碰撞体来源（每步重新查询，追加到 pool[start..]，返回新的总数） */
export interface DynamicSource {
  contacts(p: Vector3, r: number, margin: number, pool: Contact[], start: number): number;
}
export interface SphereCollider extends ColliderBase {
  kind: 'sphere';
  center: Vector3;
  radius: number;
}
export type Collider = BoxCollider | SphereCollider;

/** depth > 0 表示穿透；-margin < depth <= 0 表示贴近但未接触（用于贴地判定）。 */
export interface Contact {
  normal: Vector3;
  point: Vector3;
  depth: number;
  collider: Collider;
}

export interface RayHit {
  dist: number;
  normal: Vector3;
  collider: Collider;
}

export function makeBox(center: Vector3, half: Vector3, tag: ColliderTag, rot = new Quaternion()): BoxCollider {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const v = new Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? half.x : -half.x, i & 2 ? half.y : -half.y, i & 4 ? half.z : -half.z)
      .applyQuaternion(rot)
      .add(center);
    min.min(v);
    max.max(v);
  }
  return { kind: 'box', center: center.clone(), half: half.clone(), rot: rot.clone(), inv: rot.clone().invert(), tag, min, max };
}

export function aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tag: ColliderTag): BoxCollider {
  return makeBox(
    new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
    new Vector3(Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2),
    tag,
  );
}

export function makeSphere(center: Vector3, radius: number, tag: ColliderTag): SphereCollider {
  return {
    kind: 'sphere',
    center: center.clone(),
    radius,
    tag,
    min: center.clone().subScalar(radius),
    max: center.clone().addScalar(radius),
  };
}

/** 坡道：a→b 是坡顶面中线，盒体向下有一定厚度，避免高速穿透。 */
export function rampBox(a: Vector3, b: Vector3, width: number, tag: ColliderTag = 'ramp', thickness = 3): BoxCollider {
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const up = new Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
  const side = new Vector3().crossVectors(dir, up);
  const rot = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(dir, up, side));
  const center = a.clone().add(b).multiplyScalar(0.5).addScaledVector(up, -thickness / 2);
  return makeBox(center, new Vector3(len / 2, thickness / 2, width / 2), tag, rot);
}

/** 沿线段 a→b 的方柱（东方明珠的斜撑等）。 */
export function segmentBox(a: Vector3, b: Vector3, r: number, tag: ColliderTag): BoxCollider {
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const helper = Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const y = helper.addScaledVector(dir, -dir.dot(helper)).normalize();
  const z = new Vector3().crossVectors(dir, y);
  const rot = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(dir, y, z));
  return makeBox(a.clone().add(b).multiplyScalar(0.5), new Vector3(len / 2, r, r), tag, rot);
}

const _l = new Vector3();
const _c = new Vector3();
const _d = new Vector3();

export function sphereBox(p: Vector3, r: number, margin: number, b: BoxCollider, out: Contact): boolean {
  _l.copy(p).sub(b.center).applyQuaternion(b.inv);
  const h = b.half;
  _c.set(
    Math.max(-h.x, Math.min(h.x, _l.x)),
    Math.max(-h.y, Math.min(h.y, _l.y)),
    Math.max(-h.z, Math.min(h.z, _l.z)),
  );
  _d.copy(_l).sub(_c);
  const d2 = _d.lengthSq();
  if (d2 > 1e-12) {
    const lim = r + margin;
    if (d2 > lim * lim) return false;
    const d = Math.sqrt(d2);
    out.normal.copy(_d).divideScalar(d);
    out.depth = r - d;
  } else {
    // 球心已进入盒内：沿穿透最浅的轴推出
    const dx = h.x - Math.abs(_l.x);
    const dy = h.y - Math.abs(_l.y);
    const dz = h.z - Math.abs(_l.z);
    if (dx <= dy && dx <= dz) {
      out.normal.set(_l.x >= 0 ? 1 : -1, 0, 0);
      out.depth = r + dx;
      _c.x = out.normal.x * h.x;
    } else if (dy <= dz) {
      out.normal.set(0, _l.y >= 0 ? 1 : -1, 0);
      out.depth = r + dy;
      _c.y = out.normal.y * h.y;
    } else {
      out.normal.set(0, 0, _l.z >= 0 ? 1 : -1);
      out.depth = r + dz;
      _c.z = out.normal.z * h.z;
    }
  }
  out.normal.applyQuaternion(b.rot);
  out.point.copy(_c).applyQuaternion(b.rot).add(b.center);
  out.collider = b;
  return true;
}

function sphereSphere(p: Vector3, r: number, margin: number, s: SphereCollider, out: Contact): boolean {
  _d.copy(p).sub(s.center);
  const d = _d.length();
  if (d > r + margin + s.radius) return false;
  if (d < 1e-6) out.normal.set(0, 1, 0);
  else out.normal.copy(_d).divideScalar(d);
  out.depth = r + s.radius - d;
  out.point.copy(s.center).addScaledVector(out.normal, s.radius);
  out.collider = s;
  return true;
}

/** 按穿透深度从深到浅排序（插入排序，数量很少） */
export function sortContacts(pool: Contact[], n: number): void {
  for (let i = 1; i < n; i++) {
    const cur = pool[i];
    let j = i - 1;
    while (j >= 0 && pool[j].depth < cur.depth) {
      pool[j + 1] = pool[j];
      j--;
    }
    pool[j + 1] = cur;
  }
}

const _yaxis = new Vector3(0, 1, 0);
/** 更新一个只绕 y 轴旋转的盒子的位姿（车流每步调用） */
export function setBoxPose(b: BoxCollider, x: number, y: number, z: number, yaw: number): void {
  b.center.set(x, y, z);
  b.rot.setFromAxisAngle(_yaxis, yaw);
  b.inv.copy(b.rot).invert();
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ex = b.half.x * c + b.half.z * s;
  const ez = b.half.x * s + b.half.z * c;
  b.min.set(x - ex, y - b.half.y, z - ez);
  b.max.set(x + ex, y + b.half.y, z + ez);
}

const _o = new Vector3();
const _v = new Vector3();

function rayBox(origin: Vector3, dir: Vector3, maxDist: number, b: BoxCollider, nOut: Vector3): number {
  _o.copy(origin).sub(b.center).applyQuaternion(b.inv);
  _v.copy(dir).applyQuaternion(b.inv);
  let tmin = 0;
  let tmax = maxDist;
  let axis = -1;
  let sign = 1;
  const o = [_o.x, _o.y, _o.z];
  const v = [_v.x, _v.y, _v.z];
  const h = [b.half.x, b.half.y, b.half.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(v[i]) < 1e-9) {
      if (o[i] < -h[i] || o[i] > h[i]) return -1;
      continue;
    }
    let t1 = (-h[i] - o[i]) / v[i];
    let t2 = (h[i] - o[i]) / v[i];
    let s = -1;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (axis < 0) return -1; // 起点在盒内
  nOut.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0).applyQuaternion(b.rot);
  return tmin;
}

function raySphere(origin: Vector3, dir: Vector3, maxDist: number, s: SphereCollider, nOut: Vector3): number {
  _o.copy(origin).sub(s.center);
  const b = _o.dot(dir);
  const c = _o.lengthSq() - s.radius * s.radius;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxDist) return -1;
  nOut.copy(origin).addScaledVector(dir, t).sub(s.center).normalize();
  return t;
}

export class ColliderWorld {
  readonly colliders: Collider[] = [];
  private cells = new Map<number, number[]>();
  private marks: number[] = [];
  private mark = 0;
  private scratch: number[] = [];
  private readonly cell: number;

  constructor(cell = 32) {
    this.cell = cell;
  }

  private key(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  add(c: Collider): Collider {
    const idx = this.colliders.length;
    this.colliders.push(c);
    this.marks.push(0);
    const s = this.cell;
    for (let ix = Math.floor(c.min.x / s); ix <= Math.floor(c.max.x / s); ix++) {
      for (let iz = Math.floor(c.min.z / s); iz <= Math.floor(c.max.z / s); iz++) {
        const k = this.key(ix, iz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(idx);
      }
    }
    return c;
  }

  /** 收集与 XZ 矩形相交的候选碰撞体下标（结果放在内部数组里，下次调用会被覆盖）。 */
  private gather(x0: number, z0: number, x1: number, z1: number): number[] {
    const out = this.scratch;
    out.length = 0;
    this.mark++;
    const s = this.cell;
    for (let ix = Math.floor(x0 / s); ix <= Math.floor(x1 / s); ix++) {
      for (let iz = Math.floor(z0 / s); iz <= Math.floor(z1 / s); iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (!list) continue;
        for (const i of list) {
          if (this.marks[i] === this.mark) continue;
          this.marks[i] = this.mark;
          out.push(i);
        }
      }
    }
    return out;
  }

  /** 球体接触查询：结果写进 pool（不够会扩容），返回接触数量，按穿透深度从深到浅排序。 */
  contacts(p: Vector3, r: number, margin: number, pool: Contact[]): number {
    const reach = r + margin;
    const cand = this.gather(p.x - reach, p.z - reach, p.x + reach, p.z + reach);
    let n = 0;
    for (const i of cand) {
      const c = this.colliders[i];
      if (p.y + reach < c.min.y || p.y - reach > c.max.y) continue;
      if (n >= pool.length) pool.push({ normal: new Vector3(), point: new Vector3(), depth: 0, collider: c });
      const hit = c.kind === 'box' ? sphereBox(p, r, margin, c, pool[n]) : sphereSphere(p, r, margin, c, pool[n]);
      if (hit) n++;
    }
    sortContacts(pool, n);
    return n;
  }

  /** 点是否在任何碰撞体内部（相机防穿墙用）。 */
  overlapsSphere(p: Vector3, r: number): boolean {
    return this.contacts(p, r, 0, this.overlapPool) > 0 && this.overlapPool[0].depth > 0;
  }
  private overlapPool: Contact[] = [];

  raycast(origin: Vector3, dir: Vector3, maxDist: number, ignore?: (c: Collider) => boolean): RayHit | null {
    const ex = origin.x + dir.x * maxDist;
    const ez = origin.z + dir.z * maxDist;
    const cand = this.gather(Math.min(origin.x, ex), Math.min(origin.z, ez), Math.max(origin.x, ex), Math.max(origin.z, ez));
    let best: RayHit | null = null;
    const n = new Vector3();
    for (const i of cand) {
      const c = this.colliders[i];
      if (ignore && ignore(c)) continue;
      const t = c.kind === 'box' ? rayBox(origin, dir, maxDist, c, n) : raySphere(origin, dir, maxDist, c, n);
      if (t >= 0 && (!best || t < best.dist)) best = { dist: t, normal: n.clone(), collider: c };
    }
    return best;
  }
}
