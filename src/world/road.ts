// Road surface and trackside furniture for the Nordschleife.
// Open Street Kart builds roads with the Road Generator add-on and places
// WallOfWheels / checkpoints by hand; here everything is generated from the
// centre line so the whole 20.8 km loop is covered.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Heightmap, Track, TrackQuery } from "../track";
import { BASE, canvasTexture, rng, tex } from "./assets";

const CHUNK_SAMPLES = 200;

export interface RoadBuild {
  group: THREE.Group;
  /** per-sample physical rail distance (tyre walls move it inwards) */
  railL: Float32Array;
  railR: Float32Array;
  spectatorZones: { a: number; b: number; name: string }[];
}

/** Surface position at distance s and lateral offset lat. */
function surf(track: Track, i: number, lat: number, out: THREE.Vector3, lift = 0): THREE.Vector3 {
  const q: TrackQuery = { i, t: 0, s: i * track.step, lat, half: track.half[i], yc: track.y[i], bank: track.bank[i] };
  const rx = track.rx(i);
  const rz = track.rz(i);
  out.set(track.x[i] + rx * lat, track.surfaceY(q, lat) + lift, track.z[i] + rz * lat);
  return out;
}

function makeAsphaltMaterial(): THREE.MeshStandardMaterial {
  const map = tex(`${BASE}textures/asphalt_clean_albedo.jpg`);
  const nmap = tex(`${BASE}textures/asphalt_clean_normal.jpg`, false);
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap: nmap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.82,
    metalness: 0.0,
    color: 0xffffff,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvRoad = aRoad;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vRoad; // x = lateral offset, y = half width, z = offset from racing line
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
// the OSK asphalt is a stylised navy blue; pull it to a weathered grey
float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, 0.18) * vec3(1.02, 1.0, 0.97) * 1.05;
float sCoord = vMapUv.y * 4.0;
float lat = vRoad.x;
float halfW = vRoad.y;
// repaired patches: the Ring is a quilt of asphalt from different decades
float cell = floor(sCoord / 23.0);
float side = step(0.0, lat);
float h = hash12(vec2(cell, side * 3.0 + floor(abs(lat) / 2.5)));
float patchMask = step(0.72, h);
diffuseColor.rgb *= mix(1.0, 0.78 + 0.3 * hash12(vec2(cell, 9.0)), patchMask);
// rubbered racing line
float rub = 1.0 - smoothstep(0.6, 2.2, abs(vRoad.z));
diffuseColor.rgb *= 1.0 - 0.22 * rub;
// white edge lines
float edge = smoothstep(halfW - 0.42, halfW - 0.38, abs(lat)) * (1.0 - smoothstep(halfW - 0.2, halfW - 0.16, abs(lat)));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86), edge * 0.92);
// start / finish line (checkered) at s in [0, 1.6]
float sl = step(0.0, sCoord) * (1.0 - step(1.6, sCoord));
float chk = mod(floor(lat / 0.8) + floor(sCoord / 0.8), 2.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(chk * 0.9 + 0.05), sl);
`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, 1.0 - smoothstep(0.6, 2.2, abs(vRoad.z)));",
      );
  };
  mat.customProgramCacheKey = () => "asphalt-v1";
  return mat;
}

export function buildRoad(track: Track, hm: Heightmap, terrainMat: THREE.Material): RoadBuild {
  const group = new THREE.Group();
  group.name = "road";
  const N = track.N;
  const asphalt = makeAsphaltMaterial();
  const v = new THREE.Vector3();

  // ---------------------------------------------------------------- asphalt ribbons
  const LAT_STEPS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
  for (let c0 = 0; c0 < N; c0 += CHUNK_SAMPLES) {
    const c1 = Math.min(N, c0 + CHUNK_SAMPLES);
    const pos: number[] = [];
    const uv: number[] = [];
    const road: number[] = [];
    const idx: number[] = [];
    const cols = LAT_STEPS.length;
    for (let k = c0; k <= c1; k++) {
      const i = k % N;
      const half = track.half[i];
      for (const f of LAT_STEPS) {
        const lat = f * half;
        surf(track, i, lat, v, 0.0);
        pos.push(v.x, v.y, v.z);
        uv.push(lat / 4, (k * track.step) / 4);
        road.push(lat, half, lat - track.line[i]);
      }
    }
    for (let r = 0; r < c1 - c0; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + cols;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("aRoad", new THREE.Float32BufferAttribute(road, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, asphalt);
    m.receiveShadow = true;
    group.add(m);
  }

  // ---------------------------------------------------------------- verges + skirts (terrain material)
  const railL = new Float32Array(N);
  const railR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    railL[i] = track.half[i] + track.verge;
    railR[i] = track.half[i] + track.verge;
  }
  for (const sideSign of [-1, 1]) {
    for (let c0 = 0; c0 < N; c0 += CHUNK_SAMPLES) {
      const c1 = Math.min(N, c0 + CHUNK_SAMPLES);
      const pos: number[] = [];
      const idx: number[] = [];
      const offs = [0, 1.2, 2.2, 3.2, 4.4, 7.5];
      const cols = offs.length;
      for (let k = c0; k <= c1; k++) {
        const i = k % N;
        const half = track.half[i];
        for (let c = 0; c < cols; c++) {
          const o = offs[c];
          const lat = sideSign * (half + Math.min(o, track.verge));
          surf(track, i, lat, v, 0.0);
          if (o > track.verge) {
            // skirt beyond the rail: slide down into the carved terrain
            const extra = o - track.verge;
            const rx = track.rx(i) * sideSign;
            const rz = track.rz(i) * sideSign;
            v.x += rx * extra;
            v.z += rz * extra;
            const th = hm.height(v.x, v.z);
            v.y = Math.min(v.y - 0.25 * extra, th + 0.05);
            if (c === cols - 1) v.y = Math.min(v.y, th - 0.4);
          } else if (c === 0) v.y -= 0.01;
          pos.push(v.x, v.y, v.z);
        }
      }
      for (let r = 0; r < c1 - c0; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c;
          const b = a + cols;
          // front faces up: right side columns run along +right, left side along -right
          if (sideSign > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);
          else idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, terrainMat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---------------------------------------------------------------- kerbs
  {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const red = new THREE.Color(0xc8231e);
    const white = new THREE.Color(0xf2f2ee);
    const curvAbs = (i: number) => Math.abs(track.curv[i]);
    // find runs where curvature is high; kerb on the inside, and outside on exits of tight bends
    const want = new Int8Array(N * 2); // [i*2 + side(0=left,1=right)]
    for (let i = 0; i < N; i++) {
      const c = track.curv[i];
      if (curvAbs(i) > 1 / 140) want[i * 2 + (c > 0 ? 1 : 0)] = 1;
      if (curvAbs(i) > 1 / 55) want[i * 2 + (c > 0 ? 0 : 1)] = 1;
    }
    // grow runs a little so kerbs start before the apex
    const grown = new Int8Array(N * 2);
    for (let i = 0; i < N; i++)
      for (let sd = 0; sd < 2; sd++)
        if (want[i * 2 + sd]) for (let d = -12; d <= 12; d++) grown[track.wrap(i + d) * 2 + sd] = 1;
    for (let sd = 0; sd < 2; sd++) {
      const sign = sd === 1 ? 1 : -1;
      for (let i = 0; i < N; i++) {
        if (!grown[i * 2 + sd]) continue;
        const j = (i + 1) % N;
        if (!grown[j * 2 + sd]) continue;
        const base = pos.length / 3;
        const cc = Math.floor((i * track.step) / 2.0) % 2 === 0 ? red : white;
        for (const k of [i, j]) {
          const h = track.half[k];
          surf(track, k, sign * (h - 0.12), v, 0.012);
          pos.push(v.x, v.y, v.z);
          surf(track, k, sign * (h + 0.55), v, 0.07);
          pos.push(v.x, v.y, v.z);
          surf(track, k, sign * (h + 1.1), v, 0.015);
          pos.push(v.x, v.y, v.z);
          for (let t = 0; t < 3; t++) col.push(cc.r, cc.g, cc.b);
        }
        const tri = sign > 0 ? [0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4] : [0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5];
        for (const t of tri) idx.push(base + t);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    m.receiveShadow = true;
    group.add(m);
  }

  // ---------------------------------------------------------------- tyre walls (OSK WallOfWheels)
  const tyreMatrices: THREE.Matrix4[] = [];
  {
    const tight = (i: number) => Math.abs(track.curv[i]) > 1 / 48;
    let i = 0;
    while (i < N) {
      if (!tight(i)) {
        i++;
        continue;
      }
      let j = i;
      while (j < N && tight(j)) j++;
      // outside of the bend, starting at the apex and running 40 m past the exit
      const mid = Math.floor((i + j) / 2);
      const sign = track.curv[mid] > 0 ? -1 : 1;
      const from = mid;
      const to = Math.min(N - 1, j + 20);
      for (let k = from; k <= to; k++) {
        if (sign > 0) railR[k] = Math.min(railR[k], track.half[k] + track.verge - 0.75);
        else railL[k] = Math.min(railL[k], track.half[k] + track.verge - 0.75);
      }
      for (let k = from; k <= to; k++) {
        const d = track.half[k] + track.verge - 0.38;
        for (let stack = 0; stack < 3; stack++) {
          surf(track, k, sign * d, v, 0.14 + stack * 0.26);
          const m = new THREE.Matrix4().makeTranslation(v.x, v.y, v.z);
          tyreMatrices.push(m);
          if (k % 3 === 0) {
            // stagger a second row
            surf(track, k, sign * (d + 0.25), v, 0.14 + stack * 0.26);
            tyreMatrices.push(new THREE.Matrix4().makeTranslation(v.x + 0.3 * track.tx[k], v.y, v.z + 0.3 * track.tz[k]));
          }
        }
      }
      i = j + 20;
    }
    const tyreGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 12, 1, false);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const tyres = new THREE.InstancedMesh(tyreGeo, tyreMat, tyreMatrices.length);
    tyreMatrices.forEach((m, k) => tyres.setMatrixAt(k, m));
    tyres.castShadow = true;
    tyres.receiveShadow = true;
    tyres.computeBoundingSphere();
    group.add(tyres);
  }

  // ---------------------------------------------------------------- guard rails (double Armco)
  {
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.75, roughness: 0.38, side: THREE.DoubleSide });
    const postGeo = new THREE.BoxGeometry(0.12, 1.1, 0.12);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.6, roughness: 0.5 });
    const posts: THREE.Matrix4[] = [];
    for (const sideSign of [-1, 1]) {
      for (let c0 = 0; c0 < N; c0 += CHUNK_SAMPLES) {
        const c1 = Math.min(N, c0 + CHUNK_SAMPLES);
        const pos: number[] = [];
        const idx: number[] = [];
        // two W-beams, each drawn as a 3-facet strip (bulge towards the track)
        const profile = [
          [0.0, 0.42],
          [-0.05, 0.53],
          [0.0, 0.64],
          [0.0, 0.7],
          [-0.05, 0.82],
          [0.0, 0.93],
        ];
        const cols = profile.length;
        for (let k = c0; k <= c1; k++) {
          const i = k % N;
          const d = track.half[i] + track.verge;
          for (const [inward, h] of profile) {
            surf(track, i, sideSign * (d + inward), v, h);
            pos.push(v.x, v.y, v.z);
          }
          if (k % 2 === 0) {
            surf(track, i, sideSign * (d + 0.1), v, 0.55);
            posts.push(new THREE.Matrix4().makeTranslation(v.x, v.y - 0.05, v.z));
          }
        }
        for (let r = 0; r < c1 - c0; r++) {
          for (let c = 0; c < cols - 1; c++) {
            if (c === 2) continue; // gap between the two beams
            const a = r * cols + c;
            const b = a + cols;
            idx.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, railMat);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
    }
    const pm = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    posts.forEach((m, k) => pm.setMatrixAt(k, m));
    pm.computeBoundingSphere();
    group.add(pm);
  }

  // ---------------------------------------------------------------- spectator zones, catch fences, marshal posts
  const zoneNames = ["Hatzenbach", "Flugplatz", "Adenauer Forst", "Breidscheid", "Bergwerk", "Karussell", "Wippermann", "Brünnchen", "Pflanzgarten", "Schwalbenschwanz", "Galgenkopf"];
  const spectatorZones: RoadBuild["spectatorZones"] = [];
  for (const nm of zoneNames) {
    const sec = track.sectors.find((s) => s.name === nm);
    if (!sec) continue;
    const a = sec.s + 40;
    spectatorZones.push({ a, b: a + (nm === "Brünnchen" || nm === "Karussell" ? 260 : 170), name: nm });
  }
  {
    const fenceTex = canvasTexture(128, 128, (ctx) => {
      ctx.clearRect(0, 0, 128, 128);
      ctx.strokeStyle = "rgba(200,205,210,0.95)";
      ctx.lineWidth = 2;
      for (let k = -128; k < 256; k += 16) {
        ctx.beginPath();
        ctx.moveTo(k, 0);
        ctx.lineTo(k + 128, 128);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(k + 128, 0);
        ctx.lineTo(k, 128);
        ctx.stroke();
      }
    });
    fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping;
    const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, transparent: false, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5 });
    const fencePos: number[] = [];
    const fenceUv: number[] = [];
    const fenceIdx: number[] = [];
    const poleM: THREE.Matrix4[] = [];
    for (const z of spectatorZones) {
      const i0 = Math.floor(z.a / track.step);
      const i1 = Math.floor(z.b / track.step);
      for (const sideSign of [-1, 1]) {
        const base = fencePos.length / 3;
        let n = 0;
        for (let k = i0; k <= i1; k++) {
          const i = track.wrap(k);
          const d = track.half[i] + track.verge + 1.6;
          surf(track, i, sideSign * d, v, 0);
          const gy = Math.max(v.y - 0.3, hm.height(v.x, v.z));
          fencePos.push(v.x, gy, v.z, v.x, gy + 3.6, v.z);
          fenceUv.push((k * track.step) / 1.6, 0, (k * track.step) / 1.6, 3.6 / 1.6);
          if (k % 2 === 0) poleM.push(new THREE.Matrix4().makeTranslation(v.x, gy + 1.8, v.z));
          n++;
        }
        for (let r = 0; r < n - 1; r++) {
          const a = base + r * 2;
          fenceIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(fencePos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(fenceUv, 2));
    g.setIndex(fenceIdx);
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, fenceMat));
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 3.6, 6), new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: 0.6, roughness: 0.4 }), poleM.length);
    poleM.forEach((m, k) => poles.setMatrixAt(k, m));
    poles.computeBoundingSphere();
    group.add(poles);
  }

  // marshal posts every ~520 m, alternating sides (Streckenposten)
  {
    const hut = new THREE.BoxGeometry(2.2, 2.3, 1.8);
    hut.translate(0, 1.15, 0);
    const roof = new THREE.BoxGeometry(2.6, 0.18, 2.2);
    roof.translate(0, 2.4, 0);
    const stripe = new THREE.BoxGeometry(2.22, 0.3, 1.82);
    stripe.translate(0, 1.6, 0);
    const hutM = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.8 });
    const roofM = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.7 });
    const stripeM = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.6 });
    const mats: THREE.Matrix4[] = [];
    const r = rng(77);
    let side = 1;
    for (let s = 180; s < track.length - 100; s += 520) {
      const i = Math.floor(s / track.step);
      const d = track.half[i] + track.verge + 3.5;
      surf(track, i, side * d, v, 0);
      const gy = hm.height(v.x, v.z);
      const yaw = Math.atan2(track.tx[i], track.tz[i]) + (r() - 0.5) * 0.2;
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(v.x, Math.min(gy, v.y + 0.5) - 0.05, v.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
      side = -side;
    }
    for (const [geo, mat] of [
      [hut, hutM],
      [roof, roofM],
      [stripe, stripeM],
    ] as const) {
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((m, k) => im.setMatrixAt(k, m));
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  // ---------------------------------------------------------------- signs: corner names, kilometre boards
  {
    const boardGeo = new THREE.PlaneGeometry(1, 1);
    const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.6, roughness: 0.5 });
    const legs: THREE.Matrix4[] = [];
    const addBoard = (s: number, side: number, w: number, h: number, height: number, texture: THREE.Texture) => {
      const i = track.wrap(Math.floor(s / track.step));
      const d = track.half[i] + track.verge + 0.9;
      surf(track, i, side * d, v, 0);
      const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, side: THREE.DoubleSide });
      const m = new THREE.Mesh(boardGeo, mat);
      m.scale.set(w, h, 1);
      m.position.set(v.x, v.y + height, v.z);
      // face oncoming traffic, turned slightly towards the road
      const yaw = Math.atan2(-track.tx[i], -track.tz[i]) - side * 0.35;
      m.rotation.y = yaw;
      m.castShadow = true;
      group.add(m);
      for (const lx of [-w * 0.4, w * 0.4]) {
        const ox = Math.cos(yaw) * lx;
        const oz = -Math.sin(yaw) * lx;
        legs.push(new THREE.Matrix4().compose(new THREE.Vector3(v.x + ox, v.y + (height - h / 2) / 2, v.z + oz), new THREE.Quaternion(), new THREE.Vector3(1, height - h / 2, 1)));
      }
    };
    for (const sec of track.sectors) {
      if (sec.s < 1) continue;
      const t = canvasTexture(512, 128, (ctx) => {
        ctx.fillStyle = "#0d2c54";
        ctx.fillRect(0, 0, 512, 128);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(6, 6, 500, 116);
        ctx.fillStyle = "#0d2c54";
        ctx.fillRect(12, 12, 488, 104);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 56px 'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sec.name.toUpperCase(), 256, 68, 470);
      });
      addBoard(sec.s - 60, 1, 4.2, 1.05, 2.3, t);
    }
    for (let km = 1; km * 1000 < track.length; km++) {
      const t = canvasTexture(128, 160, (ctx) => {
        ctx.fillStyle = "#f4f4f0";
        ctx.fillRect(0, 0, 128, 160);
        ctx.strokeStyle = "#111";
        ctx.lineWidth = 8;
        ctx.strokeRect(6, 6, 116, 148);
        ctx.fillStyle = "#111";
        ctx.font = "bold 84px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(km), 64, 74);
        ctx.font = "bold 24px Arial, sans-serif";
        ctx.fillText("KM", 64, 132);
      });
      addBoard(km * 1000, -1, 0.75, 0.95, 1.6, t);
    }
    const lm = new THREE.InstancedMesh(legGeo, legMat, legs.length);
    legs.forEach((m, k) => lm.setMatrixAt(k, m));
    lm.computeBoundingSphere();
    group.add(lm);
  }

  // ---------------------------------------------------------------- gantries (start / finish, sponsor bridges)
  const addGantry = (s: number, text: string, sub: string, lights: boolean) => {
    const i = track.wrap(Math.floor(s / track.step));
    const d = track.half[i] + track.verge + 1.2;
    const g = new THREE.Group();
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.4, roughness: 0.5 });
    const L = new THREE.Vector3();
    const R = new THREE.Vector3();
    surf(track, i, -d, L, 0);
    surf(track, i, d, R, 0);
    const top = Math.max(L.y, R.y) + 6.2;
    for (const p of [L, R]) {
      const gy = Math.min(p.y, hm.height(p.x, p.z)) - 0.5;
      const h = top - gy;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), pylonMat);
      m.position.set(p.x, gy + h / 2, p.z);
      m.castShadow = true;
      g.add(m);
    }
    const span = L.distanceTo(R);
    const beamTex = canvasTexture(1024, 128, (ctx) => {
      const grd = ctx.createLinearGradient(0, 0, 0, 128);
      grd.addColorStop(0, "#14233c");
      grd.addColorStop(1, "#0a1220");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 1024, 128);
      ctx.fillStyle = "#e8c33a";
      ctx.fillRect(0, 118, 1024, 10);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 64px 'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 512, 52, 980);
      ctx.font = "28px Arial, sans-serif";
      ctx.fillStyle = "#9fb4d1";
      ctx.fillText(sub, 512, 98, 980);
    });
    const beamMat = [pylonMat, pylonMat, pylonMat, pylonMat, new THREE.MeshStandardMaterial({ map: beamTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: beamTex, emissiveIntensity: 0.15 }), new THREE.MeshStandardMaterial({ map: beamTex, roughness: 0.5 })];
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.8, 1.6, 0.7), beamMat);
    beam.position.set((L.x + R.x) / 2, top - 0.8, (L.z + R.z) / 2);
    const yaw = Math.atan2(R.x - L.x, R.z - L.z) - Math.PI / 2;
    beam.rotation.y = yaw;
    beam.castShadow = true;
    g.add(beam);
    if (lights) {
      for (let k = 0; k < 5; k++) {
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), new THREE.MeshBasicMaterial({ color: 0x330000 }));
        lamp.name = `start-lamp-${k}`;
        const off = (k - 2) * 0.62;
        lamp.position.set(beam.position.x + Math.cos(yaw) * off, top - 2.0, beam.position.z - Math.sin(yaw) * off);
        lamp.rotation.y = yaw;
        lamp.translateZ(0.42);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.3), pylonMat);
        box.position.copy(lamp.position);
        box.rotation.y = yaw;
        box.translateZ(-0.2);
        g.add(box, lamp);
      }
    }
    group.add(g);
    return g;
  };
  addGantry(0.8, "NÜRBURGRING · NORDSCHLEIFE", "START / ZIEL  ·  T13  ·  20.75 KM", true);
  const dh = track.sectors.find((s) => s.name === "Döttinger Höhe");
  if (dh) {
    addGantry(dh.s + 380, "OPEN STREET KART", "OpenStreetMap · ODbL  ·  © OSM contributors", false);
    addGantry(dh.s + 640, "DÖTTINGER HÖHE", "BRIDGE TO GANTRY · BTG", false);
  }

  return { group, railL, railR, spectatorZones };
}

/** merge helper for small static props */
export function merged(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(geos, false)!;
}
