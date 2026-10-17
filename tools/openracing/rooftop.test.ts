import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {ColliderWorld,aabb} from '../../src/openracing/physics/colliders.ts';
import {Vehicle,emptyInput,TUNING} from '../../src/openracing/physics/vehicle.ts';
import type {Env} from '../../src/openracing/physics/vehicle.ts';

function fixture(height=300):Env {
  const world=new ColliderWorld();
  world.add(aabb(-10000,-10,-10000,10000,0,10000,'ground'));
  if(height)world.add(aabb(-40,0,-20,0,height,20,'building'));
  return {world,river:{x0:20000,x1:21000,waterY:-100}};
}
for(const hz of [30,60,120])for(const height of [80,300,500])test(`climb ${height} m, leave roof, auto roll and soft land at ${hz} Hz`,()=>{
  const env=fixture(height),v=new Vehicle(new Vector3(40,.75,0),new Quaternion().setFromUnitVectors(new Vector3(0,0,1),new Vector3(-1,0,0)));
  let wall=false,roof=false,flight=false,roll=false,flare=false,land=false,impact=0,peak=0;
  for(let i=0;i<hz*45;i++){
    const before=v.vel.y,wasAir=!v.grounded;
    const events=v.step({...emptyInput(),throttle:flight?0:1,fan:i===0},1/hz,env);
    wall ||= v.mode==='wall';roof ||= v.mode==='ground'&&v.pos.y>height;
    flight ||= v.roofFlight;roll ||= flight&&v.stuntActive;flare ||= v.landingAssist;peak=Math.max(peak,v.pos.y);
    assert.ok(!events.some(e=>e.type==='overheat'),'full-throttle ascent should reach the roof');
    if(flight&&wasAir&&v.grounded){impact=-before;land=true;break;}
  }
  const result={hz,height,wall,roof,flight,roll,flare,land,impact,peak,pos:v.pos.toArray(),fuel:v.air,up:v.up().y};
  console.log(JSON.stringify(result));
  assert.ok(wall&&roof&&flight&&roll&&flare&&land,JSON.stringify(result));
  assert.ok(impact<4.5,JSON.stringify(result));assert.ok(v.up().y>.99);assert.equal(v.fanOn,false);
  assert.ok(v.pos.x < -42&&v.pos.y<1,'must land outside the building on the street');
});

for(const hz of [30,60,120])test(`adaptive flare handles a 500 m fall and respects empty fuel at ${hz} Hz`,()=>{
  const env=fixture(0),impacts=[];
  for(const fuel of [0,600]){
    const v=new Vehicle(new Vector3(0,500,0),new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI));v.air=fuel;
    let impact=0,flareHeight=0;
    for(let i=0;i<hz*25;i++){
      const before=v.vel.y;v.step(emptyInput(),1/hz,env);
      if(v.landingAssist)flareHeight=Math.max(flareHeight,v.pos.y);
      if(!fuel){assert.equal(v.downThrust,0);assert.equal(v.landingAssist,false);}
      if(v.grounded){impact=-before;break;}
    }
    assert.equal(v.mode,'ground');assert.ok(v.up().y>.99);
    if(fuel){assert.ok(flareHeight>30);assert.ok(v.air<600);assert.ok(impact<4.5,`${impact}`);}
    impacts.push(impact);
  }
  assert.ok(impacts[0]>impacts[1]*3);
});

for(const hz of [30,60,120])test(`front jets shorten high-speed stopping distance at ${hz} Hz`,()=>{
  const distances=[];
  for(const fuel of [0,600]){
    const env=fixture(0),v=new Vehicle(new Vector3(0,.75,0),new Quaternion());v.step(emptyInput(),1/hz,env);
    v.air=fuel;v.vel.z=250/3.6;let fired=false;
    for(let i=0;i<hz*6&&v.forwardSpeed>1;i++){
      if(!fuel)v.air=0; // isolate mechanical braking from the ground compressor
      v.step({...emptyInput(),throttle:-1,boost:true},1/hz,env);fired ||= v.brakeThrust>.1;
      assert.equal(v.mainThrust,0,'brake must suppress rear boost');
    }
    distances.push(v.pos.z);assert.equal(fired,fuel>0);
    if(fuel)assert.ok(v.air<TUNING.tank);
    v.vel.set(0,0,-1);v.step({...emptyInput(),throttle:-1},1/hz,env);
    const before=v.air;
    for(let i=0;i<hz;i++)v.step({...emptyInput(),throttle:-1},1/hz,env);
    assert.ok(v.brakeThrust<.001);assert.ok(v.air>=before,'reverse cannot spend brake gas');
  }
  console.log(JSON.stringify({hz,mechanical:distances[0],frontJets:distances[1]}));
  assert.ok(distances[1]<distances[0]*.85,JSON.stringify(distances));
});
