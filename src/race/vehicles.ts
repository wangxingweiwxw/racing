export type VehicleId = "u9x" | "roadster";

export const VEHICLES = {
  u9x: { name: "仰望 U9 Xtreme", brand: "YANGWANG", badge: "U9 X", trim: "XTREME", description: "赛道驾驶 · 最高时速 496 km/h", maxSpeedKmh: 496.22 },
  roadster: { name: "Tesla Roadster 2", brand: "TESLA", badge: "ROADSTER", trim: "FLIGHT CONCEPT", description: "最高时速约 370 km/h · 短时悬浮", maxSpeedKmh: 370.15 },
} as const;

export function vehicleMaxSpeedMps(vehicle: VehicleId = "u9x") {
  return VEHICLES[vehicle].maxSpeedKmh / 3.6;
}

/** Keep assisted records separate; manual mode retains the existing vehicle keys. */
export function recordSuffix(vehicle: VehicleId = "u9x", assist = true) {
  return (vehicle === "roadster" ? "-roadster-vmax370-flight-v1" : "-u9x-vmax496") + (assist ? "-assist-v1" : "");
}
