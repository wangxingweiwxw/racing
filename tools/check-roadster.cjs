const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = process.env.BASE_URL || 'http://127.0.0.1:5173';
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${origin}/?track=shanghai&manual`,{waitUntil:'domcontentloaded'});
    try { await page.waitForFunction(()=>window.__nk,null,{timeout:180000}); }
    catch(e) { console.error('BOOT',await page.locator('body').innerText(),errors); throw e; }
    console.log('Game loaded');
    fs.mkdirSync('checks',{recursive:true});
    await page.locator('#title .primary').click();
    await page.locator('[data-vehicle="roadster"]').click();
    assert.equal(await page.locator('[data-vehicle="roadster"]').getAttribute('aria-pressed'),'true');
    await page.screenshot({path:'checks/roadster-selection.png'});
    await page.evaluate(()=>{const g=window.__nk;g.ui.choice.mode=2;g.ui.choice.color=0xf4f4f4;});
    await page.locator('#setup .primary').click();
    await page.evaluate(()=>{const g=window.__nk;g.advance(480,1/60,false);g.advance(1);});
    assert.equal(await page.evaluate(()=>window.__nk.race.player.kart.flightEnabled),true);
    assert.ok(Math.abs(await page.evaluate(()=>window.__nk.race.player.kart.maxSpeed*3.6)-370.15)<1e-6);
    assert.equal(await page.locator('.drive-lift').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.__nk.race.player.model.wheels.length),4);
    await page.screenshot({path:'checks/roadster-rear.png',timeout:120000});
    const view=async(x,y,z)=>page.evaluate(([x,y,z])=>{const g=window.__nk,root=g.race.player.model.root;const p=root.localToWorld(g.camera.position.clone().set(x,y,z));const target=root.localToWorld(g.camera.position.clone().set(0,.65,0));g.view(p.toArray(),target.toArray());g.advance(1);},[x,y,z]);
    await view(4,2.4,6);
    await page.screenshot({path:'checks/roadster-front.png',timeout:120000});
    await page.evaluate(()=>{const g=window.__nk;g.view(null);g.race.player.kart.placeAt(120,0,120);g.advance(1,1/60,false);});
    await page.keyboard.down('w'); await page.keyboard.down('Space');
    await page.evaluate(()=>window.__nk.advance(120,1/60,false));
    const flying=await page.evaluate(()=>{const k=window.__nk.race.player.kart;return {height:k.flightHeight,charge:k.flightCharge,speed:k.speed,active:k.thrusterActive};});
    assert.ok(flying.height>2.7 && flying.height<4 && flying.speed>3 && flying.active,JSON.stringify(flying));
    await view(4,1.8,-6);
    await page.screenshot({path:'checks/roadster-flight.png',timeout:120000});
    await page.keyboard.up('w');await page.keyboard.up('Space');
    await page.evaluate(()=>{const g=window.__nk;g.view(null);g.advance(240,1/60,false);});
    assert.equal(await page.evaluate(()=>window.__nk.race.player.kart.grounded),true);
    // Real pointer press, followed by pause: both controls release safely.
    await page.locator('.drive-lift').hover();await page.mouse.down();
    await page.evaluate(()=>window.__nk.advance(60,1/60,false));await page.mouse.up();
    assert.equal(await page.evaluate(()=>window.__nk.controls.touch.lift),false);
    await page.locator('[aria-label="暂停与设置"]').click();
    const before=await page.evaluate(()=>window.__nk.race.player.kart.flightCharge);
    await page.evaluate(()=>window.__nk.advance(120,1/60,false));
    assert.equal(await page.evaluate(()=>window.__nk.race.player.kart.flightCharge),before);
    await page.evaluate(()=>{window.__nk.ui.onResume();window.__nk.advance(240,1/60,false);});
    // Verify independent records and original U9 still works after disposal.
    await page.evaluate(()=>{const g=window.__nk;localStorage.setItem(`nk-best-${g.race.recordId}`,'19');});
    await page.evaluate(()=>{const g=window.__nk;g.startRace({...g.ui.choice,vehicle:'u9x',mode:1,bots:7});g.advance(480,1/60,false);});
    assert.equal(await page.evaluate(()=>window.__nk.race.racers.length),8);
    assert.equal(await page.evaluate(()=>window.__nk.race.player.kart.flightEnabled),false);
    assert.ok(Math.abs(await page.evaluate(()=>window.__nk.race.player.kart.maxSpeed*3.6)-496.22)<1e-6);
    assert.notEqual(await page.evaluate(()=>window.__nk.race.bestTime()),19);
    assert.equal(await page.locator('.drive-lift').isVisible(),false);
    await page.evaluate(()=>{const g=window.__nk;g.startRace({...g.ui.choice,vehicle:'roadster',mode:1,bots:7});g.advance(480,1/60,false);g.advance(1);});
    assert.equal(await page.evaluate(()=>window.__nk.race.racers.length),8);
    for(const [width,height] of [[844,390],[390,844],[320,640]]) {
      await page.setViewportSize({width,height});await page.evaluate(()=>window.__nk.advance(1));
      const layout=await page.evaluate(()=>['.drive-lift','.flight-panel','.drive-pedal','.drive-brake','.steering-pad'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {s,x:r.x,y:r.y,right:r.right,bottom:r.bottom,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};}));
      assert.ok(layout.every(r=>r.inside),JSON.stringify(layout));
      for(let a=0;a<layout.length;a++)for(let b=a+1;b<layout.length;b++) {
        const x=layout[a],y=layout[b];assert.ok(x.right<=y.x||y.right<=x.x||x.bottom<=y.y||y.bottom<=x.y,`Overlap: ${JSON.stringify([x,y])}`);
      }
      await page.screenshot({path:`checks/roadster-${width}.png`,timeout:120000});
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',flying,browserErrors:errors,checks:'selection, drive, flight, landing, pointer, pause, records, restart, mixed grid, mobile'},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
