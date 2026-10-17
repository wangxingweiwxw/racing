import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Kart } from '../src/race/kart.ts';
import { DrivingAssist } from '../src/race/drivingAssist.ts';
import { Track } from '../src/track.ts';
import { carOverlap } from '../src/race/carCollision.ts';
import { buildRoadster } from '../src/race/roadsterModel.ts';
import { recordSuffix, vehicleMaxSpeedMps } from '../src/race/vehicles.ts';

const tracks = ['shanghai', 'nordschleife'].map(id => new Track(JSON.parse(readFileSync(new URL(`../public/data/${id}/track.json`, import.meta.url)))));
const lift = { throttle: 0, steer: 0, lift: true };
const idle = { throttle: 0, steer: 0 };
const step = (k, seconds, input, hz=120) => { for(let i=0;i<Math.round(seconds*hz);i++) k.step(1/hz,input); };
const car = (track=tracks[0]) => { const k=new Kart(track); k.flightEnabled=true; k.placeAt(100,0,0); return k; };
const flatTrack = () => ({
  N:2, step:10, length:1000, verge:10000,
  curv:new Float32Array(2), lineCurv:new Float32Array(2),
  x:new Float32Array([0,0]), z:new Float32Array([0,-10]), tx:new Float32Array([0,0]), tz:new Float32Array([-1,-1]),
  y:new Float32Array([0,0]), bank:new Float32Array([0,0]), half:new Float32Array([10000,10000]),
  wrap:i=>((i%2)+2)%2, wrapS:s=>((s%1000)+1000)%1000, deltaS:(a,b)=>b-a,
  frameAt(s,out){Object.assign(out,{x:0,y:0,z:-s,tx:0,tz:-1,i:0,t:0,half:10000,bank:0});return out;},
  query(x,z,hint,out){Object.assign(out,{i:0,t:0,s:-z,lat:0,half:10000,yc:0,bank:0});return out;},
  surfaceY:()=>0,
});

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

test('manual and assisted driving reach but never exceed each vehicle speed cap',()=>{
  for (const vehicle of ['u9x','roadster']) for (const enabled of [false, true]) {
    const k=new Kart(flatTrack()); k.flightEnabled=vehicle==='roadster'; k.maxSpeed=vehicleMaxSpeedMps(vehicle); k.accel=8+k.maxSpeed*.12; k.placeAt(100,0,0);
    const assist = new DrivingAssist(k.track, k.maxSpeed, k.aLatMax);
    for(let i=0;i<60*120;i++) {
      const input = {throttle:1,steer:0};
      if (enabled) assist.apply(k, input);
      k.step(1/120,input);
      assert.ok(k.speed<=k.maxSpeed+1e-9,`${vehicle}: ${k.speed*3.6} km/h`);
    }
    assert.ok(k.speed>k.maxSpeed*.999,`${vehicle}: did not reach configured cap (${k.speed*3.6}/${k.maxSpeed*3.6} km/h)`);
  }
});

test('showcase opens only when parked, toggles on presses, and closes before driving',()=>{
  const k=car(flatTrack());
  step(k,1,{...idle,action:true}); assert.equal(k.showcase,true);
  step(k,.1,idle); step(k,.1,{...idle,action:true}); assert.equal(k.showcase,false);
  step(k,.1,idle); step(k,.1,{...idle,action:true}); assert.equal(k.showcase,true);
  k.step(1/60,{throttle:1,steer:0}); assert.equal(k.showcase,false);
  step(k,1,{throttle:1,steer:0}); step(k,.1,{...idle,action:true}); assert.equal(k.showcase,false);
  k.placeAt(100,0,0); k.flightEnabled=false; step(k,1,{...idle,action:true}); assert.equal(k.showcase,false);
});

for(const hz of [30,60,120]) test(`roll uses fuel once, preserves flight steering and ends upright at ${hz} Hz`,()=>{
  const k=car(flatTrack()),baseline=car(flatTrack());
  step(k,1,lift,hz); step(baseline,1,lift,hz);
  const input={...lift,throttle:1,steer:.4};
  step(k,.4,{...input,action:true},hz); step(baseline,.4,input,hz);
  assert.ok(k.stuntActive && Math.abs(k.stuntRoll)>1);
  assert.ok(Math.abs(baseline.flightCharge-k.flightCharge-.15)<1e-8);
  assert.ok(Math.abs(baseline.heading-k.heading)<1e-8);
  assert.ok(Math.abs(baseline.speed-k.speed)<1e-8);
  step(k,.7,{...input,action:true},hz); step(baseline,.7,input,hz);
  assert.equal(k.stuntActive,false); assert.equal(k.stuntRoll,0);
  assert.ok(Math.abs(baseline.flightCharge-k.flightCharge-.15)<1e-8,'holding does not repeat');
  step(k,3,idle,hz); assert.ok(k.grounded); assert.equal(k.stuntRoll,0);
  k.placeAt(100,0,0); assert.equal(k.stuntActive,false);
});

test('low altitude, low charge, U9 and collisions cannot initiate a roll',()=>{
  for(const condition of ['low','empty','u9','spin']) {
    const k=car(flatTrack()); step(k,1,lift);
    if(condition==='low')k.pos.y=.8;
    if(condition==='empty')k.flightCharge=.19;
    if(condition==='u9')k.flightEnabled=false;
    if(condition==='spin')k.spin=1;
    k.step(1/120,{...idle,action:true}); assert.equal(k.stuntActive,false,condition);
  }
  const landing=car(flatTrack()); step(landing,1,lift); landing.step(1/60,{...lift,action:true});
  assert.ok(landing.stuntActive); landing.pos.y=0; landing.vel.y=-3;
  landing.step(1/60,idle); assert.equal(landing.stuntRoll,0); assert.equal(landing.stuntActive,false);
});

test('Roadster airbrake shortens high-speed stops without changing the speed cap',()=>{
  const results=[];
  for(const enabled of [false,true]) {
    const k=car(flatTrack()); k.flightEnabled=enabled; k.maxSpeed=110; k.vel.z=-90;
    let steps=0;
    while(k.speed>.1 && steps++<1000)k.step(1/120,{throttle:-1,steer:0});
    assert.ok(k.speed<.1); results.push(k.progress);
    step(k,1,idle); assert.ok(k.airBrake<.002);
  }
  assert.ok(results[1]<results[0]*.9,JSON.stringify(results));
  console.log('90 m/s stopping distances, baseline / Roadster airbrake:',results);
});

test('Roadster mesh has finite bounds, four wheels and six cold gas jets',()=>{
  const m=buildRoadster(0xc80012);
  assert.equal(m.doors.length,2);
  for(const actuator of m.aeroStruts) assert.equal(actuator.parent,m.car,'animated actuators must not be statically merged');
  assert.equal(m.wheels.length,4); assert.equal(m.frontPivots.length,2); assert.equal(m.rearWheelsLocal.length,2); assert.equal(m.jets.length,6);
  m.jets.forEach(j=>j.geometry.computeBoundingSphere());
  let triangles=0;
  m.car.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position; assert.ok(Array.from(p.array).every(Number.isFinite));triangles+=(o.geometry.index?.count??p.count)/3;}});
  // Includes the newly visible cabin and independent door skins.
  assert.ok(triangles<24000, String(triangles));
  const size=new THREE.Box3().setFromObject(m.car).getSize(new THREE.Vector3());
  assert.ok(size.x>2 && size.x<2.5 && size.z<6);
  assert.ok(Math.abs(vehicleMaxSpeedMps('u9x')*3.6-496.22)<1e-9);
  assert.ok(Math.abs(vehicleMaxSpeedMps('roadster')*3.6-370.15)<1e-9);
  assert.notEqual(recordSuffix('roadster'),recordSuffix('u9x'));
});
