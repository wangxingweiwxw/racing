#!/usr/bin/env python3
"""Download the raw inputs for tools/build_data.py into data/raw.

  - Overpass API: Nordschleife relation, raceways, environment (buildings, landuse, roads...)
  - AWS Terrain Tiles (Terrarium PNG, zoom 14) covering the terrain box

Run: python3 tools/fetch_data.py [--force]
"""
import math
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "nurburgring-kart-osm-import/0.1"
FORCE = "--force" in sys.argv

QUERIES = {
    "nordschleife_rel.json": "q_rel.overpassql",
    "raceway.json": "q_raceway.overpassql",
    "env.json": "q_env.overpassql",
    "env_rels.json": "q_rels.overpassql",
}


def overpass(query_file: str, out: str):
    path = os.path.join(RAW, out)
    if os.path.exists(path) and not FORCE:
        print("keep", out)
        return
    q = open(os.path.join(RAW, query_file)).read()
    for attempt in range(4):
        req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": UA})
        try:
            body = urllib.request.urlopen(req, timeout=300).read()
            if body.lstrip().startswith(b"{"):
                open(path, "wb").write(body)
                print("got", out, len(body))
                return
        except Exception as e:  # rate limited or busy: retry
            print("retry", out, e)
        time.sleep(10 * (attempt + 1))
    raise SystemExit(f"Overpass failed for {out}")


def tiles():
    z = 14
    d = os.path.join(RAW, "terrarium")
    os.makedirs(d, exist_ok=True)

    def tile(lat, lon):
        n = 2 ** z
        return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n

    x0, y0 = tile(50.394, 6.898)
    x1, y1 = tile(50.310, 7.020)
    for x in range(int(x0), int(x1) + 1):
        for y in range(int(y0), int(y1) + 1):
            f = os.path.join(d, f"{z}_{x}_{y}.png")
            if os.path.exists(f) and not FORCE:
                continue
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
            urllib.request.urlretrieve(url, f)
            print("tile", x, y)


if __name__ == "__main__":
    for out, q in QUERIES.items():
        overpass(q, out)
    tiles()
