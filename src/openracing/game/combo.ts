// 车技连击（对应原视频左侧的 DRIFT / NEAR MISS / TOP SPEED / AIR TIME 计分）。不依赖 DOM。
// 规则：每个动作加基础分并让倍率 +0.25；动作进行中计时条保持满格，结束后 2.6 秒内没有新动作就结算进现金；
// 任何实质撞击 / 落水 / 复位立即判负，分数变红作废。
import { Vector3 } from 'three';
import type { ColliderWorld } from '../physics/colliders.ts';
import type { Mode, Vehicle, VehicleEvent } from '../physics/vehicle.ts';
import { TUNING } from '../physics/vehicle.ts';

export type LiveKind = 'drift' | 'air' | 'wall' | 'ceiling';
export interface ComboEvent {
  type: 'action' | 'bank' | 'fail';
  label: string;
  pts: number;
  /** bank：本次连击总分（分数 × 倍率） */
  total?: number;
}

export const COMBO = {
  window: 2.6,
  multStep: 0.25,
  multMax: 10,
  /** 结算：总分 / 10 → 现金（元） */
  cashRate: 0.1,
  failShow: 1.2,
  crashFail: 6,
};

const LIVE_LABEL: Record<LiveKind, string> = { drift: '漂移', air: '滞空', wall: '贴墙', ceiling: '倒挂' };
const _side = new Vector3();
const _fwd = new Vector3();

export class Combo {
  active = false;
  score = 0;
  mult = 1;
  timer = 0;
  /** 判负后红字剩余显示时间 */
  failed = 0;
  failedScore = 0;
  lastLabel = '';
  lastPts = 0;
  live: LiveKind | null = null;
  liveValue = 0;
  private driftT = 0;
  private driftGap = 0;
  private driftMax = 0;
  private airT = 0;
  private airY0 = 0;
  private airMaxY = 0;
  private wallDist = 0;
  private wallKind: LiveKind = 'wall';
  private topT = 0;
  private topLatch = false;
  private nearCd = 0;
  private nearTick = 0;
  private prevMode: Mode = 'ground';
  private readonly out: ComboEvent[] = [];

  /** 每个物理步调用一次 */
  step(v: Vehicle, dt: number, events: VehicleEvent[], world: ColliderWorld): ComboEvent[] {
    const out = this.out;
    out.length = 0;
    if (this.failed > 0) this.failed -= dt;

    let failedNow = false;
    for (const e of events) {
      if ((e.type === 'crash' && e.strength > COMBO.crashFail) || e.type === 'splash' || e.type === 'respawn') failedNow = true;
    }
    if (failedNow) {
      this.fail();
      this.prevMode = v.mode;
      return out;
    }

    // 漂移：短暂中断（<0.15 s）不算结束
    if (v.grounded && v.drifting) {
      this.driftT += dt;
      this.driftGap = 0;
      this.driftMax = Math.max(this.driftMax, Math.abs(v.slip));
    } else if (this.driftT > 0) {
      this.driftGap += dt;
      if (this.driftGap > 0.15) {
        if (this.driftT >= 0.4) this.award(`漂移 ${this.driftT.toFixed(1)}s`, Math.round(this.driftT * 500 + (this.driftMax * 180) / Math.PI * 4));
        this.driftT = 0;
        this.driftMax = 0;
      }
    }

    // 滞空：落地（或吸附到墙上）时结算
    if (v.mode === 'air') {
      if (this.prevMode !== 'air') {
        this.airT = 0;
        this.airY0 = v.pos.y;
        this.airMaxY = v.pos.y;
      }
      this.airT += dt;
      this.airMaxY = Math.max(this.airMaxY, v.pos.y);
    } else if (this.prevMode === 'air') {
      if (this.airT >= 0.6) {
        const h = Math.max(0, this.airMaxY - this.airY0);
        this.award(`滞空 ${this.airT.toFixed(1)}s`, Math.round(this.airT * 350 + h * 10));
      }
      this.airT = 0;
    }

    // 贴墙 / 倒挂
    if (v.mode === 'wall' || v.mode === 'ceiling') {
      this.wallKind = v.mode;
      this.wallDist += v.vel.length() * dt;
    } else if (this.wallDist > 0) {
      if (this.wallDist >= 8) this.award(`${LIVE_LABEL[this.wallKind]} ${Math.round(this.wallDist)}m`, Math.round(this.wallDist * 12));
      if ((this.prevMode === 'wall' || this.prevMode === 'ceiling') && v.mode === 'ground' && v.pos.y > 6) this.award('翻上楼顶', 400);
      this.wallDist = 0;
    }

    // 极速：250 km/h 以上保持 1.2 s，掉到 220 以下才能再次触发
    const kmh = v.speedKmh;
    if (kmh > 250) {
      this.topT += dt;
      if (this.topT > 1.2 && !this.topLatch) {
        this.topLatch = true;
        this.award(`极速 ${Math.round(kmh)} km/h`, 500);
      }
    } else if (kmh < 220) {
      this.topT = 0;
      this.topLatch = false;
    }

    // 擦墙：高速贴着建筑掠过但没撞上（代替原作的擦车 NEAR MISS，M1 有车流后再加擦车）
    this.nearCd -= dt;
    if (++this.nearTick % 4 === 0 && this.nearCd <= 0 && v.mode === 'ground' && kmh > 90) {
      v.fwd(_fwd);
      _side.crossVectors(_fwd, v.groundN).normalize();
      for (const s of [1, -1]) {
        const hit = world.raycast(v.pos, _side.clone().multiplyScalar(s), TUNING.radius + 1.8, (c) => c.tag === 'ground' || c.tag === 'ramp' || c.tag === 'bound');
        if (hit && hit.dist > TUNING.radius + 0.05 && Math.abs(hit.normal.y) < 0.3) {
          const gap = hit.dist - TUNING.radius;
          this.award(`擦墙 ${gap.toFixed(1)}m`, Math.round(350 - gap * 120));
          this.nearCd = 1.2;
          break;
        }
      }
    }

    // 进行中的动作：计时条保持满格
    this.live = null;
    if (this.driftT > 0) {
      this.live = 'drift';
      this.liveValue = this.driftT;
    } else if (v.mode === 'air' && this.airT > 0.3) {
      this.live = 'air';
      this.liveValue = this.airT;
    } else if (this.wallDist > 0) {
      this.live = this.wallKind;
      this.liveValue = this.wallDist;
    }
    if (this.active) {
      if (this.live) this.timer = COMBO.window;
      else {
        this.timer -= dt;
        if (this.timer <= 0) this.bank();
      }
    }
    this.prevMode = v.mode;
    return out;
  }

  /** 外部触发的特殊加分（飞越黄浦江、穿越开瓶器等） */
  bonus(label: string, pts: number): ComboEvent[] {
    this.out.length = 0;
    this.award(label, pts);
    return this.out;
  }

  /** 外部判负（撞到行人等） */
  interrupt(): ComboEvent[] {
    this.out.length = 0;
    this.fail();
    return this.out;
  }

  get liveLabel(): string {
    return this.live ? LIVE_LABEL[this.live] : '';
  }

  private award(label: string, pts: number): void {
    pts = Math.max(10, pts);
    if (!this.active) {
      this.active = true;
      this.score = 0;
      this.mult = 1;
      this.failed = 0;
    } else this.mult = Math.min(COMBO.multMax, this.mult + COMBO.multStep);
    this.score += pts;
    this.timer = COMBO.window;
    this.lastLabel = label;
    this.lastPts = pts;
    this.out.push({ type: 'action', label, pts });
  }

  private bank(): void {
    const total = Math.round(this.score * this.mult);
    this.out.push({ type: 'bank', label: '车技连击', pts: Math.round(total * COMBO.cashRate), total });
    this.active = false;
    this.timer = 0;
  }

  private fail(): void {
    if (this.active) {
      this.out.push({ type: 'fail', label: '连击中断', pts: this.score });
      this.failed = COMBO.failShow;
      this.failedScore = this.score;
    }
    this.active = false;
    this.timer = 0;
    this.driftT = this.airT = this.wallDist = 0;
    this.live = null;
  }
}
