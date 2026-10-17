"""Local visual evidence only: video frames beside fixed-camera model renders.
No image synthesis, retouching, perspective warping or altered paint colours.
Run after render-roadster.cjs baseline/final. The source clip stays local.
"""
from pathlib import Path
import json
import cv2
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
out = root / "checks/roadster-video"
out.mkdir(parents=True, exist_ok=True)
font_path = "C:/Windows/Fonts/msyh.ttc"
font = ImageFont.truetype(font_path, 22)
small = ImageFont.truetype(font_path, 15)
title = ImageFont.truetype(font_path, 32)
canvas = Image.new("RGB", (1440, 900), "#101a25")
draw = ImageDraw.Draw(canvas)
draw.text((28, 20), "ROADSTER 2  /  视频对照与模型迭代", font=title, fill="#edf4fa")
draw.text((28, 70), "相同几何用于游戏与预览 · 仅裁切与等比缩放 · 视频与预览的镜头、光照不同", font=small, fill="#9aafc4")
for x, name in [(24, "参考视频 6258.mp4"), (504, "修改前 · 白色同角度"), (984, "优化后 · 同一游戏模型")]:
    draw.text((x, 110), name, font=font, fill="#d6e7f6")

video = cv2.VideoCapture(str(root / "6258.mp4"))
def frame(t):
    video.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, bgr = video.read()
    if not ok:
        raise RuntimeError(f"Cannot decode frame at {t}s")
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))

def panel(im, x, y, caption):
    scale = min(448 / im.width, 285 / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
    canvas.paste(im, (x + (448-im.width)//2, y + (285-im.height)//2))
    draw.text((x+5, y+297), caption, font=small, fill="#afc7dc")

rows = [
    ("rear", 5, (390,310,575,455), (290,235,670,505), 154,
     "后视：长黑玻璃、红色细灯、窄梯形尾板"),
    ("quarter", 24, (355,305,675,505), (260,225,790,520), 502,
     "侧后：白色后翼子板、窄侧窗、贴合式尾翼"),
]
for view, t, reference_crop, render_crop, y, caption in rows:
    panel(frame(t).crop(reference_crop), 24, y, f"{t:.0f}s · {caption}")
    panel(Image.open(out / "baseline" / f"{view}.png").crop(render_crop), 504, y, "初版：短玻璃舱、黑色外置翼、外露喷口")
    panel(Image.open(out / "final" / f"{view}.png").crop(render_crop), 984, y, "重建：连续玻璃、白色贴合翼、喷口内收")
video.release()
draw.text((28, 867), "车头与底盘在视频中缺少清晰正面展示；保留视觉近似，不声称逐像素一致。", font=small, fill="#94acbf")
canvas.save(out / "comparison.png")
stats = {name: json.loads((out / name / "render.json").read_text()) for name in ["baseline", "iteration-1", "iteration-2", "iteration-3", "iteration-4", "final"]}
(out / "iterations.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
print(out / "comparison.png")
