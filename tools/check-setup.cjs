const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const origin = process.env.BASE_URL || 'http://127.0.0.1:5178';
(async () => {
  const browser = await chromium.launch({ channel:'msedge', headless:true, args:['--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport:{width:1280,height:900} });
    // External typography is not required for game checks; use the CSS fallbacks.
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('nk-track','shanghai');
      localStorage.setItem('nk-choice',JSON.stringify({vehicle:'roadster',color:0xff7b00,bots:7,mode:1,course:'sh-5'}));
      localStorage.setItem('nk-course-shanghai','sh-5');
      localStorage.setItem('nk-course-nordschleife','s2');
    });
    await page.goto(`${origin}/?manual&q=low`,{waitUntil:"domcontentloaded"});
    await page.waitForFunction(() => window.openracing, null, {timeout:180000});
    assert.equal(new URL(page.url()).pathname, '/openracing/');
    assert.equal(await page.locator('#notice b').innerText(),'Roadster 2 · Ano White');
    await page.locator('#start [data-open-circuits]').click();
    assert.equal(await page.locator('#circuit-select a').count(),2);
    for (const [width,height] of [[390,844],[844,390],[320,640]]) {
      await page.setViewportSize({width,height});
      const fits = await page.locator('#circuit-select').evaluate(el => {const b=el.getBoundingClientRect();return b.x>=0&&b.y>=0&&b.right<=innerWidth&&b.bottom<=innerHeight&&el.scrollWidth===el.clientWidth;});
      assert.ok(fits, `chooser fits ${width}x${height}`);
      await page.screenshot({path:`checks/chooser-${width}.png`});
    }
    await page.setViewportSize({width:1280,height:900});
    // Preserve manual rendering only in the test navigation to keep GPU work bounded.
    await page.locator('[data-track="shanghai"]').evaluate(a => a.href += '&manual');
    await page.locator('[data-track="shanghai"]').click();
    for (const track of ['shanghai','nordschleife']) {
      if (track === 'nordschleife') await page.goto(`${origin}/?track=${track}&setup=1&manual`,{waitUntil:"domcontentloaded"});
      await page.waitForFunction(() => window.__nk, null, {timeout:180000});
      assert.equal(await page.locator('#setup').isVisible(),true);
      const choice = await page.evaluate(() => window.__nk.ui.choice);
      assert.equal(choice.bots,0);
      assert.equal(choice.mode,0);
      assert.equal(choice.course.laps,1);
      assert.equal(choice.course.startS,0);
      assert.equal(choice.color,0xf4f4f4);
      assert.equal(await page.locator('[data-paint]').count(),1);
      assert.equal(await page.locator('#setup').getByText('单圈冲刺',{exact:true}).count(),0);
      assert.equal(await page.locator('#setup').getByText(/对手赛|对手数量|位.*AI/).count(),0);
      assert.equal(await page.locator('#setup').getByText('计时赛',{exact:true}).count(),1);
      assert.equal(await page.locator('#setup').getByText('自由驾驶',{exact:true}).count(),1);
      for (const vehicle of ['u9x','roadster']) {
        await page.locator(`[data-vehicle="${vehicle}"]`).click();
        const paintNames = await page.locator('[data-paint]').allTextContents();
        assert.deepEqual(paintNames, vehicle==='u9x'?['阿盖尔紫','赤霞丹朱','月曜银','极境森林']:['Ano White']);
        for (const name of paintNames) {
          await page.locator(`[data-paint="${name}"]`).click();
          const result = await page.evaluate(() => {
            const g=window.__nk;
            // Engine must enforce rules even for a stale setup supplied by a restart.
            g.startRace({...g.ui.choice,mode:1,bots:7,course:{...g.ui.choice.course,laps:5,startS:500,distance:5*g.track.length}});
            const r=g.race;
            const materials = new Set();
            r.player.model.root.traverse(o => {for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m&&/EXT_carpaint|Pearl body paint/.test(m.name))materials.add(m.color.getHex());});
            const out={mode:r.opts.mode,bots:r.opts.bots,count:r.racers.length,models:r.racers.map(x=>x.model.root.name),paint:r.player.look.color,materials:[...materials],course:r.opts.course,length:g.track.length};
            g.ui.onQuit();g.ui.show('setup');return out;
          });
          assert.equal(result.count,1);
          assert.equal(result.mode,0);
          assert.equal(result.bots,0);
          assert.ok(result.models.every(n=>n===(vehicle==='u9x'?'Yangwang U9 Xtreme':'Tesla Roadster 2')));
          assert.deepEqual(result.materials,[result.paint]);
          assert.equal(result.course.laps,1);
          assert.equal(result.course.startS,0);
          assert.equal(result.course.distance,result.length);
        }
        await page.locator('#setup .primary').click();
        await page.evaluate(() => {const g=window.__nk;g.advance(480,1/60,false);g.advance(1);});
        await page.screenshot({path:`checks/grid-${track}-${vehicle}.png`,timeout:120000});
        await page.evaluate(() => {window.__nk.ui.onQuit();window.__nk.ui.show('setup');});
      }
      const free = await page.evaluate(() => {
        const g=window.__nk;g.startRace({...g.ui.choice,mode:2,bots:7});
        const result={mode:g.race.opts.mode,count:g.race.racers.length,ghost:g.race.ghost};
        g.ui.onQuit();g.ui.show('setup');return result;
      });
      assert.deepEqual(free,{mode:2,count:1,ghost:null});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:`checks/setup-${track}-mobile.png`});
      await page.setViewportSize({width:1280,height:900});
      console.log(`${track}: saved settings, hidden lap option, solo modes, all paint materials PASS`);
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync('checks/setup-result.json',JSON.stringify({result:'PASS',errors,checks:'default street, chooser mobile, both circuits, legacy saves, both vehicles, solo grid, paint materials'},null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
