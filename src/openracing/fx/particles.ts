// CPU 粒子（THREE.Points）：漂移烟、冷气白雾、地面扬尘、落水水花、撞击火花。
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, NormalBlending, Points, ShaderMaterial, Vector3 } from 'three';

export interface SpawnOpts {
  life: number;
  size0: number;
  size1: number;
  alpha: number;
  color: Color;
  drag?: number;
  /** 竖直方向加速度（正为上浮，负为下落） */
  gravity?: number;
}

export class Particles {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly a0: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private cursor = 0;
  private alive = 0;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      uniforms: { uScale: { value: 500 }, uMaxSize: { value: 160 } },
      // 屏幕尺寸封顶 + 贴近镜头（< 3 m）的粒子淡出，避免一颗粒子糊满整个屏幕
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale; uniform float uMaxSize;
varying float vA; varying vec3 vC;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 0.1);
  gl_PointSize = min(aSize * uScale / d, uMaxSize);
  gl_Position = projectionMatrix * mv;
  vA = aAlpha * smoothstep(1.0, 3.5, d);
  vC = aColor;
}`,
      fragmentShader: `varying float vA; varying vec3 vC;
void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)); a *= a * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC, a); }`,
    });
    this.points = new Points(g, mat);
    this.points.frustumCulled = false;
  }

  spawn(p: Vector3, v: Vector3, o: SpawnOpts): void {
    if (!Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z)) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = o.color.r;
    this.col[i * 3 + 1] = o.color.g;
    this.col[i * 3 + 2] = o.color.b;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.s0[i] = o.size0;
    this.s1[i] = o.size1;
    this.a0[i] = o.alpha;
    this.drag[i] = o.drag ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.alive = Math.min(this.max, this.alive + 1);
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - Math.max(this.life[i], 0) / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, t * 12);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }

  setScale(viewportHeight: number, fovDeg: number): void {
    this.points.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.points.material.uniforms.uMaxSize.value = viewportHeight * 0.3;
  }
}
