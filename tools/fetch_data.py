#!/usr/bin/env python3
"""Download the raw inputs for tools/build_data.py into data/raw/<track>.

  - Overpass API: circuit relation, environment (buildings, landuse, roads...)
  - AWS Terrain Tiles (Terrarium PNG, zoom 14) covering the terrain box

Run: python3 tools/fetch_data.py <track> [--force]     (tracks: see tools/tracks.py)
"""
import math
import os
import sys
import time
import urllib.parse
import urllib.request

from tracks import TRACKS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
TRACK_ID = ARGS[0] if ARGS else "nordschleife"
CFG = TRACKS[TRACK_ID]
RAW = os.path.join(ROOT, "data", "raw", TRACK_ID)
# the main instance is often busy or rate limited; the mirror carries the same data
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
UA = "nurburgring-kart-osm-import/0.1"
FORCE = "--force" in sys.argv


def overpass(query_file: str, out: str):
    path = os.path.join(RAW, out)
    if os.path.exists(path) and not FORCE:
        print("keep", out)
        return
    q = open(os.path.join(RAW, query_file)).read()
    for attempt in range(8):
        ep = OVERPASS[attempt % len(OVERPASS)]
        req = urllib.request.Request(ep, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": UA})
        try:
            body = urllib.request.urlopen(req, timeout=300).read()
            if body.lstrip().startswith(b"{"):
                open(path, "wb").write(body)
                print("got", out, len(body))
                return
        except Exception as e:  # rate limited or busy: retry
            print("retry", out, e)
        time.sleep(10 * (attempt + 1))
    raise SystemExit(f"Overpass failed for {out} (large queries may need splitting into one statement each)")


def tiles():
    z = 14
    d = os.path.join(RAW, "terrarium")
    os.makedirs(d, exist_ok=True)

    def tile(lat, lon):
        n = 2 ** z
        return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n

    south, west, north, east = CFG["tile_bbox"]
    x0, y0 = tile(north, west)
    x1, y1 = tile(south, east)
    for x in range(int(x0), int(x1) + 1):
        for y in range(int(y0), int(y1) + 1):
            f = os.path.join(d, f"{z}_{x}_{y}.png")
            if os.path.exists(f) and not FORCE:
                continue
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
            urllib.request.urlretrieve(url, f)
            print("tile", x, y)


if __name__ == "__main__":
    for out, q in CFG["queries"].items():
        overpass(q, out)
    tiles()
