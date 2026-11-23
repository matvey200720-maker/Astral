/*
 * Сгенерировано scripts/prepare-wallbang-resources.mjs — руками не править.
 *
 * Места укрытий из расстановки мода (район — по popzone.ipl игры), границы
 * моделей оболочек, файлы набора в resources/wallbang и формы для кадра
 * редактора. Перегенерировать после новой версии мода:
 *   node scripts/prepare-wallbang-resources.mjs --source <prostrel_cpt.rpf>
 */

export const WALLBANG_SOURCE = Object.freeze({
  archive: "prostrel_cpt.rpf",
  sha256: "a0ac36e3ff6caa5fbbfcd219919b0f5e7a1d8fbeb5a952f70e5b5191a263d0fd",
  entries: 25,
});

export const WALLBANG_PLACEMENTS = Object.freeze({
  fence: [{ zone: "MIRR", position: [970.2, -703.32, 57.67] }],
  long_fence: [{ zone: "LMESA", position: [861.33, -585.96, 57.35] }],
  gate: [{ zone: "MIRR", position: [898.44, -622.22, 57.06] }],
  wood_fence: [{ zone: "SANDY", position: [2045.4, 3728.85, 33.21] }],
  transformer: [
    { zone: "SANDY", position: [2057.33, 3691.13, 33.63] },
    { zone: "SANDY", position: [2060.45, 3685.84, 33.63] },
  ],
  roof_aircon: [
    { zone: "PALETO", position: [-78.55, 6516.53, 40.43] },
    { zone: "PALETO", position: [-54.27, 6513.02, 40.54] },
    { zone: "PALETO", position: [24.9, 6475.75, 35.4] },
    { zone: "PALETO", position: [39.96, 6489.33, 35.38] },
    { zone: "STRAW", position: [59.26, -1468.71, 33.1] },
    { zone: "STRAW", position: [45.31, -1456.66, 33.1] },
    { zone: "STRAW", position: [49.55, -1602.43, 35.43] },
    { zone: "STRAW", position: [47.54, -1600.74, 35.43] },
    { zone: "STRAW", position: [45.57, -1599.09, 35.43] },
    { zone: "STRAW", position: [71.16, -1624.81, 35.1] },
    { zone: "STRAW", position: [3.21, -1668.07, 35.61] },
    { zone: "STRAW", position: [-39.76, -1666.99, 35.63] },
    { zone: "STRAW", position: [-100.71, -1405.08, 37.54] },
    { zone: "STRAW", position: [-100.44, -1391.71, 37.54] },
    { zone: "STRAW", position: [-120.77, -1395.56, 37.57] },
    { zone: "STRAW", position: [-123.06, -1409.85, 37.54] },
    { zone: "STRAW", position: [-136.12, -1414.68, 37.54] },
  ],
  roof_box: [
    { zone: "PALETO", position: [-96.63, 6504.46, 40.36] },
    { zone: "PALETO", position: [-93.91, 6507.17, 40.36] },
    { zone: "PALETO", position: [17.82, 6463.19, 35.14] },
    { zone: "PALETO", position: [15.28, 6460.65, 35.14] },
  ],
  big_aircon: [
    { zone: "PALETO", position: [54.6, 6333.02, 37.85] },
    { zone: "PALETO", position: [-10.76, 6294.73, 37.87] },
    { zone: "PALETO", position: [-15.41, 6292.05, 37.86] },
    { zone: "PALETO", position: [-43.86, 6377.65, 37.98] },
  ],
  trailer: [
    { zone: "RANCHO", position: [555.59, -1936.1, 23.8] },
    { zone: "RANCHO", position: [558, -1939.37, 23.8] },
    { zone: "RANCHO", position: [544.74, -1917.65, 23.77] },
    { zone: "RANCHO", position: [553.07, -1974.95, 23.74] },
    { zone: "RANCHO", position: [521.76, -1994.74, 23.74] },
    { zone: "RANCHO", position: [470.69, -1980.98, 23.69] },
    { zone: "STRAW", position: [-123.21, -1418.3, 29.17] },
  ],
  parapet: [{ zone: "MIRR", position: [1055.38, -365, 68.27] }],
  garages: [{ zone: "MIRR", position: [970.2, -703.32, 57.67] }],
  house_garage: [{ zone: "MIRR", position: [919.18, -638.4, 58.21] }],
  house: [{ zone: "MIRR", position: [898.43, -622.23, 57.06] }],
  corner_wall: [{ zone: "ROCKF", position: [-783.67, 165.53, 67.95] }],
  fence_panels: [{ zone: "ROCKF", position: [-830.41, 273.9, 87.04] }],
  dumpster: [
    { zone: "DAVIS", position: [219.25, -2010.98, 18.14] },
    { zone: "STRAW", position: [55.16, -1623.32, 28.41] },
    { zone: "STRAW", position: [53.02, -1625.87, 28.36] },
    { zone: "STRAW", position: [57.28, -1620.8, 28.41] },
  ],
});

export const WALLBANG_BOUNDS = Object.freeze({
  fence: { min: [-8.154, -34.514, -0.723], max: [21.259, -19.029, 1.198] },
  long_fence: { min: [-40.273, 12.29, -1.317], max: [-4.602, 39.182, 1.072] },
  gate: { min: [-11.437, 0.595, 0], max: [-6.436, 0.788, 2.372] },
  wood_fence: { min: [-2.344, -0.135, -1.42], max: [2.48, 0.335, 1.436] },
  transformer: { min: [-2.397, -1.831, -0.001], max: [2.386, 1.749, 5.059] },
  roof_aircon: { min: [-1.16, -1.894, 0], max: [1.329, 1.558, 1.898] },
  roof_box: { min: [-0.873, -2.432, -0.005], max: [0.891, 2.036, 1.972] },
  big_aircon: { min: [-1.755, -3.401, 0.138], max: [1.801, 3.38, 3.773] },
  trailer: { min: [-1.459, -6.065, -0.029], max: [1.459, 6.713, 4.542] },
  parapet: { min: [-7.343, -4.894, -1.546], max: [7.195, 4.32, 1.25] },
  garages: { min: [-8.767, -38.636, -1.264], max: [35.709, 16.797, 3.278] },
  house_garage: { min: [-16.142, -14.885, -1.354], max: [-3.62, 9.517, 3.509] },
  house: { min: [-6.649, -10.288, -0.097], max: [7.847, 8.494, 9.485] },
  corner_wall: { min: [1.474, -13.562, -1.294], max: [20.906, 3.331, 1.74] },
  fence_panels: { min: [-1.705, -5.275, -0.637], max: [1.869, 3.965, 0.659] },
  dumpster: { min: [-1.514, -0.97, -0.022], max: [1.514, 0.877, 2.223] },
});

export const WALLBANG_RESOURCES = Object.freeze([
  {
    name: "_manifest.ymf",
    size: 480,
    sha256: "9ddda821d8b2d37569041461750140349713b6662032c7643ec102fc815f250f",
  },
  {
    name: "astral_wallbang.ytyp",
    size: 1394,
    sha256: "507b0f55a0ec00cecc3dd757ebb878834516b297fb09e1a2eb02a2dc1c7cd75d",
  },
  {
    name: "astral_wallbang_big_aircon.ydr",
    size: 188042,
    sha256: "9eba8716ebda40930a58a6938c0546ea65a87fdf8c889e3a3b44c170eca0a0ff",
  },
  {
    name: "astral_wallbang_corner_wall.ydr",
    size: 2217,
    sha256: "72e4bea011f33f4822d1302c7c916593e930e7ac59ee6b992183df77b27f934e",
  },
  {
    name: "astral_wallbang_dumpster.ydr",
    size: 112654,
    sha256: "feb9211e8831d368390e9654b8782fbb79a9fe82f32e0ed1cb612ba502df3ae6",
  },
  {
    name: "astral_wallbang_fence.ydr",
    size: 9770,
    sha256: "b2105e0276085ff6c14f803fd86578ef24e0f466542e909c75aa47c8677aaa99",
  },
  {
    name: "astral_wallbang_fence_panels.ydr",
    size: 1076,
    sha256: "4a5345ed43fc9b96b984a61135661d21e2517ce79193399c5de74743e1101f0a",
  },
  {
    name: "astral_wallbang_garages.ydr",
    size: 83586,
    sha256: "71121d1ee56d3ebc529428b5088c0f1f7159606534a3e561f39af000a00f359b",
  },
  {
    name: "astral_wallbang_gate.ydr",
    size: 2740,
    sha256: "fde4417247a3d644aa6f833f81782c06e25a44b32512dfa2539e21c25f8fb62e",
  },
  {
    name: "astral_wallbang_house.ydr",
    size: 433539,
    sha256: "704e063b3d7cf5abe012cfc36904be54d77c5fcb39f9e05e65b54f5e319dbec1",
  },
  {
    name: "astral_wallbang_house_garage.ydr",
    size: 142104,
    sha256: "046b39cf696c68a8ca974a380c98a97f03add2420f0cbb3e15e04197875da1c4",
  },
  {
    name: "astral_wallbang_long_fence.ydr",
    size: 27954,
    sha256: "d97d5fc22eb258af832e49a83ab7ce912061b8ceea28a92aea015d3187218db9",
  },
  {
    name: "astral_wallbang_map.ymap",
    size: 2405,
    sha256: "65bba576b7d61db86a8d3b0af50f359ee30196dad17b0aca702bc15cac5fd8d3",
  },
  {
    name: "astral_wallbang_parapet.ydr",
    size: 12667,
    sha256: "5834ab47bc4aca5900002854683336ef559bc84e0908eac0943832111dd848fc",
  },
  {
    name: "astral_wallbang_roof_aircon.ydr",
    size: 20413,
    sha256: "0fba1b040e44700fc972bb9bb5782ed030f143647ce944899ddcfa2c889ebd84",
  },
  {
    name: "astral_wallbang_roof_box.ydr",
    size: 7376,
    sha256: "80b07a947990e56f220c9e35e260173cdad364b1a8a8fa48b8620ac1bd2824e0",
  },
  {
    name: "astral_wallbang_trailer.ydr",
    size: 875083,
    sha256: "4cacd3c9cb0d3cd215b3fe5e254bd8d953f8d1e73fb51a33ceaf93dc6adcfc59",
  },
  {
    name: "astral_wallbang_transformer.ydr",
    size: 168103,
    sha256: "73feb64b27d29488170f5468ef1bb4995c91f2c4d16bcbfd26c62e474edccff0",
  },
  {
    name: "astral_wallbang_wood_fence.ydr",
    size: 20431,
    sha256: "82c5f8eb4be0c0b567d2330b267ef9a7e932697478e20bf141fa57e18739d8c9",
  },
]);

export const WALLBANG_SHAPES = Object.freeze({
  fence: {
    vertices: 144,
    triangles: 272,
    sha256: "6ed6e1d6203dc04e801e2672089a00f5e957d212553829e1762e6803fce7105a",
  },
  long_fence: {
    vertices: 592,
    triangles: 1188,
    sha256: "40b14d18b297ae9f3bbfdcc63e03ea82bc5d9f9e7adccf1ace6f462693f09f22",
  },
  gate: {
    vertices: 44,
    triangles: 80,
    sha256: "4b38ddff8a7b003c90723c88ce10e8bea545274140ba6e6b71e9434de2e92982",
  },
  wood_fence: {
    vertices: 412,
    triangles: 648,
    sha256: "b7d9cf4bba21c44d2d322f5e4b36082496fd6504592c4786ad7e2ba3f7c329cb",
  },
  transformer: {
    vertices: 2830,
    triangles: 5276,
    sha256: "f8f768d22777ee58190d2b17a7f07a1d7023e16f41d6df96cb50b1b812dc7f43",
  },
  roof_aircon: {
    vertices: 220,
    triangles: 420,
    sha256: "6f6c74599cea94bd53e14fe6add9eb32cb058714339a38709ab1534ebe9268c4",
  },
  roof_box: {
    vertices: 113,
    triangles: 222,
    sha256: "856d81d2dc50c9ae7cd1f4f7ba32fb1ef2286ed8bf098d539630371f9a1f9cac",
  },
  big_aircon: {
    vertices: 4461,
    triangles: 8266,
    sha256: "701b60db41e8209d760a419fb1d445c69b8d61a34533bc557bb4ccf98c62ee5e",
  },
  trailer: {
    vertices: 7206,
    triangles: 13500,
    sha256: "4b7d9d41c5516ebb30d3af69702b482c71ceee03b6fd88dfafff5e906eef2a19",
  },
  parapet: {
    vertices: 222,
    triangles: 440,
    sha256: "38145c94e0392c55ffcf6c9a6a408181b9c9daad726d70e56acf172de2dfe20b",
  },
  garages: {
    vertices: 910,
    triangles: 1772,
    sha256: "005c639e5599e2d5729b59f2aeb8021ee2673ad83ae64e10c6991933228b4e14",
  },
  house_garage: {
    vertices: 1684,
    triangles: 3192,
    sha256: "a54a70a77b8eecb71deee7f8a73283c032dbf83f8f9bc4e8e9016a256024c058",
  },
  house: {
    vertices: 6380,
    triangles: 12762,
    sha256: "64d542a91a5ec8f33aed5a81a7c2b09efd042d66ff3ba6e3a7d1be8c37c098a4",
  },
  corner_wall: {
    vertices: 40,
    triangles: 72,
    sha256: "1b70f175ac78bade47499195080064b3c11c857de177b810a80a7774cadc3fb2",
  },
  fence_panels: {
    vertices: 24,
    triangles: 12,
    sha256: "7ba12edcc2c3b272189bf77449c07c39edfc7c9e0a79c11445e961beaa8ac3e3",
  },
  dumpster: {
    vertices: 1004,
    triangles: 2000,
    sha256: "14abcb743f486156843c2dfb8e709fae7e7776b5c10e9568d4a5960359260ef0",
  },
});
