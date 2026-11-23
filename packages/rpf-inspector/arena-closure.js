/*
 * Ссылки арены замкнуты? (26.10.2026, арены автора «один в один»)
 *
 * Тип интерьера арены (`v_int_62.ytyp`) называет модели, из которых зал собирается. Автор может поставить свою (`hatemod`, `arena_tree`) —
 * тогда файл модели обязан лежать в наборе. Blink x Skye: звезда `hatemod` стоит сущностью в `v_int_62.ytyp` контейнера `hate_arena.rpf`,
 * а сама модель — в `animhate.rpf`; арена без второго контейнера ставилась без звезды (штатную тип автора убрал) и с ссылкой на модель,
 * которой нет. Игра на такую ссылку отвечает пустотой или подвисанием — «ничего не рвётся» значит «ни одной ссылки в пустоту».
 *
 * Имя модели в типе хранится хэшем (joaat имени); модель считается найденной, если её хэш — хэш файла набора (основа имени) или штатного
 * файла арены игры (`ARENA_STOCK_NAMES`, 237 имён). Модуль без IO и без хоста: хэши архетипов читает вызывающий (`inspect-interior-ytyp`).
 */

import { ARENA_STOCK_NAMES } from "./arena-stock-names.js";
import { stemOf } from "./place-fingerprints.js";
import { joaat } from "./place-split.js";

/** Файлы, имя которых — имя модели (`<имя>.ydr|yft|ydd`). */
const MODEL = /\.(ydr|yft|ydd)$/i;

/**
 * Хэши моделей типа, которых нет ни в наборе, ни среди штатных файлов арены.
 *
 * @param {{ assetHashes?: Array<string|number>, names?: string[], stock?: Iterable<string> }} input
 *   `assetHashes` — `assetHash` базовых архетипов типа (число или `0x…`), `names` — имена файлов набора, `stock` — штатные имена игры
 * @returns {string[]} недостающие хэши как `0x…`, без повторов, по возрастанию
 */
export function danglingArchetypes({ assetHashes = [], names = [], stock = ARENA_STOCK_NAMES } = {}) {
  const known = new Set();
  for (const name of [...stock, ...names.filter((item) => MODEL.test(item))]) known.add(joaat(stemOf(name)));
  const missing = new Set();
  for (const raw of assetHashes) {
    const hash = (typeof raw === "string" ? Number.parseInt(raw, raw.startsWith("0x") ? 16 : 10) : Number(raw)) >>> 0;
    if (!known.has(hash)) missing.add(hash);
  }
  return [...missing].sort((left, right) => left - right).map((hash) => `0x${hash.toString(16).padStart(8, "0")}`);
}

/** Строка замечания заявки: сколько ссылок типа ведут в пустоту. */
export function danglingProblem(missing, title = "Арена") {
  if (!missing.length) return null;
  return {
    code: "arena-dangling-models",
    message: `${title}: тип интерьера арены ссылается на ${missing.length} моделей, которых нет ни в наборе, ни среди штатных файлов арены (${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}) — не хватает контейнера автора или файла. Если контейнеров автора взято все, ссылка в пустоту и в его игре: зал будет без этой модели, как у автора.`,
    severity: "warn",
  };
}
