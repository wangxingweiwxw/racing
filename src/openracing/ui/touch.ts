import type { Input } from '../input.ts';

export function buildTouch(input:Input) {
  const host=document.createElement('div');host.id='street-touch';document.getElementById('hud')!.append(host);
  const held=new Map<string,Set<number>>();
  const update=()=>{
    const down=(key:string)=>(held.get(key)?.size??0)>0;
    input.touch.steer=Number(down('right'))-Number(down('left'));
    input.touch.throttle=Number(down('throttle'))-Number(down('brake'));
    for(const key of ['hop','boost','fan','handbrake','action'] as const)input.touch[key]=down(key);
  };
  for(const [key,label,title] of [['left','‹','向左转向'],['right','›','向右转向'],['throttle','加速','加速'],['brake','刹车','刹车 / 倒车，高速自动前喷气减速'],['hop','起飞','按住悬停，松开喷气软着陆'],['boost','推进','后部冷气推进'],['fan','吸附','吸附爬楼，驶出楼顶自动翻正着陆'],['handbrake','漂移','手刹漂移 / 手动横滚'],['action','展车','停车展车 / 空中翻滚']]) {
    const button=document.createElement('button');button.type='button';button.dataset.control=key;button.textContent=label;button.setAttribute('aria-label',title);button.title=title;
    const ids=new Set<number>();held.set(key,ids);host.append(button);
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);ids.add(e.pointerId);button.classList.add('active');update();});
    const release=(e:PointerEvent)=>{ids.delete(e.pointerId);button.classList.toggle('active',ids.size>0);update();};
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,release as EventListener);
  }
  document.addEventListener('openracing-reset-controls',()=>{held.forEach(ids=>ids.clear());host.querySelectorAll('button').forEach(b=>b.classList.remove('active'));update();});
}
