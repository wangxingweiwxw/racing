[out:json][timeout:120];
(
  way["highway"="raceway"](50.31,6.90,50.40,7.03);
  relation["type"="route"]["name"~"Nordschleife|Nürburgring"](50.31,6.90,50.40,7.03);
  relation["sport"="motor"](50.31,6.90,50.40,7.03);
);
out geom tags;
