// U9 Xtreme imported from the supplied Assetto Corsa mod. Shared geometry and
// textures stay cached; each racer owns its paint, glass and light materials.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BASE, canvasTexture } from "../world/assets";

export interface KartLook { color: number; accent: number; helmet: number; number: number }
let highModel: THREE.Group | null = null;
let lowModel: THREE.Group | null = null;
let pending: Promise<void> | null = null;

export function loadCarModels(quality = 1): Promise<void> {
  if (pending) return pending;
  const loader = new GLTFLoader();
  pending = (async () => {
    const low = await loader.loadAsync(`${BASE}models/u9x/u9x-lod.glb`);
    lowModel = low.scene;
    highModel = quality > 0 ? (await loader.loadAsync(`${BASE}models/u9x/u9x.glb`)).scene : lowModel;
    for (const scene of new Set([lowModel, highModel])) {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.userData.sharedVehicle = true;
        mesh.geometry.computeBoundingSphere();
        mesh.geometry.computeBoundingBox();
      });
    }
  })().catch((error) => { pending = null; throw error; });
  return pending;
}

export class KartModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly wheels: THREE.Object3D[] = [];
  readonly frontPivots: THREE.Object3D[] = [];
  readonly rearWheelsLocal: THREE.Vector3[] = [];
  private wheelSpin = 0;
  private brakeLights: THREE.MeshStandardMaterial[] = [];
  private lastSpeed = 0;

  constructor(look: KartLook, detailed = true) {
    const template = detailed ? highModel : lowModel;
    if (!template) throw new Error("U9X model has not finished loading");
    this.root.name = "Yangwang U9 Xtreme";
    this.root.add(this.body);
    const car = template.clone(true);
    this.body.add(car);
    const box = new THREE.Box3().setFromObject(car);
    const center = box.getCenter(new THREE.Vector3());
    car.position.set(-center.x, -box.min.y + 0.025, -center.z);
    const materials = new Map<THREE.Material, THREE.Material>();
    car.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const cloneMaterial = (original: THREE.Material) => {
        if (materials.has(original)) return materials.get(original)!;
        const mat = original.clone() as THREE.MeshStandardMaterial;
        if (/EXT_carpaint/i.test(mat.name)) {
          // Keep the livery/AO texture, colour each entrant independently.
          mat.color.setHex(look.color === 0xe63946 ? 0xc80012 : look.color);
          mat.metalness = 0.28;
          mat.roughness = 0.3;
          mat.roughnessMap = null;
          mat.metalnessMap = null;
          if (mat instanceof THREE.MeshPhysicalMaterial) { mat.clearcoat = 0.55; mat.clearcoatRoughness = 0.24; }
        }
        if (/windows|glass/i.test(mat.name)) {
          mat.color.setHex(0x111b25); mat.transparent = true; mat.opacity = 0.72;
          mat.roughness = 0.12; mat.metalness = 0.35; mat.depthWrite = false;
        }
        if (/carbon|carb_|gloss/i.test(mat.name)) { mat.roughness = 0.4; mat.metalness = 0.18; }
        if (/Exhaust_semigloss/.test(mat.name)) { mat.color.setHex(0x161a20); mat.roughness = 0.45; mat.metalness = 0.15; }
        if (mat.name === "Lights") { mat.color.setHex(0x1d2229); mat.roughness = 0.3; }
        if (mat.name === "Led") { mat.emissive.setHex(0xddeeff); mat.emissiveMap = mat.map; mat.emissiveIntensity = 0.4; }
        mat.envMapIntensity = 0.38;
        materials.set(original, mat);
        return mat;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneMaterial) : cloneMaterial(mesh.material);
      if (/^(3STOP|FR_LR|FR_RR|RAIN|SM_Light_B_101_SUB1|SK_Trunk_101_SUB1)(_|$)/.test(mesh.name)) {
        const tail = (mesh.material as THREE.MeshStandardMaterial).clone();
        tail.color.setHex(0xb30016); tail.emissive.setHex(0xff061b);
        tail.emissiveMap = /SM_Light_B|SK_Trunk/.test(mesh.name) ? tail.map : null;
        tail.emissiveIntensity = 1.3;
        mesh.material = tail;
        this.brakeLights.push(tail);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    const plateTexture = canvasTexture(512, 128, (ctx) => {
      ctx.fillStyle = "#0d1119"; ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = "#edf5ff"; ctx.font = "500 57px Arial, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("仰望 U9 X", 256, 67);
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.18), new THREE.MeshStandardMaterial({ map: plateTexture, roughness: 0.6 }));
    plate.name = "U9X rear plate";
    plate.position.set(0, 0.63 + car.position.y, -2.38 + car.position.z);
    plate.rotation.y = Math.PI;
    this.body.add(plate);
    this.root.updateMatrixWorld(true);
    // This mod's wheel transforms are at the origin, so recover each axle's
    // centre from its geometry before adding spin / steering pivots.
    for (const suffix of ["LF", "RF", "LR", "RR"]) {
      const wheel = car.getObjectByName(`WHEEL_${suffix}`);
      if (!wheel) throw new Error(`U9X wheel missing: ${suffix}`);
      const wheelCenter = new THREE.Box3().setFromObject(wheel).getCenter(new THREE.Vector3());
      const pivot = new THREE.Group();
      pivot.position.copy(this.body.worldToLocal(wheelCenter));
      this.body.add(pivot);
      const spin = new THREE.Group();
      pivot.add(spin);
      pivot.updateWorldMatrix(true, true);
      spin.attach(wheel);
      this.wheels.push(spin);
      if (suffix.endsWith("F")) this.frontPivots.push(pivot);
      else this.rearWheelsLocal.push(new THREE.Vector3(pivot.position.x, 0.02, pivot.position.z));
    }
  }

  animate(dt: number, forwardSpeed: number, steer: number, pitch: number, roll: number, bounce: number) {
    this.wheelSpin = (this.wheelSpin + forwardSpeed / 0.36 * dt) % (Math.PI * 2);
    for (const wheel of this.wheels) wheel.rotation.x = this.wheelSpin;
    for (const pivot of this.frontPivots) pivot.rotation.y = -steer * 0.42;
    this.body.rotation.set(pitch, 0, roll);
    this.body.position.y = bounce;
    const braking = dt > 0 && forwardSpeed < this.lastSpeed - dt * 2;
    for (const light of this.brakeLights) light.emissiveIntensity = braking ? 2.5 : 0.8;
    this.lastSpeed = forwardSpeed;
  }

  dispose() {
    const materials = new Set<THREE.Material>();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        if (mesh.name === "U9X rear plate") (mesh.material as THREE.MeshStandardMaterial).map?.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
      }
    });
    materials.forEach((m) => m.dispose());
  }
}
