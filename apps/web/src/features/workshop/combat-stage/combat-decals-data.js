/*
 * Раны и кровь в 3D-сцене боя (ТЗ 18.10.2026, задача 4А, декали): чистые функции —
 * разбор файлов игры и всё, что считается по их числам. WebGL здесь нет: рисует
 * декали `combat-decals.js`, а числа проверяет тест.
 *
 * Откуда числа:
 *   • `peddamage.xml` — система повреждений педа. Вид (`BulletSmall`, `BulletLarge`,
 *     `ShotgunSmall`, …) называет запись bloodfx.dat (`damageName`); у вида — листы
 *     раны, подтёка и брызг с сеткой кадров, размеры, интенсивность «мокро» и
 *     «сухо», время высыхания, время до исчезновения;
 *   • `bloodfx.dat` — запись на попадание (кость × класс оружия): вид повреждения
 *     и номера декалей брызг, их размеры, оттенок;
 *   • `decals.dat` — клетки листа брызг у номера декали.
 *
 * Единицы размеров (`WoundMinSize`, `SoakStartSize`, …) в файле не названы: читаем
 * их сантиметрами — подтёк 8–16 против торса в 40 см. Сколько длится подтёк и как
 * играют кадры (`AnimationFrameCount`, `AnimationFPS`: один проход и стоп) —
 * тоже наше чтение. Подпись кадра говорит, что расстановка пятен упрощена.
 */

import { BLOODFX_FIELD, parseBloodFx, recordField, tableRow, weaponClassIndex } from "@modovik/bloodfx";
import { seededUnit } from "./combat-schedule.js";

const CENTIMETRE = 0.01;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (from, to, t) => from + (to - from) * t;

/* --- peddamage.xml --- */

function readSheet(element, tag) {
  const node = element.getElementsByTagName(tag)[0];
  if (!node) return null;
  const number = (name, fallback = 0) => {
    const value = node.getElementsByTagName(name)[0]?.getAttribute("value");
    return value === null || value === undefined ? fallback : Number(value);
  };
  const flag = (name) => node.getElementsByTagName(name)[0]?.getAttribute("value") === "true";
  const offset = node.getElementsByTagName("CenterOffset")[0];
  return {
    texture: node.getElementsByTagName("TextureName")[0]?.textContent?.trim() || "",
    rows: number("TexGridRows", 1) || 1,
    cols: number("TexGridCols", 1) || 1,
    frameMin: number("FrameMin"),
    frameMax: number("FrameMax"),
    frames: number("AnimationFrameCount"),
    fps: number("AnimationFPS"),
    flipU: flag("AllowUFlip"),
    flipV: flag("AllowVFlip"),
    centre: [Number(offset?.getAttribute("x")) || 0, Number(offset?.getAttribute("y")) || 0],
  };
}

function readDamage(item) {
  const number = (tag, fallback = 0) => {
    const value = item.getElementsByTagName(tag)[0]?.getAttribute("value");
    return value === null || value === undefined ? fallback : Number(value);
  };
  return {
    name: item.getElementsByTagName("Name")[0]?.textContent?.trim() || "",
    soak: readSheet(item, "SoakTexture"),
    soakGravity: readSheet(item, "SoakTextureGravity"),
    wound: readSheet(item, "WoundTexture"),
    splatter: readSheet(item, "SplatterTexture"),
    woundSize: [number("WoundMinSize"), number("WoundMaxSize")],
    woundIntensity: { wet: number("WoundIntensityWet", 1), dry: number("WoundIntensityDry", 1), dryingTime: number("WoundDryingTime", 1) },
    splatterSize: [number("SplatterMinSize"), number("SplatterMaxSize")],
    splatterIntensity: { wet: number("SplatterIntensityWet", 1), dry: number("SplatterIntensityDry", 1), dryingTime: number("SplatterDryingTime", 1) },
    soakSize: { start: number("SoakStartSize"), end: number("SoakEndSize"), startGravity: number("SoakStartSizeGravity"), endGravity: number("SoakEndSizeGravity"), scaleTime: number("SoakScaleTime", 1) },
    soakIntensity: { wet: number("SoakIntensityWet", 1), dry: number("SoakIntensityDry", 1), dryingTime: number("SoakDryingTime", 1) },
    fadeStart: number("BloodFadeStartTime", 400),
    fadeTime: number("BloodFadeTime", 10),
  };
}

/**
 * `peddamage.xml` → `{ blood, soak, damages }`: цвета крови и подтёка и виды
 * повреждений по имени (без регистра). Не разобралось — `null`.
 */
export function parsePedDamage(text) {
  if (typeof DOMParser === "undefined" || !text) return null;
  const document = new DOMParser().parseFromString(String(text), "application/xml");
  if (document.getElementsByTagName("parsererror").length) return null;
  const colour = (tag, fallback) => {
    const node = document.getElementsByTagName(tag)[0];
    return node ? ["x", "y", "z"].map((axis) => Number(node.getAttribute(axis)) || 0) : fallback;
  };
  const damages = new Map();
  for (const item of document.getElementsByTagName("Item")) {
    if (item.getAttribute("type") !== "CPedBloodDamageInfo") continue;
    const damage = readDamage(item);
    if (damage.name && damage.wound) damages.set(damage.name.toLowerCase(), damage);
  }
  return { blood: colour("BloodColor", [0.8, 0.05, 0.05]), soak: colour("SoakColor", [0.32, 0.1, 0.1]), damages };
}

/** Вид повреждения по имени записи bloodfx.dat; незнакомый — `BulletSmall`, а без него — первый. */
export function damageByName(pedDamage, name) {
  const all = pedDamage?.damages;
  if (!all?.size) return null;
  return all.get(String(name || "").toLowerCase()) || all.get("bulletsmall") || all.values().next().value;
}

/* --- decals.dat --- */

/**
 * Клетки листа брызг у номеров декалей: `Map<номер, [{ texture, rows, cols, cell }]>`.
 * Строка: номер, три текстуры, `ROW COL IDA IDB`. Клетки считаются с нуля по строкам сверху.
 */
export function parseDecals(text) {
  const decals = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/);
    if (!/^\d{3,5}$/.test(tokens[0] || "") || tokens.length < 8) continue;
    const [id, texture, , , rows, cols, first, last] = tokens;
    const entry = { texture, rows: Number(rows) || 1, cols: Number(cols) || 1, cell: Number(first) };
    if (!Number.isFinite(entry.cell) || Number(first) !== Number(last)) continue;
    if (!decals.has(id)) decals.set(id, []);
    decals.get(id).push(entry);
  }
  return decals;
}

/** Клетка декали `id` по жребию; `null`, если такого номера нет. */
export function decalCell(decals, id, seed) {
  const cells = decals?.get(String(id));
  if (!cells?.length) return null;
  return cells[Math.floor(seededUnit(seed) * cells.length) % cells.length];
}

/* --- bloodfx.dat --- */

const BODY_PART = Object.freeze({ head: "HEAD", body: "SPINE2" });

const numberOr = (text, fallback = 0) => {
  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
};
const nameOrNull = (text) => (text && text !== "-" ? text : null);
const union = (first, second) => [Math.min(first[0], second[0]), Math.max(first[1], second[1])];

function side(document, section, id) {
  const read = (field) => recordField(document, section, id, BLOODFX_FIELD[field]);
  if (read("id") === null) return null;
  const range = (min, max) => [numberOr(read(min)), numberOr(read(max))];
  return {
    id: String(id),
    probability: numberOr(read("probability"), 1),
    woundProbability: numberOr(read("fxProbability"), 1),
    damage: nameOrNull(read("damageName")),
    decals: { splat: nameOrNull(read("splatDecalNormal")), spray: nameOrNull(read("sprayDecalNormal")), mist: nameOrNull(read("mistDecalNormal")) },
    tint: ["tintRed", "tintGreen", "tintBlue"].map((field) => numberOr(read(field))),
    /* Размеры брызг: A и B, «высоко» и «низко» — что именно разделяет высоту, файл не говорит, берётся объединение. */
    sizes: {
      a: union(range("sizeAHighMin", "sizeAHighMax"), range("sizeALowMin", "sizeALowMax")),
      b: union(range("sizeBHighMin", "sizeBHighMax"), range("sizeBLowMin", "sizeBLowMax")),
    },
  };
}

/**
 * Запись bloodfx.dat на попадание: кость зоны × класс оружия → вход и выход.
 * Таблица — «живой, сетевая игра»: на сервере по игроку стреляют в ней.
 *
 * @returns {{ id: string, entry: object|null, exit: object|null }|null}
 */
export function woundRecord(bloodfxText, { zone = "body", weaponClass = "RIFLE_ASSAULT", table = "alive-mp" } = {}) {
  if (!bloodfxText) return null;
  let document;
  try {
    document = parseBloodFx(bloodfxText);
  } catch {
    return null;
  }
  const row = tableRow(document, table, BODY_PART[zone] || BODY_PART.body);
  const index = weaponClassIndex(weaponClass);
  const id = row && Number.isInteger(index) ? row[index] : null;
  if (!id || id === "0") return null;
  return { id, entry: side(document, "entry", id), exit: side(document, "exit", id) };
}

/* --- Числа по данным --- */

/** Размер раны, м: жребий в `[Min, Max]` вида. */
export function woundSize(damage, seed) {
  const [min, max] = damage.woundSize;
  return lerp(min, max, seededUnit(seed + 11)) * CENTIMETRE;
}

/** Размер брызг на коже, м. */
export function splatterOnBodySize(damage, seed) {
  const [min, max] = damage.splatterSize;
  return lerp(min, max, seededUnit(seed + 13)) * CENTIMETRE;
}

/** Подтёк: размер в `age` с — растёт от `Start` к `End` за `SoakScaleTime`. Тянущийся вниз вариант — крупнее. */
export function soakSize(damage, age, { gravity = false } = {}) {
  const { start, end, startGravity, endGravity, scaleTime } = damage.soakSize;
  const progress = clamp(age / Math.max(scaleTime, 1e-3), 0, 1);
  const from = gravity ? startGravity : start;
  const to = gravity ? endGravity : end;
  return lerp(from, to, progress) * CENTIMETRE;
}

/** Яркость «мокро → сухо»: линейно за время высыхания. */
export function dryness(age, { wet, dry, dryingTime }) {
  return lerp(wet, dry, clamp(age / Math.max(dryingTime, 1e-3), 0, 1));
}

/** Доля непрозрачности от исчезновения: единица до `BloodFadeStartTime`, потом спад за `BloodFadeTime`. */
export function fadeFactor(age, damage) {
  return 1 - clamp((age - damage.fadeStart) / Math.max(damage.fadeTime, 1e-3), 0, 1);
}

/** Сколько живёт пятно, с: до начала спада и сам спад. */
export const bloodLife = (damage) => damage.fadeStart + damage.fadeTime;

/**
 * Кадр листа: жребий в `[FrameMin, FrameMax]`; у листа с анимацией (`AnimationFrameCount` кадров,
 * `AnimationFPS`) — стартовый кадр жребием так, чтобы все кадры проигрыша лежали в диапазоне, а потом
 * кадры идут подряд один раз и останавливаются на последнем.
 */
export function sheetFrame(sheet, age, seed) {
  const min = Math.floor(sheet.frameMin);
  const max = Math.floor(sheet.frameMax);
  const frames = Math.max(1, Math.floor(sheet.frames));
  if (sheet.fps > 0 && frames > 1) {
    const span = Math.max(1, max - min + 2 - frames);
    const start = min + Math.floor(seededUnit(seed + 17) * span);
    return start + Math.min(frames - 1, Math.floor(Math.max(age, 0) * sheet.fps));
  }
  return min + Math.floor(seededUnit(seed + 19) * (max - min + 1));
}

/**
 * Где кадр лежит в текстуре: сдвиг и масштаб UV. Клетки считаются по строкам сверху вниз,
 * а UV идёт снизу вверх. `flip` — отражение по `U` и `V` (`AllowUFlip`, `AllowVFlip`).
 */
export function frameUv(frame, { rows, cols }, flip = { u: false, v: false }) {
  const row = Math.floor(frame / cols) % rows;
  const col = frame % cols;
  const repeat = [(flip.u ? -1 : 1) / cols, (flip.v ? -1 : 1) / rows];
  const offset = [(col + (flip.u ? 1 : 0)) / cols, (rows - 1 - row + (flip.v ? 1 : 0)) / rows];
  return { repeat, offset };
}

/** Размер брызг на земле по записи bloodfx: A — брызги, B — направленные и взвесь; м. */
export function groundSize(sizes, kind, seed) {
  const [min, max] = kind === "splat" ? sizes.a : sizes.b;
  return lerp(min, max, seededUnit(seed + 23));
}
