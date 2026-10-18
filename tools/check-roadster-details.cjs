const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:750}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE|WebGL|shader/i.test(m.text()))errors.push(m.text());});
  const base=process.env.BASE_URL||'http://127.0.0.1:5190';
  await page.goto(base+'/tools/roadster-preview.html');await page.waitForFunction(()=>window.__roadsterReview,null,{timeout:120000});
  const circuit=await page.evaluate(()=>{
   const g=window.__roadsterReview,wing=g.model.root.getObjectByName('Active rear airbrake');
   const poses=[];
   for(const [speed,airBrake] of [[0,0],[60,0],[60,1],[0,0]]){
    for(let i=0;i<180;i++)g.model.animate(1/60,speed,0,0,0,0,false,{airBrake});
    poses.push({y:wing.position.y,angle:wing.rotation.x});
   }
   g.view('quarter');return poses;
  });
  assert.ok(circuit[1].y>circuit[0].y+.4&&circuit[1].angle<.01);assert.ok(circuit[2].angle>.6);assert.ok(Math.abs(circuit[3].y-circuit[0].y)<.001);
  await page.goto(base+'/openracing/?manual&q=low');await page.waitForFunction(()=>window.openracing,null,{timeout:180000});await page.locator('#go').click();
  const street=await page.evaluate(()=>{
   const g=window.openracing,w=g.car.body.getObjectByName('Active rear airbrake'),poses=[];
   for(const [speedKmh,braking] of [[0,false],[220,false],[220,true],[0,false]]){
    for(let i=0;i<180;i++)g.car.animate(1/60,{steer:0,braking,speedKmh,showcase:false,stuntRoll:0},0);
    poses.push({y:w.position.y,angle:w.rotation.x});
   }
   g.vehicle.vel.x=65;g.sim(.15,{throttle:-1});g.camLocal([5,2.5,-6]);g.pause(true);for(let i=0;i<4;i++)g.frame(.05);
   return {poses,rearSockets:g.car.sockets.filter(s=>s.kind==='main').length,frontSockets:g.car.sockets.filter(s=>s.kind==='brake').length,lights:!!g.car.body.getObjectByName('Front LED light assemblies')};
  });
  assert.ok(street.poses[1].y>street.poses[0].y+.4&&street.poses[1].angle<.01);assert.ok(street.poses[2].angle>.6);assert.ok(Math.abs(street.poses[3].y-street.poses[0].y)<.001);
  assert.equal(street.rearSockets,4);assert.equal(street.frontSockets,2);assert.ok(street.lights);
  fs.mkdirSync('checks/roadster-v4',{recursive:true});await page.screenshot({path:'checks/roadster-v4/street-airbrake.png',timeout:120000});
  assert.deepEqual(errors,[]);const result={result:'PASS',circuit,street,errors};fs.writeFileSync('checks/roadster-v4/browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
