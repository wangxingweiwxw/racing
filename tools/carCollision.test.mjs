import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carOverlap } from '../src/race/carCollision.ts';
const car = (x, z, heading = 0, y = 0) => ({ pos: { x, z, y }, heading });
test('full-length cars touch nose to tail before their centers overlap', () => {
  assert.equal(carOverlap(car(0, 0), car(0, 5)), null);
  const hit = carOverlap(car(0, 0), car(0, 4.8));
  assert.ok(hit && Math.abs(hit.depth - .16) < .001 && hit.nz === 1);
});
test('parallel lanes remain clear; lateral overlap separates sideways', () => {
  assert.equal(carOverlap(car(0, 0), car(2.2, 0)), null);
  assert.ok(Math.abs(carOverlap(car(0, 0), car(2, 0)).depth - .08) < .001);
});
test('perpendicular and coincident cars resolve with finite normals', () => {
  for (const b of [car(0, 0), car(2.5, 0, Math.PI / 2)]) {
    const hit = carOverlap(car(0, 0), b);
    assert.ok(hit && Number.isFinite(hit.depth));
    assert.ok(Math.abs(Math.hypot(hit.nx, hit.nz) - 1) < 1e-6);
  }
  assert.equal(carOverlap(car(0, 0), car(0, 0, 0, 2)), null);
});
