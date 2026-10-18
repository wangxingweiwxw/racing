import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';
import {buildRoadster} from '../src/race/roadsterModel.ts';

test('photo wing deploys independently of incidence, retracts and keeps finite geometry',()=>{
 const p=buildRoadster(0xf4f4f4),rest=p.spoiler.position.clone();
 p.jets.forEach(j=>j.removeFromParent()); // effect cones are not physical body geometry
 let triangles=0;p.car.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;for(const x of o.geometry.attributes.position.array)assert.ok(Number.isFinite(x));}});
 assert.ok(triangles<32000,`${triangles}`);
 for(const lift of [0,.25,.5,.75,1])for(const angle of [0,.5,1]){
  p.setAeroPose(lift,angle);p.car.updateMatrixWorld(true);
  for(const n of p.aeroNodes)assert.ok(n.matrixWorld.elements.every(Number.isFinite));
  if(lift===1)assert.ok(new Box3().setFromObject(p.spoiler).min.y>1.07,'raised endplates must clear the deck');
 }
 p.setAeroPose(1,0);assert.ok(p.spoiler.position.y-rest.y>.4);assert.equal(p.spoiler.rotation.x,0);
 p.setAeroPose(1,1);assert.ok(p.spoiler.rotation.x>.6);
 p.setAeroPose(0,0);assert.ok(p.spoiler.position.distanceTo(rest)<1e-9);assert.equal(p.spoiler.rotation.x,0);
 const bounds=new Box3().setFromObject(p.car).getSize(new Vector3());assert.ok(bounds.x<2.5&&bounds.z<5.1&&bounds.y<1.5);
 assert.ok(p.car.getObjectByName('Front LED light assemblies'));assert.ok(p.car.getObjectByName('Rear LED light assembly'));
 assert.equal(p.jets.length,8);assert.equal(p.aeroStruts.length,2);
 console.log(JSON.stringify({triangles,dimensions:bounds.toArray(),aeroNodes:p.aeroNodes.length}));
});
