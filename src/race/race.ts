// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Race state: port of Open Street Kart scripts/track_state.gd (modes, speed modes,
// live ranking, item slots, race end) and prefabs/player_spawner.gd (grid, countdown).
import * as THREE from "three";
import { Track } from "../track";
import { BotBrain, Brain, Controls, UserBrain } from "./brain";
import { ParticleSystem, SkidMarks } from "./effects";
import { AirBomb, EXPLOSION_DURATION_SECONDS, EXPLOSION_RADIUS, GameMode, PlayerItemSlotsState, SlotItem } from "./items";
import { Kart } from "./kart";
import { KartLook, KartModel } from "./kartModel";
import { GameAudio } from "../audio";

export enum SpeedMode {
  CHILL,
  CASUAL,
  CHALLENGING,
  CRAZY,
}

/** OSK TrackSpeedDict (m/s) */
export const TRACK_SPEED: Record<SpeedMode, number> = {
  [SpeedMode.CHILL]: 25,
  [SpeedMode.CASUAL]: 30,
  [SpeedMode.CHALLENGING]: 35,
  [SpeedMode.CRAZY]: 40,
};
/** OSK OutOfBoundsSpeedDict (m/s), raised for the faster verges of real circuits */
export const OUT_OF_BOUNDS_SPEED: Record<SpeedMode, number> = {
  [SpeedMode.CHILL]: 6 * 1.8,
  [SpeedMode.CASUAL]: 8 * 1.8,
  [SpeedMode.CHALLENGING]: 9 * 1.8,
  [SpeedMode.CRAZY]: 11 * 1.8,
};

export interface Course {
  /** unique across tracks: best times and ghosts are stored per course id */
  id: string;
  name: string;
  sub: string;
  startS: number;
  distance: number;
  /** closed-lap races (distance = laps * length); 0 = point to point sector */
  laps: number;
}

export interface Racer {
  id: string;
  name: string;
  kart: Kart;
  model: KartModel;
  brain: Brain;
  look: KartLook;
  isPlayer: boolean;
  slots: PlayerItemSlotsState | null;
  finishTime: number;
  rank: number;
  stuck: number;
  wrongWay: number;
  /** visual suspension state */
  susp: { pitch: number; roll: number; bounce: number; vb: number };
  splits: number[];
  lastSector: number;
  /** race time at each completed lap */
  lapTimes: number[];
}

const BOT_NAMES = ["Anna", "Jonas", "Lena", "Felix", "Mia", "Lukas", "Emma"];
const LIVERIES: KartLook[] = [
  { color: 0x1e64c8, accent: 0x0d1b2a, helmet: 0xf0f0f0, number: 7 },
  { color: 0xd62828, accent: 0x1b1b1b, helmet: 0xffd166, number: 11 },
  { color: 0x2a9d8f, accent: 0x264653, helmet: 0xffffff, number: 23 },
  { color: 0xf4a261, accent: 0x3d2c1e, helmet: 0x264653, number: 4 },
  { color: 0x8338ec, accent: 0x1f0b3a, helmet: 0xe0e0e0, number: 19 },
  { color: 0xffbe0b, accent: 0x222222, helmet: 0x111111, number: 31 },
  { color: 0x06d6a0, accent: 0x073b4c, helmet: 0xef476f, number: 8 },
  { color: 0xef476f, accent: 0x2b2d42, helmet: 0xffffff, number: 66 },
];
export const PLAYER_COLORS = [0xe63946, 0x1e64c8, 0xffbe0b, 0x2a9d8f, 0x8338ec, 0xf4f4f4, 0x111111, 0xff7b00];

export interface RaceOptions {
  mode: GameMode;
  speed: SpeedMode;
  course: Course;
  playerColor: number;
  bots: number;
}

interface GhostFrame {
  t: number;
  x: number;
  y: number;
  z: number;
  h: number;
}

export type RacePhase = "intro" | "countdown" | "racing" | "finished";

const FIXED_DT = 1 / 120;

export class Race {
  readonly group = new THREE.Group();
  racers: Racer[] = [];
  player!: Racer;
  phase: RacePhase = "intro";
  countdown = 3.999;
  time = 0;
  private acc = 0;
  bombs: AirBomb[] = [];
  readonly smoke = new ParticleSystem(1600, false);
  readonly glow = new ParticleSystem(900, true);
  readonly skids = new SkidMarks(4000);
  ghost: { frames: GhostFrame[]; model: KartModel } | null = null;
  private ghostRec: GhostFrame[] = [];
  private ghostT = 0;
  onFinish: (() => void) | null = null;
  events: { text: string; t: number }[] = [];
  shake = 0;
  private lastCountBeep = 4;
  readonly startLamps: THREE.Mesh[] = [];

  constructor(
    readonly track: Track,
    readonly opts: RaceOptions,
    controls: Controls,
    private audio: GameAudio,
    scene: THREE.Scene,
  ) {
    this.group.name = "race";
    scene.add(this.group);
    this.group.add(this.smoke.points, this.glow.points, this.skids.mesh);
    scene.traverse((o) => {
      if (o.name.startsWith("start-lamp-")) this.startLamps.push(o as THREE.Mesh);
    });
    const maxSpeed = TRACK_SPEED[opts.speed];
    const nBots = opts.mode === GameMode.VERSUS ? opts.bots : 0;
    // grid: OSK PlayerSpawner places karts in two columns behind the line
    const total = nBots + 1;
    const playerSlot = opts.mode === GameMode.VERSUS ? Math.max(0, total - 3) : 0;
    let botIdx = 0;
    for (let slot = 0; slot < total; slot++) {
      const isPlayer = slot === playerSlot;
      const row = Math.floor(slot / 2);
      const col = slot % 2 === 0 ? -1 : 1;
      const s = opts.course.startS - 6 - row * 8 - (col > 0 ? 3 : 0);
      const lat = col * 2.4;
      const kart = new Kart(track);
      kart.maxSpeed = maxSpeed;
      kart.outOfBoundsSpeed = OUT_OF_BOUNDS_SPEED[opts.speed];
      kart.accel = 8 + maxSpeed * 0.12;
      kart.placeAt(track.wrapS(s), lat, track.deltaS(opts.course.startS, track.wrapS(s)));
      const look: KartLook = isPlayer ? { color: opts.playerColor, accent: 0x15171c, helmet: 0xf2f2f2, number: 1 } : LIVERIES[(botIdx + 1) % LIVERIES.length];
      const model = new KartModel(look);
      this.group.add(model.root);
      let brain: Brain;
      let name: string;
      if (isPlayer) {
        brain = new UserBrain(controls);
        name = "你";
      } else {
        const skill = 0.86 + ((botIdx * 37) % 11) / 100 + (opts.speed === SpeedMode.CRAZY ? 0.02 : 0);
        brain = new BotBrain(track, maxSpeed, Math.min(1, skill), (botIdx % 3) - 1);
        kart.maxSpeed = maxSpeed * (0.965 + skill * 0.03);
        name = BOT_NAMES[botIdx % BOT_NAMES.length];
        botIdx++;
      }
      const r: Racer = {
        id: `kart${slot}`,
        name,
        kart,
        model,
        brain,
        look,
        isPlayer,
        slots: opts.mode === GameMode.FREE ? null : new PlayerItemSlotsState(maxSpeed, opts.mode),
        finishTime: -1,
        rank: slot + 1,
        stuck: 0,
        wrongWay: 0,
        susp: { pitch: 0, roll: 0, bounce: 0, vb: 0 },
        splits: [],
        lastSector: -1,
        lapTimes: [],
      };
      if (isPlayer) this.player = r;
      this.racers.push(r);
    }
    if (opts.mode === GameMode.AGAINST_CLOCK) this.loadGhost();
    this.syncModels(0);
  }

  get ghostKey() {
    return `nk-ghost-${this.opts.course.id}-${this.opts.speed}`;
  }

  private loadGhost() {
    try {
      const raw = localStorage.getItem(this.ghostKey);
      if (!raw) return;
      const d = JSON.parse(raw) as { t: number[]; p: number[] };
      const frames: GhostFrame[] = d.t.map((t, k) => ({ t, x: d.p[k * 4] / 10, y: d.p[k * 4 + 1] / 10, z: d.p[k * 4 + 2] / 10, h: d.p[k * 4 + 3] / 1000 }));
      const model = new KartModel({ color: 0x9fd8ff, accent: 0x9fd8ff, helmet: 0xffffff, number: 0 }, false);
      model.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.32, depthWrite: false });
          m.castShadow = false;
        }
      });
      this.group.add(model.root);
      this.ghost = { frames, model };
    } catch {
      this.ghost = null;
    }
  }

  private saveGhost() {
    try {
      const t: number[] = [];
      const p: number[] = [];
      for (const f of this.ghostRec) {
        t.push(Math.round(f.t * 100) / 100);
        p.push(Math.round(f.x * 10), Math.round(f.y * 10), Math.round(f.z * 10), Math.round(f.h * 1000));
      }
      localStorage.setItem(this.ghostKey, JSON.stringify({ t, p }));
    } catch {
      /* storage full or disabled: ghost is a convenience */
    }
  }

  startCountdown() {
    this.phase = "countdown";
    this.countdown = 3.999;
    this.lastCountBeep = 4;
  }

  /** returns racers sorted by progress (first = leader) */
  standings(): Racer[] {
    return [...this.racers].sort((a, b) => {
      if (a.finishTime >= 0 && b.finishTime >= 0) return a.finishTime - b.finishTime;
      if (a.finishTime >= 0) return -1;
      if (b.finishTime >= 0) return 1;
      return b.kart.progress - a.kart.progress;
    });
  }

  respawnPlayer() {
    if (this.phase !== "racing") return;
    this.player.kart.respawn();
    this.skids.add(10, null, 0, 0, 0);
    this.skids.add(11, null, 0, 0, 0);
  }

  update(dt: number) {
    if (this.phase === "countdown") {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n < this.lastCountBeep && n >= 1) {
        this.audio.beep(520, 0.2, 0.25);
        this.lastCountBeep = n;
      }
      // start lights: one more red lamp per second, all off at GO
      const lit = Math.min(5, Math.floor((3.999 - this.countdown) * 5 / 3.999) + 1);
      this.startLamps.forEach((l, k) => ((l.material as THREE.MeshBasicMaterial).color.setHex(k < lit ? 0xff2010 : 0x330000)));
      if (this.countdown <= 0) {
        this.phase = "racing";
        this.time = 0;
        this.audio.beep(1040, 0.5, 0.3);
        this.startLamps.forEach((l) => (l.material as THREE.MeshBasicMaterial).color.setHex(0x20ff40));
        this.events.push({ text: "GO!", t: 0 });
      }
    }
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 12) {
      this.fixedStep(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    this.syncModels(dt);
    this.smoke.update(dt);
    this.glow.update(dt);
    for (const e of this.events) e.t += dt;
    this.events = this.events.filter((e) => e.t < 2.5);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  private fixedStep(dt: number) {
    const racing = this.phase === "racing";
    // the clock keeps running after the player finishes so the bots still get finish times
    if (racing || this.phase === "finished") this.time += dt;
    for (const r of this.racers) {
      r.brain.tick(dt, r.kart);
      const input = racing || this.phase === "finished" ? r.brain.input : { throttle: 0, steer: 0, drift: false };
      r.kart.frozen = !(racing || this.phase === "finished");
      r.kart.step(dt, input);
      this.kartEvents(r);
      if (racing || (this.phase === "finished" && r.finishTime < 0)) this.raceLogic(r, dt);
    }
    this.collideKarts();
    this.updateBombs(dt);
    if (racing) this.items(dt);
    if (racing && this.opts.mode === GameMode.AGAINST_CLOCK) {
      this.ghostT += dt;
      if (this.ghostT >= 0.1) {
        this.ghostT = 0;
        const k = this.player.kart;
        this.ghostRec.push({ t: this.time, x: k.pos.x, y: k.pos.y, z: k.pos.z, h: k.heading });
      }
    }
  }

  private kartEvents(r: Racer) {
    const k = r.kart;
    const e = k.events;
    if (r.isPlayer) {
      if (e.railHit > 2) {
        this.audio.impact(e.railHit);
        this.shake = Math.min(1, this.shake + e.railHit * 0.05);
      }
      if (e.landed > 2.5) {
        this.audio.landing(e.landed);
        this.shake = Math.min(1, this.shake + e.landed * 0.04);
      }
      if (e.boostFired) this.audio.boost();
    }
    if (e.railHit > 3) {
      for (let n = 0; n < Math.min(14, e.railHit); n++) {
        this.glow.emit({
          x: k.pos.x, y: k.pos.y + 0.3, z: k.pos.z,
          vx: (Math.random() - 0.5) * 8 + k.vel.x * 0.5, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 8 + k.vel.z * 0.5,
          max: 0.35 + Math.random() * 0.3, size0: 0.12, size1: 0.02, r: 1, g: 0.75, b: 0.35, a: 1, drag: 2, grav: 9,
        });
      }
    }
    if (e.landed > 3) r.susp.vb -= e.landed * 0.25;
  }

  private raceLogic(r: Racer, dt: number) {
    const k = r.kart;
    const course = this.opts.course;
    // sector splits (player)
    const secIdx = this.track.sectors.indexOf(this.track.sectorAt(k.q.s));
    if (secIdx !== r.lastSector) {
      if (r.lastSector >= 0 && k.progress > 0) r.splits.push(this.time);
      r.lastSector = secIdx;
    }
    // laps
    if (course.laps > 1 && r.lapTimes.length < course.laps) {
      const done = Math.floor(k.progress / this.track.length + 1e-6);
      if (done > r.lapTimes.length && k.progress > 0) {
        r.lapTimes.push(this.time);
        const left = course.laps - r.lapTimes.length;
        if (r.isPlayer && left > 0) {
          const prev = r.lapTimes.length > 1 ? r.lapTimes[r.lapTimes.length - 2] : 0;
          this.events.push({ text: `${left === 1 ? "最后一圈！" : `第 ${r.lapTimes.length + 1} 圈`} · 上圈 ${(this.time - prev).toFixed(2)} s`, t: 0 });
          this.audio.beep(880, 0.15, 0.2);
        }
      }
    }
    // finish (OSK: last loop checkpoint reached)
    if (r.finishTime < 0 && k.progress >= course.distance) {
      r.finishTime = this.time;
      if (r.isPlayer) {
        this.audio.chime();
        this.phase = "finished";
        if (this.opts.mode === GameMode.AGAINST_CLOCK) {
          const best = this.bestTime();
          if (best < 0 || r.finishTime < best) this.saveGhost();
        }
        this.saveBest(r.finishTime);
        // the player is handed to a bot brain so the kart keeps rolling naturally
        r.brain = new BotBrain(this.track, k.maxSpeed * 0.6, 0.8, 0);
        this.onFinish?.();
      }
    }
    // bots: OSK respawns bots stuck for RESPAWN_BOT_AFTER_STUCK_FOR_SECONDS
    if (k.speed < 1) r.stuck += dt;
    else r.stuck = 0;
    if (!r.isPlayer && r.stuck > 5) {
      k.respawn();
      r.stuck = 0;
    }
    // wrong way detection
    const th = Math.atan2(this.track.tx[k.q.i], -this.track.tz[k.q.i]);
    let d = th - k.heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > 2.0 && k.speed > 2) r.wrongWay += dt;
    else r.wrongWay = Math.max(0, r.wrongWay - dt * 2);
    if (!r.isPlayer && r.wrongWay > 4) {
      k.respawn();
      r.wrongWay = 0;
    }
  }

  private items(dt: number) {
    const st = this.standings();
    const leader = st[0];
    st.forEach((r, k) => (r.rank = k + 1));
    for (const r of this.racers) {
      if (!r.slots) continue;
      let use = false;
      if (r.isPlayer) use = r.brain.useItem;
      else if (r.brain instanceof BotBrain && r.finishTime < 0) {
        const first = r.slots.first();
        if (first === SlotItem.SPEED_BOOST) use = r.brain.wantsItem("boost", r.kart, false);
        if (first === SlotItem.AIR_BOMB) {
          const target = this.racers.some((o) => o !== r && o.kart.progress - r.kart.progress > 35 && o.kart.progress - r.kart.progress < 95);
          use = r.brain.wantsItem("bomb", r.kart, target);
        }
      }
      const used = r.slots.tick(dt, Math.max(0, leader.kart.progress - r.kart.progress), use, r.rank);
      if (used === SlotItem.SPEED_BOOST) r.kart.applySpeedBoost(2.5);
      if (used === SlotItem.AIR_BOMB) this.launchBomb(r);
    }
  }

  private launchBomb(r: Racer) {
    const k = r.kart;
    const fx = Math.sin(k.heading);
    const fz = -Math.cos(k.heading);
    const v = (30 + k.speed) * 0.85;
    const b = new AirBomb(new THREE.Vector3(k.pos.x + fx * 1.5, k.pos.y + 1.6, k.pos.z + fz * 1.5), new THREE.Vector3(fx * v, 10, fz * v), r);
    this.bombs.push(b);
    this.group.add(b.mesh);
    if (r.isPlayer) this.audio.launch();
  }

  private updateBombs(dt: number) {
    const q = { i: 0, t: 0, s: 0, lat: 0, half: 0, yc: 0, bank: 0 };
    for (const b of this.bombs) {
      b.age += dt;
      if (b.exploding < 0) {
        b.vel.y -= 9.81 * dt;
        b.pos.addScaledVector(b.vel, dt);
        this.track.query(b.pos.x, b.pos.z, -1, q);
        const gy = this.track.surfaceY(q, Math.max(-q.half - this.track.verge, Math.min(q.half + this.track.verge, q.lat)));
        let hit = b.pos.y - 0.3 <= gy || b.age > 8;
        for (const r of this.racers) if (r !== b.owner && r.kart.pos.distanceTo(b.pos) < 1.4) hit = true;
        if (hit) {
          b.exploding = 0;
          b.pos.y = Math.max(b.pos.y, gy + 0.3);
          b.aura.visible = true;
          this.audio.explosion(b.pos.distanceTo(this.player.kart.pos));
          for (let n = 0; n < 40; n++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 4 + Math.random() * 10;
            this.glow.emit({ x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: Math.cos(a) * sp, vy: Math.random() * 9, vz: Math.sin(a) * sp, max: 0.6 + Math.random() * 0.5, size0: 1.6, size1: 0.4, r: 1, g: 0.55 + Math.random() * 0.3, b: 0.2, a: 1, drag: 2.5, grav: 4 });
            this.smoke.emit({ x: b.pos.x, y: b.pos.y + 1, z: b.pos.z, vx: Math.cos(a) * sp * 0.4, vy: 2 + Math.random() * 3, vz: Math.sin(a) * sp * 0.4, max: 2 + Math.random(), size0: 2, size1: 6, r: 0.25, g: 0.24, b: 0.23, a: 0.6, drag: 1.2, grav: -0.5 });
          }
          if (b.pos.distanceTo(this.player.kart.pos) < 40) this.shake = 1;
        }
      } else {
        b.exploding += dt;
        const t = b.exploding / EXPLOSION_DURATION_SECONDS;
        b.aura.scale.setScalar(EXPLOSION_RADIUS * Math.min(1, t));
        (b.aura.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - t);
        // OSK: intensity falls off with time and distance, mostly upwards
        for (const r of this.racers) {
          if (b.hit.has(r)) continue;
          const d = r.kart.pos.distanceTo(b.pos);
          if (d > EXPLOSION_RADIUS * Math.min(1, t)) continue;
          b.hit.add(r);
          const ti = 1 - Math.min(1, t);
          const di = 1 - d / EXPLOSION_RADIUS;
          const k = r.kart;
          const dir = k.pos.clone().sub(b.pos).setY(0).normalize();
          k.vel.addScaledVector(dir, 4 * di * (0.5 + ti));
          k.vel.y += 8 * di + 2;
          k.vel.x *= 0.7;
          k.vel.z *= 0.7;
          k.pos.y += 0.1;
          k.grounded = false;
          k.spin = 0.6 + 0.6 * di;
          k.endDrift();
          if (r.isPlayer) {
            this.events.push({ text: "被炸弹击中!", t: 0 });
            this.shake = 1;
          } else if (b.owner === this.player) this.events.push({ text: `命中 ${r.name}!`, t: 0 });
        }
        if (b.exploding > EXPLOSION_DURATION_SECONDS) b.done = true;
      }
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += dt * 6;
    }
    for (const b of this.bombs) if (b.done) this.group.remove(b.mesh);
    this.bombs = this.bombs.filter((b) => !b.done);
  }

  private collideKarts() {
    const R = 0.95;
    for (let a = 0; a < this.racers.length; a++) {
      for (let b = a + 1; b < this.racers.length; b++) {
        const ka = this.racers[a].kart;
        const kb = this.racers[b].kart;
        const dx = kb.pos.x - ka.pos.x;
        const dz = kb.pos.z - ka.pos.z;
        const dy = Math.abs(kb.pos.y - ka.pos.y);
        const d2 = dx * dx + dz * dz;
        if (d2 > 4 * R * R || dy > 1.2 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const pen = 2 * R - d;
        ka.pos.x -= nx * pen * 0.5;
        ka.pos.z -= nz * pen * 0.5;
        kb.pos.x += nx * pen * 0.5;
        kb.pos.z += nz * pen * 0.5;
        const rel = (kb.vel.x - ka.vel.x) * nx + (kb.vel.z - ka.vel.z) * nz;
        if (rel < 0) {
          const j = -rel * 0.65;
          ka.vel.x -= nx * j;
          ka.vel.z -= nz * j;
          kb.vel.x += nx * j;
          kb.vel.z += nz * j;
          if (this.racers[a].isPlayer || this.racers[b].isPlayer) {
            this.audio.impact(-rel * 0.8);
            this.shake = Math.min(1, this.shake - rel * 0.06);
          }
        }
      }
    }
    // bots dodge karts right in front of them
    for (const r of this.racers) {
      if (!(r.brain instanceof BotBrain)) continue;
      let avoid = 0;
      for (const o of this.racers) {
        if (o === r) continue;
        const ds = o.kart.progress - r.kart.progress;
        if (ds > 0 && ds < 14) {
          const dl = o.kart.q.lat - r.kart.q.lat;
          if (Math.abs(dl) < 1.8) avoid = dl > 0 ? -2.2 : 2.2;
        }
      }
      r.brain.avoid += (avoid - r.brain.avoid) * 0.05;
    }
  }

  private syncModels(dt: number) {
    const up = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    const left = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (const r of this.racers) {
      const k = r.kart;
      up.copy(k.normal);
      fwd.set(Math.sin(k.heading), 0, -Math.cos(k.heading));
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      left.crossVectors(up, fwd).normalize();
      m.makeBasis(left, up, fwd);
      r.model.root.quaternion.setFromRotationMatrix(m);
      r.model.root.position.copy(k.pos);
      // suspension feel: dive / squat from longitudinal accel, lean from yaw rate
      const s = r.susp;
      if (dt > 0) {
        const fs = k.forwardSpeed;
        const targetPitch = THREE.MathUtils.clamp(-(r.brain.input.throttle < 0 && fs > 2 ? 0.035 : -0.012 * r.brain.input.throttle), -0.05, 0.05);
        const targetRoll = THREE.MathUtils.clamp(k.yawRate * fs * 0.0022, -0.07, 0.07);
        s.pitch += (targetPitch - s.pitch) * (1 - Math.exp(-dt * 6));
        s.roll += (targetRoll - s.roll) * (1 - Math.exp(-dt * 6));
        // bounce spring
        s.vb += (-s.bounce * 220 - s.vb * 14) * dt;
        s.bounce += s.vb * dt;
        if (k.offTrack && k.grounded) s.vb += (Math.random() - 0.5) * k.speed * 0.08;
      }
      r.model.animate(dt, k.forwardSpeed, r.brain.input.steer * (k.spin > 0 ? 0 : 1), s.pitch, s.roll, s.bounce);
      // effects
      if (dt > 0) this.kartFx(r, dt);
    }
    if (this.ghost && this.phase === "racing") {
      const f = this.ghost.frames;
      let i = 0;
      while (i < f.length - 2 && f[i + 1].t < this.time) i++;
      const a = f[i];
      const b = f[Math.min(f.length - 1, i + 1)];
      const t = b.t > a.t ? THREE.MathUtils.clamp((this.time - a.t) / (b.t - a.t), 0, 1) : 0;
      let dh = b.h - a.h;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      const g = this.ghost.model.root;
      g.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      g.rotation.set(0, Math.PI - (a.h + dh * t), 0);
      g.visible = this.time < f[f.length - 1].t + 1;
    }
  }

  private kartFx(r: Racer, dt: number) {
    const k = r.kart;
    const rx = Math.cos(k.heading);
    const rz = Math.sin(k.heading);
    const fx = Math.sin(k.heading);
    const fz = -Math.cos(k.heading);
    const vR = k.vel.x * rx + k.vel.z * rz;
    const slip = Math.abs(vR);
    const near = r.isPlayer || k.pos.distanceToSquared(this.player.kart.pos) < 120 * 120;
    if (!near) return;
    // rear wheel positions
    for (let w = 0; w < 2; w++) {
      const side = w === 0 ? 1 : -1;
      const px = k.pos.x - fx * 0.55 - rx * 0.62 * side;
      const pz = k.pos.z - fz * 0.55 - rz * 0.62 * side;
      const sliding = k.grounded && !k.offTrack && (k.drifting || slip > 2.5);
      const id = (r.isPlayer ? 10 : 20 + this.racers.indexOf(r) * 2) + w;
      this.skids.add(id, sliding ? new THREE.Vector3(px, k.pos.y + 0.02, pz) : null, rx, rz, Math.min(1, slip / 6 + (k.drifting ? 0.4 : 0)));
      if (sliding && Math.random() < dt * 40) {
        this.smoke.emit({ x: px, y: k.pos.y + 0.15, z: pz, vx: k.vel.x * 0.2 + (Math.random() - 0.5), vy: 0.6 + Math.random() * 0.6, vz: k.vel.z * 0.2 + (Math.random() - 0.5), max: 1.2 + Math.random() * 0.6, size0: 0.5, size1: 2.6, r: 0.85, g: 0.85, b: 0.86, a: 0.35, drag: 1.4, grav: -0.3 });
      }
      if (k.offTrack && k.grounded && k.speed > 4 && Math.random() < dt * 30) {
        this.smoke.emit({ x: px, y: k.pos.y + 0.1, z: pz, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 2, max: 1.0, size0: 0.4, size1: 1.8, r: 0.42, g: 0.36, b: 0.24, a: 0.5, drag: 1.5, grav: 1 });
      }
      // drift sparks colour = charge (blue -> orange), like OSK's drift particles
      if (k.drifting && Math.random() < dt * 50) {
        const charged = k.driftTime > 1.0;
        this.glow.emit({ x: px, y: k.pos.y + 0.1, z: pz, vx: -fx * 2 + (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2, vz: -fz * 2 + (Math.random() - 0.5) * 2, max: 0.25, size0: 0.18, size1: 0.05, r: charged ? 1 : 0.4, g: charged ? 0.6 : 0.7, b: charged ? 0.2 : 1, a: 1, drag: 3, grav: 6 });
      }
    }
    // boost flames from the exhaust (OSK SpeedGPUParticles3D)
    if (k.isBoosting() && Math.random() < dt * 90) {
      const ex = k.pos.x - fx * 1.05 - rx * 0.42 * -1;
      const ez = k.pos.z - fz * 1.05 - rz * 0.42 * -1;
      this.glow.emit({ x: ex, y: k.pos.y + 0.42, z: ez, vx: -fx * 6 + k.vel.x * 0.8, vy: 0.5, vz: -fz * 6 + k.vel.z * 0.8, max: 0.22, size0: 0.55, size1: 0.1, r: 0.5, g: 0.75, b: 1, a: 1, drag: 4, grav: 0 });
    }
  }

  bestTime(): number {
    try {
      const v = localStorage.getItem(`nk-best-${this.opts.course.id}-${this.opts.speed}`);
      return v ? parseFloat(v) : -1;
    } catch {
      return -1;
    }
  }

  private saveBest(t: number) {
    try {
      const b = this.bestTime();
      if (b < 0 || t < b) localStorage.setItem(`nk-best-${this.opts.course.id}-${this.opts.speed}`, String(t));
    } catch {
      /* ignore */
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.startLamps.forEach((l) => (l.material as THREE.MeshBasicMaterial).color.setHex(0x330000));
  }
}
