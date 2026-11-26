/*
 * Зашифрованный банк в паке звуков: штатный банк игры или изменённый автором и снова зашифрованный (25.11.2026).
 *
 * Игра хранит звуковые банки зашифрованными, и некоторые редакторы после правки шифруют банк тем же ключом. До 25.11 разбор считал любой
 * зашифрованный банк нетронутым: пак из одиннадцати вариантов (в каждом по 17 изменённых банков) выходил пустым, а другой пак — без
 * одного ствола, и в описании стояло «банки, которые автор не менял». Здесь банк расшифровывается в памяти (`@modovik/awc/game-crypto`) и
 * сравнивается по дорожкам с таблицами отпечатков штатного звука. Одних байтов мало: у части паков зашифрованный банк байтами не равен
 * игровому, а звук в нём штатный.
 *
 * Таблицы две: `stock-awc-hashes.json` (RESIDENT.rpf, ею же пользуется расчёт слотов) и `stock-player-awc-hashes.json` (банки стволов
 * WEAPONS_PLAYER.rpf, нужна только здесь, расчёт слотов её не читает). Обе снимает `scripts/build-stock-awc-hashes.mjs` с чистой игры.
 */
import { readFileSync } from "node:fs";
import { awcStreamDigests } from "@modovik/awc/digest";
import { decryptAwcBank } from "@modovik/awc/game-crypto";
import { stockBankOf, stockTable } from "./stock-awc.js";

const PLAYER_TABLE_FILE = new URL(
  "./stock-player-awc-hashes.json",
  import.meta.url,
);
let playerLoaded = null;

export function stockPlayerTable() {
  if (playerLoaded === null)
    playerLoaded = JSON.parse(readFileSync(PLAYER_TABLE_FILE, "utf8"));
  return playerLoaded;
}

const unknown = (reason) => ({ state: "unknown", reason });

/* Заголовок AWC: признаки стоят в 16-битном слове по смещению 6; 2 — «данные потоков зашифрованы», 8 — то же у многоканального. */
const FLAGS_AT = 6;
const STREAM_SEAL_FLAGS = 0x0002 | 0x0008;

/*
 * У банка, зашифрованного целиком, эти два признака не означают второго слоя шифрования: после общей расшифровки данные потоков
 * открыты (`native/CodeWalker.Core/GameFiles/FileTypes/AwcFile.cs`: поток расшифровывается отдельно только когда банк НЕ был
 * зашифрован целиком). Признаки есть у банков самой игры. Оставить их — и сборка слоя откажется от банка («данные потоков
 * зашифрованы»), а с ним упадёт разбор всего пака.
 */
function dropStreamSealFlags(clear) {
  const view = new DataView(clear.buffer, clear.byteOffset, clear.byteLength);
  view.setUint16(
    FLAGS_AT,
    view.getUint16(FLAGS_AT, true) & ~STREAM_SEAL_FLAGS,
    true,
  );
  return clear;
}

/* Расшифрованный банк и отпечатки его дорожек; null — ключ или файл не те (после расшифровки это не банк). */
function openSealed(bytes, key) {
  try {
    const clear = decryptAwcBank(bytes, key);
    const digests = awcStreamDigests(clear);
    return digests.size ? { clear: dropStreamSealFlags(clear), digests } : null;
  } catch {
    return null;
  }
}

const sameSound = (digests, stock) =>
  digests.size === stock.streams.size &&
  [...digests].every(
    ([id, one]) => stock.streams.get(id)?.sha256 === one.sha256,
  );

/**
 * Тот же открыватель, но ключ читается только на первом зашифрованном банке и один раз за разбор. `load()` отдаёт открыватель
 * или `null`, когда ключа получить негде, — тогда ответ `{ state: "no-opener" }`, и банк считается нетронутым, как без открывателя.
 */
export function lazySealedBankOpener(load) {
  let loading = null;
  return async (bank) => {
    loading ||= Promise.resolve(load());
    const open = await loading;
    return open ? open(bank) : { state: "no-opener" };
  };
}

/**
 * Открыватель зашифрованных банков: `({ archive, bank, bytes }) → { state }`.
 * `stock` — звук штатный; `changed` — звук изменён, `bytes` — расшифрованный банк; `unknown` — сверить не с чем или не расшифровался.
 */
export function createSealedBankOpener({
  key,
  tables = [stockTable(), stockPlayerTable()],
}) {
  return ({ archive, bank, bytes }) => {
    const stock = tables
      .map((table) => stockBankOf(archive, bank, table))
      .find(Boolean);
    if (!stock) return unknown("no-table");
    const opened = openSealed(bytes, key);
    if (!opened) return unknown("not-decrypted");
    return sameSound(opened.digests, stock)
      ? { state: "stock" }
      : { state: "changed", bytes: opened.clear };
  };
}
