# Tesla Roadster 2 — game interpretation

Research date: 2026-10-17 (Asia/Shanghai).

## Sources

**Primary visual reference (revision 2): user-supplied `6258.mp4`.**
960 × 560, 2,136 decoded frames, approximately 71.73 seconds.
SHA-256: D054B5B82F5537C9725FC12A1888EF5A101711C8789F8C3BB0E5201DBD8FFE90.
This is a gameplay video; its depicted vehicle is the requested visual target,
not proof of a real production vehicle's final geometry. The original video and
frame extractions remain local and are not redistributed in public assets.

- 5 seconds: rear proportions, long black rear glass, red ribbon and white lip.
- 8.07 seconds: airborne side/rear silhouette and wheel placement.
- 24–26 seconds: white sail panels, shallow side glazing, tapered rear fascia.
- 28–29 seconds: underside / propulsion glimpses, still partly obscured.
- 68 seconds: side profile and rising rear haunch.

The following web references informed the FIRST concept, before the video was
provided. They no longer determine the detailed body shape:

- Tesla Roadster product page: https://www.tesla.com/roadster
  The current page distinguishes the Rocket trim and optional Thrust augment.
  Search caches also return the older 2017 red prototype; these are not treated
  as current specifications.
- Tesla event landing page: https://livestream.tesla.com/
- AP, 2026-10-16: https://apnews.com/article/7d5f19665435b7408025bfb7a2f2f0b7
  Search excerpt reports an October 15 demonstration of cold-gas thrusters,
  short airborne movements and a suction system. Full article fetch unavailable.
- Electrek, 2026-10-15: https://electrek.co/2026/10/15/tesla-unveils-cyberfied-new-roadster-kickflip/
  Search excerpt describes the revised angular design and Rocket variant.

## Scope and confidence

This is ORIGINAL procedural geometry reconstructed by visual comparison with
the user's video, not a scan, licensed Tesla mesh or factory CAD. Multiple fixed
camera passes compare the old model and revised models. The model reproduces
the visible white body, continuous black canopy, slim side glazing, white sail
panels, trapezoid black rear, centred plate and integrated white ducktail.
Front/underbody details and exact dimensions remain estimates where the video
does not provide a clear view. Lighting and background differ between games;
no pixel-equivalence or numerical whole-car similarity percentage is claimed.
No downloaded vehicle meshes or video textures are included.

## Gameplay (NOT real vehicle specifications)

- Approximate body: 4.6 m long, 2.1 m wide, 1.3 m high.
- Hold Space, standard gamepad LB, or the hover touch button to lift.
- Target clearance 3.5 m; full tank supplies up to 4 seconds of powered hover.
- Release or empty tank: assisted descent, maximum downward speed 3.5 m/s.
- Grounded and lift released: recharge in 10 seconds from empty.
- Minimum 25% charge to launch; release to rearm after exhaustion.
- Vehicle speed caps: Roadster 370.15 km/h; U9 Xtreme 496.22 km/h.
- Optional corner assistance anticipates braking and gently corrects at road edges;
  assisted records are separate from manual driving. Steering assistance continues through
  powered hover and descent; throttle, brakes and lift remain manually controlled.
- Flight stays inside the existing track corridor. This is short hovering and
  driving, not unrestricted aircraft simulation or a barrel-roll recreation.
- Separate best times, sector splits and ghosts prevent mixing flight-assisted
  Roadster records with existing U9 records.

Geometry source: src/race/roadsterModel.ts. Code/geometry: project MPL-2.0.
Tesla and Roadster names remain their owners' trademarks; no affiliation implied.
