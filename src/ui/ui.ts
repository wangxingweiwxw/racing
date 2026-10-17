// DOM user interface: OSK gui/screens (home, pick mode, pick track,
// credits), race HUD and race finished GUI, rebuilt as a responsive web UI.
import "./style.css";
import "./race-hud.css";
import { icon } from "./icons";
import { Track } from "../track";
import { Course, Race, Racer } from "../race/race";
import { GameMode, SlotItem } from "../race/items";
import { BASE } from "../world/assets";
import { Settings } from "../settings";
import { TrackInfo, TRACKS, switchTrack } from "../tracks";
import { VEHICLES, recordSuffix, type VehicleId } from "../race/vehicles";
import { UserBrain } from "../race/brain";

import { PAINTS, PAINT_SOURCES, validPaint } from "../race/paints";
import { RACE_BOTS } from "../race/rules";

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
export function h(tag: string, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false) el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function fmtTime(t: number, digits = 3): string {
  if (t < 0 || !isFinite(t)) return "--:--.---";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(digits).padStart(digits + 3, "0")}`;
}

const modeInfo = (info: TrackInfo): { mode: GameMode; t: string; d: string }[] => [
  { mode: GameMode.VERSUS, t: "对手赛", d: "与 3 位同车型 AI 车手单圈竞速，道具槽按落后距离补给（OSK Versus）" },
  { mode: GameMode.AGAINST_CLOCK, t: "计时赛", d: "挑战个人最佳并与幽灵车对抗（OSK Against Clock）" },
  { mode: GameMode.FREE, t: "自由驾驶", d: info.freeModeDesc },
];
export interface SetupChoice {
  assist: boolean;
  vehicle: VehicleId;
  mode: GameMode;
  course: Course;
  color: number;
  bots: number;
}

export class UI {
  readonly root = document.getElementById("ui")!;
  private screens: Record<string, HTMLElement> = {};
  private hud!: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private mapCanvas!: HTMLCanvasElement;
  private mapBase: HTMLCanvasElement | null = null;
  private profCanvas!: HTMLCanvasElement;
  private profBase: HTMLCanvasElement | null = null;
  private speedCanvas!: HTMLCanvasElement;
  private mapXf = { s: 1, ox: 0, oz: 0 };
  choice!: SetupChoice;
  private track!: Track;
  private courses: Course[] = [];
  private lastSector = "";
  private sectorFlash = 0;
  private deltaText = "";
  private deltaT = 0;
  private standT = 0;
  onStart: (c: SetupChoice) => void = () => {};
  onResume: () => void = () => {};
  onPause: () => void = () => {};
  onRestart: () => void = () => {};
  onRespawn: () => void = () => {};
  onQuit: () => void = () => {};
  onSettings: (s: Settings) => void = () => {};
  touchHost!: HTMLElement;
  onUseItem: () => void = () => {};
  onCamera: () => void = () => {};

  constructor(private info: TrackInfo, private settings: Settings) {
    this.buildLoading();
  }

  setTrack(track: Track, courses: Course[]) {
    this.track = track;
    this.courses = courses;
    this.choice = {
      assist: true,
      vehicle: "u9x",
      mode: GameMode.VERSUS,
      course: courses.find((c) => c.id === this.info.defaultCourse) ?? courses[0],
      color: PAINTS.u9x[0].color,
      bots: RACE_BOTS,
    };
    try {
      const saved = JSON.parse(localStorage.getItem("nk-choice") || "null");
      if (saved) {
        this.choice.assist = saved.assist !== false;
        this.choice.vehicle = saved.vehicle === "roadster" ? "roadster" : "u9x";
        this.choice.mode = saved.mode ?? this.choice.mode;
        this.choice.color = saved.color ?? this.choice.color;
      }
      // the course is remembered per track
      const course = localStorage.getItem(`nk-course-${this.info.id}`) ?? saved?.course;
      this.choice.course = courses.find((c) => c.id === course) ?? this.choice.course;
    } catch {
      /* first visit */
    }
    const vehicleParam = new URLSearchParams(location.search).get("vehicle");
    if (vehicleParam === "roadster" || vehicleParam === "u9x") {
      this.choice.vehicle = vehicleParam;
    }
    this.choice.color = validPaint(this.choice.vehicle, this.choice.color);
  }

  // ------------------------------------------------------------------ loading
  private buildLoading() {
    const s = h(
      "div",
      { class: "screen", id: "loading" },
      h("div", { class: "brand", style: "text-align:center" }, h("span", { class: "b1" }, this.info.brand[0]), h("span", { class: "b2" }, this.info.brand[1])),
      h("div", { class: "load-bar" }, h("i", { id: "load-fill" })),
      h("div", { class: "load-text", id: "load-text" }, "准备中…"),
    );
    this.root.append(s);
    this.screens.loading = s;
  }

  setLoading(p: number, text: string) {
    (document.getElementById("load-fill") as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    document.getElementById("load-text")!.textContent = text;
  }

  // ------------------------------------------------------------------ build all screens after load
  buildScreens(stats: { buildings: number; trees: number }) {
    const L = (this.track.length / 1000).toFixed(2);
    const info = this.info;
    const title = h(
      "div",
      { class: "screen scrim-left hidden", id: "title" },
      h(
        "div",
        { class: "title-block" },
        h("div", { class: "kicker" }, "U9 XTREME × ROADSTER 2 · " + info.label),
        h("div", { class: "brand" }, h("span", { class: "b1" }, "仰望 U9"), h("span", { class: "b2" }, "XTREME")),
        h("p", { class: "tagline" }, "新增 Tesla Roadster 2 飞行概念车 · 进入赛事设置选择车型"),
        h(
          "div",
          { class: "chips" },
          h("span", { class: "chip" }, h("b", {}, L), "km"),
          ...info.chips(this.track).map(([v, label]) => h("span", { class: "chip" }, h("b", {}, v), label)),
          h("span", { class: "chip" }, h("b", {}, stats.buildings.toLocaleString()), "栋建筑"),
          h("span", { class: "chip" }, h("b", {}, stats.trees >= 10000 ? `${Math.round(stats.trees / 1000)}k` : stats.trees.toLocaleString()), "棵树"),
        ),
        h(
          "div",
          { class: "track-pick" },
          ...TRACKS.map((t) =>
            h(
              "button",
              {
                class: `opt ${t.id === info.id ? "on" : ""}`,
                "aria-pressed": t.id === info.id ? "true" : "false",
                onclick: () => t.id !== info.id && switchTrack(t.id),
              },
              h("div", { class: "t" }, t.label),
              h("div", { class: "d" }, t.id === info.id ? `${t.labelSub} · 当前赛道` : t.labelSub),
            ),
          ),
        ),
      ),
      h(
        "div",
        { class: "menu" },
        h("button", { class: "btn primary", onclick: () => this.show("setup") }, "开始比赛", h("span", { class: "k" }, "ENTER")),
        h("button", { class: "btn", onclick: () => { location.href = `${import.meta.env.BASE_URL}openracing/`; } }, "开放街道", h("span", { class: "k" }, "OPENRACING")),
        h("button", { class: "btn", onclick: () => this.show("help") }, "操作说明", h("span", { class: "k" }, "H")),
        h("button", { class: "btn", onclick: () => this.openSettings("title") }, "设置", h("span", { class: "k" }, "")),
        h("button", { class: "btn", onclick: () => this.show("credits") }, "致谢与许可", h("span", { class: "k" }, "")),
      ),
      h("div", { class: "foot" }, "U9 Xtreme 模型 © GeroDa74 / ACTK · 地图 © OpenStreetMap contributors · 玩法与场景素材 Open Street Kart"),
    );
    this.root.append(title);
    this.screens.title = title;

    this.screens.setup = this.buildSetup();
    this.screens.help = this.buildHelp();
    this.screens.credits = this.buildCredits();
    this.screens.settings = this.buildSettings();
    this.screens.pause = this.buildPause();
    this.screens.results = h("div", { class: "screen scrim hidden", id: "results" });
    this.root.append(this.screens.results);
    this.buildHud();
    addEventListener("keydown", (e) => {
      if (!this.screens.title.classList.contains("hidden")) {
        if (e.code === "Enter") this.show("setup");
        if (e.code === "KeyH") this.show("help");
      } else if (!this.screens.setup.classList.contains("hidden")) {
        if (e.code === "Enter") this.start();
        if (e.code === "Escape") this.show("title");
      } else if (!this.screens.help.classList.contains("hidden") || !this.screens.credits.classList.contains("hidden")) {
        if (e.code === "Escape" || e.code === "Enter") this.back();
      }
    });
  }

  private backTo = "title";
  private back() {
    this.show(this.backTo);
  }

  show(name: string) {
    for (const [k, el] of Object.entries(this.screens)) {
      if (k === "loading" && name !== "loading") {
        el.remove();
        delete this.screens.loading;
        continue;
      }
      el.classList.toggle("hidden", k !== name);
    }
    if (name === "setup") this.refreshSetup();
    // help / credits return to whichever menu opened them
    if (name === "title" || name === "pause") this.backTo = name;
  }

  hideAll() {
    this.show("none");
  }

  // ------------------------------------------------------------------ setup (OSK pick mode / track)
  private setupEls: { assist: HTMLElement; vehicles: HTMLElement; modes: HTMLElement; courses: HTMLElement; colors: HTMLElement; bots: HTMLElement; botsGroup: HTMLElement } | null = null;

  private buildSetup(): HTMLElement {
    const vehicles = h("div", { class: "opts vehicle-options" });
    const assist = h("div", { class: "opts" });
    const modes = h("div", { class: "opts" });
    const courses = h("div", { class: "opts" });
    const colors = h("div", { class: "swatches" });
    const bots = h("div", { class: "opts" });
    const botsGroup = h("div", { class: "group" }, h("label", {}, "对手数量"), bots);
    this.setupEls = { assist, vehicles, modes, courses, colors, bots, botsGroup };
    const s = h(
      "div",
      { class: "screen scrim hidden", id: "setup" },
      h(
        "div",
        { class: "panel" },
        h("h2", {}, "赛事设置"),
        h("p", { class: "sub" }, this.info.setupSub),
        h("div", { class: "group" }, h("label", {}, "选择座驾"), vehicles,
          h("p", { class: "vehicle-note" }, "Roadster 按参考视频重建外观；悬浮高度、时长与恢复速度为街机设定。两款车分别记录成绩。",
            h("a", { href: `${BASE}models/roadster/REFERENCE.md`, target: "_blank", rel: "noopener" }, "建模参考 ↗"))),
        h("div", { class: "group" }, h("label", {}, "模式"), modes),
        h("div", { class: "group vehicle-speed-note" }, h("label", {}, "车型极速"), h("p", { class: "sub" }, "各车型使用对应最高时速；赛道驾驶表现仍受弯道、抓地力和路况影响。")),
        h("div", { class: "group" }, h("label", {}, "驾驶辅助"), assist),
        h("div", { class: "group" }, h("label", {}, "赛程"), courses),
        botsGroup,
        h("div", { class: "group" }, h("label", {}, "车身颜色"), colors),
        h(
          "div",
          { class: "row-end" },
          h("button", { class: "btn ghost", onclick: () => this.show("title") }, "返回"),
          h("button", { class: "btn primary", onclick: () => this.start() }, "出发"),
        ),
      ),
    );
    this.root.append(s);
    return s;
  }

  private refreshSetup() {
    const e = this.setupEls!;
    const c = this.choice;
    c.bots = RACE_BOTS;
    c.color = validPaint(c.vehicle, c.color);
    e.assist.replaceChildren(...[true, false].map(enabled => h("button", {
      class: `opt ${c.assist === enabled ? "on" : ""}`, "data-assist": String(enabled), "aria-pressed": String(c.assist === enabled),
      onclick: () => { c.assist = enabled; this.refreshSetup(); },
    }, h("div", { class: "t" }, enabled ? "弯道辅助 · 推荐" : "手动驾驶"),
    h("div", { class: "d" }, enabled ? "提前制动，路肩轻微纠偏；仍需控制转向。辅助成绩单独记录。" : "自行判断刹车点与转向，保留原有成绩。"))));
    e.vehicles.replaceChildren(...(Object.keys(VEHICLES) as VehicleId[]).map(id => {
      const v = VEHICLES[id];
      return h("button", { class: `opt vehicle-option ${c.vehicle === id ? "on" : ""}`, "data-vehicle": id, "aria-pressed": c.vehicle === id ? "true" : "false", onclick: () => { c.vehicle = id; c.color = validPaint(id, c.color); this.refreshSetup(); } },
        h("small", {}, v.brand), h("div", { class: "t" }, v.name), h("div", { class: "d" }, v.description));
    }));
    e.modes.replaceChildren(
      ...modeInfo(this.info).map((m) =>
        h("button", { class: `opt ${c.mode === m.mode ? "on" : ""}`, onclick: () => ((c.mode = m.mode), this.refreshSetup()) }, h("div", { class: "t" }, m.t), h("div", { class: "d" }, m.d)),
      ),
    );
    e.courses.replaceChildren(
      ...this.courses.map((co) => {
        let best = -1;
        try {
          best = parseFloat(localStorage.getItem(`nk-best-${co.id}${recordSuffix(c.vehicle, c.assist)}`) || "-1");
        } catch {
          best = -1;
        }
        return h(
          "button",
          { class: `opt ${c.course.id === co.id ? "on" : ""}`, onclick: () => ((c.course = co), this.refreshSetup()) },
          h("div", { class: "t" }, co.name),
          h("div", { class: "d" }, `${co.sub}`),
          h("div", { class: "d" }, `${(co.distance / 1000).toFixed(2)} km · 最佳 ${best > 0 ? fmtTime(best, 2) : "—"}`),
        );
      }),
    );
    e.botsGroup.classList.toggle("hidden", c.mode !== GameMode.VERSUS);
    e.bots.replaceChildren(
      ...[RACE_BOTS].map((n) => h("button", { class: `opt ${c.bots === n ? "on" : ""}`, onclick: () => ((c.bots = n), this.refreshSetup()) }, h("div", { class: "t" }, `${n} 位同车型 AI 车手`))),
    );
    e.colors.replaceChildren(
      ...PAINTS[c.vehicle].map(paint =>
        h("button", {
          class: `paint-option ${c.color === paint.color ? "on" : ""}`,
          "data-paint": paint.name, "aria-pressed": String(c.color === paint.color),
          onclick: () => { c.color = paint.color; this.refreshSetup(); },
        }, h("i", { style: `background:#${paint.color.toString(16).padStart(6, "0")}`, "aria-hidden": "true" }), paint.name),
      ),
      h("p", { class: "paint-note" }, c.vehicle === "roadster" ? "当前仅开放官网展示的 Ano White。" : "采用 U9 官网展示的车身配色。",
        h("a", { href: PAINT_SOURCES[c.vehicle], target: "_blank", rel: "noopener" }, "官网配色 ↗")),
    );
  }

  private start() {
    this.choice.bots = RACE_BOTS;
    this.choice.course = this.courses[0];
    this.choice.color = validPaint(this.choice.vehicle, this.choice.color);
    try {
      localStorage.setItem("nk-choice", JSON.stringify({ assist: this.choice.assist, vehicle: this.choice.vehicle, mode: this.choice.mode, course: this.choice.course.id, color: this.choice.color, bots: this.choice.bots }));
      localStorage.setItem(`nk-course-${this.info.id}`, this.choice.course.id);
    } catch {
      /* ignore */
    }
    this.onStart(this.choice);
  }

  // ------------------------------------------------------------------ help / credits / settings / pause
  private buildHelp(): HTMLElement {
    const row = (a: string, ...keys: string[]) => h("div", {}, h("span", {}, a), h("span", {}, ...keys.map((k) => h("kbd", {}, k))));
    const s = h(
      "div",
      { class: "screen scrim hidden", id: "help" },
      h(
        "div",
        { class: "panel" },
        h("h2", {}, "操作说明"),
        h("p", { class: "sub" }, "键盘、手柄（标准映射）和触屏均可。"),
        h(
          "div",
          { class: "keys" },
          row("油门", "W", "↑"),
          row("刹车 / 倒车", "S", "↓"),
          row("转向", "A", "D"),
          row("使用道具", "E", "F"),
          row("Roadster 悬浮（按住）", "Space", "LB"),
          row("Roadster 展车 / 空中翻滚", "X", "B"),
          row("回到检查点", "R"),
          row("切换视角", "C"),
          row("回看", "Q"),
          row("暂停", "Esc", "P"),
          row("静音", "M"),
          row("手柄：油门 / 刹车", "RT", "LT"),
          row("手柄：道具", "X"),
        ),
        h(
          "div",
          { class: "prose" },
          h("h3", {}, "玩法"),
          "沿赛道行驶，越过终点线即完成赛段或比赛。驶出沥青后会被限速（OSK 的越界速度），撞护栏会损失速度。",
          h("br"),
          "弯道辅助默认开启：根据前方弯道提前制动，接近路肩时轻微纠偏。Roadster 升空后及降落途中继续辅助转向，空中油门、刹车和悬浮由你控制；普通腾空、逆行时不介入。可在赛事设置切换手动驾驶，两种模式分开记录成绩。",
          h("br"),
          "倒车：车速归零后持续按住刹车 2 秒进入 R 挡，继续按住即可倒车，最高 5 km/h。松开刹车会重置计时，踩油门可恢复前进。",
          h("br"),
          "Roadster：按住空格 / 手柄 LB / 屏幕悬浮按钮短时升空，WASD 继续控制。松开或推进剂耗尽后自动降落；落地松开悬浮键恢复推进剂，至少 25% 才能再次起飞。X / 手柄 B / 屏幕展车按钮：停车时开合车门、展开尾翼；升空超过 1.5 米且余量至少 20% 时翻滚一次，消耗 15% 推进剂。高速制动自动展开气动尾翼，帮助缩短刹车距离。飞行与特技均为街机玩法，悬浮限制在赛道走廊内。",
          h("br"),
          "道具（对手赛）：落后越多补给越快；空投炸弹抛向前方，16 m 范围内的车会被掀起。",
          h("br"),
          this.info.helpTips,
        ),
        h("div", { class: "row-end" }, h("button", { class: "btn primary", onclick: () => this.back() }, "知道了")),
      ),
    );
    this.root.append(s);
    return s;
  }

  private buildCredits(): HTMLElement {
    const s = h(
      "div",
      { class: "screen scrim hidden", id: "credits" },
      h(
        "div",
        { class: "panel" },
        h("h2", {}, "致谢与许可"),
        h(
          "div",
          {
            class: "prose",
            html: `
<h3>Open Street Kart</h3>
本游戏的玩法与代码移植自 <a href="https://github.com/Picorims/open-street-kart" target="_blank" rel="noopener">Open Street Kart</a>
（© 2025-2026 Charly Schmidt aka Picorims 与贡献者，MPL-2.0）：卡丁车物理、速度档位、检查点与重生、道具槽、空投炸弹、比赛状态与排名、相机、OSM 数据生成流程。移植后的源文件同样以 MPL-2.0 发布。
<h3>美术素材</h3>
沥青、草地、森林地面、田地、岩石、灌木、墙面材质与道具图标来自 Open Street Kart，© Picorims，<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>（已缩放；沥青裁去城市标线后镜像拼接）。
<h3>仰望 U9 Xtreme</h3>
车型来自用户提供的 gd_yangwang_u9 MOD，原作者 GeroDa74，LOD 制作 ACTK。使用 assetto-corsa-gltf 转换，适配网页车漆、灯组与车轮动画。模型及贴图权利归原作者，不适用本项目的代码或 OSK 素材许可。
<h3>地图数据</h3>
${this.info.creditsMap}
<h3>高程</h3>
${this.info.creditsElevation}
<h3>技术</h3>
Three.js、Vite、TypeScript。声音由 Web Audio 实时合成，未使用音频文件。`,
          },
        ),
        h("div", { class: "row-end" }, h("button", { class: "btn primary", onclick: () => this.back() }, "返回")),
      ),
    );
    this.root.append(s);
    return s;
  }

  private buildSettings(): HTMLElement {
    const s = h("div", { class: "screen scrim hidden", id: "settings" });
    this.root.append(s);
    return s;
  }

  private settingsFrom = "title";
  openSettings(from: string) {
    this.settingsFrom = from;
    const st = this.settings;
    const s = this.screens.settings;
    const q = h("div", { class: "opts" });
    const refreshQ = () =>
      q.replaceChildren(
        ...[
          [0, "流畅", "低分辨率、无阴影，远处树木减少"],
          [1, "均衡", "中等阴影与树木密度"],
          [2, "精美", "高清阴影，完整森林"],
        ].map(([v, t, d]) => h("button", { class: `opt ${st.quality === v ? "on" : ""}`, onclick: () => ((st.quality = v as number), refreshQ()) }, h("div", { class: "t" }, String(t)), h("div", { class: "d" }, String(d)))),
      );
    refreshQ();
    const vol = h("input", { type: "range", min: 0, max: 100, value: Math.round(st.volume * 100) }) as HTMLInputElement;
    vol.addEventListener("input", () => {
      st.volume = Number(vol.value) / 100;
      this.onSettings(st);
    });
    const fps = h("input", { type: "checkbox" }) as HTMLInputElement;
    fps.checked = st.showFps;
    fps.addEventListener("change", () => (st.showFps = fps.checked));
    s.replaceChildren(
      h(
        "div",
        { class: "panel" },
        h("h2", {}, "设置"),
        h("p", { class: "sub" }, "画质变更会在下次加载时完全生效（阴影立即生效）。"),
        h("div", { class: "group" }, h("label", {}, "画质"), q),
        h("div", { class: "group" }, h("label", {}, "音量"), h("div", { class: "slider" }, vol)),
        h("div", { class: "group" }, h("label", {}, "显示帧率"), fps),
        h(
          "div",
          { class: "row-end" },
          h(
            "button",
            {
              class: "btn primary",
              onclick: () => {
                this.onSettings(st);
                this.show(this.settingsFrom);
              },
            },
            "完成",
          ),
        ),
      ),
    );
    this.show("settings");
  }

  private buildPause(): HTMLElement {
    const s = h(
      "div",
      { class: "screen scrim hidden", id: "pause" },
      h(
        "div",
        { class: "panel", style: "width:min(420px,100%)" },
        h("h2", {}, "暂停"),
        h("p", { class: "sub", id: "pause-sub" }, ""),
        h(
          "div",
          { class: "menu", style: "width:100%" },
          h("button", { class: "btn primary", onclick: () => this.onResume() }, "继续", h("span", { class: "k" }, "ESC")),
          h("button", { class: "btn", onclick: () => this.onRespawn() }, "回到检查点", h("span", { class: "k" }, "R")),
          h("button", { class: "btn", onclick: () => this.onRestart() }, "重新开始"),
          h("button", { class: "btn", onclick: () => this.openSettings("pause") }, "设置"),
          h(
            "button",
            {
              class: "btn",
              onclick: () => this.show("help"),
            },
            "操作说明",
          ),
          h("button", { class: "btn", onclick: () => this.onQuit() }, "退出到菜单"),
        ),
      ),
    );
    this.root.append(s);
    return s;
  }

  setPauseInfo(text: string) {
    document.getElementById("pause-sub")!.textContent = text;
  }

  // ------------------------------------------------------------------ HUD
  private buildHud() {
    const slots = h("button", { class: "slots", id: "slots", "aria-label": "使用空投炸弹", title: "使用空投炸弹 · E", onclick: () => this.onUseItem() });
    for (let i = 0; i < 3; i++) slots.append(h("div", { class: "slot disabled" }, h("img", { alt: "" }), h("div", { class: "fill" })));
    this.mapCanvas = h("canvas", { width: 400, height: 400, "aria-label": "赛道地图" }) as HTMLCanvasElement;
    this.profCanvas = h("canvas", { width: 1100, height: 140 }) as HTMLCanvasElement;
    this.speedCanvas = h("canvas", { width: 800, height: 80 }) as HTMLCanvasElement;
    this.hud = h("div", { id: "hud", class: "hidden" },
      h("div", { class: "race-vignette" }),
      h("div", { class: "hud-tl" },
        h("div", { class: "pos", id: "pos-card" }, h("span", { class: "p", id: "pos" }, "1"), h("span", { class: "of", id: "pos-of" }, "/8"), h("span", { class: "rank-caption" }, "POSITION")),
        h("div", { class: "standings", id: "standings" }),
        h("div", { class: "timer" }, h("span", { class: "timer-icon", html: icon("timer") }), h("span", { class: "t", id: "time" }, "0:00.000")),
        h("div", { class: "timing-detail" }, h("span", {}, "BEST "), h("span", { id: "best" }, "--"), h("span", { id: "delta", class: "delta" }))),
      h("div", { class: "hud-tc" }, h("div", { class: "sector" }, h("small", { id: "remain" }), h("span", { id: "sector" }))),
      h("div", { class: "hud-tr" }, h("div", { class: "minimap" }, this.mapCanvas), h("div", { class: "race-progress", id: "race-progress" }, "0%")),
      h("div", { class: "race-tools" },
        h("button", { class: "hud-tool", "aria-label": "暂停与设置", title: "暂停 · Esc", onclick: () => this.onPause(), html: icon("settings") }),
        h("button", { class: "hud-tool", "aria-label": "切换视角", title: "切换视角 · C", onclick: () => this.onCamera(), html: icon("camera") }),
        h("button", { class: "hud-tool", "aria-label": "回到检查点", title: "回到检查点 · R", onclick: () => this.onRespawn(), html: icon("reset") })),
      h("div", { class: "vehicle-badge", id: "vehicle-badge" }),
      h("div", { class: "flight-panel hidden", id: "flight-panel" },
        h("div", { class: "flight-bottle", id: "flight-bottle", role: "progressbar", "aria-label": "悬浮推进剂余量", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "100" }, h("span", { class: "bottle-icon", html: icon("gas") }), h("span", { id: "flight-percent" }, "100%")),
        h("div", { class: "flight-heading" }, h("b", {}, "COLD GAS"), h("span", { id: "flight-state" }, "READY")),
        h("div", { class: "flight-meter", role: "progressbar", "aria-label": "推进剂余量", "aria-valuemin": "0", "aria-valuemax": "100", id: "flight-meter" }, h("i", { id: "flight-fill" })),
        h("div", { class: "flight-data" }, h("span", { id: "flight-charge" }), h("span", { id: "flight-alt" })),
        h("small", {}, "按住 SPACE / LB 悬浮 · 松开降落")),
      h("div", { class: "hud-br" },
        h("div", { class: "speedo" }, this.speedCanvas,
          h("div", { class: "speedo-readout" }, slots, h("span", { class: "v", id: "speed" }, "000"), h("span", { class: "u" }, "km/h"), h("span", { class: "gear", id: "gear" }, "D")),
          h("div", { class: "reverse-status", id: "reverse-status", "aria-live": "polite" }),
          h("div", { class: "assist-status", id: "assist-status" }),
          h("div", { class: "telemetry" }, h("span", { id: "alt" }), h("span", { id: "grade" })))),
      h("div", { class: "profile" }, this.profCanvas),
      h("div", { class: "hint", id: "hint" }, "W 加速  ·  S 刹车 / 停稳长按 2 秒倒车  ·  A / D 转向"),
      h("div", { class: "center-msg", id: "center" }),
      h("div", { class: "toast hidden", id: "toast" }),
      h("div", { class: "warn hidden", id: "warn" }, "逆行！按 R 回到检查点"),
      h("div", { id: "fps" }));
    this.root.append(this.hud);
    this.els["assist-status"] = this.hud.querySelector("#assist-status")!;
    this.els["flight-bottle"] = this.hud.querySelector("#flight-bottle")!;
    this.els["flight-percent"] = this.hud.querySelector("#flight-percent")!;
    for (const id of ["vehicle-badge", "flight-panel", "flight-state", "flight-meter", "flight-fill", "flight-charge", "flight-alt", "pos", "pos-of", "pos-card", "time", "best", "delta", "sector", "remain", "standings", "speed", "alt", "grade", "center", "toast", "warn", "slots", "fps", "hint", "gear", "race-progress", "reverse-status"]) this.els[id] = this.hud.querySelector(`#${id}`)!;
    this.touchHost = h("div", { class: "touch" });
    this.hud.append(this.touchHost);
  }

  showHud(v: boolean) {
    this.hud.classList.toggle("hidden", !v);
    if (!v) this.touchHost.dispatchEvent(new Event("resetcontrols"));
  }

  prepareHud(race: Race) {
    const v = VEHICLES[race.opts.vehicle ?? "u9x"];
    this.els["vehicle-badge"].replaceChildren(h("span", {}, v.brand), h("b", {}, v.badge), h("small", {}, v.trim));
    this.els["flight-panel"].classList.toggle("hidden", !race.player.kart.flightEnabled);
    this.touchHost.querySelector(".drive-lift")?.classList.toggle("hidden", !race.player.kart.flightEnabled);
    this.touchHost.querySelector(".drive-action")?.classList.toggle("hidden", !race.player.kart.flightEnabled);
    this.mapBase = null;
    this.profBase = null;
    this.lastSector = "";
    this.deltaText = "";
    const versus = race.opts.mode === GameMode.VERSUS;
    this.els["pos-card"].classList.toggle("hidden", !versus);
    this.els.standings.classList.toggle("hidden", !versus);
    this.els.slots.classList.toggle("hidden", !versus);
    const best = race.bestTime();
    this.els.best.textContent = best > 0 ? fmtTime(best) : "--";
    this.els.delta.textContent = "";
    this.els.center.textContent = "";
  }

  private buildMapBase(race: Race) {
    const tr = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < tr.N; i++) {
      minX = Math.min(minX, tr.x[i]);
      maxX = Math.max(maxX, tr.x[i]);
      minZ = Math.min(minZ, tr.z[i]);
      maxZ = Math.max(maxZ, tr.z[i]);
    }
    const W = this.mapCanvas.width;
    const pad = 26;
    const s = (W - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = pad + (W - pad * 2 - (maxX - minX) * s) / 2 - minX * s;
    const oz = pad + (W - pad * 2 - (maxZ - minZ) * s) / 2 - minZ * s;
    this.mapXf = { s, ox, oz };
    const c = document.createElement("canvas");
    c.width = W;
    c.height = W;
    const ctx = c.getContext("2d")!;
    const path = (a: number, b: number) => {
      ctx.beginPath();
      for (let k = a; k <= b; k += 4) {
        const i = tr.wrap(k);
        const x = tr.x[i] * s + ox;
        const y = tr.z[i] * s + oz;
        if (k === a) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    ctx.lineCap = ctx.lineJoin = "round";
    path(0, tr.N);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 6;
    ctx.stroke();
    const co = race.opts.course;
    const a = Math.floor(co.startS / tr.step);
    const b = Math.floor((co.startS + co.distance) / tr.step);
    path(a, b);
    ctx.strokeStyle = "#f2f5f0";
    ctx.lineWidth = 5;
    ctx.stroke();
    // start / finish markers
    for (const [k, col] of [
      [a, "#3ddc84"],
      [b, "#ffd400"],
    ] as const) {
      const i = tr.wrap(k);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(tr.x[i] * s + ox, tr.z[i] * s + oz, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    // north arrow
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "bold 22px 'Barlow Condensed', sans-serif";
    ctx.fillText("N", W - 30, 30);
    this.mapBase = c;
  }

  private buildProfileBase(race: Race) {
    const tr = this.track;
    const co = race.opts.course;
    const c = document.createElement("canvas");
    c.width = this.profCanvas.width;
    c.height = this.profCanvas.height;
    const ctx = c.getContext("2d")!;
    let lo = Infinity, hi = -Infinity;
    const n = 300;
    const ys: number[] = [];
    for (let k = 0; k <= n; k++) {
      const i = tr.wrap(Math.floor((co.startS + (co.distance * k) / n) / tr.step));
      ys.push(tr.y[i]);
      lo = Math.min(lo, tr.y[i]);
      hi = Math.max(hi, tr.y[i]);
    }
    const W = c.width;
    const H = c.height;
    // at least 30 m of range: flat circuits stay flat instead of magnifying DEM noise
    const yOf = (y: number) => H - 12 - ((y - lo) / Math.max(30, hi - lo)) * (H - 40);
    ctx.beginPath();
    ctx.moveTo(0, H);
    ys.forEach((y, k) => ctx.lineTo((k / n) * W, yOf(y)));
    ctx.lineTo(W, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(61,220,132,0.55)");
    g.addColorStop(1, "rgba(61,220,132,0.05)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ys.forEach((y, k) => (k ? ctx.lineTo((k / n) * W, yOf(y)) : ctx.moveTo(0, yOf(y))));
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "20px 'Barlow Condensed', sans-serif";
    ctx.fillText(`${Math.round(hi)} m`, 6, 22);
    ctx.fillText(`${Math.round(lo)} m`, 6, H - 16);
    // sector ticks
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    for (const sec of tr.sectors) {
      const d = tr.deltaS(co.startS, sec.s);
      const dd = d < 0 ? d + tr.length : d;
      if (dd > co.distance) continue;
      const x = (dd / co.distance) * W;
      ctx.beginPath();
      ctx.moveTo(x, 30);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    this.profBase = c;
  }

  updateHud(race: Race, dt: number, fps: number, camLabel: string) {
    if (!this.mapBase) this.buildMapBase(race);
    if (!this.profBase) this.buildProfileBase(race);
    const p = race.player;
    const k = p.kart;
    const tr = this.track;
    const co = race.opts.course;
    // timer
    this.els.time.textContent = fmtTime(race.phase === "finished" && p.finishTime >= 0 ? p.finishTime : race.time);
    const st = race.standings();
    this.els.pos.textContent = String(st.indexOf(p) + 1);
    this.els["pos-of"].textContent = `/${race.racers.length}`;
    // sector name
    const sec = tr.sectorAt(k.q.s);
    if (sec.name !== this.lastSector) {
      if (this.lastSector) this.sectorFlash = 1;
      this.lastSector = sec.name;
      this.els.sector.textContent = sec.name;
      // split delta vs best run
      if (race.phase === "racing" && p.splits.length) {
        const best = this.bestSplits(race);
        const i = p.splits.length - 1;
        if (best && best[i] !== undefined) {
          const d = p.splits[i] - best[i];
          this.deltaText = `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`;
          this.els.delta.className = `delta ${d <= 0 ? "good" : "bad"}`;
          this.deltaT = 4;
        }
      }
    }
    this.deltaT -= dt;
    this.els.delta.textContent = this.deltaT > 0 ? this.deltaText : "";
    this.sectorFlash = Math.max(0, this.sectorFlash - dt);
    (this.els.sector.parentElement as HTMLElement).style.boxShadow = this.sectorFlash > 0 ? `0 0 0 ${2 * this.sectorFlash}px rgba(255,212,0,${this.sectorFlash})` : "";
    const remain = Math.max(0, co.distance - k.progress);
    const lap = co.laps > 1 ? `第 ${Math.min(co.laps, p.lapTimes.length + 1)}/${co.laps} 圈 · ` : "";
    this.els.remain.textContent = `${lap}剩余 ${(remain / 1000).toFixed(2)} km · ${camLabel}`;
    // speed
    const assist = race.player.brain instanceof UserBrain ? race.player.brain.assist : undefined;
    const assistStatus = this.els["assist-status"];
    assistStatus.textContent = assist ? (k.flightControlActive ? `空中转向辅助 · ${assist.recovering ? "纠偏" : "就绪"}` : !k.grounded ? "弯道辅助 · 落地后恢复" : assist.braking ? `辅助制动 · 目标 ${Math.round(assist.targetSpeed * 3.6)} km/h` : assist.recovering ? "弯道辅助 · 路肩纠偏" : "弯道辅助 · 就绪") : "手动驾驶";
    assistStatus.classList.toggle("active", !!assist?.braking || !!assist?.recovering);
    if (k.flightEnabled) {
      const action = this.touchHost.querySelector<HTMLButtonElement>(".drive-action")!;
      const airborne = k.flightControlActive;
      action.querySelector("span")!.textContent = airborne ? "翻滚" : k.showcase ? "收起" : "展车";
      action.disabled = airborne ? k.flightHeight <= 1.5 || k.flightCharge < .2 || k.stuntActive : !k.grounded || k.speed >= 1;
      const charge = Math.round(k.flightCharge * 100);
      this.els["flight-fill"].style.width = `${charge}%`;
      this.els["flight-meter"].setAttribute("aria-valuenow", String(charge));
      this.els["flight-charge"].textContent = `${charge}% 推进剂`;
      this.els["flight-alt"].textContent = `${k.flightHeight.toFixed(1)} m 离地`;
      this.els["flight-state"].textContent = k.stuntActive ? "翻滚中" : k.thrusterActive ? "悬浮中" : !k.grounded ? "降落中" : k.showcase ? "展车中" : charge < 25 ? "恢复中" : "就绪";
      this.els["flight-panel"].classList.toggle("active", k.thrusterActive);
      this.els["flight-panel"].classList.toggle("low", charge < 25);
      this.els["flight-panel"].style.setProperty("--fuel", String(k.flightCharge));
      this.els["flight-percent"].textContent = `${charge}%`;
      this.els["flight-bottle"].setAttribute("aria-valuenow", String(charge));
      this.els["flight-bottle"].setAttribute("aria-valuetext", `${charge}% · ${this.els["flight-state"].textContent}`);
    }
    const kmh = Math.round(k.speed * 3.6);
    this.els.speed.textContent = String(kmh).padStart(3, "0");
    this.els.gear.textContent = k.goingBackwards ? "R" : "D";
    this.els["race-progress"].textContent = `${Math.round(Math.max(0, Math.min(1, k.progress / co.distance)) * 100)}%`;
    this.els.alt.textContent = `海拔 ${Math.round(k.pos.y)} m`;
    const gi = tr.wrap(k.q.i + 5);
    const gj = tr.wrap(k.q.i - 5);
    const grade = ((tr.y[gi] - tr.y[gj]) / (10 * tr.step)) * 100;
    this.els.grade.textContent = `坡度 ${grade >= 0 ? "+" : ""}${grade.toFixed(0)}%`;
    this.drawSpeedo(k.speed, k.maxSpeed);
    this.els["reverse-status"].textContent = k.goingBackwards ? "R · 倒车限速 5 km/h" : k.reverseHoldTime > 0 ? "保持刹车 · 2 秒后倒车" : "";
    const brake = this.touchHost.querySelector<HTMLElement>(".drive-brake");
    brake?.style.setProperty("--hold", `${Math.min(1, k.reverseHoldTime / 2) * 100}%`);
    // standings
    this.standT -= dt;
    if (race.opts.mode === GameMode.VERSUS && this.standT <= 0) {
      this.standT = 0.25;
      const lead = st[0].kart.progress;
      this.els.standings.replaceChildren(
        ...st.filter((r, i) => i === 0 || r.isPlayer || i === Math.max(1, st.indexOf(p) - 1)).slice(0, 3).map((r) =>
          h(
            "div",
            { class: `r ${r.isPlayer ? "me" : ""}` },
            h("span", { class: "rank-num" }, String(st.indexOf(r) + 1)),
            h("span", { class: "dot", style: `background:#${r.look.color.toString(16).padStart(6, "0")}` }),
            h("span", {}, r.name),
            h("span", { class: "gap" }, r.finishTime >= 0 ? fmtTime(r.finishTime, 1) : st.indexOf(r) === 0 ? "领先" : `−${Math.round(lead - r.kart.progress)} m`),
          ),
        ),
      );
    }
    // item slots
    if (p.slots) {
      const disp = p.slots.display();
      (this.els.slots as HTMLButtonElement).disabled = disp[0]?.item !== SlotItem.AIR_BOMB;
      const slotEls = this.els.slots.children;
      disp.forEach((d, i) => {
        const el = slotEls[i] as HTMLElement;
        el.classList.toggle("disabled", d.item === SlotItem.DISABLED);
        el.classList.toggle("first", i === 0 && (d.item === SlotItem.AIR_BOMB));
        const img = el.querySelector("img") as HTMLImageElement;
        const src = d.item === SlotItem.AIR_BOMB ? `${BASE}textures/item_slot_air_bomb.png` : "";
        if (img.getAttribute("src") !== src) {
          if (src) img.setAttribute("src", src);
          else img.removeAttribute("src");
          img.style.visibility = src ? "visible" : "hidden";
        }
        (el.querySelector(".fill") as HTMLElement).style.width = `${Math.min(1, d.progress) * 100}%`;
        (el.querySelector(".fill") as HTMLElement).style.background = d.item === SlotItem.EMPTY ? "#6cb8ff" : "#ffd400";
      });
    }
    // center messages
    let center = "";
    if (race.phase === "countdown") center = race.countdown > 3 ? "" : String(Math.ceil(race.countdown));
    const go = race.events.find((e) => e.text === "GO!");
    if (go && go.t < 0.9) center = "GO!";
    if (race.phase === "finished" && p.finishTime >= 0 && race.time - p.finishTime < 2.5) center = "FINISH";
    this.els.center.textContent = center;
    this.els.center.style.color = center === "GO!" ? "#3ddc84" : center === "FINISH" ? "#ffd400" : "#fff";
    const toast = race.events.filter((e) => e.text !== "GO!").slice(-1)[0];
    this.els.toast.classList.toggle("hidden", !toast);
    if (toast) this.els.toast.textContent = toast.text;
    this.els.warn.classList.toggle("hidden", p.wrongWay < 1.5);
    this.els.fps.textContent = this.settings.showFps ? `${Math.round(fps)} FPS` : "";
    this.drawMap(race);
    this.drawProfile(race);
  }

  bestSplits(race: Race): number[] | null {
    try {
      return JSON.parse(localStorage.getItem(`nk-splits-${race.recordId}`) || "null");
    } catch {
      return null;
    }
  }

  private drawSpeedo(v: number, vmax: number) {
    const c = this.speedCanvas;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    const amount = Math.min(1, v / vmax);
    for (let i = 0; i < 24; i++) {
      const x = 24 + i * 31;
      const active = i / 24 < amount;
      ctx.fillStyle = active ? "#30c7ff" : "rgba(200,224,246,0.13)";
      ctx.shadowColor = "#00b7ff"; ctx.shadowBlur = active ? 14 : 0;
      ctx.beginPath(); ctx.moveTo(x + 9, 20); ctx.lineTo(x + 35, 20); ctx.lineTo(x + 25, 45); ctx.lineTo(x, 45); ctx.closePath(); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  private drawMap(race: Race) {
    const ctx = this.mapCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
    ctx.drawImage(this.mapBase!, 0, 0);
    const { s, ox, oz } = this.mapXf;
    const ordered = [...race.racers].sort((a, b) => Number(a.isPlayer) - Number(b.isPlayer));
    for (const r of ordered) {
      const x = r.kart.pos.x * s + ox;
      const y = r.kart.pos.z * s + oz;
      ctx.fillStyle = `#${r.look.color.toString(16).padStart(6, "0")}`;
      ctx.strokeStyle = r.isPlayer ? "#fff" : "rgba(0,0,0,0.7)";
      ctx.lineWidth = r.isPlayer ? 4 : 2;
      ctx.beginPath();
      if (r.isPlayer) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(r.kart.heading);
        ctx.fillStyle = "#27c8ff"; ctx.shadowColor = "#00baff"; ctx.shadowBlur = 14;
        ctx.moveTo(0, -17); ctx.lineTo(11, 13); ctx.lineTo(0, 7); ctx.lineTo(-11, 13); ctx.closePath();
        ctx.fill(); ctx.stroke(); ctx.restore();
      } else { ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    if (race.ghost) {
      const g = race.ghost.model.root.position;
      ctx.strokeStyle = "#9fd8ff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(g.x * s + ox, g.z * s + oz, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawProfile(race: Race) {
    const ctx = this.profCanvas.getContext("2d")!;
    const W = this.profCanvas.width;
    const H = this.profCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.profBase!, 0, 0);
    const co = race.opts.course;
    const draw = (r: Racer) => {
      const f = Math.max(0, Math.min(1, r.kart.progress / co.distance));
      const x = f * W;
      ctx.fillStyle = `#${r.look.color.toString(16).padStart(6, "0")}`;
      ctx.fillRect(x - (r.isPlayer ? 3 : 2), 26, r.isPlayer ? 6 : 4, H - 26);
    };
    for (const r of race.racers) if (!r.isPlayer) draw(r);
    draw(race.player);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px 'Barlow Condensed', sans-serif";
    const f = Math.max(0, Math.min(1, race.player.kart.progress / co.distance));
    ctx.textAlign = f > 0.85 ? "right" : "left";
    ctx.fillText(`${(race.player.kart.progress / 1000).toFixed(2)} / ${(co.distance / 1000).toFixed(2)} km`, f * W + (f > 0.85 ? -8 : 8), 20);
    ctx.textAlign = "left";
  }

  // ------------------------------------------------------------------ results (OSK race_finished_gui)
  showResults(race: Race, isNewBest: boolean, prevBest: number) {
    const p = race.player;
    const st = race.standings();
    const rows = st.map((r, i) => {
      const remaining = race.opts.course.distance - r.kart.progress;
      return h(
        "tr",
        { class: r.isPlayer ? "me" : "" },
        h("td", { class: "num" }, String(i + 1)),
        h("td", {}, h("span", { class: "dot", style: `display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;background:#${r.look.color.toString(16).padStart(6, "0")}` }), r.name),
        h("td", { class: "num" }, r.finishTime >= 0 ? fmtTime(r.finishTime) : `${Math.max(0, Math.round(remaining))} m`),
      );
    });
    const splitsEl = h("div", { class: "splits" });
    let prev = 0;
    const names: string[] = [];
    const startIdx = this.track.sectors.indexOf(this.track.sectorAt(race.opts.course.startS + 1));
    for (let i = 0; i < p.splits.length; i++) names.push(this.track.sectors[(startIdx + i) % this.track.sectors.length].name);
    p.splits.forEach((t, i) => {
      splitsEl.append(h("div", {}, names[i] ?? `#${i + 1}`, h("span", {}, (t - prev).toFixed(2))));
      prev = t;
    });
    const versus = race.opts.mode === GameMode.VERSUS;
    const panel = h(
      "div",
      { class: "panel results" },
      h("div", { class: "lbl" }, `${race.opts.course.name} · ${(race.opts.course.distance / 1000).toFixed(2)} km`),
      h(
        "div",
        { style: "display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;margin:8px 0 6px" },
        versus ? h("div", { class: "big-time", style: "color:var(--accent)" }, `P${st.indexOf(p) + 1}`) : null,
        h("div", { class: "big-time" }, fmtTime(p.finishTime)),
        isNewBest ? h("span", { class: "badge" }, "个人最佳") : prevBest > 0 ? h("span", { class: "lbl" }, `最佳 ${fmtTime(prevBest)}`) : null,
      ),
      h("p", { class: "sub" }, `平均速度 ${((race.opts.course.distance / p.finishTime) * 3.6).toFixed(1)} km/h`),
      versus ? h("table", {}, h("tr", {}, h("th", {}, "名次"), h("th", {}, "车手"), h("th", {}, "时间 / 剩余")), ...rows) : null,
      race.opts.course.laps > 1 && p.lapTimes.length
        ? h(
            "div",
            { class: "group" },
            h("label", {}, "单圈用时"),
            h(
              "div",
              { class: "splits" },
              ...p.lapTimes.map((t, i) => {
                const lt = t - (i ? p.lapTimes[i - 1] : 0);
                const fastest = Math.min(...p.lapTimes.map((x, j) => x - (j ? p.lapTimes[j - 1] : 0)));
                return h("div", {}, `第 ${i + 1} 圈`, h("span", { style: lt === fastest ? "color:var(--accent)" : "" }, fmtTime(lt)));
              }),
            ),
          )
        : null,
      h("div", { class: "group" }, h("label", {}, "路段用时（秒）"), splitsEl),
      h(
        "div",
        { class: "row-end" },
        h("button", { class: "btn ghost", onclick: () => this.onQuit() }, "返回菜单"),
        h("button", { class: "btn primary", onclick: () => this.onRestart() }, "再来一次"),
      ),
    );
    this.screens.results.replaceChildren(panel);
    this.show("results");
  }
}
