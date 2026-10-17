// 城市渲染：地面、道路标线、建筑（单个 InstancedMesh，立面窗格由着色器按世界坐标生成）、
// 外滩屋顶、梧桐、路灯、霓虹招牌、黄浦江水面、夜空。
import {
  AdditiveBlending, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry,
  CylinderGeometry, DoubleSide, Group, InstancedBufferAttribute,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  Quaternion, ShaderMaterial, SphereGeometry, UniformsLib, UniformsUtils, Vector3,
} from 'three';
import type { CubeTexture, Texture } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOUNDS, BUND, PUDONG_PROM_X1, RIVER, RIVER_CROSSINGS, mulberry32 } from './layout.ts';
import type { Building, Layout, Street } from './layout.ts';
import { asphaltTexture, paverTexture, radialTexture, signAtlas, wetRoughnessTexture } from './textures.ts';

import { streetDetails } from './streetDetails.ts';

// ---------- 建筑立面材质 ----------
const STYLE_PARAMS: [number, number, number][] = [
  // 层高, 窗间距, 亮窗比例
  [4.2, 3.6, 0.5],
  [3.2, 2.6, 0.28],
  [2.9, 3.0, 0.34],
  [3.6, 2.4, 0.4],
  [4.0, 2.0, 0.5],
];
// 白天配色：外滩花岗岩、石库门青砖、老公房白瓷砖、商业楼米灰、陆家嘴蓝灰玻璃
const STYLE_COLORS: [number, number, number][][] = [
  [[0.78, 0.71, 0.6], [0.74, 0.68, 0.58], [0.82, 0.76, 0.66]],
  [[0.52, 0.5, 0.48], [0.56, 0.52, 0.48], [0.48, 0.47, 0.47]],
  [[0.86, 0.85, 0.82], [0.82, 0.76, 0.68], [0.76, 0.8, 0.82]],
  [[0.7, 0.69, 0.68], [0.76, 0.71, 0.63], [0.62, 0.65, 0.69]],
  [[0.36, 0.46, 0.56], [0.3, 0.4, 0.52], [0.4, 0.5, 0.54]],
];

export function facadeMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aStyle; attribute vec3 aBase; attribute float aSeed;
varying vec3 vWPos; varying vec3 vWNorm; flat varying vec4 vStyle; flat varying vec3 vBase; flat varying float vSeed; varying float vTopDist;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
mat4 _im = mat4(1.0);
#ifdef USE_INSTANCING
_im = instanceMatrix;
#endif
vec4 _wp = modelMatrix * _im * vec4(transformed, 1.0);
vWPos = _wp.xyz;
vWNorm = normalize(mat3(modelMatrix) * mat3(_im) * objectNormal);
vStyle = aStyle; vBase = aBase; vSeed = aSeed;
vTopDist = (1.0 - position.y) * length(_im[1].xyz);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos; varying vec3 vWNorm; flat varying vec4 vStyle; flat varying vec3 vBase; flat varying float vSeed; varying float vTopDist;
float hh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 fN = normalize(vWNorm);
float isSide = 1.0 - step(0.6, abs(fN.y));
vec2 fT = normalize(vec2(-fN.z, fN.x) + vec2(1e-4));
float fU = dot(vWPos.xz, fT);
float fV = vWPos.y;
float sid = vStyle.w;
float fh = vStyle.x; float sp = vStyle.y; float litR = vStyle.z;
vec2 cellId = vec2(floor(fU / sp), floor(fV / fh));
vec2 fr = vec2(fract(fU / sp), fract(fV / fh));
float ww = sid < 0.5 ? 0.42 : (sid < 1.5 ? 0.38 : (sid < 2.5 ? 0.55 : (sid < 3.5 ? 0.78 : 0.9)));
float wh = sid < 0.5 ? 0.58 : (sid < 1.5 ? 0.45 : (sid < 2.5 ? 0.5 : (sid < 3.5 ? 0.7 : 0.86)));
float win = isSide * step(abs(fr.x - 0.5), ww * 0.5) * step(abs(fr.y - 0.52), wh * 0.5);
// 远处窗格小于一个像素时，淡化成平均值，避免摩尔纹闪烁
float fAA = clamp(max(fwidth(fU / sp), fwidth(fV / fh)) * 2.0 - 1.0, 0.0, 1.0);
float shopBand = isSide * step(fV, fh * 1.15) * step(0.5, sid) * step(sid, 3.5);
win *= 1.0 - shopBand;
float rnd = hh(cellId + vec2(vSeed * 13.1, vSeed * 7.7) + fT * 31.0);
float lit = step(1.0 - litR, rnd);
vec3 wall = vBase;
// Subtle recessed window surrounds and stone floor bands add depth at street level.
float frame = isSide * step(abs(fr.x-.5),ww*.5+.035) * step(abs(fr.y-.52),wh*.5+.025);
wall *= mix(1.0,.67,frame);
float ledge = isSide * (1.0-smoothstep(.015,.04,fr.y));
wall = mix(wall, vBase*1.13,ledge);
if (sid > 0.5 && sid < 1.5) wall = mix(wall, vec3(0.42, 0.15, 0.11), step(0.82, fract(fV / 1.1)));
// 白天窗玻璃：偏冷的深色，个别窗拉了窗帘（偏亮）
vec3 glass = sid > 2.5 ? vec3(0.12, 0.2, 0.28) : mix(vec3(0.1, 0.13, 0.17), vec3(0.55, 0.5, 0.42), step(0.82, rnd));
diffuseColor.rgb = mix(mix(wall, glass, win), mix(wall, glass, ww * wh) * 0.7, fAA);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.17, 0.19), shopBand);
if (isSide < 0.5) diffuseColor.rgb = vBase * 0.62;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.06, win);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.55, win);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// 白天：只有底商招牌是彩色的（不发光）
float hs = hh(vec2(floor(fU / 7.0), vSeed * 3.0));
vec3 sign = 0.5 + 0.5 * cos(6.2831 * (hs + vec3(0.0, 0.33, 0.67)));
float box = step(abs(fract(fU / 7.0) - 0.5), 0.42) * step(abs(fr.y - 0.55), 0.3) * step(fV, fh);
diffuseColor.rgb = mix(diffuseColor.rgb, sign * 0.8, shopBand * box * step(0.3, hs));
vec3 em = vec3(0.0);
totalEmissiveRadiance += em;`,
      );
  };
  return m;
}

function buildingsMesh(list: Building[]): InstancedMesh {
  const geo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const n = list.length;
  const aStyle = new Float32Array(n * 4);
  const aBase = new Float32Array(n * 3);
  const aSeed = new Float32Array(n);
  const mesh = new InstancedMesh(geo, facadeMaterial(), n);
  const m = new Matrix4();
  const q = new Quaternion();
  list.forEach((b, i) => {
    m.compose(new Vector3(b.x, 0, b.z), q, new Vector3(b.w, b.h, b.d));
    mesh.setMatrixAt(i, m);
    const p = STYLE_PARAMS[b.style];
    aStyle.set([p[0], p[1], p[2], b.style], i * 4);
    const cs = STYLE_COLORS[b.style];
    aBase.set(cs[Math.floor(b.seed * cs.length) % cs.length], i * 3);
    aSeed[i] = b.seed;
  });
  geo.setAttribute('aStyle', new InstancedBufferAttribute(aStyle, 4));
  geo.setAttribute('aBase', new InstancedBufferAttribute(aBase, 3));
  geo.setAttribute('aSeed', new InstancedBufferAttribute(aSeed, 1));
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------- 小工具 ----------
function quadsGeometry(quads: { x: number; z: number; sx: number; sz: number; y: number; c: Color }[]): BufferGeometry {
  const pos = new Float32Array(quads.length * 18);
  const col = new Float32Array(quads.length * 18);
  quads.forEach((q, i) => {
    const x0 = q.x - q.sx / 2;
    const x1 = q.x + q.sx / 2;
    const z0 = q.z - q.sz / 2;
    const z1 = q.z + q.sz / 2;
    pos.set([x0, q.y, z0, x0, q.y, z1, x1, q.y, z1, x0, q.y, z0, x1, q.y, z1, x1, q.y, z0], i * 18);
    for (let k = 0; k < 6; k++) col.set([q.c.r, q.c.g, q.c.b], i * 18 + k * 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(quads.length * 18).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

function instanced(geo: BufferGeometry, mat: MeshStandardMaterial | MeshBasicMaterial, matrices: Matrix4[]): InstancedMesh {
  const mesh = new InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.computeBoundingSphere();
  return mesh;
}

const _o = new Object3D();
function mat4(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  _o.position.set(x, y, z);
  _o.rotation.set(0, ry, 0);
  _o.scale.set(sx, sy, sz);
  _o.updateMatrix();
  return _o.matrix.clone();
}

// ---------- 道路标线 ----------
function markings(layout: Layout): Mesh {
  const W = new Color(0.85, 0.85, 0.82);
  const Y = new Color(0.95, 0.72, 0.15);
  const quads: { x: number; z: number; sx: number; sz: number; y: number; c: Color }[] = [];
  const crosses = (s: Street) =>
    layout.streets.filter((o) => o.axis !== s.axis && o.from <= s.at && o.to >= s.at && o.at >= s.from && o.at <= s.to);
  const add = (s: Street, along: number, across: number, la: number, lc: number, c: Color) => {
    if (s.axis === 'x') quads.push({ x: along, z: s.at + across, sx: la, sz: lc, y: 0.04, c });
    else quads.push({ x: s.at + across, z: along, sx: lc, sz: la, y: 0.04, c });
  };
  for (const s of layout.streets) {
    const xs = crosses(s);
    const blocked = (t: number) => xs.some((o) => Math.abs(t - o.at) < o.width / 2 + 5);
    // 每个方向两条车道（车道中心距中线 2 m / 6 m）：±4 m 白虚线；宽路在 ±8.3 m 画实线，外侧是辅路/停车带
    const ped = s.name === '南京东路' && s.from < 0;
    const edge = s.width > 18 && !ped;
    for (let t = s.from; t < s.to; t += 3) {
      if (blocked(t)) continue;
      if (ped) continue;
      add(s, t + 1.5, -0.2, 3, 0.14, Y);
      add(s, t + 1.5, 0.2, 3, 0.14, Y);
      if (Math.floor(t / 3) % 3 === 0) for (const l of [-4, 4]) add(s, t + 1.5, l, 3, 0.14, W);
      if (edge) for (const l of [-8.3, 8.3]) add(s, t + 1.5, l, 3, 0.16, W);
    }
    // 斑马线
    for (const o of xs) {
      for (const sgn of [-1, 1]) {
        const t = o.at + sgn * (o.width / 2 + 2.5);
        if (t < s.from || t > s.to) continue;
        for (let k = -s.width / 2 + 1; k < s.width / 2 - 0.5; k += 1.1) add(s, t, k + 0.3, 3.6, 0.55, W);
      }
    }
  }
  const mesh = new Mesh(quadsGeometry(quads), new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ---------- 天空、水面 ----------
function sky(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {},
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main(){
  float y = vDir.y;
  // 晴天：天顶深蓝 → 地平线发白的薄霾，太阳方向一圈暖光
  vec3 zen = vec3(0.16, 0.36, 0.78);
  vec3 mid = vec3(0.42, 0.62, 0.9);
  vec3 hor = vec3(0.82, 0.88, 0.94);
  vec3 c = mix(hor, mid, smoothstep(-0.02, 0.2, y));
  c = mix(c, zen, smoothstep(0.2, 0.85, y));
  vec3 sunDir = normalize(vec3(-0.45, 0.62, 0.42));
  float sd = max(dot(normalize(vDir), sunDir), 0.0);
  c += vec3(1.0, 0.92, 0.75) * (pow(sd, 400.0) * 6.0 + pow(sd, 12.0) * 0.25);
  // 淡淡的高空薄云（平滑的低频条纹，不用方块噪声）
  float cl = 0.5 + 0.5 * sin(vDir.x * 7.0 + sin(vDir.z * 5.0) * 1.5) * sin(vDir.z * 6.0 + vDir.x * 2.0);
  c = mix(c, vec3(0.96, 0.97, 1.0), smoothstep(0.62, 0.95, cl) * smoothstep(0.1, 0.35, y) * smoothstep(0.85, 0.5, y) * 0.28);
  gl_FragColor = vec4(c, 1.0);
}`,
  });
  const m = new Mesh(new SphereGeometry(5000, 32, 16), mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

export function waterMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    fog: true,
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 }, uEnv: { value: null }, uHasEnv: { value: 0 } }]),
    vertexShader: `varying vec3 vW;
#include <fog_pars_vertex>
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
    fragmentShader: `uniform float uTime; uniform samplerCube uEnv; uniform float uHasEnv; varying vec3 vW;
#include <fog_pars_fragment>
void main(){
  vec2 p = vW.xz;
  float t = uTime;
  vec3 n = vec3(0.0, 1.0, 0.0);
  float fade = 1.0 / (1.0 + length(vW - cameraPosition) * 0.004);
  n.x += (0.025 * sin(p.x * 0.11 + t * 0.9) + 0.015 * sin(p.x * 0.37 - p.y * 0.23 + t * 1.7)) * fade + 0.008 * sin(p.x * 1.3 + t * 3.1) * fade * fade;
  n.z += (0.04 * sin(p.y * 0.08 - t * 0.7) + 0.02 * sin(p.y * 0.41 + p.x * 0.17 + t * 1.3)) * fade + 0.01 * sin(p.y * 1.7 - t * 2.6) * fade * fade;
  n = normalize(n);
  vec3 v = normalize(vW - cameraPosition);
  vec3 r = reflect(v, n);
  r.y = abs(r.y);
  vec3 env = uHasEnv > 0.5 ? textureCube(uEnv, r).rgb : vec3(0.05, 0.05, 0.1);
  float f = 0.04 + 0.96 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
  vec3 deep = vec3(0.12, 0.16, 0.15);
  gl_FragColor = vec4(mix(deep, env, clamp(f * 1.4 + 0.12, 0.0, 1.0)), 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
}`,
  });
}

// ---------- 主入口 ----------
export interface City {
  group: Group;
  water: Mesh<PlaneGeometry, ShaderMaterial>;
  setEnv(cube: CubeTexture | Texture): void;
  update(t: number): void;
}

export function buildCity(layout: Layout): City {
  const group = new Group();
  const rng = mulberry32(7);
  const { x0: BX0, x1: BX1, z0: BZ0, z1: BZ1 } = BOUNDS;

  // 地面：湿沥青
  const rough = wetRoughnessTexture(3);
  rough.repeat.set(60, 90);
  const roadGrain = asphaltTexture(); roadGrain.repeat.set(100,160);
  const asphalt = new MeshStandardMaterial({ map:roadGrain, color: 0x858c94, roughness: 1, roughnessMap: rough, metalness: 0.0, envMapIntensity: 0.35 });
  const puxi = new Mesh(new PlaneGeometry(RIVER.x0 - BX0, BZ1 - BZ0).rotateX(-Math.PI / 2), asphalt);
  puxi.position.set((BX0 + RIVER.x0) / 2, 0, 0);
  const pudong = new Mesh(new PlaneGeometry(BX1 - RIVER.x1, BZ1 - BZ0).rotateX(-Math.PI / 2), asphalt);
  pudong.position.set((BX1 + RIVER.x1) / 2, 0, 0);
  group.add(puxi, pudong);

  // 人行道（街区地面）
  const pav = paverTexture();
  const paveMat = new MeshStandardMaterial({ map: pav, color: 0xd8d4cc, roughness: 0.9, envMapIntensity: 0.3 });
  const blockGeos = layout.blocks.map((b) => {
    const g = new PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0).rotateX(-Math.PI / 2).translate((b.x0 + b.x1) / 2, 0.03, (b.z0 + b.z1) / 2);
    const uv = g.attributes.uv as BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (b.x1 - b.x0) / 4, uv.getY(i) * (b.z1 - b.z0) / 4);
    return g;
  });
  const bundWalk = new PlaneGeometry(BUND.roadX0 - BUND.bldX1, BZ1 - BZ0).rotateX(-Math.PI / 2).translate((BUND.roadX0 + BUND.bldX1) / 2, 0.03, 0);
  const nanjing = new PlaneGeometry(BUND.bldX0 - BX0, 24).rotateX(-Math.PI / 2).translate((BX0 + BUND.bldX0) / 2, 0.025, 0);
  {
    const uv = nanjing.attributes.uv as BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (BUND.bldX0 - BX0)) / 3, (uv.getY(i) * 24) / 3);
  }
  group.add(new Mesh(mergeGeometries([...blockGeos, bundWalk, nanjing]), paveMat));

  // 浦东滨江绿地
  const green = new Mesh(new PlaneGeometry(PUDONG_PROM_X1 - RIVER.x1, BZ1 - BZ0).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: 0x5f8a4a, roughness: 0.95 }));
  green.position.set((RIVER.x1 + PUDONG_PROM_X1) / 2, 0.02, 0);
  group.add(green);

  group.add(markings(layout));
  group.add(streetDetails(layout));

  // 外滩亲水平台 + 防汛墙 + 栏杆
  const stone = new MeshStandardMaterial({ color: 0xb6b0a6, roughness: 0.8, envMapIntensity: 0.4 });
  const promLen = BZ1 - BZ0 - 100;
  const prom = new Mesh(new BoxGeometry(BUND.promX1 - BUND.promX0, BUND.promY, promLen), stone);
  prom.position.set((BUND.promX0 + BUND.promX1) / 2, BUND.promY / 2, 0);
  group.add(prom);
  const embank = new MeshStandardMaterial({ color: 0x8a857c, roughness: 0.9 });
  const wallW = new Mesh(new PlaneGeometry(BZ1 - BZ0, 14), embank);
  wallW.rotation.y = Math.PI / 2;
  wallW.position.set(RIVER.x0, -5, 0);
  const wallE = new Mesh(new PlaneGeometry(BZ1 - BZ0, 12), embank);
  wallE.rotation.y = -Math.PI / 2;
  wallE.position.set(RIVER.x1, -6, 0);
  group.add(wallW, wallE);
  const posts: Matrix4[] = [];
  for (let z = -promLen / 2; z < promLen / 2; z += 2.5) if(!RIVER_CROSSINGS.some(lane=>Math.abs(z-lane)<12))posts.push(mat4(-0.5, BUND.promY + 0.55, z));
  group.add(instanced(new BoxGeometry(0.18, 1.1, 0.18), stone, posts));
  let railStart=-promLen/2;
  for(const end of [...RIVER_CROSSINGS.map(z=>z-12),promLen/2]){
    const rail=new Mesh(new BoxGeometry(.3,.12,end-railStart),stone);
    rail.position.set(-.5,BUND.promY+1.12,(railStart+end)/2);group.add(rail);railStart=end+24;
  }

  const guide=new MeshBasicMaterial({color:0x5ff1db});
  const boardCanvas=document.createElement('canvas');boardCanvas.width=512;boardCanvas.height=256;
  const bc=boardCanvas.getContext('2d')!;bc.fillStyle='#102d3c';bc.fillRect(0,0,512,256);bc.strokeStyle='#60f4d9';bc.lineWidth=10;bc.strokeRect(8,8,496,240);
  bc.fillStyle='#73f6db';bc.textAlign='center';bc.font='bold 56px sans-serif';bc.fillText('跨江辅助',256,84);
  bc.fillStyle='#ffffff';bc.font='32px sans-serif';bc.fillText('沿青色跳台加速',256,148);bc.font='26px sans-serif';bc.fillText('自动补气 · 离台托举',256,205);
  const boardMat=new MeshBasicMaterial({map:new CanvasTexture(boardCanvas),side:DoubleSide});
  for(const z of RIVER_CROSSINGS)for(const side of [-1,1]){
    const x=side<0?-65:365,heading=-side;
    const board=new Mesh(new PlaneGeometry(8,4),boardMat);board.position.set(x,5,z+13);board.rotation.y=side*Math.PI/2;group.add(board);
    const pole=new Mesh(new BoxGeometry(.15,5,.15),stone);pole.position.set(x,2.5,z+13);group.add(pole);
    for(const step of [0,12,24])for(const half of [-1,1]){
      const arrow=new Mesh(new BoxGeometry(7,.035,.55),guide);arrow.position.set(side<0?-90+step:390-step,.045,z+half*2.3);arrow.rotation.y=heading*half*Math.PI/4;group.add(arrow);
    }
  }

  // 坡道
  const rampMat = new MeshStandardMaterial({ color: 0x9a9890, roughness: 0.8 });
  const stripe = guide;
  for (const r of layout.ramps) {
    const dir = r.b.clone().sub(r.a);
    const len = dir.length();
    const ang = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    const g = new Group();
    const top = new Mesh(new BoxGeometry(len, 0.4, r.width), rampMat);
    top.position.y = -0.2;
    g.add(top);
    for (const s of [-1, 1]) {
      const edge = new Mesh(new BoxGeometry(len, 0.06, 0.25), stripe);
      edge.position.set(0, 0.03, s * (r.width / 2 - 0.2));
      g.add(edge);
    }
    g.position.copy(r.a.clone().add(r.b).multiplyScalar(0.5));
    g.rotation.set(0, -Math.atan2(dir.z, dir.x), ang, 'YXZ');
    group.add(g);
    // 跳台下方的支撑
    if (r.b.y - r.a.y > 3) {
      const sup = new Mesh(new BoxGeometry(0.6, r.b.y - r.a.y, r.width * 0.9), rampMat);
      sup.position.set(r.b.x - Math.sign(dir.x)*0.4, (r.b.y + r.a.y) / 2, r.b.z);
      group.add(sup);
    }
  }

  // 建筑
  group.add(buildingsMesh(layout.buildings));

  // 石库门坡屋顶
  const prism = new BufferGeometry();
  prism.setAttribute('position', new BufferAttribute(new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, 0.5,
    -0.5, 0, -0.5, 0, 1, -0.5, 0, 1, 0.5, -0.5, 0, -0.5, 0, 1, 0.5, -0.5, 0, 0.5,
    0.5, 0, -0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
  ]), 3));
  prism.computeVertexNormals();
  const roofs: Matrix4[] = [];
  for (const b of layout.buildings) {
    if (b.style !== 1) continue;
    // 屋脊沿长边
    if (b.w >= b.d) roofs.push(mat4(b.x, b.h, b.z, Math.PI / 2, b.d + 0.6, 2.4, b.w + 0.4));
    else roofs.push(mat4(b.x, b.h, b.z, 0, b.w + 0.6, 2.4, b.d + 0.4));
  }
  group.add(instanced(prism, new MeshStandardMaterial({ color: 0x24262a, roughness: 0.7, side: DoubleSide }), roofs));

  // 外滩：檐口、穹顶、钟楼、绿色金字塔顶
  const bundStone = new MeshStandardMaterial({ color: 0xc8b89c, roughness: 0.75 });
  const cornices: Matrix4[] = [];
  for (const b of layout.buildings) {
    if (b.style !== 0) continue;
    cornices.push(mat4(b.x, b.h - 0.6, b.z, 0, b.w + 1.4, 1.2, b.d + 1.4));
    if (b.roof === 'dome') {
      const drum = new Mesh(new CylinderGeometry(9, 9, 5, 24), bundStone);
      drum.position.set(b.x + 4, b.h + 2.5, b.z);
      const dome = new Mesh(new SphereGeometry(9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), bundStone);
      dome.position.set(b.x + 4, b.h + 5, b.z);
      group.add(drum, dome);
    } else if (b.roof === 'clock') {
      const tower = new Mesh(new BoxGeometry(12, 22, 12), bundStone);
      tower.position.set(-112, b.h + 11, b.z);
      const cap = new Mesh(new ConeGeometry(8.5, 9, 4), bundStone);
      cap.rotation.y = Math.PI / 4;
      cap.position.set(-112, b.h + 26.5, b.z);
      const face = new MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5 });
      for (const s of [-1, 1]) {
        const clock = new Mesh(new CylinderGeometry(2.6, 2.6, 0.3, 24), face);
        clock.rotation.z = Math.PI / 2;
        clock.position.set(-112 + s * 6.1, b.h + 16, b.z);
        group.add(clock);
      }
      group.add(tower, cap);
    } else if (b.roof === 'pyramid') {
      const copper = new MeshStandardMaterial({ color: 0x3d8a72, roughness: 0.5, metalness: 0.3 });
      const base = new Mesh(new BoxGeometry(14, 8, 14), bundStone);
      base.position.set(b.x + 6, b.h + 4, b.z + b.d / 2 - 9);
      const pyr = new Mesh(new ConeGeometry(10.5, 14, 4), copper);
      pyr.rotation.y = Math.PI / 4;
      pyr.position.set(b.x + 6, b.h + 15, b.z + b.d / 2 - 9);
      group.add(base, pyr);
    }
  }
  group.add(instanced(new BoxGeometry(1, 1, 1), bundStone, cornices));

  // 梧桐
  const trunks: Matrix4[] = [];
  const crowns: Matrix4[] = [];
  for (const [x, z, s] of layout.trees) {
    trunks.push(mat4(x, 2 * s, z, rng() * 6, s, s, s));
    crowns.push(mat4(x, 6 * s, z, rng() * 6, s*.86, s*.85, s*.86));
    for(const side of [-1,1])crowns.push(mat4(x+side*1.45*s,5.3*s,z+side*.65*s,rng()*6,s*.72,s*.65,s*.8));
  }
  group.add(instanced(new CylinderGeometry(0.18, 0.26, 4, 5), new MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.9 }), trunks));
  group.add(instanced(new SphereGeometry(2.7, 6, 3), new MeshStandardMaterial({ color: 0x4a8a3c, roughness: 0.9, flatShading: false }), crowns));

  // 路灯 + 地面光斑
  const poles: Matrix4[] = [];
  const heads: Matrix4[] = [];
  const pools: Matrix4[] = [];
  for (const l of layout.lamps) {
    poles.push(mat4(l.x, l.y + 4, l.z, l.rot));
    const hx = l.x + Math.sin(l.rot) * 1.6;
    const hz = l.z + Math.cos(l.rot) * 1.6;
    heads.push(mat4(hx, l.y + 7.8, hz, l.rot));
    pools.push(mat4(hx, l.y + 0.06, hz, 0, 13, 1, 13));
  }
  const poleGeo = mergeGeometries([new CylinderGeometry(0.08, 0.12, 8, 6), new BoxGeometry(0.1, 0.1, 1.8).translate(0, 3.9, 0.8)]);
  group.add(instanced(poleGeo, new MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 }), poles));
  group.add(instanced(new BoxGeometry(0.5, 0.14, 0.9), new MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.4 }), heads));
  const poolMat = new MeshBasicMaterial({ map: radialTexture('rgba(255,220,170,1)', 'rgba(255,200,140,0)'), transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false });
  void poolMat; // 白天不画路灯光斑

  // 南京东路霓虹招牌
  if (layout.signs.length) {
    const geos = layout.signs.map((s) => {
      const g = new PlaneGeometry(1.5, s.h);
      const uv = g.attributes.uv as BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (s.variant + uv.getX(i)) / 8);
      g.rotateY(Math.PI / 2);
      g.translate(s.x, s.y, s.z);
      return g;
    });
    const signs = new Mesh(mergeGeometries(geos), new MeshBasicMaterial({ map: signAtlas(), color: new Color(0.95, 0.95, 0.95), side: DoubleSide }));
    group.add(signs);
  }

  // 黄浦江
  const wm = waterMaterial();
  const water = new Mesh(new PlaneGeometry(RIVER.x1 - RIVER.x0 + 4, BZ1 - BZ0 + 400).rotateX(-Math.PI / 2), wm);
  water.position.set((RIVER.x0 + RIVER.x1) / 2, RIVER.waterY, 0);
  group.add(water);

  group.add(sky());

  // 静态物体不需要每帧更新矩阵；白天开阴影
  group.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    if ((o as Mesh).isMesh && o !== water) {
      o.receiveShadow = true;
      o.castShadow = !(o as Mesh).geometry?.attributes.color; // 标线不投影
    }
  });
  group.updateMatrixWorld(true);

  return {
    group,
    water,
    setEnv(cube) {
      wm.uniforms.uEnv.value = cube;
      wm.uniforms.uHasEnv.value = 1;
    },
    update(t) {
      wm.uniforms.uTime.value = t;
    },
  };
}
