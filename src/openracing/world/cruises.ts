import { BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Shape, TorusGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeBox, setBoxPose, sphereBox } from '../physics/colliders.ts';
import type { BoxCollider, Contact, DynamicSource } from '../physics/colliders.ts';
import { RIVER } from './layout.ts';

const STRAIGHT=1200, TURN=Math.PI*50, LOOP=2*(STRAIGHT+TURN);
export const CRUISE_SPEED=10;

/** Constant-speed, closed sightseeing route with smooth semicircular turns. */
export function cruisePose(time:number,index:number) {
  let s=((time*CRUISE_SPEED+index*LOOP/3)%LOOP+LOOP)%LOOP;
  let x=100,z=-600,yaw=0;
  if(s<STRAIGHT)z+=s;
  else if((s-=STRAIGHT)<TURN){const a=Math.PI-s/50;x=150+50*Math.cos(a);z=600+50*Math.sin(a);yaw=Math.atan2(Math.sin(a),-Math.cos(a));}
  else if((s-=TURN)<STRAIGHT){x=200;z=600-s;yaw=Math.PI;}
  else {s-=STRAIGHT;const a=-s/50;x=150+50*Math.cos(a);z=-600+50*Math.sin(a);yaw=Math.atan2(Math.sin(a),-Math.cos(a));}
  return {x,z,yaw,y:RIVER.waterY+.12*Math.sin(time*.9+index*2)};
}

function buildShip(index:number) {
  const root=new Group();root.name=`黄浦江观光游轮 ${index+1}`;
  const white=new MeshStandardMaterial({color:0xf2eee4,roughness:.45,metalness:.15});
  const navy=new MeshStandardMaterial({color:[0x143b59,0x205050,0x45405b][index],roughness:.42,metalness:.35});
  const glass=new MeshStandardMaterial({color:0x173a50,metalness:.55,roughness:.2});
  const wood=new MeshStandardMaterial({color:0xbb8650,roughness:.8});
  const orange=new MeshStandardMaterial({color:0xf58b36,roughness:.55});
  const add=(geo:BufferGeometry,mat:MeshStandardMaterial,x=0,y=0,z=0)=>{const m=new Mesh(geo,mat);m.position.set(x,y,z);root.add(m);return m;};
  const box=(x:number,y:number,z:number,w:number,h:number,l:number,mat=white)=>add(new BoxGeometry(w,h,l),mat,x,y,z);
  const outline=new Shape();outline.moveTo(0,-22);outline.lineTo(4.8,-14);outline.lineTo(5.2,10);outline.quadraticCurveTo(5,17,0,18);outline.quadraticCurveTo(-5,17,-5.2,10);outline.lineTo(-4.8,-14);outline.closePath();
  add(new ExtrudeGeometry(outline,{depth:3.1,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.18,bevelThickness:.18,curveSegments:8}).rotateX(-Math.PI/2),navy,0,-1.3,0);
  box(0,1.9,0,9.5,.45,32);box(0,2.17,-1,8.9,.12,30,wood);
  box(0,3.65,1,8.2,2.8,24,glass);box(0,5.2,0,9.6,.38,28);
  box(0,5.43,-3,8.8,.1,21,wood);box(0,6.4,7,6.5,2,8,glass);box(0,7.5,7,7.5,.3,9);
  for(const side of [-1,1]){
    for(let z=-10;z<=12;z+=2.8)box(side*4.15,3.65,z,.12,2.85,.15);
    for(let z=-13;z<=13;z+=2.6)box(side*4.5,2.75,z,.08,1.2,.08);
    box(side*4.5,3.35,0,.08,.08,28);box(side*4.5,2.9,0,.06,.06,28);
    for(let z=-12;z<=3;z+=3)box(side*4.3,6,z,.07,1.1,.07);
    box(side*4.3,6.55,-4.5,.07,.07,17);
    for(const z of [-8,8]){const ring=add(new TorusGeometry(.48,.12,8,20),orange,side*4.65,2.85,z);ring.rotation.y=Math.PI/2;}
    for(const z of [-10,-6,-2]){box(side*2.4,5.8,z,1.2,.5,1.5,navy);box(side*2.4,6.3,z-.6,1.2,.8,.18);}
  }
  add(new CylinderGeometry(.08,.12,2,8),white,0,8.6,7);box(0,9.4,7,2.2,.12,.25);
  box(0,6.2,-6,1.8,1.4,1.8,navy);box(0,7,-6,2,.16,2);
  // Merge the repeated windows, seats and rails by material to keep mobile draw calls low.
  for(const mat of [white,navy,glass,wood,orange]){
    const meshes=root.children.filter(o=>o instanceof Mesh&&o.material===mat) as Mesh[];
    const gs=meshes.map(m=>{m.updateMatrix();const g=m.geometry.clone().applyMatrix4(m.matrix);return g.index?g.toNonIndexed():g;});
    const merged=mergeGeometries(gs);gs.forEach(g=>g.dispose());
    if(merged){meshes.forEach(m=>{m.removeFromParent();m.geometry.dispose();});const m=new Mesh(merged,mat);m.castShadow=true;m.receiveShadow=true;root.add(m);}
  }
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=64;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#16394f';ctx.fillRect(0,0,512,64);ctx.fillStyle='#ffe5a4';ctx.textAlign='center';ctx.font='bold 38px sans-serif';ctx.fillText(`黄浦江游览 · ${index+1}号`,256,47);
    const mat=new MeshBasicMaterial({map:new CanvasTexture(canvas),side:DoubleSide});
    for(const side of [-1,1]){const label=new Mesh(new PlaneGeometry(12,1.5),mat);label.position.set(side*4.22,3.65,0);label.rotation.y=side*Math.PI/2;root.add(label);}
  }
  return root;
}

export class RiverCruises implements DynamicSource {
  readonly group=new Group();
  readonly ships:{root:Group;collider:BoxCollider;velocity:Vector3;wake:Mesh<BufferGeometry,MeshBasicMaterial>}[]=[];
  time=0;
  constructor(){
    this.group.name='往返观光游轮';
    for(let i=0;i<3;i++){
      const root=buildShip(i);this.group.add(root);
      const velocity=new Vector3();
      const collider=makeBox(new Vector3(),new Vector3(5.2,4.5,20),'vehicle');
      collider.dyn={vel:velocity,mass:150,onHit:()=>{}};
      const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute([-4,0,-16,-10,0,-44,-5,0,-38,4,0,-16,5,0,-38,10,0,-44],3));
      const wake=new Mesh(geo,new MeshBasicMaterial({color:0xc9e8e7,transparent:true,opacity:.35,depthWrite:false,side:DoubleSide}));this.group.add(wake);
      this.ships.push({root,collider,velocity,wake});
    }
    this.update(0);
  }
  update(time:number){
    this.time=time;
    this.ships.forEach((ship,i)=>{
      const p=cruisePose(time,i),next=cruisePose(time+.01,i);
      ship.velocity.set((next.x-p.x)/.01,(next.y-p.y)/.01,(next.z-p.z)/.01);
      ship.root.position.set(p.x,p.y,p.z);ship.root.rotation.y=p.yaw;
      setBoxPose(ship.collider,p.x,p.y+3.2,p.z,p.yaw);
      ship.wake.position.set(p.x,RIVER.waterY+.06,p.z);ship.wake.rotation.y=p.yaw;ship.wake.material.opacity=.26+.06*Math.sin(time*3+i);
    });
  }
  contacts(p:Vector3,r:number,margin:number,pool:Contact[],start:number){
    let n=start;
    for(const ship of this.ships){
      if(!pool[n])pool[n]={normal:new Vector3(),point:new Vector3(),depth:0,collider:ship.collider};
      if(sphereBox(p,r,margin,ship.collider,pool[n]))n++;
    }
    return n;
  }
}
