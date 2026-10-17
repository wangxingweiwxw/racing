// 开放街道 openracing：组装场景、固定步长物理循环、车辆表现、特效、事件。
import {
  ACESFilmicToneMapping, Color, CubeCamera, DirectionalLight, FogExp2, HalfFloatType, HemisphereLight, Mesh,
  MeshBasicMaterial, PMREMGenerator, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, ShaderMaterial,
  PCFSoftShadowMap, Vector2, Vector3, WebGLCubeRenderTarget, WebGLRenderer,
} from 'three';
import { Sfx } from './audio.ts';
import { ChaseCam } from './camera.ts';
import type { CamMode } from './camera.ts';
import { WHEEL_R, buildCar } from './car/model.ts';
import { Particles } from './fx/particles.ts';
import { Plumes } from './fx/plumes.ts';
import { Post } from './fx/post.ts';
import { Skids } from './fx/skids.ts';
import { Input } from './input.ts';
import { TUNING, Vehicle } from './physics/vehicle.ts';
import type { DriveInput, Env, VehicleEvent } from './physics/vehicle.ts';
import { Combo } from './game/combo.ts';
import type { ComboEvent } from './game/combo.ts';
import { Discovery, Objectives, buildObjectives } from './game/objectives.ts';
import type { ObjEvent } from './game/objectives.ts';
import { Hud } from './ui/hud.ts';
import { buildNetwork } from './traffic/network.ts';
import { SignalView, TrafficView } from './traffic/render.ts';
import { Traffic } from './traffic/traffic.ts';
import type { TrafficEvent } from './traffic/traffic.ts';
import { buildCity } from './world/city.ts';
import { buildLandmarks } from './world/landmarks.ts';
import { RIVER, RIVER_CROSSINGS, buildLayout } from './world/layout.ts';
import { radialTexture } from './world/textures.ts';
import { buildTouch } from './ui/touch.ts';
import './ui/mobile.css';
import { RiverCruises } from './world/cruises.ts';

const params = new URLSearchParams(location.search);
const LOW = params.get('q') === 'low' || location.hash === '#low' || (params.get('q')!=='high'&&(innerWidth<=900||matchMedia('(pointer: coarse)').matches));
/** 自动化截图用：不自动跑帧循环，由脚本调用 openracing.frame() 逐帧推进 */
const MANUAL = params.has('manual');
const R = TUNING.radius;

// ---------- 渲染器 / 场景 ----------
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: LOW, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW ? 1 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

const scene = new Scene();
scene.background = new Color(0x9fc4ec);
scene.fog = new FogExp2(0xc4d6e8, 0.00085);
const camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);

// 晴天：天光 + 偏暖的太阳（实时阴影只覆盖车周围 ±70 m，阴影相机跟着车走）
scene.add(new HemisphereLight(0xcfe3ff, 0x6e604e, 1.25));
const SUN_DIR = new Vector3(-0.45, 0.62, 0.42).normalize();
const sun = new DirectionalLight(0xfff0dc, 3.1);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -70;
sun.shadow.camera.right = sun.shadow.camera.top = 70;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 500;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
function followSun(p: Vector3): void {
  sun.target.position.copy(p);
  sun.position.copy(p).addScaledVector(SUN_DIR, 250);
  sun.target.updateMatrixWorld();
}

// ---------- 世界 ----------
const layout = buildLayout();
const city = buildCity(layout);
scene.add(city.group);
scene.add(buildLandmarks());
const network = buildNetwork(layout);
const traffic = new Traffic(network, LOW ? 70 : 180, 7, layout.world);
const cruises = new RiverCruises();
const env: Env = { world: layout.world, river: RIVER, crossings:RIVER_CROSSINGS, dynamic: {
  contacts(p,r,margin,pool,start){return cruises.contacts(p,r,margin,pool,traffic.contacts(p,r,margin,pool,start));}
} };

// ---------- 车 ----------
const car = buildCar();
scene.add(car.root);
const plumes = new Plumes(car.body, car.sockets);
car.root.traverse((o) => {
  if ((o as Mesh).isMesh) o.castShadow = o.receiveShadow = true;
});

const shadow = new Mesh(
  new PlaneGeometry(2.6, 5).rotateX(-Math.PI / 2),
  new MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }),
);
shadow.renderOrder = 1;
scene.add(shadow);

const smoke = new Particles(LOW ? 1200 : 2600, false);
const sparks = new Particles(500, true);
const skids = new Skids();
scene.add(smoke.points, sparks.points, skids.mesh);

// ---------- 环境反射：把整座城市拍进一张立方体贴图（静态，只拍一次） ----------
function captureEnv(): void {
  const rt = new WebGLCubeRenderTarget(LOW ? 128 : 256, { type: HalfFloatType });
  const cubeCam = new CubeCamera(1, 6000, rt);
  cubeCam.position.set(150, 28, 0);
  car.root.visible = false;
  city.water.visible = false;
  shadow.visible = false;
  cubeCam.update(renderer, scene);
  car.root.visible = true;
  city.water.visible = true;
  shadow.visible = true;
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromCubemap(rt.texture).texture;
  scene.environmentIntensity = 0.9;
  city.setEnv(rt.texture);
  pmrem.dispose();
}
followSun(layout.spawn.pos);
captureEnv();
// 车流、行人、红绿灯在拍环境贴图之后再加入（会动的东西不进反射）
const trafficView = new TrafficView(traffic);
const signalView = new SignalView(network);
scene.add(trafficView.group, signalView.group, cruises.group);

// ---------- 游戏状态 ----------
const vehicle = new Vehicle(layout.spawn.pos.clone(), layout.spawn.heading.clone());
const input = new Input(window);
buildTouch(input);
const sfx = new Sfx();
const BEST_KEY = 'openracing.roadster-v3.bestTrial';
function loadBest(): number | null {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function saveBest(t: number | null): void {
  try {
    if (t !== null) localStorage.setItem(BEST_KEY, String(t));
  } catch {
    /* 隐私模式等情况下无法保存，忽略 */
  }
}
const hud = new Hud(layout, 8800);
const combo = new Combo();
const objectives = new Objectives(buildObjectives(layout), loadBest());
const discovery = new Discovery(layout);
const chase = new ChaseCam(camera);
const post = new Post(renderer, scene, camera, !LOW);
const camModes: CamMode[] = ['chase', 'far', 'hood'];

const renderPos = vehicle.pos.clone();
const renderQ = vehicle.q.clone();
const prevPos = vehicle.pos.clone();
const prevQ = vehicle.q.clone();
const carGround = new Vector3();
chase.snap(vehicle, vehicle.pos);

let started = false;
/** 调试：把相机固定在车身局部坐标的某个位置（车型对照用） */
let camLock: { o: Vector3; l: Vector3; fov: number } | null = null;
let keysT = 25;
const keysEl = document.getElementById('keys')!;
let paused = false;
let suspension=0,suspensionVelocity=0;
let crossing: { from: 'puxi' | 'pudong'; t0: number; maxY: number } | null = null;

// ---------- 小工具 ----------
const _v = new Vector3();
const _w = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _q = new Quaternion();
const _size = new Vector2();
const WHITE_MIST = new Color(0.95, 0.97, 1.0);
const DUST = new Color(0.78, 0.74, 0.68);
const SMOKE = new Color(0.88, 0.88, 0.9);
const SPARK = new Color(3, 1.6, 0.5);
const SPRAY = new Color(0.75, 0.85, 0.95);
const rand = (a: number) => (Math.random() - 0.5) * 2 * a;

function groundBelow(from: Vector3, dir: Vector3, max: number) {
  return layout.world.raycast(from, dir, max, (c) => c.tag === 'bound');
}

function dustRing(at: Vector3, n: Vector3, count: number, power: number): void {
  const center=at.clone(); // at can be the same scratch vector used for particle velocity.
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    _v.set(Math.cos(a), 0, Math.sin(a));
    _v.addScaledVector(n, -_v.dot(n)).normalize().multiplyScalar(power * (0.6 + Math.random() * 0.6)).addScaledVector(n, 1 + Math.random());
    smoke.spawn(center, _v, { life: 1.0 + Math.random() * 0.5, size0: 0.8, size1: 3.5 + Math.random() * 2, alpha: 0.16, color: DUST, drag: 2.4, gravity: 0.3 });
  }
}

function sparkBurst(at: Vector3, count: number, power: number): void {
  for (let i = 0; i < count; i++) {
    _v.set(rand(1), Math.random(), rand(1)).normalize().multiplyScalar(power * (0.4 + Math.random()));
    sparks.spawn(at, _v, { life: 0.3 + Math.random() * 0.4, size0: 0.25, size1: 0.05, alpha: 1, color: SPARK, drag: 1.5, gravity: -14 });
  }
}

function kick(a: number): void {
  chase.kick(a);
  hud.kick(a * 0.8);
}

function onEvent(e: VehicleEvent): void {
  sfx.event(e);
  vehicle.up(_up);
  switch (e.type) {
    case 'hop': {
      kick(0.25);
      const hit = groundBelow(vehicle.pos, _w.copy(_up).negate(), 4);
      if (hit) dustRing(_v.copy(vehicle.pos).addScaledVector(_up, -hit.dist), _up, 40, 9);
      break;
    }
    case 'takeoff':
      if (vehicle.pos.x < RIVER.x0 + 2) crossing = { from: 'puxi', t0: vehicle.time, maxY: vehicle.pos.y };
      else if (vehicle.pos.x > RIVER.x1 - 2) crossing = { from: 'pudong', t0: vehicle.time, maxY: vehicle.pos.y };
      else crossing = null;
      break;
    case 'land': {
      suspensionVelocity-=Math.min(.9,e.strength*.055);
      if (e.strength > 6) {
        kick(Math.min(0.6, e.strength / 30));
        dustRing(carGround, _up, 18, 6);
        if (e.strength > 12) sparkBurst(carGround, 24, 9);
      }
      checkCrossing();
      break;
    }
    case 'crash':
      kick(Math.min(0.8, e.strength / 20));
      sparkBurst(_v.copy(vehicle.pos).addScaledVector(vehicle.fwd(_w), 1.8), Math.min(40, Math.round(e.strength * 2)), 8);
      checkCrossing();
      break;
    case 'attach':
      kick(0.2);
      if (vehicle.mode === 'wall' || vehicle.mode === 'ceiling') hud.card(vehicle.mode === 'ceiling' ? '倒挂行驶' : '风扇吸附', `2G 吸力 · 约 ${Math.max(1, Math.round((1 - vehicle.fanHeat) * 7))} 秒后过热`, 'good', 1.6);
      break;
    case 'splash':
      crossing = null;
      for (let i = 0; i < 160; i++) {
        _v.set(rand(6), 6 + Math.random() * 12, rand(6));
        smoke.spawn(_w.copy(vehicle.pos).setY(RIVER.waterY + 0.3), _v, { life: 1 + Math.random(), size0: 0.6, size1: 3, alpha: 0.5, color: SPRAY, drag: 0.8, gravity: -9 });
      }
      hud.card('落入黄浦江', '1.5 秒后回到岸上', 'warn', 1.8);
      for (const oe of objectives.abort()) onObjEvent(oe);
      break;
    case 'respawn':
      chase.snap(vehicle, vehicle.pos);
      prevPos.copy(vehicle.pos);
      prevQ.copy(vehicle.q);
      break;
    case 'overheat':
      hud.card('风扇过热', '吸附失效 · 冷却到 25% 前无法再开', 'warn', 2.6);
      break;
    case 'fanLocked':
      hud.card('风扇冷却中', `热量 ${Math.round(vehicle.fanHeat * 100)}%`, 'warn', 1.4);
      break;
    case 'fanOn':
    case 'fanOff':
      break;
    case 'empty':
      hud.card('压缩空气耗尽', '落地 0.8 秒后自动回气', 'warn', 2.4);
      break;
    default:
      break;
  }
}

function checkCrossing(): void {
  if (!crossing) return;
  const landed = vehicle.pos.x > RIVER.x1 ? 'pudong' : vehicle.pos.x < RIVER.x0 ? 'puxi' : null;
  if (landed && landed !== crossing.from) {
    const t = vehicle.time - crossing.t0;
    hud.card('飞越黄浦江', `滞空 ${t.toFixed(1)} s · 最高 ${Math.round(crossing.maxY)} m`, 'gold', 3.2);
    for (const ce of combo.bonus('飞越黄浦江', 3000)) onComboEvent(ce);
  }
  crossing = null;
}

function onComboEvent(e: ComboEvent): void {
  sfx.ui(e.type === 'action' ? 'tick' : e.type === 'bank' ? 'bank' : 'fail');
  if (e.type === 'bank' && e.pts > 0) {
    hud.money(e.pts, `车技连击 ${e.total!.toLocaleString('en-US')} 分`);
    hud.banked(e.total!);
  }
  if (e.type === 'fail') kick(0.3);
}

function onObjEvent(e: ObjEvent): void {
  switch (e.type) {
    case 'reached':
      sfx.ui('reach');
      hud.card(e.title, e.sub, 'gold', 3);
      hud.money(e.reward, e.title.split(' · ')[0]);
      break;
    case 'trialStart':
      sfx.ui('reach');
      hud.card(e.title, e.sub, 'good', 2.4);
      break;
    case 'trialDone':
      sfx.ui('reach');
      hud.card(e.title, e.sub, 'gold', 3.5);
      hud.money(e.reward, '计时赛奖金');
      saveBest(objectives.best);
      break;
    case 'trialAbort':
      hud.card(e.title, e.sub, 'warn', 2.4);
      break;
    case 'next':
      break;
  }
}

function onTrafficEvent(e: TrafficEvent): void {
  if (e.type === 'nearMiss') {
    for (const ce of combo.bonus(`擦车 ${e.clear.toFixed(1)}m`, Math.round(380 - e.clear * 150 + e.rel * 4))) onComboEvent(ce);
  } else if (e.type === 'honk') sfx.horn();
}

// ---------- 车辆表现 ----------
let spawnAcc = 0;
const plumeK = new Array<number>(car.sockets.length).fill(0);

function updateCarVisual(dt: number, t: number): void {
  suspensionVelocity+=(-suspension*100-suspensionVelocity*15)*dt;
  suspension=Math.max(-.065,Math.min(.04,suspension+suspensionVelocity*dt));
  car.animate(dt,vehicle,suspension);
  _up.set(0, 1, 0).applyQuaternion(renderQ);
  carGround.copy(renderPos).addScaledVector(_up, -R);
  car.root.position.copy(carGround);
  car.root.quaternion.copy(renderQ);
  car.root.updateMatrixWorld();

  for (const w of car.wheels) {
    w.spin.rotation.x = vehicle.wheelSpin;
    if (w.front) w.pivot.rotation.y = -vehicle.steer * 0.45;
    w.pivot.position.y = WHEEL_R + (vehicle.grounded ? -suspension : -0.045);
  }

  // 推进器强度
  const v = vehicle;
  car.sockets.forEach((s, i) => {
    let k = 0;
    if (s.kind === 'main') k = v.mainThrust;
    else if (s.kind === 'down') {
      k = v.downThrust;
      k += Math.max(0, s.front < 0 ? v.rcsPitch : -v.rcsPitch) * 0.7;
      k += Math.max(0, s.side < 0 ? v.rcsRoll : -v.rcsRoll) * 0.7;
    } else k = Math.max(0, s.side*s.front > 0 ? v.rcsYaw : -v.rcsYaw);
    if(v.stuntActive&&s.kind==='side')k=Math.max(k,.6);
    k = Math.min(1, k);
    plumeK[i] += (k - plumeK[i]) * (1 - Math.exp(-(k > plumeK[i] ? 30 : 10) * dt));
  });
  plumes.update(t, plumeK);

  const fan = v.fanOn ? 1 : 0;
  car.fanGlow.material.opacity += ((fan ? 0.55 + 0.1 * Math.sin(t * 30) : 0) - car.fanGlow.material.opacity) * (1 - Math.exp(-8 * dt));
  car.fanDisc.material.emissiveIntensity = fan * (1.5 + v.fanHeat * 2);

  // 冷气白雾
  spawnAcc += dt;
  const emitN = Math.floor(spawnAcc * 90);
  spawnAcc -= emitN / 90;
  if (emitN > 0) {
    car.sockets.forEach((s, i) => {
      const k = plumeK[i];
      if (k < 0.15) return;
      for (let n = 0; n < emitN; n++) {
        if (Math.random() > k) continue;
        car.body.getWorldQuaternion(_q);
        _w.copy(s.dir).applyQuaternion(_q);
        _v.copy(s.pos).addScaledVector(s.dir, 0.5 + Math.random() * 1.2);
        car.body.localToWorld(_v);
        const vel = _w.multiplyScalar(14 + Math.random() * 10).addScaledVector(v.vel, 0.85);
        vel.x += rand(1.5);
        vel.y += rand(1.5);
        vel.z += rand(1.5);
        smoke.spawn(_v, vel, { life: 0.6 + Math.random() * 0.5, size0: 0.35, size1: 2.6 + Math.random() * 1.5, alpha: 0.3 * k, color: WHITE_MIST, drag: 3, gravity: 0.6 });
      }
    });
  }
  // 下推进器离地近时吹起地面扬尘（悬停时限量）
  if (v.downThrust > 0.2 && Math.random() < v.downThrust * 0.5) {
    const hit = groundBelow(v.pos, _w.set(0, -1, 0), 8);
    if (hit) dustRing(_v.copy(v.pos).setY(v.pos.y - hit.dist + 0.2), hit.normal, 2, 10 * (1 - hit.dist / 8));
  }

  // 漂移烟 + 轮胎印
  vehicle.up(_up);
  _right.set(-1, 0, 0).applyQuaternion(renderQ);
  car.wheels.forEach((w, i) => {
    if (w.front) return;
    _v.set(w.pivot.position.x, 0.02, w.pivot.position.z);
    car.root.localToWorld(_v);
    const marking = v.grounded && v.groundN.y > 0.8 && (v.drifting || (v.braking && v.speedKmh > 60));
    skids.add(i, _v, _right, marking);
    if (v.grounded && v.drifting && Math.random() < 0.9) {
      _w.copy(v.vel).multiplyScalar(0.25);
      _w.x += rand(1.5);
      _w.z += rand(1.5);
      _w.addScaledVector(_up, 0.6 + Math.random());
      smoke.spawn(_v, _w, { life: 1.6 + Math.random() * 0.8, size0: 0.8, size1: 5 + Math.random() * 3, alpha: 0.26, color: SMOKE, drag: 1.4, gravity: 0.5 });
    }
  });

  // 地面投影
  const hit = groundBelow(renderPos, v.grounded ? _w.copy(_up).negate() : _w.set(0, -1, 0), 30);
  if (hit && v.mode !== 'sunk') {
    shadow.visible = true;
    shadow.position.copy(renderPos).addScaledVector(_w, hit.dist).addScaledVector(hit.normal, 0.04);
    _q.setFromUnitVectors(new Vector3(0, 1, 0), hit.normal);
    shadow.quaternion.copy(_q);
    const fwd = vehicle.fwd(_v);
    fwd.applyQuaternion(_q.clone().invert());
    shadow.rotateY(Math.atan2(fwd.x, fwd.z));
    (shadow.material as MeshBasicMaterial).opacity = Math.max(0, 0.45 * (1 - hit.dist / 12));
  } else shadow.visible = false;
}

// ---------- 主循环 ----------
function stepGame(): void {
  cruises.update(vehicle.time+DT);
  const ev = vehicle.step(input.state, DT, env);
  for (const e of ev) onEvent(e);
  // 先结算连击（撞击判负），再处理车流 / 警察事件 —— 撞毁警车的奖励会开启一段新连击，而不是被同一次撞击清掉
  for (const ce of combo.step(vehicle, DT, ev, layout.world)) onComboEvent(ce);
  for (const te of traffic.step(DT, vehicle)) onTrafficEvent(te);
  if (ev.some((e) => e.type === 'respawn')) for (const oe of objectives.abort()) onObjEvent(oe);
  for (const oe of objectives.step(vehicle, DT)) onObjEvent(oe);
}

const DT = 1 / 120;
let acc = 0;
let last = performance.now();
let elapsed = 0;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;
  const ui = input.poll();
  if (ui.camera) chase.mode = camModes[(camModes.indexOf(chase.mode) + 1) % camModes.length];
  if (ui.help) toggleHelp();
  if (ui.mute) sfx.toggleMute();

  if (started && !paused) {
    acc += dt;
    while (acc >= DT) {
      prevPos.copy(vehicle.pos);
      prevQ.copy(vehicle.q);
      stepGame();
      if (crossing) crossing.maxY = Math.max(crossing.maxY, vehicle.pos.y);
      acc -= DT;
    }
  }
  const a = acc / DT;
  renderPos.lerpVectors(prevPos, vehicle.pos, a);
  renderQ.slerpQuaternions(prevQ, vehicle.q, a);

  followSun(renderPos);
  updateCarVisual(dt, elapsed);
  smoke.update(dt);
  sparks.update(dt);
  city.update(elapsed);
  if (camLock) {
    camera.position.copy(car.root.localToWorld(camLock.o.clone()));
    camera.up.set(0, 1, 0);
    camera.lookAt(car.root.localToWorld(camLock.l.clone()));
    camera.fov = camLock.fov;
    camera.updateProjectionMatrix();
  } else chase.update(dt, vehicle, renderPos, layout.world);
  const h = renderer.getDrawingBufferSize(_size).y;
  smoke.setScale(h, camera.fov);
  sparks.setScale(h, camera.fov);
  if (started) {
    const found = discovery.step(vehicle.pos);
    if (found) {
      const pct = (found.count / found.total) * 100;
      hud.card('新路段', `${found.name} · 已探索 ${pct.toFixed(0)}% · ${found.count}/${found.total} 条`, 'info', 2.4);
    }
    keysT -= dt;
    if (keysT <= 0 && !keysEl.classList.contains('gone')) keysEl.classList.add('gone');
  }
  trafficView.update(camera);
  signalView.update(dt, traffic.time);
  hud.update(dt, vehicle, combo, objectives, discovery.seen, { cars: traffic.cars, boats:cruises.ships.map(s=>s.root.position), time: elapsed });
  sfx.update(vehicle, input.state.throttle);
  post.render(Math.min(vehicle.speedKmh / 300, 1), vehicle.mainThrust, vehicle.fanOn && vehicle.mode !== 'ground' ? 1 : 0);
  if (!MANUAL) requestAnimationFrame(frame);
}

// ---------- 界面 ----------
const startEl = document.getElementById('start')!;
const goBtn = document.getElementById('go') as HTMLButtonElement;
const circuitDialog = document.getElementById('circuit-select') as HTMLDialogElement;
document.querySelectorAll('[data-open-circuits]').forEach(button => button.addEventListener('click', () => {
  paused = true;
  input.clear();
  circuitDialog.showModal();
}));
circuitDialog.addEventListener('close', () => {
  paused = !startEl.classList.contains('hidden') || document.hidden;
  input.clear();
});
function toggleHelp(): void {
  if (circuitDialog.open) return;
  if (!started) return;
  startEl.classList.toggle('hidden');
  paused=!startEl.classList.contains('hidden');input.clear();
  goBtn.textContent = '继续';
}
document.getElementById('b-cam')!.addEventListener('click', () => (chase.mode = camModes[(camModes.indexOf(chase.mode) + 1) % camModes.length]));
document.getElementById('b-help')!.addEventListener('click', () => toggleHelp());
document.getElementById('b-mute')!.addEventListener('click', () => sfx.toggleMute());
goBtn.disabled = false;
goBtn.textContent = '点击开始';
goBtn.addEventListener('click', () => {
  startEl.classList.add('hidden');
  paused=false;input.clear();document.body.classList.add('playing');
  if (!started) {
    started = true;
    sfx.start();
    hud.card('沿南京东路向东', '青色跳台补气 · 离台自动跨江辅助', 'info', 3.2);
  }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&started){paused=true;input.clear();startEl.classList.remove('hidden');goBtn.textContent='继续驾驶';}});
document.getElementById('b-reset')!.addEventListener('click',()=>{input.touch.reset=true;setTimeout(()=>input.touch.reset=false,100);});

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  post.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// 调试 / 自动化测试接口
Object.assign(window, {
  openracing: {
    car,
    renderer,
    camera,
    scene,
    vehicle,
    input,
    layout,
    combo,
    objectives,
    traffic,
    cruises,
    start: () => goBtn.click(),
    teleport(x: number, y: number, z: number, yawDeg = 90) {
      vehicle.place(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (yawDeg * Math.PI) / 180));
      prevPos.copy(vehicle.pos);
      prevQ.copy(vehicle.q);
      chase.snap(vehicle, vehicle.pos);
    },
    setCam(m: CamMode) {
      chase.mode = m;
    },
    /** 同步推进物理若干秒（不渲染），input 会保持为 override 直到下次调用 */
    sim(seconds: number, inp: Partial<DriveInput>) {
      input.override = inp;
      input.poll();
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        prevPos.copy(vehicle.pos);
        prevQ.copy(vehicle.q);
        stepGame();
      }
      prevPos.copy(vehicle.pos);
      prevQ.copy(vehicle.q);
      renderPos.copy(vehicle.pos);
      renderQ.copy(vehicle.q);
      chase.snap(vehicle, vehicle.pos);
      for (let i = 0; i < 90; i++) chase.update(1 / 60, vehicle, vehicle.pos, layout.world);
    },
    pause(p: boolean) {
      paused = p;
    },
    /** 调试：在车尾挂一个输出 NaN 的小面片，用来验证后处理能否挡住 NaN 扩散 */
    debugNaN(on: boolean) {
      const name = '__nan';
      const old = car.root.getObjectByName(name);
      if (old) car.root.remove(old);
      if (!on) return;
      const m = new Mesh(new PlaneGeometry(0.3, 0.3), new ShaderMaterial({
        uniforms: { uZero: { value: 0 } },
        vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform float uZero; void main(){ float n = uZero / uZero; gl_FragColor = vec4(n, n, n, 1.0); }',
      }));
      m.name = name;
      m.position.set(0, 1.0, -2.6);
      m.rotation.y = Math.PI;
      car.root.add(m);
    },
    /** 相机锁到车身局部坐标（o = 相机位置，l = 看向的点）；传 null 解锁 */
    camLocal(o: [number, number, number] | null, l: [number, number, number] = [0, 0.7, 0], fov = 50) {
      camLock = o ? { o: new Vector3(...o), l: new Vector3(...l), fov } : null;
    },
    /** 隐藏 HUD（截图对照用） */
    hud(show: boolean) {
      document.getElementById('hud')!.style.display = show ? '' : 'none';
    },
    /** 手动推进一帧（manual 模式） */
    frame(dt = 1 / 60) {
      last = performance.now() - dt * 1000;
      frame(performance.now());
    },
  },
});

if (!MANUAL) requestAnimationFrame(frame);
