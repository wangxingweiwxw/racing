import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { TUNING, Vehicle, emptyInput } from '../../src/openracing/physics/vehicle.ts';
import type { Env } from '../../src/openracing/physics/vehicle.ts';
import { RIVER, buildLayout } from '../../src/openracing/world/layout.ts';
import { PED_STREETS, buildNetwork, lightFor } from '../../src/openracing/traffic/network.ts';
import { CAR_TYPES, Traffic } from '../../src/openracing/traffic/traffic.ts';
import type { TrafficEvent } from '../../src/openracing/traffic/traffic.ts';

const layout = buildLayout();
const net = buildNetwork(layout);
const DT = 1 / 120;
const onAnyStreet = (x: number, z: number) =>
  layout.streets.some((st) => {
    const along = st.axis === 'x' ? x : z;
    const across = st.axis === 'x' ? z : x;
    return along >= st.from - 2 && along <= st.to + 2 && Math.abs(across - st.at) <= st.width / 2 + 2;
  });
const yawQ = (dx: number, dz: number) => new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(dx, 0, dz).normalize());

test('路网：路口、车道段齐全，每条车道都有去向，步行街不走车', () => {
  assert.ok(net.nodes.length > 120, `nodes=${net.nodes.length}`);
  assert.ok(net.segs.length > 600, `segs=${net.segs.length}`);
  for (const s of net.segs) {
    assert.ok(s.out.length > 0, `seg ${s.id} 没有去向`);
    assert.ok(!PED_STREETS.has(s.street));
  }
  assert.ok(net.nodes.filter((n) => n.signal).length > 80);
});

test('车道不穿过任何建筑、坡道或地标', () => {
  const pool: never[] = [];
  for (const s of net.segs) {
    for (let t = 0; t <= s.len; t += 3) {
      const p = new Vector3(s.sx + s.dx * t, 1.0, s.sz + s.dz * t);
      const n = layout.world.contacts(p, 1.0, 0, pool);
      for (let i = 0; i < n; i++) {
        const c = (pool as unknown as { collider: { tag: string }; depth: number }[])[i];
        assert.ok(c.depth <= 0 || c.collider.tag === 'ground', `${s.street} 车道在 (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) 撞到 ${c.collider.tag}`);
      }
    }
  }
});

test('红绿灯：东西向和南北向不会同时绿灯', () => {
  const n = net.nodes.find((x) => x.signal)!;
  for (let t = 0; t < 40; t += 0.25) {
    assert.ok(!(lightFor(n, 'x', t) === 'green' && lightFor(n, 'z', t) === 'green'), `t=${t}`);
  }
});

test('车流跑 60 秒：始终在路上，同一车道不重叠，平均速度合理', () => {
  const tr = new Traffic(net, 170, 7, layout.world);
  let sumV = 0;
  let samples = 0;
  for (let i = 0; i < 60 * 60; i++) {
    tr.step(1 / 60, null);
    if (i % 60 !== 0) continue;
    const bySeg = new Map<number, typeof tr.cars>();
    for (const c of tr.cars) {
      sumV += c.v;
      samples++;
      if (c.state !== 'drive') continue;
      const onRoad = onAnyStreet(c.x, c.z) || net.nodes.some((n) => Math.abs(n.x - c.x) < n.halfX + 4 && Math.abs(n.z - c.z) < n.halfZ + 4);
      assert.ok(onRoad, `车 ${c.id} 跑出路面 (${c.x.toFixed(1)}, ${c.z.toFixed(1)})`);
      if (c.s >= 0) {
        if (!bySeg.has(c.seg)) bySeg.set(c.seg, []);
        bySeg.get(c.seg)!.push(c);
      }
    }
    for (const list of bySeg.values()) {
      list.sort((a, b) => a.s - b.s);
      for (let k = 1; k < list.length; k++) {
        const gap = list[k].s - list[k - 1].s - (CAR_TYPES[list[k].type].len + CAR_TYPES[list[k - 1].type].len) / 2;
        assert.ok(gap > -0.3, `同车道重叠 gap=${gap.toFixed(2)}`);
      }
    }
  }
  const avg = sumV / samples;
  assert.ok(avg > 3 && avg < 16, `平均速度 ${avg.toFixed(1)} m/s`);
});

test('红灯前停车', () => {
  const tr = new Traffic(net, 1, 11, layout.world);
  const car = tr.cars[0];
  const seg = net.segs.find((s) => net.nodes[s.to].signal && s.len > 80)!;
  car.seg = seg.id;
  car.s = 10;
  car.v = 12;
  // 找一个这条车道是红灯、并且会持续 8 秒以上红灯的时刻
  let t0 = 0;
  while (!(lightFor(net.nodes[seg.to], seg.axis, t0) === 'red' && lightFor(net.nodes[seg.to], seg.axis, t0 + 12) === 'red')) t0 += 0.5;
  tr.time = t0;
  let passed = false;
  for (let i = 0; i < 60 * 12; i++) {
    tr.step(1 / 60, null);
    if (car.seg !== seg.id) passed = true;
  }
  assert.ok(!passed, '闯红灯了');
  assert.ok(car.v < 0.3, `没停住 v=${car.v}`);
  assert.ok(seg.len - car.s < 8, `停得太远 ${seg.len - car.s}`);
});

function trafficEnv(tr: Traffic): Env {
  return { world: layout.world, river: RIVER, dynamic: tr };
}

test('玩家撞车：车被撞开、玩家收到撞击事件、之后能回到车流', () => {
  const tr = new Traffic(net, 1, 5, layout.world);
  const car = tr.cars[0];
  const seg = net.segs.find((s) => s.axis === 'x' && s.len > 90 && s.street !== '中山东一路')!;
  car.seg = seg.id;
  car.s = 60;
  car.v = 0;
  car.v0f = 0.001;
  tr.time = 0;
  tr.step(1 / 60, null);
  // 玩家沿同一车道从后面追尾
  const v = new Vehicle(new Vector3(seg.sx + seg.dx * 15, TUNING.radius, seg.sz + seg.dz * 15), yawQ(seg.dx, seg.dz));
  const env = trafficEnv(tr);
  const tev: TrafficEvent[] = [];
  const vev: string[] = [];
  for (let i = 0; i < 120 * 3; i++) {
    for (const e of v.step({ ...emptyInput(), throttle: 1 }, DT, env)) vev.push(e.type);
    for (const e of tr.step(DT, v)) tev.push(e);
  }
  assert.ok(tev.some((e) => e.type === 'hit'), JSON.stringify(tev));
  assert.ok(vev.includes('crash'));
  assert.equal(car.state, 'knocked');
  // 玩家走远之后，被撞的车重新回到车道上
  v.place(new Vector3(-800, TUNING.radius, -650), yawQ(1, 0));
  for (let i = 0; i < 60 * 9; i++) tr.step(1 / 60, v);
  assert.equal(car.state, 'drive');
});

test('擦车：高速贴着车开过去触发 nearMiss，不撞上', () => {
  const tr = new Traffic(net, 1, 9, layout.world);
  const car = tr.cars[0];
  const seg = net.segs.find((s) => s.axis === 'x' && s.dx > 0 && s.lane === 1 && s.len > 100)!;
  car.seg = seg.id;
  car.s = 50;
  car.v = 0;
  car.v0f = 0.001;
  tr.step(1 / 60, null);
  // 玩家贴着车身同向高速超过（车道线附近，离车身约 0.9 m）
  const rx = -seg.dz;
  const rz = seg.dx;
  const v = new Vehicle(new Vector3(seg.sx + seg.dx * 5 - rx * 2.8, TUNING.radius, seg.sz + seg.dz * 5 - rz * 2.8), yawQ(seg.dx, seg.dz));
  v.vel.set(seg.dx * 30, 0, seg.dz * 30);
  const env = trafficEnv(tr);
  const tev: TrafficEvent[] = [];
  for (let i = 0; i < 120 * 3; i++) {
    v.step({ ...emptyInput(), throttle: 1 }, DT, env);
    for (const e of tr.step(DT, v)) tev.push(e);
  }
  assert.ok(tev.some((e) => e.type === 'nearMiss'), JSON.stringify(tev));
  assert.ok(!tev.some((e) => e.type === 'hit'));
});

test('车流会给停在车道上的玩家刹车，并按喇叭', () => {
  const tr = new Traffic(net, 1, 13, layout.world);
  const car = tr.cars[0];
  const seg = net.segs.find((s) => s.len > 100 && !net.nodes[s.to].signal) ?? net.segs.find((s) => s.len > 100)!;
  car.seg = seg.id;
  car.s = 5;
  car.v = 12;
  const v = new Vehicle(new Vector3(seg.sx + seg.dx * 45, TUNING.radius, seg.sz + seg.dz * 45), yawQ(-seg.dz, seg.dx));
  const env = trafficEnv(tr);
  const tev: TrafficEvent[] = [];
  for (let i = 0; i < 120 * 9; i++) {
    v.step(emptyInput(), DT, env);
    for (const e of tr.step(DT, v)) tev.push(e);
  }
  assert.ok(!tev.some((e) => e.type === 'hit'), '撞上玩家了');
  assert.ok(car.v < 0.6, `没停 v=${car.v}`);
  assert.ok(tev.some((e) => e.type === 'honk'));
});

test('车流气泡：玩家附近始终有车，远处的车会被搬过来', () => {
  const tr = new Traffic(net, 120, 21, layout.world);
  const v = new Vehicle(new Vector3(-420, TUNING.radius, 0), yawQ(1, 0));
  for (let i = 0; i < 60 * 5; i++) tr.step(1 / 60, v);
  const near = tr.cars.filter((c) => Math.hypot(c.x - v.pos.x, c.z - v.pos.z) < 420).length;
  assert.ok(near > 100, `玩家 420 m 内只有 ${near} 辆`);
  // 刚搬过来的车不会出现在玩家眼前（160 m 内）
  v.place(new Vector3(700, TUNING.radius, 300), yawQ(1, 0));
  tr.step(1 / 60, v);
  const pop = tr.cars.filter((c) => c.state === 'drive' && Math.hypot(c.x - 700, c.z - 300) < 150).length;
  assert.equal(pop, 0, `${pop} 辆车直接出现在玩家旁边`);
});

test('靠右行驶：车道在行驶方向的右手边（three.js 右手系 fwd × up）', () => {
  const up = new Vector3(0, 1, 0);
  for (const s of net.segs.slice(0, 200)) {
    const n = net.nodes[s.from];
    const fwd = new Vector3(s.dx, 0, s.dz);
    const right = new Vector3().crossVectors(fwd, up);
    // 车道起点相对道路中线的偏移应该在右侧
    const off = new Vector3(s.sx - n.x, 0, s.sz - n.z);
    off.addScaledVector(fwd, -off.dot(fwd));
    assert.ok(off.dot(right) > 1, `${s.street} 车道在左侧`);
  }
});

test('真实方位：面朝北时浦东（东）在右手边，北京东路在南京东路北边', () => {
  const north = new Vector3(0, 0, -1);
  const right = new Vector3().crossVectors(north, new Vector3(0, 1, 0));
  assert.ok(right.x > 0.99, '东不在右边');
  const bj = layout.streets.find((s) => s.name === '北京东路')!;
  const nj = layout.streets.find((s) => s.name === '南京东路')!;
  assert.ok(bj.at < nj.at, '北京东路应该在北（z 更小）');
});
