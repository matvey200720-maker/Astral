/*
 * Число подпакетов в `setup2.xml` штатного пакета (проба С, 21.11.2026): игра ищет рядом с `dlc.rpf` файлы `dlc1.rpf`…`dlc<N>.rpf` и монтирует их в устройство пакета, N — значение `<subPackCount value="N" />`.
 * Чистые функции: XML приходит строкой, уходит строкой; меняется только число в значении, остальной текст байт в байт. Модуль без импортов (его читает главный процесс).
 */

const COUNT_TAG = /(<subPackCount\b[^>]*?\bvalue\s*=\s*")(\d+)(")/g;

/** Число подпакетов из `setup2.xml` (0, если тега нет); два тега — отказ. */
export function subPackCountOf(setupXml) {
  const found = [...String(setupXml ?? "").matchAll(COUNT_TAG)];
  if (found.length > 1) throw new Error("В setup2.xml больше одного subPackCount.");
  return found.length ? Number(found[0][2]) : 0;
}

/** Есть ли в `setup2.xml` тег `subPackCount` (без него число нечем выставить: тег целиком не вставляется). */
export const hasSubPackCount = (setupXml) => /<subPackCount\b/.test(String(setupXml ?? ""));

/** Выставляет `subPackCount` в `count` (целое, не меньше нуля): `{ xml, before, after }`. Нет тега — отказ словами. */
export function setSubPackCount(setupXml, count) {
  const text = String(setupXml ?? "");
  if (!Number.isInteger(count) || count < 0) throw new Error(`Число подпакетов — целое, не меньше нуля: ${count}`);
  if (!hasSubPackCount(text)) throw new Error("В setup2.xml нет subPackCount.");
  const before = subPackCountOf(text);
  return { xml: text.replace(COUNT_TAG, `$1${count}$3`), before, after: count };
}

/** Поднимает `subPackCount` на `by` (по умолчанию на один): `{ xml, before, after }`. */
export function raiseSubPackCount(setupXml, { by = 1 } = {}) {
  if (!Number.isInteger(by) || by < 1) throw new Error(`Прибавка подпакетов — целое от 1: ${by}`);
  return setSubPackCount(setupXml, subPackCountOf(setupXml) + by);
}
