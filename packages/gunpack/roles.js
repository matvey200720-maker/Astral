// Назначение файлов ствола по части имени за именем модели.
import { cleanWeaponModel } from "@modovik/rpf-inspector/weapon-identity";

export const WEAPON_FILE = /\.(ydr|ytd|yft)$/i;

export const ROLE_ORDER = Object.freeze([
  "model",
  "model-hi",
  "texture",
  "texture-hi",
  "magazine",
  "camo",
  "part",
  "part-texture",
]);

export const ROLE_LABELS = Object.freeze({
  model: "Модель",
  "model-hi": "Модель вблизи (_hi)",
  texture: "Текстуры",
  "texture-hi": "Текстуры вблизи (+hi)",
  magazine: "Магазин патронов",
  camo: "Камуфляж",
  part: "Деталь",
  "part-texture": "Текстуры детали",
});

// Первая подошедшая строка решает.
const TAIL_ROLES = [
  { fits: (tail) => tail === "", texture: "texture", other: "model" },
  { fits: (tail) => tail === "_hi" || tail === "+hi", texture: "texture-hi", other: "model-hi" },
  { fits: (tail) => /^_(?:mag|clip|drum)/.test(tail), texture: "magazine", other: "magazine" },
  { fits: (tail) => /^_(?:camo|luxe)/.test(tail), texture: "camo", other: "camo" },
  { fits: () => true, texture: "part-texture", other: "part" },
];

const SHOT_ROLES = new Set(["model", "model-hi", "texture", "texture-hi"]);
const FINISH_TAIL = /^_(?:luxe|camo)[a-z0-9]*$/;
const MODEL_EXTENSION = ".ydr";

export function fileName(value) {
  return String(value || "").split(/[\\/]/).at(-1).toLowerCase();
}

export function fileRole(name, model) {
  const file = fileName(name);
  const found = file.match(WEAPON_FILE);
  if (!found) return null;
  const stem = file.slice(0, found.index);
  // `model` нарочно без приведения: длина берётся у самого значения.
  if (!stem.startsWith(model)) return null;
  const tail = stem.slice(model.length);
  const rule = TAIL_ROLES.find(({ fits }) => fits(tail));
  return found[1] === "ytd" ? rule.texture : rule.other;
}

const nameOfEntry = (entry) => fileName(entry.name || entry.path);

function finishTails(files, model) {
  const tails = [];
  for (const entry of files) {
    if (entry.role !== "camo") continue;
    const name = nameOfEntry(entry);
    if (!name.endsWith(MODEL_EXTENSION) || !name.startsWith(model)) continue;
    const tail = name.slice(model.length, -MODEL_EXTENSION.length);
    if (FINISH_TAIL.test(tail)) tails.push(tail);
  }
  return tails;
}

export function shotFiles(weapon) {
  const files = weapon?.files || [];
  if (files.some((entry) => entry.role === "model")) {
    return files.filter((entry) => SHOT_ROLES.has(entry.role));
  }
  // Основной модели нет: кадр снимается с отделки, первой по алфавиту.
  const model = String(weapon?.model || "").toLowerCase();
  const [tail] = finishTails(files, model).sort();
  if (tail === undefined) return [];
  const stem = model + tail;
  const roleByName = new Map([
    [`${stem}.ydr`, "model"],
    [`${stem}_hi.ydr`, "model-hi"],
    [`${stem}.ytd`, "texture"],
    [`${stem}+hi.ytd`, "texture-hi"],
  ]);
  return files.flatMap((entry) => {
    const role = roleByName.get(nameOfEntry(entry));
    return role ? [{ ...entry, role }] : [];
  });
}

export function modelOfFile(name) {
  return cleanWeaponModel(fileName(name));
}
