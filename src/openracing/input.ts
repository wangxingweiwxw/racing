// 键盘 + 手柄输入，输出物理层需要的 DriveInput（全部是「按住」状态，边沿检测在物理层做）。
import { emptyInput } from './physics/vehicle.ts';
import type { DriveInput } from './physics/vehicle.ts';

export interface UiKeys {
  camera: boolean;
  help: boolean;
  mute: boolean;
}

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

export class Input {
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  /** 自动测试 / 演示用：设置后会覆盖真实输入 */
  override: Partial<DriveInput> | null = null;
  readonly state: DriveInput = emptyInput();
  readonly touch: DriveInput = emptyInput();
  private padCamHeld=false;
  clear():void {this.keys.clear();this.pressed.clear();Object.assign(this.touch,emptyInput(),{pitch:0,action:false});Object.assign(this.state,emptyInput(),{pitch:0,action:false});document.dispatchEvent(new Event('openracing-reset-controls'));}

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.clear());
  }

  private k(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** 每帧调用一次；返回这一帧刚按下的界面按键。 */
  poll(): UiKeys {
    const s = this.state;
    const up = this.k('KeyW', 'ArrowUp') ? 1 : 0;
    const down = this.k('KeyS', 'ArrowDown') ? 1 : 0;
    const left = this.k('KeyA', 'ArrowLeft') ? 1 : 0;
    const right = this.k('KeyD', 'ArrowRight') ? 1 : 0;
    s.throttle = up - down;
    s.steer = right - left;
    s.handbrake = this.k('Space');
    s.boost = this.k('ShiftLeft', 'ShiftRight');
    s.hop = this.k('KeyE', 'KeyJ');
    s.fan = this.k('KeyF');
    s.reset = this.k('KeyR');
    s.pitch=Number(this.k('KeyI'))-Number(this.k('KeyK'));
    s.action=this.k('KeyX');

    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    let padCam = false;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.15) s.steer = ax;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05 || lt > 0.05) s.throttle = rt - lt;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ay) > 0.3) s.pitch=-ay;
      s.hop ||= !!pad.buttons[0]?.pressed;
      s.handbrake ||= !!pad.buttons[2]?.pressed;
      s.boost ||= !!pad.buttons[5]?.pressed;
      s.fan ||= !!pad.buttons[3]?.pressed;
      s.reset ||= !!pad.buttons[8]?.pressed;
      s.action ||= !!pad.buttons[1]?.pressed;
      padCam = !!pad.buttons[9]?.pressed;
    }
    if(this.touch.throttle)s.throttle=this.touch.throttle;
    if(this.touch.steer)s.steer=this.touch.steer;
    for(const key of ['handbrake','boost','hop','fan','reset','action'] as const)s[key] ||= !!this.touch[key];
    if (this.override) Object.assign(s, this.override);

    const ui: UiKeys = { camera: this.pressed.has('KeyC') || padCam&&!this.padCamHeld, help: this.pressed.has('KeyH')||this.pressed.has('Escape'), mute: this.pressed.has('KeyM') };
    this.padCamHeld=padCam;
    this.pressed.clear();
    return ui;
  }
}
