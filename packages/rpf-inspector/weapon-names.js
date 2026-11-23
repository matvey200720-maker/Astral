/*
 * Имена оружия для человека.
 *
 * В архиве ствол зовётся `w_ar_carbinerifle`, в каталоге — «Карабинная
 * винтовка». Разбор называет стволы по-человечески в описании ганпака и на
 * карточке: модератор должен видеть «карабин, револьвер, тяжёлый снайпер», а
 * не список моделей.
 *
 * Стволы берут имя из таблицы оружия (`weapon-identity.js`) — там модели
 * сверены с данными игры. Обвесы называются по детали: `w_at_scope_medium` —
 * «прицел». Незнакомая модель показывается своим именем без префикса —
 * `bullpuprifleh4` — это честнее, чем выдуманный перевод.
 */

import { identifyWeaponModel } from "./weapon-identity.js";

const plural = (n, one, few, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

/* Деталь обвеса по имени модели: `w_at_ar_supp_02` — глушитель. */
const ATTACHMENT_PARTS = Object.freeze([
  { test: /scope|sight|reflex|holo|optic/, one: "прицел", many: "прицелы" },
  { test: /supp|silenc/, one: "глушитель", many: "глушители" },
  { test: /flsh|flash|light/, one: "фонарь", many: "фонари" },
  { test: /grip/, one: "рукоятка", many: "рукоятки" },
  { test: /barrel/, one: "ствол", many: "стволы" },
  { test: /muzzle|comp/, one: "дульный тормоз", many: "дульные тормоза" },
  { test: /mag|clip|drum/, one: "магазин", many: "магазины" },
]);

/* Метательное и прочее, чего нет в таблице стволов. */
const OTHER_NAMES = Object.freeze({
  w_ex_grenadefrag: "Граната",
  w_ex_grenadesmoke: "Дымовая граната",
  w_ex_molotov: "Коктейль Молотова",
  w_ex_pipebomb: "Самодельная бомба",
  w_ex_pe: "Липкая бомба",
  w_ex_apmine: "Мина",
  w_ex_snowball: "Снежок",
  w_am_jerrycan: "Канистра",
  w_am_fire_exting: "Огнетушитель",
  w_am_flare: "Фальшфейер",
  w_am_baseball: "Мяч",
});

const partOf = (model) =>
  ATTACHMENT_PARTS.find((part) => part.test.test(String(model || ""))) || null;

const capitalize = (text) => text[0].toUpperCase() + text.slice(1);

/** Имя обвеса словами: «Прицел», «Глушитель»; нераспознанная деталь — «Обвес». */
export function attachmentName(model) {
  const part = partOf(model);
  return part ? capitalize(part.one) : "Обвес";
}

/** Состав обвесов одной строкой: «12 деталей: прицелы, глушители, фонари». */
export function attachmentPartsLine(models) {
  const list = Array.isArray(models) ? models : [];
  const kinds = [];
  for (const model of list) {
    const part = partOf(model);
    const label = part ? part.many : "прочее";
    if (!kinds.includes(label)) kinds.push(label);
  }
  const count = list.length;
  const total = `${count} ${plural(count, "деталь", "детали", "деталей")}`;
  return kinds.length ? `${total}: ${kinds.join(", ")}` : total;
}

/** Имя модели по-человечески; незнакомая — своим именем без префикса `w_xx_`. */
export function weaponName(model) {
  const identity = identifyWeaponModel(model);
  if (identity.kind === "weapon") return identity.weapon.name;
  if (identity.kind === "attachment") return attachmentName(identity.model);
  const key = identity.model.replace(/(_mag\d|_sight|_supp|_clip\d)$/, "");
  return (
    OTHER_NAMES[key] || key.replace(/^w_[a-z]{2}_/, "") || String(model || "")
  );
}

/** Известна ли модель как ствол: для незнакомых карточка не выдумывает перевод. */
export const isKnownWeapon = (model) =>
  identifyWeaponModel(model).kind === "weapon";

/**
 * Список имён для описания: известные — словами, остальные — как есть,
 * без повторов, не длиннее `limit`; хвост сворачивается в «и ещё N».
 */
export function weaponNamesLine(models, limit = 6) {
  const names = [];
  for (const model of models) {
    const name = weaponName(model);
    if (!names.includes(name)) names.push(name);
  }
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} и ещё ${names.length - limit}`;
}
