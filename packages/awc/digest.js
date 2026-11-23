// Отпечатки дорожек банка AWC для сравнения «автор против штатного»: только байты звука, без нативного помощника.
// Чистый Node (`node:crypto`), поэтому отдельно от `index.js`, который читает и окно.
//
// Что входит в отпечаток дорожки. Формат (`format`: число отсчётов, частота, запас, кодек) и данные (`data`) — всё, что слышно. Пики
// (`peak`), метки (`markers`) и таблицы поиска у разных редакторов получаются по-разному: автор, пересобравший банк, теряет метки у
// нетронутых дорожек, и сравнение с ними вернуло бы «изменено» там, где звук тот же. Поэтому в отпечаток они не входят.
// Тот же отпечаток считает `scripts/build-stock-awc-hashes.mjs` по расшифрованному штатному банку, и таблица в репозитории сравнивается
// с банком автора на любой машине (склад на Linux, ПК на Windows) побайтно, одним и тем же кодом.

import { createHash } from "node:crypto";
import { AWC_CHUNK, readAwc } from "./index.js";

const AUDIBLE = Object.freeze([AWC_CHUNK.format, AWC_CHUNK.data]);

const bytesOf = (input) => {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
};

function chunkHead(chunk) {
  const head = new Uint8Array(5);
  head[0] = chunk.type;
  new DataView(head.buffer).setUint32(1, chunk.size, true);
  return head;
}

/**
 * Отпечатки дорожек несжатого банка: `Map(идентификатор дорожки → { sha256, samples, sampleRate, codec, dataBytes })`.
 * Банк, который игра шифрует (штатный до расшифровки), отпечатков не даёт — об этом `AWC_ENCRYPTED`.
 */
export function awcStreamDigests(input) {
  const bytes = bytesOf(input);
  const info = readAwc(bytes);
  if (info.encrypted) {
    throw Object.assign(
      new Error(
        "Банк зашифрован — отпечатки считаются по расшифрованному банку.",
      ),
      { code: "AWC_ENCRYPTED" },
    );
  }
  const digests = new Map();
  for (const stream of info.streams) {
    const hash = createHash("sha256");
    let dataBytes = 0;
    for (const type of AUDIBLE) {
      for (const chunk of stream.chunks.filter((item) => item.type === type)) {
        hash.update(chunkHead(chunk));
        hash.update(bytes.subarray(chunk.offset, chunk.offset + chunk.size));
        if (type === AWC_CHUNK.data) dataBytes += chunk.size;
      }
    }
    const format = stream.format ?? {};
    digests.set(stream.id, {
      sha256: hash.digest("hex"),
      samples: format.samples ?? 0,
      sampleRate: format.sampleRate ?? 0,
      codec: format.codec ?? -1,
      dataBytes,
    });
  }
  return digests;
}
