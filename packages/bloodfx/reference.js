// Запасной эталон bloodfx.dat для мастерской без игры: настоящая раскладка клеток, значения по простой шкале.

import { BLOODFX_RECORD_SECTIONS, BLOODFX_TABLES, BLOOD_BODY_PARTS, BLOOD_WEAPON_CLASSES } from "./schema.js";
import { parseBloodFx } from "./document.js";

export const ASTRAL_BLOOD_REFERENCE = Object.freeze({
  placeholder: "astral_reference_impact",
  label: "Эталон Astral",
  note: "Настоящая база читается из выбранной копии GTA V.",
});

const spine = (cell) => ({ SPINE0: cell, SPINE1: cell, SPINE2: cell, SPINE3: cell });

// Таблицы-выборки: обычные замороженные объекты (имена из прототипа ведут себя как найденные записи).
const MELEE_CELLS = Object.freeze({
  HEAD: "081",
  NECK: "081",
  ...spine("080"),
  BUTTOCKS: "080",
  HAND_LEFT: "0",
  HAND_RIGHT: "0",
  FOOT_LEFT: "060",
  FOOT_RIGHT: "060",
  ANIMAL_DEFAULT: "080",
});
const BLADE_CELLS = Object.freeze({
  HEAD: "065",
  NECK: "086",
  SPINE0: "085",
  SPINE1: "085",
  SPINE2: "085",
  SPINE3: "086",
  ANIMAL_DEFAULT: "085",
});
const SNIPER_CELLS = Object.freeze({ HEAD: "202", NECK: "104", THIGH_LEFT: "106", THIGH_RIGHT: "106" });
const HEAVY_CELLS = Object.freeze({
  HEAD: "405",
  NECK: "404",
  ...spine("403"),
  BUTTOCKS: "402",
  CLAVICLE_LEFT: "402",
  CLAVICLE_RIGHT: "402",
  THIGH_LEFT: "406",
  THIGH_RIGHT: "406",
  ANIMAL_DEFAULT: "403",
});
const FIREARM_CELLS = Object.freeze({
  HEAD: "105",
  NECK: "104",
  ...spine("103"),
  BUTTOCKS: "102",
  CLAVICLE_LEFT: "102",
  CLAVICLE_RIGHT: "102",
  THIGH_LEFT: "106",
  THIGH_RIGHT: "106",
  ANIMAL_DEFAULT: "103",
});

const always = (cell) => () => cell;
const picker = (cells, fallback) => (bone) => cells[bone] ?? fallback;

const meleeCell = picker(MELEE_CELLS, "070");
const heavyCell = picker(HEAVY_CELLS, "401");
const firearmCell = picker(FIREARM_CELLS, "101");

// Правила клетки по классу; всё, чего здесь нет, ведёт себя как огнестрел.
const CLASS_RULES = Object.freeze({
  PUNCH_KICK: (bone) => (["HEAD", "NECK", "SPINE3"].includes(bone) ? "062" : "0"),
  MELEE_WOOD: meleeCell,
  MELEE_METAL: meleeCell,
  MELEE_SHARP: (bone) => BLADE_CELLS[bone] || "075",
  MELEE_GENERIC: meleeCell,
  RUBBER: always("295"),
  SHOTGUN: always("108"),
  MOLOTOV: always("0"),
  FIRE: always("0"),
  LASER: always("0"),
  STUNGUN: always("301"),
  CLOWN: always("900"),
  ALIEN: always("950"),
  SKELETON: always("965"),
  RIFLE_SNIPER: picker(SNIPER_CELLS, "201"),
  HEAVY_MG: heavyCell,
  VEHICLE_MG: heavyCell,
});

export const referenceRoutingFor = (bodyPart, weaponClass) => {
  const bone = String(bodyPart);
  const rule = CLASS_RULES[String(weaponClass)] ?? firearmCell;
  return rule(bone);
};

// Номера записей по возрастанию; в обеих секциях (вход и выход) они одни и те же.
const RECORD_IDS = [
  "060 062 065 070 075 080 081 085 086",
  "101 102 103 104 105 106 108",
  "201 202 295 301",
  "401 402 403 404 405 406",
  "900 950 965",
].flatMap((group) => group.split(" "));

const recordValues = (id) => {
  const weight = Math.min(1, (Number(id) % 100) / 10);
  const small = (weight * 0.45 + 0.35).toFixed(2);
  const large = (weight * 0.6 + 0.5).toFixed(2);
  const { placeholder } = ASTRAL_BLOOD_REFERENCE;
  return [
    ...[id, "1.0", "1010", "1010", "1015", "1015", "0", "0", "50", "0", "0"],
    ...["0.2", "0.5", "20.0", "10.0", "2", "0", "0.25", "0.6", "0.01"],
    ...[small, large, small, large, small, large, small, large],
    ...["-1.0", "-1.0", "0.3", "0.05", "0.8", "0.8"],
    ...[placeholder, placeholder, placeholder, placeholder],
    ...[weight.toFixed(1), "1.0", "AstralImpact", "AstralArmour", "AstralArmour"],
  ];
};

const columns = (cells, width) => cells.map((cell) => cell.padEnd(width)).join("");

const boneLine = (bone) =>
  (bone.padEnd(22) + columns(BLOOD_WEAPON_CLASSES.map((cls) => referenceRoutingFor(bone, cls)), 18)).trimEnd();

const ladderLine = `# ${"BONE".padEnd(20)}${columns(BLOOD_WEAPON_CLASSES, 18)}`;

const block = (name, body) => [`${name}_START`, "", ...body, "", `${name}_END`, ""];

const buildText = () => {
  const { placeholder, note } = ASTRAL_BLOOD_REFERENCE;
  const header = [
    "10.00",
    "",
    "# Эталон Astral. Не является файлом Rockstar: значения посчитаны",
    `# приложением, имя правила «${placeholder}» — заглушка вместо неизвестного`,
    `# ванильного имени. ${note}`,
    "",
  ];
  const tableBody = [ladderLine, ...BLOOD_BODY_PARTS.map((bone) => boneLine(bone))];
  const recordBody = RECORD_IDS.map((id) => columns(recordValues(id), 24).trimEnd());
  const sections = [
    ...BLOODFX_TABLES.flatMap(({ section }) => block(section, tableBody)),
    ...BLOODFX_RECORD_SECTIONS.flatMap(({ section }) => block(section, recordBody)),
  ];
  return `${[...header, ...sections].join("\r\n")}\r\n`;
};

let referenceText;

export const referenceBloodFxDocument = () => parseBloodFx((referenceText ??= buildText()));
