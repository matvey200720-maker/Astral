/*
 * Маппинг, модели которого лежат в другой части редукса (СЖАТЫЙ · Mapping (1), 14.11.2026): карта `vzh1.ymap` ставит у электростанции 61 вещь, а их `.ydr` автор положил в часть «Залазы»
 * (`arrow`, `jump`, `firstpov`, `thirdpov`, `stay` — значки подсказок). В своей части моделей нет, и обложка была одной картой с жёлтыми точками, без самих вещей.
 * Вещь карты называет хеш имени (`joaat`), по нему и ищется модель: среди частей того же редукса берутся `.ydr` (и словарь `.ytd` с тем же именем), чьё имя даёт один из хешей,
 * которых нет среди своих моделей. Своих хешей хватает — ничего не добавляется, часть снимается как раньше.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { joaatName } from "./place-isolation.js";
import { readMapEntityPlaces } from "./map-entities-append.js";

const MODEL_OR_SHEET = /\.(ydr|ytd)$/i;
const MAP_FILE = /\.ymap$/i;
const MODEL_FILE = /\.ydr$/i;

/* Взятых у соседей файлов — не больше (на обложке видно несколько вещей, остальное только раздуло бы заявку окну). */
const BORROWED_MAX = 12;
const BORROWED_BYTES = 12 * 1024 * 1024;

const stemOf = (name) =>
  String(name || "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase();

const readJson = (file) =>
  fs.readFile(file, "utf8").then(JSON.parse, () => null);

/** Хеши вещей, что карты части ставят в мир, а своей модели у части нет. Пусто — подбирать нечего. */
export function unplacedHashes(files, readPlaces = readMapEntityPlaces) {
  const own = new Set(
    files
      .filter((file) => MODEL_FILE.test(String(file?.name)))
      .map((file) => joaatName(stemOf(file.name)) >>> 0),
  );
  const missing = new Set();
  for (const file of files.filter(
    (one) => MAP_FILE.test(String(one?.name)) && one.bytes?.length,
  )) {
    try {
      for (const entity of readPlaces(new Uint8Array(file.bytes))) {
        const hash = entity.archetype >>> 0;
        if (!own.has(hash)) missing.add(hash);
      }
    } catch {
      /* карта не читается — её вещей не ждём */
    }
  }
  return missing;
}

/**
 * Файлы моделей из частей того же редукса: `[{ name, bytes }]`.
 * @param {object} options
 * @param {{ name: string, bytes?: Uint8Array }[]} options.files файлы части
 * @param {string} options.directory папка части
 * @param {() => Promise<[string, string][]>} options.everySibling все части партии: `[id, папка]`
 * @param {(bytes: Uint8Array) => { archetype: number }[]} [options.readPlaces] чтение вещей карты (в тестах — подмена)
 */
export async function siblingModelFiles({
  files,
  directory,
  everySibling,
  readPlaces = readMapEntityPlaces,
}) {
  if (typeof everySibling !== "function") return [];
  const wanted = unplacedHashes(files, readPlaces);
  if (!wanted.size) return [];
  const own = await readJson(path.join(directory, "part.json"));
  if (!own?.redux) return [];
  const found = [];
  let spent = 0;
  for (const [, home] of await everySibling()) {
    if (path.resolve(home) === path.resolve(directory)) continue;
    const part = await readJson(path.join(home, "part.json"));
    if (part?.redux !== own.redux) continue;
    const spec = await readJson(path.join(home, "mod.json"));
    const root = path.resolve(home);
    const stems = new Set(
      (spec?.files || [])
        .map((record) => String(record?.entry || record?.target || ""))
        .filter(
          (entry) =>
            MODEL_FILE.test(entry) &&
            wanted.has(joaatName(stemOf(entry)) >>> 0),
        )
        .map(stemOf),
    );
    for (const record of spec?.files || []) {
      const name = String(record?.entry || record?.target || "")
        .split(/[\\/]/)
        .pop();
      if (
        !record?.source ||
        !MODEL_OR_SHEET.test(name) ||
        !stems.has(stemOf(name))
      )
        continue;
      const resolved = path.resolve(home, record.source);
      if (!resolved.startsWith(root + path.sep) || found.length >= BORROWED_MAX)
        continue;
      const bytes = await fs.readFile(resolved).then(
        (data) => new Uint8Array(data),
        () => null,
      );
      if (!bytes) continue;
      spent += bytes.length;
      if (spent > BORROWED_BYTES) return found;
      found.push({ name, bytes });
    }
  }
  return found;
}
