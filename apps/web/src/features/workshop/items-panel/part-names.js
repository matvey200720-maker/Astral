import { itemElementWord } from "@modovik/climb-contract/recolor/item-elements";
import { tr } from "../../../locales/ui.js";

const PART_TEMPLATE = "Часть {0}";
const HEX_DIGITS = "0123456789abcdef";

// Ответ держится за самим массивом частей, а не за сценой.
const answers = new WeakMap();

const isHexDigit = (symbol) => HEX_DIGITS.includes(symbol.toLowerCase());

// Цвет листа годится только как «#» и шесть шестнадцатеричных цифр.
function isHexColour(value) {
  const text = `${value}`;
  return text.length === 7 && text.startsWith("#") && [...text.slice(1)].every(isHexDigit);
}

// Острова части лежат тройками: номер сетки, первый треугольник, за последним.
function* islandRanges(list) {
  for (let at = 0; at + 2 < list.length; at += 3) {
    yield [list[at], list[at + 1], list[at + 2]];
  }
}

// Запись материала-листа: того, на который приходится больше всего треугольников части.
function leafOf(asset, part) {
  const tally = new Map();
  for (const [meshId, first, end] of islandRanges(part.own ?? [])) {
    const material = asset?.meshes?.[meshId]?.material;
    if (Number.isInteger(material)) {
      tally.set(material, (tally.get(material) ?? 0) + (end - first));
    }
  }
  // Начальный счёт 0 отсекает неположительные, строгое «больше» оставляет первого при ничьей.
  const [best] = [...tally].reduce((top, entry) => (entry[1] > top[1] ? entry : top), [null, 0]);
  return best === null ? null : (asset.materials?.[best] ?? null);
}

function wordOf(asset, part) {
  const leaf = leafOf(asset, part);
  const { index } = part;
  if (!leaf) return { index, word: "", colour: null };
  const colour = isHexColour(leaf.colour) ? leaf.colour : null;
  return { index, word: itemElementWord(leaf.name, colour ?? ""), colour };
}

export function partWords(asset, parts) {
  if (!(parts?.length > 0)) return [];
  if (answers.has(parts)) return answers.get(parts);
  const words = parts.map((part) => wordOf(asset, part));
  answers.set(parts, words);
  return words;
}

// Позиции записей, у которых одно и то же слово (записи без слова пропущены).
function positionsByWord(heard) {
  const groups = new Map();
  heard.forEach((slot, at) => {
    if (slot === null) return;
    const [word] = slot;
    if (groups.has(word)) groups.get(word).push(at);
    else groups.set(word, [at]);
  });
  return groups;
}

export function partTitles(words) {
  // Слот в рамке: пустой слот (null) - «слова нет», а слово может быть любым значением.
  const heard = words.map((entry) => (entry.word ? [tr(entry.word)] : null));
  const titles = heard.map(() => null);
  for (const [word, spots] of positionsByWord(heard)) {
    spots.forEach((spot, nth) => {
      titles[spot] = spots.length === 1 ? word : `${word} ${nth + 1}`;
    });
  }
  words.forEach((entry, at) => {
    if (heard[at] === null) titles[at] = tr(PART_TEMPLATE).replace("{0}", entry.index + 1);
  });
  return titles;
}
