import test from 'node:test';
import assert from 'node:assert/strict';
import { PAINTS, validPaint } from '../src/race/paints.ts';
import { TRACKS } from '../src/tracks.ts';
import { soloMode } from '../src/race/rules.ts';
import { GameMode } from '../src/race/items.ts';

test('legacy versus saves become time trials while free driving stays available', () => {
  for (const old of [GameMode.VERSUS, undefined, null, 7, '1']) {
    assert.equal(soloMode(old), GameMode.AGAINST_CLOCK);
  }
  assert.equal(soloMode(GameMode.AGAINST_CLOCK), GameMode.AGAINST_CLOCK);
  assert.equal(soloMode(GameMode.FREE), GameMode.FREE);
});

test('both circuits offer only one full lap, with a valid default', () => {
  for (const info of TRACKS) {
    const courses = info.courses({ length: 5432 });
    assert.equal(courses.length, 1);
    assert.equal(courses[0].id, info.defaultCourse);
    assert.equal(courses[0].laps, 1);
    assert.equal(courses[0].distance, 5432);
    assert.equal(courses[0].startS, 0);
  }
});
test('saved unsupported paint falls back to a colour for the selected vehicle', () => {
  for (const vehicle of ['u9x', 'roadster']) {
    for (const invalid of [undefined, null, 'red', 0xff7b00, NaN]) {
      assert.equal(validPaint(vehicle, invalid), PAINTS[vehicle][0].color);
    }
    for (const paint of PAINTS[vehicle]) assert.equal(validPaint(vehicle, paint.color), paint.color);
  }
  assert.equal(validPaint('roadster', PAINTS.u9x[0].color), PAINTS.roadster[0].color);
  assert.equal(validPaint('u9x', PAINTS.roadster[0].color), PAINTS.u9x[0].color);
});
