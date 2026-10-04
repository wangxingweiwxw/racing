import * as THREE from "three";

const loader = new THREE.TextureLoader();
let maxAniso = 8;

export function setMaxAnisotropy(v: number) {
  maxAniso = v;
}

/** Loads a repeating texture. `color` textures are tagged sRGB. */
export function tex(url: string, color = true, repeat = true): THREE.Texture {
  const t = loader.load(url);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

export function loadTexture(url: string, color = true): Promise<THREE.Texture> {
  return new Promise((res, rej) => {
    loader.load(
      url,
      (t) => {
        t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        res(t);
      },
      undefined,
      rej,
    );
  });
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, color = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

/** deterministic PRNG (mulberry32) so decoration is identical on every load */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BASE = import.meta.env.BASE_URL;
