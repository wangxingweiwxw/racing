#!/usr/bin/env python3
"""Convert Open Street Kart materials (CC-BY-SA 4.0, Picorims) to web-sized textures."""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSK = os.environ.get("OSK_DIR", os.path.join(os.path.dirname(ROOT), "open-street-kart"))
OUT = os.path.join(ROOT, "public", "textures")
os.makedirs(OUT, exist_ok=True)

SOURCES = {
    "asphalt": "materials/environment/road/asphalt/asphalt_v3",
    "grass": "materials/environment/terrain/grass_v2",
    "forest_floor": "materials/environment/terrain/forest_floor",
    "field": "materials/environment/terrain/field_floor",
    "rock": "materials/environment/terrain/rock",
    "scrub": "materials/environment/terrain/scrub",
    "render": "materials/environment/building/render/render",
}
for name, rel in SOURCES.items():
    if name == "asphalt":
        continue  # see asphalt_clean below
    for kind in ("albedo", "normal"):
        src = os.path.join(OSK, rel + f"_{kind}.png")
        if not os.path.exists(src):
            print("missing", src)
            continue
        im = Image.open(src).convert("RGB")
        size = 1024 if name == "grass" else 512
        im = im.resize((size, size), Image.LANCZOS)
        im.save(os.path.join(OUT, f"{name}_{kind}.jpg"), quality=88, optimize=True)
        print(name, kind, os.path.getsize(os.path.join(OUT, f"{name}_{kind}.jpg")))
for f in ("item_slot_speed_boost.png", "item_slot_air_bomb.png"):
    Image.open(os.path.join(OSK, "textures/hud/slot_item", f)).save(os.path.join(OUT, f), optimize=True)

# The OSK asphalt has urban lane markings. Crop a clean band and mirror it so it
# tiles horizontally; the Nordschleife edge lines are painted by the road shader.
for kind in ("albedo", "normal"):
    im = Image.open(os.path.join(OSK, SOURCES["asphalt"] + f"_{kind}.png")).convert("RGB")
    w, h = im.size
    band = im.crop((int(w * 0.655), 0, int(w * 0.975), h))
    mirrored = band.transpose(Image.FLIP_LEFT_RIGHT)
    if kind == "normal":
        # flipping X inverts the red (tangent x) channel of a normal map
        r, g, b = mirrored.split()
        mirrored = Image.merge("RGB", (r.point(lambda v: 255 - v), g, b))
    out = Image.new("RGB", (band.width * 2, h))
    out.paste(band, (0, 0))
    out.paste(mirrored, (band.width, 0))
    out = out.resize((1024, 1024), Image.LANCZOS)
    out.save(os.path.join(OUT, f"asphalt_clean_{kind}.jpg"), quality=88, optimize=True)
    print("asphalt_clean", kind)
