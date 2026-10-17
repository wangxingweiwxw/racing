// 街机车辆物理：车身用一个球做碰撞，沿接触面法线行驶，所以墙面、楼顶、倒挂都是同一套逻辑。
// 不依赖 DOM，可在 Node 里跑测试。
import { Quaternion, Vector3 } from 'three';
import { sortContacts } from './colliders.ts';
import type { Collider, ColliderWorld, Contact, DynamicSource } from './colliders.ts';

export interface DriveInput {
  /** -1..1：油门 / 刹车倒车；空中为微推 / 减速 */
  throttle: number;
  /** -1..1：右为正；空中为偏航（按住手刹时为横滚） */
  steer: number;
  handbrake: boolean;
  /** 下推进器：地面点按起跳，空中按住悬停 */
  hop: boolean;
  /** 后部主推进器 */
  boost: boolean;
  /** 风扇吸附（按下切换） */
  fan: boolean;
  /** 原地复位（按下触发） */
  reset: boolean;
  /** I/K or gamepad stick; W/S remain drive controls while airborne. */
  pitch?: number;
  action?: boolean;
}

export function emptyInput(): DriveInput {
  return { throttle: 0, steer: 0, handbrake: false, hop: false, boost: false, fan: false, reset: false };
}

export interface River {
  x0: number;
  x1: number;
  waterY: number;
}
export interface Env {
  world: ColliderWorld;
  river: River;
  /** 车流等动态碰撞体（可选） */
  dynamic?: DynamicSource;
}

export type Mode = 'ground' | 'wall' | 'ceiling' | 'air' | 'sunk';
export type EventType =
  | 'hop' | 'takeoff' | 'land' | 'crash' | 'attach' | 'detach' | 'splash' | 'respawn'
  | 'overheat' | 'fanOn' | 'fanOff' | 'fanLocked' | 'empty';
export interface VehicleEvent {
  type: EventType;
  strength: number;
}

export const TUNING = {
  radius: 0.75,
  gravity: 9.81,
  accel: 21, // 0 → 100 km/h 约 1.4 s，加上主推进约 0.9 s
  vmax: 370.15 / 3.6,
  boostAccel: 17,
  boostVmax: 370.15 / 3.6,
  brake: 34,
  reverseAccel: 10,
  reverseMax: 5 / 3.6,
  rollRes: 0.6,
  drag: 0.0008,
  gripNormal: 8,
  gripDrift: 3,
  gripHandbrake: 1.1,
  driftSlip: 0.22,
  steerLow: 2.5,
  steerHigh: 1.05,
  hopImpulse: 9.5,
  hopCost: 40,
  hoverCost: 75,
  boostCost: 40,
  rcsAccel: 7,
  rcsDamp: 2.2,
  rcsCost: 4,
  tank: 600, // 升，压缩空气
  regen: 26,
  regenDelay: 0.8,
  suction: 2 * 9.81, // 风扇吸附 2G
  fanHeat: 1 / 7, // 贴墙 / 倒挂约 7 秒过热
  fanCool: 0.3,
  attachSpeed: 7,
  airDrag: 0.0005,
  snap: 0.1,
};
const T = TUNING;

const WORLD_UP = new Vector3(0, 1, 0);
const _up = new Vector3();
const _fwd = new Vector3();
const _f = new Vector3();
const _r = new Vector3();
const _n = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _axis = new Vector3();
const _v = new Vector3();
const _l = new Vector3();
const _upL = new Vector3();
const _rel = new Vector3();
const _imp = new Vector3();

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class Vehicle {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly q = new Quaternion();
  /** 空中角速度（车身局部坐标：x 俯仰，y 偏航，z 横滚） */
  readonly angVel = new Vector3();
  readonly groundN = new Vector3(0, 1, 0);
  grounded = false;
  mode: Mode = 'air';
  airTime = 0;
  air: number = T.tank;
  fanOn = false;
  fanLock = false;
  fanHeat = 0;
  steer = 0;
  slip = 0;
  drifting = false;
  /** 推进器强度 0..1，给特效和音效用 */
  downThrust = 0;
  mainThrust = 0;
  rcsPitch = 0;
  rcsYaw = 0;
  rcsRoll = 0;
  wheelSpin = 0;
  braking = false;
  showcase = false;
  stuntRoll = 0;
  landingAssist = false;
  private stuntTime = 0;
  private stuntDirection = 1;
  private prevAction = false;
  private hoverY = 0;
  get stuntActive() { return this.stuntTime > 0; }
  time = 0;

  private readonly safePos = new Vector3();
  private readonly safeQ = new Quaternion();
  private safeT = -1;
  private respawnTimer = 0;
  private prevHop = false;
  private prevFan = false;
  private prevReset = false;
  private hopCd = 0;
  private lastThrust = -10;
  private emptyWarned = false;
  private snapAlign = false;
  support: Collider | null = null;
  private readonly events: VehicleEvent[] = [];
  private readonly pool: Contact[] = [];
  private readonly acc = new Vector3();

  constructor(pos: Vector3, heading: Quaternion) {
    this.place(pos, heading);
  }

  place(pos: Vector3, heading: Quaternion): void {
    this.pos.copy(pos);
    this.q.copy(heading);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.safePos.copy(pos);
    this.safeQ.copy(heading);
    this.grounded = false;
    this.mode = 'air';
    this.groundN.set(0, 1, 0);
    this.showcase=false;this.stuntRoll=0;this.stuntTime=0;this.prevAction=false;
    this.hoverY=pos.y+3.5;this.landingAssist=false;
  }

  up(out = new Vector3()): Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.q);
  }
  fwd(out = new Vector3()): Vector3 {
    return out.set(0, 0, 1).applyQuaternion(this.q);
  }
  get speedKmh(): number {
    return this.vel.length() * 3.6;
  }
  get forwardSpeed(): number {
    return this.vel.dot(this.fwd(_fwd));
  }

  private push(type: EventType, strength = 1): void {
    this.events.push({ type, strength });
  }

  private alignUp(target: Vector3, t: number): void {
    this.up(_up);
    _q.setFromUnitVectors(_up, target);
    if (t < 1) _q.slerpQuaternions(_q2.identity(), _q, t);
    this.q.premultiply(_q).normalize();
  }

  step(inp: DriveInput, dt: number, env: Env): VehicleEvent[] {
    this.events.length = 0;
    this.time += dt;
    this.landingAssist=false;
    const actionEdge=!!inp.action&&!this.prevAction;this.prevAction=!!inp.action;
    if(actionEdge){
      if(this.grounded&&this.mode==='ground'&&this.vel.length()<1)this.showcase=!this.showcase;
      else if(!this.grounded&&this.mode==='air'&&this.airTime>.25&&this.air>=70&&!this.stuntActive){
        const ground=env.world.raycast(this.pos,new Vector3(0,-1,0),3,(c)=>c.tag==='bound');
        if(!ground){this.stuntTime=Number.EPSILON;this.stuntDirection=inp.steer<0?-1:1;this.air-=60;}
      }
    }
    if(inp.throttle||inp.hop||inp.boost||!this.grounded||this.vel.length()>=1)this.showcase=false;
    if(this.stuntActive){const t=Math.min(1,(this.stuntTime+=dt)/.95);this.stuntRoll=this.stuntDirection*Math.PI*2*t*t*(3-2*t);if(t>=1||this.grounded){this.stuntTime=0;this.stuntRoll=0;}}

    if (this.mode === 'sunk') {
      this.respawnTimer -= dt;
      this.downThrust = this.mainThrust = 0;
      if (this.respawnTimer <= 0) this.respawn();
      return this.events;
    }

    if (inp.reset && !this.prevReset) {
      // 原地扶正：保留朝向的水平分量
      this.fwd(_f).setY(0);
      if (_f.lengthSq() < 1e-4) _f.set(0, 0, 1);
      _f.normalize();
      this.q.setFromUnitVectors(new Vector3(0, 0, 1), _f);
      this.pos.y += 1.5;
      this.vel.set(0, 0, 0);
      this.angVel.set(0, 0, 0);
      this.stuntTime=0;this.stuntRoll=0;this.showcase=false;this.hoverY=this.pos.y+3.5;
      this.push('respawn');
    }
    this.prevReset = inp.reset;

    if (inp.fan && !this.prevFan) {
      if (this.fanLock) this.push('fanLocked');
      else {
        this.fanOn = !this.fanOn;
        this.push(this.fanOn ? 'fanOn' : 'fanOff');
      }
    }
    this.prevFan = inp.fan;

    this.acc.set(0, -T.gravity, 0);
    let downTarget = 0;
    let mainTarget = 0;

    if (this.grounded) {
      this.airTime = 0;
      this.drive(inp, dt);
      if (this.fanOn) this.acc.addScaledVector(this.groundN, -T.suction);
    } else {
      this.airControl(inp, dt);
    }

    // ---- 推进器 ----
    this.up(_up);
    this.fwd(_fwd);
    const hopEdge = inp.hop && !this.prevHop;
    this.prevHop = inp.hop;
    this.hopCd -= dt;
    if (hopEdge && this.grounded && this.hopCd <= 0) {
      if (this.air >= T.hopCost) {
        this.vel.addScaledVector(_up, T.hopImpulse);
        this.air -= T.hopCost;
        this.hopCd = 0.35;
        this.downThrust = 1;
        this.lastThrust = this.time;
        this.grounded = false;
        this.hoverY=this.pos.y+3.5;
        this.mode = 'air';
        this.push('hop');
      } else this.warnEmpty();
    }
    if (inp.hop && !this.grounded && this.airTime > 0.12) {
      if (this.air > 0) {
        const support=T.gravity+clamp((this.hoverY-this.pos.y)*6-this.vel.y*4.5,-T.gravity,16);
        this.acc.addScaledVector(_up, support);
        this.air -= T.hoverCost * dt;
        downTarget = clamp(support/24,.15,1);
        this.lastThrust = this.time;
      } else this.warnEmpty();
    }
    if (inp.boost) {
      if (this.air > 0) {
        let k = 1;
        if (this.grounded) k = clamp(1 - this.vel.dot(_fwd) / T.boostVmax, 0, 1);
        this.acc.addScaledVector(_fwd, T.boostAccel * k);
        this.air -= T.boostCost * dt;
        mainTarget = 1;
        this.lastThrust = this.time;
      } else this.warnEmpty();
    }
    if(!this.grounded&&inp.throttle>0&&this.air>0){
      this.acc.addScaledVector(_fwd,4*inp.throttle);this.air-=8*dt;
      mainTarget=Math.max(mainTarget,.25*inp.throttle);this.lastThrust=this.time;
    }
    const rcs = Math.abs(this.rcsPitch) + Math.abs(this.rcsYaw) + Math.abs(this.rcsRoll);
    if (rcs > 0.01) {
      this.air -= T.rcsCost * rcs * dt;
      this.lastThrust = this.time;
    }
    // Fuel-limited landing flare near a horizontal roof or street.
    if(!this.grounded&&this.vel.y<-3&&!inp.hop&&this.air>0){
      const hit=env.world.raycast(this.pos,new Vector3(0,-1,0),4,(c)=>c.tag==='bound');
      if(hit&&hit.normal.y>.8){
        this.landingAssist=true;this.alignUp(hit.normal,1-Math.exp(-dt*9));
        this.acc.y+=Math.min(26,(-this.vel.y-3)*9)*Math.min(1,this.air/(60*dt));
        this.air-=Math.min(this.air,60*dt);downTarget=Math.max(downTarget,.65);this.lastThrust=this.time;
      }
    }
    if (this.air <= 0) this.air = 0;
    else if (this.air > 60) this.emptyWarned = false;
    if (this.grounded && this.time - this.lastThrust > T.regenDelay) {
      this.air = Math.min(T.tank, this.air + T.regen * (this.drifting ? 1.6 : 1) * dt);
    }
    this.downThrust += (downTarget - this.downThrust) * (1 - Math.exp(-(downTarget > this.downThrust ? 20 : 6) * dt));
    this.mainThrust += (mainTarget - this.mainThrust) * (1 - Math.exp(-(mainTarget > this.mainThrust ? 20 : 6) * dt));

    // ---- 风扇过热 ----
    const onWall = this.grounded && this.groundN.y < 0.7;
    if (this.fanOn) {
      this.fanHeat += (onWall ? T.fanHeat : -T.fanCool * 0.5) * dt;
      if (this.fanHeat >= 1) {
        this.fanHeat = 1;
        this.fanOn = false;
        this.fanLock = true;
        this.push('overheat');
      }
    } else {
      this.fanHeat -= T.fanCool * dt;
      if (this.fanLock && this.fanHeat <= 0.25) this.fanLock = false;
    }
    this.fanHeat = clamp(this.fanHeat, 0, 1);

    // ---- 积分 + 碰撞（高速时分步，防止穿模） ----
    this.vel.addScaledVector(this.acc, dt);
    const horizontal=Math.hypot(this.vel.x,this.vel.z);
    if(horizontal>T.boostVmax){this.vel.x*=T.boostVmax/horizontal;this.vel.z*=T.boostVmax/horizontal;}
    if (!this.grounded) this.vel.multiplyScalar(1 - T.airDrag * this.vel.length() * dt);
    const wasGrounded = this.grounded;
    const prevMode = this.mode;
    const steps = Math.min(8, Math.max(1, Math.ceil((this.vel.length() * dt) / 0.35)));
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, dt / steps);
      this.resolve(env);
    }

    if (this.grounded) {
      this.alignUp(this.groundN, this.snapAlign ? 1 : 1 - Math.exp(-(wasGrounded ? 18 : 10) * dt));
      this.snapAlign = false;
      this.mode = this.groundN.y > 0.7 ? 'ground' : this.groundN.y < -0.5 ? 'ceiling' : 'wall';
    } else this.mode = 'air';

    if (wasGrounded && !this.grounded) {this.hoverY=this.pos.y+3.5;this.push('takeoff');}
    if (!wasGrounded && this.grounded) {this.angVel.set(0, 0, 0);this.stuntTime=0;this.stuntRoll=0;}
    if ((prevMode === 'wall' || prevMode === 'ceiling') && this.mode === 'air') this.push('detach');

    // ---- 落水 / 掉出地图 ----
    const r = env.river;
    if (this.pos.x > r.x0 + 0.5 && this.pos.x < r.x1 - 0.5 && this.pos.y < r.waterY + 0.35) {
      this.push('splash', this.vel.length());
      this.sink();
    } else if (this.pos.y < -60) this.sink();

    // 记录安全点（复位用）
    if (this.grounded && this.groundN.y > 0.9 && this.time - this.safeT > 0.5 && (this.pos.x < r.x0 - 30 || this.pos.x > r.x1 + 30)) {
      this.safeT = this.time;
      this.safePos.copy(this.pos);
      this.fwd(_f).setY(0).normalize();
      this.safeQ.setFromUnitVectors(new Vector3(0, 0, 1), _f);
    }
    this.braking = inp.throttle < -0.1 && this.forwardSpeed > 1;
    this.wheelSpin += (this.grounded ? this.forwardSpeed : this.forwardSpeed * 0.3) * (dt / 0.38);
    return this.events;
  }

  private warnEmpty(): void {
    if (!this.emptyWarned) {
      this.emptyWarned = true;
      this.push('empty');
    }
  }

  private sink(): void {
    this.mode = 'sunk';
    this.respawnTimer = 1.5;
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.fanOn = false;
  }

  private respawn(): void {
    this.place(this.safePos.clone().add(new Vector3(0, 0.5, 0)), this.safeQ);
    this.push('respawn');
  }

  private drive(inp: DriveInput, dt: number): void {
    const n = this.groundN;
    this.fwd(_f).addScaledVector(n, -_f.dot(n));
    if (_f.lengthSq() < 1e-6) return;
    _f.normalize();
    _r.crossVectors(_f, n);

    const target = inp.steer;
    const rate = Math.abs(target) > Math.abs(this.steer) ? 5 : 8;
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);

    let vF = this.vel.dot(_f);
    let vL = this.vel.dot(_r);
    const vN = this.vel.dot(n);
    const speed = Math.hypot(vF, vL);

    // 转向：低速受限，高速收敛；倒车反向
    let steerRate = Math.min(speed / 5, 1) * lerp(T.steerLow, T.steerHigh, clamp(speed / 70, 0, 1)) * (inp.handbrake ? 1.4 : 1);
    // 漂移稳定：侧滑角越大，继续加大侧滑的转向越弱（反打方向不受影响）
    if (this.steer * this.slip < 0) steerRate *= 1 - clamp((Math.abs(this.slip) - 0.45) / 0.5, 0, 0.9);
    const dir = vF >= -0.5 ? 1 : -1;
    _q.setFromAxisAngle(n, -this.steer * steerRate * dir * dt);
    this.q.premultiply(_q);
    _f.applyQuaternion(_q);
    _r.applyQuaternion(_q);
    vF = this.vel.dot(_f);
    vL = this.vel.dot(_r);

    // 纵向
    const thr = inp.throttle;
    if (thr > 0) {
      if (vF < -1) vF += T.brake * thr * dt;
      else vF += T.accel * Math.max(0.5, 1 - Math.pow(Math.max(vF, 0) / T.vmax, 1.6)) * thr * dt;
    } else if (thr < 0) {
      if (vF > 1) vF += (T.brake+Math.min(14,8*(vF/60)**2)) * thr * dt;
      else if (vF > -T.reverseMax) vF += T.reverseAccel * thr * dt;
    }
    if (inp.handbrake) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 5 * dt);
    vF -= Math.sign(vF) * Math.min(Math.abs(vF), (thr === 0 ? T.rollRes * 2.5 : T.rollRes) * dt);
    vF -= Math.sign(vF) * T.drag * vF * vF * dt;

    // 横向抓地：手刹时抓地很弱，速度方向滞后于车头 → 漂移
    const slip = speed < 3 ? 0 : Math.atan2(vL, Math.max(Math.abs(vF), 0.5));
    this.slip = slip;
    const drifting = Math.abs(slip) > T.driftSlip && speed > 8;
    let grip = inp.handbrake ? T.gripHandbrake : drifting ? T.gripDrift : T.gripNormal;
    if (this.fanOn) grip *= 1.35;
    const newL = vL * Math.exp(-grip * dt);
    const lost = Math.abs(vL) - Math.abs(newL);
    vF += Math.sign(vF || 1) * lost * (inp.handbrake ? 0.45 : 0.25);
    this.drifting = drifting;
    this.vel.set(0, 0, 0).addScaledVector(_f, vF).addScaledVector(_r, newL).addScaledVector(n, vN);
    this.rcsPitch = this.rcsYaw = this.rcsRoll = 0;
  }

  private airControl(inp: DriveInput, dt: number): void {
    this.airTime += dt;
    this.drifting = false;
    const ctl = this.airTime > 0.3 && this.air > 0 ? 1 : 0;
    this.rcsPitch = (inp.pitch??0) * 0.7 * ctl;
    this.rcsYaw = (inp.handbrake ? 0 : -inp.steer) * ctl;
    this.rcsRoll = (inp.handbrake&&!this.stuntActive ? inp.steer : 0) * ctl;
    this.angVel.x += this.rcsPitch * T.rcsAccel * dt;
    this.angVel.y += this.rcsYaw * T.rcsAccel * 0.8 * dt;
    this.angVel.z += this.rcsRoll * T.rcsAccel * 1.3 * dt;
    this.angVel.multiplyScalar(Math.exp(-T.rcsDamp * dt));
    const w = this.angVel.length();
    if (w > 1e-5) {
      _axis.copy(this.angVel).divideScalar(w);
      _q.setFromAxisAngle(_axis, w * dt);
      this.q.multiply(_q).normalize();
    }
    // 没有输入时缓慢自动摆正，方便落地
    if (this.airTime > .3 && Math.abs(this.rcsPitch)+Math.abs(this.rcsRoll)<.01) this.alignUp(WORLD_UP, 1-Math.exp(-2.2*dt));
    if (ctl&&Math.abs(inp.steer)>.01&&!inp.handbrake) {
      this.fwd(_f).setY(0).normalize();
      const speed=Math.hypot(this.vel.x,this.vel.z),blend=1-Math.exp(-.6*dt);
      this.vel.x+=(_f.x*speed-this.vel.x)*blend;this.vel.z+=(_f.z*speed-this.vel.z)*blend;
    }
    if(ctl&&inp.throttle<0){this.vel.x*=Math.exp(-.45*dt);this.vel.z*=Math.exp(-.45*dt);}
  }

  /**
   * 风扇吸附时翻过盒体的凸棱（墙 → 楼顶、楼顶 → 墙）：球心越过当前面的边界时，
   * 直接切换到相邻的面，车身和速度一起旋转 90°。
   */
  private tryWrap(c: Contact): boolean {
    const b = c.collider;
    if (b.kind !== 'box' || (b.tag !== 'building' && b.tag !== 'landmark')) return false;
    _l.copy(this.pos).sub(b.center).applyQuaternion(b.inv);
    _upL.copy(_up).applyQuaternion(b.inv);
    const h = [b.half.x, b.half.y, b.half.z];
    const l = [_l.x, _l.y, _l.z];
    const u = [_upL.x, _upL.y, _upL.z];
    let face = -1;
    for (let i = 0; i < 3; i++) if (Math.abs(u[i]) > 0.9 && Math.sign(u[i]) === Math.sign(l[i]) && Math.abs(l[i]) > h[i]) face = i;
    if (face < 0) return false;
    for (let i = 0; i < 3; i++) {
      if (i === face || Math.abs(l[i]) <= h[i]) continue;
      _v.set(i === 0 ? Math.sign(l[i]) : 0, i === 1 ? Math.sign(l[i]) : 0, i === 2 ? Math.sign(l[i]) : 0).applyQuaternion(b.rot);
      if (this.vel.dot(_v) <= 0) continue;
      _q.setFromUnitVectors(_up, _v);
      this.q.premultiply(_q).normalize();
      this.vel.applyQuaternion(_q);
      this.pos.copy(c.point).addScaledVector(_v, T.radius).addScaledVector(_up, -0.3);
      this.up(_up);
      c.normal.copy(_v);
      c.depth = 0;
      this.snapAlign = true;
      this.push('attach', this.vel.length());
      return true;
    }
    return false;
  }

  private resolve(env: Env): void {
    let count = env.world.contacts(this.pos, T.radius, T.snap, this.pool);
    if (env.dynamic) {
      count = env.dynamic.contacts(this.pos, T.radius, T.snap, this.pool, count);
      sortContacts(this.pool, count);
    }
    let support = false;
    _n.set(0, 0, 0);
    this.up(_up);
    const speed = this.vel.length();
    for (let i = 0; i < count; i++) {
      const c = this.pool[i];
      const n = c.normal;
      const facing = n.dot(_up);
      const vn = this.vel.dot(n);
      const solid = c.collider.tag !== 'bound';
      const dyn = c.collider.kind === 'box' ? c.collider.dyn : undefined;
      if (dyn && !(facing > 0.5 && n.y > 0.6)) {
        // 撞到车流：按相对速度做动量交换，对方被撞开
        if (c.depth <= 0) continue;
        this.pos.addScaledVector(n, c.depth);
        _rel.copy(this.vel).sub(dyn.vel);
        const rvn = _rel.dot(n);
        if (rvn < 0) {
          const j = (-(1 + 0.3) * rvn) / (1 + 1 / dyn.mass);
          this.vel.addScaledVector(n, j);
          dyn.onHit(_imp.copy(n).multiplyScalar(-j), c.point, -rvn);
          if (-rvn > 5) this.push('crash', -rvn);
        }
        continue;
      }
      if (solid && facing > 0.5 && (n.y > 0.3 || this.fanOn)) {
        // 支撑面（地面、坡道、贴墙时的墙面）
        if (this.fanOn && this.grounded && !dyn && this.tryWrap(c)) {
          _n.copy(c.normal);
          support = true;
          this.support = c.collider;
          break;
        }
        if (c.depth > 0) this.pos.addScaledVector(n, c.depth);
        if (vn < 0) {
          if (!this.grounded && -vn > 4) this.push('land', -vn);
          this.vel.addScaledVector(n, -vn);
        }
        _n.addScaledVector(n, Math.max(c.depth + T.snap, 0.01));
        support = true;
        this.support = c.collider;
      } else if (c.depth > 0) {
        if (solid && !dyn && this.fanOn && this.grounded && !this.fanLock && speed > T.attachSpeed && vn < -0.3 * speed) {
          // 风扇吸附：车头撞墙 → 整车连同速度一起转到墙面上
          _q.setFromUnitVectors(_up, n);
          this.q.premultiply(_q).normalize();
          this.vel.applyQuaternion(_q);
          this.pos.addScaledVector(n, c.depth);
          this.up(_up);
          _n.copy(n);
          support = true;
          this.support = c.collider;
          this.snapAlign = true;
          this.push('attach', speed);
        } else if (solid && !this.grounded && n.y > 0.6) {
          // 空中姿态不对砸到地面：照样落地，但算一次撞击
          this.pos.addScaledVector(n, c.depth);
          if (vn < 0) this.vel.addScaledVector(n, -vn);
          this.vel.multiplyScalar(0.7);
          _n.addScaledVector(n, 1);
          support = true;
          this.snapAlign = true;
          this.push('crash', Math.max(-vn, 4));
        } else {
          // 撞墙
          this.pos.addScaledVector(n, c.depth);
          if (vn < 0) {
            this.vel.addScaledVector(n, -vn * 1.25);
            if (-vn > 3) this.vel.multiplyScalar(0.92);
            if (-vn > 5) this.push('crash', -vn);
          }
        }
      }
    }
    if (support) {
      this.grounded = true;
      this.groundN.copy(_n.normalize());
    } else {
      this.grounded = false;
      this.support = null;
    }
  }
}
