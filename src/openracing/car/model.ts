// Shared with the circuit game and the v3 model package; +Z is the nose.
import { Group, Mesh, CylinderGeometry, MeshStandardMaterial, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { buildRoadster } from '../../race/roadsterModel';
import { radialTexture } from '../world/textures.ts';
export type ThrusterKind = 'main' | 'down' | 'side' | 'brake';
export interface Socket { pos: Vector3; dir: Vector3; kind: ThrusterKind; side: number; front: number }
export const WHEEL_R = .37;
export function buildCar() {
  const parts=buildRoadster(0xf4f4f4),root=new Group(),body=parts.car;
  root.name='Openracing Roadster 2';root.add(body);
  parts.jets.forEach(j=>{j.removeFromParent();j.geometry.dispose();(j.material as MeshBasicMaterial).dispose();});
  const wheels=parts.wheels.map(spin=>({spin,pivot:spin.parent!,front:spin.parent!.position.z>0,side:Math.sign(spin.parent!.position.x)}));
  const sockets:Socket[]=[];
  for(const x of [-.68,.68])for(const z of [-1.72,1.65])sockets.push({pos:new Vector3(x,.17,z),dir:new Vector3(0,-1,0),kind:'down',side:Math.sign(x),front:Math.sign(z)});
  for(const x of [-.6,-.2,.2,.6])sockets.push({pos:new Vector3(x,.40,-2.44),dir:new Vector3(0,0,-1),kind:'main',side:Math.sign(x),front:-1});
  for(const x of [-.62,.62]){
    const pos=new Vector3(x,.377,2.464),dir=new Vector3(0,0,1);
    sockets.push({pos,dir,kind:'brake',side:Math.sign(x),front:1});
  }
  for(const x of [-.98,.98])for(const z of [-1.6,1.6])sockets.push({pos:new Vector3(x,.48,z),dir:new Vector3(Math.sign(x),0,0),kind:'side',side:Math.sign(x),front:Math.sign(z)});
  const fanDisc=new Mesh(new CylinderGeometry(.42,.42,.025,24),new MeshStandardMaterial({color:0x12191e,emissive:0x2b6c8e,emissiveIntensity:0}));
  fanDisc.position.set(0,.06,-.2);body.add(fanDisc);
  const fanGlow=new Mesh(new PlaneGeometry(1.3,1.3).rotateX(-Math.PI/2),new MeshBasicMaterial({map:radialTexture('rgba(90,210,255,.6)','rgba(90,210,255,0)'),transparent:true,opacity:0,depthWrite:false}));
  fanGlow.position.set(0,.035,-.2);body.add(fanGlow);
  let doorOpen=0,wingOpen=0,wingAngle=0;
  function animate(dt:number,state:{steer:number;braking:boolean;speedKmh:number;showcase:boolean;stuntRoll:number},suspension:number) {
    const roll=state.stuntRoll;
    body.rotation.z=roll;body.position.set(-.65*Math.sin(roll),.65*(1-Math.cos(roll))+suspension,0);
    doorOpen+=(Number(state.showcase)-doorOpen)*(1-Math.exp(-dt*4));
    for(const door of parts.doors){door.rotation.x=.95*doorOpen;door.rotation.z=-door.userData.side*.35*doorOpen;}
    const brake=state.braking?Math.min(1,state.speedKmh/180):0;
    const cruise=Math.max(0,Math.min(1,(state.speedKmh-100)/80));
    wingOpen+=(Math.max(state.showcase?1:cruise,brake)-wingOpen)*(1-Math.exp(-dt*5));
    wingAngle+=((state.showcase?.35:brake)-wingAngle)*(1-Math.exp(-dt*7));
    parts.setAeroPose(wingOpen,wingAngle);
    parts.yoke.rotation.z=state.steer*.35;
    for(const light of parts.brakeLights)light.emissiveIntensity=state.braking?2.5:.8;
  }
  return {root,body,wheels,sockets,fanDisc,fanGlow,animate};
}
