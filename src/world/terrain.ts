// Terrain: replaces Open Street Kart's Terrain3D node with a chunked LOD grid built
// from the same kind of data (elevation raster + OSM landcover painting).
import * as THREE from "three";
import { Heightmap, TrackJSON } from "../track";
import { BASE, tex } from "./assets";

const CHUNK = 64; // cells per chunk side

export interface TerrainMaterialOpts {
  lc: TrackJSON["landcover"];
}

export function makeTerrainMaterial(opts: TerrainMaterialOpts): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
  const lcTex = tex(`${BASE}data/landcover.png`, false, false);
  lcTex.wrapS = lcTex.wrapT = THREE.ClampToEdgeWrapping;
  // image row 0 is z0 (north edge); keep it at v = 0
  lcTex.flipY = false;
  lcTex.minFilter = THREE.LinearMipmapLinearFilter;
  const lcRock = tex(`${BASE}data/landcover_rock.png`, false, false);
  lcRock.wrapS = lcRock.wrapT = THREE.ClampToEdgeWrapping;
  lcRock.flipY = false;
  const uniforms = {
    tLC: { value: lcTex },
    tLCRock: { value: lcRock },
    tGrass: { value: tex(`${BASE}textures/grass_albedo.jpg`) },
    tForest: { value: tex(`${BASE}textures/forest_floor_albedo.jpg`) },
    tField: { value: tex(`${BASE}textures/field_albedo.jpg`) },
    tRock: { value: tex(`${BASE}textures/rock_albedo.jpg`) },
    tAsphalt: { value: tex(`${BASE}textures/asphalt_clean_albedo.jpg`) },
    uLcOrigin: { value: new THREE.Vector2(opts.lc.x0, opts.lc.z0) },
    uLcSize: { value: new THREE.Vector2(opts.lc.nx * opts.lc.cell, opts.lc.nz * opts.lc.cell) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWPos;
varying vec3 vWNrm;
uniform sampler2D tLC, tLCRock, tGrass, tForest, tField, tRock, tAsphalt;
uniform vec2 uLcOrigin, uLcSize;`,
      )
      .replace(
        "#include <map_fragment>",
        `
vec2 lcUv = (vWPos.xz - uLcOrigin) / uLcSize;
vec3 lc = texture2D(tLC, lcUv).rgb;
float rk = texture2D(tLCRock, lcUv).r;
float camDist = length(vWPos - cameraPosition);
vec2 wuv = vWPos.xz;
float macro = texture2D(tGrass, wuv / 420.0).g;
float macro2 = texture2D(tField, wuv / 173.0).r;
vec3 grassA = texture2D(tGrass, wuv / 6.5).rgb;
vec3 grassB = texture2D(tGrass, wuv / 21.0 + 0.37).rgb;
vec3 grass = mix(grassA, grassB, 0.45);
// stylised OSK grass -> greyer Eifel pasture, broken up by large scale variation
grass = mix(grass, vec3(dot(grass, vec3(0.3, 0.59, 0.11))), 0.35) * vec3(0.80, 0.92, 0.66);
grass *= 0.82 + 0.36 * macro;
grass = mix(grass, grass * vec3(1.12, 1.0, 0.72), smoothstep(0.45, 0.75, macro2) * 0.6);
vec3 forestFloor = texture2D(tForest, wuv / 5.0).rgb * vec3(0.62, 0.6, 0.52);
vec3 field = texture2D(tField, wuv / 9.0).rgb * vec3(0.95, 0.88, 0.72);
vec3 rockC = texture2D(tRock, wuv / 7.0).rgb * vec3(0.78, 0.76, 0.72);
vec3 asph = texture2D(tAsphalt, wuv / 7.0).rgb * 0.95;
// seen from afar the forest is canopy, not floor (billboard trees fill the rest)
vec3 canopy = mix(vec3(0.030, 0.062, 0.030), vec3(0.060, 0.095, 0.045), macro) ;
vec3 forestC = mix(forestFloor, canopy, smoothstep(120.0, 420.0, camDist));
float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
vec3 col = grass;
col = mix(col, field, lc.g);
col = mix(col, forestC, lc.r);
col = mix(col, asph, lc.b);
col = mix(col, rockC, clamp(max(rk, smoothstep(0.30, 0.55, slope)) , 0.0, 1.0));
// far: kill texture tiling by fading toward the local average
float far = smoothstep(900.0, 3200.0, camDist);
vec3 avg = mix(vec3(0.16, 0.22, 0.11), vec3(0.42, 0.36, 0.22), lc.g);
avg = mix(avg, canopy, lc.r);
col = mix(col, avg * (0.85 + 0.3 * macro), far * 0.75);
diffuseColor.rgb *= col;
`,
      );
  };
  mat.customProgramCacheKey = () => "terrain-splat-v1";
  return mat;
}

function buildChunk(hm: Heightmap, cx: number, cz: number, step: number, skirt: number): THREE.BufferGeometry {
  const i0 = cx * CHUNK;
  const j0 = cz * CHUNK;
  const i1 = Math.min(i0 + CHUNK, hm.nx - 1);
  const j1 = Math.min(j0 + CHUNK, hm.nz - 1);
  const cols: number[] = [];
  for (let i = i0; i < i1; i += step) cols.push(i);
  cols.push(i1);
  const rows: number[] = [];
  for (let j = j0; j < j1; j += step) rows.push(j);
  rows.push(j1);
  const W = cols.length;
  const D = rows.length;
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const normalAt = (i: number, j: number) => {
    const s = step;
    const hl = hm.at(i - s, j);
    const hr = hm.at(i + s, j);
    const hd = hm.at(i, j - s);
    const hu = hm.at(i, j + s);
    const v = new THREE.Vector3(hl - hr, 2 * s * hm.cell, hd - hu).normalize();
    return v;
  };
  for (let b = 0; b < D; b++) {
    for (let a = 0; a < W; a++) {
      const i = cols[a];
      const j = rows[b];
      pos.push(hm.x0 + i * hm.cell, hm.at(i, j), hm.z0 + j * hm.cell);
      const n = normalAt(i, j);
      nrm.push(n.x, n.y, n.z);
    }
  }
  for (let b = 0; b < D - 1; b++) {
    for (let a = 0; a < W - 1; a++) {
      const A = b * W + a;
      const B = A + 1;
      const C = A + W;
      const Dd = C + 1;
      idx.push(A, C, Dd, A, Dd, B);
    }
  }
  // skirts hide LOD cracks between neighbouring chunks
  if (skirt > 0) {
    const edge = (list: number[], flip: boolean) => {
      const base = pos.length / 3;
      for (const k of list) {
        pos.push(pos[k * 3], pos[k * 3 + 1] - skirt, pos[k * 3 + 2]);
        nrm.push(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]);
      }
      for (let e = 0; e < list.length - 1; e++) {
        const a0 = list[e];
        const a1 = list[e + 1];
        const s0 = base + e;
        const s1 = base + e + 1;
        if (flip) idx.push(a0, s1, s0, a0, a1, s1);
        else idx.push(a0, s0, s1, a0, s1, a1);
      }
    };
    const top = Array.from({ length: W }, (_, a) => a);
    const bottom = Array.from({ length: W }, (_, a) => (D - 1) * W + a);
    const left = Array.from({ length: D }, (_, b) => b * W);
    const right = Array.from({ length: D }, (_, b) => b * W + W - 1);
    edge(top, false);
    edge(bottom, true);
    edge(left, true);
    edge(right, false);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function buildTerrain(hm: Heightmap, mat: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.name = "terrain";
  const ncx = Math.ceil((hm.nx - 1) / CHUNK);
  const ncz = Math.ceil((hm.nz - 1) / CHUNK);
  for (let cz = 0; cz < ncz; cz++) {
    for (let cx = 0; cx < ncx; cx++) {
      const lod = new THREE.LOD();
      const m0 = new THREE.Mesh(buildChunk(hm, cx, cz, 1, 3), mat);
      const m1 = new THREE.Mesh(buildChunk(hm, cx, cz, 2, 6), mat);
      const m2 = new THREE.Mesh(buildChunk(hm, cx, cz, 4, 14), mat);
      for (const m of [m0, m1, m2]) {
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
      }
      lod.addLevel(m0, 0);
      lod.addLevel(m1, 700);
      lod.addLevel(m2, 1600);
      lod.matrixAutoUpdate = false;
      // LOD distance is measured to the object origin, so put it at the chunk centre
      const bb = m0.geometry.boundingBox!;
      const c = bb.getCenter(new THREE.Vector3());
      for (const m of [m0, m1, m2]) {
        m.geometry.translate(-c.x, 0, -c.z);
        m.geometry.computeBoundingSphere();
      }
      lod.position.set(c.x, 0, c.z);
      lod.updateMatrix();
      for (const m of [m0, m1, m2]) m.updateMatrix();
      group.add(lod);
    }
  }
  group.add(buildOuterLand(hm, mat));
  return group;
}

/** Low resolution hills around the 8 km data square so the horizon is not a cliff. */
function buildOuterLand(hm: Heightmap, mat: THREE.Material): THREE.Mesh {
  const span = 36000;
  const n = 90;
  const cx = hm.x0 + hm.width / 2;
  const cz = hm.z0 + hm.depth / 2;
  let mean = 0;
  for (let i = 0; i < hm.h.length; i += 97) mean += hm.h[i];
  mean /= Math.ceil(hm.h.length / 97);
  const pos: number[] = [];
  const idx: number[] = [];
  const noise = (x: number, z: number) =>
    Math.sin(x * 0.00071 + 1.3) * Math.cos(z * 0.00053 - 0.4) * 60 + Math.sin(x * 0.0019 + z * 0.0013) * 25 + Math.cos(z * 0.0027 - x * 0.0009) * 12;
  for (let b = 0; b <= n; b++) {
    for (let a = 0; a <= n; a++) {
      const x = cx - span / 2 + (a / n) * span;
      const z = cz - span / 2 + (b / n) * span;
      const inside = x > hm.x0 + 30 && x < hm.x0 + hm.width - 30 && z > hm.z0 + 30 && z < hm.z0 + hm.depth - 30;
      const clx = Math.min(hm.x0 + hm.width, Math.max(hm.x0, x));
      const clz = Math.min(hm.z0 + hm.depth, Math.max(hm.z0, z));
      const edgeH = hm.height(clx, clz);
      const d = Math.hypot(x - clx, z - clz);
      const k = Math.min(1, d / 2500);
      let y = edgeH * (1 - k) + (mean + noise(x, z)) * k - 2 - d * 0.0005;
      if (inside) y = hm.height(x, z) - 40;
      pos.push(x, y, z);
    }
  }
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) {
      const A = b * (n + 1) + a;
      idx.push(A, A + n + 1, A + n + 2, A, A + n + 2, A + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = false;
  m.name = "outer-land";
  return m;
}
