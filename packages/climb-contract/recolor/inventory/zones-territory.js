/*
 * Сгенерировано scripts/prepare-zones-territory.mjs — руками не править.
 *
 * «Зоны»: кусок местности из игры игрока вокруг зоны — земля, дороги, здания и ленты самих зон (сцена кадра).
 * Места выбраны по числу упоминаний в Majestic (scripts/lib/zones-territory-places.mjs); зона покрыта, если её
 * подножие лежит в круге места не ближе 25 м к краю. Начало сцены — середина круга.
 */
export default Object.freeze({
  set: "zones-territory",
  margin: 25,
  places: [
    {"id":"rtrak","kind":"outline","centre":[835.6,2066.7],"reach":140,"zones":["bizvar_outer","bizvar_inner"],"mentions":{"zones":2,"marks":0},"vertices":49590,"triangles":66499,"ground":{"min":-10.4,"max":60.6},"scene":{"url":"/assets/workshop/zones/territory/rtrak.bin","bytes":1116373,"sha256":"bdd346b678718415a73083583719406d08f6881299cb5c7a84cd8aa75e9eaaa4","origin":[835.6,2066.7,58.4],"bounds":{"min":[-152.9,-153.1,-11.1],"max":[152.7,153.8,74.9]}}},
    {"id":"palmpow","kind":"outline","centre":[2617.5,1708],"reach":140,"zones":["vzhzone_outer","vzhzone_inner"],"mentions":{"zones":2,"marks":0},"vertices":48480,"triangles":58217,"ground":{"min":-4.9,"max":17.8},"scene":{"url":"/assets/workshop/zones/territory/palmpow.bin","bytes":889406,"sha256":"0365bc48057d335205494e46a558b9a3ed98a511f03b1383a86cd9f46676ceff","origin":[2617.5,1708,17.2],"bounds":{"min":[-154.4,-154.5,-7.4],"max":[166.1,158.3,29.2]}}},
    {"id":"termina","kind":"outline","centre":[887.7,-2873.9],"reach":140,"zones":["porta_outer","porta_inner"],"mentions":{"zones":2,"marks":0},"vertices":106256,"triangles":72391,"ground":{"min":-34.3,"max":2.5},"water":true,"scene":{"url":"/assets/workshop/zones/territory/termina.bin","bytes":892610,"sha256":"94aa3d091aec45e66f05dde131f24ad3562df99f4265d658ceacb27aed78316b","origin":[887.7,-2873.9,6],"bounds":{"min":[-151.9,-161.9,-40.1],"max":[177.4,156.8,70.4]}}},
  ],
  zoneToPlace: {"bizvar_outer":"rtrak","bizvar_inner":"rtrak","vzhzone_outer":"palmpow","vzhzone_inner":"palmpow","porta_outer":"termina","porta_inner":"termina"},
});
