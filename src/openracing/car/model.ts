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
  for(const x of [-.39,.39])sockets.push({pos:new Vector3(x,.38,-2.29),dir:new Vector3(0,0,-1),kind:'main',side:Math.sign(x),front:-1});
  const nozzleMaterial=new MeshStandardMaterial({color:0x222b32,metalness:.8,roughness:.25});
  for(const x of [-.62,.62]){
    const pos=new Vector3(x,.377,2.39),dir=new Vector3(0,0,1);
    const nozzle=new Mesh(new CylinderGeometry(.065,.085,.11,16,1,true),nozzleMaterial);
    nozzle.name='Front braking cold-gas nozzle';nozzle.rotation.x=Math.PI/2;nozzle.position.copy(pos);body.add(nozzle);
    sockets.push({pos,dir,kind:'brake',side:Math.sign(x),front:1});
  }
  for(const x of [-.98,.98])for(const z of [-1.6,1.6])sockets.push({pos:new Vector3(x,.48,z),dir:new Vector3(Math.sign(x),0,0),kind:'side',side:Math.sign(x),front:Math.sign(z)});
  const fanDisc=new Mesh(new CylinderGeometry(.42,.42,.025,24),new MeshStandardMaterial({color:0x12191e,emissive:0x2b6c8e,emissiveIntensity:0}));
  fanDisc.position.set(0,.06,-.2);body.add(fanDisc);
  const fanGlow=new Mesh(new PlaneGeometry(1.3,1.3).rotateX(-Math.PI/2),new MeshBasicMaterial({map:radialTexture('rgba(90,210,255,.6)','rgba(90,210,255,0)'),transparent:true,opacity:0,depthWrite:false}));
  fanGlow.position.set(0,.035,-.2);body.add(fanGlow);
  let doorOpen=0,wingOpen=0;
  function animate(dt:number,state:{steer:number;braking:boolean;speedKmh:number;showcase:boolean;stuntRoll:number},suspension:number) {
    const roll=state.stuntRoll;
    body.rotation.z=roll;body.position.set(-.65*Math.sin(roll),.65*(1-Math.cos(roll))+suspension,0);
    doorOpen+=(Number(state.showcase)-doorOpen)*(1-Math.exp(-dt*4));
    for(const door of parts.doors){door.rotation.x=.95*doorOpen;door.rotation.z=-door.userData.side*.35*doorOpen;}
    wingOpen+=((state.showcase?1:state.braking?Math.min(1,state.speedKmh/180):0)-wingOpen)*(1-Math.exp(-dt*7));
    parts.spoiler.rotation.x=.8*wingOpen;parts.spoiler.position.y=parts.spoiler.userData.restY+.06*wingOpen;
    for(const strut of parts.aeroStruts){strut.scale.y=.03+.22*wingOpen;strut.position.y=.96+.11*wingOpen;}
    parts.yoke.rotation.z=state.steer*.35;
    for(const light of parts.brakeLights)light.emissiveIntensity=state.braking?2.5:.8;
  }
  return {root,body,wheels,sockets,fanDisc,fanGlow,animate};
}
