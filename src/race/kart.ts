// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Kart physics, ported from Open Street Kart prefabs/car_custom_physics_2.gd.
// OSK drives a Jolt rigid body with four raycast springs; on the web we integrate
// the same arcade rules directly against the analytic road surface:
//  - forward force from the forward/backward axis, BRAKE_FORCE_FACTOR / BACKWARDS_FORCE_FACTOR
//  - yaw from the left/right axis, drift = axis * DRIFT_LEFT_RIGHT_FACTOR + DRIFT_ADDED_DIRECTION_MULTIPLIER * dir
//  - centrifugal force cancelled (= lateral grip), 0.7 of it kept while drifting
//  - DIRECTION_NERF_IN_AIR / FORWARD_BACKWARD_NERF_IN_AIR
//  - quadratic "soft clamp" of the xz speed, out of bounds speed limit, SPEED_BOOST
import * as THREE from "three";
import { Track, TrackQuery } from "../track";

export const DRIFT_LEFT_RIGHT_FACTOR = 1.2;
export const DRIFT_ADDED_DIRECTION_MULTIPLIER = 1.6;
const BRAKE_FORCE_FACTOR = 0.1;
const BACKWARDS_FORCE_FACTOR = 0.7;
const MIN_SPEED_FOR_BEING_BRAKE_SQUARED = 4;
const DIRECTION_NERF_IN_AIR = 0.1;
const FORWARD_BACKWARD_NERF_IN_AIR = 0.1;
export const SPEED_BOOST = 1.5;
const GRAVITY = 9.81;
const KART_HALF_WIDTH = 0.72;

export interface KartInput {
  /** forward/backward axis, -1..1 */
  throttle: number;
  /** left/right axis, -1 (left) .. 1 (right) */
  steer: number;
  drift: boolean;
}

export interface KartEvents {
  railHit: number; // impact speed (m/s) this step
  landed: number; // vertical landing speed this step
  boostFired: boolean;
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

  drifting = false;
  driftDir = 0;
  driftTime = 0;
  boostUntil = -1;
  now = 0;
  goingBackwards = false;
  offTrack = false;
  /** total signed distance driven along the loop since spawn (lap progress) */
  progress = 0;
  private lastS = 0;
  /** last respawn point passed (OSK TrackCheckpoint): distance along the lap */
  checkpointS = 0;
  readonly events: KartEvents = { railHit: 0, landed: 0, boostFired: false };
  /** spin-out timer (air bomb) */
  spin = 0;
  frozen = false;

  constructor(readonly track: Track) {}

  isBoosting() {
    return this.now < this.boostUntil;
  }

  applySpeedBoost(seconds: number) {
    this.boostUntil = Math.max(this.boostUntil, this.now + seconds);
    this.events.boostFired = true;
  }

  clearSpeedBoost() {
    this.boostUntil = -1;
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
    this.drifting = false;
    this.driftDir = 0;
    this.driftTime = 0;
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
    this.clearSpeedBoost();
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
    this.now += dt;
    this.events.railHit = 0;
    this.events.landed = 0;
    this.events.boostFired = false;
    if (this.frozen) return;
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
    let braking = false;
    if (fb < 0) {
      const goingForward = vF > 0.1;
      const goingFast = vF * vF > MIN_SPEED_FOR_BEING_BRAKE_SQUARED;
      if (goingForward && goingFast) {
        braking = true;
        this.goingBackwards = false;
      } else {
        fb *= BACKWARDS_FORCE_FACTOR;
        this.goingBackwards = true;
      }
    } else {
      this.goingBackwards = vF < -0.5;
    }

    // ---- drift (OSK: needs turning, not already drifting, on ground)
    if (input.drift && Math.abs(lr) > 0.2 && this.driftDir === 0 && onGround && vF > 6) {
      this.drifting = true;
      this.driftDir = Math.sign(lr);
      this.driftTime = 0;
    }
    if ((!input.drift || vF < 4) && this.drifting) {
      // releasing a long drift gives a short mini-turbo (blue sparks -> orange sparks)
      if (!input.drift && onGround) {
        if (this.driftTime > 2.0) this.applySpeedBoost(1.1);
        else if (this.driftTime > 1.0) this.applySpeedBoost(0.6);
      }
      this.endDrift();
    }
    if (this.drifting) {
      this.driftTime += dt;
      // OSK: left_right = left_right * 1.2 + 1.6 * dir  (normalised to our yaw scale)
      lr = (lr * DRIFT_LEFT_RIGHT_FACTOR + DRIFT_ADDED_DIRECTION_MULTIPLIER * this.driftDir) / (DRIFT_LEFT_RIGHT_FACTOR + DRIFT_ADDED_DIRECTION_MULTIPLIER);
    }
    if (!onGround) {
      lr *= DIRECTION_NERF_IN_AIR;
      fb *= FORWARD_BACKWARD_NERF_IN_AIR;
    }

    // ---- longitudinal
    let aF = 0;
    if (braking) {
      // OSK brakes with 10% of the engine force on a light kart; at Nordschleife speeds
      // that would never stop, so the factor scales the much larger brake decel instead.
      aF -= 26 * Math.min(1, -input.throttle) * (BRAKE_FORCE_FACTOR / 0.1) * (onGround ? 1 : 0.1);
    } else {
      const powerFade = fb > 0 ? Math.max(0.15, 1 - (Math.max(0, vF) / (this.maxSpeed * 1.05)) ** 2) : 1;
      aF += fb * this.accel * powerFade;
    }
    if (this.isBoosting() && onGround) aF += this.accel * 2 * (1 - Math.min(1, vF / (this.maxSpeed * SPEED_BOOST)));
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
    vF += aF * dt;

    // ---- yaw (OSK: torque from left_right; we drive the yaw rate directly)
    const speedAbs = Math.abs(vF);
    const lowSpeed = Math.min(1, speedAbs / 4);
    let yawMax = Math.min(2.4, this.aLatMax / Math.max(speedAbs, 3)) * lowSpeed;
    if (this.drifting) yawMax *= 1.42;
    const dirSign = vF >= 0 ? 1 : -1;
    const targetYaw = lr * yawMax * dirSign;
    const yawResp = onGround ? (this.drifting ? 5 : 9) : 1.2;
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

    // ---- lateral grip (OSK _cancel_inertia: counter the centrifugal force, 70% of it while drifting)
    const grip = !onGround ? 0.25 : this.drifting ? 2.4 : this.offTrack ? 5.5 : 11;
    vR2 *= Math.exp(-grip * dt);

    // ---- soft clamp of the xz speed (OSK _soft_clamp_speed: smooth, never a hard stop)
    let vmax: number;
    if (this.goingBackwards) vmax = this.outOfBoundsSpeed * 0.6;
    else if (this.offTrack && !this.isBoosting()) vmax = this.outOfBoundsSpeed;
    else if (this.isBoosting()) vmax = this.maxSpeed * SPEED_BOOST;
    else vmax = this.maxSpeed;
    const sp = Math.hypot(vF2, vR2);
    if (sp > vmax && onGround) {
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

  endDrift() {
    this.drifting = false;
    this.driftDir = 0;
    this.driftTime = 0;
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
      if (this.drifting && vOut > 3) this.endDrift();
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
