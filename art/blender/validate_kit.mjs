import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const out = process.argv[3];
if (!out) throw Error('Usage: node validate_kit.mjs SERVER_URL OUTPUT_DIR');
await fs.mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true, args:['--mute-audio']});
try {
 const page = await browser.newPage({viewport:{width:1600,height:1100}});
 await page.goto(process.argv[2]);
 const report = await page.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const {GLTFLoader} = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const names = ['ground_a','ground_b','ground_c','elevated','stairs','wall','wall_damaged','rubble','hazard','adverse','corpse_1','corpse_2','corpse_3','frame_6','frame_8','frame_10','backdrop'];
  const loader = new GLTFLoader(), models = {}, results = [];
  const assert = (v,m) => {if(!v) throw Error(m)};
  for (const name of names) {
   const gltf = await loader.loadAsync('/art/board/'+name+'.glb');
   const model = gltf.scene;
   model.updateMatrixWorld(true);
   const box = new THREE.Box3().setFromObject(model);
   let triangles=0;
   model.traverse(o=>{
    if(!o.isMesh)return;
    triangles+=(o.geometry.index?.count ?? o.geometry.attributes.position.count)/3;
    const mat=o.material;
    assert(!Array.isArray(mat), name+' incompatible multi material');
    if(mat.map) assert(mat.map.image.width===1024 && mat.map.image.height===1024,name+' texture size');
    o.material=new THREE.MeshBasicMaterial({map:mat.map??null,color:mat.map?0xffffff:mat.color});
   });
   assert(triangles<2000,name+' triangle budget');
   if(!name.startsWith('frame') && name!=='backdrop') {
    assert(box.min.x>=-.501 && box.max.x<=.501 && box.min.z>=-.501 && box.max.z<=.501,name+' footprint');
   }
   if(name.startsWith('ground')) assert(Math.abs(box.max.y)<.00001,name+' ground height');
   if(['stairs','elevated'].includes(name)) assert(Math.abs(box.max.y-.5)<.00001,name+' elevation');
   if(name==='stairs') {
    const heights=[];
    for(const z of [-.4,-.2,0,.2,.4]) {
     const ray=new THREE.Raycaster(new THREE.Vector3(.2,2,z),new THREE.Vector3(0,-1,0));
     heights.push(ray.intersectObject(model,true)[0].point.y);
    }
    assert(heights.every((h,i)=>Math.abs(h-(.5-i*.1))<.0001),'stairs rise north');
   }
   if(['wall','wall_damaged','rubble'].includes(name)||name.startsWith('corpse')) assert(box.min.y>=-.00001,name+' below ground');
   results.push({name,triangles,min:box.min.toArray(),max:box.max.toArray()});
   models[name]=model;
  }
  document.body.innerHTML='';
  document.body.style.cssText='margin:0;background:#171719;color:#ccc;font:18px sans-serif';
  const title=document.createElement('div');
  title.textContent='MALEGHAST / TERRAIN KIT — unlit glTF preview';
  title.style.cssText='position:absolute;top:25px;left:35px;letter-spacing:3px';
  document.body.append(title);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(1600,1100);
  document.body.append(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#171719');
  const camera=new THREE.PerspectiveCamera(38,1600/1100,.1,100);
  names.slice(0,13).forEach((name,i)=>{
   const x=(i%5-2)*1.4,z=(Math.floor(i/5)-1)*1.7;
   const m=models[name].clone();m.position.set(x,0,z);scene.add(m);
   if(i>=5 && !['hazard','adverse'].includes(name)) {const g=models.ground_a.clone();g.position.set(x,0,z);scene.add(g)}
   const c=document.createElement('canvas');c.width=512;c.height=64;
   const ctx=c.getContext('2d');ctx.fillStyle='#ccc';ctx.font='30px sans-serif';ctx.textAlign='center';ctx.fillText(name,256,42);
   const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false}));
   s.position.set(x,.02,z+.64);s.scale.set(1.25,.156,1);scene.add(s);
  });
  const render=(sign)=>{camera.position.set(0,9,sign*6.3);camera.lookAt(0,0,0);renderer.render(scene,camera)};
  window.kitRender=render;render(1);
  window.kitDressing=async()=>{
   scene.clear();
   scene.add(models.frame_6.clone());
   for(let row=0;row<6;row++) for(let col=0;col<6;col++) {
    let name='ground_'+ 'abc'[(row*7+col*13)%3];
    if(row===2&&col===2) name='hazard';
    if(row===3&&col===4) name='adverse';
    const tile=models[name].clone();tile.position.set(col-2.5,0,row-2.5);scene.add(tile);
   }
   for(const [name,x,z] of [['wall',-1.5,-1.5],['wall_damaged',1.5,-1.5],['rubble',.5,1.5]]) {
    const model=models[name].clone();model.position.set(x,0,z);scene.add(model);
   }
   const back=models.backdrop.clone();back.position.z=-4;scene.add(back);
   const texture=await new THREE.TextureLoader().loadAsync('/art/units/carnifex.png');
   texture.colorSpace=THREE.SRGBColorSpace;
   const unit=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,alphaTest:.5}));
   unit.center.set(.5,0);unit.scale.set(1.3*texture.image.width/texture.image.height,1.3,1);
   unit.position.set(-.5,0,.5);scene.add(unit);
   camera.position.set(0,10,7);camera.lookAt(0,.2,-.5);renderer.render(scene,camera);
  };
  return results;
 });
 await page.screenshot({path:out+'/kit-three-south.png'});
 await page.evaluate(()=>window.kitRender(-1));
 await page.screenshot({path:out+'/kit-three-north.png'});
 await page.evaluate(()=>window.kitDressing());
 await page.screenshot({path:out+'/board-context.png'});
 await fs.writeFile(out+'/validation.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
} finally {await browser.close()}
