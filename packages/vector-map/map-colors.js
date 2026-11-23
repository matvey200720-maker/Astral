import { MAP_TEMPLATE_MAP } from "./map-templates.js";
import { hexToRgb, isHexColor, rgbToHex } from "./color.js";
import { VOLUME_HEIGHT_RANGE, WORLD_MAP_TEMPLATE_MAP, normalizeWorldMap } from "./model.js";
import { PACK_COLOR_GROUPS, packElementTargets, packElements } from "./pack-colors.js";

const patch = (base, changes) => ({ ...base, ...changes });

// Проект выдаётся правке уже нормализованным.
const withProject = (config, run) => run(normalizeWorldMap(config));

// ---------- таблицы, собранные при загрузке ----------

const CLASSIC = WORLD_MAP_TEMPLATE_MAP.classic.patch.base;

// Цвета ролей радара «как в игре»; terrain и sand повторяют сушу, paths — взлётную полосу шаблона.
export const GAME_PALETTE = Object.freeze(
  Object.fromEntries(
    [
      ["sea", "sea"],
      ["land", "land"],
      ["terrain", "land"],
      ["sand", "land"],
      ["water", "water"],
      ["shallow", "shallow"],
      ["roads", "roads"],
      ["highways", "highways"],
      ["buildings", "buildings"],
      ["paths", "runway"],
      ["rail", "rail"],
      ["outline", "outline"],
      ["edgeGlowColor", "edgeGlowColor"],
    ].map(([role, source]) => [role, CLASSIC[source]]),
  ),
);

// «Вид» берега и фона, который ложится вместе с палитрой игры.
const SHORE_LOOK = Object.freeze({
  outlineWidth: CLASSIC.outlineWidth,
  edgeGlow: CLASSIC.edgeGlow,
  waterSmooth: 50,
  biomes: 0,
  relief: 0,
  roadCasing: 0,
});

// Засев и общий сброс кладут в base одно и то же.
const GAME_SEED = Object.freeze({ ...GAME_PALETTE, ...SHORE_LOOK });

const slider = (key, label, min, max, step, on, unit) =>
  Object.freeze({ key, label, min, max, step, ...(unit && { unit }), on });

// id, ключ в base, группа, подпись, затем слой подложки и/или ползунок.
const GAME_ROW_SPECS = [
  ["water", "water", "water", "Вода", { layer: "water" }],
  ["shallow", "shallow", "water", "Мелководье"],
  ["sea", "sea", "water", "Глубина и океан"],
  ["land", "land", "land", "Суша", { layer: "land" }],
  ["terrain", "terrain", "land", "Леса и горы"],
  ["sand", "sand", "land", "Пустыня и пляжи"],
  ["buildings", "buildings", "city", "Постройки", { layer: "buildings" }],
  ["roads", "roads", "roads", "Дороги", { layer: "roads" }],
  ["highways", "highways", "roads", "Магистрали"],
  ["paths", "paths", "roads", "Тропы"],
  ["rail", "rail", "roads", "Железная дорога"],
  ["outline", "outline", "shore", "Линия берега", { strength: slider("outlineWidth", "Толщина", 0, 12, 0.1, 1.2) }],
  ["glow", "edgeGlowColor", "shore", "Свечение берега", { strength: slider("edgeGlow", "Сила", 0, 100, 1, 40, "%") }],
];

const GAME_ROW_LIST = GAME_ROW_SPECS.map(([id, key, group, label, extra]) =>
  Object.freeze({ id, key, group, label, ...extra }),
);

// Обычный объект: имена из прототипа в нём «находятся» (так было и раньше).
const GAME_ROWS = Object.freeze(Object.assign({}, ...GAME_ROW_LIST.map((row) => ({ [row.id]: row }))));

const GAME_GROUPS = Object.freeze(PACK_COLOR_GROUPS.concat(Object.freeze({ id: "shore", title: "Берег" })));

// Какие роли показывает полоска образцов и в каком порядке.
const STRIP_ORDER = ["water", "sea", "fields", "forest", "land", "houses", "buildings", "roads", "freeway", "highways"];
const STRIP_SIZE = 6;
const BIOME_ROWS = ["terrain", "sand"];

// ---------- цвет ----------

// Смесь двух цветов: канал = A + (B − A) × d, d — доля второго.
const mixHex = (from, to, share) => {
  const [a, b] = [hexToRgb(from), hexToRgb(to)];
  return rgbToHex(Array.from(a, (start, at) => start + (b[at] - start) * share));
};

// Из чего смешивается цвет строки без своего значения в base: [первый, второй, доля второго].
const DERIVED_MIXES = {
  paths: (base) => [base.roads, base.land, 0.45],
  rail: (base) => [base.roads, base.highways || base.roads, 0.5],
  shallow: (base) => [base.water, "#ffffff", 0.35],
};

const recoloredValue = (key, base) => {
  const mix = DERIVED_MIXES[key];
  return isHexColor(base[key]) ? base[key] : mix ? mixHex(...mix(base)) : GAME_PALETTE[key];
};

// ---------- источник ----------

const SOURCE_RULES = new Map([
  ["schematic", () => "schematic"],
  ["image", () => "image"],
  [
    "template",
    ({ templateId, recolor }) => (MAP_TEMPLATE_MAP[templateId]?.kind !== "vector" ? "image" : recolor ? "game" : "pack"),
  ],
]);

export const mapColorSource = (config, options = {}) => {
  const { geometry = false, detected = false } = options;
  const { base } = config;
  const rule = SOURCE_RULES.get(base.source);
  return rule ? rule(base) : geometry || !detected ? "game" : "detected";
};

// ---------- модель ----------

// Группы раздела без воды: каждая со своими строками.
const assemble = (groups, rows, toItem) =>
  groups
    .filter(({ id }) => id !== "water")
    .map(({ id, title }) => ({ id, title, items: rows.filter(({ group }) => group === id).map(toItem) }));

const packGroups = ({ templateId, paletteMap }) => {
  const own = paletteMap || {};
  const elements = packElements(templateId);
  const targets = packElementTargets(elements, paletteMap);
  const toItem = ({ id, label, rep }) => {
    const custom = isHexColor(own[id]);
    return { id, label, value: custom ? own[id] : (targets.get(id) ?? rep), native: rep, changed: custom };
  };
  return assemble(PACK_COLOR_GROUPS, elements, toItem).filter(({ items }) => items.length);
};

const gameGroups = (base) => {
  const recolor = !!base.recolor;
  const hiddenLayers = new Set(base.hidden || []);
  const toItem = ({ id, key, label, layer, strength }) => {
    const native = GAME_PALETTE[key];
    const value = recolor ? recoloredValue(key, base) : native;
    const hidden = hiddenLayers.has(layer);
    return {
      id,
      label,
      value,
      native,
      changed: (recolor && String(value).toLowerCase() !== native.toLowerCase()) || (Boolean(layer) && hidden),
      ...(layer && { layer, hidden }),
      ...(strength && { strength: patch(strength, { value: base[strength.key] }) }),
    };
  };
  return assemble(GAME_GROUPS, GAME_ROW_LIST, toItem);
};

const MODEL_GROUPS = new Map([
  ["pack", packGroups],
  ["game", gameGroups],
]);

const sampleStrip = (groups) => {
  const rows = groups.flatMap(({ items }) => items);
  const wanted = STRIP_ORDER.flatMap((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    return row?.value ? [row.value] : [];
  });
  return (wanted.length ? wanted : rows.map(({ value }) => value)).slice(0, STRIP_SIZE);
};

export const mapColorModel = (config, options = {}) => {
  const source = mapColorSource(config, options);
  const groups = MODEL_GROUPS.get(source)?.(config.base) ?? [];
  return {
    source,
    groups,
    changed: groups.flatMap(({ items }) => items).filter(({ changed }) => changed).length,
    strip: sampleStrip(groups),
  };
};

// ---------- правки ----------

// Новый проект: верхние поля из changes, base — прежний base с поправками.
const revise = (project, { base, ...top }) =>
  normalizeWorldMap(Object.assign({}, project, top, { base: patch(project.base, base) }));

// Без перекраски base сперва засевается цветами игры, чтобы менялось лишь тронутое.
const seeded = (project) =>
  project.base.recolor ? project : revise(project, { template: "custom", base: { ...GAME_SEED, recolor: true } });

const without = (record, name) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== String(name)));

const setPackColor = (project, itemId, value) =>
  packElements(project.base.templateId).map(({ id }) => id).includes(itemId)
    ? revise(project, { base: { paletteMap: patch(project.base.paletteMap, { [itemId]: value }) } })
    : project;

// Что ложится в base, когда строка «как в игре» получила цвет.
const gameEdit = (row, value, base) => ({
  [row.key]: value,
  ...(BIOME_ROWS.includes(row.id) && !base.biomes && { biomes: 100 }),
  ...(row.strength && !base[row.strength.key] && { [row.strength.key]: row.strength.on }),
});

const paintRow = (start, row, value) =>
  revise(start, {
    base: gameEdit(row, value, start.base),
    ...(row.id === "sea" && { pauseMap: patch(start.pauseMap, { sea: "color", seaColor: value }) }),
  });

const setGameColor = (project, itemId, value) => {
  const row = GAME_ROWS[itemId];
  return row ? paintRow(seeded(project), row, value) : project;
};

const SETTERS = new Map([
  ["pack", setPackColor],
  ["game", setGameColor],
]);

export const setMapColor = (config, itemId, value, options = {}) =>
  withProject(config, (project) => {
    const source = isHexColor(value) ? mapColorSource(project, options) : null;
    return SETTERS.get(source)?.(project, itemId, value) ?? project;
  });

export const setMapColorStrength = (config, itemId, value) => {
  const meter = GAME_ROWS[itemId]?.strength;
  return meter ? withProject(config, (project) => revise(seeded(project), { base: { [meter.key]: value } })) : normalizeWorldMap(config);
};

export const setMapLayerHidden = (config, layer, hidden) =>
  withProject(config, (project) => {
    const start = seeded(project);
    const hiddenNow = start.base.hidden || [];
    const list = hidden ? [...new Set([...hiddenNow, layer])] : [...new Set(hiddenNow)].filter((name) => name !== layer);
    return revise(start, { base: { hidden: list } });
  });

export const resetMapColor = (config, itemId, options = {}) =>
  withProject(config, (project) => {
    const source = mapColorSource(project, options);
    const row = GAME_ROWS[itemId];
    if (source === "pack") return revise(project, { base: { paletteMap: without(project.base.paletteMap, itemId) } });
    return source === "game" && row && project.base.recolor
      ? revise(project, { base: { [row.key]: GAME_PALETTE[row.key], ...(row.strength && { [row.strength.key]: 0 }) } })
      : project;
  });

export const resetMapColors = (config, options = {}) =>
  withProject(config, (project) => {
    const source = mapColorSource(project, options);
    if (source === "pack") return revise(project, { base: { paletteMap: {} } });
    return source === "game" && project.base.recolor
      ? revise(project, {
          template: "original",
          base: { ...GAME_SEED, recolor: false, hidden: [] },
          pauseMap: patch(project.pauseMap, { sea: "game" }),
        })
      : project;
  });

/**
 * «3D-здания» в самом радаре (21.11.2026, ночная версия): настоящая геометрия кварталов в плитках радара — стенки стопкой слоёв и крыша, высоты по
 * районам. Радар тогда рисуется векторными плитками по ролям (картинка под ним не нужна), поэтому только у карты из игры и у векторных готовых карт;
 * у снимка и карты-картинки зданий нет. Высота — множитель к районной: ползунок «Высота зданий» 24 м — районная как есть (`block-heights.js`).
 * Ключа нет, когда здания выключены или рисовать не из чего.
 *
 * @returns {{heightScale: number}|null}
 */
export function radarBuildings(config) {
  const normalized = normalizeWorldMap(config);
  if (!normalized.base.volumeBuildings) return null;
  const source = mapColorSource(normalized, { geometry: true });
  if (source !== "game" && source !== "pack") return null;
  const [low, high] = VOLUME_HEIGHT_RANGE;
  const height = Math.min(high, Math.max(low, Number(normalized.base.volumeHeight) || 24));
  return { heightScale: Math.round((height / 24) * 100) / 100 };
}
