// Track registry: everything that differs between circuits on the frontend side.
// Geometry, sectors and scenery come from public/data/<id>/ (tools/build_data.py <id>).
import type { Track } from "./track";
import type { Course } from "./race/race";

export interface TrackInfo {
  id: string;
  /** title / loading screen wordmark */
  brand: [string, string];
  /** picker card */
  label: string;
  labelSub: string;
  kicker: string;
  tagline: string;
  setupSub: string;
  freeModeDesc: string;
  helpTips: string;
  /** credits paragraph for the map data (HTML) */
  creditsMap: string;
  creditsElevation: string;
  /** title screen chips besides length / buildings / trees */
  chips(track: Track): [string, string][];
  courses(track: Track): Course[];
  defaultCourse: string;
  flyoverSector: string;
  /** stretches with catch fences and crowds */
  spectators: { sector: string; offset: number; length: number }[];
  campers: boolean;
  gantry: { title: string; sub: string };
  /** sponsor bridges: sector + offset in metres */
  bridges: { sector: string; offset: number; title: string; sub: string }[];
}

const OSM = `© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>，ODbL`;
const TILES = `<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a>（Terrarium，Mapzen；源数据包括 SRTM、EU-DEM 等）`;

const sectorS = (track: Track, name: string) => track.sectors.find((x) => x.name === name)!.s;

const NORDSCHLEIFE: TrackInfo = {
  id: "nordschleife",
  brand: ["Nordschleife", "Kart"],
  label: "纽博格林北环",
  labelSub: "德国 · 20.75 km · 绿色地狱",
  kicker: "Open Street Kart · 纽博格林",
  tagline: "在真实还原的“绿色地狱”上驾驶卡丁车。赛道、地形、森林与村庄全部由 OpenStreetMap 和高程数据生成。",
  setupSub: "选择模式、速度档位与赛段。北环全圈 20.75 km，分段赛约 4–6 km。",
  freeModeDesc: "Touristenfahrten：没有对手和道具，熟悉 73 个弯道",
  helpTips: "检查点每 250 m 一个，按 R 回到最近的检查点。Flugplatz、Sprunghügel、Pflanzgarten 等坡顶可以飞跃。",
  creditsMap: `赛道、建筑、道路、森林与地表分类：${OSM}。北环取自 OSM relation 38566（Nürburgring Nordschleife），经 Overpass API 获取。`,
  creditsElevation: `${TILES}。Flugplatz、Sprunghügel 等坡顶的跳跃起伏为手工补充，30 m 精度的 DEM 无法表现。`,
  chips: (track) => [
    [String(track.sectors.length), "个命名路段"],
    [String(Math.round(track.data.elevation.max - track.data.elevation.min)), "m 落差"],
  ],
  courses(track) {
    const L = track.length;
    const parts: [string, string, string, string][] = [
      ["s1", "第一段 · Hatzenbach", "T13", "Adenauer Forst"],
      ["s2", "第二段 · Adenauer Forst", "Adenauer Forst", "Bergwerk"],
      ["s3", "第三段 · Bergwerk", "Bergwerk", "Hohe Acht"],
      ["s4", "第四段 · Hohe Acht", "Hohe Acht", "T13"],
    ];
    const courses: Course[] = [{ id: "full", name: "北环全圈", sub: "T13 → T13 · Touristenfahrten 圈", startS: 0, distance: L, laps: 1 }];
    for (const [id, name, a, b] of parts) {
      const sa = a === "T13" ? 0 : sectorS(track, a);
      const sb = b === "T13" ? L : sectorS(track, b);
      courses.push({ id, name, sub: `${a} → ${b}`, startS: sa, distance: sb - sa, laps: 0 });
    }
    return courses;
  },
  defaultCourse: "s1",
  flyoverSector: "Hatzenbach",
  spectators: ["Hatzenbach", "Flugplatz", "Adenauer Forst", "Breidscheid", "Bergwerk", "Karussell", "Wippermann", "Brünnchen", "Pflanzgarten", "Schwalbenschwanz", "Galgenkopf"].map((n) => ({
    sector: n,
    offset: 40,
    length: n === "Brünnchen" || n === "Karussell" ? 260 : 170,
  })),
  campers: true,
  gantry: { title: "NÜRBURGRING · NORDSCHLEIFE", sub: "START / ZIEL  ·  T13  ·  20.75 KM" },
  bridges: [
    { sector: "Döttinger Höhe", offset: 380, title: "OPEN STREET KART", sub: "OpenStreetMap · ODbL  ·  © OSM contributors" },
    { sector: "Döttinger Höhe", offset: 640, title: "DÖTTINGER HÖHE", sub: "BRIDGE TO GANTRY · BTG" },
  ],
};

const SHANGHAI: TrackInfo = {
  id: "shanghai",
  brand: ["Shanghai", "Kart"],
  label: "上海国际赛车场",
  labelSub: "中国 · 5.45 km · F1 中国大奖赛",
  kicker: "Open Street Kart · F1 中国大奖赛",
  tagline: "在 F1 中国大奖赛的“上”字形赛道上驾驶卡丁车：T1–T2 蜗牛弯、T6 与 T14 发夹弯、1.2 km 后直道。赛道、看台、湖泊与河道由 OpenStreetMap 数据生成。",
  setupSub: "选择模式、速度档位与圈数。上海国际赛车场一圈 5.45 km，16 个弯角，顺时针行驶。",
  freeModeDesc: "没有对手和道具，熟悉 16 个弯角与刹车点",
  helpTips: "检查点每 250 m 一个，按 R 回到最近的检查点。T1–T2 蜗牛弯越收越紧，提早减速；后直道尽头的 T14 发夹弯是最佳超车点。",
  creditsMap: `赛道、看台、建筑、道路、湖泊与河道：${OSM}。赛道取自 OSM relation 2094941（Shanghai International Circuit）与发车线节点 1686043686，经 Overpass API 获取。弯角编号按 F1 官方（T1–T16）。`,
  creditsElevation: `${TILES}。长江三角洲地势平坦，DEM 的起伏主要来自建筑与树木，已大幅平滑。`,
  chips: () => [
    ["16", "个弯角"],
    ["1.2", "km 后直道"],
  ],
  courses(track) {
    const L = track.length;
    const lap = (id: string, laps: number, name: string): Course => ({ id, name, sub: `发车线 → 发车线 · ${laps} 圈`, startS: 0, distance: L * laps, laps });
    return [lap("sh-1", 1, "单圈冲刺"), lap("sh-3", 3, "3 圈赛"), lap("sh-5", 5, "5 圈赛")];
  },
  defaultCourse: "sh-3",
  flyoverSector: "主直道",
  spectators: [
    { sector: "主直道", offset: 140, length: 300 },
    { sector: "T1–T2 蜗牛弯", offset: 40, length: 260 },
    { sector: "T6 发夹弯", offset: 0, length: 160 },
    { sector: "T11", offset: 0, length: 150 },
    { sector: "T14 发夹弯", offset: -120, length: 260 },
  ],
  campers: false,
  gantry: { title: "SHANGHAI INTERNATIONAL CIRCUIT", sub: "上海国际赛车场  ·  START / FINISH  ·  5.45 KM" },
  bridges: [
    { sector: "后直道", offset: 420, title: "OPEN STREET KART", sub: "OpenStreetMap · ODbL  ·  © OSM contributors" },
    { sector: "主直道", offset: 160, title: "F1 CHINESE GRAND PRIX", sub: "中国大奖赛  ·  上海" },
  ],
};

export const TRACKS: TrackInfo[] = [NORDSCHLEIFE, SHANGHAI];

/** ?track=<id> wins, then the last track played, then the Nordschleife */
export function currentTrack(): TrackInfo {
  let id = new URLSearchParams(location.search).get("track");
  if (!id) {
    try {
      id = localStorage.getItem("nk-track");
    } catch {
      id = null;
    }
  }
  return TRACKS.find((t) => t.id === id) ?? NORDSCHLEIFE;
}

/** switching tracks reloads the page: the static world is uploaded once and its CPU copy freed */
export function switchTrack(id: string) {
  try {
    localStorage.setItem("nk-track", id);
  } catch {
    /* ignore */
  }
  const p = new URLSearchParams(location.search);
  p.set("track", id);
  location.search = p.toString();
}
