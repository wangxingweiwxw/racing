// 程序化贴图（canvas）：窗格、光斑、噪声、霓虹招牌、车牌。
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32 } from './layout.ts';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

const CJK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif';

/** 8×8 窗格：亮窗暖/冷混合，暗窗为深蓝玻璃。同一张图同时用作 map 和 emissiveMap。 */
export function windowTexture(seed: number, lit: number, warm: [number, number, number], cool: [number, number, number], frame = '#1a1f26'): CanvasTexture {
  const rng = mulberry32(seed);
  const [c, g] = canvas(256, 256);
  g.fillStyle = frame;
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const on = rng() < lit;
      const k = 0.55 + rng() * 0.45;
      const col = rng() < 0.6 ? warm : cool;
      g.fillStyle = on ? `rgb(${col[0] * k},${col[1] * k},${col[2] * k})` : `rgb(${12 + rng() * 10},${18 + rng() * 10},${28 + rng() * 14})`;
      g.fillRect(x * 32 + 3, y * 32 + 4, 26, 24);
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** 湿路面的粗糙度噪声：大块水洼 + 细颗粒。 */
export function wetRoughnessTexture(seed: number): CanvasTexture {
  const rng = mulberry32(seed);
  const [c, g] = canvas(256, 256);
  g.fillStyle = 'rgb(225,225,225)';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6; i++) {
    const x = rng() * 256;
    const y = rng() * 256;
    const r = 10 + rng() * 34;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(40,40,40,0.9)');
    grd.addColorStop(1, 'rgba(40,40,40,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * 40;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export function paverTexture(): CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#4a4b4e';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(20,20,22,0.7)';
  g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 128);
    g.moveTo(0, i);
    g.lineTo(128, i);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

const SIGN_TEXTS = ['百货商店', '老字号', '照相馆', '点心酒家', '钟表眼镜', '新华书店', '丝绸布庄', '茶叶店'];
const SIGN_COLORS = ['#ff2d55', '#ffcc00', '#00e5ff', '#ff6a00', '#b84dff', '#34ff8a', '#ff4fd8', '#4d7cff'];

/** 8 块竖向霓虹招牌拼成一张 1024×512 图集（每块 128×512）。 */
export function signAtlas(): CanvasTexture {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 512);
  SIGN_TEXTS.forEach((text, i) => {
    const x = i * 128;
    const col = SIGN_COLORS[i];
    g.fillStyle = '#0b0b10';
    g.fillRect(x + 8, 8, 112, 496);
    g.strokeStyle = col;
    g.lineWidth = 6;
    g.shadowColor = col;
    g.shadowBlur = 14;
    g.strokeRect(x + 14, 14, 100, 484);
    g.fillStyle = '#ffffff';
    g.font = `bold 84px ${CJK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const chars = [...text];
    const step = 460 / chars.length;
    chars.forEach((ch, k) => {
      g.shadowBlur = 18;
      g.fillStyle = col;
      g.fillText(ch, x + 64, 36 + step * (k + 0.5));
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillText(ch, x + 64, 36 + step * (k + 0.5));
    });
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** 新能源车牌：白→浅绿渐变底、黑字 */
export function plateTexture(text: string): CanvasTexture {
  const [c, g] = canvas(256, 64);
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#f6faf3');
  grd.addColorStop(1, '#8fdc9a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#2c2f33';
  g.lineWidth = 3;
  g.strokeRect(4, 4, 248, 56);
  g.fillStyle = '#16181b';
  g.font = `bold 40px ${CJK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** 东方明珠球体：横向亮点灯带。 */
export function pearlTexture(): CanvasTexture {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#3a0820';
  g.fillRect(0, 0, 256, 128);
  for (let y = 6; y < 128; y += 10) {
    for (let x = 0; x < 256; x += 8) {
      g.fillStyle = y % 20 === 6 ? '#ff7ac8' : '#ffd1ec';
      g.fillRect(x + 2, y, 3, 3);
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Fine aggregate and faint repaired seams, tiled with mipmaps on the road. */
export function asphaltTexture(): CanvasTexture {
  const [c,g]=canvas(256,256),rng=mulberry32(81),pixels=g.createImageData(256,256);
  for(let i=0;i<pixels.data.length;i+=4){const v=92+rng()*24;pixels.data[i]=v;pixels.data[i+1]=v+2;pixels.data[i+2]=v+4;pixels.data[i+3]=255;}
  g.putImageData(pixels,0,0);g.strokeStyle='rgba(30,35,39,.16)';g.lineWidth=1.5;
  g.beginPath();g.moveTo(0,85);g.lineTo(80,83);g.lineTo(150,89);g.lineTo(256,86);g.stroke();
  const t=new CanvasTexture(c);t.wrapS=t.wrapT=RepeatWrapping;t.colorSpace=SRGBColorSpace;t.anisotropy=4;return t;
}
