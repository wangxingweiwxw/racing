import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_TYPES } from '../../src/openracing/traffic/traffic.ts';
import { carGeometry, carLodGeometry } from '../../src/openracing/traffic/carGeometry.ts';
import { streetDetails } from '../../src/openracing/world/streetDetails.ts';
import { buildLayout } from '../../src/openracing/world/layout.ts';

test('all civilian vehicle bodies, neutral trim and lights have finite, bounded geometry',()=>{
  for(const type of CAR_TYPES){
    const parts=carGeometry(type);let triangles=0;
    for(const geo of Object.values(parts)){
      geo.computeBoundingBox();const b=geo.boundingBox!;
      assert.ok([...b.min.toArray(),...b.max.toArray()].every(Number.isFinite));
      assert.ok(b.min.y>=-.02&&b.max.y<type.hgt+.4);
      assert.ok(b.max.x<type.wid/2+.3&&b.min.x>-type.wid/2-.3);
      assert.ok(b.max.z<type.len/2+.2&&b.min.z>-type.len/2-.2);
      triangles+=(geo.index?.count??geo.attributes.position.count)/3;geo.dispose();
    }
    assert.ok(triangles<8000,`${type.name}: ${triangles} triangles`);
    const lod=carLodGeometry(type);
    assert.ok((lod.index?.count??lod.attributes.position.count)/3<100);
    lod.dispose();
  }
});
test('street details share five instanced material batches',()=>{
  const group=streetDetails(buildLayout());
  assert.equal(group.children.length,5);
  for(const mesh of group.children as any[]){assert.ok(mesh.isInstancedMesh&&mesh.count>0);assert.ok(mesh.count<12000);}
});
