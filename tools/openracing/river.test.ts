import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {Vehicle,emptyInput,TUNING} from '../../src/openracing/physics/vehicle.ts';
import {buildLayout,RIVER,RIVER_CROSSINGS} from '../../src/openracing/world/layout.ts';
import {cruisePose,RiverCruises,CRUISE_SPEED} from '../../src/openracing/world/cruises.ts';
const layout=buildLayout();
const env={world:layout.world,river:RIVER,crossings:RIVER_CROSSINGS};

for(const hz of [30,60,120])test(`tilted landing settles above the street at ${hz} Hz`,()=>{
 for(const angle of [.35,.6,1.3,2.5]){
  const v=new Vehicle(new Vector3(-420,14,0),new Quaternion().setFromAxisAngle(new Vector3(1,0,0),angle));v.vel.y=-20;
  let landed=false;
  for(let i=0;i<hz*5;i++){
   v.step(emptyInput(),1/hz,env);
   if(v.grounded){
    landed=true;assert.ok(v.up().y>.9999,`angle=${angle} up=${v.up().y}`);
    for(const z of [-1.4,1.4])assert.ok(new Vector3(0,-TUNING.radius,z).applyQuaternion(v.q).add(v.pos).y>=-.001,'front/rear tyres must not sink');
   }
  }
  assert.ok(landed);assert.ok(Math.abs(v.pos.y-TUNING.radius)<.001);
 }
});

for(const direction of [1,-1])for(const style of ['drive','early lift','held lift','boost','late lift'])test(`easy river crossing ${direction>0?'east':'west'}: ${style}`,()=>{
 const v=new Vehicle(new Vector3(direction>0?-75:375,.75,0),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),direction*Math.PI/2));
 for(let i=0;i<60;i++)v.step(emptyInput(),1/120,env);
 v.air=150;v.vel.x=direction*15;let assisted=false,arrived=false,landed=false,maxFuel=0;
 for(let i=0;i<120*22;i++){
  const progress=direction>0?v.pos.x:300-v.pos.x;
  const hop=style==='held lift'||(style==='early lift'&&progress>-40&&progress<310)||(style==='late lift'&&progress>0&&progress<310);
  const events=v.step({...emptyInput(),throttle:arrived?-1:1,hop:!arrived&&hop,boost:!arrived&&style==='boost'},1/120,env);
  maxFuel=Math.max(maxFuel,v.air);assisted ||= !!v.riverAssist;
  assert.ok(!events.some(e=>e.type==='splash'),`fell at ${v.pos.toArray()}; fuel=${v.air}`);
  if(progress>315)arrived=true;
  if(arrived&&v.grounded){landed=true;break;}
 }
 assert.ok(assisted,'marked lane must enable assistance');assert.ok(arrived&&landed,JSON.stringify({pos:v.pos,air:v.air,assisted,arrived}));
 assert.ok(maxFuel>200,'launch approach must replenish a low tank');
});

test('river aid releases on braking; empty tank provides no sustained lift',()=>{
 const v=new Vehicle(new Vector3(-5,8,0),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2));v.vel.x=20;
 v.step(emptyInput(),1/120,env);assert.equal(v.riverAssist,1);
 v.step({...emptyInput(),throttle:-1},1/120,env);assert.equal(v.riverAssist,0);
 v.pos.set(100,8,0);v.air=0;v.vel.set(20,-1,0);
 for(let i=0;i<120;i++)v.step(emptyInput(),1/120,env);
 assert.ok(v.pos.y<3);assert.equal(v.riverAssist,0);
});

test('three cruise ships stay in the river, move smoothly and expose solid moving colliders',()=>{
 const cruises=new RiverCruises();
 for(let t=0;t<300;t+=.5)for(let i=0;i<3;i++){
  const p=cruisePose(t,i),n=cruisePose(t+.01,i);
  assert.ok(p.x>70&&p.x<230&&Math.abs(p.z)<=650);
  assert.ok(Math.abs(Math.hypot(n.x-p.x,n.z-p.z)/.01-CRUISE_SPEED)<.01);
  const others=[0,1,2].filter(j=>j!==i).map(j=>cruisePose(t,j));
  assert.ok(others.every(o=>Math.hypot(o.x-p.x,o.z-p.z)>50));
 }
 cruises.update(12);assert.equal(cruises.ships.length,3);
 const pool:Parameters<RiverCruises['contacts']>[3]=[];
 assert.ok(cruises.contacts(cruises.ships[0].collider.center,.75,.1,pool,0)>0);
 assert.ok(cruises.ships[0].velocity.length()>9.9);
});
