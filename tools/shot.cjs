// Browser check: load the game, take screenshots of the title flyover and a race.
// usage: PLAYWRIGHT_MODULE=... node tools/shot.cjs [url] [outdir]
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");
const url = process.argv[2] || "http://127.0.0.1:5180/";
const out = process.argv[3] || "checks";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (process.env.VERBOSE) console.log("[page]", m.type(), m.text().slice(0, 200)); if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForSelector("#title:not(.hidden)", { timeout: 240000 });
  await page.waitForFunction(() => window.__nk, null, { timeout: 60000 });
  console.log("loaded in", (Date.now() - t0) / 1000, "s");
  const adv = async (n, dt) => {
    const t = Date.now();
    await page.evaluate(([n, dt]) => window.__nk.advance(n, dt), [n, dt]);
    return Date.now() - t;
  };
  console.log("frame ms", await adv(1, 1 / 60));
  await page.screenshot({ path: `${out}/title.png`, timeout: 120000 });
  const steps = JSON.parse(process.env.STEPS || "[]");
  for (const s of steps) {
    if (process.env.VERBOSE) console.log("step", JSON.stringify(s).slice(0, 80));
    if (s.eval) console.log(JSON.stringify(await page.evaluate(s.eval)));
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.down) await page.keyboard.down(s.down);
    if (s.up) await page.keyboard.up(s.up);
    if (s.press) await page.keyboard.press(s.press);
    if (s.adv) console.log("adv", s.adv, "ms", await adv(s.adv[0], s.adv[1] ?? 1 / 60));
    if (s.shot) await page.screenshot({ path: `${out}/${s.shot}.png`, timeout: 120000 });
  }
  console.log("errors:", JSON.stringify(errors.slice(0, 20), null, 1));
  await browser.close();
})();
