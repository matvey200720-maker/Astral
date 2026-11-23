/*
 * Кэш сборки ассортимента «На что поставить?» между открытиями окна (ТЗ 27.10.2026, замер входа в Desktop ×4: сборка вещей игры, склейка источников и
 * выборка по виду — около 0,13 с главного потока при каждом открытии, хотя вещи не менялись).
 *
 * Всё, что здесь кэшируется, — чистые функции от прочитанного: ответ Desktop (строки вещей игры, файлы серверов), список модов каталога, совет
 * автора. Ключ — сам объект (`WeakMap`): пока окно держит тот же ответ, результат тот же; ответ Desktop прочли заново (другая версия игры, `forgetGameClothing`)
 * — это другой объект, и кэш для него пуст. Ничего не копится сверх жизни ключей. Результаты общие и только для чтения: потребители фильтруют и
 * копируют, но не правят их.
 */

import { assortmentFor, mergeAssortment } from "@modovik/clothing/assortment";
import { gameAssortmentItem, majesticLocalSet } from "@modovik/clothing/game-assortment";

const isObject = (value) => value !== null && (typeof value === "object" || typeof value === "function");

/** Функция от объектов: тот же набор объектов (по тождеству) — тот же результат. Любой не-объект среди аргументов — без кэша. */
export function memoByIdentity(fn) {
  const root = new WeakMap();
  const DONE = Symbol("done");
  return (...args) => {
    if (!args.length || !args.every(isObject)) return fn(...args);
    let node = root;
    for (const arg of args) {
      let next = node.get(arg);
      if (!next) {
        next = new WeakMap();
        node.set(arg, next);
      }
      node = next;
    }
    if (!node.has(DONE)) node.set(DONE, fn(...args));
    return node.get(DONE);
  };
}

/** Ключ-объект → таблица по строковому ключу: для функций с запросом из пола, вида и сервера (запрос каждый раз новый объект). */
function memoBySubject(fn, keyOf) {
  const subjects = new WeakMap();
  return (subject, ...rest) => {
    if (!isObject(subject)) return fn(subject, ...rest);
    let table = subjects.get(subject);
    if (!table) {
      table = new Map();
      subjects.set(subject, table);
    }
    const key = keyOf(...rest);
    if (!table.has(key)) table.set(key, fn(subject, ...rest));
    return table.get(key);
  };
}

/** Склейка источников: те же списки — та же склейка. */
export const mergeAssortmentCached = memoByIdentity(mergeAssortment);

/** Вещи для пола, вида и сервера из склейки: та же склейка и тот же запрос — тот же ответ. */
export const assortmentForCached = memoBySubject(assortmentFor, (query) =>
  JSON.stringify([query?.server ?? null, query?.gender ?? null, query?.component ?? null]),
);

/** Что на Majestic можно заменить файлами игры: те же строки игры — тот же набор. */
export const majesticLocalOf = memoByIdentity(majesticLocalSet);

/** Вещи игры одного пола и вида из строк Desktop (без пустышек): те же строки, пол и вид — тот же список. */
export const gameItemsOf = memoBySubject(
  (rows, gender, component) =>
    rows
      /* Пустышки игры (`blank`) в выборе не показываются: модели у них нет, на снимке и на персонаже их не увидеть. */
      .filter((row) => !row.blank && row.gender === gender && row.component === component)
      .map(gameAssortmentItem)
      .filter(Boolean),
  (gender, component) => `${gender}|${component}`,
);

/** Вещи списка, что есть на любом сервере (без своего): тот же список — тот же отфильтрованный. */
export const withoutServer = memoByIdentity((list) => list.filter((item) => !item.server));

/** Два списка одним: те же списки — тот же сцепленный (вещи мода и его пары другого пола). */
export const concatLists = memoByIdentity((first, second) => [...first, ...second]);

/** Тот же ключ-объект и те же строковые части — тот же результат (совет автора: список «Заменяет», вид, сервер). */
export const memoBySubjectKey = (fn) => memoBySubject(fn, (...rest) => JSON.stringify(rest));
