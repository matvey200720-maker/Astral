/*
 * Выстрел ствола в игре: вспышка у дула, её свет, дым из ствола и гильзы.
 *
 * Всё это — поля блока `<Fx>` ствола в `weapons.meta` и правила ядра
 * эффектов, то есть едет в игру (ТЗ 04.10.2026, задача 4: «самое важное,
 * чтобы они применялись в игру»):
 *
 *  • вспышка — клон штатной вспышки ствола (`<FlashFx>`) или другой вспышки
 *    ядра («форма»: звезда, лазер, рельсотрон…) с цветом, числом и скоростью
 *    частиц; размер — `<FlashFxScale>`;
 *  • свет вспышки — `<FlashFxLight*>`: цвет, сила и дальность света, которым
 *    выстрел освещает всё вокруг;
 *  • дым из ствола — клон `<MuzzleSmokeFx>` (`muz_smoking_barrel`) с цветом,
 *    числом и скоростью частиц; накопление — `<MuzzleSmokeFxIncPerShot>`;
 *  • гильзы — `<ShellFx>`: другое правило выброса гильз ядра или без гильз.
 *
 * Числа — множители к штатному: установщик читает, что стоит у ствола в
 * игре, и снимает с него копию, поэтому настройка одинаково ложится на
 * пистолет и на миниган.
 */

import { STUDIO_TRACER_WEAPON_IDS } from "@modovik/tracer-contract";
import { normalizeColour } from "./shapes.js";

/* Клонов за установку у помощника RPF не больше 16 — вместе с попаданиями:
   вспышкам и дыму стволов вместе — половина. */
export const MUZZLE_FLASH_LIMIT = 8;
export const MUZZLE_RANGE = Object.freeze({ min: 0.25, max: 3 });
/* Свойство эмиттера, которое множит «Скорость» (как у попаданий). */
export const MUZZLE_SPEED_PROP = "ptxEmitterRule:m_speedScalarKFP";

/*
 * Формы вспышки — правила ядра `core.ypt`, с которых можно снять копию. Все
 * они есть в ядре живой игры (проверено 04.10.2026 по `core.ypt` игрока);
 * у редукса без донора установка откажет словами до записи в игру.
 */
export const MUZZLE_SHAPES = Object.freeze(
  [
    { id: "", label: "Своя ствола", rule: "" },
    { id: "star", label: "Звезда", rule: "muz_alternate_star" },
    { id: "pistol", label: "Пистолетная", rule: "muz_pistol" },
    { id: "rifle", label: "Автоматная", rule: "muz_assault_rifle" },
    { id: "smg", label: "Пулемётная", rule: "muz_smg" },
    { id: "shotgun", label: "Веер дробовика", rule: "muz_shotgun" },
    { id: "minigun", label: "Миниган", rule: "muz_minigun" },
    { id: "laser", label: "Лазер", rule: "muz_laser" },
    { id: "railgun", label: "Рельсотрон", rule: "muz_railgun" },
    { id: "stungun", label: "Разряд", rule: "muz_stungun" },
  ].map((item) => Object.freeze(item)),
);
const shapeIds = new Set(MUZZLE_SHAPES.map((item) => item.id));
export const findMuzzleShape = (id) =>
  MUZZLE_SHAPES.find((item) => item.id === String(id || "")) || MUZZLE_SHAPES[0];

/* Гильзы — правила выброса ядра; пустое — ствол без гильз. */
export const SHELL_KINDS = Object.freeze(
  [
    { id: "none", label: "Без гильз", rule: "" },
    { id: "pistol", label: "Пистолетные", rule: "eject_pistol" },
    { id: "auto", label: "Автоматные", rule: "eject_auto" },
    { id: "shotgun", label: "Патроны дробовика", rule: "eject_shotgun" },
    { id: "sniper", label: "Снайперские", rule: "eject_sniper" },
    { id: "heavy", label: "Крупный калибр", rule: "eject_sniper_heavy" },
    { id: "minigun", label: "Лента минигана", rule: "eject_minigun" },
  ].map((item) => Object.freeze(item)),
);
const shellIds = new Set(SHELL_KINDS.map((item) => item.id));
export const findShellKind = (id) =>
  SHELL_KINDS.find((item) => item.id === id) || null;

/* Штатный дым ствола, если своего у ствола нет: копия снимается с него. */
export const DEFAULT_SMOKE_DONOR = "muz_smoking_barrel";

const weaponIds = new Set(STUDIO_TRACER_WEAPON_IDS);

export const defaultMuzzleFlash = (weapon) => ({
  weapon,
  colour: "#ffb347",
  count: 1,
  speed: 1,
  shape: "",
  size: 1,
  light: true,
  /* Пусто — свет цвета самой вспышки. */
  lightColour: "",
  lightPower: 1,
  lightRange: 1,
});

export const defaultMuzzleSmoke = (weapon) => ({
  weapon,
  colour: "#b8c0c8",
  count: 1,
  speed: 1,
  build: 1,
});

const FLASH_KEYS = Object.keys(defaultMuzzleFlash(""));
const SMOKE_KEYS = Object.keys(defaultMuzzleSmoke(""));

function factor(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < MUZZLE_RANGE.min ||
    number > MUZZLE_RANGE.max
  )
    throw new Error(
      `${label}: допустимо от ${MUZZLE_RANGE.min} до ${MUZZLE_RANGE.max}.`,
    );
  return Math.round(number * 100) / 100;
}

function colour(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return normalizeColour(value);
}

function weaponOf(item, index, label, seen, noun) {
  if (!item || typeof item !== "object" || Array.isArray(item))
    throw new Error(`${label} ${index + 1}: ожидались настройки.`);
  const weapon = String(item.weapon || "");
  if (!weaponIds.has(weapon))
    throw new Error(`${label} ${index + 1}: неизвестный ствол «${weapon}».`);
  if (seen.has(weapon)) throw new Error(`${weapon}: у ствола ${noun}.`);
  seen.add(weapon);
  return weapon;
}

function onlyKeys(item, keys, label, index) {
  const extra = Object.keys(item).find((key) => !keys.includes(key));
  if (extra) throw new Error(`${label} ${index + 1}: лишнее поле ${extra}.`);
}

function parseFlash(item, index, seen) {
  const weapon = weaponOf(item, index, "Вспышка", seen, "одна вспышка");
  onlyKeys(item, FLASH_KEYS, "Вспышка", index);
  const base = defaultMuzzleFlash(weapon);
  const shape = String(item.shape ?? base.shape);
  if (!shapeIds.has(shape))
    throw new Error(`Вспышка ${index + 1}: неизвестная форма «${shape}».`);
  if (item.light !== undefined && typeof item.light !== "boolean")
    throw new Error(`Вспышка ${index + 1}: свет — да или нет.`);
  const lightColour =
    item.lightColour === undefined ||
    item.lightColour === null ||
    item.lightColour === ""
      ? ""
      : normalizeColour(item.lightColour);
  return {
    weapon,
    colour: colour(item.colour, base.colour),
    count: factor(item.count, base.count, "Количество частиц вспышки"),
    speed: factor(item.speed, base.speed, "Скорость частиц вспышки"),
    shape,
    size: factor(item.size, base.size, "Размер вспышки"),
    light: item.light ?? base.light,
    lightColour,
    lightPower: factor(item.lightPower, base.lightPower, "Сила света вспышки"),
    lightRange: factor(
      item.lightRange,
      base.lightRange,
      "Дальность света вспышки",
    ),
  };
}

function parseSmoke(item, index, seen) {
  const weapon = weaponOf(item, index, "Дым", seen, "один дым");
  onlyKeys(item, SMOKE_KEYS, "Дым", index);
  const base = defaultMuzzleSmoke(weapon);
  return {
    weapon,
    colour: colour(item.colour, base.colour),
    count: factor(item.count, base.count, "Количество частиц дыма"),
    speed: factor(item.speed, base.speed, "Скорость дыма"),
    build: factor(item.build, base.build, "Накопление дыма"),
  };
}

function parseShell(item, index, seen) {
  const weapon = weaponOf(item, index, "Гильзы", seen, "одни гильзы");
  onlyKeys(item, ["weapon", "shell"], "Гильзы", index);
  const shell = String(item.shell || "");
  if (!shellIds.has(shell))
    throw new Error(`Гильзы ${index + 1}: неизвестный вид «${shell}».`);
  return { weapon, shell };
}

/*
 * «Без вспышки и дыма» (задача 6 ТЗ 17.10.2026, из задачи 2: «чтобы можно
 * было отключать когда стреляешь частица от выстрелов»): у ствола пустые
 * `<FlashFx>` и `<MuzzleSmokeFx>` (и их пары от первого лица) и выключенный
 * свет вспышки — тот же файл оружия, тот же журнал, что у вспышек и
 * трассеров. `"all"` — все стволы мастерской одной галкой, иначе — список.
 */
export const MUZZLE_QUIET_ALL = "all";

function parseQuiet(input) {
  if (input === undefined || input === null) return [];
  if (input === MUZZLE_QUIET_ALL) return MUZZLE_QUIET_ALL;
  if (!Array.isArray(input))
    throw new Error("Без вспышки и дыма: ожидался список стволов.");
  const seen = new Set();
  for (const [index, item] of input.entries()) {
    const weapon = String(item || "");
    if (!weaponIds.has(weapon))
      throw new Error(`Без вспышки и дыма ${index + 1}: неизвестный ствол «${weapon}».`);
    seen.add(weapon);
  }
  /* Порядок — по таблице стволов: один набор — один канонический вид. */
  return STUDIO_TRACER_WEAPON_IDS.filter((weapon) => seen.has(weapon));
}

/** Стволы без вспышки и дыма — списком (у «все» — все стволы мастерской). */
export const quietWeapons = (muzzle) =>
  muzzle?.quiet === MUZZLE_QUIET_ALL
    ? [...STUDIO_TRACER_WEAPON_IDS]
    : Array.isArray(muzzle?.quiet)
      ? muzzle.quiet.filter((weapon) => weaponIds.has(weapon))
      : [];

/** Раздел выстрела проекта: `{ flashes, smokes, shells, quiet }`. */
export function parseMuzzle(input) {
  if (!input) return { flashes: [], smokes: [], shells: [], quiet: [] };
  if (typeof input !== "object" || Array.isArray(input))
    throw new Error("Вспышки выстрела: ожидались настройки.");
  const unknown = Object.keys(input).find(
    (key) => !["flashes", "smokes", "shells", "quiet"].includes(key),
  );
  if (unknown)
    throw new Error(`Вспышки выстрела содержат лишнее поле: ${unknown}`);
  const list = (value) => (Array.isArray(value) ? value : []);
  const flashSeen = new Set();
  const smokeSeen = new Set();
  const shellSeen = new Set();
  const flashes = list(input.flashes).map((item, index) =>
    parseFlash(item, index, flashSeen),
  );
  const smokes = list(input.smokes).map((item, index) =>
    parseSmoke(item, index, smokeSeen),
  );
  const shells = list(input.shells).map((item, index) =>
    parseShell(item, index, shellSeen),
  );
  if (flashes.length + smokes.length > MUZZLE_FLASH_LIMIT)
    throw new Error(
      `Своих вспышек и дыма вместе не больше ${MUZZLE_FLASH_LIMIT}.`,
    );
  return { flashes, smokes, shells, quiet: parseQuiet(input.quiet) };
}

/*
 * Канонический вид: у вспышки всегда четыре поля прежнего раздела, новые —
 * только отличные от штатного. Так проект без формы и света остаётся тем же
 * байт в байт, что и до них, — и «стоит ли в игре» не врёт.
 */
function flashCanonical(item) {
  const base = defaultMuzzleFlash(item.weapon);
  const result = {
    weapon: item.weapon,
    colour: item.colour,
    count: item.count,
    speed: item.speed,
  };
  for (const key of [
    "shape",
    "size",
    "light",
    "lightColour",
    "lightPower",
    "lightRange",
  ])
    if (item[key] !== base[key]) result[key] = item[key];
  return result;
}

export function serializeMuzzle(muzzle) {
  const flashes = muzzle.flashes.map(flashCanonical);
  const smokes = muzzle.smokes.map((item) => ({ ...item }));
  const shells = muzzle.shells.map((item) => ({ ...item }));
  const quiet =
    muzzle.quiet === MUZZLE_QUIET_ALL
      ? MUZZLE_QUIET_ALL
      : Array.isArray(muzzle.quiet) && muzzle.quiet.length
        ? [...muzzle.quiet]
        : null;
  if (!flashes.length && !smokes.length && !shells.length && !quiet)
    return null;
  return {
    flashes,
    ...(smokes.length ? { smokes } : {}),
    ...(shells.length ? { shells } : {}),
    ...(quiet ? { quiet } : {}),
  };
}

/** Стволов со своим выстрелом — для счёта и кнопки «Применить». */
export const muzzleWeaponCount = (muzzle) =>
  new Set([
    ...[
      ...(muzzle?.flashes || []),
      ...(muzzle?.smokes || []),
      ...(muzzle?.shells || []),
    ].map((item) => item.weapon),
    ...quietWeapons(muzzle),
  ]).size;

/** Есть ли в разделе выстрела хоть одна правка (вспышка, дым, гильзы, тишина). */
export const muzzleHasEdits = (muzzle) =>
  ["flashes", "smokes", "shells"].some((list) => (muzzle?.[list] || []).length > 0) ||
  quietWeapons(muzzle).length > 0;

/** Ствол без вспышки и дыма в проекте (своей галкой или «все стволы»). */
export const muzzleQuietOf = (project, weapon) =>
  quietWeapons(project?.muzzle).includes(weapon);

/** «Без вспышки и дыма» у всех стволов разом. */
export const muzzleQuietAll = (project) =>
  project?.muzzle?.quiet === MUZZLE_QUIET_ALL;

/** Своя вспышка ствола в проекте — или `null`. */
export const muzzleFlashOf = (project, weapon) =>
  (project?.muzzle?.flashes || []).find((item) => item.weapon === weapon) ||
  null;

/** Свой дым ствола — или `null`. */
export const muzzleSmokeOf = (project, weapon) =>
  (project?.muzzle?.smokes || []).find((item) => item.weapon === weapon) ||
  null;

/** Свои гильзы ствола (`id` вида) — или `null`: штатные. */
export const muzzleShellOf = (project, weapon) =>
  (project?.muzzle?.shells || []).find((item) => item.weapon === weapon)
    ?.shell ?? null;

/*
 * Правка списка раздела: `patch` дописывается к нынешней записи ствола (или
 * к умолчанию), `null` — запись снимается, ствол в этом снова штатный.
 */
export function patchMuzzleList(list, weapon, patch, defaults) {
  const others = list.filter((item) => item.weapon !== weapon);
  if (!patch) return others;
  const current = list.find((item) => item.weapon === weapon) || defaults;
  return [...others, { ...current, ...patch, weapon }];
}
