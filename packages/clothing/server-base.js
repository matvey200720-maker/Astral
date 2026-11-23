/*
 * База вещей серверов — чтение кусков (задача 9 ТЗ 10.10.2026, вечер).
 *
 * Что в базе и откуда — `server-base-format.js` и шапка
 * `server-base/index.js`. Здесь — как её брать: кусок «сервер × пол × вид»
 * грузится динамическим импортом (Vite кладёт каждый в свой файл), один раз
 * за запуск, и только когда выбор вещи этого вида открыт. Вещь «Верх»
 * мужского персонажа — это три куска по 40–60 КБ (GTA5RP, Majestic, RMRP),
 * а не 13 тысяч вещей разом.
 */

import {
  BASE_CHUNKS,
  BASE_COUNTS,
  BASE_SITE_MAP,
  BASE_SOURCE,
  BASE_VANILLA,
  BASE_VANILLA_COUNTS,
} from "./server-base/index.js";
import {
  BASE_SERVERS,
  baseKey,
  decodeBaseChunk,
  decodeBaseVanilla,
} from "./server-base-format.js";

export {
  BASE_COLUMNS,
  BASE_FLAGS,
  BASE_SCHEMA,
  BASE_SERVERS,
  SITE_CATEGORY_COMPONENTS,
  WIKI_TYPE_COMPONENTS,
  baseKey,
  decodeBaseChunk,
  decodeBaseVanilla,
} from "./server-base-format.js";
export { BASE_COUNTS, BASE_SITE_MAP, BASE_SOURCE, BASE_VANILLA_COUNTS };

const EMPTY = Object.freeze([]);
const chunks = new Map();
const vanilla = new Map();

/** Сколько вещей у сервера этого пола и вида — без загрузки куска. */
export const baseCount = (server, gender, component) =>
  BASE_COUNTS[baseKey(server, gender, component)] || 0;

/* Кусок один раз; не загрузился — следующий вызов попробует снова. */
function once(cache, key, load, decode) {
  if (!load) return Promise.resolve(EMPTY);
  if (!cache.has(key))
    cache.set(
      key,
      load().then(
        (module) => Object.freeze(decode(module.default)),
        (error) => {
          cache.delete(key);
          throw error;
        },
      ),
    );
  return cache.get(key);
}

/** Вещи одного сервера, пола и вида — вещи ассортимента (источник `external`). */
export function loadServerBase({ server, gender, component }) {
  const key = baseKey(server, gender, component);
  return once(chunks, key, BASE_CHUNKS[key], decodeBaseChunk);
}

/** Вещи всех серверов базы одного пола и вида: `{ gta5rp: [...], … }`. */
export async function loadBaseForWear({ gender, component }) {
  const lists = await Promise.all(
    BASE_SERVERS.map((server) => loadServerBase({ server, gender, component })),
  );
  return Object.fromEntries(BASE_SERVERS.map((server, at) => [server, lists[at]]));
}

/** Вещи GTA Online под именами GTA5RP (вики без файла на сервере), один пол. */
export function loadBaseVanilla(gender) {
  return once(vanilla, gender, BASE_VANILLA[gender], decodeBaseVanilla);
}

/** Забыть загруженное (тесты). */
export function forgetServerBase() {
  chunks.clear();
  vanilla.clear();
}
