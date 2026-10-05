// Nordschleife Kart: entry point (port of Open Street Kart scenes/main.gd).
// The track is chosen before loading (src/tracks.ts); switching tracks reloads the page.
import * as THREE from "three";
import { Heightmap, Track, TrackJSON } from "./track";
import { buildTerrain, makeTerrainMaterial } from "./world/terrain";
import { buildRoad } from "./world/road";
import { Vegetation } from "./world/vegetation";
import { buildBuildings, buildPublicRoads, buildWater, Crowds, WorldJSON } from "./world/scenery";
import { SkyLights } from "./world/sky";
import { BASE, setMaxAnisotropy } from "./world/assets";
import { Controls } from "./race/brain";
import { Race } from "./race/race";
import { CameraRig, CAM_MODES, CamMode } from "./race/camera";
import { GameAudio } from "./audio";
import { UI, SetupChoice } from "./ui/ui";
import { buildTouch } from "./ui/touch";
import { loadSettings, saveSettings } from "./settings";
import { currentTrack } from "./tracks";

const CAM_LABEL: Record<CamMode, string> = { chase: "追尾视角", far: "远景视角", hood: "车手视角" };

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function fetchBin(url: string, onProgress?: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

async function boot() {
  const settings = loadSettings();
  const info = currentTrack();
  const DATA = `${BASE}data/${info.id}/`;
  document.title = `${info.brand[0]} ${info.brand[1]}`;
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality > 0, powerPreference: "high-performance" });
  const applyPixelRatio = () => renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 2 ? 2 : settings.quality === 1 ? 1.5 : 1));
  applyPixelRatio();
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = settings.quality > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  // the static world's CPU arrays are dropped after upload (see below), so a lost
  // context (GPU reset, mobile tab eviction) cannot be re-uploaded: reload instead
  let glLost = false;
  canvas.addEventListener("webglcontextlost", () => {
    glLost = true;
    console.warn("webglcontextlost");
    if (!document.querySelector(".gl-lost")) {
      const d = document.createElement("div");
      d.className = "gl-lost";
      d.textContent = "图形设备已重置，正在重新加载…";
      document.body.append(d);
    }
  });
  canvas.addEventListener("webglcontextrestored", () => {
    // ?manual test runs keep going headless (physics/AI do not need the GPU)
    if (!new URLSearchParams(location.search).has("manual")) location.reload();
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.15, 12000);
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  // ---------------------------------------------------------------- data (OSK MapDataLoader)
  const ui = new UI(info, settings);
  const trackJson = (await (await fetch(`${DATA}track.json`)).json()) as TrackJSON;
  const track = new Track(trackJson);
  const courses = info.courses(track);
  ui.setTrack(track, courses);
  ui.setLoading(0.05, "下载地形高程…");
  const [terrainRaw, world, treesRaw] = await Promise.all([
    fetchBin(`${DATA}terrain.bin`, (f) => ui.setLoading(0.05 + f * 0.15, "下载地形高程…")),
    fetch(`${DATA}world.json`).then((r) => r.json() as Promise<WorldJSON>),
    fetchBin(`${DATA}trees.bin`, (f) => ui.setLoading(0.2 + f * 0.15, "下载树木分布…")),
  ]);
  const hm = new Heightmap(trackJson.terrain, terrainRaw);

  ui.setLoading(0.4, "生成地形…");
  await tick();
  const terrainMat = makeTerrainMaterial({ lc: trackJson.landcover, dir: DATA });
  scene.add(buildTerrain(hm, terrainMat));

  ui.setLoading(0.5, `铺设 ${(track.length / 1000).toFixed(2)} km 赛道与护栏…`);
  await tick();
  const road = buildRoad(track, hm, terrainMat, info);
  track.railL = road.railL;
  track.railR = road.railR;
  scene.add(road.group);

  const params = new URLSearchParams(location.search);
  // ?nogfx: physics / AI checks without trees, buildings and crowds (low memory test runs)
  const nogfx = params.has("nogfx");
  ui.setLoading(0.62, `种植 ${Math.round(treesRaw.byteLength / 8 / 1000)}k 棵树…`);
  await tick();
  const veg = new Vegetation(nogfx ? new ArrayBuffer(0) : treesRaw, hm, settings.quality);
  scene.add(veg.group);

  ui.setLoading(0.74, `建造 ${world.buildings.length} 栋建筑与周边道路…`);
  await tick();
  if (!nogfx) {
    scene.add(buildBuildings(world, track));
    scene.add(buildPublicRoads(world, track, hm));
  }
  if (world.water) scene.add(buildWater(world.water));
  const crowds = new Crowds(track, hm, nogfx ? [] : road.spectatorZones, info.campers);
  scene.add(crowds.group);

  ui.setLoading(0.86, "天空与光照…");
  await tick();
  const shadowSize = () => (settings.quality === 2 ? 2048 : settings.quality === 1 ? 1024 : 0);
  const sky = new SkyLights(scene, shadowSize());

  ui.setLoading(0.92, "编译着色器…");
  await tick();
  const rig = new CameraRig(camera, track);
  rig.mode = settings.camera;
  rig.setFlyoverStart(track.sectors.find((s) => s.name === info.flyoverSector)?.s ?? 0);
  rig.flyover(0.016);
  sky.update(camera.position, camera, 0);
  veg.update(camera, 0);
  // the static world never changes after upload: drop the CPU copies (~100+ MB)
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    // frustum culling computes bounds lazily from the arrays: do it before they go away
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    const imb = o as THREE.InstancedMesh;
    if (imb.isInstancedMesh && !imb.boundingSphere) imb.computeBoundingSphere();
    const free = function (this: THREE.BufferAttribute) {
      (this as unknown as { array: null }).array = null;
    };
    for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).onUpload(free);
    g.index?.onUpload(free);
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) {
      im.instanceMatrix.onUpload(free);
      im.instanceColor?.onUpload(free);
    }
  });
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    /* older browsers: shaders compile on first frame */
  }

  ui.buildScreens({ buildings: world.buildings.length, trees: treesRaw.byteLength / 8 });
  ui.setLoading(1, "完成");
  ui.show("title");

  // ---------------------------------------------------------------- game state
  const controls = new Controls();
  const audio = new GameAudio();
  audio.volume = settings.volume;
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch) {
    buildTouch(ui.touchHost, controls);
    ui.touchHost.classList.remove("hidden");
    document.getElementById("hud")!.classList.add("touch-mode");
  }
  let race: Race | null = null;
  let lastChoice: SetupChoice | null = null;
  let state: "title" | "race" | "paused" | "results" = "title";
  let introT = 0;
  let finishT = -1;
  let prevBest = -1;
  let resultsShown = false;

  const startRace = (c: SetupChoice) => {
    audio.start();
    lastChoice = c;
    if (race) race.dispose(scene);
    race = new Race(track, { mode: c.mode, speed: c.speed, course: c.course, playerColor: c.color, bots: c.bots }, controls, audio, scene);
    prevBest = race.bestTime();
    finishT = -1;
    resultsShown = false;
    race.onFinish = () => {
      finishT = 0;
      const r = race!;
      const t = r.player.finishTime;
      if (prevBest < 0 || t < prevBest) {
        try {
          localStorage.setItem(`nk-splits-${r.opts.course.id}-${r.opts.speed}`, JSON.stringify(r.player.splits));
        } catch {
          /* ignore */
        }
      }
    };
    rig.reset();
    introT = 0;
    ui.hideAll();
    ui.prepareHud(race);
    ui.showHud(true);
    state = "race";
  };
  ui.onStart = startRace;
  ui.onResume = () => {
    if (state === "paused") {
      state = "race";
      ui.hideAll();
    }
  };
  ui.onRestart = () => lastChoice && startRace(lastChoice);
  ui.onRespawn = () => {
    race?.respawnPlayer();
    ui.onResume();
  };
  ui.onQuit = () => {
    if (race) race.dispose(scene);
    race = null;
    state = "title";
    ui.showHud(false);
    ui.show("title");
    rig.setFlyoverStart(track.sectors[Math.floor(Math.random() * track.sectors.length)].s);
  };
  ui.onSettings = (s) => {
    audio.volume = s.volume;
    saveSettings(s);
    applyPixelRatio();
    renderer.setSize(innerWidth, innerHeight, false);
    const sz = shadowSize();
    renderer.shadowMap.enabled = sz > 0;
    sky.sun.castShadow = sz > 0;
    if (sz > 0 && sky.sun.shadow.mapSize.x !== sz) {
      sky.sun.shadow.mapSize.set(sz, sz);
      sky.sun.shadow.map?.dispose();
      sky.sun.shadow.map = null;
    }
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
  };

  const pause = () => {
    if (state !== "race" || !race) return;
    state = "paused";
    ui.setPauseInfo(`${race.opts.course.name} · ${(race.player.kart.progress / 1000).toFixed(2)} / ${(race.opts.course.distance / 1000).toFixed(2)} km`);
    ui.show("pause");
  };
  ui.onPause = pause;
  addEventListener("keydown", (e) => {
    if (e.code === "KeyM") audio.setMuted(!audio.muted);
    if (state === "race" && race) {
      if (e.code === "Escape" || e.code === "KeyP") pause();
      else if (e.code === "KeyC") {
        rig.mode = CAM_MODES[(CAM_MODES.indexOf(rig.mode) + 1) % CAM_MODES.length];
        settings.camera = rig.mode;
        saveSettings(settings);
      } else if (e.code === "KeyR") race.respawnPlayer();
    } else if (state === "paused" && (e.code === "Escape" || e.code === "KeyP")) ui.onResume();
    else if (state === "paused" && e.code === "KeyR") ui.onRespawn();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });

  // ---------------------------------------------------------------- loop
  const timer = new THREE.Timer();
  timer.connect(document);
  let time = 0;
  let fpsAcc = 0;
  let fpsN = 0;
  let fps = 60;
  const focus = new THREE.Vector3();
  let freeCam = false;
  // ?manual: no animation loop; tools/shot.cjs advances frames explicitly (software GL is slow)
  const manual = new URLSearchParams(location.search).has("manual");
  const frame = () => {
    if (!manual) requestAnimationFrame(frame);
    timer.update();
    advance(Math.min(0.05, timer.getDelta()), true);
  };
  const advance = (dt: number, render: boolean) => {
    time += dt;
    fpsAcc += dt;
    fpsN++;
    if (fpsAcc > 0.5) {
      fps = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }
    if (freeCam) {
      focus.copy(camera.position);
      focus.y -= 10;
      if (race) race.update(dt);
    } else if (state === "title" || !race) {
      rig.flyover(dt);
      focus.copy(camera.position);
      focus.y -= 16;
      audio.update(0, 30, 0, 0, false, false, true);
    } else {
      const r = race;
      if (state === "race") {
        if (r.phase === "intro") {
          introT += dt;
          if (introT > 2.2) r.startCountdown();
        }
        r.update(dt);
        if (finishT >= 0) finishT += dt;
      }
      const k = r.player.kart;
      if (r.phase === "intro") rig.orbitAround(k, dt, 7);
      else if (finishT > 2.5) rig.orbitAround(k, dt, 8);
      else rig.follow(k, dt, r.shake, controls.keys.has("KeyQ"));
      if (finishT > 2.5 && !resultsShown && state === "race") {
        resultsShown = true;
        state = "results";
        ui.showResults(r, prevBest < 0 || r.player.finishTime < prevBest, prevBest);
      }
      if (state === "results") r.update(dt);
      focus.copy(k.pos);
      const slip = Math.abs(k.vel.x * Math.cos(k.heading) + k.vel.z * Math.sin(k.heading)) / 4 + (k.drifting ? 0.6 : 0);
      audio.update(k.forwardSpeed, k.maxSpeed, r.player.brain.input.throttle, slip, k.offTrack, !k.grounded, state === "paused");
      ui.updateHud(r, dt, fps, CAM_LABEL[rig.mode]);
    }
    sky.update(focus, camera, time);
    veg.update(camera, time);
    crowds.update(time);
    controls.endFrame();
    if (render && !glLost) renderer.render(scene, camera);
  };
  frame();
  (window as unknown as { __nk: unknown }).__nk = {
    scene,
    camera,
    renderer,
    track,
    rig,
    ui,
    courses,
    controls,
    startRace,
    get race() {
      return race;
    },
    get state() {
      return state;
    },
    /** debug: park the camera at a world position looking at a target (null to release) */
    view(p: number[] | null, look?: number[]) {
      freeCam = !!p;
      if (p && look) {
        camera.position.set(p[0], p[1], p[2]);
        camera.up.set(0, 1, 0);
        camera.lookAt(look[0], look[1], look[2]);
      }
    },
    /** advance `n` frames of `dt` seconds, rendering only the last one (none if `render` is false) */
    advance(n: number, dt = 1 / 60, render = true) {
      for (let i = 0; i < n; i++) advance(dt, render && i === n - 1);
    },
  };
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById("load-text");
  if (el) el.textContent = `加载失败：${e instanceof Error ? e.message : String(e)}`;
});
