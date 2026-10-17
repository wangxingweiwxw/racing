// 后处理：泛光 + 速度感（径向模糊、色差、暗角）。低画质时直接渲染。
import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three';
import type { Camera, Scene, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * 净化：把 NaN / Inf 像素置 0，并限制最高亮度（半精度浮点上限 65504）。
 * 否则任何一个材质偶发的 NaN 像素都会被泛光和径向模糊扩散成满屏黑块。
 * 用位模式判断（指数位全 1），避免驱动把 x != x 之类的写法优化掉。
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
bool bad(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  if (bad(c.r) || bad(c.g) || bad(c.b)) c = vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragColor = vec4(clamp(c.rgb, 0.0, 60.0), 1.0);
}`,
};

const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeed: { value: 0 },
    uBoost: { value: 0 },
    uVig: { value: 0.22 },
    uTint: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSpeed; uniform float uBoost; uniform float uVig; uniform float uTint; varying vec2 vUv;
void main(){
  vec2 c = vec2(0.5, 0.54);
  vec2 d = vUv - c;
  float r = length(d);
  float amt = (uSpeed * 0.022 + uBoost * 0.018) * smoothstep(0.15, 0.7, r);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 8; i++) { float t = float(i) / 7.0; col += texture2D(tDiffuse, c + d * (1.0 - amt * t)).rgb; }
  col /= 8.0;
  float ca = (uSpeed * 0.004 + uBoost * 0.004) * r;
  col.r = mix(col.r, texture2D(tDiffuse, c + d * (1.0 + ca)).r, 0.6);
  col.b = mix(col.b, texture2D(tDiffuse, c + d * (1.0 - ca)).b, 0.6);
  col *= 1.0 - uVig * smoothstep(0.35, 0.9, r);
  col += vec3(0.25, 0.6, 1.0) * uTint * smoothstep(0.4, 0.9, r) * 0.25;
  gl_FragColor = vec4(col, 1.0);
}`,
};

export class Post {
  private composer: EffectComposer | null = null;
  private speed: ShaderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: Camera;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, enabled: boolean) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    if (!enabled) return;
    const size = renderer.getDrawingBufferSize(new Vector2());
    const rt = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.16, 0.3, 1.5);
    this.composer.addPass(this.bloom);
    this.speed = new ShaderPass(SpeedShader);
    this.composer.addPass(this.speed);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer?.setSize(w, h);
  }

  render(speed01: number, boost01: number, fanTint: number): void {
    if (!this.composer || !this.speed) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.speed.uniforms.uSpeed.value = speed01;
    this.speed.uniforms.uBoost.value = boost01;
    this.speed.uniforms.uTint.value = fanTint;
    this.composer.render();
  }
}
