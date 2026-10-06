// Minimum translation between two oriented U9X footprints (metres).
type Body = { pos: { x: number; y: number; z: number }; heading: number };
export function carOverlap(a: Body, b: Body): { nx: number; nz: number; depth: number } | null {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  if (dx * dx + dz * dz > 30 || Math.abs(a.pos.y - b.pos.y) > 1.4) return null;
  const af = [Math.sin(a.heading), -Math.cos(a.heading)];
  const ar = [Math.cos(a.heading), Math.sin(a.heading)];
  const bf = [Math.sin(b.heading), -Math.cos(b.heading)];
  const br = [Math.cos(b.heading), Math.sin(b.heading)];
  let depth = Infinity, nx = 0, nz = 0;
  for (const axis of [af, ar, bf, br]) {
    const radius = (f: number[], r: number[]) => 2.48 * Math.abs(axis[0] * f[0] + axis[1] * f[1]) + 1.04 * Math.abs(axis[0] * r[0] + axis[1] * r[1]);
    const distance = dx * axis[0] + dz * axis[1];
    const overlap = radius(af, ar) + radius(bf, br) - Math.abs(distance);
    if (overlap <= 0) return null;
    if (overlap < depth) { depth = overlap; nx = axis[0] * (distance < 0 ? -1 : 1); nz = axis[1] * (distance < 0 ? -1 : 1); }
  }
  return { nx, nz, depth };
}
