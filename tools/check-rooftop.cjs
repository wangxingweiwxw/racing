const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE|shader|WebGL/i.test(m.text()))errors.push(m.text());});
  fs.mkdirSync('checks/openracing',{recursive:true});
  await page.goto((process.env.BASE_URL||'http://127.0.0.1:5178')+'/openracing/?manual&q=low',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.openracing,null,{timeout:180000});await page.locator('#go').click();
  const climb=await page.evaluate(()=>{
   const g=window.openracing,b=g.layout.buildings.find(b=>b.style===0&&Math.abs(b.z-60)<40&&b.h>25);
   g.teleport(-50,.75,b.z,-90);g.vehicle.air=600;g.sim(.2,{});g.sim(.05,{fan:true,throttle:1});
   for(let i=0;i<160&&g.vehicle.mode!=='wall';i++)g.sim(.025,{throttle:1});
   g.pause(true);g.frame(.05);return {mode:g.vehicle.mode,height:g.vehicle.pos.y,up:g.vehicle.up().toArray(),cameraInside:g.layout.world.overlapsSphere(g.camera.position,.3)};
  });
  assert.equal(climb.mode,'wall');assert.equal(climb.cameraInside,false);
  await page.screenshot({path:'checks/openracing/climb-facade.png',timeout:120000});
  const roof=await page.evaluate(()=>{
   const g=window.openracing;g.pause(false);let sawRoof=false;
   for(let i=0;i<400&&!g.vehicle.roofFlight;i++){g.sim(.025,{throttle:1});sawRoof ||= g.vehicle.mode==='ground'&&g.vehicle.pos.y>10;}
   g.sim(.3,{});g.pause(true);g.frame(.05);return {sawRoof,flight:g.vehicle.roofFlight,fan:g.vehicle.fanOn,roll:g.vehicle.stuntRoll,up:g.vehicle.up().y};
  });
  assert.ok(roof.sawRoof&&roof.flight&&!roof.fan&&Math.abs(roof.roll)>.2,JSON.stringify(roof));
  await page.screenshot({path:'checks/openracing/roof-roll.png',timeout:120000});
  const flare=await page.evaluate(()=>{
   const g=window.openracing;g.pause(false);g.teleport(-420,120,0);g.vehicle.air=600;g.vehicle.vel.y=-38;
   for(let i=0;i<400&&!g.vehicle.landingAssist;i++)g.sim(1/60,{});
   g.sim(.1,{});g.pause(true);g.camLocal([6,1.5,7]);for(let i=0;i<4;i++)g.frame(.05);
   return {assist:g.vehicle.landingAssist,thrust:g.vehicle.downThrust,height:g.vehicle.pos.y,plumes:g.car.body.children.filter(o=>o.name==='Cold gas down'&&o.visible).length};
  });
  assert.ok(flare.assist&&flare.thrust>.1&&flare.height>4&&flare.plumes===4,JSON.stringify(flare));
  await page.screenshot({path:'checks/openracing/roof-landing-jets.png',timeout:120000});
  const landed=await page.evaluate(()=>{
   const g=window.openracing;g.pause(false);let impact=0;
   for(let i=0;i<1800&&!g.vehicle.grounded;i++){impact=-g.vehicle.vel.y;g.sim(1/120,{});}
   g.sim(.5,{});g.frame();return {impact,mode:g.vehicle.mode,up:g.vehicle.up().y,y:g.vehicle.pos.y};
  });
  assert.ok(landed.mode==='ground'&&landed.impact<3.5&&landed.up>.99,JSON.stringify(landed));
  const brake=await page.evaluate(()=>{
   const g=window.openracing;g.teleport(-420,.75,0);g.sim(.2,{});g.vehicle.air=600;g.vehicle.vel.x=70;
   g.sim(.2,{throttle:-1});g.pause(true);g.camLocal([5,2.4,6]);for(let i=0;i<4;i++)g.frame(.05);
   return {thrust:g.vehicle.brakeThrust,air:g.vehicle.air,plumes:g.car.body.children.filter(o=>o.name==='Cold gas brake'&&o.visible).length,sockets:g.car.sockets.filter(s=>s.kind==='brake').map(s=>({z:s.pos.z,dz:s.dir.z})),mode:document.querySelector('#mode').textContent};
  });
  assert.ok(brake.thrust>.5&&brake.air<600&&brake.plumes===2,JSON.stringify(brake));assert.ok(brake.sockets.every(s=>s.z>2.36&&s.dz===1));
  assert.equal(brake.mode,'前喷气制动');
  await page.screenshot({path:'checks/openracing/front-brake-jets.png',timeout:120000});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{const g=window.openracing;g.camLocal(null);g.frame();});
  await page.screenshot({path:'checks/openracing/brake-mobile.png',timeout:120000});
  assert.deepEqual(errors,[]);const result={result:'PASS',climb,roof,flare,landed,brake,errors};
  fs.writeFileSync('checks/openracing/rooftop-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
