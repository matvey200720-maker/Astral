/*
 * Чужие правки в сборке человека (задача 1 ТЗ 07.10.2026).
 *
 * У многих игроков к приходу Astral игра уже собрана: редукс через OpenIV,
 * свои таймциклы, чужая мини-карта. Astral кладёт свои записи поверх основы —
 * копии этой сборки, — и до сих пор молча закрывал ими файл чужого мода.
 * Теперь запись, которую пакет кладёт целиком, а в основе она не штатная
 * (опись штатных записей, `game-vanilla.js` в приложении), — вопрос
 * человеку: оставить своё или заменить. Решение помнится на запись
 * (`foreign-choices.json` рядом с состоянием — не в цели движка: первой
 * установке цели ещё нет), и второй раз Astral не спрашивает.
 *
 * Решения нет — установка отказывает `ForeignConflictError` до первой
 * записи в игру, а список спорных записей ложится в `foreign-conflicts.json`
 * рядом с состоянием: ошибка через окно Electron доходит одной строкой, и
 * окно берёт список отдельным вопросом (`readPendingForeignConflicts`).
 *
 * Спрашивается только то, что кладётся целиком: слои-правки (таймцикл по
 * модификаторам, метаданные звука, ядро эффектов…) встают поверх файла
 * человека, а не вместо него. Свои контейнеры `x64/astral` и реестры,
 * которые движок собирает сам, — не чужие по определению.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { ASTRAL_CONTAINER_ROOT } from "./astral-paths.js";
import { atomicJson, serializeMutation } from "./engine-state.js";
import { DEFAULT_DIR, statePaths } from "./storage-state.js";
import { ensureStoredFile } from "./chunk-store.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
import { checkedRecordKey, cleanId } from "./state-record.js";
import { nativeTouchedEntries, nativeTouchedWorks } from "./native-history.js";

export const FOREIGN_CONFLICTS_FILE = "foreign-conflicts.json";
export const FOREIGN_CHOICES_FILE = "foreign-choices.json";
export const FOREIGN_CONFLICT_CODE = "FOREIGN_CONFLICT";
/* Начало строки отказа: по нему окно узнаёт вопрос, даже когда Electron
   оставил от ошибки одно сообщение. */
export const FOREIGN_CONFLICT_PREFIX = "В твоей сборке уже изменены";
export const FOREIGN_CHOICES = Object.freeze(["keep", "replace"]);

const UPDATE_TARGET = "update/update.rpf";
/* Реестры, которые движок собирает сам поверх файла человека. */
const COMPOSED_REGISTRIES = new Set(["content.xml", "common/data/dlclist.xml"]);

let defaultDetector = null;

/**
 * Проверка записей основы приложением: `({ archivePath, archiveTarget,
 * baseSha256, entries, gameRoot, edition, stateDir, signal })` → `Map(запись →
 * "vanilla" | "foreign" | "absent" | "unknown")`. Без проверки — вопросов нет.
 */
export function setForeignDetector(detector) {
  if (detector != null && typeof detector !== "function")
    throw new TypeError("Проверка чужих правок должна быть функцией.");
  defaultDetector = detector || null;
}

export const resolveForeignDetector = (explicit) =>
  typeof explicit === "function" ? explicit : defaultDetector;

export class ForeignConflictError extends Error {
  constructor(conflicts, modId = "") {
    super(foreignConflictMessage(conflicts));
    this.name = "ForeignConflictError";
    this.code = FOREIGN_CONFLICT_CODE;
    this.conflicts = conflicts;
    this.modId = modId;
  }
}

const fileName = (entry) => String(entry).split("/").pop();

export function foreignConflictMessage(conflicts = []) {
  const names = [...new Set(conflicts.map((item) => fileName(item.entry)))];
  const shown =
    names.slice(0, 3).join(", ") + (names.length > 3 ? ` и ещё ${names.length - 3}` : "");
  return `${FOREIGN_CONFLICT_PREFIX} файлы игры, которые меняет эта работа (${shown}). Выбери: оставить своё или заменить.`;
}

/** Отказ — вопрос о чужих правках (по ошибке или по одной её строке). */
export const isForeignConflict = (error) =>
  error?.code === FOREIGN_CONFLICT_CODE ||
  String(error?.message || error || "").includes(FOREIGN_CONFLICT_PREFIX);

/**
 * Человек оставил своим всё, что кладёт эта работа, — ставить в игру нечего.
 * Это не поломка, а исход его ответа: окно сборки такую часть пропускает, а
 * остальные части ставятся (разбор 17.11.2026, `incident-2026-11-17-build-foreign-conflict.md`).
 * Окно узнаёт отказ по началу строки: через Electron от ошибки остаётся одна строка.
 */
export const FOREIGN_ALL_KEPT_CODE = "FOREIGN_ALL_KEPT";
export const FOREIGN_ALL_KEPT_PREFIX = "Всё, что меняет эта работа, ты решил оставить своим";

export class ForeignAllKeptError extends Error {
  constructor(modId = "") {
    super(`${FOREIGN_ALL_KEPT_PREFIX} — ставить в игру нечего.`);
    this.name = "ForeignAllKeptError";
    this.code = FOREIGN_ALL_KEPT_CODE;
    this.modId = modId;
  }
}

export const isForeignAllKept = (error) =>
  error?.code === FOREIGN_ALL_KEPT_CODE ||
  String(error?.message || error || "").includes(FOREIGN_ALL_KEPT_PREFIX);

const lower = (value) => String(value || "").toLowerCase();

/** Записи пакета, которые кладутся целиком поверх файла игры. */
export function wholesaleEntries(parsed) {
  if (parsed?.adapter !== "rpf-entry") return [];
  const out = [];
  for (const file of parsed.files || []) {
    if (!["replace", "upsert"].includes(file.action) || file.merge) continue;
    if (lower(file.target) !== UPDATE_TARGET) continue;
    const entry = lower(file.entry);
    if (!entry || COMPOSED_REGISTRIES.has(entry)) continue;
    if (entry === ASTRAL_CONTAINER_ROOT || entry.startsWith(`${ASTRAL_CONTAINER_ROOT}/`)) continue;
    /* Вложенный архив целиком (радар большой карты) опись не описывает: в ней
       только файлы внутри архивов. */
    if (entry.endsWith(".rpf")) continue;
    out.push({ archive: lower(file.target), entry: file.entry });
  }
  return out;
}

/**
 * Решение человека о записи: `"keep" | "replace" | null`. `choices` —
 * решения цели `{ архив: { запись: решение } }` (`loadForeignChoices`).
 */
export function foreignChoiceOf(choices, archive, entry) {
  const value = choices?.[lower(archive)]?.[lower(entry)];
  return FOREIGN_CHOICES.includes(value) ? value : null;
}

/**
 * Чужие правки, о которых человек ещё не сказал: записи пакета, которые
 * кладутся целиком, а в основе архива лежат не штатными. Проверка — по
 * основе (сборка человека без Astral), а не по живому архиву с нашими
 * записями.
 */
export async function findForeignConflicts({
  target,
  parsed,
  paths,
  /* Решённые записи не спрашиваются; `null` — спросить обо всех. */
  choices = null,
  detector = null,
  signal = null,
}) {
  const detect = resolveForeignDetector(detector);
  if (!detect) return [];
  /* Записи, которые правили работы мастерской нативным патчем (небо,
     таймцикл, капля следа, фонари), — правки Astral, а не чужого мода. */
  const ownNative = new Set(
    (await nativeTouchedEntries({ gameRoot: target.gameRoot })).map(lower),
  );
  /* Запись уже под слоем Astral — она его с прошлой установки: правка
     человека под ней сохранена в основе и вернётся со снятием. Спрашивается
     то, что Astral берёт впервые. */
  const layered = (item) =>
    Object.entries(target?.archives?.[item.archive]?.entries || {}).some(
      ([entry, record]) => lower(entry) === lower(item.entry) && (record?.layers || []).length > 0,
    );
  const wanted = wholesaleEntries(parsed).filter(
    (item) =>
      !ownNative.has(lower(item.entry)) &&
      !layered(item) &&
      !foreignChoiceOf(choices, item.archive, item.entry),
  );
  if (!wanted.length) return [];
  const byArchive = new Map();
  for (const item of wanted) {
    if (!byArchive.has(item.archive)) byArchive.set(item.archive, []);
    byArchive.get(item.archive).push(item.entry);
  }
  const conflicts = [];
  for (const [archive, entries] of byArchive) {
    const resource = target?.resources?.[archive] || target?.resources?.[UPDATE_TARGET];
    const base = resource?.compositionBase || resource?.base;
    let archivePath =
      base?.exists && base.path ? base.path : path.join(target.gameRoot, archive);
    let baseSha256 = base?.sha256 || null;
    let verdicts;
    try {
      /* Основа читается помощником по пути из состояния: за дни она остывает (куски и опись, файла нет) — вернуть до чтения, иначе проверка молча пропускалась и мод затирал правку человека (журнал тестера beta.109, 22.11.2026). */
      if (base?.exists && base.path && !(await ensureStoredFile(base.path, { signal }))) {
        /* Основы нет вовсе (ни файла, ни описи: чистка кэша) — по живому архиву, как при первой установке без основы. Здесь спрашиваются записи без слоя Astral, без нативных правок мастерской и не реестры (`wanted`):
           в живом архиве они такие же, как были бы в основе, а правка человека после последней сборки — именно то, о чём спрашивают. Отпечаток живого архива — ключ ответов проверки: отпечаток пропавшей основы к нему не относится. */
        archivePath = path.join(target.gameRoot, archive);
        baseSha256 = await fingerprintSha256(archivePath);
      }
      verdicts = await detect({
        archivePath,
        archiveTarget: archive,
        baseSha256,
        entries,
        gameRoot: target.gameRoot,
        edition: target.edition,
        stateDir: paths?.root || DEFAULT_DIR,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      /* Проверка — забота о сборке человека, а не условие установки: не
         вышло прочитать — ставится, как ставилось до неё. */
      console.warn(`[astral-engine] Чужие правки не проверены: ${error?.message || error}`);
      continue;
    }
    for (const entry of entries)
      if (verdicts?.get?.(entry) === "foreign" || verdicts?.get?.(lower(entry)) === "foreign")
        conflicts.push({ archive, entry });
  }
  return conflicts;
}

/**
 * Работы мастерской, которые закроет этот пакет: записи, которые он кладёт
 * целиком, а их уже правит нативная работа (небо — `w_*.xml`, мини-карта —
 * `minimap.gfx`). Мод каталога ложится поверх, и работа уходит «под мод»,
 * вернётся, когда мод снимут. Это правило «новый мод старше» (18.11.2026):
 * человека не спрашивают, а план только называет работы — окно показывает
 * их в строке установки. Сохранённые ответы «оставить работы»
 * (`foreign-choices.json`, прежний вопрос «Мод поверх работ») для работ
 * Astral больше не действуют — запись берёт мод. `[{ patch, entries }]`.
 */
export async function nativeWorksUnder({ target, parsed }) {
  if (!target?.gameRoot) return [];
  const wholesale = wholesaleEntries(parsed);
  if (!wholesale.length) return [];
  const out = [];
  for (const work of await nativeTouchedWorks({ gameRoot: target.gameRoot })) {
    const touched = new Set(work.entries.map(lower));
    const entries = wholesale.filter((item) => touched.has(lower(item.entry))).map((item) => item.entry);
    if (entries.length) out.push({ patch: work.patch, entries });
  }
  return out;
}

/**
 * Решение по пакету перед установкой: чужие записи, о которых человек не
 * сказал, — отказ `ForeignConflictError` (список — в `foreign-conflicts.json`);
 * иначе — проверка «эту запись человек оставил своей». Спрашиваются все
 * записи, и решённые: «оставить своё» значит что-то, только пока запись в
 * сборке чужая — убрал человек свой мод, и Astral её ставит.
 *
 * @returns {Promise<(file: {target: string, entry?: string}) => boolean>}
 */
export async function decideForeignEntries({
  target,
  parsed,
  paths,
  stateDir,
  targetKey,
  detector = null,
  signal = null,
}) {
  const foreignNow = await findForeignConflicts({ target, parsed, paths, detector, signal });
  const choices = foreignNow.length ? await loadForeignChoices({ stateDir, targetId: targetKey }) : {};
  const undecided = foreignNow.filter((item) => !foreignChoiceOf(choices, item.archive, item.entry));
  if (undecided.length) {
    await recordPendingForeignConflicts({ stateDir, targetId: targetKey, modId: parsed.id, conflicts: undecided });
    throw new ForeignConflictError(undecided, parsed.id);
  }
  const kept = new Set(
    foreignNow
      .filter((item) => foreignChoiceOf(choices, item.archive, item.entry) === "keep")
      .map((item) => `${item.archive}|${lower(item.entry)}`),
  );
  /* Работа мастерской на записи (нативный патч) — своя, не чужая: новый мод
     старше (18.11.2026), запись он берёт. Ответ «Оставить работы» прежнего
     вопроса, сохранённый в `foreign-choices.json`, здесь не читается; файл и
     ответы по чужим записям (выше) остаются как были. */
  const keeps = (file) => kept.size > 0 && kept.has(`${lower(file.target)}|${lower(file.entry)}`);
  if (kept.size && (parsed.files || []).every(keeps))
    throw new ForeignAllKeptError(parsed.id);
  return keeps;
}

const conflictsFile = (stateDir) =>
  path.join(statePaths(stateDir).root, FOREIGN_CONFLICTS_FILE);
const choicesFile = (stateDir) =>
  path.join(statePaths(stateDir).root, FOREIGN_CHOICES_FILE);

async function readChoicesFile(stateDir) {
  try {
    const parsed = JSON.parse(await fs.readFile(choicesFile(stateDir), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Решения цели: `{ архив: { запись: "keep" | "replace" } }`. */
export async function loadForeignChoices({ stateDir = DEFAULT_DIR, targetId } = {}) {
  const all = await readChoicesFile(stateDir);
  const own = all[cleanId(targetId) || "default"];
  return own && typeof own === "object" ? own : {};
}

/** Список спорных записей последнего отказа — для вопроса в окне. */
export async function recordPendingForeignConflicts({
  stateDir = DEFAULT_DIR,
  targetId,
  modId,
  conflicts,
}) {
  await atomicJson(conflictsFile(stateDir), {
    targetId: cleanId(targetId) || "default",
    modId: String(modId || ""),
    conflicts: conflicts.map((item) => ({ archive: lower(item.archive), entry: String(item.entry) })),
    at: new Date().toISOString(),
  });
}

/** Спорные записи последнего отказа или `null`. */
export async function readPendingForeignConflicts({ stateDir = DEFAULT_DIR } = {}) {
  try {
    const parsed = JSON.parse(await fs.readFile(conflictsFile(stateDir), "utf8"));
    if (!Array.isArray(parsed?.conflicts)) return null;
    return {
      targetId: String(parsed.targetId || "default"),
      modId: String(parsed.modId || ""),
      conflicts: parsed.conflicts
        .filter((item) => item && typeof item.entry === "string")
        .map((item) => ({ archive: lower(item.archive || UPDATE_TARGET), entry: item.entry })),
      at: String(parsed.at || ""),
    };
  } catch {
    return null;
  }
}

/**
 * Запомнить решения человека: `choices` — `[{ archive, entry, choice }]`,
 * `choice` — `"keep"` (оставить своё) или `"replace"` (заменить).
 * Решённые записи уходят из списка спорных.
 */
export function setForeignChoices({ stateDir = DEFAULT_DIR, targetId, choices = [] }) {
  return serializeMutation(async () => {
    const targetKey = cleanId(targetId) || "default";
    checkedRecordKey(targetKey, "Target ID");
    const all = await readChoicesFile(stateDir);
    const own = all[targetKey] && typeof all[targetKey] === "object" ? all[targetKey] : {};
    const decided = new Set();
    for (const item of Array.isArray(choices) ? choices : []) {
      if (!FOREIGN_CHOICES.includes(item?.choice) || typeof item?.entry !== "string") continue;
      const archive = lower(item.archive || UPDATE_TARGET);
      const entry = lower(item.entry);
      if (!entry || entry.includes("..")) continue;
      own[archive] ||= {};
      own[archive][entry] = item.choice;
      decided.add(`${archive}|${entry}`);
    }
    all[targetKey] = own;
    await atomicJson(choicesFile(stateDir), all);
    const pending = await readPendingForeignConflicts({ stateDir });
    if (pending) {
      const left = pending.conflicts.filter(
        (item) => !decided.has(`${item.archive}|${lower(item.entry)}`),
      );
      if (left.length) await recordPendingForeignConflicts({ stateDir, ...pending, conflicts: left });
      else await fs.rm(conflictsFile(stateDir), { force: true });
    }
    return { targetId: targetKey, foreignChoices: structuredClone(own) };
  });
}

/** Все решения цели (то же, что `loadForeignChoices`, копией). */
export async function getForeignChoices({ stateDir = DEFAULT_DIR, targetId } = {}) {
  return structuredClone(await loadForeignChoices({ stateDir, targetId }));
}

/** Забыть решения цели — Astral снова спросит («Спросить заново»). */
export function forgetForeignChoices({ stateDir = DEFAULT_DIR, targetId } = {}) {
  return serializeMutation(async () => {
    const all = await readChoicesFile(stateDir);
    delete all[cleanId(targetId) || "default"];
    await atomicJson(choicesFile(stateDir), all);
    return true;
  });
}
