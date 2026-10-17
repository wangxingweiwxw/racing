import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Kart } from '../src/race/kart.ts';
import { Track } from '../src/track.ts';
import { DrivingAssist } from '../src/race/drivingAssist.ts';
import { recordSuffix, vehicleMaxSpeedMps } from '../src/race/vehicles.ts';

const tracks = ['shanghai', 'nordschleife'].map(name => new Track(JSON.parse(readFileSync(new URL(`../public/data/${name}/track.json`, import.meta.url)))));
const angle = x => Math.atan2(Math.sin(x), Math.cos(x));
const clamp = x => Math.max(-1, Math.min(1, x));
function car(track, vehicle = 'u9x', s = 0) {
  const k = new Kart(track);
  k.maxSpeed = vehicleMaxSpeedMps(vehicle); k.accel = 8 + k.maxSpeed * .12; k.outOfBoundsSpeed = 19.8;
  k.placeAt(s, 0, 0);
  return k;
}

// Repeat a driver who looks through the bend but brakes only 25 m before it.
// Exactly the same pedal/steering policy is used with and without assistance.
function run(track, vehicle, enabled, hz = 120) {
  const total = { offRoad: 0, railHits: 0, progress: 0, steps: 0 };
  for (let start = 0; start < 8; start++) {
    const k = car(track, vehicle, start * track.length / 8);
    const assist = new DrivingAssist(track, k.maxSpeed, k.aLatMax);
    const frame = {};
    let steer = 0;
    for (let n = 0; n < 45 * hz; n++) {
      const f = track.frameAt(k.q.s + Math.max(8, k.speed * .6), frame);
      const want = Math.atan2(f.x - k.pos.x, -(f.z - k.pos.z));
      const rawSteer = clamp(angle(want - k.heading) * 3.2);
      steer += (rawSteer - steer) * (1 - Math.exp(-5.5 / hz));
      const corner = track.wrap(k.q.i + Math.round(25 / track.step));
      const safe = Math.sqrt(k.aLatMax * .8 / Math.max(Math.abs(track.curv[corner]), 1e-6));
      const input = { throttle: k.speed > safe + 3 ? -1 : 1, steer };
      if (enabled) assist.apply(k, input);
      k.step(1 / hz, input);
      total.offRoad += Number(Math.abs(k.q.lat) > k.q.half);
      total.railHits += Number(k.events.railHit > 1);
      total.steps++;
    }
    total.progress += k.progress;
  }
  return total;
}

for (const [idx, track] of tracks.entries()) for (const vehicle of ['u9x', 'roadster']) {
  test(`corner assist reduces excursions for ${vehicle} on track ${idx}`, () => {
    const manual = run(track, vehicle, false);
    const assisted = run(track, vehicle, true);
    console.log(JSON.stringify({ track: idx, vehicle, manual, assisted }));
    assert.ok(assisted.offRoad < manual.offRoad * .3, 'at least 70% fewer off-road frames');
    assert.ok(assisted.railHits < manual.railHits * .6, 'at least 40% fewer rail impacts');
    assert.ok(assisted.progress > manual.progress * .8, 'must keep making useful progress');
    assert.ok(assisted.progress > 5000, 'must not solve excursions by crawling');
  });
}

test('assist preserves brake, reverse, ordinary jumps and wrong-way controls', () => {
  const k = car(tracks[0]); const assist = new DrivingAssist(k.track, k.maxSpeed, k.aLatMax);
  const setSpeed = v => k.vel.set(Math.sin(k.heading) * v, 0, -Math.cos(k.heading) * v);
  for (const state of ['stopped', 'reverse', 'airborne', 'wrong-way', 'spin']) {
    k.placeAt(100, 0, 0); setSpeed(70);
    const input = { throttle: .8, steer: .4, lift: false };
    if (state === 'stopped') setSpeed(0);
    if (state === 'reverse') setSpeed(-1);
    if (state === 'airborne') k.grounded = false;
    if (state === 'wrong-way') { k.heading += Math.PI; setSpeed(70); }
    if (state === 'spin') k.spin = 1;
    const before = { ...input }; assist.apply(k, input); assert.deepEqual(input, before, state);
  }
  k.placeAt(100, 0, 0); setSpeed(70);
  const brake = { throttle: -1, steer: 0 }; assist.apply(k, brake); assert.equal(brake.throttle, -1);
});

for (const hz of [30, 60, 120]) test(`hover steering corrects outward drift during powered flight and descent at ${hz} Hz`, () => {
  for (const tr of tracks) {
    const index = tr.curv.reduce((best, c, i) => Math.abs(c) < Math.abs(tr.curv[best]) ? i : best, 0);
    function fly(enabled) {
      const k = car(tr, 'roadster', index * tr.step);
      k.flightEnabled = true;
      k.step(1 / hz, { throttle: 0, steer: 0, lift: true });
      assert.equal(k.flightControlActive, true);
      const f = tr.frameAt(index * tr.step, {});
      const lat = f.half - k.halfWidth - .8;
      k.pos.set(f.x - f.tz * lat, 0, f.z + f.tx * lat);
      tr.query(k.pos.x, k.pos.z, -1, k.q);
      k.pos.y = tr.surfaceY(k.q) + 3.5; k.grounded = false;
      k.heading = Math.atan2(f.tx, -f.tz) + .18;
      k.vel.set(Math.sin(k.heading) * 20, 0, -Math.cos(k.heading) * 20);
      const assist = new DrivingAssist(tr, k.maxSpeed, k.aLatMax);
      let poweredCorrection = false, descentCorrection = false, maxLat = lat;
      for (let n = 0; n < hz * .8; n++) {
        const input = { throttle: .3, steer: .3, lift: n < hz * .4 };
        if (enabled) {
          assist.apply(k, input);
          assert.equal(input.throttle, .3); assert.equal(input.lift, n < hz * .4);
          assert.equal(assist.braking, false);
          if (input.lift) poweredCorrection ||= assist.recovering;
          else descentCorrection ||= assist.recovering;
        }
        k.step(1 / hz, input);
        maxLat = Math.max(maxLat, k.q.lat);
        assert.equal(k.flightControlActive, true);
        assert.ok(Number.isFinite(k.heading));
      }
      return { maxLat, charge: k.flightCharge, poweredCorrection, descentCorrection };
    }
    const manual = fly(false), assisted = fly(true);
    assert.ok(assisted.maxLat < manual.maxLat - .5, JSON.stringify({ manual, assisted }));
    assert.ok(assisted.poweredCorrection && assisted.descentCorrection);
    assert.equal(assisted.charge, manual.charge);
  }
});

test('straight-line target allows the vehicle top speed; assists have separate records', () => {
  for (const vehicle of ['u9x', 'roadster']) {
    const tr = tracks[0];
    const flat = Object.assign(Object.create(tr), { curv: new Float32Array(tr.N), lineCurv: new Float32Array(tr.N) });
    const assist = new DrivingAssist(flat, vehicleMaxSpeedMps(vehicle), 17);
    assert.ok([...assist.speeds].every(v => Math.abs(v - vehicleMaxSpeedMps(vehicle)) < 1e-5));
    assert.notEqual(recordSuffix(vehicle, true), recordSuffix(vehicle, false));
    assert.equal(recordSuffix(vehicle, false).includes('assist'), false);
  }
});
