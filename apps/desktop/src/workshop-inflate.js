/*
 * Распаковка ресурса листов вне потока читателя (`workshop-textures.js`, `readResource`).
 *
 * Поток читателя игры (`game-read-host.js`) — один, а нативная распаковка (`inflateResource` из `@modovik/native-rs`) синхронная: пока она идёт, остальные из восьми пачек
 * (`READ_SLOTS`) ничего не делают. В профиле настоящей игры (`docs/perf/speed-3d-rust/09-reader-profile.md`) она занимала больше половины времени потока. Здесь распаковка
 * уходит в пул потоков Node (`zlib.inflateRaw` с обратным вызовом идёт в libuv): поток читателя в это время читает архив и разбирает другие словари, а распаковки идут
 * параллельно, не больше `INFLATE_LANES` разом, чтобы не занять весь пул (в нём же файловые вызовы приложения).
 *
 * Ответ равен прежнему до байта: путь берётся только когда поток разжался ровно до заявленного размера ресурса (так выглядит любой целый ресурс); во всех остальных случаях
 * (короче, длиннее, ошибка zlib) работает прежняя синхронная распаковка с теми же исключениями и тем же результатом. Копии разжатых байт нет: Buffer из zlib отдаётся как
 * `Uint8Array` на ту же память (если память чужая или общая с пулом — копия, как у прежнего пути).
 *
 * Выключатель: `ASTRAL_SHEETS_INFLATE_ASYNC=0` (`off`, `false`, `no`) возвращает синхронный путь целиком — на случай, если пул потоков понадобится приложению для другого.
 */

import zlib from "node:zlib";
import { inflateResource } from "@modovik/native-rs";
import {
  readResourceHeader,
  resourceFromData,
  RSC7_HEADER_BYTES,
} from "@modovik/ypt/resource-core";

/* Распаковок разом: у пула потоков Node по умолчанию четыре места, одно остаётся файловым вызовам. */
export const INFLATE_LANES = 3;
/* Размер порции вывода zlib: порция по умолчанию 16 КБ даёт сотни обратных вызовов на словарь (замер: 1 МБ — вдвое быстрее, чем 16 КБ). */
const CHUNK_BYTES = 1024 * 1024;
const SWITCHED_OFF = new Set(["0", "off", "false", "no"]);

/** Включён ли путь вне потока: по умолчанию да. */
export function offThreadInflateEnabled(env = process.env) {
  return !SWITCHED_OFF.has(
    String(env?.ASTRAL_SHEETS_INFLATE_ASYNC ?? "")
      .trim()
      .toLowerCase(),
  );
}

/** Очередь на `lanes` мест: `take()` отдаёт функцию «отдать место». */
function createLanes(lanes) {
  let busy = 0;
  const waiting = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else busy -= 1;
  };
  return {
    stats: () => ({ busy, waiting: waiting.length }),
    async take() {
      if (busy < lanes) busy += 1;
      else await new Promise((resolve) => waiting.push(resolve));
      return release;
    },
  };
}

const shared = createLanes(INFLATE_LANES);

/** Разжатое ровно до `declared` байт или `null` (короче, длиннее, ошибка): тогда решает прежний синхронный путь. */
async function inflateExact(body, declared, lanes) {
  const release = await lanes.take();
  try {
    const out = await new Promise((resolve) => {
      zlib.inflateRaw(
        body,
        {
          finishFlush: zlib.constants.Z_SYNC_FLUSH,
          chunkSize: CHUNK_BYTES,
          maxOutputLength: declared,
        },
        (error, result) => resolve(error ? null : result),
      );
    });
    if (!out || out.length !== declared) return null;
    /* Plain `Uint8Array` на ту же память, если она своя и целая; иначе копия (как прежняя `toFreshBytes`). */
    return out.byteOffset === 0 && out.buffer.byteLength === out.length
      ? new Uint8Array(out.buffer, 0, out.length)
      : new Uint8Array(out);
  } finally {
    release();
  }
}

/**
 * Ресурс RSC7 открыт так же, как `openResourceWith(bytes, inflateResource)`, но распаковка идёт в пуле потоков. Возвращает `{ resource, offloaded }`: `offloaded` — распаковка
 * ушла в пул (а не в прежний синхронный путь). Те же исключения, что у `openResourceWith`: не RSC7, пустой поток, отказ распаковки.
 */
export async function openResourceOffThread(bytes, { lanes = shared } = {}) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  const header = readResourceHeader(raw);
  const declared = header.systemSize + header.graphicsSize;
  const body = raw.subarray(RSC7_HEADER_BYTES);
  let inflated =
    declared > 0 ? await inflateExact(body, declared, lanes) : null;
  const offloaded = inflated !== null;
  inflated ??= inflateResource(body, declared);
  if (!inflated?.length)
    throw new Error("Поток ресурса пуст или не распакован.");
  return {
    resource: Object.assign(resourceFromData(inflated, header), {
      complete: inflated.length >= declared,
    }),
    offloaded,
  };
}

/** Для проверок: места и очередь общей очереди распаковок. */
export const inflateLaneStats = () => shared.stats();
export { createLanes };
