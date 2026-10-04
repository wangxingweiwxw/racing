// Particles (OSK drift GPUParticles3D / speed boost particles), skid marks, explosions.
import * as THREE from "three";

const VS = `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (600.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.1, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size0: number; size1: number;
  r: number; g: number; b: number; a: number;
  drag: number; grav: number;
}

export class ParticleSystem {
  readonly points: THREE.Points;
  private ps: P[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;

  constructor(private max: number, additive: boolean) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(p: Partial<P> & { x: number; y: number; z: number }) {
    if (this.ps.length >= this.max) this.ps.shift();
    this.ps.push({
      vx: 0, vy: 0, vz: 0, life: 0, max: 1, size0: 0.5, size1: 1.5, r: 1, g: 1, b: 1, a: 1, drag: 1, grav: 0,
      ...p,
    } as P);
  }

  update(dt: number) {
    let n = 0;
    const keep: P[] = [];
    for (const p of this.ps) {
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k - p.grav * dt;
      p.vz *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      keep.push(p);
      const t = p.life / p.max;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = p.r;
      this.col[n * 4 + 1] = p.g;
      this.col[n * 4 + 2] = p.b;
      this.col[n * 4 + 3] = p.a * (1 - t) * Math.min(1, t * 8);
      this.size[n] = p.size0 + (p.size1 - p.size0) * t;
      n++;
    }
    this.ps = keep;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.ps = [];
  }
}

/** Ring buffer of dark quads left by sliding tyres. */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private alpha: Float32Array;
  private cursor = 0;
  private last = new Map<number, THREE.Vector3>();

  constructor(private maxQuads = 3000) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxQuads * 4 * 3);
    this.alpha = new Float32Array(maxQuads * 4);
    const idx = new Uint32Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) {
      const b = q * 4;
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
    }
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.03,0.03,0.035, vA); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
  }

  /** add a segment for wheel `id`; call with null to lift the wheel */
  add(id: number, p: THREE.Vector3 | null, rightX: number, rightZ: number, strength: number) {
    if (!p) {
      this.last.delete(id);
      return;
    }
    const prev = this.last.get(id);
    if (prev && prev.distanceToSquared(p) > 0.09 && prev.distanceToSquared(p) < 9) {
      const w = 0.09;
      const q = this.cursor;
      const b = q * 12;
      this.pos.set(
        [prev.x - rightX * w, prev.y, prev.z - rightZ * w, prev.x + rightX * w, prev.y, prev.z + rightZ * w, p.x + rightX * w, p.y, p.z + rightZ * w, p.x - rightX * w, p.y, p.z - rightZ * w],
        b,
      );
      const a = 0.55 * strength;
      this.alpha.set([a, a, a, a], q * 4);
      this.cursor = (this.cursor + 1) % this.maxQuads;
      const g = this.mesh.geometry;
      (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
      this.last.set(id, p.clone());
    } else if (!prev || prev.distanceToSquared(p) >= 9) {
      this.last.set(id, p.clone());
    }
  }

  clear() {
    this.pos.fill(0);
    this.alpha.fill(0);
    this.last.clear();
    const g = this.mesh.geometry;
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
  }
}
