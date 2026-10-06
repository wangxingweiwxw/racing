"""Convert the supplied U9 Xtreme KN5 + metallic-red skin to two web-ready GLBs.

Requires Pillow and assetto-corsa-gltf==1.0.0 (MIT).
Source converter: https://github.com/semiloker/assetto-corsa-gltf
The supplied car remains credited to GeroDa74 / ACTK; no source MOD is bundled.
"""
from pathlib import Path
import io
import json
import struct
import tempfile
from PIL import Image
from acgltf import kn5
from acgltf.convert import convert

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "gd_yangwang_u9"
OUTPUT = ROOT / "public/models/u9x"


def pack(directory, name, cap):
    gltf = json.loads((directory / f"{name}.gltf").read_text())
    binary = bytearray((directory / f"{name}.bin").read_bytes())
    for image in gltf.get("images", []):
        with Image.open(directory / image.pop("uri")) as im:
            im.thumbnail((cap, cap), Image.Resampling.LANCZOS)
            stream = io.BytesIO()
            im.save(stream, format="PNG", optimize=True)
        binary.extend(b"\0" * (-len(binary) % 4))
        data = stream.getvalue()
        image["bufferView"] = len(gltf["bufferViews"])
        image["mimeType"] = "image/png"
        gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)})
        binary.extend(data)
    gltf["buffers"] = [{"byteLength": len(binary)}]
    gltf["asset"]["copyright"] = "U9 Xtreme model: GeroDa74; LODs: ACTK. User-supplied Assetto Corsa mod."
    # AC multi-map shaders tint white AO maps with a secondary detail layer.
    # Preserve those darker surface finishes when translating to PBR.
    for material in gltf["materials"]:
        material_name = material.get("name", "").lower()
        pbr = material["pbrMetallicRoughness"]
        if any(key in material_name for key in ["carbon", "carb_", "blk_parts", "engine", "cabin", "leather", "int_paint", "under", "grid", "grille", "exhaust_semigloss"]):
            pbr["baseColorFactor"] = [0.022, 0.027, 0.034, 1]
            pbr["metallicFactor"] = 0.18
            pbr["roughnessFactor"] = 0.42
        if material_name in ["tire", "mi_changea_rim", "innerrim", "ext_gloss"]:
            pbr["baseColorFactor"] = [0.025, 0.03, 0.038, 1]
            pbr["roughnessFactor"] = 0.8 if material_name == "tire" else 0.3
    # AC's front is +Z; the game also uses +Z. Remove the converter's half turn.
    gltf["nodes"][gltf["scenes"][0]["nodes"][0]]["matrix"] = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
    body = json.dumps(gltf, separators=(",", ":")).encode()
    body += b" " * (-len(body) % 4)
    binary.extend(b"\0" * (-len(binary) % 4))
    data = struct.pack("<III", 0x46546C67, 2, 28 + len(body) + len(binary))
    data += struct.pack("<II", len(body), 0x4E4F534A) + body
    data += struct.pack("<II", len(binary), 0x004E4942) + binary
    (OUTPUT / f"{name}.glb").write_bytes(data)
    return {"file": f"{name}.glb", "bytes": len(data), "textureMaxSize": cap,
            "triangles": sum(gltf["accessors"][p["indices"]]["count"] // 3 for m in gltf["meshes"] for p in m["primitives"])}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    original_load = kn5.load
    embedded = original_load(str(SOURCE / "gd_yangwang_u9.kn5"), geometry=False).textures

    def load_with_shared_textures(path, **kwargs):
        model = original_load(path, **kwargs)
        if not model.textures:
            model.textures = list(embedded)
        return model

    kn5.load = load_with_shared_textures
    variants = []
    try:
        for suffix, name, cap in [("", "u9x", 1024), ("_lod_b", "u9x-lod", 512)]:
            with tempfile.TemporaryDirectory() as temp:
                convert([{"file": str(SOURCE / f"gd_yangwang_u9{suffix}.kn5"), "pos": [0.0]*3, "rot": [0.0]*3}], temp, name,
                        False, False, None, skin=str(SOURCE / "skins/red_met"))
                variants.append(pack(Path(temp), name, cap))
    finally:
        kn5.load = original_load
    (OUTPUT / "manifest.json").write_text(json.dumps({"vehicle": "Yangwang U9 Xtreme", "source": "gd_yangwang_u9", "variants": variants}, indent=2) + "\n")
    print(json.dumps(variants, indent=2))


if __name__ == "__main__":
    main()
