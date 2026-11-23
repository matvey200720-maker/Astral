/*
 * Засаженность «Растительности» вдоль дорог (ТЗ 11.10.2026): что встаёт на
 * местах плана посадки (`resources/vegetation/planting.json`,
 * `scripts/prepare-vegetation-planting.mjs`) при выбранной засаженности.
 *
 * План знает места — ряды вдоль трасс и улиц (`row`, `minor`, второй ряд
 * `back`), деревья и кусты разделительных полос (`median`, `shrub`) и
 * клумбы вдоль их бордюров (`bed`) — и ступень каждого: с какой
 * засаженности оно занято. Здесь — что именно встаёт:
 *
 *   • порода — по району, роли и участку ряда (`stretch`, ≈ 120 м): один
 *     участок — одна порода и её модели вперемешку, поэтому ряд выглядит
 *     посаженным, а не случайным. В городе вдоль трасс — высокие веерные
 *     пальмы, за ними — фикусы и жакаранды; в холмах — кипарисы,
 *     эвкалипты и дубы; в пустыне — пальмы и юкки; у Палето — хвойные.
 *     Включённая «Перемешка» района даёт свои виды (по виду на участок);
 *   • кусты полос — райские птицы, агавы, стриженые шары по району;
 *   • клумбы — пачки травы с цветами Rockstar (`FLOWER_KINDS`): две краски
 *     участка — внешний ряд у бордюра и внутренний (маки и алые кисточки,
 *     люпины и белые соцветия…). При «Цветах на траве» — выбранные виды;
 *     при «Без цветов» клумб нет;
 *   • дальность — у деревьев как у моделей Rockstar рядом (до 300 м), у
 *     кустов и клумб — короткая.
 *
 * Всё по хешу места: кадр, пересборка и игра видят одно и то же.
 */

import VEGETATION_PLANTING from "./inventory/vegetation-planting.js";
import { FLOWER_KINDS, TREE_KINDS, joaatName, placeShare } from "./vegetation-world.js";

export { VEGETATION_PLANTING };
/* Леса гуще — третья часть засаженности (`vegetation-world.js`). */
export { densityForestsIn } from "./vegetation-world.js";

export const PLANTING_VERSION = 1;
/** Роли мест плана (номер роли в плане — индекс). */
export const PLANTING_ROLES = Object.freeze(["row", "minor", "back", "median", "shrub", "bed", "edge"]);
/** Части засаженности: ряды вдоль дорог, полосы с клумбами, леса гуще. */
export const PLANTING_PARTS = Object.freeze({ roads: ["row", "minor", "back"], medians: ["median", "shrub", "bed", "edge"] });
/** Дальность новых сущностей по роли (метры): деревья — как у Rockstar. */
export const PLANTING_LOD = Object.freeze({ row: 300, minor: 260, back: 300, median: 260, shrub: 100, bed: 110, edge: 100 });

const SALT_MODEL = 0x0c12;
const SALT_YAW = 0x0c13;
const SALT_SCALE = 0x0c14;
const SALT_BED = 0x0c15;

/*
 * Породы посадки — модели деревьев игры (постоянные типы `v_trees`,
 * `v_fanpalm`, `v_palm`). Размер — разброс множителя. Высокие веерные
 * пальмы — у трасс и бульваров, средние — у улиц и на полосах.
 */
const FAMILIES = Object.freeze({
  palmTall: { models: ["prop_palm_fan_03_c", "prop_palm_fan_03_d", "prop_palm_fan_04_c", "prop_palm_fan_04_d"], scale: [0.9, 1.1] },
  palmHuge: { models: ["prop_palm_huge_01a", "prop_palm_huge_01b"], scale: [0.85, 1] },
  palmMed: { models: ["prop_palm_med_01a", "prop_palm_med_01b", "prop_palm_med_01c", "prop_palm_med_01d"], scale: [0.9, 1.1] },
  palmFan: { models: ["prop_palm_fan_03_a", "prop_palm_fan_03_b", "prop_palm_fan_04_a", "prop_palm_fan_04_b"], scale: [0.9, 1.1] },
  palmDesert: { models: ["prop_palm_fan_02_a", "prop_palm_fan_02_b", "prop_palm_sm_01e", "prop_palm_sm_01f"], scale: [0.9, 1.1] },
  ficus: { models: ["prop_tree_lficus_02", "prop_tree_lficus_03", "prop_tree_lficus_05", "prop_tree_lficus_06"], scale: [0.7, 0.85] },
  jacaranda: { models: ["prop_tree_jacada_01", "prop_tree_jacada_02"], scale: [0.75, 0.9] },
  eucalyptus: { models: ["prop_tree_eucalip_01"], scale: [0.7, 0.9] },
  olive: { models: ["prop_tree_olive_01", "prop_rus_olive"], scale: [0.75, 0.95] },
  cypress: { models: ["prop_tree_cypress_01"], scale: [0.8, 1] },
  oak: { models: ["prop_tree_oak_01", "prop_tree_eng_oak_01"], scale: [0.65, 0.8] },
  maple: { models: ["prop_tree_maple_02", "prop_tree_maple_03"], scale: [0.7, 0.85] },
  pine: { models: ["prop_tree_pine_01", "prop_tree_pine_02"], scale: [0.7, 0.85] },
  conifer: { models: ["prop_tree_cedar_s_01", "prop_tree_cedar_s_04", "prop_tree_cedar_02", "prop_tree_cedar_03", "prop_tree_cedar_04"], scale: [0.7, 0.85] },
  joshua: { models: ["prop_joshua_tree_01a", "prop_joshua_tree_01b", "prop_joshua_tree_01c", "prop_joshua_tree_02a", "prop_joshua_tree_02b"], scale: [0.8, 1] },
  mesquite: { models: ["prop_tree_mquite_01"], scale: [0.75, 0.9] },
  /* Кусты полос. */
  paradise: { models: ["prop_plant_paradise", "prop_plant_paradise_b"], scale: [0.9, 1.1] },
  agave: { models: ["prop_agave_01", "prop_agave_02", "prop_aloevera_01"], scale: [1, 1.25] },
  topiary: { models: ["prop_bush_ornament_01", "prop_bush_ornament_02", "prop_bush_ornament_03", "prop_bush_ornament_04"], scale: [0.85, 1] },
  bottlebrush: { models: ["prop_plant_group_01", "prop_plant_group_04"], scale: [0.45, 0.55] },
  fern: { models: ["prop_plant_fern_01a", "prop_plant_fern_01b"], scale: [1, 1.2] },
  /* Низкие цветущие кусты вдоль бордюра — где клумбе нет карты травы. */
  paradiseLow: { models: ["prop_plant_paradise", "prop_plant_paradise_b"], scale: [0.45, 0.58] },
  agaveLow: { models: ["prop_agave_01", "prop_aloevera_01"], scale: [0.8, 1] },
});
const FAMILY_HASHES = Object.fromEntries(Object.entries(FAMILIES).map(([id, family]) => [id, family.models.map(joaatName)]));
export const PLANTING_MODELS = Object.freeze([...new Set(Object.values(FAMILIES).flatMap((family) => family.models))]);

/*
 * Что сажать: район → роль → участки по весу. Для «row»/«back» в городе
 * важен и класс дороги: у трасс — высокие пальмы, у малых улиц — средние.
 */
const W = (family, weight = 1) => [family, weight];
const PALETTES = Object.freeze({
  city: {
    row: [W("palmTall", 3), W("palmHuge", 2), W("palmFan", 1)],
    minor: [W("palmMed", 2), W("jacaranda", 1), W("ficus", 1)],
    back: [W("ficus", 2), W("jacaranda", 1), W("eucalyptus", 1)],
    median: [W("palmMed", 2), W("palmFan", 2), W("palmTall", 1)],
    shrub: [W("paradise", 3), W("agave", 1)],
    edge: [W("paradiseLow", 1)],
  },
  vinewood: {
    row: [W("cypress", 2), W("eucalyptus", 1), W("palmTall", 1)],
    minor: [W("cypress", 2), W("olive", 1), W("jacaranda", 1)],
    back: [W("oak", 1), W("eucalyptus", 1)],
    median: [W("cypress", 1), W("olive", 1), W("palmMed", 1)],
    shrub: [W("topiary", 2), W("paradise", 1)],
    edge: [W("paradiseLow", 1)],
  },
  coast: {
    row: [W("palmTall", 2), W("palmFan", 1)],
    minor: [W("palmMed", 2), W("palmFan", 1)],
    back: [W("eucalyptus", 1), W("olive", 1)],
    median: [W("palmMed", 1), W("palmFan", 1)],
    shrub: [W("agave", 2), W("paradise", 1)],
    edge: [W("paradiseLow", 1), W("agaveLow", 1)],
  },
  hills: {
    row: [W("eucalyptus", 2), W("oak", 2), W("cypress", 1)],
    minor: [W("oak", 2), W("olive", 1)],
    back: [W("oak", 2), W("pine", 1), W("eucalyptus", 1)],
    median: [W("olive", 1), W("cypress", 1)],
    shrub: [W("bottlebrush", 2), W("agave", 1)],
    edge: [W("agaveLow", 1), W("paradiseLow", 1)],
  },
  country: {
    row: [W("eucalyptus", 2), W("oak", 2), W("olive", 1)],
    minor: [W("oak", 2), W("olive", 1), W("maple", 1)],
    back: [W("oak", 2), W("eucalyptus", 1)],
    median: [W("olive", 1), W("oak", 1)],
    shrub: [W("bottlebrush", 1), W("agave", 1)],
    edge: [W("agaveLow", 1), W("paradiseLow", 1)],
  },
  desert: {
    row: [W("palmDesert", 2), W("joshua", 2), W("mesquite", 1)],
    minor: [W("joshua", 2), W("mesquite", 1), W("palmDesert", 1)],
    back: [W("joshua", 1), W("mesquite", 1)],
    median: [W("palmDesert", 2), W("joshua", 1)],
    shrub: [W("agave", 1)],
    edge: [W("agaveLow", 1)],
  },
  forest: {
    row: [W("conifer", 3), W("pine", 1)],
    minor: [W("conifer", 2), W("maple", 1)],
    back: [W("conifer", 2), W("pine", 1)],
    median: [W("conifer", 1), W("maple", 1)],
    shrub: [W("fern", 1)],
    edge: [W("fern", 1)],
  },
});
/* Район → палитра; западное побережье у моря — пальмы. */
const AREA_PALETTE = Object.freeze({
  city: "city",
  vinewood: "vinewood",
  chumash: "hills",
  tataviam: "hills",
  harmony: "country",
  zancudo: "country",
  desert: "desert",
  grapeseed: "country",
  paleto: "forest",
});
export function plantingPaletteOf(area, z) {
  if (area === "chumash" && z < 35) return "coast";
  return AREA_PALETTE[area] || "country";
}

/* Краски клумб: внешний ряд у бордюра и внутренний. */
const BED_PALETTES = Object.freeze({
  warm: ["poppy", "paintbrush"],
  cool: ["lupin", "quinine"],
  sun: ["brittlebush", "dandelion"],
  meadow: ["meadow", "daisy"],
  sage: ["sage", "quinine"],
});
const BED_BY_PALETTE = Object.freeze({
  city: [W("warm", 3), W("cool", 1), W("meadow", 1)],
  vinewood: [W("cool", 2), W("warm", 1), W("meadow", 1)],
  coast: [W("warm", 2), W("sun", 1)],
  hills: [W("meadow", 2), W("warm", 1), W("cool", 1)],
  country: [W("meadow", 2), W("sun", 1), W("warm", 1)],
  desert: [W("sun", 2), W("sage", 1)],
  forest: [W("cool", 2), W("meadow", 1)],
});
const FLOWER_BY_ID = new Map(FLOWER_KINDS.map((kind) => [kind.id, kind]));
const TREE_BY_ID = new Map(TREE_KINDS.map((kind) => [kind.id, kind]));

function weighted(list, share) {
  const total = list.reduce((sum, [, weight]) => sum + weight, 0);
  let left = share * total;
  for (const [item, weight] of list) {
    if (left < weight) return item;
    left -= weight;
  }
  return list[list.length - 1][0];
}

/**
 * Засаженность в части посадки: `{ value, areas, roads, medians }` (как у
 * `normalizeDensity`). Возвращает решатель: `(role, tier, area) → bool`.
 */
export function plantingFilter(density) {
  const value = Number(density?.value) || 0;
  const areas = new Set(density?.areas || []);
  const roles = new Set([...(density?.roads === false ? [] : PLANTING_PARTS.roads), ...(density?.medians === false ? [] : PLANTING_PARTS.medians)]);
  return (role, tier, area) => value > 0 && roles.has(role) && areas.has(area) && tier <= value / 100 + 1e-9;
}

/**
 * Сущность дерева или куста на месте плана: `slot` — `{ role, x, y, z, cls,
 * stretch, area }`, `mix` — виды «Перемешки» района (`TREE_KINDS` по id) или
 * `null`. Возвращает `{ archetype, position, rotation, scale, lodDist }`.
 */
export function plantingEntity(slot, mix = null) {
  const { role, x, y, z, stretch = 0, area } = slot;
  const share = (salt) => placeShare(x, y, salt);
  /* Участок: одна порода на ≈ 120 м ряда. */
  const stretchShare = ((stretch * 2654435761) >>> 0) / 4294967296;
  let hashes;
  let scale;
  if (mix?.length && role !== "shrub" && role !== "edge") {
    const kind = TREE_BY_ID.get(mix[Math.min(mix.length - 1, Math.floor(stretchShare * mix.length))]);
    hashes = kind.hashes;
    scale = [0.7, 0.85];
  } else {
    const palette = PALETTES[plantingPaletteOf(area, z)];
    const list = palette[role] || palette.row;
    const family = weighted(list, stretchShare);
    hashes = FAMILY_HASHES[family];
    scale = FAMILIES[family].scale;
  }
  const archetype = hashes[Math.min(hashes.length - 1, Math.floor(share(SALT_MODEL) * hashes.length))];
  const yaw = share(SALT_YAW) * Math.PI * 2;
  const size = Math.round((scale[0] + (scale[1] - scale[0]) * share(SALT_SCALE)) * 1000) / 1000;
  return {
    archetype,
    /* Ствол чуть в землю: на откосе ни один край не висит. */
    position: [x, y, Math.round((z - 0.2) * 100) / 100],
    rotation: [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)],
    scale: [size, size],
    lodDist: PLANTING_LOD[role] || 150,
  };
}

/**
 * Две краски клумбы участка: `[внешний, внутренний]` — виды `FLOWER_KINDS`.
 * `flowers` — «Цветы на траве» работы: при «add» — из выбранных видов.
 */
export function plantingBedKinds(slot, flowers = null) {
  const stretchShare = (((slot.stretch || 0) * 2246822519) >>> 0) / 4294967296;
  if (flowers?.mode === "add" && flowers.kinds?.length) {
    const kinds = flowers.kinds.map((id) => FLOWER_BY_ID.get(id)).filter(Boolean);
    const first = Math.floor(stretchShare * kinds.length) % kinds.length;
    return [kinds[first], kinds[(first + 1) % kinds.length]];
  }
  const palette = weighted(BED_BY_PALETTE[plantingPaletteOf(slot.area, slot.z)] || BED_BY_PALETTE.city, stretchShare);
  return BED_PALETTES[palette].map((id) => FLOWER_BY_ID.get(id));
}

/**
 * Цветы клумбы — точки пачки травы: прямоугольник `length × width` вдоль
 * `heading` с центром в `[x, y]`, два ряда (у бордюра и внутри), шаг
 * ≈ 0,45 м с разбросом по хешу. Возвращает `[{ kind, x, y, z, scale }]`;
 * `scale` — 0…1 доля размаха пачки.
 */
export function plantingBedFlowers(slot, flowers = null) {
  const kinds = plantingBedKinds(slot, flowers);
  const { x, y, z0 = slot.z, z1 = slot.z, length = 7, width = 1, heading = 0 } = slot;
  const tx = Math.cos(heading);
  const ty = Math.sin(heading);
  /* Нормаль — в сторону бордюра (`side` плана), посередине — в одну сторону. */
  const outward = slot.side < 0 ? -1 : 1;
  const nx = -ty * outward;
  const ny = tx * outward;
  const out = [];
  const rows = width >= 0.9 ? [width / 4, -width / 4] : [0];
  rows.forEach((offset, row) => {
    const kind = kinds[row % kinds.length];
    const steps = Math.max(2, Math.round(length / 0.45));
    for (let k = 0; k <= steps; k += 1) {
      const along = -length / 2 + (length * k) / steps;
      const px = x + tx * along + nx * offset;
      const py = y + ty * along + ny * offset;
      const jitter = placeShare(px, py, SALT_BED) - 0.5;
      const qx = px + tx * jitter * 0.2 + nx * jitter * 0.12;
      const qy = py + ty * jitter * 0.2 + ny * jitter * 0.12;
      const share = (along + length / 2) / length;
      out.push({ kind, x: qx, y: qy, z: z0 + (z1 - z0) * share, scale: 0.35 + 0.65 * placeShare(qx, qy, SALT_BED + 1) });
    }
  });
  return out;
}

/** Модели плана — для траста и проверок: все деревья и кусты посадки. */
export const plantingFamilyOf = (id) => FAMILIES[id] || null;

/* Клумбы одной карты травы — пачками по клеткам 64 м: у пачки один вид и
   небольшая рамка (травинки квантуются по рамке). */
const BED_CELL = 64;

/**
 * Что посадить по плану (`planting.json`) при работе `input`:
 *
 *   • `rows` — `Map<карта района, { name, at, area, rows }>`, у ряда —
 *     сущность строкой `[archetype, x, y, z, qz, qw, scale, lodDist]`
 *     (поворот вокруг вертикали — две составляющие кватерниона);
 *   • `beds` — `Map<карта травы, { name, at, area, batches }>`, пачки цветов
 *     клумб (`appendGrassBatches`);
 *   • `counts` — сколько чего (окну и отчёту).
 *
 * Карты — по плану, места — ступенью засаженности, ролью (части «вдоль
 * дорог» и «полосы и клумбы») и районом. «Без цветов» — без клумб.
 */
export function plantingSelection(planting, input) {
  const density = input?.density || {};
  const forest = input?.forest || {};
  const flowers = input?.flowers || null;
  const keep = plantingFilter(density);
  const rows = new Map();
  const beds = new Map();
  const counts = { rowTrees: 0, medianTrees: 0, shrubs: 0, beds: 0, flowers: 0 };
  if (!planting || !(Number(density.value) > 0)) return { rows, beds, counts };
  const mixFor = (area) => (forest.enabled && forest.areas?.includes(area) ? forest.kinds : null);
  const hosts = planting.hosts || [];
  const grass = planting.grass || [];
  for (const [host, x10, y10, z10, roleCode, tier, cls, stretch] of planting.trees || []) {
    const role = PLANTING_ROLES[roleCode];
    const [name, at, area] = hosts[host] || [];
    if (!name || !keep(role, tier / 100, area)) continue;
    const entity = plantingEntity({ role, x: x10 / 10, y: y10 / 10, z: z10 / 10, cls, stretch, area }, mixFor(area));
    if (!rows.has(name)) rows.set(name, { name, at, area, rows: [] });
    rows.get(name).rows.push([entity.archetype, entity.position[0], entity.position[1], entity.position[2], entity.rotation[2], entity.rotation[3], entity.scale[0], entity.lodDist]);
    if (role === "median") counts.medianTrees += 1;
    else if (role === "shrub" || role === "edge") counts.shrubs += 1;
    else counts.rowTrees += 1;
  }
  if (flowers?.mode !== "none")
    for (const [host, x10, y10, z10, z0, z1, heading, length10, width10, tier, stretch, side = 0] of planting.beds || []) {
      const [name, at, area] = grass[host] || [];
      if (!name || !keep("bed", tier / 100, area)) continue;
      const slot = { x: x10 / 10, y: y10 / 10, z: z10 / 10, z0: z0 / 10, z1: z1 / 10, heading: (heading * Math.PI) / 180, length: length10 / 10, width: width10 / 10, stretch, area, side };
      if (!beds.has(name)) beds.set(name, { name, at, area, cells: new Map() });
      const cells = beds.get(name).cells;
      for (const item of plantingBedFlowers(slot, flowers)) {
        const key = `${item.kind.id}:${Math.floor(item.x / BED_CELL)},${Math.floor(item.y / BED_CELL)}`;
        if (!cells.has(key)) cells.set(key, { kind: item.kind, instances: [] });
        cells.get(key).instances.push({ x: Math.round(item.x * 100) / 100, y: Math.round(item.y * 100) / 100, z: Math.round(item.z * 100) / 100, scale: Math.round(item.scale * 1000) / 1000, colour: [...item.kind.tint] });
        counts.flowers += 1;
      }
      counts.beds += 1;
    }
  for (const item of beds.values()) {
    item.batches = [...item.cells.values()].map(({ kind, instances }) => ({ archetype: kind.hash, scale: [...kind.scale], lodDist: PLANTING_LOD.bed, instances }));
    delete item.cells;
  }
  return { rows, beds, counts };
}
