// Original geometry refined against 6258.mp4 and the October 16 walk-around videos.
// +Z is the nose. All measurements are visual estimates, not factory dimensions.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Section = number[];
const lerp = THREE.MathUtils.lerp;
function sample(sections: Section[], z: number): number[] {
  let i = 0;
  while (i < sections.length - 2 && sections[i + 1][0] < z) i++;
  const a = sections[i], b = sections[i + 1];
  const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  const prev=sections[Math.max(0,i-1)],next=sections[Math.min(sections.length-1,i+2)];
  return a.map((v,k)=>{
    if(k===0)return lerp(v,b[k],t);
    const span=b[0]-a[0],m0=(b[k]-prev[k])/(b[0]-prev[0]),m1=(next[k]-a[k])/(next[0]-a[0]);
    const value=(2*t**3-3*t*t+1)*v+(t**3-2*t*t+t)*span*m0+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*span*m1;
    return THREE.MathUtils.clamp(value,Math.min(v,b[k]),Math.max(v,b[k]));
  });
}

export function buildRoadster(color: number, roadsterEnvironment: THREE.Texture | null = null) {
  const car = new THREE.Group(); car.name = "Roadster 2 · October video references";
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: .12, roughness: .27, clearcoat: .85, clearcoatRoughness: .2, envMapIntensity: 1.05, envMap: roadsterEnvironment });
  paint.name = "Pearl body paint";
  const doorPaint=paint.clone();doorPaint.side=THREE.DoubleSide;doorPaint.name="Pearl door skin";
  const carbon = new THREE.MeshStandardMaterial({ color: 0x10141a, metalness: .1, roughness: .55 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x030710, metalness: 0, roughness: .23, clearcoat: .25, clearcoatRoughness: .22, envMapIntensity: .27, envMap: roadsterEnvironment });
  glass.name = "Continuous tinted glass";
  const windowGlass = glass.clone(); windowGlass.name = "Smoked cabin glazing";
  windowGlass.transparent = true; windowGlass.opacity = .58; windowGlass.depthWrite = false; windowGlass.side = THREE.DoubleSide;
  const ivory = new THREE.MeshStandardMaterial({color:0xeee9dd,roughness:.65}); ivory.name="Ivory cabin upholstery";
  const screen = new THREE.MeshStandardMaterial({color:0x071116,roughness:.18,emissive:0x0b3142,emissiveIntensity:.5}); screen.name="Cockpit display";
  const rubber = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: .91 });
  const silver = new THREE.MeshStandardMaterial({ color: 0x9ba2aa, metalness: .85, roughness: .32 });
  const wheelDark = new THREE.MeshStandardMaterial({ color: 0x252a30, metalness: .65, roughness: .36 });
  const rotor = new THREE.MeshStandardMaterial({ color: 0x62656b, metalness: .7, roughness: .6 });
  const caliper = new THREE.MeshStandardMaterial({ color: 0x6c2423, metalness: .2, roughness: .5 });
  const brake = new THREE.MeshStandardMaterial({ color: 0xc20413, emissive: 0xff0718, emissiveIntensity: .8, roughness: .24 });
  const led = new THREE.MeshStandardMaterial({ color: 0xe6f1ff, emissive: 0xddeaff, emissiveIntensity: 1.5 });
  const plateWhite = new THREE.MeshStandardMaterial({ color: 0xe9ebde, roughness: .7 });
  const plateMark = new THREE.MeshStandardMaterial({ color: 0xdab94e, roughness: .6 });
  const wheels: THREE.Object3D[] = [], frontPivots: THREE.Object3D[] = [], rearWheelsLocal: THREE.Vector3[] = [], jets: THREE.Mesh[] = [];
  const doors = [-1,1].map(side=>{const d=new THREE.Group();d.name=side<0?"Left butterfly door":"Right butterfly door";d.userData.side=side;car.add(d);return d;});
  const doorFor=(s:number)=>doors[s<0?0:1];
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, x=0, y=0, z=0, parent: THREE.Object3D=car, name="") => {
    const m = new THREE.Mesh(g, mat===paint&&doors.includes(parent as THREE.Group)?doorPaint:mat); m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; m.name=name; parent.add(m); return m;
  };
  const box = (w:number,h:number,d:number,mat:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=car) => mesh(new THREE.BoxGeometry(w,h,d),mat,x,y,z,parent);
  const surface = (vertices:number[],indices:number[],mat:THREE.Material,parent:THREE.Object3D=car,name="") => {
    const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return mesh(g,mat,0,0,0,parent,name);
  };
  const ribbon = (points:number[][],radius:number,mat:THREE.Material,parent:THREE.Object3D=car) => {
    const path=new THREE.CurvePath<THREE.Vector3>();
    for(let i=1;i<points.length;i++)path.add(new THREE.LineCurve3(new THREE.Vector3(...points[i-1] as [number,number,number]),new THREE.Vector3(...points[i] as [number,number,number])));
    return mesh(new THREE.TubeGeometry(path,Math.max(12,points.length*3),radius,5,false),mat,0,0,0,parent);
  };
  // Wide rising rear haunches, short nose, long wheelbase. Separate longitudinal
  // surface bands preserve shoulder creases instead of averaging into a blob.
  const body:Section[]=[[-2.34,.92,.94,.955],[-2.12,1.015,.995,.98],[-1.42,1.065,.985,.98],[-.82,1.025,.955,.95],[-.1,.975,.92,.9],[.6,.97,.85,.8],[1.4,1.015,.84,.735],[1.92,.96,.685,.61],[2.34,.82,.505,.49]];
  const bottom=(z:number)=>{
    let y=.225 + THREE.MathUtils.clamp((-z-1.83)/.51,0,1)*.285;
    for(const axle of [-1.4,1.4]) { const d=Math.abs(z-axle); if(d<.435)y=Math.max(y,.37+Math.sqrt(.435**2-d**2)); }
    return y;
  };
  const ring=(z:number)=>{
    const [,w,h,t]=sample(body,z),lo=bottom(z);
    return [[-w*.96,lo],[-w,Math.max(lo+.005,h-.13)],[-w*.987,Math.max(lo+.015,h-.045)],[-w*.945,h],[-w*.8,h+.008],[-w*.59,t],[0,t+.008],[w*.59,t],[w*.8,h+.008],[w*.945,h],[w*.987,Math.max(lo+.015,h-.045)],[w,Math.max(lo+.005,h-.13)],[w*.96,lo]];
  };
  for(let band=0;band<12;band++) {
    const outer=band<=3||band>=8;
    for(const [za,zb] of [[-2.34,-.99],[-.99,.78],[.78,2.34]]) {
      if(za===-.99&&!outer)continue; // Open cabin tub rather than body paint through the seats.
      const p:number[]=[],idx:number[]=[],N=Math.ceil((zb-za)*24);
      for(let i=0;i<=N;i++) {
        const z=lerp(za,zb,i/N),r=ring(z);
        for(const j of [band,band+1])p.push(r[j][0],r[j][1],z);
        if(i<N){const a=i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}
      }
      surface(p,idx,paint,outer&&za===-.99?doorFor(band<=3?-1:1):car,"Body shoulder band");
    }
  }
  for(const z of [-2.34,2.34]) {
    const r=ring(z),shape=new THREE.Shape();r.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
    const cap=mesh(new THREE.ShapeGeometry(shape),paint,0,0,z);if(z<0)cap.rotation.y=Math.PI;
  }
  // Continuous flat floor closes the cabin underside during the roll animation.
  box(1.78,.13,3.8,carbon,0,.18,0);
  box(1.3,.015,2.08,wheelDark,0,.108,0);
  for(const z of [-1.3,-.82,0,.82,1.3])box(1.6,.018,.026,carbon,0,.095,z);
  for(const x of [-.73,.73])box(.035,.035,3.55,wheelDark,x,.108,0);
  for(const z of [-1.5,1.5])box(.76,.045,.32,carbon,0,.09,z);
  for(const s of [-1,1]) {
    // Slim dark sill, with white body above instead of a bolt-on silver running board.
    box(.12,.1,1.85,carbon,s*.96,.215,0);
    ribbon([[s*.977,.31,.94],[s*.985,.32,-.78]],.008,paint);
    const seam=(z:number,y:number)=>[s*(sample(body,z)[1]+.003),y,z];
    ribbon([seam(.77,.78),seam(.79,.46),seam(.58,.31),seam(-.79,.32),seam(-.95,.5),seam(-.95,.88)],.0025,carbon,doorFor(s));
    const handle=box(.008,.018,.14,wheelDark,s*1.018,.88,-.66,doorFor(s));handle.rotation.z=s*.05;
    box(.02,.29,1.48,carbon,s*.93,.57,-.08,doorFor(s));
    box(.065,.045,.6,ivory,s*.89,.65,-.08,doorFor(s));
    // Small recessed fender vent behind the front axle.
    const vent=box(.008,.04,.18,carbon,s*.98,.79,.97);vent.rotation.x=-.12;
  }
  // One low teardrop greenhouse, tapering into a long black rear glass panel.
  // z, roof half-width, roof Y, sill half-width, sill Y
  const cabin:Section[]=[[-1.94,.5,.992,.84,.985],[-1.38,.58,1.085,.92,.96],[-.84,.61,1.205,.94,.95],[-.3,.615,1.245,.925,.92],[.16,.595,1.195,.9,.89],[.84,.71,.803,.75,.8]];
  const cabinPoint=(z:number,t:number,s:number,offset=0)=>{
    const [,w,y,bw,by]=sample(cabin,z);
    return [s*(lerp(bw,w,t)+offset),lerp(by,y,t),z];
  };
  for(const s of [-1,1]) {
    for(const [za,zb] of [[-1.94,-.99],[-.99,.65],[.65,.84]]) {
      const p:number[]=[],idx:number[]=[],N=Math.ceil((zb-za)*32);
      // Window openings are real holes; only the lower door skin remains behind glass.
      for(let i=0;i<=N;i++){
        const z=lerp(za,zb,i/N),isDoor=za===-.99;
        p.push(...cabinPoint(z,0,s),...cabinPoint(z,isDoor?.13:1,s));
        if(i<N){const a=i*2; if(s>0)idx.push(a,a+1,a+2,a+1,a+3,a+2);else idx.push(a,a+2,a+1,a+1,a+2,a+3);}
      }
      surface(p,idx,paint,za===-.99?doorFor(s):car,"White sail pillar");
    }
    // Flush narrow side glass, inset so the white A/C pillars remain continuous.
    const windowShape:Section[]=[[-.99,.19,.23],[-.78,.13,.72],[-.48,.12,.92],[.12,.14,.92],[.65,.15,.2]];
    const wp:number[]=[],wi:number[]=[],WN=54;
    for(let i=0;i<=WN;i++) {
      const z=lerp(-.99,.65,i/WN),[,bt,tt]=sample(windowShape,z);
      wp.push(...cabinPoint(z,bt,s,.004),...cabinPoint(z,tt,s,.004));
      if(i<WN){const a=i*2;if(s>0)wi.push(a,a+1,a+2,a+1,a+3,a+2);else wi.push(a,a+2,a+1,a+1,a+2,a+3);}
    }
    surface(wp,wi,windowGlass,doorFor(s),"Flush side window");
    for(const upper of [false,true]) {
      const p:number[]=[];
      for(let i=0;i<=WN;i++) {
        const z=lerp(-.99,.65,i/WN),[,bt,tt]=sample(windowShape,z);
        p.push(...cabinPoint(z,upper?tt:.13,s),...cabinPoint(z,upper?1:bt,s));
      }
      surface(p,wi,paint,doorFor(s),"Window surround");
    }
    const windowRim:number[][]=[];
    for(const [z,,t] of windowShape)windowRim.push(cabinPoint(z,t,s,.005));
    ribbon(windowRim,.012,carbon,doorFor(s));
    // Buttress vent visible alongside the tapering rear screen in chase view.
    const vp=[...cabinPoint(-1.48,.55,s,.006),...cabinPoint(-1.27,.86,s,.006),...cabinPoint(-.96,.86,s,.006),...cabinPoint(-1.05,.55,s,.006)];
    surface(vp,s>0?[0,1,2,0,2,3]:[0,2,1,0,3,2],carbon);
    ribbon([[s*.86,.86,.57],[s*1.015,.89,.64]],.018,carbon,doorFor(s));
    const mirror=mesh(new THREE.SphereGeometry(1,16,8),paint,s*1.055,.9,.64,doorFor(s));mirror.scale.set(.115,.045,.075);
    const mirrorGlass=box(.008,.045,.106,glass,s*1.14,.905,.628,doorFor(s));mirrorGlass.rotation.y=s*.1;
  }
  // Sculpted white two-seat cabin, yoke and portrait screen seen in 213456.mp4.
  box(1.65,.05,1.8,carbon,0,.32,-.12);
  for(const s of [-1,1]) {
    const seat=new THREE.Group();seat.name=s<0?"Driver ivory seat":"Passenger ivory seat";seat.position.set(s*.38,0,-.3);car.add(seat);
    const cushion=mesh(new THREE.SphereGeometry(1,18,10),ivory,0,.46,0,seat);cushion.scale.set(.25,.045,.32);
    const back=mesh(new THREE.SphereGeometry(1,18,10),ivory,0,.76,-.29,seat);back.scale.set(.245,.31,.045);back.rotation.x=-.18;
    const head=mesh(new THREE.SphereGeometry(1,16,8),ivory,0,1.025,-.34,seat);head.scale.set(.14,.12,.065);
    for(const x of [-.215,.215]){const bolster=mesh(new THREE.SphereGeometry(1,12,8),ivory,x,.57,-.04,seat);bolster.scale.set(.05,.12,.28);}
    ribbon([[s*.15,.54,-.05],[s*.18,.79,-.3],[s*.15,1,-.33]],.012,carbon,seat);
  }
  box(.15,.16,1.12,carbon,0,.49,-.04);
  box(1.48,.1,.23,carbon,0,.76,.62);
  const display=box(.18,.235,.025,screen,.03,.82,.48);display.rotation.x=-.2;
  for(let i=0;i<5;i++)box(.105-i*.012,.004,.002,led,.03,.89-i*.027,.458);
  const yoke=new THREE.Group();yoke.name="Ivory steering yoke";yoke.position.set(-.38,.83,.43);car.add(yoke);
  ribbon([[-.13,.12,0],[-.19,.06,0],[-.16,-.1,0],[.16,-.1,0],[.19,.06,0],[.13,.12,0]],.022,ivory,yoke);
  box(.22,.065,.035,carbon,0,-.015,0,yoke);
  const roofP:number[]=[],roofI:number[]=[],RN=84,RW=10;
  for(let i=0;i<=RN;i++) {
    const z=lerp(-1.925,.827,i/RN),[,w,y]=sample(cabin,z);
    for(let j=0;j<=RW;j++){const u=2*j/RW-1;roofP.push(u*(w-.012),y+.004+.014*(1-u*u),z);}
    if(i<RN)for(let j=0;j<RW;j++){const a=i*(RW+1)+j,b=a+RW+1;roofI.push(a,b,a+1,a+1,b,b+1);}
  }
  // Split the windshield so the cockpit can be viewed without a black opaque pane.
  const frontIndices:number[]=[],rearIndices:number[]=[];
  for(let k=0;k<roofI.length;k+=3){const z=roofP[roofI[k]*3+2];(z>.1?frontIndices:rearIndices).push(...roofI.slice(k,k+3));}
  surface(roofP,rearIndices,glass,car,"Panoramic roof and rear screen");
  surface(roofP,frontIndices,windowGlass,car,"Smoked windshield");
  // Thin front lighting and a recessed intake, shaped around the wedge nose.
  box(1.59,.09,.025,carbon,0,.377,2.347);
  box(1.6,.024,.022,led,0,.505,2.35);
  for(const s of [-1,1]) {
    const strip=box(.15,.024,.022,led,s*.85,.495,2.28);strip.rotation.y=-s*.28;
    box(.095,.08,.025,carbon,s*.78,.31,2.34);
  }
  box(1.69,.032,.23,carbon,0,.224,2.24);
  // Shallow inset trapezoid rear panel, single red light ribbon and centred plate.
  const rearZ=-2.354;
  surface([-.934,.906,rearZ,.934,.906,rearZ,.82,.6,rearZ,-.82,.6,rearZ],[0,1,2,0,2,3],carbon,car,"Trapezoid rear fascia");
  box(1.86,.025,.022,brake,0,.936,-2.358);
  for(const s of [-1,1]) {const wrap=box(.024,.025,.16,brake,s*.943,.935,-2.275);wrap.rotation.y=s*.12;}
  ribbon([[-.82,.605,-2.366],[0,.585,-2.37],[.82,.605,-2.366]],.009,wheelDark);
  box(.36,.158,.016,wheelDark,0,.752,-2.37);
  box(.31,.123,.008,plateWhite,0,.752,-2.38);
  box(.047,.057,.009,plateMark,0,.753,-2.387);
  for(const x of [-.11,-.082,.075,.1])box(.009,.022,.01,carbon,x,.742,-2.39);
  surface([-.82,.59,-2.354,.82,.59,-2.354,-.73,.4,-2.28,.73,.4,-2.28],[0,1,2,1,3,2],carbon);
  box(1.5,.13,.3,carbon,0,.385,-2.16);
  for(const x of [-.64,-.4,0,.4,.64])box(.018,.075,.18,carbon,x,.36,-2.26);
  // White integrated ducktail with no exposed pylons, as in the video.
  const spoiler=new THREE.Group();spoiler.name="Active rear airbrake";spoiler.position.set(0,.982,-1.9);spoiler.userData.restY=.982;car.add(spoiler);
  surface([-1.015,0,.02,1.015,0,.02,-.94,.045,-.44,.94,.045,-.44,-.94,.02,-.44,.94,.02,-.44,-1.015,-.025,.02,1.015,-.025,.02],
    [0,1,2,1,3,2,2,3,4,3,5,4,4,5,6,5,7,6,6,7,0,7,1,0,0,2,6,2,4,6,1,7,3,3,7,5],paint,spoiler,"Integrated white ducktail");
  box(1.45,.018,.3,carbon,0,-.026,-.21,spoiler);
  const aeroStruts:THREE.Mesh[]=[];
  for(const s of [-1,1]){const strut=mesh(new THREE.CylinderGeometry(.014,.02,1,8),silver,s*.56,.96,-2.16);strut.name="Airbrake actuator";strut.userData.animated=true;strut.scale.y=.03;aeroStruts.push(strut);}
  // Rounded tyre shoulders and five broad aero blades. All wheel geometry stays
  // under spin groups; fixed calipers live on steering pivots.
  for(const z of [1.4,-1.4])for(const s of [-1,1]) {
    const trackHalf=z>0?.885:.925;
    const pivot=new THREE.Group();pivot.position.set(s*trackHalf,.37,z);pivot.name=z>0?"Front steering pivot":"Rear wheel pivot";car.add(pivot);
    const spin=new THREE.Group();spin.name="Wheel spin";pivot.add(spin);wheels.push(spin);
    if(z>0)frontPivots.push(pivot);else rearWheelsLocal.push(new THREE.Vector3(s*trackHalf,.02,z));
    const profile=[[-.14,.29],[-.145,.325],[-.128,.355],[-.1,.37],[.1,.37],[.128,.355],[.145,.325],[.14,.29]];
    const tyre=mesh(new THREE.LatheGeometry(profile.map(([x,r])=>new THREE.Vector2(r,x)),56),rubber,0,0,0,spin);tyre.rotation.z=Math.PI/2;
    const barrel=mesh(new THREE.CylinderGeometry(.29,.29,.255,48),wheelDark,0,0,0,spin);barrel.rotation.z=Math.PI/2;
    const disc=mesh(new THREE.CylinderGeometry(.24,.24,.015,48),rotor,s*.127,0,0,spin);disc.rotation.z=Math.PI/2;
    const rim=mesh(new THREE.TorusGeometry(.287,.009,6,56),silver,s*.153,0,0,spin);rim.rotation.y=Math.PI/2;
    for(let j=0;j<5;j++) {
      const a=j*Math.PI*2/5;
      const points=[[.065,-.04],[.279,-.12],[.28,.12],[.14,.05]];
      const p:number[]=[];for(const [r,t]of points)p.push(s*.163,Math.cos(a)*r-Math.sin(a)*t,Math.sin(a)*r+Math.cos(a)*t);
      surface(p,s>0?[0,1,2,0,2,3]:[0,2,1,0,3,2],paint,spin,"Five-spoke aero face");
      const inset=mesh(new THREE.BoxGeometry(.01,.19,.025),wheelDark,s*.168,Math.cos(a-.3)*.19,Math.sin(a-.3)*.19,spin);inset.rotation.x=a-.3;
    }
    const hub=mesh(new THREE.CylinderGeometry(.067,.067,.027,24),wheelDark,s*.167,0,0,spin);hub.rotation.z=Math.PI/2;
    for(let j=0;j<5;j++){const a=j*Math.PI*2/5;const bolt=mesh(new THREE.CylinderGeometry(.009,.009,.013,6),silver,s*.185,.043*Math.cos(a),.043*Math.sin(a),spin);bolt.rotation.z=Math.PI/2;}
    box(.065,.16,.085,caliper,s*.12,.1,.16,pivot);
    // Dark wheel-arch liner follows the actual opening, not a painted torus.
    const arch:number[][]=[];for(let j=0;j<=30;j++){const a=j*Math.PI/30;arch.push([s*(sample(body,z+.435*Math.cos(a))[1]-.025),.37+.433*Math.sin(a),z+.435*Math.cos(a)]);}
    ribbon(arch,.013,carbon);
  }
  // Hardware is tucked below the diffuser, not stuck onto the rear light panel.
  const nozzle=(x:number,y:number,z:number,aft:boolean)=>{
    const pod=new THREE.Group();pod.position.set(x,y,z);if(aft)pod.rotation.x=Math.PI/2;car.add(pod);
    mesh(new THREE.CylinderGeometry(.065,.085,.08,16,1,true),wheelDark,0,0,0,pod);
    const jetMat=new THREE.MeshBasicMaterial({color:0xddeeff,transparent:true,opacity:.11,depthWrite:false,side:THREE.DoubleSide});
    const jet=mesh(new THREE.ConeGeometry(.19,.75,16,1,true),jetMat,0,-.4,0,pod);jet.castShadow=false;jet.visible=false;jets.push(jet);
  };
  for(const x of [-.68,.68])for(const z of [-1.72,1.65])nozzle(x,.17,z,false);
  for(const x of [-.39,.39])nozzle(x,.38,-2.29,true);
  // Batch static pieces per material, keeping steering, wheels, lights and jets
  // independently animated. This also removes hundreds of unnecessary draw calls.
  const batch=(parent:THREE.Object3D)=>{
    const bins=new Map<THREE.Material,THREE.Mesh[]>();
    for(const child of [...parent.children]){
      if(child instanceof THREE.Mesh && !child.userData.animated && !Array.isArray(child.material) && !child.material.transparent){const list=bins.get(child.material)??[];list.push(child);bins.set(child.material,list);}
      else if(child instanceof THREE.Group)batch(child);
    }
    for(const [mat,list]of bins){
      if(list.length<2)continue;
      const geometries=list.map(m=>{m.updateMatrix();const g=m.geometry.clone().applyMatrix4(m.matrix);g.deleteAttribute("uv");return g.index?g.toNonIndexed():g;});
      const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
      if(!merged)continue;
      for(const m of list){parent.remove(m);m.geometry.dispose();}
      mesh(merged,mat,0,0,0,parent,mat.name||"Batched detail");
    }
  };
  // Move the complete door meshes to real hinges while preserving the closed pose.
  for(const door of doors){const pivot=new THREE.Vector3(door.userData.side*.82,.84,.78);for(const child of door.children)child.position.sub(pivot);door.position.copy(pivot);}
  batch(car);
  return {car,wheels,frontPivots,rearWheelsLocal,brakeLights:[brake],jets,spoiler,doors,yoke,aeroStruts};
}
