"""Per-track configuration shared by tools/fetch_data.py and tools/build_data.py.

Raw inputs live in data/raw/<id>/, generated game data in public/data/<id>/.
Distances (`s`) are metres along the lap from the start/finish line.
"""

TRACKS = {
    "nordschleife": {
        "name": "Nürburgring Nordschleife",
        "source": "OpenStreetMap relation 38566 (ODbL) + AWS Terrain Tiles (Terrarium)",
        "origin": (50.3530, 6.9600),  # roughly the centre of the loop
        "bbox": (50.318, 6.905, 50.388, 7.012),  # south, west, north, east (same box as q_env)
        "tile_bbox": (50.310, 6.898, 50.394, 7.020),
        "queries": {
            "nordschleife_rel.json": "q_rel.overpassql",
            "raceway.json": "q_raceway.overpassql",
            "env.json": "q_env.overpassql",
            "env_rels.json": "q_rels.overpassql",
        },
        # the relation's ways are ordered and named after the corners
        "centerline": {"kind": "relation", "file": "nordschleife_rel.json", "start_way": "T13", "skip_names": ["Nürburgring Nordschleife"]},
        "road_half": 5.0,  # Nordschleife is ~ 8-12 m wide
        "verge": 3.2,  # grass/run-off between asphalt edge and guard rail
        "elev_sigma": 12,  # samples (~24 m): DEM is 30 m data
        # famous crests / jumps (the 30 m DEM smooths them away): sector, offset, amplitude, sigma
        "crests": [
            ("Flugplatz", 150, 1.6, 14),
            ("Sprunghügel", 120, 1.4, 12),
            ("Pflanzgarten", 60, 1.1, 10),
            ("Quiddelbacher Höhe", 120, 0.9, 16),
            ("Schwedenkreuz", 260, 0.8, 18),
        ],
        # steep banking: sector, length, bank (rad)
        "banked": [("Karussell", 150, 0.30)],
        "widths": [("Döttinger Höhe", 1.5), ("T13", 2.0), ("Antoniusbuche", 1.0), ("Hohe Acht", -0.4), ("Kesselchen", 0.3)],
        "broadleaf": 0.38,  # Eifel: spruce plantations mixed with beech
        "tree_rows": False,
        "water_mesh": False,
    },
    "shanghai": {
        "name": "Shanghai International Circuit",
        "source": "OpenStreetMap relation 2094941 (ODbL) + AWS Terrain Tiles (Terrarium)",
        "origin": (31.3407, 121.2214),
        "bbox": (31.324, 121.201, 31.357, 121.242),
        "tile_bbox": (31.320, 121.196, 31.361, 121.247),
        "queries": {
            "circuit_rel.json": "q_rel.overpassql",
            "env.json": "q_env.overpassql",
            "env_rels.json": "q_rels.overpassql",
        },
        # the GP layout is one closed way; the relation also holds the pit lane and the start node
        "centerline": {
            "kind": "closed_way",
            "file": "circuit_rel.json",
            "way": 156328670,
            "start": (31.3373194, 121.2206097),  # node 1686043686, role=start in relation 2094941
            "clockwise": True,
        },
        "road_half": 7.0,  # F1 standard ~14 m
        "verge": 6.0,  # paved / grass run-off before the barriers
        "verge_fall": (0.02, 0.0),  # run-off areas are nearly flat (default: ditches, 0.06 + 0.05 after 1.2 m)
        "elev_sigma": 40,  # flat Yangtze delta: the DEM is mostly noise from buildings and trees
        "elev_flatten": 0.35,  # keep only a fraction of the residual relief
        # official corner numbering (F1 / FIA), s = braking zone
        "sectors": [
            ("发车直道", 0),
            ("T1–T2 蜗牛弯", 270),
            ("T3–T4", 640),
            ("T5", 1100),
            ("T6 发夹弯", 1320),
            ("T7", 1700),
            ("T8", 2050),
            ("T9–T10", 2290),
            ("T11", 2870),
            ("T12–T13", 2990),
            ("后直道", 3390),
            ("T14 发夹弯", 4500),
            ("T15", 4670),
            ("T16", 4930),
            ("主直道", 5040),
        ],
        "crests": [],
        "banked": [],
        "widths": [("发车直道", 2.0), ("主直道", 2.0), ("后直道", 1.2), ("T1–T2 蜗牛弯", 0.8), ("T14 发夹弯", 1.0)],
        "broadleaf": 1.0,  # plane trees, camphor and poplars
        "tree_rows": True,
        "water_mesh": True,
        "stands": True,  # building=grandstand -> tiered seating facing the track (world.json "k": "g")
    },
}
