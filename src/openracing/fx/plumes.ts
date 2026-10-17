// 冷气推进器喷流：不是火焰，是高压气体膨胀形成的白色凝结雾柱（带一点激波环）。
import { AdditiveBlending, CylinderGeometry, DoubleSide, Mesh, ShaderMaterial, Vector3 } from 'three';
import type { Group } from 'three';
import type { Socket } from '../car/model.ts';

const plumeGeo = new CylinderGeometry(0.07, 0.42, 1, 16, 8, true).translate(0, -0.5, 0);

function plumeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uI: { value: 0 }, uSeed: { value: Math.random() * 10 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime; uniform float uI; uniform float uSeed; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main(){
  float along = clamp(1.0 - vUv.y, 0.0, 1.0);
  vec3 nn = vN / max(length(vN), 1e-4);
  vec3 vv = vV / max(length(vV), 1e-4);
  float rim = pow(clamp(abs(dot(nn, vv)), 0.0, 1.0), 1.4);
  float n = noise(vec2(vUv.x * 9.0 + uSeed, along * 7.0 - uTime * 16.0));
  float diamonds = 0.7 + 0.3 * sin(along * 26.0 - uTime * 40.0) * (1.0 - along);
  float a = clamp(uI * pow(max(1.0 - along, 0.0), 1.5) * rim * (0.45 + 0.75 * n) * diamonds, 0.0, 1.0);
  vec3 col = mix(vec3(1.0, 1.0, 1.0), vec3(0.6, 0.78, 1.0), along) * (1.2 + 1.6 * (1.0 - along) * uI);
  gl_FragColor = vec4(col, a * 0.38);
}`,
  });
}

const MAX_LEN: Record<Socket['kind'], number> = { main: 2.1, down: 1.7, side: .85 };

export class Plumes {
  readonly meshes: Mesh<CylinderGeometry, ShaderMaterial>[] = [];
  readonly sockets: Socket[];

  constructor(root: Group, sockets: Socket[]) {
    this.sockets = sockets;
    for (const s of sockets) {
      const m = new Mesh(plumeGeo, plumeMaterial());
      m.position.copy(s.pos).addScaledVector(s.dir, 0.08);
      m.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), s.dir);
      m.visible = false;
      m.renderOrder = 2;
      root.add(m);
      this.meshes.push(m);
    }
  }

  /** intensities 与 sockets 一一对应（0..1） */
  update(t: number, intensities: number[]): void {
    this.meshes.forEach((m, i) => {
      const k = intensities[i];
      m.visible = k > 0.02;
      if (!m.visible) return;
      const flick = 0.9 + 0.1 * Math.sin(t * 90 + i * 7);
      const len = MAX_LEN[this.sockets[i].kind] * (0.35 + 0.65 * k) * flick;
      m.scale.set(0.6 + 0.6 * k, len, 0.6 + 0.6 * k);
      m.material.uniforms.uTime.value = t;
      m.material.uniforms.uI.value = k;
    });
  }
}
