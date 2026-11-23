const workshopFallbackMedia = {
  redux: [
    "/media/redux/world-map.webp",
    "/media/showcase/roads-white.webp",
    "/media/showcase/sky-dawn.webp",
    "/media/showcase/vegetation-forest.webp",
    "/media/showcase/lights-cyan.webp",
    "/media/redux/water.webp",
    "/media/redux/interior.webp",
    "/media/redux/tracers.webp",
  ],
  gunpacks: [
    "/assets/catalog/weapons/revolver.webp",
    "/assets/catalog/weapons/carbine-rifle.webp",
    "/assets/catalog/weapons/smg-mk2.webp",
    "/assets/catalog/weapons/heavy-shotgun.webp",
    "/assets/catalog/weapons/special-carbine.webp",
    "/assets/catalog/weapons/heavy-sniper.webp",
    "/assets/catalog/weapons/combat-mg.webp",
    "/assets/catalog/weapons/marksman-rifle.webp",
  ],
  clothing: [
    "/assets/catalog/clothing/tshirts.svg",
    "/assets/catalog/clothing/pants.svg",
    "/assets/catalog/clothing/armor.svg",
    "/assets/catalog/clothing/shoes.svg",
    "/assets/catalog/clothing/hats.svg",
    "/assets/catalog/clothing/accessories.svg",
    "/assets/catalog/clothing/gloves.svg",
    "/assets/catalog/clothing/masks.svg",
    "/assets/catalog/clothing/tattoos.svg",
  ],
  other: [
    "/media/gta-car.jpg",
    "/media/gta-city-night.jpg",
    "/media/gta-vista.jpg",
    "/media/gta-pursuit.jpg",
    "/media/gta-night-drive.jpg",
  ],
};

const workshopFallbackMediaBySlot = {
  armor: ["/assets/catalog/clothing/armor.svg"],
  tshirts: ["/assets/catalog/clothing/tshirts.svg"],
  "government-clothing": ["/assets/catalog/clothing/government-clothing.svg"],
  pants: ["/assets/catalog/clothing/pants.svg"],
  shoes: ["/assets/catalog/clothing/shoes.svg"],
  hats: ["/assets/catalog/clothing/hats.svg"],
  accessories: ["/assets/catalog/clothing/accessories.svg"],
  gloves: ["/assets/catalog/clothing/gloves.svg"],
  masks: ["/assets/catalog/clothing/masks.svg"],
  tattoos: ["/assets/catalog/clothing/tattoos.svg"],
  bags: ["/assets/catalog/clothing/accessories.svg"],
  minimap: ["/media/redux/minimap.png"],
  "large-map": [
    "/media/redux/world-map.webp",
    "/media/catalog/redux/redux-1.jpg",
    "/media/catalog/redux/redux-2.jpg",
    "/media/showcase/roads-white.webp",
    "/media/showcase/sky-dawn.webp",
    "/media/showcase/vegetation-lake.webp",
  ],
  roads: [
    "/media/showcase/roads-white.webp",
    "/media/showcase/roads-yellow.webp",
    "/media/showcase/roads-brick.webp",
    "/media/gta-city-night.jpg",
    "/media/gta-night-drive.jpg",
    "/media/gta-pursuit.jpg",
  ],
  timecycle: [
    "/media/showcase/sky-dawn.webp",
    "/media/showcase/sky-clouds.webp",
    "/media/gta-vista.jpg",
    "/media/showcase/vegetation-lake.webp",
    "/media/gta-city-night.jpg",
    "/media/gta-night-drive.jpg",
  ],
  vegetation: [
    "/media/showcase/vegetation-forest.webp",
    "/media/showcase/vegetation-autumn.webp",
    "/media/showcase/vegetation-pink.webp",
    "/media/showcase/vegetation-lake.webp",
    "/media/mod-green-world.webp",
    "/media/gta-vista.jpg",
  ],
  lights: [
    "/media/showcase/lights-cyan.webp",
    "/media/showcase/lights-red.webp",
    "/media/showcase/lights-violet.webp",
    "/media/gta-city-night.jpg",
    "/media/gta-night-drive.jpg",
    "/media/gta-pursuit.jpg",
  ],
  water: [
    "/media/redux/water.webp",
    "/media/showcase/vegetation-lake.webp",
    "/media/gta-vista.jpg",
    "/media/catalog/redux/redux-3.jpg",
    "/media/catalog/redux/redux-4.jpg",
    "/media/catalog/redux/redux-5.jpg",
  ],
  interior: [
    "/media/redux/interior.webp",
    "/media/gta-city-night.jpg",
    "/media/gta-car.jpg",
  ],
  ashan: [
    "/media/gta-city-night.jpg",
    "/media/redux/interior.webp",
    "/media/gta-vista.jpg",
  ],
  tracers: [
    "/media/redux/tracers.webp",
    "/media/gta-pursuit.jpg",
    "/media/gta-night-drive.jpg",
  ],
  effects: [
    "/media/showcase/tires-red-smoke.webp",
    "/media/showcase/tires-white-smoke.webp",
  ],
  "hit-effects": ["/media/redux/hit-effects.png"],
  "kill-effects": ["/media/redux/hit-effects.png"],
  "screen-hits": ["/media/redux/hit-effects.png"],
  /* «Полоска HP» (задача 2 ТЗ 11.10.2026): пока обложка едет. */
  "target-hp": ["/media/redux/hit-effects.png"],
  /* «Групповые метки» (задача 21 ТЗ 18.10.2026, вечер): пока обложка едет. */
  "group-markers": ["/media/redux/hit-effects.png"],
  /* «Дым из-под колёс» (ТЗ 11.10.2026, вечер): пока обложка едет. */
  "wheel-smoke": ["/media/redux/hit-effects.png"],
  "mega-mall": ["/media/gta-city-night.jpg", "/media/gta-vista.jpg"],
  crosshair: [
    "/media/mod-crosshair-green.png",
    "/media/mod-crosshair-pink.png",
  ],
  "sniper-crosshair": [
    "/media/mod-crosshair-pink.png",
    "/media/mod-crosshair-green.png",
  ],
  sounds: ["/media/gta-night-drive.jpg", "/media/gta-pursuit.jpg"],
};

const workshopTones = ["cyan", "blue", "violet", "amber", "green", "rose"];

export function workshopPreviewFor(section, slotId, index = 0) {
  const slotMedia = workshopFallbackMediaBySlot[slotId];
  if (slotMedia?.length) return slotMedia[index % slotMedia.length];

  const sectionMedia =
    workshopFallbackMedia[section] || workshopFallbackMedia.other;
  return sectionMedia[index % sectionMedia.length];
}

export function workshopToneFor(section, slotId, index = 0) {
  const seed = `${section}:${slotId}`
    .split("")
    .reduce((total, character) => total + character.charCodeAt(0), index);
  return workshopTones[seed % workshopTones.length];
}

export { workshopFallbackMedia, workshopFallbackMediaBySlot };
