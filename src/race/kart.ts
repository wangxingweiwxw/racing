// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Kart physics, ported from Open Street Kart prefabs/car_custom_physics_2.gd.
// OSK drives a Jolt rigid body with four raycast springs; on the web we integrate
// driving forces, tyre grip and road contacts against the analytic surface.
import * as THREE from "three";
import type { Track, TrackQuery } from "../track";

export const REVERSE_HOLD_SECONDS = 2;
export const REVERSE_MAX_SPEED = 5 / 3.6;
const STOP_SPEED = 0.05;
const DIRECTION_NERF_IN_AIR = 0.1;
const FORWARD_BACKWARD_NERF_IN_AIR = 0.1;
const GRAVITY = 9.81;
const KART_HALF_WIDTH = 1.06;

export interface KartInput {
  /** accelerator/brake axis, -1..1; hold brake at rest to reverse */
  throttle: number;
  /** left/right axis, -1 (left) .. 1 (right) */
  steer: number;
}

export interface KartEvents {
  railHit: number; // impact speed (m/s) this step
  landed: number; // vertical landing speed this step
}

export class Kart {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  heading = 0; // 0 = north (-z), clockwise positive
  yawRate = 0;
  grounded = true;
  airTime = 0;
  /** smoothed surface normal used for the body orientation */
  readonly normal = new THREE.Vector3(0, 1, 0);
  readonly q: TrackQuery = { i: 0, t: 0, s: 0, lat: 0, half: 5, yc: 0, bank: 0 };
  private hint = -1;

  maxSpeed = 30;
  outOfBoundsSpeed = 8;
  /** OSK acceleration_force / mass, scaled for the Nordschleife */
  accel = 11;
  aLatMax = 17;

  reverseHoldTime = 0;
  private reverseEngaged = false;
  goingBackwards = false;
  offTrack = false;
  /** total signed distance driven along the loop since spawn (lap progress) */
  progress = 0;
  private lastS = 0;
  /** last respawn point passed (OSK TrackCheckpoint): distance along the lap */
  checkpointS = 0;
  readonly events: KartEvents = { railHit: 0, landed: 0 };
  /** spin-out timer (air bomb) */
  spin = 0;
  frozen = false;

  constructor(readonly track: Track) {}

  resetBrakeHold() {
    this.reverseHoldTime = 0;
    this.reverseEngaged = false;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get forwardSpeed() {
    return this.vel.x * Math.sin(this.heading) - this.vel.z * Math.cos(this.heading);
  }

  /** place the kart on the track at distance s, lateral offset lat */
  placeAt(s: number, lat: number, progress: number) {
    const f = this.track.frameAt(s, { x: 0, y: 0, z: 0, tx: 0, tz: 0, i: 0, half: 0, bank: 0 });
    const rx = -f.tz;
    const rz = f.tx;
    this.pos.set(f.x + rx * lat, 0, f.z + rz * lat);
    this.hint = -1;
    this.track.query(this.pos.x, this.pos.z, this.hint, this.q);
    this.hint = this.q.i;
    this.pos.y = this.track.surfaceY(this.q) + 0.02;
    this.heading = Math.atan2(f.tx, -f.tz);
    this.vel.set(0, 0, 0);
    this.yawRate = 0;
    this.resetBrakeHold();
    this.goingBackwards = false;
    this.grounded = true;
    this.spin = 0;
    this.lastS = this.q.s;
    this.progress = progress;
    this.checkpointS = s;
    this.normal.set(0, 1, 0);
  }

  /** OSK CarCustomPhysics2.respawn(): back to the last checkpoint, facing the track */
  respawn() {
    const base = this.progress - this.track.deltaS(this.checkpointS, this.q.s);
    this.placeAt(this.checkpointS, 0, base);
  }

  private surfaceNormal(out: THREE.Vector3) {
    // finite differences on the analytic surface
    const e = 0.9;
    const q = this.q;
    const tr = this.track;
    const i = q.i;
    const fx = tr.tx[i];
    const fz = tr.tz[i];
    const rx = -fz;
    const rz = fx;
    const j = tr.wrap(i + 1);
    const k = tr.wrap(i - 1);
    const qa: TrackQuery = { ...q, yc: tr.y[j], bank: tr.bank[j] };
    const qb: TrackQuery = { ...q, yc: tr.y[k], bank: tr.bank[k] };
    const dy_ds = (tr.surfaceY(qa) - tr.surfaceY(qb)) / (2 * tr.step);
    const dy_dl = (tr.surfaceY(q, q.lat + e) - tr.surfaceY(q, q.lat - e)) / (2 * e);
    // tangent vectors: T = (fx, dy_ds, fz), R = (rx, dy_dl, rz); n = R x T
    const Tx = fx, Ty = dy_ds, Tz = fz;
    const Rx = rx, Ry = dy_dl, Rz = rz;
    out.set(Ry * Tz - Rz * Ty, Rz * Tx - Rx * Tz, Rx * Ty - Ry * Tx).normalize();
    if (out.y < 0) out.negate();
    return out;
  }

  step(dt: number, input: KartInput) {
    this.events.railHit = 0;
    this.events.landed = 0;
    if (this.frozen) { this.resetBrakeHold(); return; }
    const tr = this.track;
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const fx = sinH;
    const fz = -cosH;
    const rx = cosH;
    const rz = sinH;

    tr.query(this.pos.x, this.pos.z, this.hint, this.q);
    this.hint = this.q.i;
    const groundY = tr.surfaceY(this.q);
    const onGround = this.pos.y <= groundY + 0.06;
    this.offTrack = Math.abs(this.q.lat) > this.q.half + 0.35;

    let vF = this.vel.x * fx + this.vel.z * fz;
    let vR = this.vel.x * rx + this.vel.z * rz;

    // ---- forward / backward axis (OSK _integrate_forces)
    let fb = input.throttle;
    let lr = input.steer;
    if (this.spin > 0) {
      fb = 0;
      lr = 0;
    }
    // Braking to a stop never counts towards the two-second reverse hold.
    // Releasing the pedal disengages reverse; another press first stops the car.
    const brakeHeld = fb < -0.05;
    if (!brakeHeld || !onGround) this.resetBrakeHold();
    let holdStill = false;
    if (brakeHeld && onGround && !this.reverseEngaged) {
      if (Math.hypot(vF, vR) <= STOP_SPEED) {
        vF = vR = 0;
        this.reverseHoldTime = Math.min(REVERSE_HOLD_SECONDS, this.reverseHoldTime + dt);
        this.reverseEngaged = this.reverseHoldTime >= REVERSE_HOLD_SECONDS - 1e-9;
        holdStill = !this.reverseEngaged;
      } else this.reverseHoldTime = 0;
    }
    const braking = brakeHeld && !this.reverseEngaged;
    const brakingReverse = fb > 0 && vF < -STOP_SPEED;
    if (!onGround) {
      lr *= DIRECTION_NERF_IN_AIR;
      fb *= FORWARD_BACKWARD_NERF_IN_AIR;
    }

    // ---- longitudinal
    let aF = 0;
    if (braking || brakingReverse) {
      aF -= Math.sign(vF) * 26 * Math.min(1, Math.abs(input.throttle)) * (onGround ? 1 : 0.1);
    } else {
      const powerFade = fb > 0 ? Math.max(0.15, 1 - (Math.max(0, vF) / (this.maxSpeed * 1.05)) ** 2) : 1;
      aF += fb * (this.reverseEngaged ? 2.5 : this.accel) * powerFade;
    }
    // rolling resistance + air drag
    aF -= Math.sign(vF) * (0.25 + 0.00045 * vF * vF) * (onGround ? 1 : 0.4);
    if (this.offTrack && onGround) aF -= Math.sign(vF) * 2.2;
    // gravity along the slope
    if (onGround) {
      this.surfaceNormal(_n);
      // tangential gravity = g * (n.y * n - up) projected on forward
      const gx = GRAVITY * _n.y * _n.x;
      const gz = GRAVITY * _n.y * _n.z;
      aF += gx * fx + gz * fz;
      vR += (gx * rx + gz * rz) * dt;
    }
    if (onGround && Math.abs(vF) < 0.3 && fb === 0) vF *= 0.9;
    const previousVF = vF;
    vF += aF * dt;
    if ((braking || brakingReverse) && previousVF * vF <= 0) vF = 0;
    if (braking && onGround) vR = Math.sign(vR) * Math.max(0, Math.abs(vR) - 26 * Math.abs(input.throttle) * dt);
    // Static brakes resist gravity while waiting, including on banked slopes.
    if (holdStill) vF = vR = 0;

    // ---- yaw (OSK: torque from left_right; we drive the yaw rate directly)
    const speedAbs = Math.abs(vF);
    const lowSpeed = Math.min(1, speedAbs / 4);
    const yawMax = Math.min(2.4, this.aLatMax / Math.max(speedAbs, 3)) * lowSpeed;
    const dirSign = vF >= 0 ? 1 : -1;
    const targetYaw = lr * yawMax * dirSign;
    const yawResp = onGround ? 9 : 1.2;
    this.yawRate += (targetYaw - this.yawRate) * (1 - Math.exp(-dt * yawResp));
    if (this.spin > 0) {
      this.spin -= dt;
      this.yawRate = 7 * Math.max(0, this.spin);
    }
    this.heading += this.yawRate * dt;

    // re-express the (world fixed) horizontal velocity in the new heading frame
    const nfx = Math.sin(this.heading);
    const nfz = -Math.cos(this.heading);
    const nrx = -nfz;
    const nrz = nfx;
    const vx = fx * vF + rx * vR;
    const vz = fz * vF + rz * vR;
    let vF2 = vx * nfx + vz * nfz;
    let vR2 = vx * nrx + vz * nrz;

    // ---- lateral tyre grip
    const grip = !onGround ? 0.25 : this.offTrack ? 5.5 : 11;
    vR2 *= Math.exp(-grip * dt);

    // ---- soft clamp of the xz speed (OSK _soft_clamp_speed: smooth, never a hard stop)
    this.goingBackwards = this.reverseEngaged || vF2 < -STOP_SPEED;
    const vmax = this.offTrack ? this.outOfBoundsSpeed : this.maxSpeed;
    const sp = Math.hypot(vF2, vR2);
    if (this.goingBackwards && sp > REVERSE_MAX_SPEED) {
      vF2 *= REVERSE_MAX_SPEED / sp;
      vR2 *= REVERSE_MAX_SPEED / sp;
    } else if (sp > vmax && onGround) {
      const excess = Math.min(sp * 0.5, sp - vmax);
      const k = Math.max(0, sp - excess * 2.6 * dt) / sp;
      vF2 *= k;
      vR2 *= k;
    }
    this.vel.x = nfx * vF2 + nrx * vR2;
    this.vel.z = nfz * vF2 + nrz * vR2;

    // ---- vertical
    if (onGround) {
      // follow the surface: vertical speed from the slope under the velocity
      this.surfaceNormal(_n);
      const vy = -(_n.x * this.vel.x + _n.z * this.vel.z) / Math.max(0.2, _n.y);
      this.vel.y = vy;
    }
    this.vel.y -= GRAVITY * dt;
    this.pos.addScaledVector(this.vel, dt);

    // ---- ground contact after integration
    tr.query(this.pos.x, this.pos.z, this.hint, this.q);
    this.hint = this.q.i;
    const gy = tr.surfaceY(this.q);
    if (this.pos.y <= gy) {
      if (!this.grounded && this.airTime > 0.15) this.events.landed = Math.max(0, -this.vel.y);
      this.pos.y = gy;
      if (this.vel.y < 0) {
        this.surfaceNormal(_n);
        const vy = -(_n.x * this.vel.x + _n.z * this.vel.z) / Math.max(0.2, _n.y);
        this.vel.y = Math.max(this.vel.y, vy);
      }
      this.grounded = true;
      this.airTime = 0;
    } else {
      this.grounded = this.pos.y - gy < 0.05;
      if (!this.grounded) this.airTime += dt;
    }

    // ---- guard rails (OSK RaceLocalBoundary: here a physical Armco wall)
    this.collideRails();

    // ---- body orientation
    if (this.grounded) this.surfaceNormal(_n);
    else _n.set(0, 1, 0);
    this.normal.lerp(_n, 1 - Math.exp(-dt * (this.grounded ? 14 : 2))).normalize();

    // ---- progress along the loop
    const ds = tr.deltaS(this.lastS, this.q.s);
    this.progress += ds;
    this.lastS = this.q.s;
    // checkpoints every 250 m (OSK TrackCheckpoint respawn points)
    const cp = Math.floor(this.q.s / 250) * 250;
    if (tr.deltaS(this.checkpointS, cp) > 0 && Math.abs(this.q.lat) < this.q.half) this.checkpointS = cp;
  }

  private collideRails() {
    const tr = this.track;
    const q = this.q;
    const i = q.i;
    const j = tr.wrap(i + 1);
    const railR = tr.railR ? tr.railR[i] * (1 - q.t) + tr.railR[j] * q.t : q.half + tr.verge;
    const railL = tr.railL ? tr.railL[i] * (1 - q.t) + tr.railL[j] * q.t : q.half + tr.verge;
    const limR = railR - KART_HALF_WIDTH;
    const limL = -(railL - KART_HALF_WIDTH);
    let push = 0;
    if (q.lat > limR) push = limR - q.lat;
    else if (q.lat < limL) push = limL - q.lat;
    if (push === 0) return;
    const rx = -(tr.tz[i] * (1 - q.t) + tr.tz[j] * q.t);
    const rz = tr.tx[i] * (1 - q.t) + tr.tx[j] * q.t;
    this.pos.x += rx * push;
    this.pos.z += rz * push;
    const side = push < 0 ? 1 : -1; // wall normal points back to the track: -side
    const vOut = (this.vel.x * rx + this.vel.z * rz) * side;
    if (vOut > 0) {
      this.events.railHit = vOut;
      this.vel.x -= rx * side * vOut * 1.25;
      this.vel.z -= rz * side * vOut * 1.25;
      // scrub
      const scrub = Math.max(0.55, 1 - vOut * 0.035);
      this.vel.x *= scrub;
      this.vel.z *= scrub;
      // align with the wall
      const th = Math.atan2(tr.tx[i], -tr.tz[i]);
      let d = th - this.heading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) < Math.PI / 2) this.heading += d * Math.min(0.5, vOut * 0.04);
      this.yawRate *= 0.5;
    }
  }
}

const _n = new THREE.Vector3();

declare module "../track" {
  interface Track {
    railL?: Float32Array;
    railR?: Float32Array;
  }
}
