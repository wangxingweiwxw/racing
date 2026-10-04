#!/usr/bin/env python3
"""Build Nürburgring Nordschleife game data from OpenStreetMap + elevation.

Port of the Open Street Kart track import workflow (docs/creating_a_track.md):
OSM data (Overpass) + an elevation raster are turned into local metric
coordinates, a road surface, a terrain heightmap and data driven decoration.

Inputs  (data/raw):
  nordschleife_rel.json  Overpass: relation 38566 + its ways (ordered, with geometry)
  raceway.json           Overpass: all highway=raceway ways around the circuit
  env.json / env_rels.json  Overpass: buildings, landuse, natural, roads, water
  terrarium/14_x_y.png   AWS Terrain Tiles (Terrarium encoding), zoom 14

Outputs (public/data):
  track.json      centre line, elevation, banking, width, racing line, sectors
  terrain.bin     Uint16 heightmap (cm above hMin), row-major, z rows then x
  landcover.png   RGB splat weights (R forest, G field, B urban/asphalt)
  landcover_rock.png  L weight: gravel / rock / water
  world.json      buildings, secondary roads, OSM single trees, places
  trees.bin       Int16 [x*4, z*4, scale*1000, kind] tree instances

Run: python3 tools/build_data.py
"""
import json
import math
import os
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter, gaussian_filter1d, distance_transform_edt, map_coordinates
from scipy.spatial import cKDTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "public", "data")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- projection
LAT0, LON0 = 50.3530, 6.9600  # local origin (roughly the centre of the loop)
R_EARTH = 6371008.8
COS0 = math.cos(math.radians(LAT0))

# terrain extent in lat/lon (same box the OSM environment query used)
BBOX = (50.318, 6.905, 50.388, 7.012)  # south, west, north, east
CELL = 8.0  # heightmap spacing in metres
LC_CELL = 4.0  # landcover spacing in metres

SAMPLE_STEP = 2.0  # metres between track samples
ROAD_HALF = 5.0  # Nordschleife is ~ 8-12 m wide
VERGE = 3.2  # grass/run-off between asphalt edge and guard rail


def to_local(lat, lon):
    x = R_EARTH * math.radians(lon - LON0) * COS0
    z = -R_EARTH * math.radians(lat - LAT0)
    return x, z


def to_local_np(lat, lon):
    x = R_EARTH * np.radians(lon - LON0) * COS0
    z = -R_EARTH * np.radians(lat - LAT0)
    return x, z


def from_local_np(x, z):
    lon = LON0 + np.degrees(x / (R_EARTH * COS0))
    lat = LAT0 - np.degrees(z / R_EARTH)
    return lat, lon


# ---------------------------------------------------------------- elevation
def load_dem():
    z = 14
    files = [f for f in os.listdir(os.path.join(RAW, "terrarium")) if f.endswith(".png")]
    xs = sorted({int(f.split("_")[1]) for f in files})
    ys = sorted({int(f.split("_")[2].split(".")[0]) for f in files})
    mosaic = np.zeros((len(ys) * 256, len(xs) * 256), dtype=np.float64)
    for j, ty in enumerate(ys):
        for i, tx in enumerate(xs):
            im = np.asarray(Image.open(os.path.join(RAW, "terrarium", f"{z}_{tx}_{ty}.png")).convert("RGB")).astype(np.float64)
            h = im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768
            mosaic[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = h
    n = 2 ** z

    def sample(lat, lon):
        px = ((lon + 180) / 360 * n - xs[0]) * 256 - 0.5
        lat_r = np.radians(lat)
        py = ((1 - np.arcsinh(np.tan(lat_r)) / math.pi) / 2 * n - ys[0]) * 256 - 0.5
        return map_coordinates(mosaic, [py, px], order=3, mode="nearest")

    return sample


dem = load_dem()

# ---------------------------------------------------------------- track centre line
rel_data = json.load(open(os.path.join(RAW, "nordschleife_rel.json")))
relation = [e for e in rel_data["elements"] if e["type"] == "relation"][0]
ways = {e["id"]: e for e in rel_data["elements"] if e["type"] == "way"}

pts = []  # (lat, lon)
way_marks = []  # (index into pts, name)
for m in relation["members"]:
    w = ways[m["ref"]]
    g = [(p["lat"], p["lon"]) for p in w["geometry"]]
    if pts and pts[-1] == g[0]:
        g = g[1:]
    way_marks.append((len(pts), w["tags"].get("name")))
    pts.extend(g)
if pts[0] == pts[-1]:
    pts.pop()

# rotate the loop so it starts at the T13 gantry (the Touristenfahrten start/finish)
start_idx = next(i for i, n in way_marks if n == "T13")
pts = pts[start_idx:] + pts[:start_idx]
way_marks = [((i - start_idx) % len(pts), n) for i, n in way_marks]
way_marks.sort()

P = np.array([to_local(a, b) for a, b in pts])  # N x 2 (x, z)


def catmull_rom_closed(points, step):
    """Centripetal Catmull-Rom through a closed polygon, resampled every `step` metres."""
    n = len(points)
    dense = []
    src_param = []  # original vertex index (float) per dense sample
    for i in range(n):
        p0, p1, p2, p3 = points[(i - 1) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]
        seg = np.linalg.norm(p2 - p1)
        k = max(2, int(math.ceil(seg / 0.5)))
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-3) ** 0.5
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-3) ** 0.5
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-3) ** 0.5
        for j in range(k):
            t = t1 + (t2 - t1) * j / k
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            c = (t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2
            dense.append(c)
            src_param.append(i + j / k)
    dense = np.array(dense)
    src_param = np.array(src_param)
    seglen = np.linalg.norm(np.diff(np.vstack([dense, dense[:1]]), axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seglen)])
    total = cum[-1]
    m = int(round(total / step))
    s = np.linspace(0, total, m, endpoint=False)
    dense_c = np.vstack([dense, dense[:1]])
    xs = np.interp(s, cum, dense_c[:, 0])
    zs = np.interp(s, cum, dense_c[:, 1])
    param = np.interp(s, cum, np.concatenate([src_param, [n]]))
    return np.stack([xs, zs], 1), param, total


# light pre-smoothing of OSM kinks (closed moving average on vertex positions is too
# aggressive on hairpins, so smooth the resampled curve with a small gaussian instead)
C, param, _ = catmull_rom_closed(P, SAMPLE_STEP)
C[:, 0] = gaussian_filter1d(C[:, 0], 1.5, mode="wrap")
C[:, 1] = gaussian_filter1d(C[:, 1], 1.5, mode="wrap")
# re-parametrise to exact step after smoothing
seg = np.linalg.norm(np.diff(np.vstack([C, C[:1]]), axis=0), axis=1)
cum = np.concatenate([[0], np.cumsum(seg)])
LENGTH = cum[-1]
N = int(round(LENGTH / SAMPLE_STEP))
s_new = np.linspace(0, LENGTH, N, endpoint=False)
Cc = np.vstack([C, C[:1]])
C = np.stack([np.interp(s_new, cum, Cc[:, 0]), np.interp(s_new, cum, Cc[:, 1])], 1)
param = np.interp(s_new, cum, np.concatenate([param, [len(P)]]))
STEP = LENGTH / N
print(f"track length {LENGTH:.1f} m, {N} samples @ {STEP:.3f} m")

# sectors (corner names) -> distance along track
sectors = []
for idx, name in way_marks:
    if not name or name == "Nürburgring Nordschleife":
        continue
    s_at = float(np.interp(idx, param, s_new))
    if sectors and sectors[-1]["name"] == name:
        continue
    sectors.append({"name": name, "s": round(s_at, 1)})
sectors.sort(key=lambda d: d["s"])
sectors[0]["s"] = 0.0
print("sectors:", len(sectors))

# ---------------------------------------------------------------- elevation profile
lat_c, lon_c = from_local_np(C[:, 0], C[:, 1])
Y = dem(lat_c, lon_c)
Y = gaussian_filter1d(Y, 12, mode="wrap")  # ~24 m sigma: DEM is 30 m data
Y_dem = Y.copy()


def sector_s(name):
    return next(d["s"] for d in sectors if d["name"] == name)


def sector_end(name):
    i = next(i for i, d in enumerate(sectors) if d["name"] == name)
    return sectors[(i + 1) % len(sectors)]["s"] if i + 1 < len(sectors) else LENGTH


# famous crests / jumps (the 30 m DEM smooths them away), modelled as sharp bumps
crests = [
    ("Flugplatz", sector_s("Flugplatz") + 150, 1.6, 14),
    ("Sprunghügel", sector_s("Sprunghügel") + 120, 1.4, 12),
    ("Pflanzgarten", sector_s("Pflanzgarten") + 60, 1.1, 10),
    ("Quiddelbacher Höhe", sector_s("Quiddelbacher Höhe") + 120, 0.9, 16),
    ("Schwedenkreuz", sector_s("Schwedenkreuz") + 260, 0.8, 18),
]
idx = np.arange(N) * STEP
for name, s0, amp, sig in crests:
    d = (idx - s0 + LENGTH / 2) % LENGTH - LENGTH / 2
    # asymmetric bump: gentle approach, sharp drop -> the kart takes off
    up = np.exp(-0.5 * (d / (sig * 1.8)) ** 2)
    down = np.exp(-0.5 * (d / sig) ** 2)
    Y += amp * np.where(d < 0, up, down)

# ---------------------------------------------------------------- frames, curvature, banking
T = np.roll(C, -1, 0) - np.roll(C, 1, 0)
T /= np.linalg.norm(T, axis=1, keepdims=True)
heading = np.arctan2(T[:, 0], -T[:, 1])  # 0 = north (-z), clockwise positive
dh = np.angle(np.exp(1j * (np.roll(heading, -1) - np.roll(heading, 1))))
curv = dh / (2 * STEP)  # >0 turning right (clockwise seen from above)
curv_s = gaussian_filter1d(curv, 3, mode="wrap")

# bank: positive lifts the right-hand edge; a left-hander (curv < 0) gets mild positive bank
bank = np.clip(-curv_s * 18.0, -0.05, 0.05)
k0, k1 = sector_s("Karussell"), sector_s("Karussell") + 150
in_k = (idx > k0 + 25) & (idx < k1 - 20)
w = np.zeros(N)
w[in_k] = 1
w = gaussian_filter1d(w, 6, mode="wrap")
karussell_sign = -np.sign(np.mean(curv_s[in_k]))
bank = bank * (1 - w) + w * 0.30 * karussell_sign
bank = gaussian_filter1d(bank, 4, mode="wrap")
print("Karussell turn sign", karussell_sign)

# width: wider at Döttinger Höhe straight and the start area
half = np.full(N, ROAD_HALF)
for name, extra in [("Döttinger Höhe", 1.5), ("T13", 2.0), ("Antoniusbuche", 1.0), ("Hohe Acht", -0.4), ("Kesselchen", 0.3)]:
    a, b = sector_s(name), sector_end(name)
    m = (idx >= a) & (idx < b)
    half[m] += extra
half = gaussian_filter1d(half, 15, mode="wrap")

# ---------------------------------------------------------------- racing line (lateral offset)
nrm = np.stack([-T[:, 1], T[:, 0]], 1)  # right-hand normal: (x,z) rotate tangent clockwise
# right of travel direction in x/z with z pointing south: right = (-tz, tx)
off = np.zeros(N)
lim = half - 1.6
K = 6
for it in range(1500):
    p = C + nrm * off[:, None]
    mid = 0.5 * (np.roll(p, K, 0) + np.roll(p, -K, 0))
    target = off + np.sum((mid - p) * nrm, 1)
    off = np.clip(off + 0.6 * (target - off), -lim, lim)
off = gaussian_filter1d(off, 2, mode="wrap")
p = C + nrm * off[:, None]
seg_p = np.linalg.norm(np.roll(p, -1, 0) - p, axis=1)
Tp = np.roll(p, -1, 0) - np.roll(p, 1, 0)
hp = np.arctan2(Tp[:, 0], -Tp[:, 1])
curv_line = np.angle(np.exp(1j * (np.roll(hp, -1) - np.roll(hp, 1)))) / (np.roll(seg_p, 1) + seg_p)
curv_line = gaussian_filter1d(curv_line, 3, mode="wrap")

# ---------------------------------------------------------------- terrain heightmap
x_min, z_max = to_local(BBOX[0], BBOX[1])
x_max, z_min = to_local(BBOX[2], BBOX[3])
x_min = math.floor(x_min / CELL) * CELL
z_min = math.floor(z_min / CELL) * CELL
NX = int(math.ceil((x_max - x_min) / CELL)) + 1
NZ = int(math.ceil((z_max - z_min) / CELL)) + 1
gx = x_min + np.arange(NX) * CELL
gz = z_min + np.arange(NZ) * CELL
GX, GZ = np.meshgrid(gx, gz)
glat, glon = from_local_np(GX, GZ)
H = dem(glat.ravel(), glon.ravel()).reshape(NZ, NX)
H = gaussian_filter(H, 1.6)
print(f"terrain {NX}x{NZ} cells @ {CELL} m, h {H.min():.1f}..{H.max():.1f}")

# carve the terrain under the road: road surface everywhere within the guard rails, then
# a ditch/embankment blend over 40 m.
tree = cKDTree(C)
dist, nearest = tree.query(np.stack([GX.ravel(), GZ.ravel()], 1), k=1)
dist = dist.reshape(NZ, NX)
nearest = nearest.reshape(NZ, NX)
lat_off = np.sum((np.stack([GX, GZ], -1) - C[nearest]) * nrm[nearest], -1)
road_h = Y[nearest] + np.clip(lat_off, -half[nearest], half[nearest]) * np.tan(bank[nearest])
inner = half[nearest] + VERGE + 1.5
blend = np.clip((dist - inner) / 38.0, 0, 1)
blend = blend * blend * (3 - 2 * blend)
H = (road_h - 0.55) * (1 - blend) + H * blend
H_MIN = float(H.min()) - 1.0
q = np.clip(np.round((H - H_MIN) * 100), 0, 65535).astype("<u2")
q.tofile(os.path.join(OUT, "terrain.bin"))

# ---------------------------------------------------------------- environment OSM
env = json.load(open(os.path.join(RAW, "env.json")))["elements"]
env_rels = json.load(open(os.path.join(RAW, "env_rels.json")))["elements"]


def geom_xy(geom):
    return [to_local(p["lat"], p["lon"]) for p in geom]


def assemble_rings(members, role):
    segs = [[(p["lat"], p["lon"]) for p in m["geometry"]] for m in members if m.get("role") == role and m.get("geometry")]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, sgm in enumerate(segs):
                if sgm[0] == ring[-1]:
                    ring += sgm[1:]
                elif sgm[-1] == ring[-1]:
                    ring += sgm[::-1][1:]
                elif sgm[-1] == ring[0]:
                    ring = sgm[:-1] + ring
                elif sgm[0] == ring[0]:
                    ring = sgm[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        rings.append([to_local(a, b) for a, b in ring])
    return rings


LC_NX = int(math.ceil((x_max - x_min) / LC_CELL))
LC_NZ = int(math.ceil((z_max - z_min) / LC_CELL))


def to_px(xy):
    return [((x - x_min) / LC_CELL, (z - z_min) / LC_CELL) for x, z in xy]


layers = {k: Image.new("L", (LC_NX, LC_NZ), 0) for k in ("forest", "field", "urban", "rock", "water", "scrub")}
draws = {k: ImageDraw.Draw(v) for k, v in layers.items()}


def classify(t):
    lu, nat = t.get("landuse"), t.get("natural")
    if lu == "forest" or nat == "wood":
        return "forest"
    if lu in ("farmland", "farmyard", "allotments", "greenfield"):
        return "field"
    if lu in ("residential", "commercial", "retail", "industrial", "garages", "construction", "railway", "raceway") or t.get("leisure") in ("pitch",):
        return "urban"
    if lu == "quarry" or nat in ("shingle", "sand", "bare_rock", "scree"):
        return "rock"
    if nat == "water" or lu in ("reservoir", "basin"):
        return "water"
    if nat in ("scrub", "heath"):
        return "scrub"
    return None


forest_polys = []
for e in env:
    if e["type"] != "way" or "geometry" not in e:
        continue
    t = e.get("tags", {})
    if "building" in t or "highway" in t or "barrier" in t or "waterway" in t:
        continue
    cls = classify(t)
    if not cls:
        continue
    xy = geom_xy(e["geometry"])
    if len(xy) < 3:
        continue
    draws[cls].polygon(to_px(xy), fill=255)
    if cls == "forest":
        forest_polys.append((xy, []))

for e in env_rels:
    cls = classify(e.get("tags", {}))
    if not cls:
        continue
    outers = assemble_rings(e["members"], "outer")
    inners = assemble_rings(e["members"], "inner")
    for r in outers:
        if len(r) >= 3:
            draws[cls].polygon(to_px(r), fill=255)
    for r in inners:
        if len(r) >= 3:
            draws[cls].polygon(to_px(r), fill=0)
    if cls == "forest":
        forest_polys.extend((r, inners) for r in outers)

ROAD_WIDTHS = {"motorway": 12, "trunk": 10, "primary": 8, "secondary": 7, "tertiary": 6.5, "unclassified": 5,
               "residential": 5.5, "service": 3.5, "primary_link": 6, "secondary_link": 5, "tertiary_link": 5, "raceway": 11}
roads_out = []
for e in env:
    t = e.get("tags", {})
    if e["type"] == "way" and "highway" in t and "geometry" in e:
        hw = t["highway"]
        if hw not in ROAD_WIDTHS:
            continue
        xy = geom_xy(e["geometry"])
        wpx = max(1, int(round(ROAD_WIDTHS[hw] / LC_CELL)))
        draws["urban"].line(to_px(xy), fill=255, width=wpx, joint="curve")
        if hw != "raceway" and hw != "service":
            layer = t.get("layer", "0")
            under = t.get("tunnel") not in (None, "no") or layer.startswith("-")
            over = t.get("bridge") not in (None, "no")
            # t: 0 at grade, 1 passes under the circuit (tunnel), 2 bridge over it
            roads_out.append({"w": ROAD_WIDTHS[hw], "t": 1 if under else 2 if over else 0, "p": [[round(x, 1), round(z, 1)] for x, z in xy]})
    if e["type"] == "way" and t.get("waterway") in ("stream", "river") and "geometry" in e:
        draws["water"].line(to_px(geom_xy(e["geometry"])), fill=200, width=1)

# road corridor of the Nordschleife itself: keep landcover clean (the road mesh covers it)
lc_x = x_min + (np.arange(LC_NX) + 0.5) * LC_CELL
lc_z = z_min + (np.arange(LC_NZ) + 0.5) * LC_CELL
LGX, LGZ = np.meshgrid(lc_x, lc_z)
ldist, lnear = tree.query(np.stack([LGX.ravel(), LGZ.ravel()], 1), k=1)
ldist = ldist.reshape(LC_NZ, LC_NX)
lnear = lnear.reshape(LC_NZ, LC_NX)

arr = {k: np.asarray(v, dtype=np.float32) / 255 for k, v in layers.items()}
# forest edges should stay away from the guard rails (marshal clearings)
clear = np.clip((ldist - (half[lnear] + VERGE + 6)) / 10, 0, 1)
arr["forest"] *= clear
arr["scrub"] *= np.clip((ldist - (half[lnear] + VERGE + 2)) / 6, 0, 1)
# verge next to the circuit: short grass, a little gravel
near_road = np.clip(1 - (ldist - half[lnear]) / (VERGE + 4), 0, 1)
arr["rock"] = np.maximum(arr["rock"], near_road * 0.25)
for k in arr:
    arr[k] = gaussian_filter(arr[k], 0.9)
forest = np.maximum(arr["forest"], arr["scrub"] * 0.6)
# RGB only: browsers may premultiply alpha on decode, which would destroy RGB where A == 0
splat = np.stack([forest, arr["field"], arr["urban"]], -1)
Image.fromarray(np.clip(splat * 255, 0, 255).astype(np.uint8), "RGB").save(os.path.join(OUT, "landcover.png"), optimize=True)
rock = np.maximum(arr["rock"], arr["water"] * 0.8)
Image.fromarray(np.clip(rock * 255, 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "landcover_rock.png"), optimize=True)

# ---------------------------------------------------------------- buildings
LEVEL_H = 3.0
DEFAULT_LEVELS = {"house": 2, "detached": 2, "residential": 2.5, "apartments": 4, "hotel": 4, "garage": 1, "garages": 1,
                  "shed": 1, "hut": 1, "barn": 2, "farm_auxiliary": 1.5, "commercial": 2.5, "industrial": 2.5,
                  "grandstand": 5, "church": 5, "roof": 1.5, "carport": 1, "retail": 2}
hm_interp = None


def terrain_at(x, z):
    fx = (np.asarray(x) - x_min) / CELL
    fz = (np.asarray(z) - z_min) / CELL
    return map_coordinates(H, [fz, fx], order=1, mode="nearest")


buildings = []
for e in env:
    t = e.get("tags", {})
    if e["type"] != "way" or "building" not in t or "geometry" not in e:
        continue
    xy = geom_xy(e["geometry"])
    if xy[0] == xy[-1]:
        xy = xy[:-1]
    if len(xy) < 3:
        continue
    arr_xy = np.array(xy)
    cx, cz = arr_xy.mean(0)
    # keep buildings away from the race surface
    dmin, _ = tree.query(arr_xy)
    if dmin.min() < half.max() + VERGE + 1:
        continue
    if "height" in t:
        try:
            h = float(t["height"].replace("m", "").strip())
        except ValueError:
            h = 6
    elif "building:levels" in t:
        try:
            h = float(t["building:levels"]) * LEVEL_H + 1.5
        except ValueError:
            h = 6
    else:
        h = DEFAULT_LEVELS.get(t["building"], 2) * LEVEL_H + 1.0
    area = 0.5 * abs(np.dot(arr_xy[:, 0], np.roll(arr_xy[:, 1], 1)) - np.dot(arr_xy[:, 1], np.roll(arr_xy[:, 0], 1)))
    if area < 6:
        continue
    if area > 1500 and "building:levels" not in t and "height" not in t:
        h = max(h, 9)
    base = float(terrain_at(arr_xy[:, 0], arr_xy[:, 1]).min()) - 0.3
    kind = t["building"]
    roof = "flat" if (area > 400 or kind in ("industrial", "commercial", "grandstand", "retail", "garages")) else "gable"
    buildings.append({"h": round(h, 1), "b": round(base, 2), "r": roof, "p": [[round(x, 2), round(z, 2)] for x, z in xy]})
print("buildings", len(buildings))

# ---------------------------------------------------------------- trees
rng = np.random.default_rng(1927)
forest_mask = forest  # LC grid
tree_pts = []


def scatter(density_per_m2, region_mask, kind_bias):
    area = LC_CELL * LC_CELL
    prob = region_mask * density_per_m2 * area
    k = rng.random(prob.shape) < prob
    zi, xi = np.nonzero(k)
    xs = x_min + (xi + rng.random(len(xi))) * LC_CELL
    zs = z_min + (zi + rng.random(len(zi))) * LC_CELL
    return xs, zs


# dense forest near the track (3D trees), sparse forest far away (billboards)
near_zone = (ldist < 190).astype(np.float32)
x1, z1 = scatter(1 / 36.0, forest_mask * near_zone, 0)
x2, z2 = scatter(1 / 170.0, forest_mask * (1 - near_zone), 0)
# hedges / single trees on fields and verges
open_land = (1 - forest_mask) * (1 - arr["urban"]) * np.clip((ldist - (ROAD_HALF + VERGE + 4)) / 10, 0, 1)
x3, z3 = scatter(1 / 2200.0, open_land, 0)
xs = np.concatenate([x1, x2, x3])
zs = np.concatenate([z1, z2, z3])
# keep clear of the circuit
dd, nn = tree.query(np.stack([xs, zs], 1))
keep = dd > half[nn] + VERGE + 3.5
xs, zs = xs[keep], zs[keep]
# OSM single trees
osm_trees = [to_local(e["lat"], e["lon"]) for e in env if e["type"] == "node" and e.get("tags", {}).get("natural") == "tree"]
if osm_trees:
    ot = np.array(osm_trees)
    xs = np.concatenate([xs, ot[:, 0]])
    zs = np.concatenate([zs, ot[:, 1]])
inside = (xs > x_min) & (xs < x_max) & (zs > z_min) & (zs < z_max)
xs, zs = xs[inside], zs[inside]
# Eifel: spruce plantations mixed with beech; kind 0 = spruce, 1 = broadleaf
kind = (rng.random(len(xs)) < 0.38).astype(np.float32)
scale = (0.75 + rng.random(len(xs)) * 0.6).astype(np.float32)
trees = np.stack([np.round(xs * 4), np.round(zs * 4), np.round(scale * 1000), kind], 1).astype("<i2")
trees.tofile(os.path.join(OUT, "trees.bin"))
print("trees", len(trees))

# ---------------------------------------------------------------- places
places = []
for e in env:
    t = e.get("tags", {})
    if e["type"] == "node" and t.get("place") in ("village", "town", "hamlet") and "name" in t:
        x, z = to_local(e["lat"], e["lon"])
        places.append({"name": t["name"], "x": round(x, 1), "z": round(z, 1), "kind": t["place"]})
peaks = []
for e in env:
    t = e.get("tags", {})
    if e["type"] == "node" and t.get("natural") == "peak":
        x, z = to_local(e["lat"], e["lon"])
        peaks.append({"name": t.get("name", ""), "x": round(x, 1), "z": round(z, 1), "ele": t.get("ele")})

# secondary roads: keep geometry clipped to the terrain box and drop tiny bits
roads_out = [r for r in roads_out if len(r["p"]) >= 2]

json.dump({"buildings": buildings, "roads": roads_out, "places": places, "peaks": peaks},
          open(os.path.join(OUT, "world.json"), "w"), separators=(",", ":"))

# ---------------------------------------------------------------- track.json
r2 = lambda a: [round(float(v), 2) for v in a]
r3 = lambda a: [round(float(v), 3) for v in a]
track = {
    "name": "Nürburgring Nordschleife",
    "source": "OpenStreetMap relation 38566 (ODbL) + AWS Terrain Tiles (Terrarium)",
    "origin": {"lat": LAT0, "lon": LON0},
    "length": round(LENGTH, 2),
    "step": STEP,
    "x": r2(C[:, 0]), "z": r2(C[:, 1]), "y": r2(Y),
    "bank": r3(bank), "half": r2(half), "verge": VERGE,
    "line": r2(off), "lineCurv": [round(float(v), 5) for v in curv_line],
    "sectors": sectors,
    "crests": [{"name": n, "s": round(s0 % LENGTH, 1)} for n, s0, _, _ in crests],
    "terrain": {"x0": x_min, "z0": z_min, "nx": NX, "nz": NZ, "cell": CELL, "hMin": H_MIN, "scale": 0.01},
    "landcover": {"x0": x_min, "z0": z_min, "nx": LC_NX, "nz": LC_NZ, "cell": LC_CELL},
    "elevation": {"min": round(float(Y.min()), 1), "max": round(float(Y.max()), 1)},
}
json.dump(track, open(os.path.join(OUT, "track.json"), "w"), separators=(",", ":"), ensure_ascii=False)
print(f"elevation along track {Y.min():.1f} .. {Y.max():.1f} m")
for f in os.listdir(OUT):
    print(f, os.path.getsize(os.path.join(OUT, f)))
