import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Kart } from '../src/race/kart.ts';
import { Track } from '../src/track.ts';
import { carOverlap } from '../src/race/carCollision.ts';
import { buildRoadster } from '../src/race/roadsterModel.ts';
import { recordSuffix, vehicleMaxSpeedMps } from '../src/race/vehicles.ts';

const tracks = ['shanghai', 'nordschleife'].map(id => new Track(JSON.parse(readFileSync(new URL(`../public/data/${id}/track.json`, import.meta.url)))));
const lift = { throttle: 0, steer: 0, lift: true };
const idle = { throttle: 0, steer: 0 };
const step = (k, seconds, input, hz=120) => { for(let i=0;i<Math.round(seconds*hz);i++) k.step(1/hz,input); };
const car = (track=tracks[0]) => { const k=new Kart(track); k.flightEnabled=true; k.placeAt(100,0,0); return k; };

for(const hz of [30,60,120]) for(const [i,track] of tracks.entries()) test(`hover, depletion, landing and refill at ${hz} Hz on track ${i}`,()=>{
  const k=car(track);
  step(k,2,lift,hz);
  assert.ok(k.flightHeight>3 && k.flightHeight<4, String(k.flightHeight));
  assert.ok(!k.grounded && k.thrusterActive);
  assert.ok(Math.abs(k.flightCharge-.5)<.001);
  step(k,5,lift,hz);
  assert.equal(k.flightCharge,0); assert.equal(k.thrusterActive,false); assert.ok(k.grounded);
  step(k,3,lift,hz); assert.equal(k.flightCharge,0); assert.ok(k.grounded);
  step(k,10,idle,hz); assert.ok(k.flightCharge>.999);
  step(k,1,lift,hz); assert.ok(k.flightHeight>1);
});

test('release lands, countdown does not burn fuel, respawn does not refill',()=>{
  const k=car(); k.frozen=true; step(k,2,lift); assert.equal(k.flightCharge,1); assert.equal(k.thrusterActive,false);
  k.frozen=false; step(k,1,lift); const charge=k.flightCharge;
  step(k,2,idle); assert.ok(k.grounded); assert.ok(k.flightCharge>=charge);
  step(k,1,lift); const remaining=k.flightCharge; k.respawn();
  assert.equal(k.flightCharge,remaining); assert.equal(k.thrusterActive,false); assert.ok(Math.abs(k.flightHeight-.02)<1e-8);
});

test('U9 ignores lift, low fuel cannot launch, and airborne steering stays finite',()=>{
  const u9=car(); u9.flightEnabled=false; step(u9,3,lift); assert.ok(u9.grounded); assert.equal(u9.flightCharge,1);
  const low=car(); low.flightCharge=.2; step(low,1,lift); assert.ok(low.grounded); assert.equal(low.thrusterActive,false);
  const k=car(); step(k,2,{...lift,throttle:1,steer:.6});
  assert.ok(k.speed>3); assert.ok(k.flightHeight>2); assert.ok(Number.isFinite(k.heading));
  const ground=car(); ground.pos.copy(k.pos); ground.pos.y-=3;
  assert.equal(carOverlap(k,ground),null);
});

test('Roadster mesh has finite bounds, four wheels and six cold gas jets',()=>{
  const m=buildRoadster(0xc80012);
  assert.equal(m.wheels.length,4); assert.equal(m.frontPivots.length,2); assert.equal(m.rearWheelsLocal.length,2); assert.equal(m.jets.length,6);
  m.jets.forEach(j=>j.geometry.computeBoundingSphere());
  let triangles=0;
  m.car.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position; assert.ok(Array.from(p.array).every(Number.isFinite));triangles+=(o.geometry.index?.count??p.count)/3;}});
  assert.ok(triangles<20000, String(triangles));
  const size=new THREE.Box3().setFromObject(m.car).getSize(new THREE.Vector3());
  assert.ok(size.x>2 && size.x<2.5 && size.z<6);
  assert.ok(Math.abs(vehicleMaxSpeedMps('u9x')*3.6-496.22)<1e-9);
  assert.ok(Math.abs(vehicleMaxSpeedMps('roadster')*3.6-370.15)<1e-9);
  assert.notEqual(recordSuffix('roadster'),recordSuffix('u9x'));
});
