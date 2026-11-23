import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { governedPause } from "./disk-governor.js";
import { serializeMutation } from "./engine-state.js";
import { DEFAULT_DIR, statePaths } from "./storage-state.js";
import { parkedCachePaths } from "./parked-mods.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
import { placesUnder } from "./state-paths.js";
import { PACKED_SUFFIX } from "./chunk-store.js";
import { gameDiskCompositeDirectories } from "./composite-home.js";

/* Копия update.rpf с первой подготовки (`direct-base-cleanup.js`). */
const PROTECTED_COPY = "update-update.rpf.original.rpf";

/*
 * Уборка памяти движка.
 *
 * Каждая установка через движок оставляет в памяти по два гигабайта:
 * собранный update.rpf (`payloads/_rpf-composites/<цель>/<отпечаток>.rpf`),
 * а если архив перед этим поменял нативный патч — ещё и новую основу
 * (`bases/<цель>/update-rebases/<sha>.rpf`). Движок их только складывал: к
 * 26.09.2026 у владельца лежало семнадцать сборок и двенадцать основ, 58 ГБ,
 * а состояние ссылалось на две из них.
 *
 * Нужны только файлы, на которые ссылается состояние: основа, поверх которой
 * соберётся следующая установка, и сборка, что лежит сейчас в игре, — по ней
 * аудит сверяет архив, а починка кладёт его обратно. Прежние сборки — это
 * история контрольных точек движка, но окно их не показывает, и откат к такой
 * точке честно ответит «файл контрольной точки недоступен». Копия, снятая при
 * первой подготовке (`bases/<цель>/update-update.rpf.original.rpf`), лежит вне
 * этих папок и не убирается никогда: это единственный чистый update.rpf
 * игрока, на нём держатся «как в игре» большой карты и базы редакторов.
 *
 * Что уходит:
 *   • сборки и основы, которые только что сменила транзакция, — сразу: до
 *     этой секунды ими пользовалось состояние, после неё — никто;
 *   • прочие файлы без ссылки — когда им больше получаса: так уборка не
 *     заденет сборку, которую прямо сейчас готовит другой процесс Astral с
 *     тем же хранилищем (ссылка на неё появится в состоянии при записи);
 *   • недописанные `.stage` и папки `.astral-compose-*` helper'а — когда им
 *     больше шести часов: живая пересборка столько не идёт, а оборванная
 *     оставляла по два гигабайта навсегда.
 *
 * Уборка ничего не делает, пока в `transactions/` лежит журнал (его сначала
 * разберёт восстановление) и пока состояние не читается или в нём нет ни
 * одной игры: пустой ответ на «на что ссылается состояние» — не повод
 * стирать основы.
 */

export const FRESH_COPY_MS = 30 * 60 * 1000;
export const STALE_WORK_MS = 6 * 60 * 60 * 1000;

const COPY_NAME = /^[a-f0-9]{64}\.rpf$/i;
/* С дефисами и без: прежнее правило знало только запись без дефисов, а помощник пишет с ними, и брошенные папки не уходили никогда. */
/* `.astral-create-…` — рабочая папка помощника при создании архива с нуля (подпакет `dlc<N>.rpf`, `tools/rpf-helper/Program.cs: CreateAsync`): обрыв оставлял её рядом со сборкой навсегда. */
const COMPOSE_DIRECTORY = /^\.astral-(?:compose|create)-[a-f0-9-]{32,36}$/i;
/* Недописанная сборка: `<имя>.stage`; при создании с нуля помощник требует имя на `.rpf`, поэтому стейдж там — `<имя>.stage.rpf` (`resource-composition.js`). Готовая сборка `<отпечаток>.rpf` под правило не подходит. */
const STAGE_NAME = /\.stage(?:\.rpf)?$/i;
const COMPOSE_REQUEST = /^\.astral-compose-request-[a-f0-9-]{32,36}\.json$/i;
/* Рабочие папки сборки и очистки основы (`resource-composition.js`, `direct-base-cleanup.js`, `archive-rebase.js`): обрыв оставлял их навсегда. */
const WORK_DIRECTORY = /^(?:\.without-astral-[0-9a-f-]{36}|\.work-[0-9a-f-]{36}|[a-f0-9]{64}\.rpf\.[0-9a-f-]{36}\.work)$/i;
const BASELINE_FIELDS = ["base", "compositionBase", "original", "clean", "pristine"];

const placeKey = (file) => path.resolve(String(file)).toLowerCase();

/*
 * Сменённые сборки update.rpf, которые стоит придержать (задача 8,
 * 05.10.2026): переключатель оптимизации или мод, снятый и поставленный
 * обратно, возвращает тот же отпечаток операций, и движок берёт готовую
 * сборку, а не собирает два гигабайта заново. Память — на жизнь процесса:
 * время записи файла не трогается, поэтому его запомненный отпечаток
 * (`file-fingerprint.js`) остаётся в силе. После перезапуска такие сборки
 * уходят обычной уборкой.
 */
const keptCopies = new Map();

/*
 * Сколько прежних сборок придерживать на одну цель (бета 14.10.2026, «Огромный
 * кеш»): человек нажал «Применить» около сорока раз за вечер, каждое меняло
 * сборку, и за полчаса придержанных набиралось десять–пятнадцать по 2,5 ГБ —
 * 26 ГБ в `payloads/_rpf-composites`. Переключатель «туда и обратно» нужен
 * для последней сменённой сборки, а не для всей истории получаса.
 */
export const KEEP_COMPOSITES_PER_TARGET = 1;

/**
 * Придержать места на `freshMs` (по умолчанию полчаса), не больше `limit`
 * свежих на папку (цель). Возвращает места, которые вытеснены из придержанных
 * этой записью: они больше не нужны и уходят той же уборкой, что сменённое.
 */
export function keepCopies(
  places,
  { now = Date.now(), freshMs = FRESH_COPY_MS, limit = KEEP_COMPOSITES_PER_TARGET } = {},
) {
  for (const place of places) {
    const key = placeKey(place);
    /* Новое придержанное — в конец: порядок `Map` и есть порядок свежести. */
    keptCopies.delete(key);
    keptCopies.set(key, now + freshMs);
  }
  const byFolder = new Map();
  for (const [key, until] of keptCopies) {
    if (until <= now) {
      keptCopies.delete(key);
      continue;
    }
    const folder = path.dirname(key);
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(key);
  }
  const released = [];
  for (const keys of byFolder.values())
    for (const key of keys.slice(0, Math.max(0, keys.length - limit))) {
      keptCopies.delete(key);
      released.push(key);
    }
  return released;
}

/** Для тестов: забыть все придержанные сборки. */
export function forgetKeptCopies() {
  keptCopies.clear();
}

const keptNow = (key, now) => {
  const until = keptCopies.get(key) || 0;
  if (until > now) return true;
  if (until) keptCopies.delete(key);
  return false;
};

/**
 * Файлы памяти, на которые ссылается состояние, — в виде ключей мест.
 * `root` — хранилище, которое убирается: путь прежнего корня (кэш перенесли,
 * а файл состояния ещё не переписан) держит и тот же файл под `root`
 * (`placesUnder`). Без этого уборка после переноса кэша на другой диск
 * стирала все хранилища модов и сборки на новом месте (бета 13.10.2026).
 */
export function referencedCopies(state, { root = null } = {}) {
  const places = new Set();
  const add = (file) => {
    if (typeof file !== "string" || !file) return;
    for (const place of placesUnder(file, root)) places.add(placeKey(place));
  };
  for (const target of Object.values(state?.targets || {})) {
    for (const resource of Object.values(target?.resources || {})) {
      for (const field of BASELINE_FIELDS) add(resource?.[field]?.path);
      for (const layer of resource?.layers || []) add(layer?.cachePath);
    }
    for (const archive of Object.values(target?.archives || {})) {
      add(archive?.lastBuilt?.cachePath);
      for (const entry of Object.values(archive?.entries || {}))
        for (const layer of entry?.layers || []) add(layer?.cachePath);
    }
    /* Файлы модов, снятых проверкой файлов игры, — для «Установить снова». */
    for (const file of parkedCachePaths(target)) add(file);
  }
  return places;
}

/** На что ссылалось прежнее состояние и больше не ссылается новое. */
export function supersededCopies(before, after) {
  const kept = referencedCopies(after);
  return [...referencedCopies(before)].filter((place) => !kept.has(place));
}

/*
 * Когда файл появился. Время правки одно не годится: `fs.copyFile` на
 * Windows переносит его с источника, и свежая копия основы выглядела бы
 * ровесницей живого архива. Время создания и смены записи — свои у копии.
 */
const touchedAt = (stat) =>
  Math.max(stat.mtimeMs || 0, stat.ctimeMs || 0, stat.birthtimeMs || 0);

/** Сколько весит место и когда в нём последний раз что-то появилось. */
export async function measureCachePlace(place) {
  let bytes = 0;
  let newest = 0;
  const pending = [place];
  while (pending.length) {
    const current = pending.pop();
    const stat = await fs.lstat(current).catch(() => null);
    if (!stat || stat.isSymbolicLink()) continue;
    newest = Math.max(newest, touchedAt(stat));
    if (!stat.isDirectory()) {
      bytes += stat.size;
      continue;
    }
    for (const name of await fs.readdir(current).catch(() => []))
      pending.push(path.join(current, name));
  }
  return { bytes, newest };
}

/*
 * Трогали ли место после `since` — до первой свежей записи, а не обходом
 * всего (задача 6 ТЗ 10.10.2026): у ступени текстур 42 тысячи файлов, и
 * уборка мерила их все при каждом запуске, чтобы узнать, что папка свежая.
 */
export async function touchedSince(place, since) {
  const pending = [place];
  while (pending.length) {
    const current = pending.pop();
    const stat = await fs.lstat(current).catch(() => null);
    if (!stat || stat.isSymbolicLink()) continue;
    if (touchedAt(stat) >= since) return true;
    if (!stat.isDirectory()) continue;
    for (const name of await fs.readdir(current).catch(() => []))
      pending.push(path.join(current, name));
  }
  return false;
}

/*
 * Удаление с повторами: антивирус и индексатор держат свежий двухгигабайтный
 * файл ещё несколько секунд. Не ушло — уйдёт при следующей уборке, а в
 * отчёт попадает с причиной: молча оставить гигабайты нельзя.
 */
export async function removeCachePlace(place, report, { dryRun = false } = {}) {
  /* Регулятор диска: уборка идёт место за местом и ждёт, пока диск горячее цели (`disk-governor.js`); без регулятора это ничего не стоит. */
  await governedPause(place);
  const { bytes } = await measureCachePlace(place);
  if (!dryRun) {
    try {
      await fs.rm(place, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 250,
      });
    } catch (error) {
      report.failed?.push({ path: place, bytes, code: error?.code || "" });
      return false;
    }
  }
  report.removed.push({ path: place, bytes });
  report.bytes += bytes;
  return true;
}

async function childDirectories(root) {
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(root, entry.name));
}

async function sweepCopies(directory, context) {
  const { referenced, superseded, now, freshMs, staleMs, report, dryRun } =
    context;
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const place = path.join(directory, entry.name);
    /* Опись копии кусками (`chunk-store.js`) живёт и уходит вместе с копией; её куски заберёт уборка кладовой. */
    if (entry.isFile() && entry.name.endsWith(PACKED_SUFFIX) && COPY_NAME.test(entry.name.slice(0, -PACKED_SUFFIX.length))) {
      const key = placeKey(place.slice(0, -PACKED_SUFFIX.length));
      if (referenced.has(key) || keptNow(key, now)) continue;
      if (!superseded.has(key)) {
        const stat = await fs.lstat(place).catch(() => null);
        if (!stat || now - touchedAt(stat) < freshMs) continue;
      }
      await removeCachePlace(place, report, { dryRun });
      continue;
    }
    if (entry.isFile() && COPY_NAME.test(entry.name)) {
      const key = placeKey(place);
      if (referenced.has(key) || keptNow(key, now)) continue;
      if (!superseded.has(key)) {
        const stat = await fs.lstat(place).catch(() => null);
        if (!stat || now - touchedAt(stat) < freshMs) continue;
      }
      await removeCachePlace(place, report, { dryRun });
      continue;
    }
    const leftover =
      (entry.isFile() && (STAGE_NAME.test(entry.name) || COMPOSE_REQUEST.test(entry.name))) ||
      (entry.isDirectory() && (COMPOSE_DIRECTORY.test(entry.name) || WORK_DIRECTORY.test(entry.name)));
    if (!leftover) continue;
    const { newest } = await measureCachePlace(place);
    if (now - newest >= staleMs)
      await removeCachePlace(place, report, { dryRun });
  }
}

/*
 * Хранилища модов (`payloads/<мод>`), на которые состояние больше не
 * ссылается (05.10.2026). Мод сменился новой версией или снят — его файлы
 * никому не нужны: сборка идёт из хранилищ стоящих модов, а к контрольным
 * точкам со старыми версиями окно не возвращает. Их никто не убирал: у
 * владельца лежало пять хранилищ растительности по гигабайту и десятки
 * прежних версий работ мастерской. Служебные папки (`_…`, `@…`) — не
 * хранилища модов, их убирает своё правило. Хранилище моложе получаса не
 * трогается: его может прямо сейчас наполнять установка.
 */
async function sweepStores(payloadsRoot, context) {
  const { referenced, now, freshMs, report, dryRun } = context;
  const root = path.resolve(payloadsRoot).toLowerCase();
  const stores = new Set();
  for (const place of referenced) {
    if (!place.startsWith(`${root}${path.sep}`)) continue;
    stores.add(place.slice(root.length + 1).split(path.sep)[0]);
  }
  const entries = await fs
    .readdir(payloadsRoot, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (/^[_@.]/.test(entry.name) || stores.has(entry.name.toLowerCase())) continue;
    const place = path.join(payloadsRoot, entry.name);
    const { newest } = await measureCachePlace(place);
    if (now - newest < freshMs) continue;
    await removeCachePlace(place, report, { dryRun });
  }
}

/*
 * Памяти сборщиков записей (задача 5 ТЗ 10.10.2026): `payloads/_awc-composites`,
 * `_timecycle-composites`, `_tracer-composites`… — готовый результат на
 * отпечаток входов, чтобы одинаковая пересборка не считалась дважды. Нужен
 * только последний: архив уже собран из него, а прежние отпечатки —
 * отменённые сочетания слоёв. Их никто не убирал. В каждой папке остаётся
 * самый свежий файл, прочие старше получаса уходят; понадобится снова —
 * соберётся.
 */
/* Те же памяти, названные иначе: ядро эффектов (`_ptfx-player-core`, у владельца 416 МБ, никто не убирал) и строки клипов. */
const ENTRY_MEMORY = /^_(?:.+-composites|ptfx-player-core(?:-without)?|clip-rows(?:-without)?)$/i;

async function sweepEntryMemories(payloadsRoot, context) {
  const { referenced, now, freshMs, staleMs, report, dryRun } = context;
  const roots = (await fs.readdir(payloadsRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && ENTRY_MEMORY.test(entry.name) && entry.name.toLowerCase() !== "_rpf-composites")
    .map((entry) => path.join(payloadsRoot, entry.name));
  const pending = [...roots];
  while (pending.length) {
    const directory = pending.pop();
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const place = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) pending.push(place);
        /* Рабочая папка сборщика, брошенная обрывом. */
        else if (now - (await measureCachePlace(place)).newest >= staleMs) await removeCachePlace(place, report, { dryRun });
        continue;
      }
      const stat = await fs.lstat(place).catch(() => null);
      if (stat?.isFile()) files.push({ place, at: touchedAt(stat) });
    }
    files.sort((a, b) => b.at - a.at);
    for (const { place, at } of files.slice(1))
      if (now - at >= freshMs && !referenced.has(placeKey(place))) await removeCachePlace(place, report, { dryRun });
  }
}

/*
 * Прежние виды записей (`bases/<цель>/entry-priors/<sha256>.bin`, 31.10.2026): основа
 * помнит их в `absorbed`, снимки контрольных точек — тоже. Основа сменилась, снимок
 * ушёл — файлы оставались: 3 тысячи файлов на 388 МБ у владельца. Файл, который не
 * называют ни состояние, ни его снимки, уходит.
 */
/*
 * Имена прежних видов в состоянии и его снимках ищутся кусками, с уступкой циклу событий (18.11.2026).
 *
 * Прежде всё шло одним синхронным заходом в главном потоке: состояние целиком в строку, каждый снимок контрольной точки —
 * `gunzipSync` и разбор десятков мегабайт текста. В журналах альфы это «Главный поток стоит 4,1 с; занят:
 * sweepEntryPriors» и следом «Главный процесс не отвечал 16,5 с» (13.11) и «12,1 с» (16.11): окно не отвечало, пока уборка
 * считала. Результат тот же; меняется только то, что между кусками поток свободен, а распаковка идёт вне его.
 */
const gunzipOffThread = promisify(gunzip);
const breathe = () => new Promise((resolve) => setImmediate(resolve));
const NAME_SLICE = 1024 * 1024;
/* Имя (`<64 знака>.bin`) может лечь на стык кусков: следующий кусок начинается на длину имени раньше. */
const NAME_OVERLAP = 68;

async function collectPriorNames(text, named) {
  const source = String(text ?? "");
  for (let from = 0; from < source.length; from += NAME_SLICE) {
    const piece = source.slice(Math.max(0, from - NAME_OVERLAP), from + NAME_SLICE);
    for (const match of piece.matchAll(/([a-f0-9]{64})\.bin/gi)) named.add(match[1].toLowerCase());
    await breathe();
  }
}

async function sweepEntryPriors(directory, state, { now, freshMs, report, dryRun }) {
  const names = await fs.readdir(directory).catch(() => []);
  if (!names.length) return;
  const named = new Set();
  const collect = (text) => collectPriorNames(text, named);
  /* Состояние — по частям цели, а не одной строкой на всё: у владельца оно 12 МБ текста. */
  for (const target of Object.values(state.targets || {}))
    for (const part of Object.values(target && typeof target === "object" ? target : {})) await collect(JSON.stringify(part) ?? "");
  for (const points of Object.values(state.restorePoints || {}))
    for (const point of Array.isArray(points) ? points : []) {
      if (point?.snapshot) await collect(typeof point.snapshot === "string" ? point.snapshot : JSON.stringify(point.snapshot));
      if (typeof point?.snapshotZ !== "string") continue;
      try {
        await collect((await gunzipOffThread(Buffer.from(point.snapshotZ, "base64"))).toString("utf8"));
      } catch {
        /* Снимок не прочитался — неизвестно, что он называет: уборка ждёт. */
        return;
      }
    }
  for (const name of names) {
    const match = /^([a-f0-9]{64})\.bin$/i.exec(name);
    if (!match || named.has(match[1].toLowerCase())) continue;
    const place = path.join(directory, name);
    const stat = await fs.lstat(place).catch(() => null);
    if (!stat?.isFile() || now - touchedAt(stat) < freshMs) continue;
    await removeCachePlace(place, report, { dryRun });
  }
}

async function readRawState(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Убирает из памяти движка копии update.rpf, на которые не ссылается
 * состояние. `superseded` — места, которые только что сменила транзакция:
 * они уходят без выдержки. Ничего не сериализует: зовётся из транзакции
 * (она уже внутри очереди движка) и из `tidyEngineCache`.
 */
export async function pruneEngineCache({
  stateDir = DEFAULT_DIR,
  superseded = [],
  now = Date.now(),
  freshMs = FRESH_COPY_MS,
  staleMs = STALE_WORK_MS,
  dryRun = false,
  /* Ссылки состояния, только что записанного транзакцией (`referencedCopies`
     от него же): тогда файл заново не разбирается. */
  referenced = null,
} = {}) {
  const paths = statePaths(stateDir);
  const report = { removed: [], failed: [], bytes: 0, skipped: null };
  const journals = await fs.readdir(paths.transactions).catch(() => []);
  if (journals.length) {
    report.skipped = "pending-transaction";
    return report;
  }
  const state = referenced ? null : await readRawState(paths.state);
  if (!referenced && (!state || !Object.keys(state.targets || {}).length)) {
    report.skipped = "no-state";
    return report;
  }
  const context = {
    referenced: referenced || referencedCopies(state, { root: paths.root }),
    superseded: new Set([...superseded].map(placeKey)),
    now,
    freshMs,
    staleMs,
    report,
    dryRun,
  };
  const targets = await childDirectories(paths.bases);
  const directories = [
    ...(await childDirectories(path.join(paths.payloads, "_rpf-composites"))),
    /* Сборки, что лежат на диске игры (`composite-home.js`): то же правило, что у сборок хранилища. */
    ...(await gameDiskCompositeDirectories({
      paths,
      gameRoots: Object.values(state?.targets || {}).map((target) => target?.gameRoot),
      referenced: [...context.referenced, ...context.superseded],
    })),
    ...targets.map((target) => path.join(target, "update-rebases")),
    /* Недописанные копии основ своих DLC и копии игры (задача 5 ТЗ
       10.10.2026: копии пишутся `.stage` рядом с местом) и забытые
       найденные основы `recovered/`. Именованные файлы основ (`*.original.rpf`,
       `*.composition.rpf`) под правило копий не подходят и не трогаются. */
    ...targets,
    ...(await Promise.all(targets.map((target) => childDirectories(target))))
      .flat()
      .filter((directory) => path.basename(directory).toLowerCase() !== "update-rebases"),
  ];
  for (const directory of directories) await sweepCopies(directory, context);
  await sweepStores(paths.payloads, context);
  await sweepEntryMemories(paths.payloads, context);
  /* Без разобранного состояния (зов из транзакции) прежних видов записей не перечесть. */
  if (state) for (const target of targets) await sweepEntryPriors(path.join(target, "entry-priors"), state, context);
  return report;
}

/** Та же уборка в очереди движка — для запуска приложения и ручного вызова. */
export function tidyEngineCache(options = {}) {
  return serializeMutation(async () => {
    const report = await pruneEngineCache(options);
    if (report.skipped) return report;
    const linked = await linkIdenticalBases(options);
    return { ...report, bytes: report.bytes + linked.bytes, linked: linked.linked, linkedBytes: linked.bytes };
  });
}

const sameInode = (a, b) => a.dev === b.dev && a.ino === b.ino && a.ino !== 0n;
const SHA_NAME = /^([a-f0-9]{64})\.rpf$/i;

/*
 * Одинаковые копии игры в основах — одной ссылкой (задача 5 ТЗ 10.10.2026).
 * Копия update.rpf с первой подготовки (`update-update.rpf.original.rpf`) и
 * основа после перебазирования (`update-rebases/<sha>.rpf`) часто одни и те
 * же байты: игра не менялась, а основа снята заново. У владельца это были два
 * одинаковых файла по 1,9 ГБ. Копии в кэш пишутся временным файлом и
 * переименованием (`copyFileCancellable`), на месте их никто не правит —
 * ссылки безопасны. Отпечаток копии считается, только если рядом лежит
 * основа того же размера, а после связывания — не считается вовсе: файл
 * уже один.
 */
export async function linkIdenticalBases({ stateDir = DEFAULT_DIR, dryRun = false } = {}) {
  const paths = statePaths(stateDir);
  const report = { linked: [], bytes: 0 };
  for (const targetDir of await childDirectories(paths.bases)) {
    const original = path.join(targetDir, PROTECTED_COPY);
    const originalStat = await fs.stat(original, { bigint: true }).catch(() => null);
    if (!originalStat?.isFile()) continue;
    const rebases = path.join(targetDir, "update-rebases");
    for (const name of await fs.readdir(rebases).catch(() => [])) {
      const match = SHA_NAME.exec(name);
      if (!match) continue;
      const file = path.join(rebases, name);
      const stat = await fs.stat(file, { bigint: true }).catch(() => null);
      if (!stat?.isFile() || stat.size !== originalStat.size || sameInode(stat, originalStat)) continue;
      if ((await fingerprintSha256(original).catch(() => "")) !== match[1].toLowerCase()) continue;
      if (dryRun) {
        report.linked.push(file);
        report.bytes += Number(stat.size);
        continue;
      }
      const stage = `${file}.${process.pid}.link.stage`;
      try {
        await fs.link(original, stage);
        await fs.rename(stage, file);
        report.linked.push(file);
        report.bytes += Number(stat.size);
      } catch {
        await fs.rm(stage, { force: true }).catch(() => {});
      }
      break;
    }
  }
  return report;
}
