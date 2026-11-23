/*
 * База эффектов для обложек из сцен FX (25.10.2026, `docs/fx-scenes.md` §6а, «Обложки из сцен FX» ниже).
 *
 * Печь обложек (`catalog:render-covers`) кладёт эффект части поверх настоящего кадра GTA V правилами частиц из игры игрока —
 * теми же, что играет мастерская (`readPtfxBase`: выписки правил ядра, листы, свет таймцикла). Читает их только главный
 * процесс печи: окно-съёмщик получает готовую базу по локальному адресу (`part-shots-electron.js`). Игра — только чтение.
 *
 * Чтение занимает минуту, а база — десятки мегабайт, поэтому готовая лежит в кэше во временной папке: ключ — путь игры,
 * размер и время `update.rpf`, версия кода сборки базы (`FX_BASE_VERSION`). Сменилась игра или код — читается заново.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeBytes, encodeBytes } from "./ptfx-base-cache.js";
import { readPtfxBase } from "./ptfx-customizer.js";
import { rustReaderFor } from "./rust-readers.js";

/* Растёт, когда меняется состав базы (`readPtfxBase`) или то, что окно берёт из неё. */
export const FX_BASE_VERSION = 2;

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..", "..");

const PTFX_READER_MODULE = new URL("./ptfx-customizer.js", import.meta.url).href;

/** Адрес переходника базы эффектов на движке, если читатель `ptfx-base` включён (`ASTRAL_RUST_READERS`, `rust-readers.js`), и `null`, если читает прежний. */
export function coverBaseReaderFor(env = process.env) {
  return rustReaderFor(PTFX_READER_MODULE, "readPtfxBase", env);
}

/* Чтение базы печью: тем читателем, какого просит выключатель окна. Переходник сам отдаёт чтение прежнему, если движка или команды нет. Выключено — прежний читатель, как был. */
async function readByEnabledReader(...call) {
  const adapter = coverBaseReaderFor();
  if (adapter === null) return readPtfxBase(...call);
  return (await import(adapter)).readPtfxBase(...call);
}

/** Отпечаток состояния игры: путь, размер и время `update.rpf`. */
export async function gameFingerprint(gameRoot) {
  const stat = await fs.stat(path.join(gameRoot, "update", "update.rpf"));
  return createHash("sha256")
    .update(`${path.resolve(gameRoot).toLowerCase()}|${stat.size}|${Math.round(stat.mtimeMs)}|${FX_BASE_VERSION}`)
    .digest("hex")
    .slice(0, 24);
}

/**
 * База из игры игрока (`readPtfxBase`) или из кэша.
 * @param {object} options
 * @param {string} options.gameRoot — папка GTA V Legacy (только чтение)
 * @param {string} options.keys — папка ключей ArchiveFix
 * @param {string} [options.cacheDir] — где держать кэш; по умолчанию `%TEMP%/astral-fx-cover-base`
 * @param {(line: string) => void} [options.log]
 * @param {typeof readPtfxBase} [options.read] — чтение базы (проверки подставляют своё)
 * @returns {Promise<object>} база как её отдаёт мастерской `readPtfxBase`
 */
export async function readFxCoverBase({ gameRoot, keys, cacheDir = path.join(os.tmpdir(), "astral-fx-cover-base"), log = () => {}, read = readByEnabledReader }) {
  if (!gameRoot || !keys) throw new Error("Для базы эффектов нужны игра (--game) и ключи (--keys).");
  const fingerprint = await gameFingerprint(gameRoot);
  const file = path.join(cacheDir, `${fingerprint}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(file, "utf8"));
    if (cached?.fingerprint === fingerprint && cached.base?.tracerScene) {
      log(`База эффектов — из кэша (${fingerprint}).`);
      return decodeBytes(cached.base);
    }
  } catch {
    /* кэша нет или он битый — читаем игру */
  }
  log("База эффектов читается из игры (около минуты)…");
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "astral-fx-cover-read-"));
  try {
    const base = await read(
      { gameRoot, keys },
      { packaged: false, resourcesPath: undefined, projectRoot },
      work,
      /* Ключи — те, что дал вызывающий: докачивать их с сервера печи незачем. */
      { archiveSupport: async () => ({ directory: keys }) },
    );
    await fs.mkdir(cacheDir, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    /* Байты листов — `{ "$bytes": base64 }`, как у кэша приложения (`ptfx-base-cache.js`): JSON сам разворачивает их в числа по одному. */
    await fs.writeFile(temporary, JSON.stringify({ fingerprint, base: encodeBytes(base) }), "utf8");
    await fs.rename(temporary, file);
    return base;
  } finally {
    /* Резидентный движок, поднятый чтением, держал бы процесс печи живым после последней обложки. */
    try {
      const { stopResidentEngine } = await import("./native-engine.js");
      stopResidentEngine();
    } catch {
      /* движок не поднимался — стопить нечего */
    }
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/* Что окно берёт из базы: вспышка, след, клоны попаданий, свет. Окружение и сцена дальности — десятки мегабайт, окну обложек они не нужны. */
const WINDOW_KEYS = Object.freeze(["bloodfx", "version", "entries", "core", "tracerScene", "tracerSceneError", "impact", "impactError", "light", "lightError"]);

/** База для окна-съёмщика: только нужные поля. */
export function slimFxBase(base) {
  return Object.fromEntries(WINDOW_KEYS.filter((key) => key in (base || {})).map((key) => [key, base[key]]));
}
