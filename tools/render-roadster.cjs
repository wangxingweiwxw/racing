const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const path=require('node:path');
const out=path.resolve('checks/roadster-video',process.argv[2]||'latest');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:960,height:640}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto((process.env.BASE_URL||'http://127.0.0.1:5173')+'/tools/roadster-preview.html');
  await page.waitForFunction(()=>window.__roadsterReview,null,{timeout:60000});
  await page.locator('nav').evaluate(e=>e.style.display='none');fs.mkdirSync(out,{recursive:true});
  for(const name of ['rear','quarter','side','front']){
   await page.evaluate(n=>window.__roadsterReview.view(n),name);await page.screenshot({path:path.join(out,name+'.png')});
  }
  const stats=await page.evaluate(()=>{const g=window.__roadsterReview;return {drawCalls:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles};});
  fs.writeFileSync(path.join(out,'render.json'),JSON.stringify({errors,...stats},null,2));
  console.log(JSON.stringify({out,errors,...stats}));if(errors.length)process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
