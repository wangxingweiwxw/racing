const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const origin=process.env.BASE_URL||'http://127.0.0.1:5178';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));fs.mkdirSync('checks/openracing',{recursive:true});
  await page.goto(origin+'/openracing/?manual&q=low',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.openracing,null,{timeout:120000});
  assert.match(await page.title(),/开放街道 openracing/);console.log('Openracing loaded');
  await page.locator('#go').click();
  await page.evaluate(()=>{const g=window.openracing;g.sim(.5,{});for(let i=0;i<4;i++)g.frame(.05);});
  assert.equal(await page.evaluate(()=>window.openracing.vehicle.mode),'ground');
  assert.equal(await page.evaluate(()=>window.openracing.car.wheels.length),4);
  assert.ok(await page.evaluate(()=>!!window.openracing.car.body.getObjectByName('Driver ivory seat')));
  await page.screenshot({path:'checks/openracing/street.png',timeout:120000});
  await page.evaluate(()=>{const g=window.openracing;g.sim(1,{action:true});g.car.animate(2,g.vehicle,0);g.camLocal([5,2.5,6]);g.frame();});
  assert.ok(await page.evaluate(()=>window.openracing.vehicle.showcase));
  await page.screenshot({path:'checks/openracing/showcase.png',timeout:120000});
  await page.evaluate(()=>{const g=window.openracing;g.sim(1,{hop:true,throttle:1,action:false});g.car.animate(2,g.vehicle,0);g.camLocal(null);for(let i=0;i<4;i++)g.frame(.05);});
  const flight=await page.evaluate(()=>{const v=window.openracing.vehicle;return {y:v.pos.y,air:v.air,up:v.up().y,mode:v.mode};});
  assert.ok(flight.y>3&&flight.up>.95&&flight.mode==='air',JSON.stringify(flight));
  await page.screenshot({path:'checks/openracing/takeoff.png',timeout:120000});
  await page.evaluate(()=>{const g=window.openracing;g.sim(.4,{hop:true,action:true});g.frame();});
  assert.ok(await page.evaluate(()=>window.openracing.vehicle.stuntActive));
  await page.screenshot({path:'checks/openracing/roll.png',timeout:120000});
  await page.evaluate(()=>{const g=window.openracing;g.sim(4,{hop:false,action:false,throttle:0});g.frame();});
  assert.equal(await page.evaluate(()=>window.openracing.vehicle.mode),'ground');
  assert.equal(await page.evaluate(()=>window.openracing.vehicle.stuntRoll),0);
  const landing=await page.evaluate(()=>{
   const g=window.openracing;g.teleport(-420,14,0);g.vehicle.q.setFromAxisAngle(g.vehicle.pos.clone().set(1,0,0),.6);g.vehicle.vel.y=-20;
   g.sim(4,{});g.camLocal([5,1.6,4]);g.frame(.05);g.car.root.updateMatrixWorld(true);
   return {up:g.vehicle.up().y,tyres:g.car.wheels.map(w=>w.pivot.getWorldPosition(g.vehicle.pos.clone()).y-.37)};
  });
  assert.ok(landing.up>.9999&&landing.tyres.every(y=>y>=-.035),JSON.stringify(landing));
  await page.screenshot({path:'checks/openracing/landing-fixed.png',timeout:120000});
  const river=await page.evaluate(()=>{
   const g=window.openracing,results=[];g.camLocal(null);
   for(const heldLift of [false,true]){
    g.teleport(-75,.75,0);g.sim(.5,{});g.vehicle.air=150;g.vehicle.vel.x=15;
    let assisted=false,landed=false;
    for(let i=0;i<260;i++){const across=g.vehicle.pos.x>315;g.sim(.05,{throttle:across?-1:1,hop:heldLift&&!across});assisted ||= !!g.vehicle.riverAssist;if(across&&g.vehicle.grounded){landed=true;break;}}
    g.frame(.05);results.push({heldLift,assisted,landed,pos:g.vehicle.pos.toArray(),ships:g.cruises.ships.length});
   }
   return results;
  });
  assert.ok(river.every(r=>r.assisted&&r.landed&&r.ships===3),JSON.stringify(river));
  await page.evaluate(()=>{const g=window.openracing;g.teleport(140,20,0);g.pause(true);g.camLocal([95,55,-140],[0,-10,130],55);g.frame();});
  await page.screenshot({path:'checks/openracing/river-cruises.png',timeout:120000});
  await page.evaluate(()=>{const g=window.openracing;const s=g.cruises.ships[2];g.teleport(s.root.position.x,10,s.root.position.z);g.car.root.visible=false;g.hud(false);g.camLocal([38,18,45],[0,-8,0],50);g.frame();});
  await page.screenshot({path:'checks/openracing/cruise-detail.png',timeout:120000});
  await page.evaluate(()=>{const g=window.openracing;g.car.root.visible=true;g.hud(true);g.teleport(-420,.75,0);g.camLocal(null);g.pause(false);g.sim(.5,{});g.frame();});
  // Pause/help must freeze simulation and clear held controls.
  await page.evaluate(()=>{const g=window.openracing;g.input.override=null;});
  await page.keyboard.down('w');await page.evaluate(()=>window.openracing.frame());
  await page.locator('#b-help').click();
  const pausedPos=await page.evaluate(()=>window.openracing.vehicle.pos.toArray());
  await page.evaluate(()=>{for(let i=0;i<5;i++)window.openracing.frame(.05);});
  assert.deepEqual(await page.evaluate(()=>window.openracing.vehicle.pos.toArray()),pausedPos);
  await page.keyboard.up('w');await page.locator('#go').click();
  for(const [width,height] of [[844,390],[390,844],[320,640]]){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.evaluate(()=>{const g=window.openracing;g.sim(.1,{});for(let i=0;i<4;i++)g.frame(.05);g.input.override=null;});
   const boxes=await page.evaluate(()=>[...document.querySelectorAll('#street-touch button,#gas-bottle,.speedo,#btns,#objective,#notice')].map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.control||el.id||el.className,x:r.x,y:r.y,right:r.right,bottom:r.bottom,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};}));
   assert.ok(boxes.every(b=>b.inside),JSON.stringify(boxes));
   for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++){const x=boxes[a],y=boxes[b];assert.ok(x.right<=y.x||y.right<=x.x||x.bottom<=y.y||y.bottom<=x.y,`Overlap ${JSON.stringify([x,y])}`);}
   const gas=boxes.find(b=>b.id==='gas-bottle');assert.ok(gas.right-gas.x<=40&&gas.bottom-gas.y<=64);
   await page.screenshot({path:`checks/openracing/mobile-${width}.png`,timeout:120000});
  }
  // Real multi-touch: throttle + lift, followed by release and focus loss.
  const client=await page.context().newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  const points=await page.evaluate(()=>['throttle','hop'].map((key,id)=>{const r=document.querySelector(`[data-control=${key}]`).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,id};}));
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
  await page.evaluate(()=>window.openracing.frame());
  assert.deepEqual(await page.evaluate(()=>({throttle:window.openracing.input.touch.throttle,hop:window.openracing.input.touch.hop})),{throttle:1,hop:true});
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await page.evaluate(()=>window.openracing.input.touch.hop),false);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal(await page.evaluate(()=>window.openracing.input.touch.throttle),0);
  assert.deepEqual(errors,[]);
  const result={result:'PASS',flight,landing,river,errors,checks:'shared model, showcase, takeoff, roll, tilted landing clearance, low-fuel river crossing, cruise fleet, pause, three mobile layouts, multi-touch, release'};
  fs.writeFileSync('checks/openracing/browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
