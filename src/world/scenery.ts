// OSM driven scenery: buildings (OSK OSMDataGenerator._build_building), public roads,
// bridges over the circuit, lakes and canals, and crowds at the classic spectator spots.
import * as THREE from "three";
import { Heightmap, Track, TrackQuery } from "../track";
import { BASE, rng, tex } from "./assets";

export interface WorldJSON {
  /** k = "g": grandstand, drawn as tiered seating facing the track */
  buildings: { h: number; b: number; r: "flat" | "gable"; p: [number, number][]; k?: "g" }[];
  roads: { w: number; t: number; p: [number, number][] }[];
  places: { name: string; x: number; z: number; kind: string }[];
  peaks: { name: string; x: number; z: number; ele?: string }[];
  /** flat water surfaces (tracks built with water_mesh) */
  water?: WaterJSON;
}

export interface WaterJSON {
  polys: { y: number; p: [number, number][]; holes: [number, number][][] }[];
  lines: { y: number; w: number; p: [number, number][] }[];
}

/** Lakes (OSM polygons) and canals (ribbons along waterways) as flat water at their bank level. */
export function buildWater(water: WaterJSON): THREE.Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const poly of water.polys) {
    const shape = new THREE.Shape(poly.p.map(([x, z]) => new THREE.Vector2(x, z)));
    for (const h of poly.holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, z))));
    const g = new THREE.ShapeGeometry(shape);
    const p = g.getAttribute("position");
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), poly.y, p.getY(i));
    const gi = g.index!;
    // shape space (x, z) mirrors y -> z: flip the winding so the faces point up
    for (let i = 0; i < gi.count; i += 3) idx.push(base + gi.getX(i), base + gi.getX(i + 2), base + gi.getX(i + 1));
    g.dispose();
  }
  for (const line of water.lines) {
    const n = line.p.length;
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const a = line.p[Math.max(0, i - 1)];
      const b = line.p[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0];
      let dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const hw = line.w / 2;
      pos.push(line.p[i][0] - dz * hw, line.y, line.p[i][1] + dx * hw, line.p[i][0] + dz * hw, line.y, line.p[i][1] - dx * hw);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c4a4f, roughness: 0.12, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    // no reflections in the scene: fake the sky in the water at grazing angles
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 4.0);
outgoingLight = mix(outgoingLight, vec3(0.58, 0.68, 0.78), fres * 0.7);
#include <opaque_fragment>`,
    );
  };
  mat.customProgramCacheKey = () => "water-v1";
  const m = new THREE.Mesh(g, mat);
  m.name = "water";
  m.receiveShadow = true;
  return m;
}

const WALL_COLORS = [0xefe9dc, 0xe8e2d2, 0xf3efe6, 0xd9d2c3, 0xe6dccb, 0xc9c3b6, 0xbfb7a8, 0xece4d0];
const ROOF_COLORS = [0x3b3f45, 0x45494f, 0x2f3338, 0x6a3a2c, 0x5a3328, 0x4b4f55];

function buildingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: tex(`${BASE}textures/render_albedo.jpg`),
    vertexColors: true,
    roughness: 0.9,
  });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
// OSK render texture is pinkish; neutralise, then let the vertex colour decide
float bl = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
diffuseColor.rgb = vec3(bl) * 1.25;
if (vMapUv.y >= 0.0) {
  // procedural windows on walls: uv = (metres along wall, metres above base) / 3
  vec2 w = vec2(vMapUv.x * 3.0 / 2.6, vMapUv.y * 3.0 / 2.9);
  vec2 f = fract(w);
  float win = step(0.3, f.x) * step(f.x, 0.72) * step(0.32, f.y) * step(f.y, 0.78) * step(0.9, w.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.12, 0.15), win * 0.85);
}`,
    );
  };
  mat.customProgramCacheKey = () => "building-v1";
  return mat;
}

type Cell = { pos: number[]; col: number[]; uv: number[]; idx: number[] };
const SEAT_COLORS = [0x2a5c9e, 0x2f6bb3, 0xb53a35, 0x4f5b66, 0x2f7d8c];

/** Grandstand: rows of seats stepping up away from the track, side walls and a roof canopy. */
function addStand(cell: Cell, pts: [number, number][], y0: number, h: number, track: Track, r: () => number) {
  let cx = 0;
  let cz = 0;
  for (const [x, z] of pts) {
    cx += x;
    cz += z;
  }
  cx /= pts.length;
  cz /= pts.length;
  // long axis (u) from the second moments of the footprint, v points towards the track
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (const [x, z] of pts) {
    sxx += (x - cx) ** 2;
    szz += (z - cz) ** 2;
    sxz += (x - cx) * (z - cz);
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(ang);
  const uz = Math.sin(ang);
  let vx = -uz;
  let vz = ux;
  const q = track.query(cx, cz);
  const tx = track.x[q.i] - cx;
  const tz = track.z[q.i] - cz;
  if (tx * vx + tz * vz < 0) {
    vx = -vx;
    vz = -vz;
  }
  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const [x, z] of pts) {
    const u = (x - cx) * ux + (z - cz) * uz;
    const v = (x - cx) * vx + (z - cz) * vz;
    umin = Math.min(umin, u);
    umax = Math.max(umax, u);
    vmin = Math.min(vmin, v);
    vmax = Math.max(vmax, v);
  }
  const P = (u: number, v: number, y: number): number[] => [cx + ux * u + vx * v, y, cz + uz * u + vz * v];
  const c = new THREE.Color();
  const quad = (a: number[], b: number[], cc: number[], d: number[], col: number, out: number[]) => {
    // wind (a, b, c, d) so the face normal points along `out`
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const flip = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0;
    const base = cell.pos.length / 3;
    for (const p of flip ? [d, cc, b, a] : [a, b, cc, d]) {
      cell.pos.push(p[0], p[1], p[2]);
      c.setHex(col);
      cell.col.push(c.r, c.g, c.b);
      cell.uv.push(0, -1); // no procedural windows
    }
    cell.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const front = [vx, 0, vz];
  const back = [-vx, 0, -vz];
  const up = [0, 1, 0];
  const concrete = 0xb9b6ae;
  const seat = SEAT_COLORS[Math.floor(r() * SEAT_COLORS.length)];
  const depth = vmax - vmin;
  const roofY = y0 + h;
  const topY = y0 + Math.max(3, h - Math.min(6, h * 0.25));
  const frontY = y0 + Math.min(2.2, h * 0.2);
  const rows = Math.max(4, Math.min(40, Math.round((depth * 0.85) / 0.85)));
  const vFront = vmax;
  const vBack = vmin + depth * 0.12;
  // front wall up to the first row
  quad(P(umin, vFront, y0), P(umax, vFront, y0), P(umax, vFront, frontY), P(umin, vFront, frontY), concrete, front);
  for (let k = 0; k < rows; k++) {
    const va = vFront - ((vFront - vBack) * k) / rows;
    const vb = vFront - ((vFront - vBack) * (k + 1)) / rows;
    const ya = frontY + ((topY - frontY) * k) / rows;
    const yb = frontY + ((topY - frontY) * (k + 1)) / rows;
    // tread (seat row) then riser
    quad(P(umin, va, ya), P(umax, va, ya), P(umax, vb, ya), P(umin, vb, ya), k % 9 === 8 ? concrete : seat, up);
    quad(P(umin, vb, ya), P(umax, vb, ya), P(umax, vb, yb), P(umin, vb, yb), 0x8d8a83, front);
  }
  // upper concourse, back wall up to the roof, side walls
  quad(P(umin, vBack, topY), P(umax, vBack, topY), P(umax, vmin, topY), P(umin, vmin, topY), concrete, up);
  quad(P(umin, vmin, y0), P(umax, vmin, y0), P(umax, vmin, roofY), P(umin, vmin, roofY), concrete, back);
  for (const [u, out] of [
    [umin, [-ux, 0, -uz]],
    [umax, [ux, 0, uz]],
  ] as const) {
    quad(P(u, vFront, y0), P(u, vmin, y0), P(u, vmin, topY), P(u, vFront, frontY), concrete, [...out]);
    // trapezoid above the seats to the roof, open towards the track
    quad(P(u, vmin, topY), P(u, vmin, roofY), P(u, vmin + depth * 0.55, roofY), P(u, vmin + depth * 0.55, topY), concrete, [...out]);
  }
  // cantilevered roof over most of the seating
  const roofFront = vmin + depth * 0.8;
  quad(P(umin - 1, vmin, roofY), P(umax + 1, vmin, roofY), P(umax + 1, roofFront, roofY + 1.2), P(umin - 1, roofFront, roofY + 1.2), 0xe8e8e4, up);
  quad(P(umin - 1, vmin, roofY - 0.5), P(umax + 1, vmin, roofY - 0.5), P(umax + 1, roofFront, roofY + 0.7), P(umin - 1, roofFront, roofY + 0.7), 0x6b6e72, [0, -1, 0]);
}

export function buildBuildings(world: WorldJSON, track: Track): THREE.Group {
  const group = new THREE.Group();
  group.name = "buildings";
  const cells = new Map<string, Cell>();
  const r = rng(42);
  const c = new THREE.Color();
  for (const b of world.buildings) {
    const pts = b.p;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of pts) {
      cx += x;
      cz += z;
    }
    cx /= pts.length;
    cz /= pts.length;
    const key = `${Math.floor(cx / 1000)},${Math.floor(cz / 1000)}`;
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { pos: [], col: [], uv: [], idx: [] }));
    if (b.k === "g") {
      addStand(cell, pts, b.b, b.h, track, r);
      continue;
    }
    const wall = new THREE.Color(WALL_COLORS[Math.floor(r() * WALL_COLORS.length)]);
    const roofC = new THREE.Color(ROOF_COLORS[Math.floor(r() * ROOF_COLORS.length)]);
    // ensure CCW winding (seen from above with z south)
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      area += x1 * z2 - x2 * z1;
    }
    const ring = area > 0 ? pts.slice().reverse() : pts.slice();
    const y0 = b.b;
    const y1 = b.b + b.h;
    let along = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, z1] = ring[i];
      const [x2, z2] = ring[(i + 1) % ring.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const base = cell.pos.length / 3;
      cell.pos.push(x1, y0, z1, x2, y0, z2, x2, y1, z2, x1, y1, z1);
      const shade = 0.9 + r() * 0.1;
      for (let k = 0; k < 4; k++) {
        c.copy(wall).multiplyScalar(shade);
        cell.col.push(c.r, c.g, c.b);
      }
      cell.uv.push(along / 3, 0, (along + len) / 3, 0, (along + len) / 3, b.h / 3, along / 3, b.h / 3);
      cell.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      along += len;
    }
    // roof
    const isRectish = ring.length <= 6;
    if (b.r === "gable" && isRectish) {
      // oriented box from the longest edge
      let best = 0;
      let bi = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, z1] = ring[i];
        const [x2, z2] = ring[(i + 1) % ring.length];
        const l = Math.hypot(x2 - x1, z2 - z1);
        if (l > best) {
          best = l;
          bi = i;
        }
      }
      const [ax, az] = ring[bi];
      const [bx, bz] = ring[(bi + 1) % ring.length];
      const ux = (bx - ax) / best;
      const uz = (bz - az) / best;
      const vx = -uz;
      const vz = ux;
      let umin = Infinity;
      let umax = -Infinity;
      let vmin = Infinity;
      let vmax = -Infinity;
      for (const [x, z] of ring) {
        const u = (x - cx) * ux + (z - cz) * uz;
        const v = (x - cx) * vx + (z - cz) * vz;
        umin = Math.min(umin, u);
        umax = Math.max(umax, u);
        vmin = Math.min(vmin, v);
        vmax = Math.max(vmax, v);
      }
      const o = 0.45;
      umin -= o;
      umax += o;
      vmin -= o;
      vmax += o;
      const ridgeH = Math.min(6, (vmax - vmin) * 0.42);
      const vm = (vmin + vmax) / 2;
      const P = (u: number, v: number, y: number) => [cx + ux * u + vx * v, y, cz + uz * u + vz * v];
      const eave = y1 - 0.15;
      const A = P(umin, vmin, eave);
      const B = P(umax, vmin, eave);
      const C = P(umax, vm, eave + ridgeH);
      const D = P(umin, vm, eave + ridgeH);
      const E = P(umax, vmax, eave);
      const F = P(umin, vmax, eave);
      const quads = [
        [A, B, C, D],
        [E, F, D, C],
      ];
      for (const q of quads) {
        const base = cell.pos.length / 3;
        for (const p of q) {
          cell.pos.push(p[0], p[1], p[2]);
          cell.col.push(roofC.r, roofC.g, roofC.b);
          cell.uv.push(p[0] / 3, -1);
        }
        cell.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
      // gable ends (wall coloured)
      for (const tri of [
        [A, D, F],
        [B, E, C],
      ]) {
        const base = cell.pos.length / 3;
        for (const p of tri) {
          cell.pos.push(p[0], p[1], p[2]);
          cell.col.push(wall.r, wall.g, wall.b);
          cell.uv.push(0, -1);
        }
        cell.idx.push(base, base + 1, base + 2);
      }
    } else {
      const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const base = cell.pos.length / 3;
      const flat = new THREE.Color(0x5b5f64).lerp(roofC, 0.3);
      for (const [x, z] of ring) {
        cell.pos.push(x, y1, z);
        cell.col.push(flat.r, flat.g, flat.b);
        cell.uv.push(x / 3, -1);
      }
      for (const t of tris) cell.idx.push(base + t[0], base + t[2], base + t[1]);
    }
  }
  const mat = buildingMaterial();
  for (const cell of cells.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(cell.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cell.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(cell.uv, 2));
    g.setIndex(cell.idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  // double sided normals are fine for walls but gable winding varies: render both sides
  mat.side = THREE.DoubleSide;
  return group;
}

/** Public roads draped over the terrain, with bridges where they cross the Nordschleife. */
export function buildPublicRoads(world: WorldJSON, track: Track, hm: Heightmap): THREE.Group {
  const group = new THREE.Group();
  group.name = "public-roads";
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const bridgePos: number[] = [];
  const bridgeIdx: number[] = [];
  const pillars: THREE.Matrix4[] = [];
  const q: TrackQuery = { i: 0, t: 0, s: 0, lat: 0, half: 0, yc: 0, bank: 0 };
  for (const road of world.roads) {
    // subdivide every 6 m
    const pts: { x: number; z: number; y: number; inC: boolean; ty: number }[] = [];
    for (let k = 0; k < road.p.length - 1; k++) {
      const [x1, z1] = road.p[k];
      const [x2, z2] = road.p[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 6));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        pts.push({ x: x1 + (x2 - x1) * t, z: z1 + (z2 - z1) * t, y: 0, inC: false, ty: 0 });
      }
    }
    const last = road.p[road.p.length - 1];
    pts.push({ x: last[0], z: last[1], y: 0, inC: false, ty: 0 });
    let hint = -1;
    for (const p of pts) {
      track.query(p.x, p.z, hint, q);
      hint = q.i;
      p.inC = Math.abs(q.lat) < q.half + track.verge + 9;
      p.ty = q.yc;
      p.y = hm.height(p.x, p.z) + 0.14;
    }
    // bridges: corridor runs with outside points on both ends
    let k = 0;
    const skip = new Uint8Array(pts.length);
    while (k < pts.length) {
      if (!pts[k].inC) {
        k++;
        continue;
      }
      let e = k;
      while (e < pts.length && pts[e].inC) e++;
      // only ways tagged bridge=* are lifted over the circuit; tunnels and untagged
      // service crossings simply stop at the fence
      if (k > 0 && e < pts.length && road.t === 2) {
        const a = Math.max(0, k - 3);
        const b = Math.min(pts.length - 1, e + 2);
        const ya = pts[a].y;
        const yb = pts[b].y;
        let clear = 0;
        for (let j = k; j < e; j++) clear = Math.max(clear, pts[j].ty + 6.0);
        for (let j = a; j <= b; j++) {
          const t = (j - a) / Math.max(1, b - a);
          const lin = ya + (yb - ya) * t;
          const bump = Math.max(0, clear - lin) * Math.sin(Math.PI * t) ** 0.35;
          pts[j].y = Math.max(lin + bump, pts[j].y);
        }
        // bridge deck sides and pillars
        for (let j = k - 1; j < e; j++) {
          const p0 = pts[j];
          const p1 = pts[j + 1];
          const dx = p1.x - p0.x;
          const dz = p1.z - p0.z;
          const l = Math.hypot(dx, dz) || 1;
          const nx = (-dz / l) * (road.w / 2 + 0.4);
          const nz = (dx / l) * (road.w / 2 + 0.4);
          for (const sgn of [-1, 1]) {
            const base = bridgePos.length / 3;
            bridgePos.push(
              p0.x + nx * sgn, p0.y - 1.2, p0.z + nz * sgn,
              p1.x + nx * sgn, p1.y - 1.2, p1.z + nz * sgn,
              p1.x + nx * sgn, p1.y + 0.9, p1.z + nz * sgn,
              p0.x + nx * sgn, p0.y + 0.9, p0.z + nz * sgn,
            );
            bridgeIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
          // underside
          const base = bridgePos.length / 3;
          bridgePos.push(p0.x - nx, p0.y - 1.2, p0.z - nz, p1.x - nx, p1.y - 1.2, p1.z - nz, p1.x + nx, p1.y - 1.2, p1.z + nz, p0.x + nx, p0.y - 1.2, p0.z + nz);
          bridgeIdx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
        for (const j of [k - 1, e]) {
          const p = pts[j];
          const gy = hm.height(p.x, p.z) - 1;
          const h = p.y - 1.2 - gy;
          if (h > 0.5) pillars.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, gy + h / 2, p.z), new THREE.Quaternion(), new THREE.Vector3(road.w * 0.8, h, 1.2)));
        }
      } else {
        for (let j = k; j < e; j++) skip[j] = 1;
      }
      k = e;
    }
    for (let j = 0; j < pts.length - 1; j++) {
      if (skip[j] || skip[j + 1]) continue;
      const p0 = pts[j];
      const p1 = pts[j + 1];
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * (road.w / 2);
      const nz = (dx / l) * (road.w / 2);
      const base = pos.length / 3;
      pos.push(p0.x - nx, p0.y, p0.z - nz, p0.x + nx, p0.y, p0.z + nz, p1.x + nx, p1.y, p1.z + nz, p1.x - nx, p1.y, p1.z - nz);
      uv.push(0, j * 1.5, road.w / 4, j * 1.5, road.w / 4, (j + 1) * 1.5, 0, (j + 1) * 1.5);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const asphalt = new THREE.MeshStandardMaterial({ map: tex(`${BASE}textures/asphalt_clean_albedo.jpg`), color: 0x9a9a9a, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const roads = new THREE.Mesh(g, asphalt);
  roads.receiveShadow = true;
  group.add(roads);
  if (bridgePos.length) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.Float32BufferAttribute(bridgePos, 3));
    bg.setIndex(bridgeIdx);
    bg.computeVertexNormals();
    const concrete = new THREE.MeshStandardMaterial({ color: 0xa8a49a, roughness: 0.85, side: THREE.DoubleSide });
    const bm = new THREE.Mesh(bg, concrete);
    bm.castShadow = true;
    bm.receiveShadow = true;
    group.add(bm);
    const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), concrete, pillars.length);
    pillars.forEach((m, k) => pm.setMatrixAt(k, m));
    pm.castShadow = true;
    pm.computeBoundingSphere();
    group.add(pm);
  }
  return group;
}

/** Crowds, tents and camper vans at the spectator zones. */
export class Crowds {
  readonly group = new THREE.Group();
  private uniforms = { uTime: { value: 0 } };

  constructor(track: Track, hm: Heightmap, zones: { a: number; b: number }[], withCampers = true) {
    const r = rng(1927);
    const person = (() => {
      const body = new THREE.CylinderGeometry(0.2, 0.24, 1.0, 6);
      body.translate(0, 0.95, 0);
      const legs = new THREE.CylinderGeometry(0.17, 0.15, 0.5, 6);
      legs.translate(0, 0.25, 0);
      const head = new THREE.IcosahedronGeometry(0.15, 0);
      head.translate(0, 1.6, 0);
      const parts = [body, legs, head].map((g) => (g.index ? g.toNonIndexed() : g));
      // per-vertex flag in uv.x: 0 shirt (instance colour), 1 skin, 2 trousers
      const flags = [0, 2, 1];
      const pos: number[] = [];
      const nrm: number[] = [];
      const uv: number[] = [];
      parts.forEach((p, k) => {
        p.computeVertexNormals();
        pos.push(...(p.getAttribute("position").array as Float32Array));
        nrm.push(...(p.getAttribute("normal").array as Float32Array));
        for (let i = 0; i < p.getAttribute("position").count; i++) uv.push(flags[k], 0);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      return g;
    })();
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const tents: THREE.Matrix4[] = [];
    const tentCols: THREE.Color[] = [];
    const campers: THREE.Matrix4[] = [];
    const camperCols: THREE.Color[] = [];
    const shirts = [0xd62828, 0x1d3557, 0xf1faee, 0xffb703, 0x2a9d8f, 0x111111, 0x8338ec, 0xfb5607, 0x3a86ff, 0x6c757d, 0xe9c46a];
    const v = new THREE.Vector3();
    for (const z of zones) {
      for (let s = z.a; s < z.b; s += 1.6) {
        const i = track.wrap(Math.floor(s / track.step));
        for (const side of [-1, 1]) {
          for (let row = 0; row < 3; row++) {
            if (r() < 0.35) continue;
            const d = track.half[i] + track.verge + 2.6 + row * 1.5 + r() * 0.8;
            v.set(track.x[i] + track.rx(i) * d * side, 0, track.z[i] + track.rz(i) * d * side);
            v.x += track.tx[i] * (r() - 0.5) * 1.2;
            v.z += track.tz[i] * (r() - 0.5) * 1.2;
            v.y = hm.height(v.x, v.z);
            const face = Math.atan2(-track.rx(i) * side, -track.rz(i) * side) + (r() - 0.5) * 1.2;
            const sc = 0.9 + r() * 0.2;
            mats.push(new THREE.Matrix4().compose(v.clone(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), face), new THREE.Vector3(sc, sc, sc)));
            cols.push(new THREE.Color(shirts[Math.floor(r() * shirts.length)]));
          }
          if (withCampers && r() < 0.12) {
            const d = track.half[i] + track.verge + 10 + r() * 8;
            v.set(track.x[i] + track.rx(i) * d * side, 0, track.z[i] + track.rz(i) * d * side);
            v.y = hm.height(v.x, v.z);
            const camper = r() < 0.45;
            const yaw = Math.atan2(track.tx[i], track.tz[i]) + (r() - 0.5) * 0.6;
            const m = new THREE.Matrix4().compose(v.clone(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
            if (camper) {
              campers.push(m);
              camperCols.push(new THREE.Color([0xf2f0ea, 0xe8e4d8, 0xdfe6ea, 0xf0e6c8][Math.floor(r() * 4)]));
            } else {
              tents.push(m);
              tentCols.push(new THREE.Color(shirts[Math.floor(r() * shirts.length)]));
            }
          }
        }
      }
    }
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vPart;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vPart = uv.x;
float ph = instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 0.9;
transformed.y += max(0.0, sin(uTime * 6.0 + ph)) * 0.08 * step(0.5, transformed.y);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vPart;")
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
if (vPart > 1.5) diffuseColor.rgb = vec3(0.12, 0.14, 0.2);
else if (vPart > 0.5) diffuseColor.rgb = vec3(0.86, 0.68, 0.55);`,
        );
    };
    mat.customProgramCacheKey = () => "crowd-v1";
    const im = new THREE.InstancedMesh(person, mat, mats.length);
    mats.forEach((m, k) => {
      im.setMatrixAt(k, m);
      im.setColorAt(k, cols[k]);
    });
    im.computeBoundingSphere();
    this.group.add(im);
    // dome-ish pyramid tents and camper vans (white body, dark windows, stripe)
    const tentGeo = new THREE.ConeGeometry(1.7, 1.6, 6);
    tentGeo.translate(0, 0.8, 0);
    const camperGeo = (() => {
      const parts: [THREE.BufferGeometry, number][] = [];
      const body = new THREE.BoxGeometry(2.25, 2.4, 6.2);
      body.translate(0, 1.55, 0);
      parts.push([body, 0xffffff]);
      const cab = new THREE.BoxGeometry(2.2, 1.3, 1.0);
      cab.translate(0, 1.0, 3.55);
      parts.push([cab, 0xffffff]);
      const win = new THREE.BoxGeometry(2.28, 0.55, 4.6);
      win.translate(0, 2.0, -0.4);
      parts.push([win, 0x22282f]);
      const ws = new THREE.BoxGeometry(2.0, 0.7, 0.1);
      ws.translate(0, 1.35, 4.06);
      parts.push([ws, 0x22282f]);
      const stripe = new THREE.BoxGeometry(2.27, 0.18, 6.0);
      stripe.translate(0, 1.15, 0);
      parts.push([stripe, 0x9a3b2c]);
      for (const z of [-1.8, 2.6]) {
        for (const x of [-1.0, 1.0]) {
          const w = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 10);
          w.rotateZ(Math.PI / 2);
          w.translate(x, 0.38, z);
          parts.push([w, 0x151515]);
        }
      }
      const pos: number[] = [];
      const nrm: number[] = [];
      const col: number[] = [];
      const c = new THREE.Color();
      for (const [g, hex] of parts) {
        const ng = g.toNonIndexed();
        ng.computeVertexNormals();
        pos.push(...(ng.getAttribute("position").array as Float32Array));
        nrm.push(...(ng.getAttribute("normal").array as Float32Array));
        c.setHex(hex);
        for (let k = 0; k < ng.getAttribute("position").count; k++) col.push(c.r, c.g, c.b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      return g;
    })();
    const addSet = (geo: THREE.BufferGeometry, list: THREE.Matrix4[], colors: THREE.Color[], vertexColors: boolean) => {
      if (!list.length) return;
      const im2 = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors }), list.length);
      list.forEach((m, k) => {
        im2.setMatrixAt(k, m);
        im2.setColorAt(k, colors[k]);
      });
      im2.castShadow = true;
      im2.receiveShadow = true;
      im2.computeBoundingSphere();
      this.group.add(im2);
    };
    addSet(tentGeo, tents, tentCols, false);
    addSet(camperGeo, campers, camperCols, true);
  }

  update(time: number) {
    this.uniforms.uTime.value = time;
  }
}
