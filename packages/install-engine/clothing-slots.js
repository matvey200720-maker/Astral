// Слоты вещей одежды: объявленное каталогом «место без коллекции» уточняется
// папками, куда пакет реально пишет файлы.
import { clothingReplaceFolder, clothingReplaceSlot } from "./clothing-replace-manifest-trust.js";

const CLOTHING_DLC = "update/x64/dlcpacks/astral_clothing/dlc.rpf";
const STREAM_ARCHIVES = new Set(["astral_stream_00.rpf", "astral_stream_01.rpf"]);
const GENDERS = new Set(["male", "female"]);
const MAP_MARKERS = new Set(["diff", "norm", "spec"]);
const MODEL_EXTENSIONS = [".ydd", ".ytd"];

const isLetters = (text, min, max) => text.length >= min && text.length <= max && /^[a-z]+$/.test(text);
const isDrawable = (text) => /^[0-9]{3}$/.test(text);
const isTailGroup = (text) => /^[a-z0-9]+$/.test(text);

// Компонент: необязательная приставка p_ и от трёх до шести строчных букв.
function isComponent(text) {
  return isLetters(text.startsWith("p_") ? text.slice(2) : text, 3, 6);
}

const placeKey = (gender, component, number) => `${gender}|${component}|${number}`;

// "clothing-<пол>-<компонент>-<номер>" и ничего другого.
function parseItemSlot(slot) {
  const parts = String(slot).split("-");
  if (parts.length !== 4 || parts[0] !== "clothing") return null;
  const [, gender, component, number] = parts;
  if (!GENDERS.has(gender) || !isComponent(component) || !isDrawable(number)) return null;
  return { gender, component, number };
}

// Имя файла: <компонент>[_diff|_norm|_spec]_<номер>{_<хвост>}.ydd|.ytd
function parseModelFile(fileName) {
  const extension = MODEL_EXTENSIONS.find((suffix) => fileName.endsWith(suffix));
  if (!extension) return null;

  const tokens = fileName.slice(0, -extension.length).split("_");
  const componentTokens = tokens[0] === "p" ? 2 : 1;
  const component = tokens.slice(0, componentTokens).join("_");

  let at = componentTokens;
  if (MAP_MARKERS.has(tokens[at])) at += 1;
  const number = tokens[at];
  const tail = tokens.slice(at + 1);

  if (!isComponent(component) || !isDrawable(number) || !tail.every(isTailGroup)) return null;
  return { component, number };
}

// Запись файла пакета -> { key, slot } или null, если это не место вещи.
function parsePlace(file) {
  if (String(file?.target).toLowerCase() !== CLOTHING_DLC) return null;

  const [archive, folder, fileName, ...extra] = String(file.entry).toLowerCase().split("/");
  if (extra.length > 0 || fileName === undefined || !STREAM_ARCHIVES.has(archive)) return null;

  const character = clothingReplaceFolder(folder);
  const model = parseModelFile(fileName);
  if (!character || !model) return null;

  return {
    key: placeKey(character.gender, model.component, model.number),
    slot: clothingReplaceSlot({
      gender: character.gender,
      folder,
      component: model.component,
      drawable: Number(model.number),
    }),
  };
}

export function clothingItemSlots(slots = [], files = []) {
  const declared = slots.map(parseItemSlot);
  if (declared.every((item) => item === null)) return slots;

  const places = new Map();
  for (const file of files ?? []) {
    const place = parsePlace(file);
    if (!place) continue;
    if (!places.has(place.key)) places.set(place.key, new Set());
    places.get(place.key).add(place.slot);
  }
  if (places.size === 0) return slots;

  const replaced = slots.flatMap((slot, index) => {
    const item = declared[index];
    const found = item && places.get(placeKey(item.gender, item.component, item.number));
    return found ? [...found].sort() : [slot];
  });
  return [...new Set(replaced)];
}
