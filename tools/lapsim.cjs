// Simulate a full race with every kart (player included) driven by the AI and
// report lap times, respawns, rail hits and airtime. Validates physics + AI on the whole loop.
// usage: node tools/lapsim.cjs [url] [speedMode 0..3] [courseIndex]
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const url = process.argv[2] || "http://127.0.0.1:4173/?manual";
const speed = Number(process.argv[3] ?? 3);
const course = Number(process.argv[4] ?? 0);
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  page.on("console", (m) => { if (m.type() === "warning" && m.text().includes("context")) console.log("[page]", m.text()); });
  page.on("crash", () => console.log("page crashed"));
  await page.goto(url);
  await page.waitForSelector("#title:not(.hidden)", { timeout: 240000 });
  await page.waitForFunction(() => window.__nk, null, { timeout: 60000 });
  await page.evaluate(([speed, course]) => {
    const n = window.__nk;
    n.startRace({ mode: 1, speed, course: n.courses[course], color: 0xe63946, bots: 7 });
    const r = n.race;
    const B = r.racers.find((x) => !x.isPlayer).brain.constructor;
    r.player.brain = new B(n.track, r.player.kart.maxSpeed, 0.95, 0);
    r.player.slots = null;
    const st = (window.__stat = { air: 0, maxAir: 0, maxAirAt: 0, hits: 0, resp: [], frames: 0 });
    r.racers.forEach((x) => {
      const o = x.kart.respawn.bind(x.kart);
      x.kart.respawn = () => {
        st.resp.push([x.name, Math.round(x.kart.q.s), Math.round(r.time)]);
        o();
      };
    });
  }, [speed, course]);
  for (let chunk = 0; chunk < 400; chunk++) {
    const t0 = Date.now();
    const res = await page.evaluate(() => {
      const n = window.__nk, r = n.race, st = window.__stat;
      for (let f = 0; f < 100 && r.racers.some((x) => x.finishTime < 0); f++) {
        n.advance(1, 0.05, false);
        st.frames++;
        const k = r.player.kart;
        if (!k.grounded) {
          st.air += 0.05;
          if (k.airTime > st.maxAir) { st.maxAir = k.airTime; st.maxAirAt = Math.round(k.q.s); }
        }
        if (k.events.railHit > 3) st.hits++;
      }
      return { t: r.time.toFixed(0), done: !r.racers.some((x) => x.finishTime < 0), prog: r.standings().map((x) => Math.round(x.kart.progress)), player: Math.round(r.player.kart.progress) };
    });
    if (chunk % 10 === 0) console.log(`chunk ${chunk} ${Date.now() - t0}ms t=${res.t}s player=${res.player} field=${res.prog.join(",")}`);
    if (res.done) break;
  }
  const out = await page.evaluate(() => {
    const r = window.__nk.race;
    return { stat: window.__stat, results: r.standings().map((x) => [x.name, x.finishTime.toFixed(1), Math.round(x.kart.progress)]) };
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
