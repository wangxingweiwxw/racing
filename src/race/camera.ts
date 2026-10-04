// Cameras. The chase camera follows OSK TrackState._update_camera: it trails the
// velocity direction with fast horizontal easing and slow vertical easing.
import * as THREE from "three";
import { Track } from "../track";
import { Kart, SPEED_BOOST } from "./kart";

export type CamMode = "chase" | "far" | "hood";
export const CAM_MODES: CamMode[] = ["chase", "far", "hood"];

const OSK_CAM_DISTANCE_FROM_PLAYER = 4.0;
const OSK_CAM_HEIGHT_FROM_PLAYER = 1.5;

export class CameraRig {
  mode: CamMode = "chase";
  private dir = new THREE.Vector3(0, 0, -1);
  private camY = 0;
  private initialized = false;
  private fov = 68;
  private flyS = 0;
  private flyPos = new THREE.Vector3();
  private flyLook = new THREE.Vector3();
  private orbit = 0;

  constructor(readonly camera: THREE.PerspectiveCamera, private track: Track) {}

  reset() {
    this.initialized = false;
  }

  follow(k: Kart, dt: number, shake: number, lookBack: boolean) {
    const fwd = new THREE.Vector3(Math.sin(k.heading), 0, -Math.cos(k.heading));
    // OSK: aim along the velocity once moving (keeps drifts readable), else along the kart
    const v = new THREE.Vector3(k.vel.x, 0, k.vel.z);
    const target = v.length() > 1.0 && fwd.dot(v) > 0 ? v.normalize().lerp(fwd, 0.45).normalize() : fwd;
    if (!this.initialized) {
      this.dir.copy(fwd);
      this.camY = k.pos.y;
      this.initialized = true;
    }
    this.dir.lerp(target, 1 - Math.exp(-dt * (this.mode === "far" ? 4 : 6))).normalize();
    // OSK eases the vertical axis much more slowly so jumps stay readable
    this.camY += (k.pos.y - this.camY) * (1 - Math.exp(-dt * (k.grounded ? 7 : 2.2)));
    const speedK = Math.min(1.3, k.speed / Math.max(10, k.maxSpeed));
    const cam = this.camera;
    let dist = OSK_CAM_DISTANCE_FROM_PLAYER;
    let height = OSK_CAM_HEIGHT_FROM_PLAYER;
    if (this.mode === "chase") {
      dist = 4.3 + speedK * 0.9;
      height = 1.55;
    } else if (this.mode === "far") {
      dist = 7.5 + speedK * 1.4;
      height = 2.7;
    }
    const d = lookBack ? this.dir.clone().negate() : this.dir;
    if (this.mode === "hood" && !lookBack) {
      const up = k.normal;
      cam.position.set(k.pos.x, k.pos.y, k.pos.z).addScaledVector(up, 0.98).addScaledVector(fwd, -0.18);
      cam.up.copy(up);
      cam.lookAt(cam.position.x + fwd.x * 10, cam.position.y + fwd.y * 10 - 0.6, cam.position.z + fwd.z * 10);
    } else {
      cam.up.set(0, 1, 0);
      cam.position.set(k.pos.x - d.x * dist, this.camY + height, k.pos.z - d.z * dist);
      // never dip under the road surface on crests
      const q = this.track.query(cam.position.x, cam.position.z, k.q.i);
      const minY = this.track.surfaceY(q, Math.max(-q.half - this.track.verge, Math.min(q.half + this.track.verge, q.lat))) + 0.6;
      if (cam.position.y < minY) cam.position.y = minY;
      cam.lookAt(k.pos.x + d.x * 3, this.camY + 0.75, k.pos.z + d.z * 3);
    }
    if (shake > 0) {
      cam.position.x += (Math.random() - 0.5) * shake * 0.18;
      cam.position.y += (Math.random() - 0.5) * shake * 0.18;
    }
    const boost = k.isBoosting() ? 8 : 0;
    const targetFov = 66 + speedK * 12 + boost * (k.speed / (k.maxSpeed * SPEED_BOOST));
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  /** title screen: slow drone flight along the Nordschleife */
  flyover(dt: number, speed = 26) {
    const tr = this.track;
    this.flyS = tr.wrapS(this.flyS + dt * speed);
    const f = tr.frameAt(this.flyS, { x: 0, y: 0, z: 0, tx: 0, tz: 0, i: 0, half: 0, bank: 0 });
    const ahead = tr.frameAt(this.flyS + 70, { x: 0, y: 0, z: 0, tx: 0, tz: 0, i: 0, half: 0, bank: 0 });
    const side = Math.sin(this.flyS * 0.0021) * 9;
    const tp = new THREE.Vector3(f.x - f.tz * side, f.y + 24 + Math.sin(this.flyS * 0.003) * 7, f.z + f.tx * side);
    const tl = new THREE.Vector3(ahead.x, ahead.y + 2, ahead.z);
    if (this.flyPos.lengthSq() === 0) {
      this.flyPos.copy(tp);
      this.flyLook.copy(tl);
    }
    this.flyPos.lerp(tp, 1 - Math.exp(-dt * 1.5));
    this.flyLook.lerp(tl, 1 - Math.exp(-dt * 1.5));
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.flyPos);
    this.camera.lookAt(this.flyLook);
    if (this.camera.fov !== 55) {
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
    }
  }

  setFlyoverStart(s: number) {
    this.flyS = s;
    this.flyPos.set(0, 0, 0);
  }

  /** grid / finish: orbit around the kart */
  orbitAround(k: Kart, dt: number, radius = 6.5) {
    this.orbit += dt * 0.35;
    const h = k.heading + Math.PI * 0.75 + Math.sin(this.orbit) * 0.9;
    const cam = this.camera;
    cam.up.set(0, 1, 0);
    cam.position.set(k.pos.x + Math.sin(h) * radius, k.pos.y + 1.8 + Math.sin(this.orbit * 0.7) * 0.6, k.pos.z - Math.cos(h) * radius);
    cam.lookAt(k.pos.x, k.pos.y + 0.6, k.pos.z);
    this.initialized = false;
  }
}
