import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import { isManagedOverlayTarget } from "./manifest.js";
import { canonicalArchiveEntry } from "./astral-paths.js";
import { reanchorStatePaths, relocateState } from "./state-paths.js";
import {
  copyBaseline,
  DEFAULT_DIR,
  initialState,
  missingBaseline,
  statePaths,
} from "./storage-state.js";

let mutationQueue = Promise.resolve();

/*
 * Записи архивов — по пути так, как его ищет игра (`astral-paths.js`).
 * Состояния до 26.09.2026 держат `x64/Astral/…`: ключ переводится в
 * строчный при чтении, слои совпавших ключей складываются по порядку. Сам
 * архив с прежней папкой переписывает подготовка слоя
 * (`prepareAstralLayerCore`, она видит старое имя в `astralLayer.container`).
 */
function canonicalArchiveState(archive) {
  if (!archive || typeof archive !== "object") return archive;
  const entries =
    archive.entries && typeof archive.entries === "object"
      ? archive.entries
      : {};
  const keys = Object.keys(entries);
  if (keys.every((key) => key === canonicalArchiveEntry(key))) return archive;
  const canonical = {};
  for (const key of keys) {
    const name = canonicalArchiveEntry(key);
    const record = entries[key];
    if (!Object.hasOwn(canonical, name)) {
      canonical[name] = record;
      continue;
    }
    canonical[name] = {
      ...canonical[name],
      layers: [
        ...(canonical[name]?.layers || []),
        ...(record?.layers || []),
      ],
    };
  }
  delete archive.lastBuilt;
  return { ...archive, entries: canonical };
}

/*
 * Пути записей в описи установленного: по ним снятие и замена мода находят
 * его слои. Ключи записей строчные — значит, и опись тоже: иначе замена
 * радуги не нашла бы слоёв прежней (`x64/Astral/…`), и снятая новая
 * открыла бы из-под себя старую.
 */
function canonicalInstalled(installed) {
  if (!Array.isArray(installed)) return installed;
  return installed.map((item) =>
    Array.isArray(item?.archiveEntries) &&
    item.archiveEntries.some(
      (entry) => entry?.entry && entry.entry !== canonicalArchiveEntry(entry.entry),
    )
      ? {
          ...item,
          archiveEntries: item.archiveEntries.map((entry) =>
            entry?.entry
              ? { ...entry, entry: canonicalArchiveEntry(entry.entry) }
              : entry,
          ),
        }
      : item,
  );
}

/**
 * Записи и опись цели — в том виде, в каком их ищет игра. Зовётся при
 * чтении состояния и при возврате контрольной точки (снимки в точках
 * бывают старше этого правила).
 */
export function canonicalTargetRecords(record) {
  if (!record || typeof record !== "object") return record;
  if (record.archives && typeof record.archives === "object")
    record.archives = Object.fromEntries(
      Object.entries(record.archives).map(([relativePath, archive]) => [
        relativePath,
        canonicalArchiveState(archive),
      ]),
    );
  if (Array.isArray(record.installed))
    record.installed = canonicalInstalled(record.installed);
  pruneOrphanLayers(record);
  return record;
}

/*
 * Слой мода, которого нет среди установленных, — призрак: его некому снять,
 * а пересборка кладёт его в игру. Такие оставались, когда опись мода
 * расходилась с ключами записей (`x64/Astral` до 26.09.2026), и снятая
 * радуга возвращала из-под себя прежнюю. Системные слои движка (`@…`) —
 * не моды, их не трогаем.
 */
function pruneOrphanLayers(record) {
  if (!Array.isArray(record.installed) || !record.archives) return;
  const installed = new Set(record.installed.map((item) => item?.modId));
  for (const archive of Object.values(record.archives))
    for (const entry of Object.values(archive?.entries || {})) {
      if (!Array.isArray(entry?.layers)) continue;
      const kept = entry.layers.filter(
        (layer) =>
          !layer?.modId ||
          String(layer.modId).startsWith("@") ||
          installed.has(layer.modId),
      );
      if (kept.length !== entry.layers.length) {
        entry.layers = kept;
        delete archive.lastBuilt;
      }
    }
}

function normalizeResourceState(relativePath, resource) {
  const legacyBase = copyBaseline(resource?.base);
  const compositionBase = copyBaseline(resource?.compositionBase, legacyBase);
  const original = copyBaseline(resource?.original, legacyBase);
  const clean = copyBaseline(
    resource?.clean,
    isManagedOverlayTarget(relativePath)
      ? missingBaseline()
      : { ...legacyBase, verified: false },
  );
  return {
    ...resource,
    base: compositionBase,
    compositionBase,
    original,
    clean,
    layers: Array.isArray(resource?.layers) ? resource.layers : [],
  };
}

/*
 * Подмена файла переименованием на Windows отказывает (`EPERM`, `EBUSY`),
 * пока файл держит открытым кто-то ещё: окно читает профиль, антивирус
 * сканирует только что записанное. 04.10.2026 так сорвалось снятие из
 * библиотеки — транзакция откатилась, работа пропала. Читатель держит файл
 * миллисекунды, поэтому подмена повторяется с паузой до ~3 с.
 */
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 120, 200, 300, 400, 500, 600, 700];

export async function renameWithRetry(from, to, { delays = RENAME_RETRY_DELAYS_MS, rename = fs.rename } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!RENAME_RETRY_CODES.has(error?.code) || attempt >= delays.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  /* Без отступов (05.10.2026): состояние владельца с отступами весило
     114 МБ, без них — вдвое меньше, а читает и пишет его каждая установка. */
  await fs.writeFile(temp, JSON.stringify(value), "utf8");
  try {
    await renameWithRetry(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readState(stateDir = DEFAULT_DIR) {
  try {
    return await loadState(stateDir);
  } catch {
    return initialState();
  }
}

/* Чтение с отказом наружу: общему разбору (`readStateShared`) нельзя
   запомнить пустое состояние вместо файла, который на миг не прочитался. */
async function loadState(stateDir) {
  const paths = statePaths(stateDir);
  const parsed = JSON.parse(await fs.readFile(paths.state, "utf8"));
  /* Хранилище переехало (перенос кэша, копия папки Astral на другой диск):
     пути копий — к тому, где состояние лежит сейчас (`state-paths.js`).
     Запишет их на диск первая же мутация. */
  await reanchorStatePaths(parsed.targets, paths.root);
  const targets =
    parsed.targets && typeof parsed.targets === "object" ? parsed.targets : {};
  for (const target of Object.values(targets)) {
    target.baselineMode =
      target.baselineMode === "clean" || target.baselineMode === "original"
        ? target.baselineMode
        : target.lastGlobalRestore?.mode === "clean"
          ? "clean"
          : "original";
    target.resources =
      target.resources && typeof target.resources === "object"
        ? target.resources
        : {};
    target.resources = Object.fromEntries(
      Object.entries(target.resources).map(([relativePath, resource]) => [
        relativePath,
        normalizeResourceState(relativePath, resource),
      ]),
    );
    canonicalTargetRecords(target);
    target.dlcRegistrations =
      target.dlcRegistrations && typeof target.dlcRegistrations === "object"
        ? target.dlcRegistrations
        : {};
    target.directDlcRegistrations =
      target.directDlcRegistrations &&
      typeof target.directDlcRegistrations === "object"
        ? target.directDlcRegistrations
        : {};
  }
  /* Разбор большого состояния — ~0,2 с главного потока, а за ним мутация
     сразу делает копию (ещё ~0,2 с): между ними окно получает ход, и
     «Применить» не стоит одним куском (задача 6 ТЗ 08.10.2026, вечер).
     Таймер, а не setImmediate: тот бежит в том же обороте цикла, и
     Chromium между ними своих задач не берёт. */
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    ...initialState(),
    ...parsed,
    schemaVersion: 6,
    targets,
    restorePoints:
      parsed.restorePoints && typeof parsed.restorePoints === "object"
        ? parsed.restorePoints
        : {},
    installed: Array.isArray(parsed.installed)
      ? canonicalInstalled(parsed.installed)
      : [],
  };
}

/*
 * Один разбор состояния на всех читателей (задача 6 ТЗ 08.10.2026, вечер).
 *
 * Состояние у владельца весит 67 МБ: каждое чтение — ~0,2 с главного потока
 * подряд и ~300 МБ мусора, а «Применить» перекраски спрашивало его шесть раз
 * (что стоит из набора, что под растительностью, под текстурами, под
 * дорогами…) — сторож писал «Главный процесс не отвечал 2–3 с». Читатели
 * (`inspectProfile`) получают один разбор на версию файла: версия — номер
 * файла, размер и время записи, а своя запись движка (`writeState`)
 * сбрасывает разбор сразу. Разбор заморожен: читатель, который попробует
 * его поменять, упадёт на месте, а не испортит общий снимок соседям. Через
 * 30 с без чтений разбор отпускается — в простое память не держится.
 * Мутации движка читают состояние, как прежде, заново (`readState`).
 */
const SHARED_IDLE_MS = 30_000;
const sharedStates = new Map();
const sharedGenerations = new Map();

const sharedKey = (stateDir) => {
  const resolved = path.resolve(String(stateDir || DEFAULT_DIR));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

function forgetSharedState(stateDir) {
  const key = sharedKey(stateDir);
  sharedGenerations.set(key, (sharedGenerations.get(key) || 0) + 1);
  clearTimeout(sharedStates.get(key)?.timer);
  sharedStates.delete(key);
}

function deepFreeze(root) {
  const stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || Object.isFrozen(value)) continue;
    Object.freeze(value);
    for (const child of Array.isArray(value) ? value : Object.values(value))
      if (child && typeof child === "object") stack.push(child);
  }
  return root;
}

export async function readStateShared(stateDir = DEFAULT_DIR) {
  const key = sharedKey(stateDir);
  const info = await fs.stat(statePaths(stateDir).state).catch(() => null);
  if (!info) return deepFreeze(initialState());
  const fingerprint = `${info.ino}|${info.size}|${info.mtimeMs}`;
  const generation = sharedGenerations.get(key) || 0;
  let entry = sharedStates.get(key);
  if (
    !entry ||
    entry.fingerprint !== fingerprint ||
    entry.generation !== generation
  ) {
    clearTimeout(entry?.timer);
    const current = {
      fingerprint,
      generation,
      timer: null,
      promise: loadState(stateDir).then(deepFreeze),
    };
    current.promise.catch(() => {
      if (sharedStates.get(key) === current) {
        clearTimeout(current.timer);
        sharedStates.delete(key);
      }
    });
    sharedStates.set(key, current);
    entry = current;
  }
  clearTimeout(entry.timer);
  const held = entry;
  entry.timer = setTimeout(() => {
    if (sharedStates.get(key) === held) sharedStates.delete(key);
  }, SHARED_IDLE_MS);
  entry.timer.unref?.();
  try {
    return await entry.promise;
  } catch {
    /* Файл на миг не прочитался (его держит антивирус, идёт подмена) —
       ответ как у `readState`, но без памяти. */
    return deepFreeze(initialState());
  }
}

/*
 * Снимок цели в точке восстановления — сжатым (06.10.2026). Снимок несёт
 * опись цели целиком, а у пакета ухудшения текстур она — 52 тысячи записей:
 * восемь снимков по 31 МБ раздули состояние до 214 МБ, и главный процесс,
 * разбирая его несколькими читателями сразу, падал без памяти. Снимок
 * нужен только при откате к точке — там он и распаковывается
 * (`restorePointSnapshot`); сжатая строка разбирается почти даром.
 * Сжимается только новый снимок: прочитанные с диска уже строкой.
 */
export const packSnapshot = (snapshot) =>
  zlib.gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8")).toString("base64");

/* То же сжатие мимо главного потока (06.10.2026, вечер): снимок — десятки
   мегабайт JSON, и `gzipSync` останавливал окно на время записи состояния. */
const gzipAsync = (bytes) =>
  new Promise((resolve, reject) => zlib.gzip(bytes, (error, packed) => (error ? reject(error) : resolve(packed))));
export const packSnapshotAsync = async (snapshot) =>
  (
    await gzipAsync(
      Buffer.from(
        typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot),
        "utf8",
      ),
    )
  ).toString("base64");

/** Снимок точки восстановления: прежний (объектом или строкой, ещё не
    записанный) или сжатый; `null` — нет. */
export function restorePointSnapshot(point) {
  if (point?.snapshot && typeof point.snapshot === "object") return point.snapshot;
  if (typeof point?.snapshot === "string") {
    try {
      return JSON.parse(point.snapshot);
    } catch {
      return null;
    }
  }
  if (typeof point?.snapshotZ !== "string") return null;
  try {
    return JSON.parse(zlib.gunzipSync(Buffer.from(point.snapshotZ, "base64")).toString("utf8"));
  } catch {
    return null;
  }
}

async function packedRestorePoints(restorePoints) {
  if (!restorePoints || typeof restorePoints !== "object") return restorePoints;
  return Object.fromEntries(
    await Promise.all(
      Object.entries(restorePoints).map(async ([targetId, points]) => [
        targetId,
        Array.isArray(points)
          ? await Promise.all(
              points.map(async (point) => {
                if (!point?.snapshot || !["object", "string"].includes(typeof point.snapshot)) return point;
                const { snapshot, ...rest } = point;
                const packed = { ...rest, snapshotZ: await packSnapshotAsync(snapshot) };
                /* В памяти — тоже строкой: следующая запись не сжимает снова. */
                delete point.snapshot;
                point.snapshotZ = packed.snapshotZ;
                return packed;
              }),
            )
          : points,
      ]),
    ),
  );
}

export async function writeState(state, stateDir = DEFAULT_DIR) {
  state.updatedAt = new Date().toISOString();
  state.installed = Object.values(state.targets || {}).flatMap(
    (target) => target.installed || [],
  );
  /* Общий разбор читателей сбрасывается до записи и после: чтение,
     начатое посреди, не останется в памяти прежней версией. */
  forgetSharedState(stateDir);
  try {
    await atomicJson(statePaths(stateDir).state, {
      ...state,
      restorePoints: await packedRestorePoints(state.restorePoints),
    });
  } finally {
    forgetSharedState(stateDir);
  }
  return state;
}

/*
 * Очередь ждёт конец мутации, а не держит её итог (ОЗУ, бета 15.10.2026).
 * Установка, снятие и соседи отдают из мутации всё состояние
 * (`transactWithJournal` → `next`), и `job.catch(() => {})` хранил этот
 * разбор в главном процессе до следующей мутации — после «Применить» и в
 * простое. Разбор тяжёлого состояния — сотни мегабайт кучи
 * (`readStateShared`: 67 МБ файла — ~300 МБ).
 */
const settled = () => {};

export function serializeMutation(work) {
  const job = mutationQueue.then(work);
  mutationQueue = job.then(settled, settled);
  return job;
}

/**
 * Пути состояния на диске — к хранилищу, где оно лежит сейчас (перенос
 * кэша на другой диск, бета 13.10.2026).
 *
 * `loadState` узнаёт переехавший корень только в памяти и пишет его первой
 * мутацией. До неё файл читают и другие: уборка кэша (`cache-housekeeping.js`)
 * не находила в нём ни одного пути нового места и стирала там хранилища
 * модов и сборки, после чего узнавать корень было уже не по чему. Снимки
 * контрольных точек мутация не переписывает вовсе — они сжаты.
 *
 * `moves` — корни из журнала переноса (`[{ from, to }]`), переписываются без
 * доказательства; прочие узнаются по файлам (`reanchorStatePaths`) и
 * переносятся во всём состоянии, вместе со снимками. `except` — что под
 * прежним корнем не переезжает. Нет файла, не читается, идёт транзакция
 * (её разбор вернул бы прежнее состояние) — ничего не пишется; ответ
 * `{ changed, from, pending }`.
 */
export function relocateStateFile({ stateDir = DEFAULT_DIR, moves = [], except = [], probe } = {}) {
  return serializeMutation(async () => {
    const paths = statePaths(stateDir);
    const journals = await fs.readdir(paths.transactions).catch(() => []);
    if (journals.length) return { changed: 0, from: [], pending: true };
    let state;
    try {
      state = JSON.parse(await fs.readFile(paths.state, "utf8"));
    } catch {
      return { changed: 0, from: [], pending: false };
    }
    if (!state || typeof state !== "object") return { changed: 0, from: [], pending: false };
    let changed = await relocateState(state, moves, { except });
    const proven = await reanchorStatePaths(state.targets, paths.root, probe ? { probe } : {});
    if (proven.from.length)
      changed +=
        proven.changed +
        (await relocateState(
          state,
          proven.from.map((from) => ({ from, to: paths.root })),
          { except },
        ));
    if (!changed) return { changed: 0, from: [], pending: false };
    forgetSharedState(stateDir);
    try {
      await atomicJson(paths.state, state);
    } finally {
      forgetSharedState(stateDir);
    }
    return { changed, from: proven.from, pending: false };
  });
}

export function assertAbsoluteInside(root, candidate) {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  const diff = path.relative(base, resolved);
  if (!diff || (!diff.startsWith("..") && !path.isAbsolute(diff))) {
    return resolved;
  }
  throw new Error("Контрольная точка содержит путь вне защищённого хранилища.");
}

const snapshotShape = (target, copy) => ({
  gameRoot: target?.gameRoot || null,
  edition: target?.edition || null,
  baselineMode: target?.baselineMode === "clean" ? "clean" : "original",
  installed: copy(target?.installed || []),
  archives: copy(target?.archives || {}),
  dlcRegistrations: copy(target?.dlcRegistrations || {}),
  directDlcRegistrations: copy(target?.directDlcRegistrations || {}),
  fastWeaponDlc: copy(target?.fastWeaponDlc || null),
  clothingDlc: copy(target?.clothingDlc || null),
  astralLayer: copy(target?.astralLayer || null),
  layers: Object.fromEntries(
    Object.entries(target?.resources || {}).map(([relativePath, resource]) => [
      relativePath,
      copy(resource.layers || []),
    ]),
  ),
  /* Основа, на которой собраны слои снимка (отпечаток файла по ресурсам; `resource-composition.js`: `compositionBase || base`). Сборки точки в кэше может не быть («одна запись вместо двух»),
     и возврат пересобирает её из ТЕКУЩЕЙ основы: если основа с тех пор другая, пересборка выйдет не той, и возврат отказывает до записи (`restore-point-base.js`). Старые точки поля не несут. */
  compositionBases: Object.fromEntries(
    Object.entries(target?.resources || {})
      .map(([relativePath, resource]) => [relativePath, String((resource?.compositionBase || resource?.base)?.sha256 || "").toLowerCase()])
      .filter(([, sha256]) => sha256),
  ),
});

export function snapshotTarget(target) {
  return snapshotShape(target, structuredClone);
}

/*
 * Тот же снимок сразу строкой JSON (задача 6 ТЗ 08.10.2026, вечер):
 * транзакция кладёт его в точку отката, а запись сжимает строку — глубокая
 * копия описи (у ухудшения текстур — 61 тысяча записей) стоила ~0,15 с
 * главного потока ради того, чтобы потом всё равно стать строкой. Строка
 * снимается сразу, пока цель не тронута, — байты точки те же.
 */
export function snapshotTargetJson(target) {
  return JSON.stringify(snapshotShape(target, (value) => value));
}
