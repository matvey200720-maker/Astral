// Справочник готовых карт-шаблонов из паков сообщества.

export const MAP_TEMPLATE_ROOT = "/map-templates";
export const MOD_PACK_TEMPLATE = "mod-pack";

// Одиночные файлы шаблона; ключ в наборе — имя файла без расширения.
const TEMPLATE_FILES = ["manifest.json", "map.webp", "card.webp", "state.webp"];

const SATELLITE_GRID = Object.freeze({
  opacity: 34,
  step: 12,
  labels: true,
  color: "#ffffff",
});

// Порядок ключей записи: базовые, затем добавочные (grid, overlayFrom, virtual).
function entry(id, title, hint, author, pack, assets, kind, look, extra = {}) {
  return Object.freeze({
    id,
    title,
    hint,
    author,
    pack,
    assets,
    kind,
    look,
    ...extra,
  });
}

const SATELLITE = "Satellite_Without_Grid_Akio_Mods";

export const MAP_TEMPLATES = Object.freeze([
  entry(
    "akio-satellite",
    "Спутник",
    "Снимок штата сверху: рельеф, крыши, пляжи и вода",
    "Akio Mods",
    SATELLITE,
    "akio-satellite",
    "raster",
    "dark",
  ),
  entry(
    "akio-satellite-grid",
    "Спутник с сеткой",
    "Тот же снимок и сетка координат с буквами и цифрами",
    "Akio Mods",
    SATELLITE,
    "akio-satellite",
    "raster",
    "dark",
    { grid: SATELLITE_GRID },
  ),
  entry(
    "akio-bw",
    "Чёрно-белая",
    "Серый штат и тёмные дороги — ничего не отвлекает от зон",
    "Akio Mods",
    "Black_White_GTA5RP_Akio_Mods",
    "akio-bw",
    "raster",
    "dark",
  ),
  entry(
    "akio-atlas-vector",
    "Атлас",
    "Светлый атлас: зелёные холмы, белые дороги, жёлтые магистрали",
    "Akio Mods",
    "Atlas_Vectorized_Akio_Mods",
    "akio-atlas-vector",
    "vector",
    "light",
  ),
  entry(
    "akio-bw-vector",
    "Графит",
    "Серая карта: тёмные кварталы, чёрные улицы, белые магистрали",
    "Akio Mods",
    "Black_White_Vectorized_GTA5RP_Akio_Mods",
    "akio-bw-vector",
    "vector",
    "dark",
    { overlayFrom: 14.5 },
  ),
  entry(
    "iskra-majestic",
    "Ночь",
    "Тёмная спокойная карта — под яркие зоны и подписи",
    "ИСКРА (adxnis)",
    "Pack vector map for Majestic RP by adxnis",
    "iskra-majestic",
    "vector",
    "dark",
  ),
  entry(
    "bigmap-coal",
    "Уголь",
    "Угольная карта с чёрными дорогами — строгая, под яркие зоны и подписи",
    "Egzo (Infinity Mods)",
    "BIG MAP by Egzo",
    "bigmap-coal",
    "vector",
    "dark",
  ),
  entry(
    "akio-homa",
    "GTA5RP · Homa Guides",
    "Тёмная карта с подписями мест и зонами GTA5RP",
    "Akio Mods × Homa Guides",
    "Best_Map_GTA5RP_Homa_Guides_Akio_Mods",
    "akio-homa",
    "vector",
    "dark",
  ),
]);

const MOD_PACK_ENTRY = entry(
  MOD_PACK_TEMPLATE,
  "Карта из мода",
  "Большая карта мода из каталога — её векторный радар, своими цветами",
  "",
  "",
  MOD_PACK_TEMPLATE,
  "vector",
  "dark",
  { virtual: true },
);

export const MAP_TEMPLATE_MAP = Object.freeze(
  Object.fromEntries(
    [...MAP_TEMPLATES, MOD_PACK_ENTRY].map((template) => [
      template.id,
      template,
    ]),
  ),
);

// По одной записи на папку: порядок по первому появлению, pack и kind — от последнего шаблона папки.
const folders = new Map();
for (const { assets, pack, kind } of MAP_TEMPLATES)
  folders.set(assets, Object.freeze({ assets, pack, kind }));
export const MAP_TEMPLATE_ASSETS = Object.freeze(Array.from(folders.values()));

export const MAP_TEMPLATE_CARD_RECT = Object.freeze({
  u: 0.115,
  v: 0.612,
  width: 0.556,
  height: 0.231,
});

// Цвета: [метки, обводка меток, зоны]. Внутренние объекты markers и zones намеренно не заморожены.
const LABEL_COLORS = {
  light: ["#1f2633", "#ffffff", "#1f2633"],
  dark: ["#eef2fb", "#04060a", "#ffffff"],
};

function labelsFor([marker, outline, zone]) {
  return Object.freeze({
    markers: { labelColor: marker, labelOutlineColor: outline },
    zones: { labelColor: zone },
  });
}

export const MAP_TEMPLATE_LABELS = Object.freeze(
  Object.fromEntries(
    Object.entries(LABEL_COLORS).map(([look, colors]) => [
      look,
      labelsFor(colors),
    ]),
  ),
);

export function mapTemplateFolder(id) {
  const folder = MAP_TEMPLATE_MAP[id]?.assets;
  return `${MAP_TEMPLATE_ROOT}/${folder || `${id}`}`;
}

export function mapTemplateFiles(id) {
  const folder = mapTemplateFolder(id);
  const virtual = Boolean(MAP_TEMPLATE_MAP[id]?.virtual);
  const files = {};
  for (const name of TEMPLATE_FILES)
    files[name.slice(0, name.indexOf("."))] = virtual
      ? null
      : `${folder}/${name}`;
  files.tile = virtual
    ? () => null
    : (row, column) => `${folder}/tile-${row}-${column}.webp`;
  return files;
}
