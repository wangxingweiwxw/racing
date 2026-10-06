import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Kart, REVERSE_MAX_SPEED } from '../src/race/kart.ts';
import { Track } from '../src/track.ts';
import { GameMode, SlotItem, PlayerItemSlotsState } from '../src/race/items.ts';

const brake = { throttle: -1, steer: 0 };
const idle = { throttle: 0, steer: 0 };
const throttle = { throttle: 1, steer: 0 };
const tracks = ['shanghai', 'nordschleife'].map(name => new Track(JSON.parse(readFileSync(new URL(`../public/data/${name}/track.json`, import.meta.url)))));
function car(track = tracks[0], s = 100) { const k = new Kart(track); k.placeAt(s, 0, 0); return k; }
function step(k, n, input = brake, hz = 60) { for (let i = 0; i < n; i++) k.step(1 / hz, input); }

for (const hz of [30, 60, 120]) test(`reverse needs two stationary seconds at ${hz} Hz and stays below 5 km/h`, () => {
  const k = car(); const origin = k.pos.clone();
  step(k, 2 * hz - 1, brake, hz);
  assert.equal(k.speed, 0); assert.equal(k.goingBackwards, false);
  assert.equal(k.pos.x, origin.x); assert.equal(k.pos.z, origin.z);
  step(k, 1, brake, hz); assert.equal(k.goingBackwards, true);
  for (let i = 0; i < 12 * hz; i++) {
    k.step(1 / hz, { ...brake, steer: i > 4 * hz ? .8 : 0 });
    assert.ok(k.speed <= REVERSE_MAX_SPEED + 1e-9, k.speed);
  }
  assert.ok(k.forwardSpeed < -1);
});

test('moving braking stops first, and only then starts reverse hold', () => {
  const k = car(); k.vel.set(Math.sin(k.heading) * 20, 0, -Math.cos(k.heading) * 20);
  while (k.speed > .05) {
    k.step(1 / 60, brake);
    assert.equal(k.reverseHoldTime, 0);
    assert.ok(k.forwardSpeed >= -1e-9);
  }
  step(k, 119); assert.equal(k.speed, 0); assert.equal(k.goingBackwards, false);
  step(k, 1); assert.equal(k.goingBackwards, true);
});

test('release, reset, respawn and frozen countdown discard partial holds', () => {
  for (const reset of [k => k.step(1 / 60, idle), k => k.resetBrakeHold(), k => k.respawn(), k => { k.frozen = true; step(k, 240); k.frozen = false; }]) {
    const k = car(); step(k, 90); reset(k);
    assert.equal(k.reverseHoldTime, 0);
    step(k, 60); assert.equal(k.goingBackwards, false);
  }
});

test('forward accelerator stops reverse motion and resumes D', () => {
  const k = car(); step(k, 300); assert.ok(k.forwardSpeed < -1);
  step(k, 120, throttle);
  assert.ok(k.forwardSpeed > 5); assert.equal(k.goingBackwards, false); assert.equal(k.reverseHoldTime, 0);
});

test('brakes hold on both real tracks including banked sections; reverse stays capped', () => {
  for (const track of tracks) {
    const bankIndex = track.bank.reduce((best, b, i) => Math.abs(b) > Math.abs(track.bank[best]) ? i : best, 0);
    for (const s of [100, 1000, bankIndex * track.step]) {
      const k = car(track, s); const p = k.pos.clone();
      step(k, 119); assert.equal(k.speed, 0); assert.equal(k.pos.x, p.x); assert.equal(k.pos.z, p.z);
      for (let i = 0; i < 600; i++) { k.step(1 / 60, brake); assert.ok(k.speed <= REVERSE_MAX_SPEED + 1e-9); }
      assert.equal(k.goingBackwards, true);
    }
  }
});

test('airborne brake time does not arm reverse', () => {
  const k = car(); k.pos.y += 100;
  step(k, 120); assert.equal(k.reverseHoldTime, 0); assert.equal(k.goingBackwards, false);
});

test('time trials have no supplies; versus only supplies bombs', () => {
  const solo = new PlayerItemSlotsState(30, GameMode.AGAINST_CLOCK);
  assert.ok(solo.display().every(s => s.item === SlotItem.DISABLED));
  const versus = new PlayerItemSlotsState(30, GameMode.VERSUS);
  for (let i = 0; i < 1800; i++) {
    const used = versus.tick(.1, 100, i % 100 === 0);
    assert.ok([SlotItem.EMPTY, SlotItem.AIR_BOMB].includes(used));
    assert.ok(versus.display().every(s => [SlotItem.DISABLED, SlotItem.EMPTY, SlotItem.AIR_BOMB].includes(s.item)));
  }
});
