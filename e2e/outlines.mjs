import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const url=process.argv[2]??'http://127.0.0.1:5199';
const out=process.argv[3]??'/tmp/maleghast-outlines';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--mute-audio']});
try {
 const page=await browser.newPage({viewport:{width:1400,height:1000}});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(url);
 const checks=await page.evaluate(async()=>{
  const THREE=await import('/node_modules/.vite/deps/three.js');
  const {outlinedUnit}=await import('/src/client/unit-sprite.ts');
  const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true,antialias:false});
  renderer.setSize(200,200);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=3;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  const c=canvas.getContext('2d');
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const checks=[];
  for(const shape of ['rectangle','cutout']) for(const team of [0x4fb3bf,0xe8622c]) for(const ratio of [1,2]) for(const zoom of [.6,1,1.5]) {
   c.clearRect(0,0,64,64);c.fillStyle='#dcc864';
   if(shape==='rectangle')c.fillRect(0,0,64,64);
   else {c.beginPath();c.arc(32,32,20,0,Math.PI*2);c.fill()}
   texture.needsUpdate=true;
   renderer.setPixelRatio(ratio);camera.zoom=zoom;camera.updateProjectionMatrix();
   const sprite=outlinedUnit(texture,1,team,false);sprite.position.y=-.5;scene.add(sprite);
   renderer.render(scene,camera);
   const n=200*ratio, bytes=new Uint8Array(n*n*4),gl=renderer.getContext();
   gl.readPixels(0,0,n,n,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
   const rgb=[team>>16,(team>>8)&255,team&255];
   const pixel=(x,y)=>Array.from(bytes.slice((y*n+x)*4,(y*n+x)*4+3));
   const colored=(x,y)=>pixel(x,y).every((v,i)=>Math.abs(v-rgb[i])<4);
   let left=0,right=0,top=0,bottom=0;
   for(let x=0;x<n;x++)if(colored(x,n/2)){if(x<n/2)left++;else right++}
   for(let y=0;y<n;y++)if(colored(n/2,y)){if(y<n/2)bottom++;else top++}
   checks.push({shape,team,ratio,zoom,left,right,top,bottom,center:pixel(n/2,n/2),corner:pixel(Math.round(n*.25),Math.round(n*.25))});
   scene.remove(sprite);sprite.material.dispose();
  }
  // Reuse one sprite after its source changes aspect, as happens on image load.
  const dim=outlinedUnit(texture,1,0x4fb3bf,true);dim.position.y=-.5;scene.add(dim);
  camera.zoom=.6;camera.updateProjectionMatrix();renderer.render(scene,camera);
  const initialAspect=dim.scale.x/dim.scale.y;
  canvas.width=128;canvas.height=64;c.fillStyle='#dcc864';c.fillRect(0,0,128,64);
  texture.needsUpdate=true;renderer.render(scene,camera);
  const gl=renderer.getContext(), bytes=new Uint8Array(4);
  gl.readPixels(200,200,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
  checks.push({initialAspect,dimCenter:Array.from(bytes),aspect:dim.scale.x/dim.scale.y});
  dim.material.dispose();texture.dispose();renderer.dispose();
  return checks;
 });
 for(const c of checks.slice(0,-1)) {
  for(const direction of ['left','right','top','bottom']) assert.ok(Math.abs(c[direction]-2*c.ratio)<=1,JSON.stringify(c));
  assert.ok(c.center[0]>200&&c.center[1]>180,JSON.stringify(c));
  if(c.shape==='cutout'&&c.zoom<=1)assert.deepEqual(c.corner,[0,0,0]);
 }
 assert.equal(checks.at(-1).initialAspect,1);
 assert.ok(checks.at(-1).dimCenter[0]<180);
 assert.ok(checks.at(-1).aspect>1.8);
 await page.evaluate(async()=>{
  const {BoardView}=await import('/src/client/board.ts');
  const {battle,at}=await import('/tests/play.ts');
  document.body.innerHTML='<div id="stage" style="width:1400px;height:1000px"></div>';
  const view=new BoardView(document.querySelector('#stage'));
  const g=battle([{kind:'gunwight',at:at(3,4),side:0},{kind:'painGhoul',at:at(4,3),side:1}]);
  g.units.find(u=>u.kind==='gunwight').done=true;
  window.outlineTest={view,g};view.show(g,0);
 });
 await page.waitForFunction(()=>{
  const {view}=window.outlineTest;
  return view.terrain.children.length>0&&view.units.children.every(g=>g.getObjectByName('team-outlined-unit')?.material.map.image?.width);
 });
 await page.screenshot({path:out+'/team-outlines.png'});
 await page.evaluate(()=>window.outlineTest.view.turn(1));
 await page.screenshot({path:out+'/team-outlines-turned.png'});
 assert.deepEqual(errors,[]);
 console.log(`Outlined sprites passed: ${checks.length-1} pixel checks across teams, zoom, DPI and transparency; dimming, aspect fitting and live board views.`);
} finally {await browser.close()}
