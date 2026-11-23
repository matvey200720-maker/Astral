/*
 * Слепок разобранного редукса и привязка компонента к версии игры (Р4, «сейчас»; решения ведущей 10.11.2026). Хелпер 28.
 *
 *  • Слепок `entries.json.gz` лежит рядом с `part.json` одной из частей редукса: путь, размер и sha256 каждой записи `update.rpf` автора, отличной
 *    от штатной. Файлов Rockstar в нём нет, только отпечатки. По слепкам разных редуксов задание «согласие авторов» (Р4) найдёт штатные файлы прошлых
 *    версий игры. Голос автора — канал YouTube ролика, если он есть, иначе пишущий пост и канал Discord (один человек — один голос).
 *  • Привязка (`binding`) — что компонент ставит и поверх чего: ключ версии автора, записи манифеста и sha256 штатного файла под каждой записью в
 *    чистой копии, по которой шёл разбор. Её пишут в реестр импорта при выпуске: после обновления игры задание сверяет штатные файлы под маршрутами
 *    компонентов с `boundToBuild` и решает, пересобрать компонент или снять с выдачи.
 *
 * Чистый модуль (только gzip): ничего не читает с диска.
 */

import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

export const SNAPSHOT_FILE = "entries.json.gz";
export const SNAPSHOT_SCHEMA = 1;
const lower = (value) => String(value ?? "").split("\\").join("/").toLowerCase();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const slug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/** Голос автора: канал YouTube ролика (если у поста есть обзор), иначе пишущий пост и канал Discord. */
export function voiceOf({ reviewChannel = "", author = "", uploader = "", channel = "" } = {}) {
  const youtube = slug(reviewChannel);
  if (youtube) return { key: `youtube:${youtube}`, source: "youtube", name: String(reviewChannel).trim() };
  const poster = slug(uploader || author);
  const room = slug(channel);
  return { key: `discord:${poster || "?"}@${room || "?"}`, source: "discord", name: String(uploader || author || "").trim(), channel: String(channel || "") };
}

/**
 * Слепок редукса. `rows` — все записи `update.rpf` (`{ path, size, sha256 }`), `stock` — библиотека штатных версий (`isStock`).
 * Возвращает `{ file, rows, sha256, gz }`: `gz` — base64 от gzip; в `draft.json` едет строкой, на диск его кладёт `part-contract.js`.
 */
export function snapshotOf({ rows, stock, redux = "", build = null, post = {}, voice = voiceOf() }) {
  const authored = rows.filter((row) => !stock.isStock(row.path, row.sha256)).map((row) => [row.path, row.size, row.sha256]);
  const body = {
    schema: SNAPSHOT_SCHEMA,
    redux,
    build: build ? { key: build.key, dlclistTail: build.dlclistTail ?? [], dlcPatchPacks: build.dlcPatchPacks ?? 0 } : null,
    post: { url: post.url ?? "", channel: post.channel ?? "", title: post.title ?? "" },
    voice,
    count: authored.length,
    rows: authored,
  };
  const bytes = gzipSync(Buffer.from(`${JSON.stringify(body)}\n`), { level: 9 });
  return { file: SNAPSHOT_FILE, rows: authored.length, sha256: sha256(bytes), gz: bytes.toString("base64") };
}

/** Слепок из файла `entries.json.gz`. */
export const readSnapshot = (bytes) => JSON.parse(gunzipSync(bytes).toString("utf8"));

const modeOf = (file) => (file.merge?.strategy === "rpf-resource-layer-v1" ? "layer" : file.merge ? "merge" : /\.rpf$/i.test(String(file.entry)) ? "archive" : "whole");

/**
 * Привязка заявки к версии игры: записи манифеста и штатный sha256 под каждой (`null` — штатной записи нет: файл новый или лежит в базовых архивах,
 * отпечаток которых снимается по запросу, Р4). `entries[].mode`: whole — заменой целым файлом, merge — слоем/патчем, layer — слой Astral, archive — архив.
 */
export function bindingOf(draft, { build, baseline = "", stock }) {
  const seen = new Set();
  const entries = [];
  for (const file of draft.spec?.files ?? []) {
    const key = lower(file.entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ entry: file.entry, mode: modeOf(file), stockSha: lower(file.entry).startsWith("x64/astral/") ? null : stock.shaOf(file.entry) });
  }
  return {
    schema: 1,
    build: build?.key ?? "",
    baseline: String(baseline || ""),
    /* Откуда штатные sha256: из чистой копии, по которой шёл разбор (`baseline`), а не из версии игры самого автора — задание после обновления это учитывает. */
    stockFrom: "baseline",
    boundToBuild: draft.domain?.anatomy?.boundToBuild === true,
    slots: [...(draft.spec?.slots ?? [])],
    entries,
  };
}
