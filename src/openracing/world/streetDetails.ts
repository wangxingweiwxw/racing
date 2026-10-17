// Street-scale detail, batched by material. Furniture stays behind the curb.
import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { Layout } from './layout.ts';
type Piece = { matrix:Matrix4;color:number };
export function streetDetails(layout:Layout):Group {
  const group=new Group();group.name='Street curbs storefronts and furniture';
  const stone:Piece[]=[],metal:Piece[]=[],wood:Piece[]=[],glass:Piece[]=[],green:Piece[]=[];
  const put=(list:Piece[],x:number,y:number,z:number,w:number,h:number,d:number,color:number,ry=0)=>list.push({matrix:new Matrix4().compose(new Vector3(x,y,z),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),ry),new Vector3(w,h,d)),color});
  for(const b of layout.blocks){
    const w=b.x1-b.x0,d=b.z1-b.z0;
    for(const x of [b.x0+.18,b.x1-.18])put(stone,x,.13,(b.z0+b.z1)/2,.32,.2,d,0xa9aaa5);
    for(const z of [b.z0+.18,b.z1-.18])put(stone,(b.x0+b.x1)/2,.13,z,w,.2,.32,0xa9aaa5);
    // Drainage slots and tactile paving, off the traffic lanes.
    for(const z of [b.z0+3,b.z1-3]){
      put(stone,b.x0+1.1,.055,z,.65,.04,2.1,0xbaa878);
      for(let i=0;i<6;i++)put(metal,b.x0+.6,.045,z-.45+i*.18,.38,.025,.035,0x333e44);
    }
    const x=(b.x0+b.x1)/2,z=b.z0+1.6;
    if(!layout.buildings.some(v=>Math.abs(v.x-x)<v.w/2+2&&Math.abs(v.z-z)<v.d/2+1.1)){
      for(const dx of [-1,1])put(metal,x+dx,.28,z,.14,.5,.7,0x374047);
      for(let i=0;i<4;i++)put(wood,x,.54,z-.3+i*.2,2.5,.09,.14,0x876b4b);
      put(wood,x,.95,z-.4,2.5,.62,.09,0x876b4b);
      put(stone,x+4,.35,z,1.5,.65,1.3,0x8e9390);
      put(green,x+4,.85,z,1.35,.48,1.15,0x50774a);
      put(metal,x-3,.48,z,.5,.9,.5,0x375855);
      put(metal,x-3,.95,z,.55,.06,.55,0x272f31);
    }
  }
  for(const b of layout.buildings){
    if(b.style!==0&&b.style!==3)continue;
    // Select the facade facing the nearest road, instead of filling back alleys.
    const sides=[{x:b.x,z:b.z-b.d/2,nx:0,nz:-1,span:b.w,ry:0},{x:b.x,z:b.z+b.d/2,nx:0,nz:1,span:b.w,ry:0},{x:b.x-b.w/2,z:b.z,nx:-1,nz:0,span:b.d,ry:Math.PI/2},{x:b.x+b.w/2,z:b.z,nx:1,nz:0,span:b.d,ry:Math.PI/2}];
    const roadDistance=(f:typeof sides[number])=>Math.min(...layout.streets.map(s=>s.axis==='x'?Math.hypot(f.z-s.at,Math.max(s.from-f.x,0,f.x-s.to)):Math.hypot(f.x-s.at,Math.max(s.from-f.z,0,f.z-s.to))));
    sides.sort((a,c)=>roadDistance(a)-roadDistance(c));const f=sides[0];
    const count=Math.min(5,Math.floor((f.span-3)/6));
    for(let i=0;i<count;i++){
      const along=(i-(count-1)/2)*6,x=f.x+(f.nz?along:0),z=f.z+(f.nx?along:0);
      const fx=x+f.nx*.1,fz=z+f.nz*.1;
      put(glass,fx,1.65,fz,4.7,2.7,.12,0x4c6a76,f.ry);
      for(const dx of [-2.4,0,2.4])put(metal,fx+(f.nz?dx:0),1.7,fz+(f.nx?dx:0),.07,2.8,.16,0x99a4a6,f.ry);
      put(stone,fx,.24,fz,5,.22,.35,0xbbb7ac,f.ry);
      put(wood,x+f.nx*.48,3.3,z+f.nz*.48,5.1,.18,1,b.style===0?0x46645b:0x85434b,f.ry);
      put(metal,fx,3.8,fz,4.8,.7,.17,b.style===0?0x284841:0x303e54,f.ry);
    }
  }
  for(const z of [-180,180,420]){
    const x=-87;
    put(metal,x,2.9,z,3.4,.18,8.2,0x384b55);
    for(const dz of [-3.8,3.8])put(metal,x-1.3,1.5,z+dz,.12,2.9,.12,0x53666c);
    put(glass,x-1.3,1.6,z,.06,2.2,7.5,0x7a969e);
    put(wood,x,.55,z,1,.12,5.4,0x8e7555);
    put(metal,x,3.28,z,3.3,.55,7.9,0x365e56);
  }
  for(const [name,list,roughness,metalness] of [['stone',stone,.88,.02],['metal',metal,.5,.4],['wood',wood,.85,0],['glass',glass,.17,.35],['green',green,1,0]] as const){
    const mesh=new InstancedMesh(new BoxGeometry(1,1,1),new MeshStandardMaterial({color:0xffffff,roughness,metalness}),list.length);
    mesh.name=`Street detail ${name}`;
    list.forEach((p,i)=>{mesh.setMatrixAt(i,p.matrix);mesh.setColorAt(i,new Color(p.color));});
    mesh.computeBoundingSphere();group.add(mesh);
  }
  return group;
}
