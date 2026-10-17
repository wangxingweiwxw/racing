// 轮胎印：环形缓冲区里的四边形条带。
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';

export class Skids {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly max: number;
  private readonly pos: Float32Array;
  private cursor = 0;
  private readonly last: (Vector3 | null)[] = [];

  constructor(max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 18);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.mesh = new Mesh(g, new MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** 每个车轮一个通道；active=false 时断开条带。 */
  add(channel: number, p: Vector3, side: Vector3, active: boolean): void {
    const prev = this.last[channel];
    if (!active) {
      this.last[channel] = null;
      return;
    }
    if (!prev) {
      this.last[channel] = p.clone();
      return;
    }
    if (prev.distanceToSquared(p) < 0.09) return;
    const w = 0.14;
    const a0 = prev.clone().addScaledVector(side, -w);
    const a1 = prev.clone().addScaledVector(side, w);
    const b0 = p.clone().addScaledVector(side, -w);
    const b1 = p.clone().addScaledVector(side, w);
    const i = this.cursor * 18;
    this.pos.set([...a0.toArray(), ...b0.toArray(), ...b1.toArray(), ...a0.toArray(), ...b1.toArray(), ...a1.toArray()], i);
    this.cursor = (this.cursor + 1) % this.max;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    prev.copy(p);
  }
}
