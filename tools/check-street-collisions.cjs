const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const origin=process.env.BASE_URL||'http://127.0.0.1:5178';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE|shader|WebGL/i.test(m.text()))errors.push(m.text());});
  await page.goto(origin+'/openracing/?manual&q=low',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.openracing,null,{timeout:180000});
  await page.locator('#go').click();
  const impact=await page.evaluate(()=>{
   const g=window.openracing,b=g.layout.buildings.find(b=>b.style===0&&Math.abs(b.z-60)<40&&b.h>25);
   g.teleport(-50,.75,b.z,-90);g.sim(.6,{});g.sim(3,{throttle:1});g.frame();
   return {inside:g.layout.world.overlapsSphere(g.camera.position,.3),distance:g.camera.position.distanceTo(g.vehicle.pos),mode:g.vehicle.mode,pos:g.vehicle.pos.toArray(),fan:g.vehicle.fanOn};
  });
  assert.equal(impact.inside,false);assert.ok(impact.distance>3);assert.equal(impact.mode,'ground');
  await page.screenshot({path:'checks/openracing/wall-camera-fixed.png',timeout:120000});
  const reverse=await page.evaluate(()=>{
   const g=window.openracing,x=g.vehicle.pos.x;g.sim(2,{throttle:-1,steer:.4});g.frame();
   return {moved:g.vehicle.pos.x-x,speed:g.vehicle.forwardSpeed,inside:g.layout.world.overlapsSphere(g.camera.position,.3)};
  });
  assert.ok(reverse.moved>1&&reverse.speed<0);assert.equal(reverse.inside,false);
  await page.evaluate(()=>{window.openracing.vehicle.fanOn=true;window.openracing.input.override=null;});
  await page.locator('#b-reset').click();
  await page.evaluate(()=>{const g=window.openracing;g.input.touch.reset=true;g.frame(.05);g.input.touch.reset=false;g.sim(.5,{});g.frame();});
  assert.equal(await page.evaluate(()=>window.openracing.vehicle.fanOn),false);
  assert.equal(await page.evaluate(()=>window.openracing.vehicle.mode),'ground');
  const detail=await page.evaluate(()=>{
   const g=window.openracing;
   g.teleport(-420,.75,0);g.pause(true);g.hud(false);g.camLocal([6,4,-10],[0,1,5],55);
   // A stationary line-up makes each civilian silhouette and its details reviewable.
   g.traffic.cars.slice(0,5).forEach((c,i)=>{c.x=-420+i*4;c.z=10;c.yaw=0;c.v=0;c.state='drive';});
   g.frame();
   return {npcBatches:g.scene.children.flatMap(o=>o.children).filter(o=>o.name.startsWith('NPC')).length,
    streetBatches:g.scene.getObjectByName('Street curbs storefronts and furniture').children.length,
    calls:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles};
  });
  assert.equal(detail.npcBatches,15);assert.equal(detail.streetBatches,5);
  assert.ok(detail.triangles<2100000,`street geometry budget exceeded: ${detail.triangles}`);
  await page.screenshot({path:'checks/openracing/traffic-street-detail.png',timeout:120000});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.evaluate(()=>{const g=window.openracing;g.camLocal(null);g.hud(true);g.pause(false);g.sim(.1,{});g.frame();});
  await page.screenshot({path:'checks/openracing/street-detail-mobile.png',timeout:120000});
  assert.deepEqual(errors,[]);
  const result={result:'PASS',impact,reverse,detail,errors};
  fs.writeFileSync('checks/openracing/collision-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
