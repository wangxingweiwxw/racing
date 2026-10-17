import type { Course } from './race';

export const RACE_BOTS = 3;
export function singleLapCourse(trackId: string, length: number): Course {
  return {
    id: trackId === 'shanghai' ? 'sh-1' : 'full',
    name: '单圈冲刺',
    sub: '发车线 → 发车线 · 完整 1 圈',
    startS: 0, distance: length, laps: 1,
  };
}
