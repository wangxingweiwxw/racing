// 路网：从 layout 的街道生成路口节点和有向车道段（靠右行驶，每个方向 2 条车道）。不依赖 DOM。
// 坐标约定与 layout 相同：x 向东，z 向南；方向 (dx, dz) 的右侧为 (-dz, dx)（three.js 右手系，fwd × up）。
import type { Layout, Street } from '../world/layout.ts';

export const LANE_OFFSETS = [2, 6]; // 车道中心距道路中线（0 = 内侧快车道，1 = 外侧）
export const PED_STREETS = new Set(['南京东路']); // 步行街，不走机动车

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  links: number[];
  /** 交叉道路在 x / z 方向的半宽：沿 x 行驶的车在 x ± halfX 处停车 */
  halfX: number;
  halfZ: number;
  signal: boolean;
  phase: number;
}

export interface Seg {
  id: number;
  from: number;
  to: number;
  lane: number;
  dx: number;
  dz: number;
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  len: number;
  speed: number;
  axis: 'x' | 'z';
  street: string;
  out: number[];
}

export interface Turn {
  p: [number, number][]; // 三次贝塞尔控制点
  len: number;
  kind: 'straight' | 'left' | 'right' | 'uturn';
}

export interface Network {
  nodes: RoadNode[];
  segs: Seg[];
}

export const SIGNAL_CYCLE = 36;
export type Light = 'green' | 'yellow' | 'red';

/** 东西向（axis 'x'）先绿 14 s → 黄 3 s → 全红 1 s，再轮到南北向。 */
export function lightFor(node: RoadNode, axis: 'x' | 'z', t: number): Light {
  const c = (((t + node.phase) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const local = axis === 'x' ? c : (c + SIGNAL_CYCLE / 2) % SIGNAL_CYCLE;
  if (local < 14) return 'green';
  if (local < 17) return 'yellow';
  return 'red';
}

export function buildNetwork(layout: Layout): Network {
  const nodes: RoadNode[] = [];
  const index = new Map<string, number>();
  const onStreet = new Map<Street, number[]>();
  const rows = layout.streets.filter((s) => s.axis === 'x');
  const cols = layout.streets.filter((s) => s.axis === 'z');

  // 路口：横竖街道相交（含 T 字路口：一条街的端点落在另一条街的路面范围内）
  for (const r of rows) {
    for (const c of cols) {
      const x = c.at;
      const z = r.at;
      if (x < r.from - c.width / 2 - 0.5 || x > r.to + c.width / 2 + 0.5) continue;
      if (z < c.from - r.width / 2 - 0.5 || z > c.to + r.width / 2 + 0.5) continue;
      const key = `${x},${z}`;
      let id = index.get(key);
      if (id === undefined) {
        id = nodes.length;
        index.set(key, id);
        nodes.push({ id, x, z, links: [], halfX: c.width / 2, halfZ: r.width / 2, signal: false, phase: 0 });
      }
      for (const s of [r, c]) {
        if (!onStreet.has(s)) onStreet.set(s, []);
        const list = onStreet.get(s)!;
        if (!list.includes(id)) list.push(id);
      }
    }
  }

  const segs: Seg[] = [];
  for (const [street, ids] of onStreet) {
    if (PED_STREETS.has(street.name)) continue;
    const along = (n: RoadNode) => (street.axis === 'x' ? n.x : n.z);
    ids.sort((a, b) => along(nodes[a]) - along(nodes[b]));
    const speed = street.width >= 40 ? 16 : street.width >= 20 ? 15 : 12;
    for (let i = 0; i < ids.length - 1; i++) {
      const A = nodes[ids[i]];
      const B = nodes[ids[i + 1]];
      A.links.push(B.id);
      B.links.push(A.id);
      for (const [P, Q] of [[A, B], [B, A]] as [RoadNode, RoadNode][]) {
        const dx = Math.sign(Q.x - P.x);
        const dz = Math.sign(Q.z - P.z);
        const hp = street.axis === 'x' ? P.halfX : P.halfZ;
        const hq = street.axis === 'x' ? Q.halfX : Q.halfZ;
        for (let lane = 0; lane < LANE_OFFSETS.length; lane++) {
          const off = LANE_OFFSETS[lane];
          const rx = -dz;
          const rz = dx;
          const sx = P.x + dx * (hp + 1) + rx * off;
          const sz = P.z + dz * (hp + 1) + rz * off;
          const ex = Q.x - dx * (hq + 1) + rx * off;
          const ez = Q.z - dz * (hq + 1) + rz * off;
          const len = Math.hypot(ex - sx, ez - sz);
          if (len < 4) continue;
          segs.push({ id: segs.length, from: P.id, to: Q.id, lane, dx, dz, sx, sz, ex, ez, len, speed, axis: street.axis, street: street.name, out: [] });
        }
      }
    }
  }

  for (const n of nodes) {
    n.signal = n.links.length >= 3;
    n.phase = ((Math.abs(n.x) * 0.07 + Math.abs(n.z) * 0.11) % SIGNAL_CYCLE);
  }

  // 每条车道在路口的去向：直行保持车道，左转只走内侧道，右转只走外侧道；没有可选时放宽；死路允许掉头
  const startsAt = new Map<number, Seg[]>();
  for (const s of segs) {
    if (!startsAt.has(s.from)) startsAt.set(s.from, []);
    startsAt.get(s.from)!.push(s);
  }
  for (const s of segs) {
    const cand = startsAt.get(s.to) ?? [];
    const noU = cand.filter((o) => o.to !== s.from);
    const pref = noU.filter((o) => {
      const k = turnKind(s, o);
      return (k === 'straight' && o.lane === s.lane) || (k === 'left' && s.lane === 0 && o.lane === 0) || (k === 'right' && s.lane === 1 && o.lane === 1);
    });
    const pick = pref.length ? pref : noU.length ? noU.filter((o) => o.lane === s.lane) : cand.filter((o) => o.lane === s.lane);
    s.out = (pick.length ? pick : cand).map((o) => o.id);
  }
  return { nodes, segs };
}

export function turnKind(a: Seg, b: Seg): Turn['kind'] {
  const dot = a.dx * b.dx + a.dz * b.dz;
  if (dot > 0.9) return 'straight';
  if (dot < -0.9) return 'uturn';
  return a.dx * b.dz - a.dz * b.dx > 0 ? 'right' : 'left';
}

/** 从 a 的终点到 b 的起点的转弯曲线（三次贝塞尔）。 */
export function makeTurn(a: Seg, b: Seg): Turn {
  const kind = turnKind(a, b);
  const p0: [number, number] = [a.ex, a.ez];
  const p3: [number, number] = [b.sx, b.sz];
  const L = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const k = kind === 'uturn' ? 9 : L * 0.45;
  const p1: [number, number] = [p0[0] + a.dx * k, p0[1] + a.dz * k];
  const p2: [number, number] = [p3[0] - b.dx * k, p3[1] - b.dz * k];
  const p: [number, number][] = [p0, p1, p2, p3];
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= 12; i++) {
    const q = bezier(p, i / 12);
    len += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    prev = q;
  }
  return { p, len: Math.max(len, 0.5), kind };
}

export function bezier(p: [number, number][], t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}

export function bezierTangent(p: [number, number][], t: number): [number, number] {
  const u = 1 - t;
  const x = 3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]);
  const z = 3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]);
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}
