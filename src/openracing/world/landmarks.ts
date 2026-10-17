// 陆家嘴地标：东方明珠、金茂、环球金融中心（开瓶器，顶部洞口可以飞过去）、上海中心（扭转塔身）。
import {
  BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Group, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { JINMAO, PEARL, SHC, SWFC, jinmaoTiers, pearlAngles, pearlSmall, shcRadius, shcTwist, swfcHalfZ } from './layout.ts';
import { pearlTexture, windowTexture } from './textures.ts';

/** 按截面环放样：rings[i].pts 为 (x,z) 闭合多边形。uv 以米为单位除以 tile。 */
function loftRings(rings: { y: number; pts: [number, number][] }[], tileW: number, tileH: number, flat: boolean): BufferGeometry {
  const M = rings[0].pts.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  rings.forEach((r) => {
    let acc = 0;
    for (let j = 0; j <= M; j++) {
      const p = r.pts[j % M];
      if (j > 0) {
        const q = r.pts[j - 1];
        acc += Math.hypot(p[0] - q[0], p[1] - q[1]);
      }
      pos.push(p[0], r.y, p[1]);
      uv.push(acc / tileW, r.y / tileH);
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j;
      const b = a + 1;
      const c = a + M + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  let g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  if (flat) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

function capGeometry(pts: [number, number][], y: number): BufferGeometry {
  const pos: number[] = [];
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    pos.push(cx, y, cz, b[0], y, b[1], a[0], y, a[1]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

function between(a: Vector3, b: Vector3, r0: number, r1: number, mat: MeshStandardMaterial): Mesh {
  const len = a.distanceTo(b);
  const m = new Mesh(new CylinderGeometry(r1, r0, len, 10), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

function pearl(): Group {
  const g = new Group();
  const concrete = new MeshStandardMaterial({ color: 0xd2ccc8, roughness: 0.6 });
  const strip = new MeshStandardMaterial({ color: 0xb0bac4, roughness: 0.4, metalness: 0.6 });
  const sphereTex = pearlTexture();
  sphereTex.repeat.set(3, 1);
  const sphereMat = new MeshPhysicalMaterial({
    color: 0xc8326e, roughness: 0.2, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1,
    emissive: new Color(1, 1, 1), emissiveMap: sphereTex, emissiveIntensity: 0.05,
  });
  for (const a of pearlAngles) {
    const cx = PEARL.x + Math.cos(a) * PEARL.colR;
    const cz = PEARL.z + Math.sin(a) * PEARL.colR;
    const col = new Mesh(new CylinderGeometry(2.3, 2.5, PEARL.colH, 14), concrete);
    col.position.set(cx, PEARL.colH / 2, cz);
    g.add(col);
    const s = new Mesh(new CylinderGeometry(0.25, 0.25, PEARL.colH - 10, 4), strip);
    s.position.set(PEARL.x + Math.cos(a) * (PEARL.colR + 2.4), PEARL.colH / 2, PEARL.z + Math.sin(a) * (PEARL.colR + 2.4));
    g.add(s);
    const foot = new Vector3(PEARL.x + Math.cos(a) * PEARL.footR, 0, PEARL.z + Math.sin(a) * PEARL.footR);
    g.add(between(foot, new Vector3(cx, PEARL.legTop, cz), 2.2, 1.6, concrete));
    const base = new Mesh(new SphereGeometry(4, 16, 10), sphereMat);
    base.position.copy(foot).setY(3);
    g.add(base);
  }
  for (const s of [PEARL.lower, PEARL.upper, PEARL.module]) {
    const m = new Mesh(new SphereGeometry(s.r, 40, 24), sphereMat);
    m.position.set(PEARL.x, s.y, PEARL.z);
    g.add(m);
    const ring = new Mesh(new TorusGeometry(s.r * 1.02, 0.35, 6, 48), strip);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(PEARL.x, s.y, PEARL.z);
    g.add(ring);
  }
  for (const s of pearlSmall) {
    const m = new Mesh(new SphereGeometry(s.r, 20, 12), sphereMat);
    m.position.set(PEARL.x + Math.cos(s.a) * 5, s.y, PEARL.z + Math.sin(s.a) * 5);
    g.add(m);
  }
  const spire = new Mesh(new CylinderGeometry(0.3, 1.6, PEARL.top - PEARL.module.y - 4, 10), concrete);
  spire.position.set(PEARL.x, (PEARL.top + PEARL.module.y + 4) / 2, PEARL.z);
  const tip = new Mesh(new SphereGeometry(0.8, 8, 6), new MeshStandardMaterial({ color: 0xcc3333 }));
  tip.position.set(PEARL.x, PEARL.top, PEARL.z);
  g.add(spire, tip);
  return g;
}

function jinmao(): Group {
  const g = new Group();
  const tex = windowTexture(11, 0.55, [255, 196, 110], [255, 230, 180], '#2a2620');
  tex.repeat.set(6, 2);
  const mat = new MeshStandardMaterial({ color: 0xb8b0a0, map: tex, emissiveMap: tex, emissive: new Color(1, 0.85, 0.6), emissiveIntensity: 0.06, metalness: 0.6, roughness: 0.35 });
  const trim = new MeshStandardMaterial({ color: 0x9a927f, metalness: 0.7, roughness: 0.3, emissive: new Color(0.8, 0.55, 0.25), emissiveIntensity: 0.06 });
  const tiers = jinmaoTiers();
  const body: BufferGeometry[] = [];
  const ledges: BufferGeometry[] = [];
  for (const t of tiers) {
    body.push(new CylinderGeometry(t.r * 0.96, t.r, t.h, 8).rotateY(Math.PI / 8).translate(0, t.y + t.h / 2, 0));
    ledges.push(new CylinderGeometry(t.r * 1.06, t.r * 1.06, 0.9, 8).rotateY(Math.PI / 8).translate(0, t.y + t.h, 0));
  }
  const top = tiers[tiers.length - 1];
  const crownY = top.y + top.h;
  const crown = mergeGeometries([
    new CylinderGeometry(6, 8, 6, 8).rotateY(Math.PI / 8).translate(0, crownY + 3, 0),
    new CylinderGeometry(4, 6, 6, 8).rotateY(Math.PI / 8).translate(0, crownY + 9, 0),
    new ConeGeometry(3, 18, 8).translate(0, crownY + 21, 0),
    new CylinderGeometry(0.2, 0.6, 12, 6).translate(0, crownY + 36, 0),
  ]);
  const bodyMesh = new Mesh(mergeGeometries(body), mat);
  const ledgeMesh = new Mesh(mergeGeometries(ledges), trim);
  const crownMesh = new Mesh(crown, trim);
  g.add(bodyMesh, ledgeMesh, crownMesh);
  g.position.set(JINMAO.x, 0, JINMAO.z);
  return g;
}

function swfc(): Group {
  const g = new Group();
  const tex = windowTexture(23, 0.6, [200, 225, 255], [255, 255, 255], '#141a22');
  const mat = new MeshStandardMaterial({ color: 0x9fb3c8, map: tex, emissiveMap: tex, emissive: new Color(0.8, 0.9, 1), emissiveIntensity: 0.06, metalness: 0.7, roughness: 0.2 });
  const c = 1.6;
  const rings: { y: number; pts: [number, number][] }[] = [];
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    const hx = SWFC.hx;
    const hz = swfcHalfZ(t);
    const cc = Math.min(c, hz * 0.4);
    rings.push({
      y: t * SWFC.bodyTop,
      pts: [[hx - cc, hz], [hx, hz - cc], [hx, -hz + cc], [hx - cc, -hz], [-hx + cc, -hz], [-hx, -hz + cc], [-hx, hz - cc], [-hx + cc, hz]],
    });
  }
  const body = new Mesh(loftRings(rings, 24, 32, true), mat);
  g.add(body);
  // 顶部「开瓶器」框架
  const hz = swfcHalfZ(1);
  const fw = SWFC.frameW;
  const fh = SWFC.top - SWFC.bodyTop - SWFC.beamH;
  const frameMat = new MeshStandardMaterial({ color: 0x8fa2b6, metalness: 0.8, roughness: 0.25, emissive: new Color(0.3, 0.4, 0.55), emissiveIntensity: 0.04 });
  const pillarGeo = new CylinderGeometry(1, 1, 1, 4).rotateY(Math.PI / 4);
  for (const s of [-1, 1]) {
    const p = new Mesh(pillarGeo, frameMat);
    p.scale.set(fw / Math.SQRT2 * 1.0, fh, hz * 2 / Math.SQRT2);
    p.position.set(s * (SWFC.hx - fw / 2), SWFC.bodyTop + fh / 2, 0);
    g.add(p);
  }
  const beam = new Mesh(pillarGeo, frameMat);
  beam.scale.set((SWFC.hx * 2) / Math.SQRT2, SWFC.beamH, (hz * 2) / Math.SQRT2);
  beam.position.set(0, SWFC.top - SWFC.beamH / 2, 0);
  g.add(beam);
  // 洞口一圈灯带
  const glow = new MeshStandardMaterial({ color: 0x9fb6cc, metalness: 0.7, roughness: 0.3 });
  const lip = new Mesh(new TorusGeometry(1, 0.06, 4, 4), glow);
  lip.rotation.z = Math.PI / 4;
  lip.scale.set((SWFC.hx - fw) * Math.SQRT2, (fh / 2) * Math.SQRT2, 1);
  lip.position.set(0, SWFC.bodyTop + fh / 2, hz + 0.05);
  const lip2 = lip.clone();
  lip2.position.z = -hz - 0.05;
  g.add(lip, lip2);
  g.position.set(SWFC.x, 0, SWFC.z);
  return g;
}

function shanghaiTower(): Group {
  const g = new Group();
  const tex = windowTexture(37, 0.5, [170, 230, 255], [235, 245, 255], '#0f171d');
  const mat = new MeshPhysicalMaterial({ color: 0x86a6b6, map: tex, emissiveMap: tex, emissive: new Color(0.7, 0.95, 1), emissiveIntensity: 0.06, metalness: 0.55, roughness: 0.15, clearcoat: 0.6 });
  const N = 60;
  const K = 48;
  const rings: { y: number; pts: [number, number][] }[] = [];
  const notch: Vector3[] = [];
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    const R = shcRadius(t);
    const tw = shcTwist(t);
    const pts: [number, number][] = [];
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const r = R * (1 + 0.075 * Math.cos(3 * (th - tw)));
      pts.push([Math.cos(th) * r, Math.sin(th) * r]);
    }
    rings.push({ y: t * SHC.height, pts });
    const thN = tw + Math.PI / 3;
    const rN = R * (1 - 0.075) + 0.2;
    notch.push(new Vector3(Math.cos(thN) * rN, t * SHC.height, Math.sin(thN) * rN));
  }
  g.add(new Mesh(loftRings(rings, 24, 32, false), mat));
  const topR = shcRadius(1) * 0.92;
  const capPts: [number, number][] = rings[K].pts.map(([x, z]) => [x * 0.98, z * 0.98]);
  g.add(new Mesh(capGeometry(capPts, SHC.height), mat));
  // 螺旋灯带（沿凹槽）
  const ribbonPos: number[] = [];
  for (let k = 0; k < notch.length - 1; k++) {
    const a = notch[k];
    const b = notch[k + 1];
    const tA = new Vector3(-a.z, 0, a.x).normalize().multiplyScalar(0.7);
    const tB = new Vector3(-b.z, 0, b.x).normalize().multiplyScalar(0.7);
    const p = [a.clone().sub(tA), a.clone().add(tA), b.clone().add(tB), b.clone().sub(tB)];
    ribbonPos.push(...p[0].toArray(), ...p[1].toArray(), ...p[2].toArray(), ...p[0].toArray(), ...p[2].toArray(), ...p[3].toArray());
  }
  const rib = new BufferGeometry();
  rib.setAttribute('position', new BufferAttribute(new Float32Array(ribbonPos), 3));
  g.add(new Mesh(rib, new MeshStandardMaterial({ color: 0xa8c4d0, metalness: 0.6, roughness: 0.3, side: 2 })));
  // 塔冠
  const crownMat = new MeshStandardMaterial({ color: 0xb8c8d4, metalness: 0.7, roughness: 0.3 });
  for (let i = 0; i < 3; i++) {
    const ring = new Mesh(new TorusGeometry(topR * (1 - i * 0.08), 0.3, 6, 40), crownMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = SHC.height + 3 + i * 5.5;
    g.add(ring);
  }
  g.position.set(SHC.x, 0, SHC.z);
  return g;
}

export function buildLandmarks(): Group {
  const g = new Group();
  g.add(pearl(), jinmao(), swfc(), shanghaiTower());
  g.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    o.castShadow = o.receiveShadow = true;
  });
  g.updateMatrixWorld(true);
  return g;
}
