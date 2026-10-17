import * as THREE from "three";

export let roadsterEnvironment: THREE.Texture | null = null;

/** Outdoor reflection probe for the video-matched car. Avoids the indoor strip
 * lights appearing as white bands across its black glass in an outdoor race. */
export function prepareRoadsterEnvironment(renderer: THREE.WebGLRenderer) {
  if (roadsterEnvironment) return;
  const w=256,h=128,pixels=new Float32Array(w*h*4);
  const zenith=new THREE.Color(0x6285b0),horizon=new THREE.Color(0xc4cddd),ground=new THREE.Color(0x343b45);
  const c=new THREE.Color();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const elevation=Math.cos(Math.PI*(y+.5)/h);
    if(elevation>=0) c.copy(horizon).lerp(zenith,Math.pow(elevation,.45));
    else c.copy(horizon).multiplyScalar(.4).lerp(ground,Math.min(1,-elevation*4));
    const cloud=elevation>.1?Math.max(0,Math.sin(x/w*Math.PI*6+.8)*Math.sin(elevation*12)-.45)*.13:0;
    c.lerp(horizon,cloud);
    const k=(y*w+x)*4;
    pixels[k]=c.r*2.5;pixels[k+1]=c.g*2.5;pixels[k+2]=c.b*2.5;pixels[k+3]=1;
  }
  const texture=new THREE.DataTexture(pixels,w,h,THREE.RGBAFormat,THREE.FloatType);texture.colorSpace=THREE.LinearSRGBColorSpace;
  texture.flipY=true;
  texture.mapping=THREE.EquirectangularReflectionMapping;texture.needsUpdate=true;
  const pmrem=new THREE.PMREMGenerator(renderer);
  roadsterEnvironment=pmrem.fromEquirectangular(texture).texture;
  texture.dispose();pmrem.dispose();
}
