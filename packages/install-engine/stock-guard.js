/*
 * Компонент «целиком» и обновление игры (А10, шаг 3; решения ведущей 11.11.2026).
 *
 * Слой, который кладёт запись `update.rpf` целиком (`replace`/`upsert`/`import` файлом мода, без `merge`), не знал, поверх чего он собран. После
 * обновления игры у записи мог измениться штатный файл Rockstar, и движок клал старый файл мода поверх нового штатного — игра брала устаревшие
 * данные (таблицы, списки) и падала. Теперь:
 *
 *  1. При установке у такого слоя запоминается отпечаток штатной записи под ним — `layer.stock = { sha256 }` (`null` — записи в основе не было).
 *     Основа — `compositionBase` цели; отпечаток — `entryContentHash` (тот же, что у библиотеки штатных версий и разбора редукса).
 *  2. При принятии обновления игры (`direct-update-rebase.js`, пока прежняя основа ещё на диске) каждый слой «целиком» сверяется с новой основой:
 *     у слоя с отпечатком — по нему; у слоя без него (поставлен до этого изменения) — по записи в прежней основе. Запись изменилась, исчезла или
 *     появилась (раньше не было, теперь штатная есть) — мод «ждёт новой версии»: его слои не накладываются на новую основу, мод уходит в «снятые»
 *     с причиной `waiting-for-version` (`parked-mods.js`), список записей — в `resource.adoptedUpdate.stockChanged`, событие — в журнал цели.
 *     Прежней основы на диске нет и отпечатка у слоя нет — слой кладётся, как раньше, и об этом сказано в журнале (`stock-unchecked`).
 *
 * Слои-патчи (`merge`), записи нашего контейнера `x64/astral/`, реестры (`content.xml`, `dlclist.xml`) и целые вложенные архивы (`*.rpf`) не проверяются:
 * патчи движок сам кладёт поверх новой основы по именам, контейнеры игре обновление не меняет, реестры собирает он же.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { entryContentHash } from "@modovik/rpf-inspector/baseline";
import { ASTRAL_CONTAINER_ROOT } from "./astral-paths.js";
import { ensureStoredFile } from "./chunk-store.js";
import { resolveBaseTools } from "./direct-base-cleanup.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
import { resolveInside } from "./manifest.js";
import { ownRecordValue } from "./state-record.js";

export const UPDATE_ARCHIVE = "update/update.rpf";
/** Причина «снятого» мода, которому после обновления игры нужна новая версия. */
export const WAITING_FOR_VERSION = "waiting-for-version";
/** Код отказа: в пакете для ждущего компонента тот же файл, что был до обновления игры. */
export const WAITING_SAME_VERSION = "waiting-same-version";
const RSC7 = 0x37435352;
/* Файлы такого размера сверяются и по содержимому (другое сжатие тех же данных); больше — только по sha256 файла. */
const CONTENT_COMPARE_LIMIT = 128 * 1024 * 1024;
const RELEASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* Реестры, которые движок собирает сам поверх основы. */
const COMPOSED_REGISTRIES = new Set(["content.xml", "common/data/dlclist.xml"]);
const WHOLE_ACTIONS = new Set(["replace", "upsert", "import"]);
/* Столько записей помощнику за один вызов: сотни путей в одной команде — это и скорость, и предел командной строки. */
const BATCH = 400;

const lower = (value) => String(value || "").toLowerCase();
/*
 * Основа, остывшая за дни (`chunk-store.js`), — не «нет основы» (журнал тестера beta.109, 22.11.2026): проверка собирает её из кусков. Свой `exists`, а не общий из `storage-state.js` (его берут ещё 19 файлов, сигнатуру не трогаем): сборке
 * до ~2 ГБ нужна отмена — `signal` установки и принятия обновления игры прерывает её.
 */
const exists = (file, signal = null) => ensureStoredFile(file, { signal });
/** Слой кладёт запись целиком и её штатный файл есть смысл помнить. */
export function isWholeLayer(entry, layer) {
  if (!layer || layer.merge || layer.astralContent === true) return false;
  if (!WHOLE_ACTIONS.has(layer.action)) return false;
  const key = lower(entry).replaceAll("\\", "/");
  if (!key || key.endsWith(".rpf") || COMPOSED_REGISTRIES.has(key)) return false;
  return key !== ASTRAL_CONTAINER_ROOT && !key.startsWith(`${ASTRAL_CONTAINER_ROOT}/`);
}

/**
 * Отпечатки записей архива `archivePath` помощником RPF: `Map(запись строчными → sha256 | null)`; `null` — записи в архиве нет. Читает файлы записей
 * в рабочую папку и сразу удаляет её.
 */
export async function fingerprintEntries({ archivePath, archiveTarget = UPDATE_ARCHIVE, entries, tools, gameRoot, edition, stateDir, signal }) {
  const out = new Map();
  const wanted = [...new Set(entries.map(lower))];
  if (!wanted.length) return out;
  const work = path.join(stateDir || os.tmpdir(), "stock-guard", randomUUID());
  const request = { archivePath, archiveTarget, gameRoot, edition, signal };
  try {
    for (let from = 0; from < wanted.length; from += BATCH) {
      const part = wanted.slice(from, from + BATCH);
      const present = new Set([...(await tools.entryProbe({ ...request, entries: part }))].map(lower));
      const found = part.filter((entry) => present.has(entry));
      for (const entry of part) if (!present.has(entry)) out.set(entry, null);
      if (!found.length) continue;
      const extracted = await tools.entryReader({ ...request, entries: found, outputDirectory: path.join(work, randomUUID()) });
      for (const item of extracted || []) {
        const bytes = await fs.readFile(item.file);
        const resource = bytes.length >= 16 && bytes.readUInt32LE(0) === RSC7;
        out.set(lower(item.entry), entryContentHash(bytes, { resource }));
      }
      for (const entry of found) if (!out.has(entry)) out.set(entry, null);
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
  return out;
}

/** Слои «целиком» цели в архиве: `[{ modId, entry, key, layer }]` — все слои записи, не только верхний (на записи могут лежать слои нескольких модов). */
export function wholeLayers(target, archiveTarget = UPDATE_ARCHIVE) {
  const out = [];
  for (const [entry, state] of Object.entries(target?.archives?.[archiveTarget]?.entries || {}))
    for (const layer of state?.layers || [])
      if (layer?.modId && !String(layer.modId).startsWith("@") && isWholeLayer(entry, layer)) out.push({ modId: layer.modId, entry, key: lower(entry), layer });
  return out;
}

/**
 * То же у модов, уже ушедших в «снятые» (`target.parked`): обновление игры, которое вернуло штатный архив, переносит все моды в «снятые» ещё до этой
 * сверки, а «Установить снова» положило бы их слои на новую основу. Моды, которые уже ждут новой версии, не считаются.
 */
export function parkedWholeLayers(target, archiveTarget = UPDATE_ARCHIVE) {
  const out = [];
  for (const item of Array.isArray(target?.parked) ? target.parked : []) {
    if (item?.reason === WAITING_FOR_VERSION) continue;
    for (const { archive, entry, layers } of item.entries || [])
      if (lower(archive) === lower(archiveTarget))
        for (const layer of layers || [])
          if (layer?.modId === item.modId && isWholeLayer(entry, layer)) out.push({ modId: item.modId, entry, key: lower(entry), layer, parked: true });
  }
  return out;
}

/**
 * Запомнить штатные записи под слоями мода `modId`, которые он только что положил целиком. Вызывается после укладки слоёв; основа — `compositionBase`
 * архива. Нет основы, помощника или чтение не вышло — слои без отпечатка (так было до этого изменения), установка не отказывает.
 * Возвращает число слоёв с отпечатком.
 */
export async function recordStockUnderLayers({ target, modId, archiveTarget = UPDATE_ARCHIVE, stateDir, tools = resolveBaseTools(), signal = null }) {
  const own = wholeLayers(target, archiveTarget).filter((item) => item.modId === modId && !item.layer.stock);
  if (!own.length || !tools) return 0;
  const base = target.resources?.[archiveTarget]?.compositionBase;
  if (!base?.exists || !base.path) return 0;
  let prints;
  try {
    /* Сборка основы из кусков — внутри `try`: её отказ (нехватка места, EPERM) не роняет установку раньше сборки, а отмена пробрасывается. */
    if (!(await exists(base.path, signal))) return 0;
    prints = await fingerprintEntries({ archivePath: base.path, archiveTarget, entries: own.map((item) => item.entry), tools, gameRoot: target.gameRoot, edition: target.edition, stateDir, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(`[astral-engine] Штатные записи под слоями не запомнены: ${error?.message || error}`);
    return 0;
  }
  /* Запись, которую основа вобрала нашей же нативной правкой (работа мастерской на той же записи), в основе уже не штатная: штатный вид — `prior` этого шага. */
  const priors = await ownAbsorbedPriors(base, own.map((item) => item.key));
  let recorded = 0;
  for (const item of own) {
    if (!prints.has(item.key)) continue;
    item.layer.stock = { sha256: priors.has(item.key) ? priors.get(item.key) : prints.get(item.key) };
    recorded += 1;
  }
  return recorded;
}

/**
 * Штатный вид записей, которые основа вобрала нашей нативной правкой: `Map(запись строчными → sha256 | null)`; `null` — до правки записи не было. Берётся верхний шаг
 * стопки `absorbed`, если он помечен `own` (правка наша, а не новой версии игры: у вобранного обновлением игры `prior` — вид прежней версии, штатным он не служит).
 * Не прочитался файл `prior` — записи в ответе нет, и вызывающий берёт файл основы.
 */
async function ownAbsorbedPriors(base, keys) {
  const out = new Map();
  const stacks = new Map(Object.entries(base?.absorbed || {}).map(([entry, stack]) => [lower(entry), stack]));
  for (const key of keys) {
    const top = stacks.get(key)?.at(-1);
    if (top?.own !== true) continue;
    if (top.prior?.absent === true) {
      out.set(key, null);
      continue;
    }
    try {
      const bytes = await fs.readFile(top.prior.path);
      out.set(key, entryContentHash(bytes, { resource: bytes.length >= 16 && bytes.readUInt32LE(0) === RSC7 }));
    } catch {
      /* файла `prior` нет — отпечаток по основе */
    }
  }
  return out;
}

/**
 * Сверка слоёв «целиком» с новой основой при принятии обновления игры. `previous` — прежняя основа (`compositionBase` до перебазирования), `baseline` —
 * новая. Ответ: `{ changed: [{ modId, entry, was, now, from }], unchecked: [{ modId, entry }], modIds }`. `from` — откуда `was`: `"layer"` (отпечаток при
 * установке) или `"previous-base"` (запись в прежней основе).
 */
export async function stockChangedLayers({ target, archiveTarget = UPDATE_ARCHIVE, previous, baseline, stateDir, tools = resolveBaseTools(), signal = null }) {
  const result = { changed: [], unchecked: [], modIds: [] };
  const layers = [...wholeLayers(target, archiveTarget), ...parkedWholeLayers(target, archiveTarget)];
  if (!layers.length || !tools || !baseline?.path || !(await exists(baseline.path, signal))) return result;
  const common = { archiveTarget, tools, gameRoot: target.gameRoot, edition: target.edition, stateDir, signal };
  const now = await fingerprintEntries({ ...common, archivePath: baseline.path, entries: layers.map((item) => item.entry) });
  /* Без отпечатка при установке — по записи в прежней основе, пока она на диске. */
  const bare = layers.filter((item) => item.layer.stock === undefined);
  const oldBase = previous?.exists && previous.path && (await exists(previous.path, signal)) ? previous.path : null;
  const was = oldBase && bare.length ? await fingerprintEntries({ ...common, archivePath: oldBase, entries: bare.map((item) => item.entry) }) : new Map();
  for (const item of layers) {
    const stock = item.layer.stock;
    const before = stock ? (stock.sha256 ?? null) : was.has(item.key) ? was.get(item.key) : undefined;
    if (before === undefined) {
      result.unchecked.push({ modId: item.modId, entry: item.entry });
      continue;
    }
    const after = now.has(item.key) ? now.get(item.key) : null;
    if (before !== after) result.changed.push({ modId: item.modId, entry: item.entry, was: before, now: after, from: stock ? "layer" : "previous-base", ...(item.parked ? { parked: true } : {}) });
  }
  result.modIds = [...new Set(result.changed.map((item) => item.modId))];
  return result;
}

/**
 * Отказ установки: компонент ждёт новой версии (Rockstar изменили штатный файл под ним), а пакет несёт тот же файл целиком, что лежал до обновления игры.
 * Текст русский и с кодом: через IPC окну доезжает одно сообщение, `waiting-same-version` по нему узнаётся (`utils/installFailure.js`).
 */
export class WaitingSameVersionError extends Error {
  constructor({ modId, entries = [], releaseId = "" }) {
    super(
      `Компонент ${modId} ждёт новой версии (${WAITING_SAME_VERSION}): в пакете тот же файл, что был до обновления игры (${entries.join(", ")}), а Rockstar изменили штатный файл под ним. ` +
        "Старая версия поверх нового файла игры не ляжет. В игру ничего не записано.",
    );
    this.name = "WaitingSameVersionError";
    this.code = WAITING_SAME_VERSION;
    this.modId = modId;
    this.entries = entries;
    this.releaseId = releaseId;
  }
}

/** Релиз мода каталога из происхождения установки — только в форме идентификатора, иначе пусто. */
export const releaseOf = (origin) => (RELEASE_ID.test(String(origin?.releaseId || "")) ? String(origin.releaseId).toLowerCase() : "");

/* Тот же файл: sha256 совпал, а при другом — совпало содержимое (перепаковка с другим сжатием его не меняет; у ресурса — версия и флаги страниц и распакованное тело). */
async function sameLayerFile(oldLayer, newPath, newSha256) {
  if (oldLayer?.sha256 && oldLayer.sha256 === newSha256) return true;
  if (!oldLayer?.cachePath) return false;
  try {
    const [oldStat, newStat] = await Promise.all([fs.stat(oldLayer.cachePath), fs.stat(newPath)]);
    if (Math.max(oldStat.size, newStat.size) > CONTENT_COMPARE_LIMIT) return false;
    const [oldBytes, newBytes] = await Promise.all([fs.readFile(oldLayer.cachePath), fs.readFile(newPath)]);
    const resource = (bytes) => bytes.length >= 16 && bytes.readUInt32LE(0) === RSC7;
    return entryContentHash(oldBytes, { resource: resource(oldBytes) }) === entryContentHash(newBytes, { resource: resource(newBytes) });
  } catch {
    return false;
  }
}

/**
 * Заслон установки (А10, решение ведущей 11.11.2026): мод ждёт новой версии, а пакет, который ставят, несёт на ждущей записи тот же файл целиком, что и снятый слой.
 * Так бывает, пока склад не пересобрал пакет под новую игру: каталог отдаёт прежний файл под новым номером релиза, и «Обновить» положило бы его поверх нового штатного.
 * Пакет, где запись стала слоем-патчем (`merge`), удалена или несёт другой файл, проходит (запись «снятых» уходит как обычно). Вызывается до любой записи в состояние
 * и в игру; отказ — `WaitingSameVersionError`.
 */
export async function assertNotWaitingSameVersion({ target, parsed, sourceRoot, origin = null, archiveTarget = UPDATE_ARCHIVE }) {
  if (parsed?.adapter !== "rpf-entry") return;
  const item = (Array.isArray(target?.parked) ? target.parked : []).find((row) => row?.modId === parsed.id && row.reason === WAITING_FOR_VERSION);
  const waiting = new Set((item?.waiting || []).map((row) => lower(row?.entry)).filter(Boolean));
  if (!waiting.size) return;
  const astralContent = parsed.capabilities?.includes("astral-content-rpf-v1") === true;
  const same = [];
  for (const file of parsed.files || []) {
    const key = lower(file.entry);
    if (!waiting.has(key) || lower(file.target) !== lower(archiveTarget)) continue;
    if (!isWholeLayer(file.entry, { action: file.action, merge: file.merge, ...(astralContent ? { astralContent: true } : {}) })) continue;
    /* Прежний слой этой записи — тот, что снят вместе с модом. */
    const before = (item.entries || [])
      .filter((row) => lower(row?.archive) === lower(archiveTarget) && lower(row?.entry) === key)
      .flatMap((row) => row.layers || [])
      .filter((layer) => layer?.modId === parsed.id && isWholeLayer(file.entry, layer))
      .at(-1);
    if (!before) continue;
    const newPath = resolveInside(sourceRoot, file.source);
    if (await sameLayerFile(before, newPath, await fingerprintSha256(newPath))) same.push(file.entry);
  }
  if (same.length) throw new WaitingSameVersionError({ modId: parsed.id, entries: same, releaseId: releaseOf(origin) });
}

/**
 * Отказ записывается в снятую запись: `refusedRelease` — релиз каталога, которому отказали. Окно по нему знает, что в каталоге пока прежняя версия, и ждёт другого
 * релиза. Состояние читается заново: установка, которой отказали, своей копии не сохраняла. Нет записи в сохранённом состоянии (ждущей её сделало это же обращение)
 * или релиза у пакета — ничего не пишется. Ответ: изменилось ли состояние.
 */
export function rememberRefusedRelease(state, { targetKey, modId, releaseId }) {
  if (!releaseId) return false;
  const item = (ownRecordValue(state?.targets || {}, targetKey)?.parked || []).find((row) => row?.modId === modId && row.reason === WAITING_FOR_VERSION);
  if (!item || item.refusedRelease === releaseId) return false;
  item.refusedRelease = releaseId;
  return true;
}
