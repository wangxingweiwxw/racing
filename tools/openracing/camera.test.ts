import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { ChaseCam } from '../../src/openracing/camera.ts';
import { ColliderWorld, aabb } from '../../src/openracing/physics/colliders.ts';
import { Vehicle, emptyInput } from '../../src/openracing/physics/vehicle.ts';

function fixture() {
  const world=new ColliderWorld();
  world.add(aabb(-100,-5,-100,100,0,100,'ground'));
  world.add(aabb(10,0,-20,30,30,20,'building'));
  const v=new Vehicle(new Vector3(9.24,.75,0),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2));
  v.grounded=true;v.mode='ground';
  const camera=new PerspectiveCamera(),rig=new ChaseCam(camera);rig.snap(v,v.pos);
  return {world,v,camera,rig};
}
for(const hz of [30,60,120])test(`camera stays outside front/rear/side walls and corners at ${hz} Hz`,()=>{
  for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
    const {world,v,camera,rig}=fixture();
    world.add(aabb(-20,0,5,30,30,20,'building'));
    v.q.setFromAxisAngle(new Vector3(0,1,0),yaw);rig.snap(v,v.pos);
    for(let i=0;i<hz*2;i++){
      rig.kick(.8);rig.update(1/hz,v,v.pos,world);
      assert.ok(!world.overlapsSphere(camera.position,.3),'camera sphere must stay clear');
      assert.ok(camera.position.distanceTo(v.pos)>2,'do not collapse into the player');
      assert.ok(camera.quaternion.toArray().every(Number.isFinite));
      assert.equal(camera.up.y,1);
    }
  }
});
test('airborne rebound, reversal and wall/ceiling transitions keep a stable horizon',()=>{
  const {world,v,camera,rig}=fixture();v.pos.set(5,12,0);
  let previous=camera.quaternion.clone();
  for(const mode of ['air','wall','ceiling','ground'] as const){
    v.mode=mode;v.groundN.set(mode==='wall'?-1:0,mode==='ceiling'?-1:mode==='wall'?0:1,0);
    for(let i=0;i<120;i++){
      v.vel.set(i<60?45:-30,0,0);
      v.q.setFromAxisAngle(new Vector3(0,0,1),i*.06);
      rig.update(1/60,v,v.pos,world);
      if(i>5)assert.ok(previous.angleTo(camera.quaternion)<.6,'no abrupt camera flip');
      assert.equal(camera.up.y,1);assert.ok(!world.overlapsSphere(camera.position,.3));
      previous.copy(camera.quaternion);
    }
  }
});
test('a wall directly behind raises the camera without reversing the view',()=>{
  const {world,v,camera,rig}=fixture();v.q.setFromAxisAngle(new Vector3(0,1,0),-Math.PI/2);rig.snap(v,v.pos);
  for(let i=0;i<120;i++)rig.update(1/60,v,v.pos,world);
  assert.ok(camera.position.y>v.pos.y+4);
  assert.ok(camera.position.clone().sub(v.pos).dot(v.fwd())<0);
  assert.ok(!world.overlapsSphere(camera.position,.3));
});
for(const hz of [30,60,120])test(`wall impact permits steering, reverse and a clear recovery at ${hz} Hz`,()=>{
  const {world,v}=fixture(),env={world,river:{x0:200,x1:300,waterY:-5}};
  v.place(new Vector3(0,.75,0),v.q.clone());
  const step=(seconds:number,input:Partial<ReturnType<typeof emptyInput>>)=>{for(let i=0;i<seconds*hz;i++)v.step({...emptyInput(),...input},1/hz,env);};
  step(.6,{});step(3,{throttle:1});
  assert.ok(v.pos.x<=7.61&&v.up().y>.99,'the nose must stay outside the building');
  const before=v.fwd();step(1,{throttle:1,steer:1});
  assert.ok(before.angleTo(v.fwd())>.3,'steering must work even while pinned');
  step(2,{throttle:-1});assert.ok(v.forwardSpeed<-.1,'reverse remains available');
  v.fanOn=true;v.pos.set(9.25,7,0);v.q.setFromAxisAngle(new Vector3(0,0,1),Math.PI/2);
  step(1/hz,{reset:true});
  assert.equal(v.fanOn,false);assert.ok(v.up().y>.999);assert.ok(v.pos.y<1);
  assert.ok(v.pos.x<7,'checkpoint cannot be inside/against the wall');
  step(.5,{});assert.equal(v.mode,'ground');
});
