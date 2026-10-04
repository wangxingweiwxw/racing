// On-screen controls for phones and tablets (multi-touch, pointer events).
import { Controls } from "../race/brain";
import { h } from "./ui";

export function buildTouch(host: HTMLElement, c: Controls) {
  const t = c.touch;
  const btn = (label: string, style: string, down: () => void, up: () => void) => {
    const el = h("div", { class: "tz", style }, label);
    const ids = new Set<number>();
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      ids.add(e.pointerId);
      el.classList.add("active");
      down();
    });
    const release = (e: PointerEvent) => {
      if (!ids.delete(e.pointerId)) return;
      if (ids.size === 0) {
        el.classList.remove("active");
        up();
      }
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    host.append(el);
    return el;
  };
  const S = "width:88px;height:88px;bottom:max(24px,env(safe-area-inset-bottom));";
  btn("◀", `${S}left:20px;`, () => (t.steer = -1), () => (t.steer = t.steer < 0 ? 0 : t.steer));
  btn("▶", `${S}left:122px;`, () => (t.steer = 1), () => (t.steer = t.steer > 0 ? 0 : t.steer));
  btn("油门", `${S}right:20px;width:100px;height:100px;`, () => (t.throttle = 1), () => (t.throttle = 0));
  btn("刹车", `${S}right:134px;width:76px;height:76px;`, () => (t.brake = 1), () => (t.brake = 0));
  btn("漂移", "width:70px;height:70px;right:30px;bottom:calc(max(24px,env(safe-area-inset-bottom)) + 118px);", () => (t.drift = true), () => (t.drift = false));
  btn("道具", "width:62px;height:62px;right:118px;bottom:calc(max(24px,env(safe-area-inset-bottom)) + 100px);", () => (t.item = true), () => undefined);
}
