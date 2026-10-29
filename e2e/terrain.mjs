import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const URL = process.argv[2] ?? 'http://127.0.0.1:5199';
const OUT = process.argv[3] ?? '/tmp/maleghast-terrain';
await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
try {
 const page = await browser.newPage({viewport:{width:1400,height:1000}});
 const errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.goto(URL);
 await page.evaluate(async()=>{
  const {BoardView}=await import('/src/client/board.ts');
  const {emptyBoard}=await import('/src/rules/board.ts');
  const {battle,at}=await import('/tests/play.ts');
  const {hurtWall}=await import('/src/rules/effects.ts');
  document.body.innerHTML='<div id="art-stage" style="width:1400px;height:1000px"></div>';
  document.body.style.margin='0';
  const view=new BoardView(document.querySelector('#art-stage'));
  const g=battle([{kind:'gunwight',at:at(4,4),side:0}]);
  g.board.walls[27]=2;
  g.board.terrain[18]={elevated:true};g.board.terrain[19]={stairs:true};
  g.board.terrain[20]={hazard:true};g.board.terrain[21]={adverse:true};
  for(const [i,n] of [[34,1],[35,2],[36,3],[18,2],[19,1]]) g.board.corpses[i]=n;
  window.artTest={view,g,hurtWall,emptyBoard};view.show(g,0);
 });
 const wait=()=>page.waitForFunction(()=>{
  const {view}=window.artTest;
  return view.terrain.getObjectByName(`frame_${view.game.board.size}`)&&view.backdrop.children.length;
 });
 await wait();
 const placement=await page.evaluate(()=>{
  const {view}=window.artTest;
  const o=view.terrain.children.find(o=>o.getObjectByName('corpse_1')&&o.userData.cell?.row===2);
  return {y:o.position.y,depth:o.scale.z,z:o.position.z};
 });
 assert.equal(placement.y,.105);
 assert.equal(placement.depth,.25);
 assert.equal(placement.z,-1.1);
 await page.screenshot({path:OUT+'/terrain-live-south.png'});
 assert.equal(await page.evaluate(()=>window.artTest.view.terrain.children.filter(o=>o.getObjectByName('corpse_2')).length),2);
 await page.evaluate(()=>{
  const {view,g,hurtWall}=window.artTest;
  hurtWall(g,{col:3,row:3},1);view.show(g,0);
 });
 await page.waitForFunction(()=>window.artTest.view.terrain.getObjectByName('wall_damaged'));
 await page.evaluate(()=>{
  const {view,g,hurtWall}=window.artTest;
  hurtWall(g,{col:3,row:3},1);g.board.corpses[34]=0;g.board.corpses[35]=8;view.show(g,1);
 });
 await page.waitForFunction(()=>{
  const {view}=window.artTest;
  return view.terrain.getObjectByName('rubble')&&view.backdrop.position.z>0;
 });
 assert.equal(await page.evaluate(()=>window.artTest.view.terrain.children.filter(o=>o.getObjectByName('corpse_3')).length),2);
 assert.equal(await page.evaluate(()=>!!window.artTest.view.terrain.getObjectByName('wall_damaged')),false);
 await page.screenshot({path:OUT+'/terrain-live-north.png'});
 for(const size of [6,10]) {
  await page.evaluate(size=>{
   const {view,g,emptyBoard}=window.artTest;
   g.board=emptyBoard(size);view.show(g,0);
  },size);
  await wait();
 }
 assert.deepEqual(errors,[]);
 // Each page has a fresh model cache: missing optional art must not create blocks.
 const missing=await browser.newPage();
 await missing.route('**/art/board/{frame_*,backdrop}.glb',r=>r.abort());
 await missing.goto(URL);
 await missing.evaluate(async()=>{
  const {BoardView}=await import('/src/client/board.ts');
  const {battle}=await import('/tests/play.ts');
  document.body.innerHTML='<div id="stage" style="width:800px;height:600px"></div>';
  window.view=new BoardView(document.querySelector('#stage'));
  window.view.show(battle([]),0);
 });
 await missing.waitForFunction(()=>window.view.terrain.children.length>=65);
 assert.equal(await missing.evaluate(()=>window.view.backdrop.children.length),0);
 assert.equal(await missing.evaluate(()=>!!window.view.terrain.getObjectByName('frame_8')),false);
 console.log('Terrain integration passed: wall transitions, corpse counts, both ends, all frame sizes, missing optional art.');
} finally {await browser.close()}
