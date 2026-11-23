/*
 * Покраска растительности: то, чего прежняя опись не видела (жалоба
 * владельца 11.10.2026 — «трава красится не вся, зелёные проплешины; большие
 * кусты не меняются; цветы не красить; на гольфе вдали трава другого цвета»).
 *
 * Что нашлось по файлам игры (11.10.2026):
 *
 *  • ПРОЦЕДУРНАЯ ТРАВА (`CPlantMgr`) — пучки, которые игра сама рассыпает по
 *    земле по типу поверхности (`procedural.meta`, 269 наземных записей:
 *    «High_Slopes_Grasses_Stones», «Green_Meadow_01», «Urban_GreenGrass_01»…).
 *    Это и есть зелёные кочки среди травы на склонах Вайнвуда: карты травы и
 *    словари земли их не касаются. Пучок — спрайт `txgrassNN` из словарей
 *    `x64a.rpf:textures/plantsmgr.ytd` (512 px), `plantsmgr1/2.ytd` (256 px)
 *    × цвет записи (`Color` — почти белый: 231,242,226 и т. п.). Поэтому
 *    красится сам спрайт — только зелень: лепестки цветочных спрайтов
 *    (маки, люпины, эхинацея, жёлтые и белые соцветия) остаются своими.
 *  • ПАЛИТРЫ ТИНТА — у шейдеров `*_tnt` цвет — лист × строка палитры модели
 *    (`<модель>_pal`, 256 × 4), столбец — по цвету вершины. У земли
 *    гольф-клуба (`bh1_43_golf_1a`, `terrain_cb_w_4lyr_cm_tnt`) палитра —
 *    приглушённая зелень (81,108,91), у плюща `bh1_18_bigivy`
 *    (`normal_spec_tnt`) — густая (0,137,31). Лист можно красить сколько
 *    угодно: палитра тянет итог обратно в зелень — рыжий плющ × (0; 0,54;
 *    0,12) остаётся тёмно-зелёным. Палитра становится серой той же яркости:
 *    светотень вершин остаётся, тон — от листа.
 *  • КАМНИ И БРЁВНА в картах травы (`proc_stones_*`, `prop_log_a*`) — пачки
 *    той же травы, но не трава: цвет травы их не красит.
 */

import { rgbToHsl } from "./colour.js";
import { grassReference, grassTarget, grassWeight, shiftGrass } from "./grass-colour.js";

/* ------------------------------------------------------------------ *
 * Процедурная трава
 * ------------------------------------------------------------------ */

/** Словари спрайтов процедурной травы (`x64a.rpf:textures/`): высокое качество и два обычных. */
export const PLANT_SPRITE_FILES = Object.freeze(["plantsmgr.ytd", "plantsmgr1.ytd", "plantsmgr2.ytd"]);

/** Спрайт пучка процедурной травы (`txgrass07`, `txgrass07_lod1`). */
export const isPlantSprite = (name) => /^txgrass\d\d(_lod1)?$/.test(String(name).toLowerCase());

/*
 * Спрайты с цветами (по листам игры, 11.10.2026): жёлтые соцветия (00),
 * кастиллея (03), белые и сиреневые колоски (04), эхинацея (05), люпины
 * (10), белый и жёлтый тысячелистник (12, 13), маки (14), мелкие жёлтые (15)
 * и лиловые с жёлтыми (16). У них красятся листья и стебли, лепестки — нет.
 */
export const PLANT_FLOWER_SPRITES = Object.freeze(["txgrass00", "txgrass03", "txgrass04", "txgrass05", "txgrass10", "txgrass12", "txgrass13", "txgrass14", "txgrass15", "txgrass16"]);
const FLOWER_SPRITES = new Set(PLANT_FLOWER_SPRITES);
/**
 * Лист с цветами: спрайт с цветами (и его дальняя копия `_lod1`) или лист
 * цветов наземных растений (`prop_ground_cover_flower_01`, `rsn_am_flowers_4`).
 */
export const plantSpriteIsFlower = (name) => {
  const key = String(name).toLowerCase();
  return FLOWER_SPRITES.has(key.replace(/_lod1$/, "")) || /flower/.test(key);
};

/*
 * Наземные растения — модели-вещи, которые Rockstar ставит россыпью по
 * газонам и склонам: группы растений (`prop_plant_group_06a` — 753 штуки на
 * одной лужайке особняка в Вайнвуд-Хиллз, `apa_ch2_04_mansion_grass.ymap`),
 * клевер, подложки, папоротники, трава-вещь и цветочные кустики. Это та же
 * «мелочь у земли», что трава, но опись листвы числила их породой «Растения»
 * и красила цветом деревьев: при своём цвете травы они оставались зелёными
 * пятнами. Со своим цветом травы они красятся им (как спрайты процедурной
 * травы, лепестки — свои), их карточки вдали — тоже.
 */
const GROUND_COVER = /^(slod_)?prop_(plant_group_|plant_base_|plant_clover_|plant_fern_|plant_flower_|veg_grass_|ground_cover_)/;
/** Файл наземного растения (`prop_plant_group_06a.ydr`, `prop_plant_fern_01a+hidr.ytd`). */
export const isGroundCoverFile = (name) => GROUND_COVER.test(String(name).toLowerCase());
/** Карточка наземного растения вдали (`slod_prop_plant_group_06b`, `prop_ground_cover_flower_01`). */
export const isGroundCoverCard = (texture) => GROUND_COVER.test(String(texture).toLowerCase());

/*
 * Вес «трава» у пикселя спрайта. Цветочный спрайт — строже: жёлтые и
 * оранжевые лепестки (тон до 70°) и светлые пятна не трогаются, иначе
 * жёлтые соцветия на рыжей траве рыжели бы вместе с ней.
 */
function spriteWeight(h, s, l, flower) {
  const weight = grassWeight(h, s);
  if (!flower || weight <= 0) return weight;
  if (h < 70 || l > 0.78) return 0;
  return h < 85 ? (weight * (h - 70)) / 15 : weight;
}

/**
 * Спрайт процедурной травы в цвет травы: зелень берёт тон и насыщенность
 * цвета, яркость и рисунок — свои (как `recolourGrass`); средняя трава —
 * по видимым пикселям (прозрачные красятся тем же сдвигом, чтобы mip не
 * давали зелёной каймы). `flower` — лепестки не трогать. Возвращает новые
 * пиксели или тот же массив, если менять нечего.
 */
export function recolourPlantSprite(rgba, colour, { flower = false } = {}) {
  if (!colour) return rgba;
  const target = grassTarget(colour);
  const count = rgba.length / 4;
  const weights = new Float32Array(count);
  const reference = grassReference();
  for (let index = 0, at = 0; index < count; index += 1, at += 4) {
    const r = rgba[at] / 255;
    const g = rgba[at + 1] / 255;
    const b = rgba[at + 2] / 255;
    const [h, s, l] = rgbToHsl(r, g, b);
    const weight = spriteWeight(h, s, l, flower);
    weights[index] = weight;
    if (rgba[at + 3] >= 64) reference.add(r, g, b, weight);
  }
  const ref = reference.result();
  if (!ref) return rgba;
  const out = new Uint8ClampedArray(rgba);
  let changed = false;
  for (let index = 0, at = 0; index < count; index += 1, at += 4) {
    const weight = weights[index];
    if (weight <= 0) continue;
    const r = rgba[at] / 255;
    const g = rgba[at + 1] / 255;
    const b = rgba[at + 2] / 255;
    const [nr, ng, nb] = shiftGrass(r, g, b, target, ref);
    out[at] = Math.round((r + (nr - r) * weight) * 255);
    out[at + 1] = Math.round((g + (ng - g) * weight) * 255);
    out[at + 2] = Math.round((b + (nb - b) * weight) * 255);
    changed ||= out[at] !== rgba[at] || out[at + 1] !== rgba[at + 1] || out[at + 2] !== rgba[at + 2];
  }
  return changed ? out : rgba;
}

/* ------------------------------------------------------------------ *
 * Палитры тинта
 * ------------------------------------------------------------------ */

/** Лист палитры тинта модели (`bh1_43_golf_1a_pal`, `bh1_43_golf_1a_lod_pal`). */
export const isTintPalette = (name) => /_pal$/.test(String(name).toLowerCase());

/**
 * Палитра тинта без зелени: цвет записи → серый той же яркости (BT.601),
 * альфа — своя. `all` — вся палитра (плющ и изгороди: палитра красит только
 * листву), иначе — только зелёные записи с мягким краем (земля: та же
 * палитра лежит и на слоях земли и песка, их бурые тона остаются).
 * Возвращает новые пиксели или тот же массив, если зелени нет.
 */
/*
 * Вес «зелень» у записи палитры: тон — как у травы (`grassWeight`), а
 * насыщенность — от едва заметной: запись палитры — множитель, и даже
 * серо-зелёный (82,90,85) тянет крашеную траву в болотный.
 */
function paletteWeight(h, s) {
  if (s < 0.01 || h < 55 || h > 185) return 0;
  const hue = h < 75 ? (h - 55) / 20 : h > 165 ? (185 - h) / 20 : 1;
  return hue * (s < 0.04 ? (s - 0.01) / 0.03 : 1);
}

export function neutralisePalette(rgba, { all = false } = {}) {
  const out = new Uint8ClampedArray(rgba);
  let changed = false;
  for (let at = 0; at < rgba.length; at += 4) {
    const r = rgba[at] / 255;
    const g = rgba[at + 1] / 255;
    const b = rgba[at + 2] / 255;
    const [h, s] = rgbToHsl(r, g, b);
    const weight = all ? 1 : paletteWeight(h, s);
    if (weight <= 0) continue;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    out[at] = Math.round((r + (y - r) * weight) * 255);
    out[at + 1] = Math.round((g + (y - g) * weight) * 255);
    out[at + 2] = Math.round((b + (y - b) * weight) * 255);
    changed ||= out[at] !== rgba[at] || out[at + 1] !== rgba[at + 1] || out[at + 2] !== rgba[at + 2];
  }
  return changed ? out : rgba;
}

/* ------------------------------------------------------------------ *
 * Пачки карт травы, которые не трава
 * ------------------------------------------------------------------ */

const joaat = (text) => {
  const value = String(text).toLowerCase();
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash + value.charCodeAt(index)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  return (hash + (hash << 15)) >>> 0;
};

/*
 * Камни и бревна карт травы (по описи моделей пачек `blades` плана, 11.10.2026):
 * лист серый или бурый, цвет экземпляра — оттенок камня. Цвет травы их не
 * красит — иначе на рыжей траве лежали бы рыжие камни.
 */
export const NON_PLANT_BATCH_MODELS = Object.freeze([
  "proc_stones_01",
  "proc_stones_02",
  "proc_stones_03",
  "proc_stones_04",
  "proc_stones_05",
  "proc_stones_06",
  "prop_log_aa",
  "prop_log_ab",
  "prop_log_ac",
  "prop_log_ad",
  "prop_log_ae",
  "prop_log_af",
]);
const NON_PLANT = new Set(NON_PLANT_BATCH_MODELS.map(joaat));
/** Пачка карты травы — не растение (камни, бревна). */
export const isNonPlantBatch = (archetype) => NON_PLANT.has(archetype >>> 0);
