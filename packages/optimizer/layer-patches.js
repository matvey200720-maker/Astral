/*
 * Правки файлов игры для слоёв оптимизации — по смыслу, на файле игрока.
 *
 * Моды владельца везут эти файлы целиком, и копии старые: `decals.dat` из
 * мода не знает следов бронестекла и бронебойных пуль, `wheelfx.dat` — части
 * поверхностей. Поставить такую копию значит откатить игру на годы назад.
 * Поэтому слой берёт файл из `update.rpf` игрока и меняет в нём ровно то, что
 * меняет мод, — остальное остаётся байт в байт.
 *
 * Каждая правка отказывает, если ей нечего менять: значит, у игрока файл
 * другого устройства, и «поставить как есть» было бы тихим враньём.
 */

import { patchPsoFields, readPsoFields } from "./pso.js";

/* Токены строки таблицы с их местом: замена не трогает табуляцию вокруг. */
function tokensOf(line) {
  const tokens = [];
  const pattern = /\S+/g;
  let match;
  while ((match = pattern.exec(line))) tokens.push({ text: match[0], at: match.index });
  return tokens;
}

function replaceTokens(line, tokens, replacements) {
  let out = "";
  let cursor = 0;
  tokens.forEach((token, index) => {
    const next = Object.hasOwn(replacements, index) ? replacements[index] : token.text;
    out += line.slice(cursor, token.at) + next;
    cursor = token.at + token.text.length;
  });
  return out + line.slice(cursor);
}

const splitLines = (text) => String(text).split(/(\r?\n)/);

/* ------------------------------------------------------------------ *
 * decals.dat — брызги грязи на кузове
 * ------------------------------------------------------------------ */

/*
 * Раздел «MUD SPLATTERS» (id 1020) — брызги грязи из-под колёс на кузове.
 * Мод «Нет грязи на авто» ставит им множитель размера (десятый столбец:
 * ID, три карты, четыре числа раскладки, TIME, MULT) в ноль — пятно нулевого
 * размера не рисуется. Больше мод в файле по смыслу ничего не меняет.
 */
export const MUD_SPLATTER_DECAL_ID = "1020";
const DECAL_SIZE_COLUMN = 9;

export function patchCarDirtDecals(text) {
  const parts = splitLines(text);
  let changed = 0;
  let rows = 0;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const tokens = tokensOf(line);
    if (tokens[0]?.text !== MUD_SPLATTER_DECAL_ID || tokens.length <= DECAL_SIZE_COLUMN) continue;
    rows += 1;
    const size = Number(tokens[DECAL_SIZE_COLUMN].text);
    if (!Number.isFinite(size)) throw new Error("decals.dat: у брызг грязи не число в столбце размера.");
    if (size === 0) continue;
    parts[index] = replaceTokens(line, tokens, { [DECAL_SIZE_COLUMN]: "0.0" });
    changed += 1;
  }
  if (!rows) throw new Error("decals.dat: в файле игры нет брызг грязи (1020) — другая сборка игры.");
  return { text: parts.join(""), rows, changed };
}

/* ------------------------------------------------------------------ *
 * wheelfx.dat — дым и пыль из-под колёс
 * ------------------------------------------------------------------ */

/*
 * Строка материала: имя, скольжение и давление следа (4), три следа шин,
 * цвет следа (3), затем частицы: трение — порог (2) и три эффекта,
 * смещение грунта — порог (2), три эффекта и дальний, прожиг — эволюции (4)
 * и три эффекта; дальше свечение дисков. Мод обнуляет всё до свечения,
 * включая следы шин. Здесь следы остаются: они почти ничего не стоят, а
 * без них асфальт после дрифта выглядит странно. Уходят только частицы.
 */
const WHEEL_PARTICLES = Object.freeze({
  thresholds: [11, 12, 16, 17, 22, 23, 24, 25],
  effects: [13, 14, 15, 18, 19, 20, 21, 26, 27, 28],
});
const WHEEL_ROW_MIN_TOKENS = 29;
const MATERIAL = /^[A-Z][A-Z0-9_]*$/;

export function patchWheelSmoke(text) {
  const parts = splitLines(text);
  let inside = false;
  let rows = 0;
  let changed = 0;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const first = line.trim().split(/\s+/)[0] || "";
    /* Разделы: целая шина и пробитая, сухо и мокро — у каждого свои
       START/END (`VEHFX_INFO_BURST_START`…). */
    if (/^VEHFX_INFO\w*_START$/.test(first)) {
      inside = true;
      continue;
    }
    if (/^VEHFX_INFO\w*_END$/.test(first)) {
      inside = false;
      continue;
    }
    if (!inside || !MATERIAL.test(first)) continue;
    const tokens = tokensOf(line);
    if (tokens.length < WHEEL_ROW_MIN_TOKENS) continue;
    rows += 1;
    const replacements = {};
    for (const column of WHEEL_PARTICLES.thresholds)
      if (Number(tokens[column].text) !== -1) replacements[column] = "-1.0";
    for (const column of WHEEL_PARTICLES.effects)
      if (tokens[column].text !== "-") replacements[column] = "-";
    if (!Object.keys(replacements).length) continue;
    parts[index] = replaceTokens(line, tokens, replacements);
    changed += 1;
  }
  if (!rows) throw new Error("wheelfx.dat: в файле игры нет таблицы материалов — другая сборка игры.");
  return { text: parts.join(""), rows, changed };
}

/* ------------------------------------------------------------------ *
 * explosion.ymt — тряска камеры
 * ------------------------------------------------------------------ */

export const EXPLOSION_TAG_STRUCTURE = "CExplosionTagData";

/**
 * Тряска камеры у всех взрывов файла — в ноль: сила `camShake` и имя
 * тряски `camShakeName`. Урон, радиус и отбрасывание — те же байты.
 */
export function patchExplosionShake(bytes) {
  const before = readPsoFields(bytes, EXPLOSION_TAG_STRUCTURE, ["camShake", "camShakeName"]);
  if (!before.length) throw new Error("explosion.ymt: в файле игры нет описаний взрывов — другая сборка игры.");
  const shaking = before.filter((row) => row.camShake !== 0 || row.camShakeName !== 0).length;
  const { bytes: out, instances } = patchPsoFields(bytes, EXPLOSION_TAG_STRUCTURE, {
    camShake: 0,
    camShakeName: 0,
  });
  return { bytes: out, rows: instances, changed: shaking };
}

/* ------------------------------------------------------------------ *
 * weaponfx.dat — частицы попаданий пуль (ТЗ 17.10.2026, задача 2)
 * ------------------------------------------------------------------ */

/*
 * Раздел `WEAPONFX_INFO`: строка — номер записи, след на поверхности
 * (столбцы 1–19: картинка, размер, жизнь…) и частицы (столбец 20 —
 * `FX_SYS`, правило ядра: `bul_carmetal`, `bul_concrete`, `bul_glass`…, дальше
 * дальность, масштаб и LOD). Таблица `WEAPONFX_TABLE` выбирает запись по
 * материалу и оружию; записи пуль — номера до 500 (стекло 1–99, материалы
 * 100–299, жидкости 300–399) и общая 999. «-» в `FX_SYS` Rockstar сами пишут
 * у записей без частиц (рукопашная по бетону, ракеты), так что игра его
 * знает. Следы (дырки) остаются — их снимает слой «Следы пуль и крови»;
 * рукопашная (500–599), электрошокер (700–799) и взрывы (900+) не трогаются.
 */
const WEAPON_FX_COLUMN = 20;
const WEAPON_ROW_MIN_TOKENS = 24;
const BULLET_ROW = (id) => (id >= 1 && id < 500) || id === 999;
const EFFECT_TOKEN = /^(?:-|[A-Za-z0-9_]+)$/;

export function patchBulletImpacts(text) {
  const parts = splitLines(text);
  let inside = false;
  let rows = 0;
  let changed = 0;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const first = line.trim().split(/\s+/)[0] || "";
    if (first === "WEAPONFX_INFO_START") {
      inside = true;
      continue;
    }
    if (first === "WEAPONFX_INFO_END") {
      inside = false;
      continue;
    }
    if (!inside || !/^\d+$/.test(first)) continue;
    const tokens = tokensOf(line);
    if (tokens.length < WEAPON_ROW_MIN_TOKENS || !BULLET_ROW(Number(first))) continue;
    const effect = tokens[WEAPON_FX_COLUMN].text;
    if (!EFFECT_TOKEN.test(effect)) throw new Error(`weaponfx.dat: у записи ${first} не имя эффекта в столбце частиц.`);
    rows += 1;
    if (effect === "-") continue;
    parts[index] = replaceTokens(line, tokens, { [WEAPON_FX_COLUMN]: "-" });
    changed += 1;
  }
  if (!rows) throw new Error("weaponfx.dat: в файле игры нет записей попаданий пуль — другая сборка игры.");
  return { text: parts.join(""), rows, changed };
}

/* ------------------------------------------------------------------ *
 * materialfx.dat — частицы ударов и скольжения (ТЗ 05.11.2026, задача 7)
 * ------------------------------------------------------------------ */

/*
 * Искры, осколки краски и пластика, крошка бетона и пыль, что летят, когда
 * машина бьётся или трётся о стену, столб, другую машину или землю, игра
 * берёт не из weaponfx.dat, а из materialfx.dat (common.rpf). Таблица
 * `MTLFX_TABLE` по паре материалов выбирает номер записи, записи — в двух
 * разделах: `MTLFX_BANG_INFO` (удар) и `MTLFX_SCRAPE_INFO` (скольжение).
 * Строка записи: номер, пороги скорости и импульса, «не под водой», частицы
 * (седьмой столбец: `bang_carmetal`, `scrape_metal`, `bang_plastic`…), дальше
 * след на поверхности (номер, цвет, размеры). «-» в столбце частиц Rockstar
 * пишут у записей без частиц («VS SOFT STUFF»), так что игра его знает.
 * Следы (царапины) остаются; кровь (`bang_blood_car`, `scrape_blood`) —
 * тоже: это не обломки, и вид ранений слой не трогает.
 */
const MATERIAL_FX_SECTIONS = Object.freeze({
  MTLFX_BANG_INFO_START: "MTLFX_BANG_INFO_END",
  MTLFX_SCRAPE_INFO_START: "MTLFX_SCRAPE_INFO_END",
});
const MATERIAL_FX_COLUMN = 6;
const MATERIAL_ROW_MIN_TOKENS = 17;
const BLOOD_EFFECT = /blood/i;

export function patchCollisionParticles(text) {
  const parts = splitLines(text);
  let closing = null;
  let rows = 0;
  let changed = 0;
  let kept = 0;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const first = line.trim().split(/\s+/)[0] || "";
    if (!closing && Object.hasOwn(MATERIAL_FX_SECTIONS, first)) {
      closing = MATERIAL_FX_SECTIONS[first];
      continue;
    }
    if (closing && first === closing) {
      closing = null;
      continue;
    }
    if (!closing || !/^\d+$/.test(first)) continue;
    const tokens = tokensOf(line);
    if (tokens.length < MATERIAL_ROW_MIN_TOKENS) continue;
    const effect = tokens[MATERIAL_FX_COLUMN].text;
    if (!EFFECT_TOKEN.test(effect)) throw new Error(`materialfx.dat: у записи ${first} не имя эффекта в столбце частиц.`);
    rows += 1;
    if (effect === "-") continue;
    if (BLOOD_EFFECT.test(effect)) {
      kept += 1;
      continue;
    }
    parts[index] = replaceTokens(line, tokens, { [MATERIAL_FX_COLUMN]: "-" });
    changed += 1;
  }
  if (!rows) throw new Error("materialfx.dat: в файле игры нет записей ударов и скольжения — другая сборка игры.");
  return { text: parts.join(""), rows, changed, kept };
}

/* ------------------------------------------------------------------ *
 * entityfx.dat — эмбиент окружения (ТЗ 17.10.2026, задача 2)
 * ------------------------------------------------------------------ */

/*
 * Раздел `ENTITYFX_AMBIENT_PTFX`: метка 2d-эффекта модели карты (труба,
 * вентиляция, куст, урна, кран) → набор и правило частиц (столбец 2), дальше
 * пороги солнца, дождя, ветра и время суток. Игра сама включает эти частицы
 * у моделей вокруг игрока, пока они в кадре. Слой ставит «-» вместо правила
 * у меток чистого антуража — правила с таким именем в ядре нет, и частица не
 * рождается; сама модель, её свет и столкновение остаются.
 *
 * Уходит: живность (мухи, мотыльки, бабочки, тараканы, рыбки), что несёт
 * ветер (листья, бумажки, пыль, сено, пылевые вихри), дым и пар (трубы
 * заводов, вентиляция, выхлоп машин, туман над рекой) и капли (крыши,
 * трубы, краны, поливалки, пузыри).
 * Остаётся: огонь и свечи (они светят), фонтаны, водопады и пороги рек,
 * искры проводов (знак опасности), эффекты миссий и разрушений, строки
 * работ Astral (`ASTRAL_*`, фонари).
 */
export const AMBIENT_ENTITY_GROUPS = Object.freeze({
  creatures: /^AMB_(?:BUTTERFLYS|COCKROACHES|FLY_SWARM|FLY_ZAPPED|INSECT_\w+|MOTHS\w*|TROPICAL_FISH_\w+)$/,
  wind: /^AMB_(?:WIND_\w+|FALLING_\w+|DUST_MOTES|DUST_DEVIL_\w+|RIVER_FLOATING_DEBRIS)$/,
  smoke: /^AMB_(?:SMOKE_\w+|STEAM_\w+|VENT_HAZE_\w+|MACHINE_EXHAUST_\w+|GENERATOR_SMOKE|CIG_SMOKE_LINGER|COLD_AIR_\w+|DRY_ICE_\w+|RIVER_MIST_GEN|SNOW_MIST_\w+|FOUNDRY_(?:DUST|MOLTEN_STEAM|MOLTEN_HAZE|FOGBALL)|OWENSHEPARD_FOGBALL|CLUCK_BATH_STEAM|STONER_\w+)$/,
  drips: /^AMB_(?:WATER_DRIPS_\w+|SEWER_DRIPS_\w+|TAP_DRIP|WATER_ROOF_\w+|DRAIN_WATER|SPRINKLER_(?:CITY_\S+|CROP|GOLF)|BUBBLE_STREAM|TNL_BUBBLES_\w+|JACUZZI)$/,
});

/** Группа эмбиента метки entityfx или `null` — метка остаётся как в игре. */
export function ambientEntityGroup(tag) {
  const name = String(tag || "");
  for (const [group, pattern] of Object.entries(AMBIENT_ENTITY_GROUPS)) if (pattern.test(name)) return group;
  return null;
}

const ENTITY_FX_COLUMN = 2;
const ENTITY_ROW_MIN_TOKENS = 4;

export function patchAmbientEntityFx(text) {
  const parts = splitLines(text);
  let inside = false;
  let section = false;
  let rows = 0;
  let changed = 0;
  const groups = Object.fromEntries(Object.keys(AMBIENT_ENTITY_GROUPS).map((group) => [group, 0]));
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const first = line.trim().split(/\s+/)[0] || "";
    if (first === "ENTITYFX_AMBIENT_PTFX_START") {
      inside = true;
      section = true;
      continue;
    }
    if (first === "ENTITYFX_AMBIENT_PTFX_END") {
      inside = false;
      continue;
    }
    if (!inside || first.startsWith("#")) continue;
    const group = ambientEntityGroup(first);
    if (!group) continue;
    const tokens = tokensOf(line);
    if (tokens.length < ENTITY_ROW_MIN_TOKENS) continue;
    const effect = tokens[ENTITY_FX_COLUMN].text;
    if (!EFFECT_TOKEN.test(effect)) throw new Error(`entityfx.dat: у метки ${first} не имя эффекта.`);
    rows += 1;
    groups[group] += 1;
    if (effect === "-") continue;
    parts[index] = replaceTokens(line, tokens, { [ENTITY_FX_COLUMN]: "-" });
    changed += 1;
  }
  if (!section || !rows) throw new Error("entityfx.dat: в файле игры нет эмбиента окружения — другая сборка игры.");
  return { text: parts.join(""), rows, changed, groups };
}

/* ------------------------------------------------------------------ *
 * vfxregioninfo.ymt — частицы в воздухе по местности (ТЗ 17.10.2026)
 * ------------------------------------------------------------------ */

/*
 * Файл местностей частиц (`CVfxRegionInfo`, 13 местностей: город, загород,
 * пустыня, горы, пляж, снег…). У каждой — частицы, что несёт ветер
 * (`windDebrisPtFxName`: `env_wind_debris`, `…_desert`, `…_city`,
 * `…_woodland`, `…_mountain`, снежинки `env_snow_flakes`), и частицы
 * видеокарты (`CVfxRegionGpuPtFxInfo`: пыльца и светлячки в лесу, мухи у
 * болот, пыль в пустыне и в полях, туман над озёрами и в лесу на рассвете —
 * имена из `weather.xml`: WOODLAND_POLLEN_DROP, WOODLAND_FIREFLY_DROP,
 * WETLAND_FLIES_DROP, DESERT_GROUND, COUNTRYSIDE_GROUND, LAKE_FOG_*,
 * WOODLAND_MIST_GROUND). Слой выключает их флагами `…Enabled` — имена,
 * пороги и время суток остаются, дождь и снег погоды живут в другом файле.
 *
 * В update.rpf этого файла нет — игра читает его из x64a.rpf; слой кладёт
 * копию игрока с выключенными флагами в update.rpf (`x64/data/effects/…`),
 * которым игра перекрывает базовые архивы.
 */
export const REGION_INFO_STRUCTURE = "CVfxRegionInfo";
export const REGION_GPU_STRUCTURE = "CVfxRegionGpuPtFxInfo";

export function patchRegionAmbient(bytes) {
  const regions = readPsoFields(bytes, REGION_INFO_STRUCTURE, ["windDebrisPtFxEnabled"]);
  const gpu = readPsoFields(bytes, REGION_GPU_STRUCTURE, ["gpuPtFxEnabled"]);
  if (!regions.length) throw new Error("vfxregioninfo.ymt: в файле игры нет местностей частиц — другая сборка игры.");
  const changed =
    regions.filter((row) => row.windDebrisPtFxEnabled !== 0).length + gpu.filter((row) => row.gpuPtFxEnabled !== 0).length;
  let out = patchPsoFields(bytes, REGION_INFO_STRUCTURE, { windDebrisPtFxEnabled: 0 }).bytes;
  if (gpu.length) out = patchPsoFields(out, REGION_GPU_STRUCTURE, { gpuPtFxEnabled: 0 }).bytes;
  return { bytes: out, regions: regions.length, gpu: gpu.length, changed };
}

/* ------------------------------------------------------------------ *
 * timecycle_mods_4.xml — алко- и наркоэффекты
 * ------------------------------------------------------------------ */

/* Модификаторы опьянения и наркотиков — те, что опустошает мод владельца. */
export const DRUG_MODIFIERS = Object.freeze([
  "Drunk",
  "drug_flying_base",
  "drug_flying_01",
  "drug_flying_02",
  "DRUG_gas_huffin",
  "Drug_deadman",
  "Drug_deadman_blend",
  "DRUG_2_drive",
  "drug_drive_blend01",
  "drug_drive_blend02",
  "drug_wobbly",
]);

/*
 * Модификаторы экрана при ранении (ТЗ 17.10.2026, вечер, задачи 2 и 4):
 * `timecycle_mods_1.xml`. Разобраны по живому файлу Legacy:
 *   damage — шум, красная виньетка и размытие вдали при попадании по вам;
 *   hitped — вспышка свечения;
 *   dying  — серость, красный сдвиг и размытие на низком здоровье;
 *   pulse  — «сердцебиение»: красная коррекция, виньетка, искажение линзы.
 * Размытие камеры (`cam.*.blur.damage.*`, cameras.ymt) и тряска — другие
 * файлы; слой их не трогает.
 */
export const DAMAGE_SCREEN_MODIFIERS = Object.freeze(["damage", "hitped", "dying", "pulse"]);

/*
 * Слой для объединения таймцикла движком (`timecycle-modifier-v1`): те же
 * имена, пустые. Движок кладёт их поверх файла игрока по имени, остальные
 * сотни модификаторов — и чужие правки, и килл-эффект — остаются.
 */
export function emptyModifiersXml(names) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<timecycle_modifier_data version="1.000000">'];
  for (const name of names) lines.push(`  <modifier name="${name}" numMods="0" userFlags="0" />`);
  lines.push("</timecycle_modifier_data>", "");
  return lines.join("\n");
}

export const drugEffectsTimecycleXml = () => emptyModifiersXml(DRUG_MODIFIERS);
export const damageScreenTimecycleXml = () => emptyModifiersXml(DAMAGE_SCREEN_MODIFIERS);

/* ------------------------------------------------------------------ *
 * fxdecal.ytd — прозрачные следы
 * ------------------------------------------------------------------ */

/*
 * Байты текстуры, которая целиком прозрачна: блок сжатия (или пиксель),
 * повторённый на всю длину, — все уровни сразу. У карт нормалей цвет —
 * «плоская» нормаль, чтобы след без картинки не менял освещение стены.
 */
export function transparentTexturePayload(format, length, { normal = false } = {}) {
  const flatNormal565 = (16 << 11) | (32 << 5) | 31; // 128, 128, 255
  let block;
  switch (String(format || "").toUpperCase()) {
    case "DXT1": {
      /* color0 <= color1 — режим трёх цветов, индекс 3 — прозрачный. У нормали
         индекс 0 (плоская), прозрачность ей не нужна: её гасит карта цвета. */
      block = Buffer.alloc(8);
      if (normal) {
        block.writeUInt16LE(flatNormal565, 0);
        block.writeUInt16LE(flatNormal565, 2);
      } else block.fill(0xff, 4, 8);
      break;
    }
    case "DXT3": {
      block = Buffer.alloc(16);
      if (normal) {
        block.writeUInt16LE(flatNormal565, 8);
        block.writeUInt16LE(flatNormal565, 10);
      }
      break;
    }
    case "DXT5": {
      /* alpha0 = alpha1 = 0, индексы 0 — альфа ноль. */
      block = Buffer.alloc(16);
      if (normal) {
        block.writeUInt16LE(flatNormal565, 8);
        block.writeUInt16LE(flatNormal565, 10);
      }
      break;
    }
    case "ATI1":
      /* Один канал без альфы (маски): ноль. */
      block = Buffer.alloc(8);
      break;
    case "ATI2": {
      /* Два канала — нормаль XY: оба в середине (128), то есть «прямо». */
      block = Buffer.alloc(16);
      if (normal) {
        block[0] = block[1] = 128;
        block[8] = block[9] = 128;
      }
      break;
    }
    case "A8R8G8B8":
      block = Buffer.from(normal ? [255, 128, 128, 0] : [0, 0, 0, 0]);
      break;
    case "A8B8G8R8":
      block = Buffer.from(normal ? [128, 128, 255, 0] : [0, 0, 0, 0]);
      break;
    case "A8":
    case "L8":
      block = Buffer.from([0]);
      break;
    default:
      throw new Error(`fxdecal.ytd: формат ${format} этой правкой не пишется.`);
  }
  if (length % block.length) throw new Error(`fxdecal.ytd: длина ${length} не кратна блоку ${format}.`);
  const out = Buffer.alloc(length);
  for (let at = 0; at < length; at += block.length) block.copy(out, at);
  return out;
}

/** Нормаль ли это: имя кончается на `_n` (так их зовёт игра). */
export const isNormalMap = (name) => /_n$/i.test(String(name || ""));
