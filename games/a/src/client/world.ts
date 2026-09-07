import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK,N,WIDTH,ITEM_SPOTS,COLORS,sample } from '../shared/track';
import type {Kart,Snapshot} from '../shared/types';
const material=(color:number,extra:THREE.MeshStandardMaterialParameters={})=>new THREE.MeshStandardMaterial({color,roughness:.8,...extra});
const mats={road:material(0x3f5157),edge:material(0xf8edd6),coral:material(0xec653c),yellow:material(0xffd052),dark:material(0x233c42),white:material(0xf6f5eb)};
function box(w:number,h:number,d:number,mat:THREE.Material,x=0,y=0,z=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;}
function cylinder(top:number,bottom:number,h:number,mat:THREE.Material,x=0,y=0,z=0,sides=10){const m=new THREE.Mesh(new THREE.CylinderGeometry(top,bottom,h,sides),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;}
function textSprite(text:string,color='#233c42',bg='rgba(255,255,255,.96)',size=36){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const c=canvas.getContext('2d')!;c.fillStyle=bg;c.beginPath();c.roundRect(4,12,504,104,24);c.fill();c.font=`900 ${size}px system-ui`;c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';c.fillText(text,256,66,475);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:true}));sprite.scale.set(7,1.75,1);return sprite;
}
function sign(text:string,index:number,side:number){const p=sample(index);const g=new THREE.Group();g.position.set(p.x+p.nx*side,p.y,p.z+p.nz*side);g.add(cylinder(.13,.13,5,mats.dark,0,2.5,0));const s=textSprite(text);s.position.y=5;g.add(s);return g;}
export class World {
 scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(58,1,.2,700);renderer:THREE.WebGLRenderer;
 karts=new Map<string,THREE.Group>();boxes:THREE.Group[]=[];rings:THREE.Mesh[]=[];labels=new Map<string,THREE.Sprite>();particles:{mesh:THREE.Mesh;life:number;vx:number;vz:number}[]=[];
 current:Snapshot|null=null;mine='';last=performance.now();cameraReady=false;orbit=0;reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 constructor(container:HTMLElement){
  this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.setClearColor(0xa8dbe0);container.appendChild(this.renderer.domElement);
  this.scene.fog=new THREE.Fog(0xa8dbe0,150,390);this.scene.add(new THREE.HemisphereLight(0xf6ffff,0x638d77,2.4));
  const sun=new THREE.DirectionalLight(0xffeed7,3.2);sun.position.set(-65,110,50);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-130,right:130,top:130,bottom:-130,near:1,far:260});sun.shadow.bias=-.0006;this.scene.add(sun);
  this.buildTrack();this.buildScenery();this.batchScenery();
  window.addEventListener('resize',()=>this.resize());this.resize();this.renderer.setAnimationLoop(()=>this.draw());
 }
 batchScenery(){
  this.scene.updateMatrixWorld(true);
  const groups=new Map<THREE.Material,THREE.Mesh[]>();
  this.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh)||Array.isArray(obj.material))return;let parent:THREE.Object3D|null=obj;while(parent){if(this.boxes.includes(parent as THREE.Group))return;parent=parent.parent;}const group=groups.get(obj.material)||[];group.push(obj);groups.set(obj.material,group);});
  for(const [mat,meshes]of groups){if(meshes.length<2)continue;const geo=meshes.map(m=>{const g=m.geometry.clone();g.applyMatrix4(m.matrixWorld);return g;});const merged=mergeGeometries(geo);if(merged){const batch=new THREE.Mesh(merged,mat);batch.castShadow=true;batch.receiveShadow=true;for(const m of meshes)m.removeFromParent();this.scene.add(batch);}for(const g of geo)g.dispose();}
 }
 resize(){const w=innerWidth,h=innerHeight;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 buildTrack(){
  const verts:number[]=[],indices:number[]=[],colors:number[]=[];
  for(let i=0;i<N;i++){
   const a=TRACK[i]!,b=TRACK[(i+1)%N]!;if(a.gap)continue;
   const j=verts.length/3;
   for(const [p,side]of [[a,-1],[a,1],[b,-1],[b,1]] as const){verts.push(p.x+p.nx*WIDTH/2*side,p.y,p.z+p.nz*WIDTH/2*side);const col=new THREE.Color(i>=82&&i<106?0xca7551:0x43585d);colors.push(col.r,col.g,col.b);}
   indices.push(j,j+2,j+1,j+1,j+2,j+3);
   for(const side of [-1,1]){
    const len=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)+.05;
    const m=box(.62,.28,len,i%8<4?mats.edge:mats.coral,(a.x+b.x)/2+a.nx*(WIDTH/2-.2)*side,(a.y+b.y)/2+.1,(a.z+b.z)/2+a.nz*(WIDTH/2-.2)*side);m.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);m.rotation.x=-Math.atan2(b.y-a.y,Math.hypot(b.x-a.x,b.z-a.z));this.scene.add(m);
   }
   if(i%12===0){const mark=box(.2,.025,2.4,mats.edge,a.x,a.y+.025,a.z);mark.rotation.y=Math.atan2(a.tx,a.tz);this.scene.add(mark);}
   if(i%20===0&&a.y>7){for(const s of [-1,1])this.scene.add(cylinder(.6,.9,a.y,mats.edge,a.x+a.nx*5.6*s,a.y/2-.25,a.z+a.nz*5.6*s));}
   if(i>172&&i<305&&i%3===0){for(const side of[-1,1]){const rail=box(.22,.65,Math.hypot(b.x-a.x,b.z-a.z)*3+.2,mats.yellow,a.x+a.nx*7.25*side,a.y+.85,a.z+a.nz*7.25*side);rail.rotation.y=Math.atan2(a.tx,a.tz);this.scene.add(rail);}}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();const road=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.9}));road.receiveShadow=true;this.scene.add(road);
  // Substantial flyover fascia makes the separation of the two road decks legible.
  for(let i=195;i<282;i++){const a=TRACK[i]!,b=TRACK[i+1]!;const slab=box(WIDTH,.8,Math.hypot(b.x-a.x,b.z-a.z)+.12,mats.dark,(a.x+b.x)/2,(a.y+b.y)/2-.5,(a.z+b.z)/2);slab.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);slab.rotation.x=-Math.atan2(b.y-a.y,Math.hypot(b.x-a.x,b.z-a.z));this.scene.add(slab);}
  const start=sample(0),arch=new THREE.Group();arch.position.set(start.x,start.y,start.z);arch.rotation.y=Math.atan2(start.tx,start.tz);
  arch.add(box(.65,7,.65,mats.coral,-8,3.5,0),box(.65,7,.65,mats.coral,8,3.5,0),box(17,1.6,.65,mats.coral,0,7,0));const badge=textSprite('PARCEL PANIC','#ffffff','#df592e',39);badge.position.set(0,7,0);badge.scale.set(13,3.25,1);arch.add(badge);
  for(let i=0;i<14;i++)for(let j=0;j<2;j++)arch.add(box(1,.04,.7,(i+j)%2?mats.dark:mats.white,i-6.5,.035,j*.7));this.scene.add(arch);
  for(const [text,i,s]of [['AIR MAIL ↗',87,11],['THE FLYOVER',202,-11],['FINAL SORT →',371,-11],['SPECIAL DELIVERY',453,11]] as [string,number,number][] )this.scene.add(sign(text,i,s));
  for(let i=20;i<N;i+=30){if(i>90&&i<130)continue;const p=sample(i);const g=new THREE.Group();g.position.set(p.x,p.y+.04,p.z);g.rotation.y=Math.atan2(p.tx,p.tz);const shape=new THREE.Shape();shape.moveTo(-1.5,-1);shape.lineTo(0,1);shape.lineTo(1.5,-1);shape.lineTo(.7,-1);shape.lineTo(0,-.1);shape.lineTo(-.7,-1);shape.closePath();const m=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color:0xffd052,side:THREE.DoubleSide}));m.rotation.x=Math.PI/2;g.add(m);this.scene.add(g);}
  ITEM_SPOTS.forEach(index=>{const p=sample(index),g=new THREE.Group();g.position.set(p.x,p.y+1.9,p.z);g.add(box(1.6,1.6,1.6,mats.yellow),box(1.65,.3,1.65,mats.coral),box(.3,1.65,1.65,mats.coral));const label=textSprite('?', '#233c42','#fff5c7',70);label.scale.set(1.8,.8,1);label.position.y=1.6;g.add(label);this.scene.add(g);this.boxes.push(g);});
 }
 buildScenery(){
  const sea=new THREE.Mesh(new THREE.PlaneGeometry(1400,1400),material(0x64b7bf,{roughness:.35,metalness:.1}));sea.rotation.x=-Math.PI/2;sea.position.y=-3;sea.receiveShadow=true;this.scene.add(sea);
  const grass=material(0x91b991),sand=material(0xe5c79d),roof=material(0x338a93),crate=material(0xd99a56),trunk=material(0xac7955),leaf=material(0x478c6b);
  const island=cylinder(115,125,7,sand,0,-2,0,64);island.scale.z=.85;this.scene.add(island);const top=cylinder(111,114,1,grass,0,1.2,0,64);top.scale.z=.85;this.scene.add(top);
  // Place scenery only away from both road levels.
  let seed=73;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<130;i++){
   const x=(rand()-.5)*215,z=(rand()-.5)*163;if(Math.hypot(x,z/ .8)>103||TRACK.some(p=>Math.hypot(p.x-x,p.z-z)<15))continue;
   if(i%3===0){const g=new THREE.Group();g.position.set(x,1.6,z);g.add(cylinder(.3,.55,7,trunk,0,3,0));for(let k=0;k<5;k++){const l=new THREE.Mesh(new THREE.ConeGeometry(1.1,5,4),leaf);l.position.set(Math.sin(k*1.256)*1.5,6,Math.cos(k*1.256)*1.5);l.rotation.z=.95;l.rotation.y=k*1.256;g.add(l);}this.scene.add(g);}
   else{const g=new THREE.Group();g.position.set(x,2.3,z);g.rotation.y=rand()*6;g.add(box(2.3,1.8,2.3,crate),box(2.35,.23,2.35,mats.edge));if(i%4===0)g.add(box(1.7,1.7,1.7,mats.coral,0,1.7,0));this.scene.add(g);}
  }
  for(const [x,z,r]of [[49,25,-.3],[-49,-27,.3]] as const){const g=new THREE.Group();g.position.set(x,2,z);g.rotation.y=r;g.add(box(20,9,12,mats.white,0,4.5,0),box(22,1,14,roof,0,9,0));for(let k=-1;k<=1;k++){g.add(box(4.8,4,.25,mats.coral,k*6,2.2,6.2));g.add(box(2.5,1.5,.3,roof,k*6,6.8,6.2));}const s=textSprite('P • DISPATCH');s.position.set(0,10.7,0);s.scale.set(13,3.25,1);g.add(s);this.scene.add(g);}
  for(const [x,z]of [[125,20],[-128,-15]] as const){const g=new THREE.Group();g.position.set(x,-1.8,z);g.rotation.y=.5;g.add(box(9,3,23,mats.coral,0,0,0),box(7,4,8,mats.white,0,3,-5),cylinder(.2,.2,15,mats.dark,0,8,0));const sail=box(6,7,.15,mats.yellow,3,10,0);g.add(sail);this.scene.add(g);}
  for(let i=0;i<7;i++){const g=new THREE.Group();g.position.set(Math.cos(i*1.7)*200,40+i*5,Math.sin(i*1.7)*190);for(let j=0;j<3;j++){const c=new THREE.Mesh(new THREE.SphereGeometry(8+j*3,12,8),mats.white);c.scale.set(1.7,.55,1);c.position.x=j*10;g.add(c);}this.scene.add(g);}
  const balloon=new THREE.Group();balloon.position.set(-65,43,60);balloon.add(new THREE.Mesh(new THREE.SphereGeometry(8,16,12),mats.coral),box(4,3,4,crate,0,-12,0));for(const x of[-1.5,1.5])balloon.add(cylinder(.06,.06,8,mats.dark,x,-7,0));const logo=textSprite('P','#ffffff','#df592e',80);logo.position.set(0,1,8);logo.scale.set(5,2.5,1);balloon.add(logo);this.scene.add(balloon);
 }
 makeKart(k:Kart){const g=new THREE.Group(),paint=material(k.color),tire=material(0x233238),skin=material(0xffce8b);
  g.add(box(1.55,.5,2.5,paint,0,.1,0),box(1.35,.45,.65,mats.dark,0,.2,-.4),box(1.45,.5,.75,paint,0,.5,.85));
  g.add(box(1.2,.85,1,mats.yellow,0,.85,-.83),box(1.25,.14,1.04,mats.edge,0,.95,-.83),box(.16,.89,1.04,mats.edge,0,.86,-.83));
  g.add(cylinder(.29,.34,.55,paint,0,.72,0));const head=new THREE.Mesh(new THREE.SphereGeometry(.35,12,10),skin);head.position.set(0,1.2,.05);g.add(head);const helmet=new THREE.Mesh(new THREE.SphereGeometry(.38,12,10,0,Math.PI*2,0,Math.PI*.55),paint);helmet.position.copy(head.position);g.add(helmet);g.add(box(.5,.16,.16,mats.dark,0,1.25,.36));
  for(const x of[-.92,.92])for(const z of[-.83,.88]){const wheel=cylinder(.37,.37,.32,tire,x,-.05,z,12);wheel.rotation.z=Math.PI/2;g.add(wheel);const hub=cylinder(.18,.18,.34,mats.white,x,-.05,z,10);hub.rotation.z=Math.PI/2;g.add(hub);}
  g.add(box(1.6,.19,.22,mats.white,0,0,1.35),box(.35,.2,.1,mats.yellow,-.45,.38,1.25),box(.35,.2,.1,mats.yellow,.45,.38,1.25));
  const label=textSprite(k.name);label.position.y=2.8;label.scale.set(3.4,.85,1);g.add(label);this.labels.set(k.id,label);this.scene.add(g);this.karts.set(k.id,g);return g;
 }
 update(snapshot:Snapshot,id:string){this.current=snapshot;this.mine=id;for(const k of snapshot.players){if(!this.karts.has(k.id)){const g=this.makeKart(k);g.position.set(k.x,k.y,k.z);g.rotation.y=k.heading;}}for(const [id,g]of this.karts)if(!snapshot.players.some(k=>k.id===id)){this.scene.remove(g);this.karts.delete(id);this.labels.delete(id);}}
 draw(){const t=performance.now()/1000,dt=Math.min(.05,(performance.now()-this.last)/1000);this.last=performance.now();const s=this.current;const mine=s?.players.find(k=>k.id===this.mine),racing=s&&(s.phase==='racing'||s.phase==='countdown');
  for(const [i,g]of this.boxes.entries()){g.visible=s?.items[i]??true;g.rotation.y=t*1.1;g.position.y=sample(ITEM_SPOTS[i]!).y+1.8+Math.sin(t*2+i)*.22;}
  if(s){for(const k of s.players){const g=this.karts.get(k.id)!;g.visible=k.active||!racing;if(!g.visible)continue;
   const target=new THREE.Vector3(k.x+k.vx*.035,k.y,k.z+k.vz*.035);if(g.position.distanceTo(target)>9)g.position.copy(target);else g.position.lerp(target,1-Math.exp(-18*dt));g.rotation.y+=Math.atan2(Math.sin(k.heading-g.rotation.y),Math.cos(k.heading-g.rotation.y))*(1-Math.exp(-18*dt));
   g.rotation.z=THREE.MathUtils.lerp(g.rotation.z,k.drifting?-.1:0,.12);this.labels.get(k.id)!.visible=k.id!==this.mine;
   if((k.boost>0||k.driftCharge>.25)&&Math.random()<.55){const m=new THREE.Mesh(new THREE.SphereGeometry(.12+Math.random()*.12,5,4),new THREE.MeshBasicMaterial({color:k.boost>0?0xffb843:k.driftCharge>.65?0x4fe4ec:0xffffff}));m.position.copy(g.position);m.position.y-=.1;m.position.x+=(Math.random()-.5)*1.6;this.scene.add(m);this.particles.push({mesh:m,life:.45,vx:-k.vx*.25,vz:-k.vz*.25});}
  }
  for(const ring of this.rings){this.scene.remove(ring);ring.geometry.dispose();(ring.material as THREE.Material).dispose();}this.rings=[];
  for(const e of s.effects){const age=Math.max(0,.7-(e.until-s.serverTime));const ring=new THREE.Mesh(new THREE.TorusGeometry(1+age*24,.17,5,48),new THREE.MeshBasicMaterial({color:0x8eedff,transparent:true,opacity:.75-age}));ring.rotation.x=Math.PI/2;ring.position.set(e.x,e.y+.5,e.z);this.scene.add(ring);this.rings.push(ring);}}
  for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i]!;p.life-=dt;p.mesh.position.x+=p.vx*dt;p.mesh.position.z+=p.vz*dt;p.mesh.scale.multiplyScalar(.94);if(p.life<=0){this.scene.remove(p.mesh);p.mesh.geometry.dispose();(p.mesh.material as THREE.Material).dispose();this.particles.splice(i,1);}}
  if(racing&&mine?.active){
   const kart=this.karts.get(mine.id)!;const h=mine.heading;const desired=new THREE.Vector3(kart.position.x-Math.sin(h)*11,kart.position.y+6.8,kart.position.z-Math.cos(h)*11);
   if(!this.cameraReady||this.camera.position.distanceTo(desired)>45){this.camera.position.copy(desired);this.cameraReady=true;}else this.camera.position.lerp(desired,1-Math.exp(-5*dt));
   const target=kart.position.clone().add(new THREE.Vector3(Math.sin(h)*7,1.3,Math.cos(h)*7));this.camera.lookAt(target);this.camera.fov=THREE.MathUtils.lerp(this.camera.fov,mine.boost>0&&!this.reduced?66:58,.04);this.camera.updateProjectionMatrix();
  }else{this.cameraReady=false;this.orbit+=dt*.022;this.camera.position.set(Math.sin(.9+this.orbit)*170,135,Math.cos(.9+this.orbit)*180);this.camera.lookAt(innerWidth>850?-25:0,3,0);}
  this.renderer.render(this.scene,this.camera);
 }
}
