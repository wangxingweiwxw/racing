// Stable horizon and a swept camera boom: the look target never leads into a wall.
import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { ColliderWorld } from './physics/colliders.ts';
import type { Vehicle } from './physics/vehicle.ts';
const UP = new Vector3(0, 1, 0);
const fwd = new Vector3(), velocity = new Vector3(), desired = new Vector3();
const anchor = new Vector3(), point = new Vector3(), candidate = new Vector3();
const sweep = new Vector3(), best = new Vector3(), shakeOffset = new Vector3();
export type CamMode = 'chase' | 'far' | 'hood';

export class ChaseCam {
  mode: CamMode = 'chase';
  private readonly dir = new Vector3(0, 0, 1);
  private readonly offset = new Vector3(0, 3.3, -5.9);
  private yaw = 0;
  private shake = 0;
  private dist = 5.9;
  private boom = 6.8;
  constructor(readonly cam: PerspectiveCamera) {}

  kick(amount: number): void { this.shake = Math.min(.35, this.shake + amount * .2); }

  snap(v: Vehicle, carPos: Vector3): void {
    v.fwd(fwd).setY(0);
    if (fwd.lengthSq() > .01) this.yaw = Math.atan2(fwd.x, fwd.z);
    this.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.offset.copy(this.dir).multiplyScalar(-7.2).addScaledVector(UP, 3.3);
    this.boom = this.offset.length(); this.shake = 0;
    this.cam.up.copy(UP);
    this.cam.position.copy(carPos).add(this.offset);
    this.cam.lookAt(carPos);
  }

  /** Sphere sweep with <= 18 cm steps catches corners/thin walls between endpoints. */
  private clearBoom(world: ColliderWorld, end: Vector3, out: Vector3): number {
    const distance = end.distanceTo(anchor), steps = Math.max(1, Math.ceil(distance / .18));
    out.copy(anchor);
    for (let i = 1; i <= steps; i++) {
      point.copy(anchor).lerp(end, i / steps);
      if (world.overlapsSphere(point, .38)) break;
      out.copy(point);
    }
    return out.distanceTo(anchor);
  }

  update(dt: number, v: Vehicle, carPos: Vector3, world: ColliderWorld): void {
    dt = Math.max(0, Math.min(dt, .1));
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    const speed = v.vel.length();
    v.fwd(fwd).setY(0);
    // A rebound or reverse must never turn the camera through 180 degrees.
    velocity.copy(v.vel).setY(0);
    if (v.mode === 'air' && velocity.lengthSq() > 64 && fwd.dot(velocity) > 0)
      fwd.normalize().lerp(velocity.normalize(), .35);
    if (fwd.lengthSq() > .04) {
      const target = Math.atan2(fwd.x, fwd.z);
      const delta = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
      const maxTurn = (v.mode === 'air' ? 1.5 : 2.4) * dt;
      this.yaw += Math.max(-maxTurn, Math.min(maxTurn, delta * k(5)));
    }
    this.dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const compact = typeof innerWidth !== 'undefined' && (innerWidth <= 900 || matchMedia('(pointer:coarse)').matches);
    const portrait = compact && innerHeight > innerWidth;
    const far = this.mode === 'far', hood = this.mode === 'hood';
    const targetDist = ((far ? 13 : 6.8) + Math.min(speed, 90) * .02) * (portrait ? 1.5 : compact ? 1.12 : 1);
    this.dist += (targetDist - this.dist) * k(3);
    anchor.copy(carPos).addScaledVector(UP, .55);
    if (world.overlapsSphere(anchor, .38)) anchor.copy(carPos);
    desired.copy(this.dir).multiplyScalar(-this.dist).addScaledVector(UP, far ? 4.6 : 3.1);
    // On a wall, stay outside its surface without rolling the horizon with the car.
    if (v.mode === 'wall' || v.mode === 'ceiling')
      desired.addScaledVector(v.groundN, Math.max(0, this.dist - desired.dot(v.groundN)));
    this.offset.lerp(desired, k(7));
    desired.copy(anchor).add(this.offset);
    if (hood) desired.copy(carPos).addScaledVector(UP, 1.15).addScaledVector(this.dir, .4);
    let clear = this.clearBoom(world, desired, best);
    if (!hood && clear < 3) {
      // Prefer lifting above the car to preserve the driver's left/right frame.
      candidate.copy(anchor).addScaledVector(this.dir,-.15).addScaledVector(UP,6);
      const overhead = this.clearBoom(world,candidate,sweep);
      if(overhead>3){clear=overhead;best.copy(sweep);}
    }
    if (!hood && clear < 3) {
      // With a low ceiling, try a side view; never jump to the front of the car.
      let score = clear;
      for (const angle of [0, .8, -.8, 1.5, -1.5]) {
        candidate.copy(this.dir).applyAxisAngle(UP, angle).multiplyScalar(-this.dist * .75).addScaledVector(UP, 5).add(anchor);
        const reach = this.clearBoom(world, candidate, sweep);
        const value = reach - Math.abs(angle) * .25;
        if (value > score) { score = value; clear = reach; best.copy(sweep); }
      }
    }
    // Retract immediately for safety; extend gradually once the obstacle clears.
    this.boom = clear < this.boom ? clear : this.boom + (clear - this.boom) * k(5);
    if (clear > .001) best.sub(anchor).multiplyScalar(this.boom / clear).add(anchor);
    this.cam.position.copy(best);
    if (this.shake > .001 && clear > 2) {
      shakeOffset.set((Math.random()-.5)*this.shake*.12,(Math.random()-.5)*this.shake*.12,0);
      candidate.copy(this.cam.position).add(shakeOffset);
      if (!world.overlapsSphere(candidate,.38)) this.cam.position.copy(candidate);
    }
    this.shake *= Math.exp(-9 * dt);
    this.cam.up.copy(UP);
    if (hood) candidate.copy(anchor).addScaledVector(this.dir,20);
    else candidate.copy(anchor);
    this.cam.lookAt(candidate);
    const fovTarget = (hood ? 70 : 62) + Math.min(speed,100)*.12 + v.mainThrust*5;
    this.cam.fov += (fovTarget-this.cam.fov)*k(3);
    this.cam.updateProjectionMatrix();
  }
}
