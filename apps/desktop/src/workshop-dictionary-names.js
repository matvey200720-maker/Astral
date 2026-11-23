/*
 * Имена листов словаря `.ytd` без распаковки картинок (читатель листов, оглавление папки — `folderIndex` в `workshop-textures.js`).
 *
 * Оглавлению нужны только имена: какой файл папки несёт лист с таким именем. Прежний путь разжимал словарь целиком — вместе с графической областью, где лежат все пиксели (у
 * словарей игры это 95–99 % разжатых байтов), и только потом читал названия из системной. Поток ресурса RSC7 — один deflate: системные страницы идут первыми, графические за
 * ними. Названия и описания текстур лежат в системной области, поэтому здесь разжимается только начало потока: префикс сжатых байт, который заведомо покрывает системную
 * область (`zlib` с `Z_SYNC_FLUSH` отдаёт всё, что смог разобрать, без ошибки на обрезанном входе); не хватило — префикс удваивается.
 *
 * Ответ равен прежнему до имени и порядка (проверено проверкой `workshop-dictionary-names.test.js` на словарях набора и на синтетике). Осторожность: быстрый путь отдаёт
 * ответ, только когда число прочитанных текстур равно числу в списке словаря; любое расхождение, ошибка или необычный ресурс (не словарь, не Legacy, поток короче системной
 * области) — прежний путь целиком, с теми же исключениями. Возвращает `{ names, quick }`: имена строчными по порядку словаря и признак быстрого пути.
 */

import zlib from "node:zlib";
import {
  readTextureDictionary,
  YTD_VERSION_LEGACY,
} from "@modovik/rage-drawable";
import { inflateResource } from "@modovik/native-rs";
import {
  openResourceWith,
  readPointerList,
  readResourceHeader,
  resourceFromData,
  RSC7_HEADER_BYTES,
} from "@modovik/ypt/resource-core";

/* Список текстур словаря лежит в корне со смещения 0x30 (`TEXTURE_LIST_AT` в `rage-drawable/texture.js`); при другой раскладке счёт не сойдётся — прежний путь. */
const TEXTURE_LIST_AT = 0x30;
/* Первый префикс сжатого потока: системная область сжимается в разы сильнее картинок, восьмой доли её размера обычно хватает; не меньше этого. */
const FIRST_PREFIX_MIN = 32 * 1024;
const FIRST_PREFIX_SHARE = 8;

const lowered = (refs) => refs.map((ref) => ref.name.toLowerCase());

/** Разжатое начало потока: не меньше `needed` байт или `null`, когда поток обрывается раньше (тогда решает прежний путь). */
function inflateHead(body, needed) {
  let take = Math.min(
    body.length,
    Math.max(FIRST_PREFIX_MIN, Math.ceil(needed / FIRST_PREFIX_SHARE)),
  );
  for (;;) {
    const head = zlib.inflateRawSync(body.subarray(0, take), {
      finishFlush: zlib.constants.Z_SYNC_FLUSH,
    });
    if (head.length >= needed) return head;
    if (take >= body.length) return null;
    take = Math.min(body.length, take * 2);
  }
}

/** Быстрый путь: имена по разжатой системной области или `null`, если путь не годится. */
function quickNames(raw) {
  try {
    const header = readResourceHeader(raw);
    if (header.version !== YTD_VERSION_LEGACY || header.systemSize <= 0)
      return null;
    const head = inflateHead(
      raw.subarray(RSC7_HEADER_BYTES),
      header.systemSize,
    );
    if (!head) return null;
    const resource = resourceFromData(head, header);
    const root = resource.at(resource.root);
    if (root < 0) return null;
    const declared = readPointerList(resource, root + TEXTURE_LIST_AT).count;
    const refs = readTextureDictionary(resource);
    return refs.length === declared ? lowered(refs) : null;
  } catch {
    return null;
  }
}

/** Прежний путь: словарь разжимается целиком. Исключения — те же, что у чтения листов (битый или чужой ресурс). */
function fullNames(raw) {
  return lowered(readTextureDictionary(openResourceWith(raw, inflateResource)));
}

/** Имена листов словаря `.ytd` в порядке словаря, строчными. Бросает то же, что прежнее чтение, если ресурс не словарь Legacy или битый. */
export function dictionaryNames(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const quick = quickNames(raw);
  return quick
    ? { names: quick, quick: true }
    : { names: fullNames(raw), quick: false };
}
