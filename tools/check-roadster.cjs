const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = process.env.BASE_URL || 'http://127.0.0.1:5173';
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());
    await page.goto(`${origin}/?track=shanghai&manual`,{waitUntil:'domcontentloaded'});
    try { await page.waitForFunction(()=>window.__nk,null,{timeout:180000}); }
    catch(e) { console.error('BOOT',await page.locator('body').innerText(),errors); throw e; }
    console.log('Game loaded');
    fs.mkdirSync('checks',{recursive:true});
    await page.locator('#title .primary').click();
    assert.equal(await page.locator('[data-assist="true"]').getAttribute('aria-pressed'),'true');
    await page.locator('[data-assist="false"]').click();
    assert.equal(await page.evaluate(()=>window.__nk.ui.choice.assist),false);
    await page.locator('[data-assist="true"]').click();
    await page.locator('[data-vehicle="roadster"]').click();
    assert.equal(await page.locator('[data-vehicle="roadster"]').getAttribute('aria-pressed'),'true');
    await page.screenshot({path:'checks/roadster-selection.png',timeout:120000});
    await page.evaluate(()=>{const g=window.__nk;g.ui.choice.mode=2;g.ui.choice.color=0xf4f4f4;});
    await page.locator('#setup .primary').click();
    await page.evaluate(()=>{const g=window.__nk;g.advance(480,1/60,false);g.advance(1);});
    assert.equal(await page.evaluate(()=>window.__nk.race.player.kart.flightEnabled),true);
    assert.ok(Math.abs(await page.evaluate(()=>window.__nk.race.player.kart.maxSpeed*3.6)-370.15)<1e-6);
    assert.equal(await page.locator('.drive-lift').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.__nk.race.player.model.wheels.length),4);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('nk-choice')).assist),true);
    assert.match(await page.locator('#assist-status').innerText(),/弯道辅助/);
    await page.screenshot({path:'checks/roadster-rear.png',timeout:120000});
    const view=async(x,y,z)=>page.evaluate(([x,y,z])=>{const g=window.__nk,root=g.race.player.model.root;const p=root.localToWorld(g.camera.position.clone().set(x,y,z));const target=root.localToWorld(g.camera.position.clone().set(0,.65,0));g.view(p.toArray(),target.toArray());g.advance(1);},[x,y,z]);
    await view(4,2.4,6);
    await page.screenshot({path:'checks/roadster-front.png',timeout:120000});
    // Context action via real keyboard: parked doors open, throttle closes them.
    await page.keyboard.down('x'); await page.evaluate(()=>window.__nk.advance(90,1/60,false)); await page.keyboard.up('x');
    assert.equal(await page.evaluate(()=>window.__nk.race.player.kart.showcase),true);
    await view(4,2.4,6); await page.screenshot({path:'checks/roadster-showcase.png',timeout:120000});
    await page.evaluate(()=>{const g=window.__nk;g.view(null);g.race.player.kart.placeAt(120,0,120);g.advance(1,1/60,false);});
    await page.keyboard.down('w'); await page.keyboard.down('Space');
    await page.evaluate(()=>window.__nk.advance(120,1/60,false));
    const flying=await page.evaluate(()=>{const k=window.__nk.race.player.kart;return {height:k.flightHeight,charge:k.flightCharge,speed:k.speed,active:k.thrusterActive};});
    assert.ok(flying.height>2.7 && flying.height<4 && flying.speed>3 && flying.active,JSON.stringify(flying));
    await view(4,1.8,-6);
    assert.match(await page.locator('#assist-status').innerText(),/空中转向辅助/);
    await page.screenshot({path:'checks/roadster-flight.png',timeout:120000});
    assert.equal(await page.evaluate(()=>window.__nk.race.player.kart.showcase),false);
    const beforeRoll=await page.evaluate(()=>window.__nk.race.player.kart.flightCharge);
    await page.keyboard.down('x');await page.evaluate(()=>window.__nk.advance(25,1/60,false));await page.keyboard.up('x');
    assert.ok(await page.evaluate(()=>window.__nk.race.player.kart.stuntActive));
    assert.ok(await page.evaluate(()=>window.__nk.race.player.kart.flightCharge)<beforeRoll-.15);
    await view(4,1.8,-6);await page.screenshot({path:'checks/roadster-roll.png',timeout:120000});
    await page.evaluate(()=>window.__nk.advance(40,1/60,false));
    assert.equal(await page.evaluate(()=>window.__nk.race.player.kart.stuntRoll),0);
    await page.keyboard.up('w');await page.keyboard.up('Space');
    await page.evaluate(()=>window.__nk.advance(30));
    assert.equal(await page.evaluate(()=>window.__nk.race.player.kart.thrusterActive),false);
    assert.match(await page.locator('#assist-status').innerText(),/空中转向辅助/);
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
    assert.equal(await page.evaluate(()=>window.__nk.race.racers.length),4);
    assert.equal(await page.evaluate(()=>window.__nk.race.player.kart.flightEnabled),false);
    assert.ok(Math.abs(await page.evaluate(()=>window.__nk.race.player.kart.maxSpeed*3.6)-496.22)<1e-6);
    assert.notEqual(await page.evaluate(()=>window.__nk.race.bestTime()),19);
    assert.equal(await page.locator('.drive-lift').isVisible(),false);
    assert.equal(await page.locator('.drive-action').isVisible(),false);
    // Real keyboard input passes through UserBrain and triggers predictive braking.
    await page.evaluate(()=>{
      const g=window.__nk,k=g.race.player.kart,tr=g.track;
      const i=tr.curv.reduce((best,c,i)=>Math.abs(c)>Math.abs(tr.curv[best])?i:best,0);
      k.placeAt(tr.wrapS(i*tr.step-80),0,0);
      k.vel.set(Math.sin(k.heading)*85,0,-Math.cos(k.heading)*85);
    });
    await page.keyboard.down('w');await page.evaluate(()=>window.__nk.advance(2));
    assert.ok(await page.evaluate(()=>window.__nk.race.player.brain.input.throttle<0));
    assert.match(await page.locator('#assist-status').innerText(),/辅助制动/);
    await page.screenshot({path:'checks/assist-braking.png',timeout:120000});
    await page.keyboard.up('w');
    const assistedKey=await page.evaluate(()=>window.__nk.race.recordId);
    await page.evaluate(()=>{const g=window.__nk;g.startRace({...g.ui.choice,vehicle:'u9x',mode:2,assist:false});g.advance(480,1/60,false);g.advance(1);});
    assert.equal(await page.evaluate(()=>window.__nk.race.player.brain.assist),undefined);
    assert.notEqual(await page.evaluate(()=>window.__nk.race.recordId),assistedKey);
    assert.equal(await page.locator('#assist-status').innerText(),'手动驾驶');
    await page.evaluate(()=>{const g=window.__nk;g.startRace({...g.ui.choice,vehicle:'roadster',mode:1,bots:7});g.advance(480,1/60,false);g.advance(1);});
    assert.equal(await page.evaluate(()=>window.__nk.race.racers.length),4);
    for(const [width,height] of [[844,390],[390,844],[320,640]]) {
      await page.setViewportSize({width,height});
      // Wait for the resize event before manually rendering, otherwise canvas resizing clears the frame.
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.evaluate(()=>window.__nk.advance(2));
      const layout=await page.evaluate(()=>['.drive-action','.drive-lift','.flight-panel','.drive-pedal','.drive-brake','.steering-pad','.speedo','[aria-label="回到检查点"]'].filter(s=>document.querySelector(s)).map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {s,x:r.x,y:r.y,right:r.right,bottom:r.bottom,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};}));
      assert.ok(layout.every(r=>r.inside),JSON.stringify(layout));
      const bottle = layout.find(r=>r.s==='.flight-panel');
      assert.ok(bottle.right-bottle.x<=50 && bottle.bottom-bottle.y<=72,'compact bottle footprint');
      assert.ok(bottle.right<=width*.2,'bottle must stay out of the central car view');
      assert.equal(await page.locator('.flight-heading').isVisible(),false);
      assert.equal(await page.locator('#flight-bottle').isVisible(),true);
      await page.evaluate(()=>{const g=window.__nk;g.race.player.kart.flightCharge=.18;g.advance(1);});
      assert.equal(await page.locator('#flight-bottle').getAttribute('aria-valuenow'),'18');
      assert.equal(await page.locator('#flight-percent').innerText(),'18%');
      assert.ok(await page.locator('#flight-panel').evaluate(el=>el.classList.contains('low')));
      for(let a=0;a<layout.length;a++)for(let b=a+1;b<layout.length;b++) {
        const x=layout[a],y=layout[b];assert.ok(x.right<=y.x||y.right<=x.x||x.bottom<=y.y||y.bottom<=x.y,`Overlap: ${JSON.stringify([x,y])}`);
      }
      await page.screenshot({path:`checks/roadster-${width}.png`,timeout:120000});
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',flying,browserErrors:errors,checks:'selection, assist toggle, predictive braking, manual mode, drive, flight, landing, pointer, pause, records, restart, same-model grid, mobile'},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
