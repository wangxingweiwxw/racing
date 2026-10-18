# Tesla Roadster 2 — game interpretation

Research date: 2026-10-17 (Asia/Shanghai).

## Sources

**Original visual reference: user-supplied `6258.mp4`.**
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

## October 16 video refinement (revision 3)

Ten user-supplied recordings in `video/` were sampled at nine time positions each.
These are visual references, not independently verified engineering specifications.
The original recordings and extracted frames remain local.

| Recording (2026-10-16) | Useful evidence | Implementation |
| --- | --- | --- |
| 212830, 2.9–20.5 s | Raised rear airbrake, underside and supports; broad five-spoke wheels | Hinged deck, actuators, revised aero wheel faces |
| 213456, 0.9–37.9 s | Butterfly doors, ivory seats/yoke, slim screen, black interior | Open cabin tub, separate door hinges/glass, seats, armrests, console and screen |
| 212316, 0.5–21.6 s | Cold-gas clouds during track launch | White condensation jets and ground wash |
| 212554 and 214343, especially 214343 at 5.1–7.7 s | Airborne rotation and landing | Fuel-cost arcade roll with upright landing recovery |
| 212351, 213726 | Steep-ramp/wall demonstrations | Motion reference only; wall driving is not implemented |
| 213824, 213921, 214054 | Mechanical exhibits, exploded rendering and engineering montage | Context; hidden machinery is not claimed as an accurate reconstruction |

Fixed front/side/rear/quarter camera renders were compared before and after changes.
Opening the doors also exposed and helped fix interior/outer-skin intersections.
The geometry budget is under 24,000 triangles, including cabin and articulated parts.

## October 18 photograph refinement (revision 4)

Nine user-supplied JPGs in `video/roadster2/` were inspected. The 16_24 photo
shows raised/folded wing mechanisms, 17_24 shows incidence and front lamp shapes,
11_24 shows road-mode light details, and 13_24 shows the rear light and four nozzle mouths.
The geometry now includes a chevron wing blade, downward endplates, two folding
link frames, hinge pins, lift and incidence actuators; deployment and pitch are
independent. Both game modes share this rig. Cruising at speed raises the wing
with low incidence; braking increases incidence. These control thresholds remain
game tuning, not manufacturer specifications.

Front lighting has conforming triangular housings, five individual optics per
side, a fine nose light guide and amber side markers. Rear lighting has a smoked
bezel, ruby lens and emissive core, with corner and side returns. Four rear bell
nozzles, flange bolts and the front braking outlets are shared with the export.
The package contains GLB/glTF animation clips for doors, low-drag wing deployment
and airbrake deployment; only one wing clip should play at a time. OBJ is static.
Current triangle counts and import/validation results are recorded in model-info.json.

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
- X / standard gamepad B / context touch button: at rest (<1 m/s), toggle butterfly
  doors and rear deck. Throttle, brake or lift closes the showcase.
- During a hover session above 1.5 m, press the same action with >=20% fuel to roll
  once in 0.9 seconds, costing 15%. Holding does not repeat. Steering still works;
  landing, respawn or collision spin cancels the visual roll and restores upright attitude.
- Grounded forward braking above 15 m/s deploys the active airbrake. Added drag is
  an arcade tuning value (up to 18 m/s²), not measured Tesla aerodynamic data.
  It does not lower straight-line top speed. Roadster records now use flight-v2.
- Flight stays inside the existing track corridor; no unrestricted flight or wall driving.
- Separate best times, sector splits and ghosts prevent mixing flight-assisted
  Roadster records with existing U9 records.

Geometry source: src/race/roadsterModel.ts. Code/geometry: project MPL-2.0.
Tesla and Roadster names remain their owners' trademarks; no affiliation implied.
