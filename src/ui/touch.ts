// Multi-pointer controls with safe release on capture loss and app switching.
import { Controls } from "../race/brain";
import { h } from "./ui";
import { icon } from "./icons";

export function buildTouch(host: HTMLElement, c: Controls) {
  const held = new Map<string, Set<number>>();
  const buttons: HTMLElement[] = [];
  const update = () => {
    const down = (key: string) => (held.get(key)?.size ?? 0) > 0;
    c.touch.steer = Number(down("right")) - Number(down("left"));
    c.touch.throttle = Number(down("pedal"));
    const brake = Number(down("brake"));
    if (c.touch.brake && !brake) c.onBrakeRelease();
    c.touch.brake = brake;
  };
  const button = (key: string, label: string, parent: HTMLElement) => {
    const ids = new Set<number>();
    held.set(key, ids);
    const el = h("button", { class: `drive-control drive-${key}`, "aria-label": label, title: label, html: icon(key) });
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); ids.add(e.pointerId);
      el.classList.add("active"); update();
    });
    const release = (e: PointerEvent) => { ids.delete(e.pointerId); el.classList.toggle("active", ids.size > 0); update(); };
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(event, release as EventListener);
    buttons.push(el); parent.append(el);
  };
  const steering = h("div", { class: "steering-pad" });
  host.append(steering);
  button("left", "向左转向 · A", steering); button("right", "向右转向 · D", steering);
  const pedals = h("div", { class: "pedal-pair" });
  host.append(pedals);
  button("brake", "刹车 · 停稳长按 2 秒倒车（最高 5 km/h）· S", pedals);
  button("pedal", "加速 · W", pedals);
  const clear = () => { for (const ids of held.values()) ids.clear(); buttons.forEach((el) => el.classList.remove("active")); c.touch.item = false; update(); };
  addEventListener("blur", clear);
  document.addEventListener("visibilitychange", () => { if (document.hidden) clear(); });
  host.addEventListener("resetcontrols", clear);
}
