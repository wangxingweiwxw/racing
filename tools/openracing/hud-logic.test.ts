import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { ColliderWorld, aabb } from '../../src/openracing/physics/colliders.ts';
import { TUNING, Vehicle, emptyInput } from '../../src/openracing/physics/vehicle.ts';
import type { DriveInput, Env } from '../../src/openracing/physics/vehicle.ts';
import { COMBO, Combo } from '../../src/openracing/game/combo.ts';
import type { ComboEvent } from '../../src/openracing/game/combo.ts';
import { Discovery, Objectives, buildObjectives, fmtTime } from '../../src/openracing/game/objectives.ts';
import { RIVER, buildLayout } from '../../src/openracing/world/layout.ts';

const DT = 1 / 120;
const east = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(1, 0, 0));

function arena(extra?: (w: ColliderWorld) => void): Env {
  const w = new ColliderWorld();
  w.add(aabb(-3000, -10, -3000, 3000, 0, 3000, 'ground'));
  extra?.(w);
  return { world: w, river: { x0: 9000, x1: 9001, waterY: -100 } };
}

function play(v: Vehicle, c: Combo, env: Env, seconds: number, inp: (t: number, v: Vehicle) => DriveInput): ComboEvent[] {
  const all: ComboEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const ev = v.step(inp(i * DT, v), DT, env);
    for (const e of c.step(v, DT, ev, env.world)) all.push({ ...e });
  }
  return all;
}

test('漂移计分 → 倍率增长 → 计时条走空后结算成现金', () => {
  const env = arena();
  const v = new Vehicle(new Vector3(0, TUNING.radius, 0), east);
  const c = new Combo();
  play(v, c, env, 2.5, () => ({ ...emptyInput(), throttle: 1 }));
  const drift = (t: number) => ({ ...emptyInput(), throttle: 1, steer: t < 0.6 ? 1 : -1, handbrake: t < 0.6 });
  const ev1 = play(v, c, env, 1.6, (t) => drift(t));
  const a1 = ev1.find((e) => e.type === 'action');
  assert.ok(a1 && a1.label.startsWith('漂移'), JSON.stringify(ev1));
  assert.equal(c.mult, 1);
  play(v, c, env, 0.6, () => ({ ...emptyInput(), throttle: 1 }));
  const ev2 = play(v, c, env, 1.6, (t) => drift(t));
  assert.ok(ev2.some((e) => e.type === 'action'));
  assert.equal(c.mult, 1 + COMBO.multStep);
  const before = c.score;
  // The shared Roadster can now pass 250 km/h; slow down so a new top-speed
  // bonus does not intentionally extend the combo we are testing for expiry.
  const ev3 = play(v, c, env, COMBO.window + 0.5, t => ({ ...emptyInput(), throttle: t<.4?-1:0 }));
  const bank = ev3.find((e) => e.type === 'bank');
  assert.ok(bank, JSON.stringify(ev3));
  assert.equal(bank.total, Math.round(before * (1 + COMBO.multStep)));
  assert.equal(bank.pts, Math.round(bank.total! * COMBO.cashRate));
  assert.equal(c.active, false);
});

test('滞空计分：起跳后落地结算', () => {
  const env = arena();
  const v = new Vehicle(new Vector3(0, TUNING.radius, 0), east);
  const c = new Combo();
  play(v, c, env, 0.3, () => emptyInput());
  const ev = play(v, c, env, 6, (t) => ({ ...emptyInput(), hop: t < 1.2 }));
  const a = ev.find((e) => e.type === 'action');
  assert.ok(a && a.label.startsWith('滞空'), JSON.stringify(ev));
});

test('撞墙判负：分数变红作废，不结算', () => {
  const env = arena((w) => w.add(aabb(30, 0, -50, 50, 40, 50, 'building')));
  const v = new Vehicle(new Vector3(0, TUNING.radius, 0), east);
  const c = new Combo();
  play(v, c, env, 0.3, () => emptyInput());
  let airborne = false;
  for (let i = 0; i < 120 * 8 && !(airborne && v.mode === 'ground'); i++) {
    const ev = v.step({ ...emptyInput(), hop: i * DT < 1.0 }, DT, env);
    c.step(v, DT, ev, env.world);
    if (v.mode === 'air') airborne = true;
  }
  assert.ok(c.active, '应该已有一段滞空连击');
  const ev = play(v, c, env, 4, () => ({ ...emptyInput(), throttle: 1 }));
  assert.ok(ev.some((e) => e.type === 'fail'), JSON.stringify(ev));
  assert.ok(!ev.some((e) => e.type === 'bank'));
  assert.ok(c.failed > 0 || !c.active);
});

test('擦墙：高速贴着楼开过但不撞上', () => {
  const env = arena((w) => w.add(aabb(100, 0, 1.9, 400, 30, 20, 'building')));
  const v = new Vehicle(new Vector3(0, TUNING.radius, 0), east);
  const c = new Combo();
  const ev = play(v, c, env, 6, () => ({ ...emptyInput(), throttle: 1 }));
  assert.ok(ev.some((e) => e.type === 'action' && e.label.startsWith('擦墙')), JSON.stringify(ev));
  assert.ok(!ev.some((e) => e.type === 'fail'));
});

test('目标：到达拍照点后切换到下一站；计时赛有起终点', () => {
  const layout = buildLayout();
  const objs = new Objectives(buildObjectives(layout));
  const first = objs.current;
  assert.equal(first.kind, 'photo');
  const v = new Vehicle(first.target.clone().setY(TUNING.radius), east);
  const ev = objs.step(v, DT);
  assert.ok(ev.some((e) => e.type === 'reached' && e.reward === first.reward));
  assert.equal(objs.current.kind, 'trial');
  const trial = objs.current;
  v.place(trial.target.clone().setY(TUNING.radius), east);
  assert.ok(objs.step(v, DT).some((e) => e.type === 'trialStart'));
  assert.ok(objs.racing);
  for (let i = 0; i < 120 * 20; i++) objs.step(v, DT);
  v.place(trial.finish!.target.clone().setY(TUNING.radius), east);
  const done = objs.step(v, DT).find((e) => e.type === 'trialDone');
  assert.ok(done && done.reward > 0 && done.sub.startsWith('00:20'), JSON.stringify(done));
  assert.equal(objs.best !== null && Math.abs(objs.best - 20) < 0.05, true);
  assert.equal(fmtTime(65.25), '01:05.3');
});

test('开瓶器目标必须从洞口穿过', () => {
  const layout = buildLayout();
  const objs = new Objectives(buildObjectives(layout));
  objs.index = objs.list.findIndex((o) => o.place.includes('开瓶器'));
  const o = objs.current;
  const v = new Vehicle(o.target.clone().add(new Vector3(0, 0, 9)), east);
  assert.equal(objs.step(v, DT).length, 0, '洞口外 9 m 不算');
  v.place(o.target.clone(), east);
  assert.ok(objs.step(v, DT).some((e) => e.type === 'reached'));
});

test('街道探索只在第一次开上时提示', () => {
  const layout = buildLayout();
  const d = new Discovery(layout);
  const r = d.step(new Vector3(-420, 0.75, 0));
  assert.equal(r?.name, '南京东路');
  assert.equal(d.step(new Vector3(-300, 0.75, 0)), null);
  assert.ok(r!.total >= 20);
  void RIVER;
});
