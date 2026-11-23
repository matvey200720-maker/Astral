/*
 * Зал арены мода для редактора (Хелпер 7, 25.10.2026): «Редактировать» у арены каталога открывает готовый зал самого мода — его
 * модели и его листы поверх зала игры, — а не штатную арену сервера.
 *
 * Зал собирает тот же конвейер, что рисует кадр каталога (`arena-hall-cover.js`: файлы мода → папка зала → провайдер → сцена
 * ARS1), только нужна одна сцена — «внутри» — и у материалов остаются игровые имена листов мода (`sheet`, `mine`), по которым
 * редактор красит. Файлы мода берутся из пакета каталога доверенным путём (подпись, размер и sha256 каждого файла, разрешённые
 * хосты — `downloadSignedPackage`, как у остальных частей): сначала скачивание в кэш загрузок (тот же пакет потом ставит
 * установка), потом сборка. Окну уходят сцена и листы — не файлы мода: пакет арены — сотни мегабайт.
 *
 * Арена Majestic (28.10.2026, круг 5): зал из ПАПКИ — файлы стандартной арены сервера рядом с приложением и файлы мода поверх (`arena-hall-cover.js: ARENA_COVER_VENUE`);
 * игра ему не нужна. Папка в поставке — часть арены (оболочки, словари, типы): модели мода и его листы в зале есть, мелкой расстановки сервера — нет.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { downloadSignedPackage } from "@modovik/install-engine";

import { ARENA_COVER_VENUE, arenaHallCover } from "./arena-hall-cover.js";
import { modNamesOf } from "./part-sheets.js";

/** Файлы мода, из которых собирается зал: модели, словари и расстановка. */
export const ARENA_MOD_HALL_FILES = /\.(ydr|yft|ydd|ytd|ytyp)$/i;

const MOD_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
/* Зал мода — до пары сотен мегабайт файлов (314 — 83 МБ, Sakura — 132 МБ); с запасом, но не весь диск. */
const MAX_BYTES = 640 * 1024 * 1024;

function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const arrayBufferOf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

/**
 * Зал из файлов мода: `{ server, scene, sheets: [{ key, bytes }], named: [{ name, key, uses }], stats }` или `null` — зала у этой
 * арены нет (Majestic: свой интерьер, в игре его нет) или он не собрался. Байты — `ArrayBuffer`, как ждёт окно.
 * `files` — `[{ name, bytes }]`, `source` — `{ root, keys }` игры, `deps` — подмена зависимостей зала для проверок.
 */
export async function buildArenaModHall({ files = [], server = "gta5rp", source, cacheRoot, deps = {} } = {}) {
  const own = files.filter((file) => ARENA_MOD_HALL_FILES.test(String(file?.name || "")) && file.bytes?.length);
  if (!own.length) return null;
  const names = await (deps.modNames || modNamesOf)({ files: own });
  const hall = await arenaHallCover({
    files: own,
    server,
    source,
    deps: { ...(cacheRoot ? { cacheRoot } : {}), ...deps },
    parts: ["inside"],
    venues: ARENA_COVER_VENUE,
    modSheets: new Set(names),
  });
  if (!hall?.inside) return null;
  return {
    server,
    scene: arrayBufferOf(hall.inside.bytes),
    sheets: hall.inside.sheets.map((sheet) => ({ key: sheet.key, bytes: arrayBufferOf(sheet.bytes) })),
    named: hall.inside.named || [],
    stats: hall.inside.stats,
  };
}

/* Последний собранный зал: повторное открытие того же мода в сеансе не пересобирает. */
let last = null;

/**
 * `input` — `{ manifest, baseUrl, server }` (манифест и адрес пакета — из разрешения на скачивание каталога), `deps` — `{ stateDir,
 * downloadsDir, publicKey, allowedHosts, allowInsecureLocalhost, source: { root, keys }, download?, build? }`.
 */
export async function readArenaModHall(input, context, deps) {
  const manifest = input?.manifest;
  const id = String(manifest?.id || "");
  if (!MOD_ID.test(id) || !manifest?.version) throw refusal("ARENA_PACKAGE", "У этой арены нет пакета.");
  /* Зал GTA 5 RP — модели игры; зал Majestic — папка стандартной арены сервера, игра ему не нужна. */
  if (!deps?.source?.root && (input?.server || "gta5rp") !== "majestic") throw refusal("ARENA_GAME", "Зал мода собирается из файлов вашей игры — подключите GTA V.");
  const key = `${id}@${manifest.version}`;
  if (last?.key === key && last.server === (input.server || "gta5rp")) return last.result;
  const downloaded = await (deps.download || downloadSignedPackage)({
    manifest,
    baseUrl: String(input?.baseUrl || ""),
    publicKey: deps.publicKey,
    stateDir: deps.stateDir,
    downloadsDir: deps.downloadsDir || null,
    allowInsecureLocalhost: Boolean(deps.allowInsecureLocalhost),
    allowedHosts: deps.allowedHosts ?? null,
    onProgress: context?.onProgress || null,
  });
  const root = path.resolve(downloaded.packageRoot);
  const files = [];
  let total = 0;
  for (const file of downloaded?.manifest?.files || manifest.files || []) {
    if (!file?.source || file.action === "delete") continue;
    const entry = String(file.entry || file.target || "");
    const name = entry.split(/[\\/]/).pop();
    if (!ARENA_MOD_HALL_FILES.test(name)) continue;
    const from = path.resolve(root, file.source);
    if (!from.startsWith(root + path.sep)) continue;
    const bytes = await fs.readFile(from);
    total += bytes.byteLength;
    if (total > MAX_BYTES) throw refusal("ARENA_TOO_LARGE", "Файлы арены слишком большие для мастерской.");
    files.push({ name, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
  }
  const server = input.server || "gta5rp";
  const result = await (deps.build || buildArenaModHall)({
    files,
    server,
    source: deps.source,
    cacheRoot: deps.cacheRoot,
  });
  if (!result) throw refusal("ARENA_NO_HALL", "У этой арены нет зала, который можно открыть: останется штатная арена сервера.");
  last = { key, server, result };
  return result;
}

/** Для тестов: забыть последний зал. */
export function forgetArenaModHall() {
  last = null;
}
