import type { Course } from './race';
import { GameMode } from './items.ts';

/** Old versus saves and unknown values become a solo time trial. */
export function soloMode(mode: unknown): GameMode {
  return mode === GameMode.FREE ? GameMode.FREE : GameMode.AGAINST_CLOCK;
}
export function singleLapCourse(trackId: string, length: number): Course {
  return {
    id: trackId === 'shanghai' ? 'sh-1' : 'full',
    name: '单圈冲刺',
    sub: '发车线 → 发车线 · 完整 1 圈',
    startS: 0, distance: length, laps: 1,
  };
}
