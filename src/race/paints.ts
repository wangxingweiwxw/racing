import type { VehicleId } from './vehicles';

// Official exterior displays checked 2026-10-17. RGB values are game approximations,
// not manufacturer paint codes. U9 family colours applied to our U9 Xtreme model.
export const PAINTS = {
  u9x: [
    { name: '阿盖尔紫', color: 0x64516f },
    { name: '赤霞丹朱', color: 0xc63c40 },
    { name: '月曜银', color: 0xbfc4ca },
    { name: '极境森林', color: 0x244e43 },
  ],
  roadster: [{ name: 'Ano White', color: 0xf4f4f4 }],
} as const;

export const PAINT_SOURCES = {
  u9x: 'https://www.yangwangauto.com/u9-detail-page.html',
  roadster: 'https://www.tesla.com/el_GR/roadster',
} as const;

export function validPaint(vehicle: VehicleId, color: unknown): number {
  return PAINTS[vehicle].find(paint => paint.color === color)?.color ?? PAINTS[vehicle][0].color;
}
