// 车流 / 行人 / 红绿灯的渲染。每种车型用 4 个近景实例批次和 1 个远景简模批次。
import {
  AdditiveBlending, BoxGeometry, Color, CylinderGeometry, DynamicDrawUsage, Group,
  InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, Quaternion, Vector3,
} from 'three';
import type { Camera } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { radialTexture } from '../world/textures.ts';
import { LANE_OFFSETS, lightFor } from './network.ts';
import type { Network } from './network.ts';
import { CAR_TYPES } from './traffic.ts';
import type { Traffic } from './traffic.ts';

const DRAW_CARS = 420; // 米

export { carGeometry } from './carGeometry.ts';
import { carGeometry, carLodGeometry } from './carGeometry.ts';

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
  private readonly distant: InstancedMesh[] = [];
  private readonly details: InstancedMesh[] = [];
  private readonly heads: InstancedMesh[] = [];
  private readonly tails: InstancedMesh[] = [];
  private readonly pools: InstancedMesh;
  private readonly traffic: Traffic;

  constructor(traffic: Traffic) {
    this.traffic = traffic;
    const counts = CAR_TYPES.map((_, i) => traffic.cars.filter((c) => c.type === i).length);
    const bodyMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.25, envMapIntensity: 1.0 });
    const detailMat = new MeshStandardMaterial({vertexColors:true,roughness:.4,metalness:.35});
    const headMat = new MeshBasicMaterial({ color: new Color(1.6, 1.6, 1.5) });
    const tailMat = new MeshBasicMaterial({ color: new Color(0.75, 0.04, 0.03) });
    CAR_TYPES.forEach((t, i) => {
      const g = carGeometry(t);
      const n = Math.max(1, counts[i]);
      const b = new InstancedMesh(g.body, bodyMat, n);
      const lod = new InstancedMesh(carLodGeometry(t),bodyMat,n);
      lod.name = `NPC ${t.name} distant`;
      this.distant.push(lod);
      const detail = new InstancedMesh(g.detail,detailMat,n);
      detail.name = `NPC ${t.name} windows wheels trim`;
      b.name = `NPC ${t.name} paint`;
      const h = new InstancedMesh(g.head, headMat, n);
      const tl = new InstancedMesh(g.tail, tailMat, n);
      for (const m of [b, detail, h, tl, lod]) {
        m.instanceMatrix.setUsage(DynamicDrawUsage);
        m.frustumCulled = false;
        this.group.add(m);
      }
      b.castShadow = b.receiveShadow = true;
      detail.castShadow = detail.receiveShadow = true;
      this.details.push(detail);
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
      this.distant[c.type].setColorAt(k,_c);
      this.tails[c.type].setColorAt(k, _c.setRGB(1, 1, 1));
    }
    for (const m of [...this.bodies, ...this.tails]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  update(camera: Camera): void {
    const near = CAR_TYPES.map(() => 0), far = CAR_TYPES.map(() => 0);
    const cp = camera.position;
    for (const c of this.traffic.cars) {
      const distance = Math.hypot(c.x-cp.x,c.z-cp.z);
      if(distance>DRAW_CARS)continue;
      _q.setFromAxisAngle(UP,c.yaw);_m.compose(_v.set(c.x,0,c.z),_q,_s);
      if(distance>95){
        const k=far[c.type]++;this.distant[c.type].setMatrixAt(k,_m);this.distant[c.type].setColorAt(k,_c.setHex(c.color));
        continue;
      }
      const k=near[c.type]++;
      this.bodies[c.type].setMatrixAt(k,_m);this.bodies[c.type].setColorAt(k,_c.setHex(c.color));
      this.details[c.type].setMatrixAt(k,_m);this.heads[c.type].setMatrixAt(k,_m);this.tails[c.type].setMatrixAt(k,_m);
      this.tails[c.type].setColorAt(k,c.brake?_c.setRGB(3.2,3.2,3.2):_c.setRGB(1,1,1));
    }
    for(let i=0;i<CAR_TYPES.length;i++){
      for(const m of [this.bodies[i],this.details[i],this.heads[i],this.tails[i],this.distant[i]]){
        m.count=m===this.distant[i]?far[i]:near[i];m.instanceMatrix.needsUpdate=true;
        if(m.instanceColor)m.instanceColor.needsUpdate=true;
      }
    }
    this.pools.count = 0; // 白天不画车灯光斑
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
