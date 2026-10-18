import * as THREE from 'three';

/** Photo-derived articulated wing. Lift and incidence are independent controls. */
export function buildRoadsterAero(car:THREE.Group,paint:THREE.Material,carbon:THREE.Material,silver:THREE.Material) {
  const rig=new THREE.Group();rig.name='Rear wing folding mechanism';car.add(rig);
  const spoiler=new THREE.Group();spoiler.name='Active rear airbrake';rig.add(spoiler);
  const nodes:THREE.Object3D[]=[spoiler];
  const mesh=(g:THREE.BufferGeometry,m:THREE.Material,parent:THREE.Object3D,name:string)=>{
    const o=new THREE.Mesh(g,m);o.name=name;o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
  };
  const span=[-1.035,-.8,-.45,0,.45,.8,1.035];
  const p:number[]=[],ix:number[]=[];
  span.forEach(x=>{
    const crown=Math.abs(x)>.7?.035:Math.abs(x)>.3?.055:0;
    const trailing=-.235+Math.abs(x)*.025;
    p.push(x,crown,.225,x,crown+.025,trailing,x,crown-.008,trailing,x,crown-.028,.225);
  });
  for(let i=0;i<span.length-1;i++)for(let j=0;j<4;j++){
    const a=i*4+j,b=i*4+(j+1)%4,c=a+4,d=b+4;ix.push(a,c,b,b,c,d);
  }
  ix.push(0,3,1,1,3,2,24,25,27,25,26,27);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();
  mesh(g,paint,spoiler,'Chevron wing blade');
  const underside=mesh(new THREE.BoxGeometry(1.8,.018,.35),carbon,spoiler,'Carbon wing underside');underside.position.y=-.023;
  for(const side of [-1,1]){
    const shape=new THREE.Shape();shape.moveTo(-.23,.04);shape.lineTo(.23,.035);shape.lineTo(.19,-.08);shape.lineTo(-.19,-.29);shape.closePath();
    // Shape X becomes fore/aft; extrusion becomes left/right.
    const endGeo=new THREE.ExtrudeGeometry(shape,{depth:.026,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.004,bevelThickness:.004});
    endGeo.rotateY(Math.PI/2);
    const end=mesh(endGeo,paint,spoiler,'White downward wing endplate');end.position.x=side*1.022-(side<0?.026:0);
  }
  const links:{object:THREE.Mesh;from:()=>THREE.Vector3;to:()=>THREE.Vector3}[]=[];
  const pins:{object:THREE.Mesh;at:()=>THREE.Vector3}[]=[];
  const struts:THREE.Mesh[]=[];
  let lift=0;
  const up=new THREE.Vector3(0,1,0),dir=new THREE.Vector3();
  for(const side of [-1,1]){
    const x=side*.59;
    const base=mesh(new THREE.BoxGeometry(.115,.04,.53),carbon,rig,'Wing mounting rail');base.position.set(x,.965,-2.09);
    const a=()=>new THREE.Vector3(x,.975,-1.88),b=()=>new THREE.Vector3(x,.975,-2.27);
    const top=(z:number)=>()=>new THREE.Vector3(x,-.035,z).applyQuaternion(spoiler.quaternion).add(spoiler.position);
    const knee=()=>new THREE.Vector3(x,1.005+lift*.19,-1.92-lift*.12);
    const bar=(from:()=>THREE.Vector3,to:()=>THREE.Vector3,name:string,metal=false,width=.025)=>{
      const o=mesh(new THREE.CylinderGeometry(width,width,1,8),metal?silver:carbon,rig,name);
      o.userData.animated=true;nodes.push(o);links.push({object:o,from,to});return o;
    };
    // Parallel open links and cross braces leave the triangular cut-outs visible.
    bar(a,knee,'Lower folding link');bar(b,knee,'Lower diagonal brace',false,.018);
    bar(knee,top(-.14),'Upper folding link');bar(knee,top(.14),'Upper triangular brace',false,.018);
    const actuator=bar(b,top(.13),'Wing lift actuator',true,.016);struts.push(actuator);
    bar(knee,top(-.18),'Wing incidence actuator',true,.012);
    for(const at of [a,b,knee,top(-.14),top(.14)]){
      const pin=mesh(new THREE.CylinderGeometry(.035,.035,.075,12),silver,rig,'Wing hinge pin');
      pin.rotation.z=Math.PI/2;pin.userData.animated=true;nodes.push(pin);pins.push({object:pin,at});
    }
  }
  const setAeroPose=(deployment:number,incidence:number)=>{
    lift=THREE.MathUtils.clamp(deployment,0,1);
    spoiler.position.set(0,1.015+.46*lift,-2.115-.045*lift);
    spoiler.rotation.x=THREE.MathUtils.clamp(incidence,0,1)*.65*lift;
    for(const link of links){
      const a=link.from(),b=link.to();link.object.position.copy(a).add(b).multiplyScalar(.5);
      dir.copy(b).sub(a);link.object.scale.y=dir.length();link.object.quaternion.setFromUnitVectors(up,dir.normalize());
    }
    for(const pin of pins)pin.object.position.copy(pin.at());
    spoiler.userData.restY=1.015;
  };
  setAeroPose(0,0);
  return {spoiler,aeroStruts:struts,aeroNodes:nodes,setAeroPose};
}
