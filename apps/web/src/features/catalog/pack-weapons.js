import { weaponByModel } from "@modovik/rpf-inspector/weapon-identity";
import { modSizeBytes } from "../../catalog-utils.js";

// Таблица замен на странице ганпака: по строке на ствол пака и одна общая строка на все обвесы.

const NAME_SEPARATOR = " · ";
// Прозвище в конце имени: («ревик») — скобка, левая ёлочка, текст, правая ёлочка, скобка.
const TRAILING_NICKNAME = new RegExp("\\(«[^»]*»\\)\\s*$");
// Русский интерфейс — по началу кода («ru-RU», «ukr» тоже).
const RUSSIAN_CODE = /^(ru|uk)/i;

const speaksRussian = (language) => typeof language === "string" && RUSSIAN_CODE.test(language);

// Обложка нарисована нашим предпросмотром: источник — строка или поле kind.
const kindOfOrigin = (origin) => (typeof origin === "string" ? origin : origin?.kind);
const isRendered = (origin) => kindOfOrigin(origin) === "render";

// Чужой ствол называется по имени мода до « · » и без прозвища в конце.
function foreignName(mod, model) {
  const [head] = String(mod.name || model).split(NAME_SEPARATOR);
  return head.replace(TRAILING_NICKNAME, "").trim();
}

// Игровой ствол называется по таблице (каталожное имя — только не для русского).
function weaponName(mod, model, russian) {
  const known = weaponByModel(model);
  if (!known) return foreignName(mod, model);
  if (russian) return known.name;
  return known.catalog || known.name;
}

// Английское «Heavy Sniper» рядом с «хевик» читалось бы как опечатка.
function slangFor(weapon, russian) {
  if (!russian) return "";
  return weapon.slang?.[0] || "";
}

// Поля, общие для обоих видов строки.
function rowHead(mod, catalog) {
  const head = { id: mod.id, mod };
  head.bytes = modSizeBytes(mod, catalog);
  head.render = isRendered(mod.coverOrigin);
  return head;
}

// Виды строк по порядку проб: «подходит ли» и чем дополняется общая голова строки.
const ROW_KINDS = [
  {
    applies: (weapon) => weapon.model,
    extend: (row, weapon, mod, russian) =>
      Object.assign(row, {
        kind: "weapon",
        model: weapon.model,
        name: weaponName(mod, weapon.model, russian),
        slang: slangFor(weapon, russian),
        look: weapon.look || "",
      }),
  },
  {
    applies: (weapon) => Array.isArray(weapon.attachments),
    extend: (row, weapon) =>
      Object.assign(row, { kind: "attachments", count: weapon.attachments.length, hidden: Boolean(weapon.hidden) }),
  },
];

const isWeaponRow = (row) => row.kind === "weapon";

export function packWeaponRows(members = [], allMods = [], language = "ru") {
  const russian = speaksRussian(language);
  const catalog = allMods ?? [];
  const rows = [];

  for (const mod of members) {
    const weapon = mod?.domain?.weapon;
    if (!weapon) continue;
    const rowKind = ROW_KINDS.find(({ applies }) => applies(weapon));
    if (rowKind) rows.push(rowKind.extend(rowHead(mod, catalog), weapon, mod, russian));
  }

  // Только обвесы — таблицы нет: у пака остаётся лента состава.
  if (!rows.some(isWeaponRow)) return [];
  return rows;
}
