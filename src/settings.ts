import type { CamMode } from "./race/camera";

export interface Settings {
  quality: number; // 0 fast, 1 balanced, 2 beautiful
  volume: number;
  showFps: boolean;
  camera: CamMode;
}

const KEY = "nk-settings";

export function loadSettings(): Settings {
  const mobile = matchMedia("(pointer: coarse)").matches;
  const def: Settings = { quality: mobile ? 0 : 1, volume: 0.7, showFps: false, camera: "chase" };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return def;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage disabled */
  }
}
