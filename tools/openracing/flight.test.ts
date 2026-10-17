import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Quaternion} from 'three';
import {Vehicle,TUNING,emptyInput} from '../../src/openracing/physics/vehicle.ts';
import type {DriveInput,Env} from '../../src/openracing/physics/vehicle.ts';
import {ColliderWorld,aabb} from '../../src/openracing/physics/colliders.ts';
const world=new ColliderWorld();world.add(aabb(-10000,-10,-10000,10000,0,10000,'ground'));
const env:Env={world,river:{x0:20000,x1:20100,waterY:-100}};
const run=(v:Vehicle,sec:number,input:Partial<DriveInput>,hz=120)=>{const events=[];for(let i=0;i<Math.round(sec*hz);i++)events.push(...v.step({...emptyInput(),...input},1/hz,env).map(e=>({...e})));return events;};
const car=()=>{const v=new Vehicle(new Vector3(0,TUNING.radius,0),new Quaternion());run(v,.5,{});return v;};

for(const hz of [30,60,120])test(`bounded hover, throttle preserves attitude and release lands at ${hz} Hz`,()=>{
 const v=car();run(v,4,{hop:true,throttle:1},hz);
 assert.equal(v.mode,'air');assert.ok(v.pos.y>3&&v.pos.y<6,String(v.pos.y));
 assert.ok(v.up().y>.98,'holding throttle must not pitch the car upside down');
 assert.ok(v.air<TUNING.tank*.6&&v.air>0,String(v.air));
 run(v,4,{},hz);assert.equal(v.mode,'ground');assert.ok(v.up().y>.99);
});
test('airborne steering turns velocity, roll costs fuel once and keeps steering available',()=>{
 const v=car();v.vel.z=25;run(v,1,{hop:true});const before=v.air;
 run(v,.4,{hop:true,action:true,steer:.4});
 assert.ok(v.stuntActive&&Math.abs(v.stuntRoll)>1);assert.ok(v.vel.x<-.1,'right turns toward negative local X');
 assert.ok(before-v.air>=60);const after=v.air;
 run(v,1,{hop:true,action:true,steer:.4});assert.equal(v.stuntRoll,0);
 assert.ok(after-v.air<95,'held action must not retrigger');
 run(v,3,{});assert.equal(v.mode,'ground');assert.equal(v.stuntRoll,0);
});
test('landing flare uses fuel and reduces impact without adding lift after fuel is exhausted',()=>{
 const impacts=[];
 for(const fuel of [0,600]){
  const v=new Vehicle(new Vector3(0,12,0),new Quaternion());v.air=fuel;v.vel.y=-5;
  const events=[];let minimumFuel=fuel;
  for(let i=0;i<360;i++){events.push(...v.step(emptyInput(),1/120,env).map(e=>({...e})));minimumFuel=Math.min(minimumFuel,v.air);}
  assert.equal(v.mode,'ground');
  impacts.push(Math.max(...events.filter(e=>e.type==='land').map(e=>e.strength),0));
  if(fuel)assert.ok(minimumFuel<fuel,'landing flare must spend fuel before grounded recharge');
 }
 assert.ok(impacts[1]<impacts[0]*.85,JSON.stringify(impacts));
 console.log('Unassisted / assisted landing impact m/s',impacts);
});
test('showcase and reset remain safe; depleted tanks cannot roll',()=>{
 const v=car();run(v,1,{action:true});assert.ok(v.showcase);
 run(v,.1,{throttle:1});assert.equal(v.showcase,false);
 run(v,1,{hop:true});v.air=30;run(v,.1,{action:true});assert.equal(v.stuntActive,false);
 v.air=300;run(v,.1,{});run(v,.1,{action:true});assert.ok(v.stuntActive);
 run(v,.1,{reset:true});assert.equal(v.stuntRoll,0);
});
test('ground, boost and airborne horizontal speed respect the shared Roadster cap',()=>{
 for(const airborne of [false,true]){
  const v=car();if(airborne){v.pos.y=40;v.grounded=false;v.mode='air';}
  v.vel.z=140;
  for(let i=0;i<240;i++){v.step({...emptyInput(),throttle:1,boost:true},1/120,env);assert.ok(Math.hypot(v.vel.x,v.vel.z)<=370.15/3.6+1e-8);}
 }
});
