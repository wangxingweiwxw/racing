// 追尾相机：贴墙时跟随车身的「上」方向，空中跟随速度方向，避免翻滚时相机乱转；防穿墙。
import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { ColliderWorld } from './physics/colliders.ts';
import type { Vehicle } from './physics/vehicle.ts';

const WORLD_UP = new Vector3(0, 1, 0);
const _fwd = new Vector3();
const _up = new Vector3();
const _vel = new Vector3();
const _desired = new Vector3();
const _look = new Vector3();
const _p = new Vector3();

export type CamMode = 'chase' | 'far' | 'hood';

export class ChaseCam {
  readonly cam: PerspectiveCamera;
  mode: CamMode = 'chase';
  private readonly up = new Vector3(0, 1, 0);
  private readonly dir = new Vector3(0, 0, 1);
  private readonly offset = new Vector3(0, 3, -8);
  private shake = 0;
  private dist = 5.9;

  constructor(cam: PerspectiveCamera) {
    this.cam = cam;
  }

  kick(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  snap(v: Vehicle, carPos: Vector3): void {
    v.fwd(this.dir).setY(0).normalize();
    this.up.copy(WORLD_UP);
    this.offset.copy(this.dir).multiplyScalar(-7.2).addScaledVector(this.up, 2.6);
    this.cam.position.copy(carPos).add(this.offset);
    this.cam.lookAt(carPos);
  }

  update(dt: number, v: Vehicle, carPos: Vector3, world: ColliderWorld): void {
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    v.up(_up);
    v.fwd(_fwd);
    const speed = v.vel.length();

    // 相机的「上」：贴墙/倒挂时跟车身（打个折，减轻眩晕），其余跟世界
    const upTarget = v.mode === 'wall' || v.mode === 'ceiling' ? _p.copy(_up).lerp(WORLD_UP, 0.25).normalize() : WORLD_UP;
    this.up.lerp(upTarget, k(4)).normalize();

    // 朝向：地面跟车头，空中偏向速度方向
    _fwd.addScaledVector(this.up, -_fwd.dot(this.up));
    if (v.mode === 'air' && speed > 8) {
      _vel.copy(v.vel).addScaledVector(this.up, -v.vel.dot(this.up));
      if (_vel.lengthSq() > 1) _fwd.lerp(_vel.normalize(), 0.75);
    }
    if (_fwd.lengthSq() > 1e-4) {
      _fwd.normalize();
      this.dir.lerp(_fwd, k(v.mode === 'air' ? 3 : 6)).normalize();
    }

    const hood = this.mode === 'hood';
    const far = this.mode === 'far';
    const compact = innerWidth <= 900 || matchMedia('(pointer:coarse)').matches;
    const portrait = compact && innerHeight > innerWidth;
    // 手机把车辆放在中部，给底部双手操作和仪表留出空间。
    const targetDist = ((far ? 13 : 5.9) + Math.min(speed, 90) * 0.02) * (portrait ? 1.55 : compact ? 1.15 : 1);
    this.dist += (targetDist - this.dist) * k(3);
    const height = far ? 4.6 : 3.3; // 对照原视频：追尾相机较高、略俯视
    if (hood) {
      _desired.copy(carPos).addScaledVector(_up, 1.25).addScaledVector(this.dir, 0.4);
      this.cam.position.copy(_desired);
      _look.copy(carPos).addScaledVector(_up, 1.1).addScaledVector(this.dir, 20);
    } else {
      // 平滑的是相对偏移，不是绝对位置 → 300 km/h 也不会被甩开
      _desired.copy(this.dir).multiplyScalar(-this.dist).addScaledVector(this.up, height);
      this.offset.lerp(_desired, k(7));
      _desired.copy(carPos).add(this.offset);
      _look.copy(carPos).addScaledVector(this.dir, compact ? 0 : 3).addScaledVector(this.up, compact ? 0.3 : 0.55);
      // 防穿墙：从车往相机方向逐步检测
      for (let i = 1; i <= 10; i++) {
        _p.copy(_look).lerp(_desired, i / 10);
        if (world.overlapsSphere(_p, 0.35)) {
          _desired.copy(_look).lerp(_desired, Math.max(0, (i - 1.5) / 10));
          break;
        }
      }
      this.cam.position.copy(_desired);
    }
    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
      this.cam.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-6 * dt);
    }
    this.cam.up.copy(this.up);
    this.cam.lookAt(_look);

    const fovTarget = (hood ? 70 : 62) + Math.min(speed, 100) * 0.16 + v.mainThrust * 8;
    this.cam.fov += (fovTarget - this.cam.fov) * k(4);
    this.cam.updateProjectionMatrix();
  }
}
