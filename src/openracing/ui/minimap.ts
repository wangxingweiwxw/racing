// 圆形小地图：随车头旋转，已探索的街道更亮，绿色虚线指向当前目标。
import { PEARL, RIVER, BOUNDS, BUND, JINMAO, SHC, SWFC } from '../world/layout.ts';
import type { Layout } from '../world/layout.ts';

const RANGE = 260; // 半径对应的米数

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly layout: Layout;
  private readonly dpr: number;

  constructor(canvas: HTMLCanvasElement, layout: Layout) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = canvas.clientWidth || 132;
    canvas.width = this.size * this.dpr;
    canvas.height = this.size * this.dpr;
    this.ctx = canvas.getContext('2d')!;
    this.layout = layout;
  }

  /** fx/fz：车头水平朝向；seen：已探索街道名 */
  draw(
    px: number, pz: number, fx: number, fz: number, goal: { x: number; z: number } | null, seen: Set<string>,
    cars: readonly { x: number; z: number }[] = [],
  ): void {
    const g = this.ctx;
    const S = this.size;
    const c = S / 2;
    const s = (c - 4) / RANGE;
    const dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(c, c, c - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(8,10,18,0.78)';
    g.fillRect(0, 0, S, S);

    // 世界 → 屏幕：车头朝上
    const a = -s * fz;
    const cc = s * fx;
    const b = -s * fx;
    const d = -s * fz;
    const e = c - (a * px + cc * pz);
    const f = c - (b * px + d * pz);
    g.setTransform(a * dpr, b * dpr, cc * dpr, d * dpr, e * dpr, f * dpr);

    g.fillStyle = '#121722';
    g.fillRect(BOUNDS.x0, BOUNDS.z0, RIVER.x0 - BOUNDS.x0, BOUNDS.z1 - BOUNDS.z0);
    g.fillRect(RIVER.x1, BOUNDS.z0, BOUNDS.x1 - RIVER.x1, BOUNDS.z1 - BOUNDS.z0);
    g.fillStyle = '#0d2a46';
    g.fillRect(RIVER.x0, BOUNDS.z0 - 300, RIVER.x1 - RIVER.x0, BOUNDS.z1 - BOUNDS.z0 + 600);
    g.fillStyle = '#2b2f38';
    g.fillRect(BUND.promX0, BOUNDS.z0 + 50, BUND.promX1 - BUND.promX0, BOUNDS.z1 - BOUNDS.z0 - 100);

    for (const st of this.layout.streets) {
      g.fillStyle = st.name && seen.has(st.name) ? '#5d6880' : '#2f3542';
      const w = st.width;
      if (st.axis === 'x') g.fillRect(st.from, st.at - w / 2, st.to - st.from, w);
      else g.fillRect(st.at - w / 2, st.from, w, st.to - st.from);
    }
    for (const [lx, lz, col, r] of [
      [PEARL.x, PEARL.z, '#ff4fa8', 16],
      [JINMAO.x, JINMAO.z, '#ffc26b', 14],
      [SWFC.x, SWFC.z, '#8fd8ff', 14],
      [SHC.x, SHC.z, '#5ff2d6', 18],
    ] as [number, number, string, number][]) {
      g.fillStyle = col;
      g.beginPath();
      g.arc(lx, lz, r, 0, Math.PI * 2);
      g.fill();
    }

    // 附近车辆
    g.fillStyle = 'rgba(220,226,240,0.75)';
    for (const car of cars) {
      if (Math.abs(car.x - px) > RANGE || Math.abs(car.z - pz) > RANGE) continue;
      g.fillRect(car.x - 2.2, car.z - 2.2, 4.4, 4.4);
    }

    // 回到屏幕坐标画路线、目标、玩家
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (goal) {
      let gx = a * goal.x + cc * goal.z + e;
      let gy = b * goal.x + d * goal.z + f;
      const dx = gx - c;
      const dy = gy - c;
      const len = Math.hypot(dx, dy);
      const lim = c - 9;
      const off = len > lim;
      if (off) {
        gx = c + (dx / len) * lim;
        gy = c + (dy / len) * lim;
      }
      g.strokeStyle = 'rgba(70,235,140,0.9)';
      g.lineWidth = 2.5;
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(gx, gy);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#3ee6c8';
      g.strokeStyle = '#04110e';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(gx, gy, off ? 4.5 : 6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // 北
    const nLen = Math.hypot(cc, d);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = '600 9px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // 北 = -z
    g.fillText('N', c - (cc / nLen) * (c - 10), c - (d / nLen) * (c - 10));
    // 玩家箭头
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(c, c - 8);
    g.lineTo(c + 5.5, c + 6);
    g.lineTo(c, c + 3);
    g.lineTo(c - 5.5, c + 6);
    g.closePath();
    g.fill();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(c, c, c - 1.5, 0, Math.PI * 2);
    g.stroke();
  }
}
