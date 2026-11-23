/*
 * Пути состояния — к хранилищу, в котором оно лежит (задача 1 ТЗ 10.10.2026).
 *
 * Состояние движка помнит свои копии абсолютными путями: основы архивов
 * (`<хранилище>/bases/…`), файлы слоёв и сборки (`<хранилище>/payloads/…`).
 * Хранилище переезжает — перенос кэша в настройках, ручная копия папки
 * Astral на другой диск, восстановление её из резервной копии, — а пути в
 * файле остаются прежними. У друга владельца после переноса дальше каждая
 * установка, снятие и «Вернуть без модов» шли по мёртвым путям: «Контрольная
 * точка содержит путь вне защищённого хранилища» и `ENOENT`, и ни один мод
 * больше не ставился.
 *
 * Прежний корень узнаётся по самим путям. Всё, что движок кладёт сам, лежит
 * в одной из его папок (`ENGINE_FOLDERS`); путь вне текущего хранилища с
 * такой папкой внутри — кандидат, а доказательство — тот же файл на том же
 * месте под текущим корнем. Доказанный корень переносится во всём
 * состоянии разом: один найденный файл отвечает за тысячи записей слоёв, и
 * каждую проверять не нужно. Недоказанное не трогается: пропавшие копии
 * лечит уже сам движок (основа — по живому архиву, сборка — пересборкой).
 *
 * Корень, известный из журнала переноса (`relocateState`, бета 13.10.2026),
 * доказательства не ждёт: перенос знает, откуда и куда переехали файлы, и
 * переписывает всё состояние вместе со снимками контрольных точек — они
 * лежат сжатыми, и обход строк их не видит.
 */
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

export const ENGINE_FOLDERS = Object.freeze(["bases", "payloads", "downloads", "transactions"]);

/* Поля, где лежат пути игры, а не хранилища: их перенос не касается. */
const FOREIGN_FIELDS = new Set(["gameRoot", "livePath", "source", "patch"]);

/* Сколько путей проверять файлами на одного кандидата в прежние корни,
   прежде чем сдаться. Раньше предел был один на всё состояние (48), и
   кандидаты с пропавшими файлами (старые версии модов, загрузки вне
   хранилища) выбирали его раньше, чем доходило до живого корня. */
const PROBES_PER_PREFIX = 24;

const caseless = process.platform === "win32";
const fold = (value) => (caseless ? String(value).toLowerCase() : String(value));

const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

const gunzip = promisify(zlib.gunzip);
const gzip = promisify(zlib.gzip);

const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

function startsWithFolded(text, prefixFolded) {
  return text.length >= prefixFolded.length && fold(text.slice(0, prefixFolded.length)) === prefixFolded;
}

/* Строки состояния с путями, кроме путей игры. */
function visitStrings(value, visit, key = "") {
  if (typeof value === "string") {
    if (!FOREIGN_FIELDS.has(key) && ABSOLUTE.test(value)) visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitStrings(item, visit, key);
    return;
  }
  if (value && typeof value === "object")
    for (const [name, item] of Object.entries(value)) visitStrings(item, visit, name);
}

function rewriteStrings(value, rewrite, key = "") {
  if (typeof value === "string") return !FOREIGN_FIELDS.has(key) && ABSOLUTE.test(value) ? rewrite(value) : value;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) value[index] = rewriteStrings(value[index], rewrite, key);
    return value;
  }
  if (value && typeof value === "object") {
    for (const [name, item] of Object.entries(value)) value[name] = rewriteStrings(item, rewrite, name);
    return value;
  }
  return value;
}

/**
 * Прежний корень хранилища для пути `file`, доказанный файлом под `root`.
 * Пробует каждую папку движка в пути слева направо: имя такой папки может
 * встретиться и в пути к самому хранилищу (`D:\downloads\Astral Cache\…`).
 * `spent` — сколько проверок уже ушло на каждого кандидата.
 */
async function provenPrefix(file, root, probe, spent) {
  const segments = path.resolve(file).split(path.sep);
  for (let index = 1; index < segments.length - 1; index += 1) {
    if (!ENGINE_FOLDERS.includes(segments[index].toLowerCase())) continue;
    const prefix = segments.slice(0, index).join(path.sep);
    if (!prefix || fold(prefix) === fold(root)) continue;
    const key = fold(prefix);
    const tries = spent.get(key) || 0;
    if (tries >= PROBES_PER_PREFIX) continue;
    spent.set(key, tries + 1);
    if (await probe(path.join(root, ...segments.slice(index)))) return prefix;
  }
  return null;
}

/**
 * Переносит пути состояния `state` (объект меняется на месте) с прежних
 * корней на `stateDir`. Возвращает, сколько путей перенесено и откуда.
 */
export async function reanchorStatePaths(state, stateDir, { probe = exists } = {}) {
  const root = path.resolve(String(stateDir || ""));
  const rootFolded = fold(`${root}${path.sep}`);
  const stale = [];
  visitStrings(state, (text) => {
    if (!startsWithFolded(text, rootFolded)) stale.push(text);
  });
  if (!stale.length) return { changed: 0, from: [] };
  const prefixes = [];
  const spent = new Map();
  for (const text of stale) {
    if (prefixes.some((prefix) => startsWithFolded(text, fold(`${prefix}${path.sep}`)))) continue;
    if (!ENGINE_FOLDERS.some((folder) => fold(text).includes(`${path.sep}${folder}${path.sep}`) || fold(text).includes(`/${folder}/`))) continue;
    const prefix = await provenPrefix(text, root, probe, spent);
    if (prefix) prefixes.push(prefix);
  }
  if (!prefixes.length) return { changed: 0, from: [] };
  const folded = prefixes.map((prefix) => ({ prefix, key: fold(`${prefix}${path.sep}`) }));
  let changed = 0;
  rewriteStrings(state, (text) => {
    const hit = folded.find((item) => startsWithFolded(text, item.key));
    if (!hit) return text;
    changed += 1;
    return path.join(root, text.slice(hit.prefix.length + 1));
  });
  return { changed, from: prefixes };
}

/*
 * Переезды `[{ from, to }]` — в вид, удобный для сверки строк. `except` —
 * имена прямо под прежним корнем, которые не переезжают (точки отката
 * хоста и список папок игры остаются в папке по умолчанию,
 * `storage-manager.js`).
 */
function preparedMoves(moves, except = []) {
  const skip = except.map((name) => fold(String(name).replaceAll("\\", "/")));
  return (Array.isArray(moves) ? moves : [])
    .filter((move) => move?.from && move?.to)
    .map((move) => ({ from: path.resolve(String(move.from)), to: path.resolve(String(move.to)) }))
    .filter((move) => fold(move.from) !== fold(move.to))
    .map((move) => ({ ...move, key: fold(`${move.from}${path.sep}`), skip }));
}

function movedPath(text, moves) {
  const move = moves.find((item) => startsWithFolded(text, item.key));
  if (!move) return null;
  const rest = text.slice(move.from.length + 1);
  const name = fold(rest.replaceAll("\\", "/"));
  if (move.skip.some((entry) => name === entry || name.startsWith(`${entry}/`))) return null;
  return path.join(move.to, rest);
}

/* Строка снимка с упоминанием прежнего корня (без разбора JSON): у снимка
   десятки мегабайт, а прежний корень встречается в немногих. */
function mentionsMoves(json, moves) {
  const text = fold(json);
  return moves.some((move) => text.includes(fold(JSON.stringify(`${move.from}${path.sep}`).slice(1, -1))));
}

/**
 * Пути из прежних корней в новые — во всём состоянии, включая снимки
 * контрольных точек (`restorePoints[цель][].snapshot` объектом или строкой и
 * сжатый `snapshotZ`). Пути игры не трогаются. Объект меняется на месте;
 * ответ — сколько путей переписано.
 */
export async function relocateState(state, moves, { except = [] } = {}) {
  const prepared = preparedMoves(moves, except);
  if (!prepared.length || !state || typeof state !== "object") return 0;
  let changed = 0;
  const rewrite = (text) => {
    const next = movedPath(text, prepared);
    if (next === null) return text;
    changed += 1;
    return next;
  };
  rewriteStrings(state, rewrite);
  for (const points of Object.values(state.restorePoints || {})) {
    if (!Array.isArray(points)) continue;
    for (const point of points) {
      if (!point || typeof point !== "object") continue;
      if (typeof point.snapshot === "string" && mentionsMoves(point.snapshot, prepared)) {
        try {
          point.snapshot = JSON.stringify(rewriteStrings(JSON.parse(point.snapshot), rewrite));
        } catch {
          /* Битый снимок откат и так не примет (`restorePointSnapshot`). */
        }
      }
      if (typeof point.snapshotZ !== "string") continue;
      let json;
      try {
        json = (await gunzip(Buffer.from(point.snapshotZ, "base64"))).toString("utf8");
      } catch {
        continue;
      }
      if (!mentionsMoves(json, prepared)) continue;
      try {
        const snapshot = rewriteStrings(JSON.parse(json), rewrite);
        point.snapshotZ = (await gzip(Buffer.from(JSON.stringify(snapshot), "utf8"))).toString("base64");
      } catch {
        /* Не разобрался — остаётся как был: откат к нему узнает корень сам. */
      }
    }
  }
  return changed;
}

/**
 * Пути из прежнего корня `from` в новый `to` — без доказательства файлами:
 * так переписывает состояние сам перенос хранилища (`storage-manager.js`),
 * которому корни известны. Снимки точек — `relocateState`. Возвращает число
 * перенесённых путей.
 */
export function rewriteStateRoot(state, from, to) {
  const prepared = preparedMoves([{ from, to }]);
  if (!prepared.length) return 0;
  let changed = 0;
  rewriteStrings(state, (text) => {
    const next = movedPath(text, prepared);
    if (next === null) return text;
    changed += 1;
    return next;
  });
  return changed;
}

/**
 * Места под `root`, которыми может оказаться путь `file` (уборка кэша,
 * `cache-housekeeping.js`): сам путь, а если он вне `root` — тот же хвост
 * от каждой папки движка в нём под `root`. Уборка читает файл состояния
 * как есть, и путь прежнего корня должен держать свой файл и на новом
 * месте: иначе она стирала хранилища модов и сборки, на которые состояние
 * ссылается.
 */
export function placesUnder(file, root) {
  const resolved = path.resolve(String(file));
  if (!root) return [resolved];
  const base = path.resolve(String(root));
  if (startsWithFolded(resolved, fold(`${base}${path.sep}`))) return [resolved];
  const segments = resolved.split(path.sep);
  const places = [resolved];
  for (let index = 1; index < segments.length - 1; index += 1)
    if (ENGINE_FOLDERS.includes(segments[index].toLowerCase()))
      places.push(path.join(base, ...segments.slice(index)));
  return places;
}
