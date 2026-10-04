// Eifel sky: gradient dome with drifting cumulus (OSK uses Sky3D), sun, haze and shadows.
import * as THREE from "three";

export const HORIZON = new THREE.Color(0xb9c7d3);

export class SkyLights {
  readonly dome: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sunDir = new THREE.Vector3();
  private uniforms: Record<string, THREE.IUniform>;

  constructor(scene: THREE.Scene, shadowSize: number) {
    // late afternoon light from the south west
    const elev = THREE.MathUtils.degToRad(34);
    const az = THREE.MathUtils.degToRad(222);
    this.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
    this.uniforms = {
      uSun: { value: this.sunDir },
      uTime: { value: 0 },
      uHorizon: { value: HORIZON.clone() },
      uZenith: { value: new THREE.Color(0x3f74b5) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`,
      fragmentShader: `
uniform vec3 uSun; uniform float uTime; uniform vec3 uHorizon; uniform vec3 uZenith;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
  float sd = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.86, 0.66) * pow(sd, 6.0) * 0.22;
  // clouds on a plane
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.08) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(uv);
    float cov = smoothstep(0.50, 0.78, c);
    float lit = 0.75 + 0.35 * fbm(uv * 1.7 + 4.0) + 0.35 * pow(sd, 3.0);
    vec3 cc = mix(vec3(0.68, 0.72, 0.78), vec3(1.0, 0.98, 0.95), clamp(lit - 0.4, 0.0, 1.0));
    float fade = smoothstep(0.0, 0.18, h);
    col = mix(col, cc, cov * fade * 0.92);
  }
  col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9998, sd) * 3.0;
  if (h < 0.0) col = mix(uHorizon, uHorizon * 0.8, clamp(-h * 4.0, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xc7d9f0, 0x3d4a2c, 1.25);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = shadowSize > 0;
    this.sun.shadow.mapSize.set(Math.max(512, shadowSize), Math.max(512, shadowSize));
    const S = 70;
    const cam = this.sun.shadow.camera;
    cam.left = -S;
    cam.right = S;
    cam.top = S;
    cam.bottom = -S;
    cam.near = 1;
    cam.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.fog = new THREE.FogExp2(HORIZON.getHex(), 0.00021);
    scene.background = HORIZON.clone();
  }

  /** keep the shadow frustum around the focus point, snapped to texels to avoid shimmering */
  update(focus: THREE.Vector3, camera: THREE.Camera, time: number) {
    this.uniforms.uTime.value = time;
    this.dome.position.copy(camera.position);
    const snap = (140 / this.sun.shadow.mapSize.x) * 2;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.sunDir.x * 300, focus.y + this.sunDir.y * 300, fz + this.sunDir.z * 300);
  }
}
