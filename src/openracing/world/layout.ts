// 「印象上海」城市布局：南京东路 → 外滩 → 黄浦江 → 陆家嘴。只产出数据和碰撞体，不依赖 DOM。
// 坐标：x 向东（浦西 x<0，浦东 x>300），z 向南（北 = -z），y 向上，单位米。
// 这样在 three.js 的右手坐标系里面朝北时东边在右手边，和真实地图一致。
// 距离按约 1:2 压缩，超高层高度按 0.5 缩放，街道尺度保持 1:1。
import { Quaternion, Vector3 } from 'three';
import { ColliderWorld, aabb, makeBox, makeSphere, rampBox, segmentBox } from '../physics/colliders.ts';
import type { River } from '../physics/vehicle.ts';

export const RIVER: River = { x0: 0, x1: 300, waterY: -5 };
export const RIVER_CROSSINGS = [-300, 0, 300] as const;
export const BOUNDS = { x0: -900, x1: 1100, z0: -700, z1: 700, top: 700 };
export const PUXI_COLS = [-150, -270, -390, -510, -630, -750];
export const PUDONG_COLS = [350, 470, 590, 710, 830, 950, 1070];
export const ROWS = [-600, -480, -360, -240, -120, 0, 120, 240, 360, 480, 600];
export const COL_W = 16;
export const rowWidth = (z: number): number => (z === 0 ? 24 : 16);
export const BUND = { bldX0: -134, bldX1: -92, roadX0: -82, roadX1: -26, promX0: -26, promX1: 0, promY: 2 };
export const PUDONG_PROM_X1 = 342;

/** 0 外滩万国建筑 · 1 石库门 · 2 老公房/住宅 · 3 商业办公 · 4 陆家嘴玻璃塔 */
export type Style = 0 | 1 | 2 | 3 | 4;
export type BundRoof = 'pyramid' | 'clock' | 'dome';

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  style: Style;
  seed: number;
  roof?: BundRoof;
}
/** axis='x'：沿东西向延伸，位于 z=at；axis='z'：沿南北向延伸，位于 x=at。 */
export interface Street {
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  width: number;
  name: string;
}
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
export interface Ramp {
  a: Vector3;
  b: Vector3;
  width: number;
}
export interface Lamp {
  x: number;
  z: number;
  rot: number;
  y: number;
}
export interface Sign {
  x: number;
  y: number;
  z: number;
  h: number;
  variant: number;
}

export interface Layout {
  world: ColliderWorld;
  buildings: Building[];
  streets: Street[];
  blocks: Rect[];
  ramps: Ramp[];
  trees: [number, number, number][];
  lamps: Lamp[];
  signs: Sign[];
  spawn: { pos: Vector3; heading: Quaternion };
}

// ---- 地标参数（碰撞体与模型共用） ----
export const PEARL = { x: 410, z: -60, colR: 6.5, colH: 178, footR: 34, legTop: 50, lower: { y: 47, r: 13 }, upper: { y: 131, r: 11.5 }, module: { y: 175, r: 4.5 }, top: 234 };
export const pearlAngles = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3];
export const pearlSmall = [70, 80, 90, 100, 110].map((y, i) => ({ y, a: pearlAngles[i % 3] + Math.PI / 3, r: 3 }));

export const JINMAO = { x: 650, z: 60 };
/** 金茂：16 节逐层收分的八角塔身。 */
export function jinmaoTiers(): { y: number; h: number; r: number }[] {
  const out: { y: number; h: number; r: number }[] = [];
  let y = 0;
  for (let i = 0; i < 16; i++) {
    const h = 22.8 * Math.pow(0.88, i);
    out.push({ y, h, r: 16 * (1 - i * 0.036) });
    y += h;
  }
  return out;
}

export const SWFC = { x: 770, z: 60, hx: 14.5, bodyTop: 216, top: 246, frameW: 6.5, beamH: 4 };
/** 环球金融中心：一个方向保持宽度，另一方向向上收成一条线。 */
export const swfcHalfZ = (t: number): number => 3 + 11.5 * (1 - Math.pow(t, 1.35));

export const SHC = { x: 650, z: 180, height: 300, top: 316 };
export const shcRadius = (t: number): number => 22 * (1 - 0.5 * Math.pow(t, 1.1));
export const shcTwist = (t: number): number => (t * 2 * Math.PI) / 3;

// ---- 工具 ----
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 北 → 南（z 从负到正）
const PUXI_ROW_NAMES: Record<number, string> = {
  [-600]: '周家嘴路', [-480]: '武进路', [-360]: '海宁路', [-240]: '天潼路', [-120]: '北京东路',
  0: '南京东路', 120: '汉口路', 240: '福州路', 360: '广东路', 480: '延安东路', 600: '金陵东路',
};
const PUXI_COL_NAMES = ['四川中路', '河南中路', '福建中路', '浙江中路', '西藏中路', '成都北路'];
const PUDONG_COL_NAMES = ['滨江大道', '陆家嘴环路', '银城中路', '花园石桥路', '东泰路', '浦东南路', '源深路'];

/** 当前所在街道名（不在任何街道上时返回空字符串）。 */
export function streetAt(streets: Street[], x: number, z: number): string {
  for (const s of streets) {
    const along = s.axis === 'x' ? x : z;
    const across = s.axis === 'x' ? z : x;
    if (s.name && along >= s.from && along <= s.to && Math.abs(across - s.at) <= s.width / 2 + 2) return s.name;
  }
  return '';
}

/** 区域名（HUD 用）。 */
export function districtAt(x: number, z: number): string {
  if (x > RIVER.x0 && x < RIVER.x1) return '黄浦江';
  if (x >= RIVER.x1) {
    const d = Math.hypot(x - 700, z - 100);
    return d < 330 ? '陆家嘴' : '浦东';
  }
  if (x > BUND.roadX0) return '外滩 · 中山东一路';
  if (Math.abs(z) < 12 && x < BUND.bldX0) return '南京东路步行街';
  return '黄浦 · 外滩街区';
}

export function buildLayout(seed = 20261016): Layout {
  const rng = mulberry32(seed);
  const world = new ColliderWorld(32);
  const buildings: Building[] = [];
  const streets: Street[] = [];
  const blocks: Rect[] = [];
  const ramps: Ramp[] = [];
  const trees: [number, number, number][] = [];
  const lamps: Lamp[] = [];
  const signs: Sign[] = [];
  const { x0: BX0, x1: BX1, z0: BZ0, z1: BZ1, top } = BOUNDS;

  // ---- 地面、外滩亲水平台、边界 ----
  world.add(aabb(BX0, -20, BZ0, RIVER.x0, 0, BZ1, 'ground'));
  world.add(aabb(RIVER.x1, -20, BZ0, BX1, 0, BZ1, 'ground'));
  world.add(aabb(BUND.promX0, 0, BZ0 + 50, BUND.promX1, BUND.promY, BZ1 - 50, 'platform'));
  world.add(aabb(BX0 - 10, -30, BZ0 - 10, BX0, top, BZ1 + 10, 'bound'));
  world.add(aabb(BX1, -30, BZ0 - 10, BX1 + 10, top, BZ1 + 10, 'bound'));
  world.add(aabb(BX0, -30, BZ0 - 10, BX1, top, BZ0, 'bound'));
  world.add(aabb(BX0, -30, BZ1, BX1, top, BZ1 + 10, 'bound'));
  world.add(aabb(BX0, top, BZ0, BX1, top + 10, BZ1, 'bound'));

  // 上平台坡道（中山东一路 → 亲水平台）+ 平台边的飞跃跳台（正对浦东）
  for (const z of [-540, -300, 0, 300, 540]) {
    ramps.push({ a: new Vector3(-40, 0, z), b: new Vector3(BUND.promX0, BUND.promY, z), width: 20 });
  }
  for (const z of RIVER_CROSSINGS) {
    ramps.push({ a: new Vector3(-16, BUND.promY, z), b: new Vector3(-2, 6.2, z), width: 18 });
    ramps.push({ a: new Vector3(340, 0, z), b: new Vector3(302, 6.2, z), width: 18 });
  }
  for (const r of ramps) world.add(rampBox(r.a, r.b, r.width));

  // ---- 街道 ----
  ROWS.forEach((z) => {
    streets.push({ axis: 'x', at: z, from: BX0, to: BUND.roadX0, width: rowWidth(z), name: PUXI_ROW_NAMES[z] ?? '' });
    streets.push({ axis: 'x', at: z, from: RIVER.x1 + 42, to: BX1, width: rowWidth(z), name: z === 0 ? '世纪大道' : '' });
  });
  PUXI_COLS.forEach((x, i) => streets.push({ axis: 'z', at: x, from: BZ0, to: BZ1, width: COL_W, name: PUXI_COL_NAMES[i] }));
  PUDONG_COLS.forEach((x, i) => streets.push({ axis: 'z', at: x, from: BZ0, to: BZ1, width: COL_W, name: PUDONG_COL_NAMES[i] }));
  streets.push({ axis: 'z', at: (BUND.roadX0 + BUND.roadX1) / 2, from: BZ0, to: BZ1, width: BUND.roadX1 - BUND.roadX0, name: '中山东一路' });

  // 南北向的街区边界（含地图边缘）
  const zRanges: [number, number][] = [];
  const zEdges = [BZ0, ...ROWS, BZ1];
  for (let i = 0; i < zEdges.length - 1; i++) {
    const a = zEdges[i];
    const b = zEdges[i + 1];
    const lo = i === 0 ? a + 6 : a + rowWidth(a) / 2;
    const hi = i === zEdges.length - 2 ? b - 6 : b - rowWidth(b) / 2;
    zRanges.push([lo, hi]);
  }

  const addBuilding = (b: Building): void => {
    buildings.push(b);
    world.add(aabb(b.x - b.w / 2, 0, b.z - b.d / 2, b.x + b.w / 2, b.h, b.z + b.d / 2, 'building'));
  };

  // ---- 外滩万国建筑群 ----
  zRanges.forEach(([lo, hi]) => {
    const lots: [number, number][] = hi - lo > 60 ? [[lo, (lo + hi) / 2 - 4], [(lo + hi) / 2 + 4, hi]] : [[lo, hi]];
    lots.forEach(([a, b], k) => {
      const x0 = BUND.bldX0 + rng() * 4;
      const zc = (a + b) / 2;
      let roof: BundRoof | undefined;
      // 和平饭店在南京东路北角；海关钟楼、汇丰穹顶在南边（海关在北、汇丰在南）
      if (zc > -108 && zc < -12 && k === 1) roof = 'pyramid';
      if (zc > 132 && zc < 228) roof = k === 0 ? 'clock' : 'dome';
      const h = roof ? 34 + rng() * 6 : 24 + rng() * 18;
      addBuilding({ x: (x0 + BUND.bldX1) / 2, z: zc, w: BUND.bldX1 - x0, d: b - a, h, style: 0, seed: rng(), roof });
      if (roof === 'clock') world.add(aabb(-118, h, zc - 6, -106, h + 22, zc + 6, 'building'));
    });
  });

  // ---- 街区填充 ----
  const inLandmark = (r: Rect): boolean =>
    [PEARL, JINMAO, SWFC, SHC].some((l) => l.x > r.x0 && l.x < r.x1 && l.z > r.z0 && l.z < r.z1);

  const fillLot = (lot: Rect, side: 'puxi' | 'pudong'): void => {
    const w = lot.x1 - lot.x0;
    const d = lot.z1 - lot.z0;
    const cx = (lot.x0 + lot.x1) / 2;
    const cz = (lot.z0 + lot.z1) / 2;
    if (side === 'puxi') {
      if (Math.abs(cz) < 140) {
        // 南京东路沿线：百货商厦
        addBuilding({ x: cx, z: cz, w: w - 2, d: d - 2, h: 22 + rng() * 55, style: 3, seed: rng() });
        return;
      }
      const r = rng();
      if (r < 0.5) {
        // 石库门里弄：一排排两层半的联排，中间留出可以开车穿过的弄堂
        const alongX = w >= d;
        const span = alongX ? d : w;
        const rows = Math.max(1, Math.floor((span + 4.5) / 13.5));
        const used = rows * 9 + (rows - 1) * 4.5;
        const start = (alongX ? lot.z0 : lot.x0) + (span - used) / 2;
        for (let k = 0; k < rows; k++) {
          const s = start + k * 13.5 + 4.5;
          const h = 8.5 + rng() * 2;
          if (alongX) addBuilding({ x: cx, z: s, w: w, d: 9, h, style: 1, seed: rng() });
          else addBuilding({ x: s, z: cz, w: 9, d: d, h, style: 1, seed: rng() });
        }
      } else if (r < 0.82) {
        const s = Math.min(26, w - 4, d - 4);
        addBuilding({ x: cx + (rng() - 0.5) * (w - s - 4), z: cz + (rng() - 0.5) * (d - s - 4), w: s, d: s * (0.8 + rng() * 0.4), h: 40 + rng() * 70, style: 2, seed: rng() });
      } else {
        addBuilding({ x: cx, z: cz, w: w - 6, d: d - 6, h: 50 + rng() * 90, style: 3, seed: rng() });
      }
    } else {
      const core = Math.hypot(cx - 700, cz - 100) < 330;
      if (core) {
        addBuilding({ x: cx, z: cz, w: w - 3, d: d - 3, h: 12 + rng() * 6, style: 3, seed: rng() });
        const s = Math.min(30, w - 8, d - 8);
        const t = rng();
        addBuilding({ x: cx, z: cz, w: s, d: s, h: 90 + t * t * 130, style: 4, seed: rng() });
      } else {
        const r = rng();
        if (r < 0.5) addBuilding({ x: cx, z: cz, w: w - 6, d: d - 6, h: 40 + rng() * 70, style: 3, seed: rng() });
        else {
          const s = Math.min(28, w - 6, d - 6);
          addBuilding({ x: cx, z: cz, w: s, d: s, h: 50 + rng() * 80, style: rng() < 0.5 ? 2 : 4, seed: rng() });
        }
      }
    }
  };

  const fillBlock = (b: Rect, side: 'puxi' | 'pudong'): void => {
    blocks.push(b);
    if (inLandmark(b)) return;
    const W = b.x1 - b.x0 - 8;
    const D = b.z1 - b.z0 - 8;
    const nx = W > 70 ? (rng() < 0.5 ? 2 : 3) : W > 36 ? 2 : 1;
    const nz = D > 70 ? (rng() < 0.5 ? 2 : 3) : D > 36 ? 2 : 1;
    const gap = 6;
    const lw = (W - gap * (nx - 1)) / nx;
    const ld = (D - gap * (nz - 1)) / nz;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x0 = b.x0 + 4 + i * (lw + gap);
        const z0 = b.z0 + 4 + j * (ld + gap);
        fillLot({ x0, z0, x1: x0 + lw, z1: z0 + ld }, side);
      }
    }
  };

  const puxiX = [BX0 + 4, ...[...PUXI_COLS].reverse()];
  for (let i = 0; i < puxiX.length - 1; i++) {
    const x0 = i === 0 ? puxiX[0] : puxiX[i] + COL_W / 2;
    const x1 = puxiX[i + 1] - COL_W / 2;
    for (const [z0, z1] of zRanges) fillBlock({ x0, z0, x1, z1 }, 'puxi');
  }
  for (let i = 0; i < PUDONG_COLS.length - 1; i++) {
    const x0 = PUDONG_COLS[i] + COL_W / 2;
    const x1 = PUDONG_COLS[i + 1] - COL_W / 2;
    for (const [z0, z1] of zRanges) fillBlock({ x0, z0, x1, z1 }, 'pudong');
  }

  // ---- 地标碰撞体 ----
  pearlAngles.forEach((a) => {
    const cx = PEARL.x + Math.cos(a) * PEARL.colR;
    const cz = PEARL.z + Math.sin(a) * PEARL.colR;
    world.add(aabb(cx - 2.2, 0, cz - 2.2, cx + 2.2, PEARL.colH, cz + 2.2, 'landmark'));
    const foot = new Vector3(PEARL.x + Math.cos(a) * PEARL.footR, 0, PEARL.z + Math.sin(a) * PEARL.footR);
    world.add(segmentBox(foot, new Vector3(cx, PEARL.legTop, cz), 1.8, 'landmark'));
  });
  for (const s of [PEARL.lower, PEARL.upper, PEARL.module]) world.add(makeSphere(new Vector3(PEARL.x, s.y, PEARL.z), s.r, 'landmark'));
  for (const s of pearlSmall) world.add(makeSphere(new Vector3(PEARL.x + Math.cos(s.a) * 5, s.y, PEARL.z + Math.sin(s.a) * 5), s.r, 'landmark'));
  world.add(aabb(PEARL.x - 1, PEARL.module.y, PEARL.z - 1, PEARL.x + 1, PEARL.top, PEARL.z + 1, 'landmark'));

  const rot45 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 8);
  for (const t of jinmaoTiers()) {
    const a = t.r * 0.9;
    world.add(makeBox(new Vector3(JINMAO.x, t.y + t.h / 2, JINMAO.z), new Vector3(a, t.h / 2, a), 'landmark', rot45));
  }
  world.add(aabb(JINMAO.x - 4, 165, JINMAO.z - 4, JINMAO.x + 4, 210, JINMAO.z + 4, 'landmark'));

  for (let k = 0; k < 8; k++) {
    const y0 = (k / 8) * SWFC.bodyTop;
    const y1 = ((k + 1) / 8) * SWFC.bodyTop;
    const hz = swfcHalfZ((k + 0.5) / 8);
    world.add(aabb(SWFC.x - SWFC.hx, y0, SWFC.z - hz, SWFC.x + SWFC.hx, y1, SWFC.z + hz, 'landmark'));
  }
  {
    const hz = swfcHalfZ(1);
    const fw = SWFC.frameW;
    world.add(aabb(SWFC.x - SWFC.hx, SWFC.bodyTop, SWFC.z - hz, SWFC.x - SWFC.hx + fw, SWFC.top - SWFC.beamH, SWFC.z + hz, 'landmark'));
    world.add(aabb(SWFC.x + SWFC.hx - fw, SWFC.bodyTop, SWFC.z - hz, SWFC.x + SWFC.hx, SWFC.top - SWFC.beamH, SWFC.z + hz, 'landmark'));
    world.add(aabb(SWFC.x - SWFC.hx, SWFC.top - SWFC.beamH, SWFC.z - hz, SWFC.x + SWFC.hx, SWFC.top, SWFC.z + hz, 'landmark'));
  }

  for (let k = 0; k < 12; k++) {
    const t = (k + 0.5) / 12;
    const r = shcRadius(t) * 0.8;
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -shcTwist(t));
    world.add(makeBox(new Vector3(SHC.x, ((k + 0.5) / 12) * SHC.height, SHC.z), new Vector3(r, SHC.height / 24, r), 'landmark', q));
  }

  // ---- 行道树（梧桐）、路灯、霓虹招牌 ----
  const crossings = (s: Street): number[] =>
    streets.filter((o) => o.axis !== s.axis && o.from <= s.at && o.to >= s.at && o.at >= s.from && o.at <= s.to).map((o) => o.at);
  const nearCrossing = (v: number, xs: number[], pad: number): boolean => xs.some((c) => Math.abs(v - c) < pad);

  for (const s of streets) {
    const xs = crossings(s);
    const pudong = s.axis === 'x' ? s.from > 0 : s.at > 0;
    const bund = s.name === '中山东一路';
    const off = s.width / 2 + 2.2;
    const treeStep = pudong ? 18 : 12;
    if (!bund && s.at !== 0) {
      for (let t = s.from + 8; t < s.to - 8; t += treeStep) {
        if (nearCrossing(t, xs, 16)) continue;
        for (const sgn of [-1, 1]) {
          const j = (rng() - 0.5) * 1.5;
          const sc = 0.8 + rng() * 0.5;
          if (s.axis === 'x') trees.push([t + j, s.at + sgn * off, sc]);
          else trees.push([s.at + sgn * off, t + j, sc]);
        }
      }
    }
    const lampStep = bund ? 24 : 32;
    let k = 0;
    for (let t = s.from + 10; t < s.to - 10; t += lampStep / 2, k++) {
      if (nearCrossing(t, xs, 10)) continue;
      const sgn = k % 2 === 0 ? -1 : 1;
      const o = s.width / 2 + 0.8;
      if (s.axis === 'x') lamps.push({ x: t, z: s.at + sgn * o, rot: sgn > 0 ? Math.PI : 0, y: 0 });
      else lamps.push({ x: s.at + sgn * o, z: t, rot: sgn > 0 ? -Math.PI / 2 : Math.PI / 2, y: 0 });
    }
  }
  // 外滩亲水平台与浦东滨江的灯
  for (let z = BZ0 + 60; z < BZ1 - 60; z += 18) lamps.push({ x: -2.5, z, rot: -Math.PI / 2, y: BUND.promY });
  for (let z = BZ0 + 20; z < BZ1 - 20; z += 20) lamps.push({ x: RIVER.x1 + 4, z, rot: Math.PI / 2, y: 0 });
  for (let z = BZ0 + 20; z < BZ1 - 20; z += 14) trees.push([RIVER.x1 + 22 + (rng() - 0.5) * 10, z, 0.9 + rng() * 0.4]);

  // 南京东路步行街的竖向霓虹招牌
  {
    const xs = PUXI_COLS;
    for (let x = BX0 + 20; x < BUND.bldX0 - 10; x += 9) {
      if (nearCrossing(x, xs, 14)) continue;
      for (const sgn of [-1, 1]) {
        if (rng() < 0.25) continue;
        signs.push({ x: x + (rng() - 0.5) * 3, y: 7 + rng() * 4, z: sgn * (rowWidth(0) / 2 + 4.6), h: 4 + rng() * 2.5, variant: Math.floor(rng() * 8) });
      }
    }
  }

  const heading = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // 车头朝东 (+x)
  return { world, buildings, streets, blocks, ramps, trees, lamps, signs, spawn: { pos: new Vector3(-420, 0.75, 0), heading } };
}
