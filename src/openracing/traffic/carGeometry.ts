// Shared, instanced civilian vehicles: paint is separate from neutral glass/rubber/chrome.
import { BoxGeometry, BufferAttribute, Color, CylinderGeometry } from 'three';
import type { BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CarType } from './traffic.ts';

export function carGeometry(t: CarType) {
  const {len:L,wid:W,hgt:H}=t;
  const paint:BufferGeometry[]=[],trim:BufferGeometry[]=[];
  const add=(list:BufferGeometry[],g:BufferGeometry,color=0xffffff)=>{
    if(g.index)g=g.toNonIndexed();
    const c=new Color(color),rgb=new Float32Array(g.attributes.position.count*3);
    for(let i=0;i<rgb.length;i+=3){rgb[i]=c.r;rgb[i+1]=c.g;rgb[i+2]=c.b;}
    g.setAttribute('color',new BufferAttribute(rgb,3));list.push(g);
  };
  const box=(list:BufferGeometry[],w:number,h:number,l:number,x:number,y:number,z:number,color=0xffffff)=>add(list,new BoxGeometry(w,h,l).translate(x,y,z),color);
  const soft=(w:number,h:number,l:number,x:number,y:number,z:number)=>add(paint,new RoundedBoxGeometry(w,h,l,2,Math.min(.14,h*.25)).translate(x,y,z));
  const bus=t.name==='bus',van=t.name==='van',suv=t.name==='suv';
  const wr=bus?.5:van?.38:.34;
  const axle=L/2-(bus?2.2:van?1:.85);
  if(bus||van){
    soft(W,H-.38,L,0,.38+(H-.38)/2,0);
    box(trim,W*.88,bus?1:.85,.035,0,H-.85,L/2+.012,0x182c3a);
    box(trim,W*.8,bus?.65:.55,.035,0,H-.85,-L/2-.012,0x1b2d37);
    for(const side of [-1,1]){
      const windows=bus?7:2,span=bus?L-2:2;
      for(let i=0;i<windows;i++)box(trim,.03,bus?.92:.7,span/windows-.12,side*(W/2+.01),H-.9,(i-(windows-1)/2)*span/windows+(van?L/2-1.35:0),0x223a49);
      box(trim,.04,.09,L*.92,side*(W/2+.02),.8,0,0xd5dadd);
      if(bus){
        for(const z of [L/2-1.4,-.6]){
          box(trim,.05,1.95,.9,side*(W/2+.025),1.3,z,0x202c33);
          box(trim,.06,1.3,.74,side*(W/2+.035),1.55,z,0x416171);
        }
      }else box(trim,.035,1.4,.035,side*(W/2+.025),1.05,-.5,0x424950);
    }
    if(bus){soft(W*.68,.26,2.6,0,H+.12,-1);box(trim,W*.68,.3,.045,0,H-.25,L/2+.025,0x1b251c);}
    else box(trim,.04,1.6,.035,0,1.3,-L/2-.025,0x444c53);
  }else{
    soft(W,.58,L,0,.64,0);
    const cabL=L*(suv?.65:.55),cabH=H-.9,cz=suv?-.25:-.18;
    const cab=new BoxGeometry(W*.9,cabH,cabL);
    const p=cab.attributes.position;
    for(let i=0;i<p.count;i++)if(p.getY(i)>0){p.setX(i,p.getX(i)*.84);p.setZ(i,p.getZ(i)*.7);}
    cab.computeVertexNormals();cab.translate(0,.9+cabH/2,cz);add(trim,cab,0x203441);
    soft(W*.75,.075,cabL*.7,0,H-.01,cz);
    for(const side of [-1,1]){
      box(paint,.065,cabH,.11,side*W*.415,.9+cabH/2,cz-.1);
      // Door shut-lines, handles, lower sill and side mirror.
      box(trim,.025,.46,.018,side*(W/2+.01),.67,cz-.15,0x313940);
      for(const z of [cz-.35,cz+.6])box(trim,.045,.045,.2,side*(W/2+.025),.89,z,0xb8c2cc);
      box(trim,.08,.1,L*.7,side*(W/2-.015),.38,-.05,0x252a2d);
      box(paint,.24,.12,.23,side*(W/2+.06),1.08,cabL*.32);
    }
    if(t.name==='taxi'){
      box(trim,.72,.2,.33,0,H+.14,-.1,0xf1e6b5);
      box(trim,.5,.055,.012,0,H+.15,.073,0x185544);
    }
    if(suv)for(const side of [-1,1])box(trim,.06,.07,cabL*.75,side*W*.31,H+.065,cz,0x737f89);
  }
  // Recessed grille, bumpers, license plates and lamp housings.
  box(trim,W*.55,.2,.04,0,.5,L/2+.035,0x172024);
  for(let i=-2;i<=2;i++)box(trim,W*.49,.013,.06,0,.5+i*.031,L/2+.05,0x6d7880);
  box(trim,W*.88,.1,.06,0,.36,-L/2-.02,0x262d33);
  for(const z of [-L/2-.06,L/2+.08])box(trim,.38,.12,.025,0,.6,z,bus?0xd3a92b:0x24839a);
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const x=sx*(W/2-.1),z=sz*axle;
    add(trim,new CylinderGeometry(wr,wr,.25,16).rotateZ(Math.PI/2).translate(x,wr,z),0x171b20);
    const rimX=sx*(W/2+.035);
    add(trim,new CylinderGeometry(wr*.69,wr*.69,.035,16).rotateZ(Math.PI/2).translate(rimX,wr,z),0x9ba6af);
    add(trim,new CylinderGeometry(wr*.53,wr*.53,.04,12).rotateZ(Math.PI/2).translate(rimX+sx*.02,wr,z),0x26303a);
    for(let spoke=0;spoke<5;spoke++){
      const a=spoke*Math.PI*2/5;
      add(trim,new BoxGeometry(.045,wr*1.25,.045).rotateX(a).translate(rimX+sx*.045,wr,z),0xb8c5cc);
    }
  }
  const lights=(z:number,y:number,w:number,h:number)=>mergeGeometries([-1,1].map(s=>new BoxGeometry(w,h,.06).translate(s*(W/2-w/2-.09),y,z)));
  const y=bus?.88:.76;
  return {body:mergeGeometries(paint),detail:mergeGeometries(trim),head:lights(L/2+.04,y,W*.23,.09),tail:lights(-L/2-.04,y+.035,W*.23,.1)};
}

/** Distant traffic retains a silhouette at a fraction of the near model cost. */
export function carLodGeometry(t: CarType): BufferGeometry {
  const body=new BoxGeometry(t.wid,t.hgt*.46,t.len).translate(0,t.hgt*.23+.3,0);
  const cab=new BoxGeometry(t.wid*.84,t.hgt*.4,t.len*.55).translate(0,t.hgt*.72,-.15);
  const parts=[body,cab];
  parts.forEach((g,i)=>{const rgb=new Float32Array(g.attributes.position.count*3).fill(i?.08:1);g.setAttribute('color',new BufferAttribute(rgb,3));});
  return mergeGeometries(parts);
}
