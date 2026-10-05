[out:json][timeout:180];
(
  way["building"](31.324,121.201,31.357,121.242);
  way["landuse"](31.324,121.201,31.357,121.242);
  way["natural"](31.324,121.201,31.357,121.242);
  way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|raceway"](31.324,121.201,31.357,121.242);
  way["barrier"~"guard_rail|fence|wall"](31.324,121.201,31.357,121.242);
  way["waterway"](31.324,121.201,31.357,121.242);
  way["leisure"](31.324,121.201,31.357,121.242);
  node["natural"="tree"](31.324,121.201,31.357,121.242);
  node["natural"="peak"](31.324,121.201,31.357,121.242);
  node["place"](31.324,121.201,31.357,121.242);
);
out geom tags;
