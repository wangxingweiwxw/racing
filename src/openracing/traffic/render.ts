// 车流 / 行人 / 红绿灯的渲染。全部用 InstancedMesh：每种车型 4 次绘制、行人 4 次、红绿灯 2 次。
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DynamicDrawUsage, Group,
  InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, Quaternion, Vector3,
} from 'three';
import type { Camera } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { radialTexture } from '../world/textures.ts';
import { LANE_OFFSETS, lightFor } from './network.ts';
import type { Network } from './network.ts';
import { CAR_TYPES } from './traffic.ts';
import type { CarType, Traffic } from './traffic.ts';

const DRAW_CARS = 420; // 米

/** 夜景下让实例颜色自带一点亮度（没有实时光照也看得清） */
export function nightLit(m: MeshStandardMaterial, k: number): MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ${k.toFixed(2)};`);
  };
  return m;
}

export function colored(g: BufferGeometry, c: number | [number, number, number]): BufferGeometry {
  const n = g.attributes.position.count;
  const rgb = typeof c === 'number' ? [c, c, c] : c;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(rgb, i * 3);
  g.setAttribute('color', new BufferAttribute(arr, 3));
  return g;
}

export function carGeometry(t: CarType): { body: BufferGeometry; head: BufferGeometry; tail: BufferGeometry } {
  const L = t.len;
  const W = t.wid;
  const H = t.hgt;
  const parts: BufferGeometry[] = [];
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, c: number) => parts.push(colored(new BoxGeometry(w, h, l).translate(x, y, z), c));
  const clear = 0.32;
  if (t.name === 'bus') {
    box(W, H - clear, L, 0, clear + (H - clear) / 2, 0, 1);
    box(W + 0.02, 1.0, L - 1.2, 0, H - 1.1, -0.2, 0.06); // 车窗带
    box(W + 0.03, 0.18, L + 0.02, 0, clear + 0.55, 0, 0.92);
  } else if (t.name === 'van') {
    box(W, H - clear, L, 0, clear + (H - clear) / 2, 0, 1);
    box(W + 0.02, 0.7, 1.2, 0, H - 0.55, L / 2 - 0.7, 0.06);
  } else {
    const lowH = H * 0.46;
    box(W, lowH, L, 0, clear + lowH / 2, 0, 1);
    const cabL = L * (t.name === 'suv' ? 0.62 : 0.5);
    const cabH = H - clear - lowH;
    box(W * 0.86, cabH, cabL, 0, clear + lowH + cabH / 2, t.name === 'suv' ? -0.3 : -0.15, 0.07);
    box(W * 0.84, 0.06, cabL * 0.92, 0, H - 0.02, t.name === 'suv' ? -0.3 : -0.15, 1); // 车顶
    if (t.name === 'taxi') box(0.7, 0.22, 0.3, 0, H + 0.1, -0.15, 1.4);
  }
  const wr = t.name === 'bus' ? 0.5 : 0.34;
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    parts.push(colored(new CylinderGeometry(wr, wr, 0.28, 10).rotateZ(Math.PI / 2).translate(x * (W / 2 - 0.12), wr, z * (L / 2 - (t.name === 'bus' ? 2.2 : 0.85))), 0.05));
  }
  const lights = (z: number, y: number, w: number) =>
    mergeGeometries([-1, 1].map((s) => new BoxGeometry(w, 0.12, 0.05).translate(s * (W / 2 - w / 2 - 0.08), y, z)));
  const ly = t.name === 'bus' ? 0.9 : clear + H * 0.3;
  return { body: mergeGeometries(parts), head: lights(L / 2 + 0.02, ly, 0.36), tail: lights(-L / 2 - 0.02, ly + 0.05, 0.42) };
}

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3(1, 1, 1);
const _c = new Color();
const _o = new Object3D();
const UP = new Vector3(0, 1, 0);

export class TrafficView {
  readonly group = new Group();
  private readonly bodies: InstancedMesh[] = [];
  private readonly heads: InstancedMesh[] = [];
  private readonly tails: InstancedMesh[] = [];
  private readonly pools: InstancedMesh;
  private readonly traffic: Traffic;

  constructor(traffic: Traffic) {
    this.traffic = traffic;
    const counts = CAR_TYPES.map((_, i) => traffic.cars.filter((c) => c.type === i).length);
    const bodyMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.25, envMapIntensity: 1.0 });
    const headMat = new MeshBasicMaterial({ color: new Color(1.6, 1.6, 1.5) });
    const tailMat = new MeshBasicMaterial({ color: new Color(0.75, 0.04, 0.03) });
    CAR_TYPES.forEach((t, i) => {
      const g = carGeometry(t);
      const n = Math.max(1, counts[i]);
      const b = new InstancedMesh(g.body, bodyMat, n);
      const h = new InstancedMesh(g.head, headMat, n);
      const tl = new InstancedMesh(g.tail, tailMat, n);
      for (const m of [b, h, tl]) {
        m.instanceMatrix.setUsage(DynamicDrawUsage);
        m.frustumCulled = false;
        this.group.add(m);
      }
      b.castShadow = b.receiveShadow = true;
      this.bodies.push(b);
      this.heads.push(h);
      this.tails.push(tl);
    });
    // 车头灯照在路面上的光斑
    this.pools = new InstancedMesh(
      new PlaneGeometry(4.2, 11).rotateX(-Math.PI / 2).translate(0, 0.06, 7.5),
      new MeshBasicMaterial({ map: radialTexture('rgba(255,236,200,1)', 'rgba(255,220,170,0)'), transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false }),
      traffic.cars.length,
    );
    this.pools.instanceMatrix.setUsage(DynamicDrawUsage);
    this.pools.frustumCulled = false;
    this.group.add(this.pools);
    // 每辆车的颜色固定
    const idx = CAR_TYPES.map(() => 0);
    for (const c of traffic.cars) {
      const k = idx[c.type]++;
      this.bodies[c.type].setColorAt(k, _c.setHex(c.color));
      this.tails[c.type].setColorAt(k, _c.setRGB(1, 1, 1));
    }
    for (const m of [...this.bodies, ...this.tails]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  update(camera: Camera): void {
    const idx = CAR_TYPES.map(() => 0);
    let pools = 0;
    const cp = camera.position;
    for (const c of this.traffic.cars) {
      const k = idx[c.type]++;
      const far = Math.hypot(c.x - cp.x, c.z - cp.z) > DRAW_CARS;
      _q.setFromAxisAngle(UP, c.yaw);
      _m.compose(_v.set(c.x, 0, c.z), _q, far ? _v.clone().set(0, 0, 0) : _s);
      this.bodies[c.type].setMatrixAt(k, _m);
      this.heads[c.type].setMatrixAt(k, _m);
      this.tails[c.type].setMatrixAt(k, _m);
      this.tails[c.type].setColorAt(k, c.brake ? _c.setRGB(3.2, 3.2, 3.2) : _c.setRGB(1, 1, 1));
      if (!far && c.state === 'drive' && Math.hypot(c.x - cp.x, c.z - cp.z) < 200) this.pools.setMatrixAt(pools++, _m);
    }
    for (let i = 0; i < CAR_TYPES.length; i++) {
      this.bodies[i].instanceMatrix.needsUpdate = true;
      this.heads[i].instanceMatrix.needsUpdate = true;
      this.tails[i].instanceMatrix.needsUpdate = true;
      if (this.tails[i].instanceColor) this.tails[i].instanceColor!.needsUpdate = true;
    }
    this.pools.count = 0; // 白天不画车灯光斑
    void pools;
    this.pools.instanceMatrix.needsUpdate = true;
  }
}

/** 红绿灯：每个有信号的路口、每个进口方向一组，灯头颜色随相位更新 */
export class SignalView {
  readonly group = new Group();
  private readonly lamps: InstancedMesh;
  private readonly heads: { node: number; axis: 'x' | 'z' }[] = [];
  private readonly net: Network;
  private acc = 1;

  constructor(net: Network) {
    this.net = net;
    const poles: Matrix4[] = [];
    const lampM: Matrix4[] = [];
    for (const n of net.nodes) {
      if (!n.signal) continue;
      // 四个进口方向：车从 -d 方向驶来，灯装在路口对面右侧
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const axis: 'x' | 'z' = dx !== 0 ? 'x' : 'z';
        const half = axis === 'x' ? n.halfX : n.halfZ;
        const side = axis === 'x' ? n.halfZ : n.halfX;
        const rx = -dz;
        const rz = dx;
        const x = n.x + dx * (half + 1.2) + rx * (side + 0.8);
        const z = n.z + dz * (half + 1.2) + rz * (side + 0.8);
        _o.position.set(x, 0, z);
        _o.rotation.set(0, Math.atan2(-dx, -dz), 0);
        _o.scale.set(1, 1, 1);
        _o.updateMatrix();
        poles.push(_o.matrix.clone());
        _o.position.set(x - rx * (LANE_OFFSETS[1] + 0.5), 5.6, z - rz * (LANE_OFFSETS[1] + 0.5));
        _o.updateMatrix();
        lampM.push(_o.matrix.clone());
        this.heads.push({ node: n.id, axis });
      }
    }
    const poleGeo = mergeGeometries([
      new CylinderGeometry(0.1, 0.13, 6, 6).translate(0, 3, 0),
      new BoxGeometry(0.12, 0.12, LANE_OFFSETS[1] + 1).rotateY(Math.PI / 2).translate(-(LANE_OFFSETS[1] + 0.5) / 2, 5.9, 0),
    ]);
    const poleMesh = new InstancedMesh(poleGeo, new MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 }), poles.length);
    poles.forEach((m, i) => poleMesh.setMatrixAt(i, m));
    poleMesh.computeBoundingSphere();
    const housing = new InstancedMesh(new BoxGeometry(0.42, 1.15, 0.3), new MeshStandardMaterial({ color: 0x111215, roughness: 0.6 }), lampM.length);
    lampM.forEach((m, i) => housing.setMatrixAt(i, m));
    housing.computeBoundingSphere();
    this.lamps = new InstancedMesh(new BoxGeometry(0.3, 0.3, 0.05).translate(0, 0, 0.17), new MeshBasicMaterial({ color: 0xffffff }), lampM.length);
    lampM.forEach((m, i) => this.lamps.setMatrixAt(i, m));
    this.lamps.computeBoundingSphere();
    this.group.add(poleMesh, housing, this.lamps);
  }

  update(dt: number, time: number): void {
    this.acc += dt;
    if (this.acc < 0.2) return;
    this.acc = 0;
    this.heads.forEach((h, i) => {
      const l = lightFor(this.net.nodes[h.node], h.axis, time);
      this.lamps.setColorAt(i, l === 'green' ? _c.setRGB(0.2, 3.5, 1.2) : l === 'yellow' ? _c.setRGB(3.5, 2.4, 0.2) : _c.setRGB(3.8, 0.25, 0.2));
    });
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}
