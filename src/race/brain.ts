// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Car brains (OSK ACarBrain / UserBrain / BotBrain): turn input or the race path
// into the forward/backward + left/right axes and the drift / item buttons.
import { Kart, KartInput } from "./kart";
import { Track } from "../track";

export interface Brain {
  input: KartInput;
  useItem: boolean;
  tick(dt: number, kart: Kart): void;
}

export class Controls {
  keys = new Set<string>();
  touch = { steer: 0, throttle: 0, brake: 0, drift: false, item: false };
  private pressed = new Set<string>();

  constructor() {
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());
  }

  /** true once per key press */
  consume(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  endFrame() {
    this.pressed.clear();
  }

  gamepad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }
}

export class UserBrain implements Brain {
  input: KartInput = { throttle: 0, steer: 0, drift: false };
  useItem = false;
  private steerSmoothed = 0;
  private padItemLatch = false;

  constructor(private c: Controls) {}

  tick(dt: number) {
    const k = this.c.keys;
    let thr = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    let steerRaw = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let drift = k.has("Space") || k.has("ShiftLeft") || k.has("ShiftRight");
    let item = this.c.consume("KeyE") || this.c.consume("ControlLeft") || this.c.consume("KeyF");
    const pad = this.c.gamepad();
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) steerRaw = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.4;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05 || lt > 0.05) thr = rt - lt;
      if (pad.buttons[0]?.pressed) thr = Math.max(thr, 1);
      if (pad.buttons[1]?.pressed || pad.buttons[5]?.pressed || pad.buttons[4]?.pressed) drift = true;
      const pi = !!pad.buttons[2]?.pressed || !!pad.buttons[3]?.pressed;
      if (pi && !this.padItemLatch) item = true;
      this.padItemLatch = pi;
    }
    const t = this.c.touch;
    if (t.throttle || t.brake) thr = t.throttle - t.brake;
    if (t.steer) steerRaw = t.steer;
    if (t.drift) drift = true;
    if (t.item) {
      item = true;
      t.item = false;
    }
    // keyboard steering eases in so small corrections are possible
    const rate = steerRaw === 0 ? 9 : Math.sign(steerRaw) !== Math.sign(this.steerSmoothed) ? 12 : 5.5;
    this.steerSmoothed += (steerRaw - this.steerSmoothed) * (1 - Math.exp(-dt * rate));
    this.input.throttle = thr;
    this.input.steer = Math.abs(steerRaw) < 1 && pad ? steerRaw : this.steerSmoothed;
    this.input.drift = drift;
    this.useItem = item;
  }
}

/** OSK BotBrain: follow the race path. Here the path is the precomputed racing line. */
export class BotBrain implements Brain {
  input: KartInput = { throttle: 0, steer: 0, drift: false };
  useItem = false;
  /** precomputed target speed per sample */
  private vTarget: Float32Array;
  private wobble = Math.random() * 100;
  avoid = 0;
  private itemCooldown = 2 + Math.random() * 4;

  constructor(private track: Track, maxSpeed: number, readonly skill: number, readonly lineBias: number) {
    const N = track.N;
    this.vTarget = new Float32Array(N);
    const aLat = 15.5 * skill;
    for (let i = 0; i < N; i++) {
      const c = Math.abs(track.lineCurv[i]);
      this.vTarget[i] = Math.min(maxSpeed * (0.94 + 0.06 * skill), Math.sqrt(aLat / Math.max(c, 1e-5)));
    }
    // backward pass: brake in time (decel ~ 16 m/s^2)
    const decel = 15 * skill;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = N * 2 - 1; k >= 0; k--) {
        const i = k % N;
        const j = (i + 1) % N;
        const lim = Math.sqrt(this.vTarget[j] ** 2 + 2 * decel * track.step);
        if (this.vTarget[i] > lim) this.vTarget[i] = lim;
      }
    }
  }

  targetSpeedAt(i: number) {
    return this.vTarget[i];
  }

  tick(dt: number, kart: Kart) {
    const tr = this.track;
    const q = kart.q;
    const v = kart.speed;
    this.wobble += dt;
    const look = Math.max(7, v * 0.42);
    const f = tr.frameAt(q.s + look, { x: 0, y: 0, z: 0, tx: 0, tz: 0, i: 0, half: 0, bank: 0 });
    const latTarget = Math.max(-f.half + 1.2, Math.min(f.half - 1.2, tr.line[f.i] * 0.92 + this.lineBias + this.avoid + Math.sin(this.wobble * 0.37) * 0.25));
    const tx = f.x - f.tz * latTarget;
    const tz = f.z + f.tx * latTarget;
    const want = Math.atan2(tx - kart.pos.x, -(tz - kart.pos.z));
    let d = want - kart.heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.input.steer = Math.max(-1, Math.min(1, d * 3.2));
    // speed: look a little ahead for braking
    const ia = tr.wrap(q.i + Math.round((v * 0.25) / tr.step));
    const vt = Math.min(this.vTarget[q.i], this.vTarget[ia]) * (kart.offTrack ? 0.8 : 1);
    const err = vt - v;
    this.input.throttle = err > 1.5 ? 1 : err < -2.5 ? -1 : Math.max(-0.3, Math.min(1, err / 1.5));
    if (Math.abs(d) > 1.6) {
      // facing the wrong way (spun in a pile-up): stop, then turn round going forwards.
      // `speed` is unsigned, so judge by forward speed or a reversing kart keeps reversing
      const fs = kart.forwardSpeed;
      this.input.throttle = fs > 3 ? -1 : fs < -1 ? 1 : 0.6;
      this.input.steer = d > 0 ? 1 : -1;
    }
    this.input.drift = false;
    // items: boost on straights, bombs when someone is close ahead (decided by the race)
    this.itemCooldown -= dt;
    this.useItem = false;
  }

  wantsItem(kind: "boost" | "bomb", kart: Kart, targetAhead: boolean): boolean {
    if (this.itemCooldown > 0) return false;
    let ok = false;
    if (kind === "boost") {
      const ahead = this.track.wrap(kart.q.i + 60);
      ok = Math.abs(this.track.lineCurv[kart.q.i]) < 0.004 && Math.abs(this.track.lineCurv[ahead]) < 0.004 && kart.speed > kart.maxSpeed * 0.7;
    } else ok = targetAhead;
    if (ok) this.itemCooldown = 3 + Math.random() * 5;
    return ok;
  }
}
