import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { BUND, RIVER, buildLayout } from '../../src/openracing/world/layout.ts';
import { ColliderWorld, aabb } from '../../src/openracing/physics/colliders.ts';
import { TUNING, Vehicle, emptyInput } from '../../src/openracing/physics/vehicle.ts';
import type { DriveInput, Env, VehicleEvent } from '../../src/openracing/physics/vehicle.ts';

const layout = buildLayout();
const env: Env = { world: layout.world, river: RIVER };
const DT = 1 / 120;
const headingTo = (x: number, z: number): Quaternion =>
  new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(x, 0, z).normalize());

function run(v: Vehicle, seconds: number, inp: DriveInput | ((t: number, v: Vehicle) => DriveInput), e: Env = env): VehicleEvent[] {
  const all: VehicleEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const input = typeof inp === 'function' ? inp(i * DT, v) : inp;
    for (const ev of v.step(input, DT, e)) all.push({ ...ev });
  }
  return all;
}

const runIn = run;
const spawn = (): Vehicle => new Vehicle(layout.spawn.pos.clone(), layout.spawn.heading.clone());

test('layout 生成了足够的建筑和碰撞体', () => {
  assert.ok(layout.buildings.length > 400, `buildings=${layout.buildings.length}`);
  assert.ok(layout.world.colliders.length > layout.buildings.length);
  assert.ok(layout.buildings.some((b) => b.roof === 'clock'));
});

test('出生点稳定落在南京东路路面上', () => {
  const v = spawn();
  run(v, 1, emptyInput());
  assert.equal(v.mode, 'ground');
  assert.ok(Math.abs(v.pos.y - TUNING.radius) < 0.06, `y=${v.pos.y}`);
  assert.ok(v.vel.length() < 0.2);
});

test('全油门 2 秒内破百，主推进器更快', () => {
  const v = spawn();
  let t100 = -1;
  run(v, 3, (t, car) => {
    if (t100 < 0 && car.speedKmh >= 100) t100 = t;
    return { ...emptyInput(), throttle: 1 };
  });
  assert.ok(t100 > 0 && t100 < 2, `0-100 用时 ${t100}`);
  const b = spawn();
  let tb = -1;
  run(b, 2, (t, car) => {
    if (tb < 0 && car.speedKmh >= 100) tb = t;
    return { ...emptyInput(), throttle: 1, boost: true };
  });
  assert.ok(tb > 0 && tb < t100 && tb < 1.1, `主推进 0-100 用时 ${tb}`);
});

// 空旷的测试场
const flatWorld = new ColliderWorld();
flatWorld.add(aabb(-2000, -10, -2000, 2000, 0, 2000, 'ground'));
const flat: Env = { world: flatWorld, river: { x0: 5000, x1: 5001, waterY: -100 } };

test('手刹 + 转向进入漂移，松开后回正', () => {
  const v = new Vehicle(new Vector3(0, TUNING.radius, 0), headingTo(1, 0));
  const run = (car: Vehicle, s: number, inp: DriveInput | ((t: number, v: Vehicle) => DriveInput)) => runIn(car, s, inp, flat);
  run(v, 2.5, { ...emptyInput(), throttle: 1 });
  let maxSlip = 0;
  run(v, 0.8, (_t, car) => {
    maxSlip = Math.max(maxSlip, Math.abs(car.slip));
    return { ...emptyInput(), throttle: 1, steer: 1, handbrake: true };
  });
  assert.ok(maxSlip > (15 * Math.PI) / 180, `最大侧滑角 ${(maxSlip * 180) / Math.PI}°`);
  assert.ok(maxSlip < (75 * Math.PI) / 180, `打转了：最大侧滑角 ${(maxSlip * 180) / Math.PI}°`);
  assert.ok(v.speedKmh > 60, `漂移后速度掉太多：${v.speedKmh} km/h`);
  run(v, 1.5, { ...emptyInput(), throttle: 0.6 });
  assert.ok(Math.abs(v.slip) < 0.1, `回正后侧滑 ${v.slip}`);
  assert.ok(v.speedKmh > 60);
  assert.equal(v.mode, 'ground');
});

test('起跳离地后落回地面，消耗压缩空气', () => {
  const v = spawn();
  run(v, 0.5, emptyInput());
  const air0 = v.air;
  let maxY = 0;
  const ev = run(v, 2.5, (t, car) => {
    maxY = Math.max(maxY, car.pos.y);
    return { ...emptyInput(), hop: t < 0.05 };
  });
  assert.ok(ev.some((e) => e.type === 'hop'));
  assert.ok(maxY > TUNING.radius + 3, `最高 ${maxY}`);
  assert.equal(v.mode, 'ground');
  assert.ok(v.air < air0 + 1);
});

// 找一栋正对中山东一路的外滩建筑，从路上朝西开过去
const bund = layout.buildings.find((b) => b.style === 0 && Math.abs(b.z - 60) < 40 && b.h > 25)!;
const bundSpawn = (): Vehicle => new Vehicle(new Vector3(-50, TUNING.radius, bund.z), headingTo(-1, 0));
const bundFace = bund.x + bund.w / 2;

test('不开风扇撞外滩大楼：被挡住，不穿墙', () => {
  const v = bundSpawn();
  const ev = run(v, 3, { ...emptyInput(), throttle: 1 });
  assert.ok(v.pos.x > bundFace + TUNING.radius - 0.2, `x=${v.pos.x} face=${bundFace}`);
  assert.ok(v.pos.y < 3);
  assert.ok(ev.some((e) => e.type === 'crash'));
});

test('开风扇撞墙：吸附上墙，一路开上楼顶', () => {
  const v = bundSpawn();
  let sawWall = false;
  const ev = run(v, 5, (t, car) => {
    if (car.mode === 'wall') sawWall = true;
    const onRoof = car.mode === 'ground' && car.pos.y > 10;
    return { ...emptyInput(), throttle: onRoof ? -1 : 1, fan: t < 0.05 };
  });
  assert.ok(ev.some((e) => e.type === 'attach'));
  assert.ok(sawWall);
  // 翻过楼顶边缘，停在屋顶上
  assert.equal(v.mode, 'ground');
  assert.ok(Math.abs(v.pos.y - (bund.h + TUNING.radius)) < 0.3, `y=${v.pos.y} 楼高=${bund.h}`);
  assert.ok(v.pos.x < bundFace, `x=${v.pos.x}`);
});

test('贴墙太久风扇过热 → 掉下来', () => {
  const w = new ColliderWorld();
  w.add(aabb(-200, -10, -200, 200, 0, 200, 'ground'));
  w.add(aabb(-40, 0, -20, 0, 300, 20, 'building'));
  const tower: Env = { world: w, river: { x0: 1000, x1: 1001, waterY: -100 } };
  const v = new Vehicle(new Vector3(40, TUNING.radius, 0), headingTo(-1, 0));
  // 贴上墙后小油门慢慢爬，靠风扇挂住直到过热
  const ev = run(v, 14, (t, car) => ({ ...emptyInput(), fan: t < 0.05, throttle: car.mode === 'wall' ? 0.55 : 1 }), tower);
  const types = ev.map((e) => e.type);
  assert.ok(types.includes('attach') && types.includes('overheat') && types.includes('detach'), types.join(','));
  assert.ok(types.indexOf('overheat') < types.lastIndexOf('detach'));
});

test('掉进黄浦江会复位到岸上', () => {
  const v = new Vehicle(new Vector3(-10, BUND.promY + TUNING.radius, 120), headingTo(1, 0));
  const ev = run(v, 4, (_t, car) => ({ ...emptyInput(), throttle: car.mode === 'sunk' ? 0 : 1 }));
  assert.ok(ev.some((e) => e.type === 'splash'));
  assert.ok(ev.some((e) => e.type === 'respawn'));
  assert.ok(v.pos.x < RIVER.x0 || v.pos.x > RIVER.x1);
});

test('南京东路 → 外滩跳台 → 推进器飞越黄浦江', () => {
  const v = spawn();
  let maxX = -Infinity;
  const ev = run(v, 22, (_t, car) => {
    maxX = Math.max(maxX, car.pos.x);
    const flying = car.mode === 'air' && car.pos.x > BUND.promX0;
    return { ...emptyInput(), throttle: flying ? 0 : 1, boost: car.pos.x > -200, hop: flying && car.pos.y < 8 };
  });
  assert.ok(!ev.some((e) => e.type === 'splash'), `落水了，最远 x=${maxX}`);
  assert.ok(v.pos.x > RIVER.x1, `最远 x=${maxX}，最终 x=${v.pos.x}`);
  assert.equal(v.mode, 'ground');
});

test('碰撞体网格：射线向下能打到地面', () => {
  const hit = layout.world.raycast(new Vector3(-420, 20, 0), new Vector3(0, -1, 0), 50);
  assert.ok(hit && Math.abs(hit.dist - 20) < 0.01, JSON.stringify(hit?.dist));
});
