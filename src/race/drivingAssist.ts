import type { Kart, KartInput } from "./kart";
import type { Track } from "../track";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const angle = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

/** Arcade help, not an autopilot: anticipates bends and intervenes at the road edge. */
export class DrivingAssist {
  readonly speeds: Float32Array;
  targetSpeed = 0;
  braking = false;
  recovering = false;
  private frame = { x: 0, y: 0, z: 0, tx: 0, tz: 0, i: 0, half: 0, bank: 0 };

  constructor(private track: Track, maxSpeed: number, lateralAcceleration: number) {
    this.speeds = new Float32Array(track.N);
    for (let i = 0; i < track.N; i++) {
      // A player need not follow the ideal racing line; use the tighter curvature.
      const curvature = Math.max(Math.abs(track.curv[i]), Math.abs(track.lineCurv[i]));
      this.speeds[i] = Math.min(maxSpeed, Math.sqrt(lateralAcceleration * .7 / Math.max(curvature, 1e-6)));
    }
    // Plan across the finish line too. Reserve braking capacity for slopes and corrections.
    for (let k = track.N * 2 - 1; k >= 0; k--) {
      const i = k % track.N;
      this.speeds[i] = Math.min(this.speeds[i], Math.sqrt(this.speeds[(i + 1) % track.N] ** 2 + 2 * 18 * track.step));
    }
  }

  apply(kart: Kart, input: KartInput): void {
    this.braking = this.recovering = false;
    const tr = this.track;
    const q = kart.q;
    const v = kart.speed;
    const ahead = tr.wrapS(q.s + 8 + v * .45) / tr.step;
    const i = tr.wrap(Math.floor(ahead));
    const t = ahead - Math.floor(ahead);
    this.targetSpeed = Math.min(kart.maxSpeed, this.speeds[i] * (1 - t) + this.speeds[tr.wrap(i + 1)] * t);
    // A hover session keeps steering help through descent. Ordinary jumps/spins do not.
    const flying = kart.flightControlActive || (kart.flightEnabled && input.lift && kart.flightCharge >= .25 && kart.grounded);
    const alignment = Math.sin(kart.heading) * tr.tx[q.i] - Math.cos(kart.heading) * tr.tz[q.i];
    if ((!kart.grounded && !flying) || kart.forwardSpeed < 5 || kart.spin > 0 || alignment < .5) return;

    const horizon = flying ? 1.1 : .8;
    const f = tr.frameAt(q.s + v * horizon, this.frame);
    const predictedLat = (kart.pos.x + kart.vel.x * horizon - f.x) * -f.tz + (kart.pos.z + kart.vel.z * horizon - f.z) * f.tx;
    const margin = Math.max(1, f.half - kart.halfWidth - .7);
    const risk = clamp((Math.abs(predictedLat) - margin + 1) / 2, 0, 1);
    if (risk > 0) {
      const want = Math.atan2(f.tx, -f.tz) - Math.atan2(q.lat * .5, Math.max(10, v));
      const yawCapacity = Math.min(2.4, kart.aLatMax / Math.max(v, 3)) * (flying ? .7 : 1);
      const recovery = clamp(angle(want - kart.heading) * 2 / yawCapacity, -1, 1);
      // Only replace input that would worsen the excursion. Inward input stays available.
      const side = Math.sign(predictedLat);
      if (input.steer * side > recovery * side) {
        input.steer += (recovery - input.steer) * risk * .85;
        this.recovering = true;
      }
      this.targetSpeed *= 1 - risk * .25;
    }
    // Air help only changes steering; the player retains throttle, brake and lift control.
    if (flying) return;
    const excess = v - this.targetSpeed;
    if (excess > 0) {
      const pedal = -clamp(excess / 4, 0, 1);
      if (input.throttle > pedal) {
        input.throttle = pedal;
        this.braking = true;
      }
    } else if (input.throttle > 0 && this.targetSpeed < kart.maxSpeed - .5) {
      // Ease back onto the accelerator without alternating full throttle and full brake.
      input.throttle = Math.min(input.throttle, clamp(-excess / 3, 0, 1));
    }
  }
}
