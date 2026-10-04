// Procedural racing kart. OSK karts are a debug box (DebugFrame) with a colour
// material; this builds a proper kart with the racer colour as livery.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { canvasTexture } from "../world/assets";

export interface KartLook {
  color: number;
  accent: number;
  helmet: number;
  number: number;
}

function taperedBox(w0: number, w1: number, h0: number, h1: number, len: number): THREE.BufferGeometry {
  // box along z, rear (z=-len/2) is w0 x h0, front (z=+len/2) is w1 x h1, bottom flat at y=0
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 4);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = p.getZ(i) + 0.5;
    const w = w0 + (w1 - w0) * t;
    const h = h0 + (h1 - h0) * t;
    p.setXYZ(i, p.getX(i) * w, (p.getY(i) + 0.5) * h, p.getZ(i) * len);
  }
  g.computeVertexNormals();
  return g;
}

export class KartModel {
  readonly root = new THREE.Group();
  /** body (suspension motion: pitch/roll) */
  readonly body = new THREE.Group();
  readonly wheels: THREE.Object3D[] = [];
  readonly frontPivots: THREE.Object3D[] = [];
  readonly steeringWheel = new THREE.Group();
  readonly driverHead = new THREE.Group();
  private wheelSpin = 0;
  readonly exhaustLocal = new THREE.Vector3(-0.42, 0.42, -0.92);
  readonly rearWheelsLocal = [new THREE.Vector3(0.62, 0.0, -0.55), new THREE.Vector3(-0.62, 0.0, -0.55)];

  constructor(look: KartLook, detailed = true) {
    this.root.add(this.body);
    const paint = new THREE.MeshStandardMaterial({ color: look.color, roughness: 0.32, metalness: 0.15 });
    const accent = new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.4, metalness: 0.1 });
    const black = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.7 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.25, metalness: 0.9 });
    const tube = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.4, metalness: 0.7 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
    const rim = new THREE.MeshStandardMaterial({ color: 0xd8d9db, roughness: 0.3, metalness: 0.85 });
    const suit = new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.75 });
    const helmet = new THREE.MeshStandardMaterial({ color: look.helmet, roughness: 0.2, metalness: 0.2 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x0b0f18, roughness: 0.05, metalness: 0.9 });

    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.body) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // chassis tubes
    for (const sx of [-1, 1]) {
      const rail = add(new THREE.CylinderGeometry(0.022, 0.022, 1.5, 8), tube, sx * 0.34, 0.1, 0);
      rail.rotation.x = Math.PI / 2;
    }
    const xTube = add(new THREE.CylinderGeometry(0.02, 0.02, 0.72, 8), tube, 0, 0.1, 0.55);
    xTube.rotation.z = Math.PI / 2;
    // floor tray
    add(new THREE.BoxGeometry(0.62, 0.02, 1.05), black, 0, 0.085, 0.05);
    // nose fairing
    const nose = add(taperedBox(0.95, 0.75, 0.2, 0.14, 0.42), paint, 0, 0.07, 0.86);
    nose.castShadow = true;
    // front bumper bar
    const fb = add(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8), chrome, 0, 0.1, 1.1);
    fb.rotation.z = Math.PI / 2;
    // front fairing (shield in front of the driver's legs)
    const shield = add(taperedBox(0.44, 0.34, 0.34, 0.18, 0.3), paint, 0, 0.1, 0.56);
    shield.rotation.x = -0.25;
    // number plate on the shield
    const numTex = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = "#f5f5f0";
      ctx.beginPath();
      ctx.arc(64, 64, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.font = "bold 76px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(look.number), 64, 70);
    });
    const plate = add(new THREE.CircleGeometry(0.1, 24), new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.6 }), 0, 0.33, 0.71);
    plate.rotation.x = -0.6;
    // side pods
    for (const sx of [-1, 1]) {
      const pod = add(new RoundedBoxGeometry(0.2, 0.17, 0.62, 2, 0.05), paint, sx * 0.5, 0.16, -0.02);
      pod.rotation.y = sx * 0.04;
      add(new THREE.BoxGeometry(0.205, 0.04, 0.5), accent, sx * 0.5, 0.2, -0.02);
    }
    // rear bumper
    add(new RoundedBoxGeometry(1.12, 0.14, 0.14, 2, 0.05), accent, 0, 0.16, -1.0);
    // seat
    const seat = add(new RoundedBoxGeometry(0.4, 0.14, 0.42, 2, 0.05), black, 0, 0.14, -0.2);
    seat.castShadow = true;
    const back = add(new RoundedBoxGeometry(0.42, 0.42, 0.08, 2, 0.04), black, 0, 0.38, -0.42);
    back.rotation.x = -0.3;
    // engine + exhaust (right rear, seen from the driver: local -x is right)
    add(new RoundedBoxGeometry(0.22, 0.28, 0.3, 2, 0.04), chrome, -0.36, 0.28, -0.42);
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 14), black, -0.36, 0.48, -0.42).rotation.z = Math.PI / 2;
    const ex = add(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 10), chrome, -0.42, 0.38, -0.72);
    ex.rotation.x = Math.PI / 2 - 0.3;
    // rear axle
    const axle = add(new THREE.CylinderGeometry(0.025, 0.025, 1.18, 8), chrome, 0, 0.14, -0.55);
    axle.rotation.z = Math.PI / 2;

    // steering column + wheel
    const col = add(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 6), tube, 0, 0.28, 0.38);
    col.rotation.x = 0.95;
    this.steeringWheel.position.set(0, 0.42, 0.22);
    this.steeringWheel.rotation.x = -0.95;
    this.body.add(this.steeringWheel);
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.017, 8, 20), black);
    this.steeringWheel.add(sw);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.02), black);
    this.steeringWheel.add(spoke);

    // driver
    const torso = add(new THREE.CapsuleGeometry(0.17, 0.32, 4, 10), suit, 0, 0.52, -0.25);
    torso.rotation.x = -0.32;
    for (const sx of [-1, 1]) {
      const arm = add(new THREE.CapsuleGeometry(0.05, 0.36, 4, 8), suit, sx * 0.17, 0.52, -0.02);
      arm.rotation.x = -1.1;
      arm.rotation.z = sx * 0.25;
      const leg = add(new THREE.CapsuleGeometry(0.065, 0.55, 4, 8), suit, sx * 0.11, 0.2, 0.3);
      leg.rotation.x = Math.PI / 2 - 0.15;
      add(new THREE.SphereGeometry(0.05, 8, 6), black, sx * 0.13, 0.43, 0.13); // gloves
    }
    this.driverHead.position.set(0, 0.9, -0.31);
    this.body.add(this.driverHead);
    const hel = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 16), helmet);
    hel.scale.set(1, 1.05, 1.12);
    hel.castShadow = true;
    this.driverHead.add(hel);
    const vis = new THREE.Mesh(new THREE.SphereGeometry(0.152, 20, 10, -0.9, 1.8, 1.15, 0.6), visor);
    vis.scale.set(1, 1.05, 1.12);
    vis.rotation.y = 0;
    this.driverHead.add(vis);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.018, 6, 24, Math.PI), paint);
    stripe.rotation.y = Math.PI / 2;
    stripe.scale.set(1.12, 1.05, 1);
    this.driverHead.add(stripe);

    // wheels: front narrow, rear wide (local +x = left, +z = forward)
    const mkWheel = (r: number, w: number) => {
      const g = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, detailed ? 22 : 12, 1), rubber);
      tyre.rotation.z = Math.PI / 2;
      tyre.castShadow = true;
      g.add(tyre);
      const sideW = new THREE.Mesh(new THREE.TorusGeometry(r * 0.88, r * 0.12, 6, detailed ? 22 : 12), rubber);
      sideW.rotation.y = Math.PI / 2;
      sideW.position.x = w / 2;
      g.add(sideW);
      const sideW2 = sideW.clone();
      sideW2.position.x = -w / 2;
      g.add(sideW2);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.012, 6), rim);
      hub.rotation.z = Math.PI / 2;
      g.add(hub);
      // spokes so the rotation reads
      for (let k = 0; k < 3; k++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, r * 1.1, 0.025), black);
        sp.rotation.x = (k * Math.PI) / 3;
        g.add(sp);
      }
      return g;
    };
    const wheelDefs: [number, number, number, number, boolean][] = [
      [0.58, 0.13, 0.62, 0.12, true],
      [-0.58, 0.13, 0.62, 0.12, true],
      [0.62, 0.14, -0.55, 0.2, false],
      [-0.62, 0.14, -0.55, 0.2, false],
    ];
    for (const [x, r, z, w, front] of wheelDefs) {
      const pivot = new THREE.Group();
      pivot.position.set(x, r, z);
      const wh = mkWheel(r, w);
      pivot.add(wh);
      this.root.add(pivot);
      this.wheels.push(wh);
      if (front) this.frontPivots.push(pivot);
      // stub axle
      if (front) {
        const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 6), chrome);
        stub.rotation.z = Math.PI / 2;
        stub.position.set(x * 0.8, 0.12, z);
        this.body.add(stub);
      }
    }
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = false;
    });
  }

  /** visual update: steering angle, wheel spin from forward speed, body pitch/roll */
  animate(dt: number, forwardSpeed: number, steer: number, pitch: number, roll: number, bounce: number) {
    this.wheelSpin += (forwardSpeed / 0.14) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.frontPivots) p.rotation.y = -steer * 0.42;
    this.steeringWheel.rotation.z = steer * 1.2;
    this.body.rotation.x = pitch;
    this.body.rotation.z = roll;
    this.body.position.y = bounce;
    this.driverHead.rotation.z = -roll * 1.5 - steer * 0.12;
    this.driverHead.rotation.y = -steer * 0.25;
  }
}
