// Штатная модель для перекраски: место находится по базе одежды, байты читаются из игры пользователя.

import { flatModelReason } from "./flat-model.js";
import { clothingDrawable } from "./model.js";

const MODEL_TAIL = ".ydd";
const ARCHIVE_TAIL = ".rpf";
const NUMBER_DIGITS = 3;

const isLetter = (char) => (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
const isDigit = (char) => char >= "0" && char <= "9";
const allOf = (text, test) => [...text].every(test);

// Хвост после номера: ничего, буква варианта, номер копии или буква и номер копии.
const TAIL_SHAPES = [
  [],
  [(word) => word.length === 1 && isLetter(word)],
  [(word) => word.length > 0 && allOf(word, isDigit)],
  [(word) => word.length === 1 && isLetter(word), (word) => word.length > 0 && allOf(word, isDigit)],
];

// Имя «<компонент из букв и подчёркиваний>_<три цифры>[_буква][_копия].ydd» по словам через «_».
function modelPlaceOfName(name) {
  if (!name.toLowerCase().endsWith(MODEL_TAIL)) return null;
  const words = name.slice(0, -MODEL_TAIL.length).split("_");
  // В компоненте цифр нет, поэтому номер — первое слово с цифрой.
  const numberAt = words.findIndex((word) => [...word].some(isDigit));
  if (numberAt < 1) return null;

  const component = words.slice(0, numberAt).join("_");
  const number = words[numberAt];
  const tail = words.slice(numberAt + 1);
  const goodComponent = component.length > 0 && allOf(component, (char) => char === "_" || isLetter(char));
  const goodNumber = number.length === NUMBER_DIGITS && allOf(number, isDigit);
  const goodTail = TAIL_SHAPES.some(
    (shape) => shape.length === tail.length && shape.every((fits, index) => fits(tail[index])),
  );
  return goodComponent && goodNumber && goodTail ? { component, number } : null;
}

function placeKey(folder, component, number) {
  return `${folder.toLowerCase()}|${component.toLowerCase()}|${number}`;
}

export function gameAddress(path) {
  if (!path) return null;
  const segments = String(path).split("/");
  const archiveAt = segments.findIndex((segment) => segment.toLowerCase().endsWith(ARCHIVE_TAIL));
  if (archiveAt < 0) return null;
  return `${segments.slice(0, archiveAt + 1).join("/")}:${segments.slice(archiveAt + 1).join("/")}`;
}

export function stockModelIndex(files = []) {
  return [...files].reduce((index, file) => {
    const place = modelPlaceOfName(String(file.name || ""));
    const folder = String(file.path || "").split("/").at(-2);
    if (place && folder) {
      const key = placeKey(folder, place.component, place.number);
      if (!index.has(key)) index.set(key, file.path);
    }
    return index;
  }, new Map());
}

// Ключ места вещи; null — вещь неполная, искать нечего.
function placeKeyOfItem(item) {
  const folder = String(item?.folder || "");
  const component = item?.component;
  const drawable = item?.drawable;
  if (!folder || !component || drawable === null || drawable === undefined) return null;
  return placeKey(folder, String(component), String(drawable).padStart(NUMBER_DIGITS, "0"));
}

// Разбор без исключений: модель без сеток — то же, что её отсутствие. Заглушка вместо вещи (два треугольника у `hand_001_u` Ограбления казино) — тоже не модель: на плоскости обложка
// выходит листом (06.11.2026), а рисовать вещь тут не на чем.
function drawableOrNull(bytes, inflateRaw, parse) {
  try {
    const drawable = parse(bytes, { inflateRaw });
    return drawable?.meshes?.length && !flatModelReason(drawable) ? drawable : null;
  } catch {
    return null;
  }
}

// Прочитать и разобрать или null. Отказ обещания read — null;
// брошенное сразу и ответ не обещанием отклоняют чтение.
async function readDrawable(game, address, inflateRaw, parse) {
  if (address === null) return null;
  const bytes = await game.read(address).catch(() => null);
  return bytes ? drawableOrNull(bytes, inflateRaw, parse) : null;
}

// Одно обещание на место: повторные и одновременные запросы получают тот же объект.
class StockModelShelf {
  #places;
  #game;
  #inflateRaw;
  #parse;
  #pending = new Map();

  constructor(files, game, inflateRaw, parse) {
    this.#places = stockModelIndex(files);
    this.#game = game;
    this.#inflateRaw = inflateRaw;
    this.#parse = parse;
  }

  modelFor(item) {
    let key;
    try {
      key = placeKeyOfItem(item);
    } catch (error) {
      return Promise.reject(error);
    }
    if (key === null) return Promise.resolve(null);
    if (!this.#pending.has(key)) {
      const address = gameAddress(this.#places.get(key));
      this.#pending.set(key, readDrawable(this.#game, address, this.#inflateRaw, this.#parse));
    }
    return this.#pending.get(key);
  }
}

// `parse` — разбор байт в модель; по умолчанию настоящий, подмена нужна тестам.
export function createStockModels({ files, game, inflateRaw, parse = clothingDrawable }) {
  const shelf = new StockModelShelf(files, game, inflateRaw, parse);
  return (item) => shelf.modelFor(item);
}
