// Dev-only review scene: the actual KartModel with the game's material environment.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { KartModel } from "../src/race/kartModel";
import { prepareRoadsterEnvironment } from "../src/race/roadsterEnvironment";

const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector("canvas")!, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xaebbc6);
const camera = new THREE.PerspectiveCamera(38, innerWidth/innerHeight,.1,100);
const room = new RoomEnvironment(); const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(room,.04).texture; room.dispose(); pmrem.dispose();
prepareRoadsterEnvironment(renderer);
scene.add(new THREE.HemisphereLight(0xc7d9f0,0x45483f,1.25));
const sun=new THREE.DirectionalLight(0xfff1dc,2.6);sun.position.set(-5,8,-3);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-5;sun.shadow.camera.right=5;sun.shadow.camera.top=5;sun.shadow.camera.bottom=-5;sun.shadow.normalBias=.015;scene.add(sun);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x777e83,roughness:.94}));
ground.rotation.x=-Math.PI/2;ground.position.y=-.01;ground.receiveShadow=true;scene.add(ground);
const model=new KartModel({color:0xf4f4f4,accent:0,helmet:0,number:1},true,"roadster");scene.add(model.root);
const views:Record<string,number[]>={rear:[0,2.6,-7.5],quarter:[4.9,2.7,-6.7],side:[7.5,1.65,0],front:[4.6,2.6,6.8]};
let flying=false;
const render=()=>{ model.animate(0,0,0,0,0,0,flying);renderer.render(scene,camera); };
const view=(name:string)=>{const p=views[name];camera.position.set(p[0],p[1],p[2]);camera.lookAt(0,.65,0);render();};
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(b=>b.onclick=()=>view(b.dataset.view!));
document.querySelector<HTMLButtonElement>("#flight")!.onclick=()=>{flying=!flying;model.root.position.y=flying?.8:0;render();};
view("quarter");
Object.assign(window,{__roadsterReview:{model,scene,camera,renderer,view,render}});
