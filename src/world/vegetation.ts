// Eifel forest: spruce plantations and beech, scattered by tools/build_data.py from
// OSM landuse=forest / natural=wood polygons.
import * as THREE from "three";
import { Heightmap } from "../track";
import { canvasTexture, rng } from "./assets";

const CELL = 512;
export const TREE_NEAR = 430;

function spruceGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.26, 4, 6, 1, true);
  trunk.translate(0, 2, 0);
  parts.push(colorize(trunk, 0x4a3426, 0x2e2018));
  const tiers = 5;
  for (let k = 0; k < tiers; k++) {
    const r = 2.9 - k * 0.5;
    const h = 4.6 - k * 0.45;
    const cone = new THREE.ConeGeometry(r, h, 7, 1, true);
    cone.translate(0, 3.2 + k * 2.75 + h / 2, 0);
    cone.rotateY(k * 0.9);
    parts.push(colorize(cone, k < 2 ? 0x1c3a22 : 0x24482a, 0x0f2414));
  }
  return mergeColored(parts);
}

function beechGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.32, 7, 6, 1, true);
  trunk.translate(0, 3.5, 0);
  parts.push(colorize(trunk, 0x7d7a70, 0x4f4c45));
  const r = rng(5);
  const blobs: [number, number, number, number][] = [
    [0, 9.5, 0, 4.2],
    [1.8, 8.2, 1.0, 3.2],
    [-1.7, 8.0, -0.8, 3.3],
    [0.4, 11.6, -0.5, 3.0],
  ];
  for (const [x, y, z, s] of blobs) {
    const g = new THREE.IcosahedronGeometry(s, 0);
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const f = 0.82 + r() * 0.3;
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.85, p.getZ(i) * f);
    }
    g.translate(x, y, z);
    parts.push(colorize(g, 0x46682e, 0x253d19));
  }
  return mergeColored(parts);
}

/** vertex colour gradient from `bottom` (low) to `top` colour, plus a sway weight in uv.y */
function colorize(g: THREE.BufferGeometry, top: number, bottom: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  const p = ng.getAttribute("position") as THREE.BufferAttribute;
  ng.computeBoundingBox();
  const bb = ng.boundingBox!;
  const ct = new THREE.Color(top);
  const cb = new THREE.Color(bottom);
  const col = new Float32Array(p.count * 3);
  const sway = new Float32Array(p.count * 2);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - bb.min.y) / Math.max(0.01, bb.max.y - bb.min.y);
    c.copy(cb).lerp(ct, t);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    sway[i * 2] = 0;
    sway[i * 2 + 1] = Math.max(0, p.getY(i) - 3) / 20;
  }
  ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
  ng.setAttribute("uv", new THREE.BufferAttribute(sway, 2));
  return ng;
}

function mergeColored(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    const c = p.getAttribute("position").count;
    pos.set(p.getAttribute("position").array as Float32Array, o * 3);
    nrm.set(p.getAttribute("normal").array as Float32Array, o * 3);
    col.set(p.getAttribute("color").array as Float32Array, o * 3);
    uv.set(p.getAttribute("uv").array as Float32Array, o * 2);
    o += c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

function billboardTexture(): THREE.Texture {
  return canvasTexture(512, 512, (ctx) => {
    ctx.clearRect(0, 0, 512, 512);
    // spruce (left half)
    const r = rng(11);
    ctx.fillStyle = "#3b2a1e";
    ctx.fillRect(122, 400, 12, 112);
    for (let k = 0; k < 14; k++) {
      const y = 470 - k * 30;
      const w = 118 - k * 7.5;
      const g = ctx.createLinearGradient(128 - w, 0, 128 + w, 0);
      g.addColorStop(0, "#0e2414");
      g.addColorStop(0.55, k > 9 ? "#2b5232" : "#1f432a");
      g.addColorStop(1, "#0b1d10");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(128, y - 70);
      for (let a = 0; a <= 8; a++) {
        const xx = 128 - w + (a / 8) * 2 * w;
        ctx.lineTo(xx, y + (a % 2 ? 6 : -2) + r() * 6);
      }
      ctx.closePath();
      ctx.fill();
    }
    // beech (right half)
    ctx.fillStyle = "#6e6a61";
    ctx.fillRect(378, 330, 14, 182);
    const blobs = [
      [384, 210, 110],
      [320, 270, 80],
      [446, 265, 82],
      [384, 130, 80],
      [350, 330, 60],
      [420, 330, 60],
    ];
    for (const [x, y, rad] of blobs) {
      const g = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.4, rad * 0.2, x, y, rad);
      g.addColorStop(0, "#5f8a3c");
      g.addColorStop(0.7, "#3c5e27");
      g.addColorStop(1, "#22381a");
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const rr = rad * (0.88 + r() * 0.16);
        const px = x + Math.cos(ang) * rr;
        const py = y + Math.sin(ang) * rr;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  });
}

function billboardGeometry(kind: number): THREE.BufferGeometry {
  // two crossed quads; uv selects the atlas half
  const w = kind === 0 ? 6.2 : 10.5;
  const h = kind === 0 ? 19 : 14.5;
  const u0 = kind === 0 ? 0 : 0.5;
  const u1 = u0 + 0.5;
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (let q = 0; q < 2; q++) {
    const a = (q * Math.PI) / 2;
    const cx = Math.cos(a) * (w / 2);
    const cz = Math.sin(a) * (w / 2);
    const b = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, h, cz, -cx, h, -cz);
    uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    for (let k = 0; k < 4; k++) nrm.push(0, 1, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

interface Cell {
  cx: number;
  cz: number;
  near: THREE.InstancedMesh[];
}

export class Vegetation {
  readonly group = new THREE.Group();
  private cells: Cell[] = [];
  private uniforms = { uTime: { value: 0 }, uNear: { value: TREE_NEAR } };

  constructor(raw: ArrayBuffer, hm: Heightmap, quality: number) {
    this.group.name = "vegetation";
    const d = new Int16Array(raw);
    const n = d.length / 4;
    const cellsX = Math.ceil(hm.width / CELL);
    const cellsZ = Math.ceil(hm.depth / CELL);
    const buckets: number[][][] = []; // [cell][kind] -> tree indices
    for (let k = 0; k < cellsX * cellsZ; k++) buckets.push([[], []]);
    for (let i = 0; i < n; i++) {
      const x = d[i * 4] / 4;
      const z = d[i * 4 + 1] / 4;
      const cx = Math.min(cellsX - 1, Math.max(0, Math.floor((x - hm.x0) / CELL)));
      const cz = Math.min(cellsZ - 1, Math.max(0, Math.floor((z - hm.z0) / CELL)));
      buckets[cz * cellsX + cx][d[i * 4 + 3]].push(i);
    }
    const nearGeo = [spruceGeometry(), beechGeometry()];
    const bbGeo = [billboardGeometry(0), billboardGeometry(1)];
    const nearMat = this.nearMaterial();
    const bbMat = this.billboardMaterial();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let cz = 0; cz < cellsZ; cz++) {
      for (let cx = 0; cx < cellsX; cx++) {
        const b = buckets[cz * cellsX + cx];
        const cell: Cell = { cx: hm.x0 + (cx + 0.5) * CELL, cz: hm.z0 + (cz + 0.5) * CELL, near: [] };
        for (let kind = 0; kind < 2; kind++) {
          const list = b[kind];
          if (!list.length) continue;
          const near = new THREE.InstancedMesh(nearGeo[kind], nearMat, list.length);
          const farList = quality >= 2 ? list : list.filter((_, k) => k % (quality === 1 ? 2 : 3) === 0);
          if (!farList.length) continue;
          const far = new THREE.InstancedMesh(bbGeo[kind], bbMat, farList.length);
          let fk = 0;
          list.forEach((ti, k) => {
            const x = d[ti * 4] / 4;
            const z = d[ti * 4 + 1] / 4;
            const sc = d[ti * 4 + 2] / 1000;
            p.set(x, hm.height(x, z) - 0.3, z);
            q.setFromAxisAngle(up, ((ti * 2654435761) % 6283) / 1000);
            s.set(sc, sc * (0.9 + ((ti * 97) % 20) / 100), sc);
            m.compose(p, q, s);
            near.setMatrixAt(k, m);
            if (farList[fk] === ti) {
              far.setMatrixAt(fk, m);
              fk++;
            }
          });
          near.castShadow = true;
          near.receiveShadow = true;
          near.computeBoundingSphere();
          far.computeBoundingSphere();
          near.visible = false;
          cell.near.push(near);
          this.group.add(near, far);
        }
        this.cells.push(cell);
      }
    }
  }

  private nearMaterial(): THREE.MeshLambertMaterial {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uNear = this.uniforms.uNear;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uNear;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
float sw = uv.y;
transformed.x += sin(uTime * 1.3 + iPos.x * 0.05) * sw * 0.35;
transformed.z += cos(uTime * 1.1 + iPos.z * 0.05) * sw * 0.25;`,
        )
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
if (distance(iPos, cameraPosition) > uNear) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);`,
        );
    };
    mat.customProgramCacheKey = () => "tree-near-v1";
    return mat;
  }

  private billboardMaterial(): THREE.MeshLambertMaterial {
    const mat = new THREE.MeshLambertMaterial({ map: billboardTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uNear = this.uniforms.uNear;
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uNear;").replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vec3 bPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
if (distance(bPos, cameraPosition) < uNear - 15.0) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);`,
      );
    };
    mat.customProgramCacheKey = () => "tree-bb-v1";
    return mat;
  }

  update(camera: THREE.Camera, time: number) {
    this.uniforms.uTime.value = time;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const lim = TREE_NEAR + CELL * 0.75;
    for (const c of this.cells) {
      const vis = Math.abs(c.cx - cx) < lim && Math.abs(c.cz - cz) < lim;
      for (const m of c.near) m.visible = vis;
    }
  }
}
