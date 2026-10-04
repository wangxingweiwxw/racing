[out:json][timeout:180];
(
  way["building"](50.318,6.905,50.388,7.012);
  way["landuse"](50.318,6.905,50.388,7.012);
  way["natural"](50.318,6.905,50.388,7.012);
  relation["landuse"](50.318,6.905,50.388,7.012);
  relation["natural"](50.318,6.905,50.388,7.012);
  way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|raceway"](50.318,6.905,50.388,7.012);
  way["barrier"~"guard_rail|fence|wall"](50.318,6.905,50.388,7.012);
  way["waterway"](50.318,6.905,50.388,7.012);
  way["leisure"](50.318,6.905,50.388,7.012);
  node["natural"="tree"](50.318,6.905,50.388,7.012);
  node["natural"="peak"](50.318,6.905,50.388,7.012);
  node["place"](50.318,6.905,50.388,7.012);
);
out geom tags;
