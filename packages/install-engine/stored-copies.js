/*
 * Основы и сборки движка — в общую кладовую кусков (31.10.2026, `chunk-store.js`).
 *
 * Состояние движка ссылается на копии архивов игры: основа, поверх которой
 * соберётся следующая установка (`compositionBase`), игра до Astral (`pristine`,
 * `original`), сборка, что лежит сейчас в игре (`lastBuilt`). Каждая — файл на
 * гигабайты, а отличаются они на мегабайты. Здесь такие файлы уходят в куски, когда
 * ими какое-то время не пользовались; пути в состоянии остаются прежними, а файл
 * собирается обратно при первом обращении (`ensureStoredFile`, `exists` в
 * `storage-state.js`).
 *
 * Обратная разница (01.11.2026): якорь кладовой теперь — живые архивы игры
 * (`settleLiveAnchors`), а чистый оригинал `update-update.rpf.original.rpf` уходит в
 * куски, как только такой якорь встал (`packProtectedOriginals`). На диске остаются
 * куски, которых в игре уже нет. Якорь не встал (FAT, нет прав) — оригинал остаётся
 * файлом и якорем, как было.
 *
 * Не упаковываются:
 *   • файлы меньше `STORED_MIN_BYTES`: выгоды нет, а читателей больше;
 *   • свои DLC Astral, лежащие в игре ссылкой на сборку: они и так места не занимают;
 *   • тронутое за последние `HOT_COPY_MS`: человек работает, основа нужна снова.
 *
 * Обрыв на любом шаге оставляет целый файл: опись пишется после сверки, файл
 * уходит в очереди движка и только если состояние всё ещё называет этот файл с
 * этим отпечатком.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_DIR, statePaths } from "./storage-state.js";
import { appendChainStands } from "./append-item.js";
import { readState, readStateShared, serializeMutation, writeState } from "./engine-state.js";
import {
  CHUNKS_FOLDER,
  dropStoredFile,
  ensureAnchor,
  ensureLiveAnchor,
  liveAnchorRefused,
  loadAnchors,
  packFile,
  packGaveUp,
  readPackedManifest,
  rememberLiveArchives,
  retireAnchors,
  storedFileSize,
  storedUseAt,
} from "./chunk-store.js";
import { PROTECTED_UPDATE_COPY } from "./direct-base-cleanup.js";
import { isProtectedOriginalName } from "./carrier-targets.js";
import { noteDiskPlaces } from "./disk-profile.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
import { resolveInside } from "./manifest.js";

export const STORED_MIN_BYTES = 16 * 1024 * 1024;
export const HOT_COPY_MS = 30 * 60 * 1000;
const BASELINE_FIELDS = ["base", "compositionBase", "original", "clean", "pristine"];
const OWN_DLC_ARCHIVE = /^update\/x64\/dlcpacks\/astral_[a-z0-9_]+\/dlc\.rpf$/;
const placeKey = (file) => path.resolve(String(file)).toLowerCase();
const HASH = /^[a-f0-9]{64}$/;

export const copyStoreRoot = (stateDir = DEFAULT_DIR) => path.join(statePaths(stateDir).root, "native-rpf", CHUNKS_FOLDER);

const inside = (parent, child) => {
  const relative = path.relative(parent, path.resolve(child));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
};

/**
 * Копии, которые называет состояние: `Map(ключ места → { path, sha256, archive })`.
 * Файл, у которого в состоянии два разных отпечатка, — не копия для кладовой:
 * непонятно, что он такое, и он остаётся как есть.
 */
export function referencedStoreCopies(state, stateDir = DEFAULT_DIR) {
  const paths = statePaths(stateDir);
  const composites = path.join(paths.payloads, "_rpf-composites");
  const found = new Map();
  const add = (file, sha256, archive) => {
    if (typeof file !== "string" || !file || !/\.rpf$/i.test(file)) return;
    if (!inside(paths.bases, file) && !inside(composites, file)) return;
    /* Защищённый оригинал update.rpf и носителя (`update2.rpf`) в кладовую не пакуется: это откат к штатному. */
    if (isProtectedOriginalName(path.basename(file))) return;
    const hash = String(sha256 || "").toLowerCase();
    const key = placeKey(file);
    const known = found.get(key);
    if (known && known.sha256 !== hash) {
      known.conflict = true;
      return;
    }
    if (!known) found.set(key, { path: file, sha256: hash, archive: String(archive).toLowerCase() });
  };
  for (const target of Object.values(state?.targets || {})) {
    for (const [archive, resource] of Object.entries(target?.resources || {})) {
      for (const field of BASELINE_FIELDS) {
        const base = resource?.[field];
        if (base?.exists) add(base.path, base.sha256, archive);
      }
      for (const layer of resource?.layers || []) add(layer?.cachePath, layer?.sha256, archive);
    }
    for (const [archive, record] of Object.entries(target?.archives || {}))
      if (record?.lastBuilt?.cachePath) add(record.lastBuilt.cachePath, record.lastBuilt.sha256, archive);
  }
  return found;
}

const touchedAt = (stat) => Math.max(stat.mtimeMs || 0, stat.ctimeMs || 0, stat.birthtimeMs || 0);

async function candidates(state, stateDir, now, hotMs, minBytes = STORED_MIN_BYTES) {
  const list = [];
  for (const copy of referencedStoreCopies(state, stateDir).values()) {
    if (copy.conflict || !HASH.test(copy.sha256) || packGaveUp(copy.path)) continue;
    const stat = await fs.stat(copy.path).catch(() => null);
    if (!stat?.isFile() || stat.size < minBytes) continue;
    /* Сборка своего DLC, лежащая в игре ссылкой, места не занимает. */
    if (stat.nlink > 1 && OWN_DLC_ARCHIVE.test(copy.archive)) continue;
    if (now - Math.max(touchedAt(stat), storedUseAt(copy.path)) < hotMs) {
      list.hot = (list.hot || 0) + 1;
      continue;
    }
    list.push({ ...copy, size: stat.size });
  }
  /* Сначала сборки (их дольше всего не спросят), потом основы; крупные — раньше. */
  const rank = (item) => (/_rpf-composites/i.test(item.path) ? 0 : 1);
  list.sort((left, right) => rank(left) - rank(right) || right.size - left.size);
  return list;
}

/** Сколько копий движка ждут кладовой (`stat`, без чтения); `hot` — ждут, пока остынут. */
export async function pendingEngineCopies({ stateDir = DEFAULT_DIR, now = Date.now(), hotMs = HOT_COPY_MS, minBytes = STORED_MIN_BYTES } = {}) {
  const state = await readStateShared(stateDir).catch(() => null);
  if (!state) return { pending: 0, hot: 0 };
  const list = await candidates(state, stateDir, now, hotMs, minBytes);
  return { pending: list.length, hot: list.hot || 0 };
}

/**
 * Якорь кладовой: чистый оригинал update.rpf каждой игры (`ensureAnchor`).
 * Ответ — множество отпечатков живых якорей.
 */
export async function ensureCopyAnchors({ stateDir = DEFAULT_DIR, isBusy = () => false, pace = null } = {}) {
  const paths = statePaths(stateDir);
  const inUse = new Set();
  const entries = await fs.readdir(paths.bases, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (isBusy()) return { inUse, skipped: "busy" };
    const source = path.join(paths.bases, entry.name, PROTECTED_UPDATE_COPY);
    /* Оригинал уже кусками (его собрали на время): якорем он не станет, а файл уйдёт по старой описи, без чтения. */
    if (await readPackedManifest(source)) continue;
    const anchor = await ensureAnchor({
      chunksRoot: copyStoreRoot(stateDir),
      source,
      isBusy,
      pace,
    }).catch((error) => {
      console.warn(`[astral-engine] Якорь кладовой не встал: ${error?.message || error}`);
      return null;
    });
    if (anchor?.busy) return { inUse, skipped: "busy" };
    if (anchor?.sha256) inUse.add(anchor.sha256);
  }
  return { inUse, skipped: null };
}

/* Папка якорей рядом с игрой (кэш на другом томе): без расширения архива, игра и загрузчики модов её не читают. */
export const LIVE_ANCHOR_FOLDER = ".astral-anchors";

/* Живые архивы игры, копии которых держит Astral. Свои DLC лежат в игре ссылкой на сборку, у них другой путь. */
function liveArchivesOf(state) {
  const found = [];
  for (const [targetKey, target] of Object.entries(state?.targets || {})) {
    if (!target?.gameRoot) continue;
    for (const [archive, resource] of Object.entries(target.resources || {})) {
      const name = archive.toLowerCase();
      if (!name.endsWith(".rpf") || OWN_DLC_ARCHIVE.test(name) || resource?.persistentManaged) continue;
      try {
        found.push({ targetKey, archive: name, path: resolveInside(target.gameRoot, archive), homeInGame: path.join(target.gameRoot, LIVE_ANCHOR_FOLDER) });
      } catch {
        /* Путь не из папки игры: такой архив не наш. */
      }
    }
  }
  return found;
}

const inodeKey = (stat) => `${stat.dev}:${stat.ino}`;

/* Сколько живой архив должен пролежать без перемен, прежде чем его нарежут. */
export const LIVE_SETTLE_MS = 10 * 60 * 1000;

/* Этот файл уже под якорем: ни чтения, ни ожидания. */
async function sameLiveAnchor(chunksRoot, stat) {
  for (const anchor of (await loadAnchors(chunksRoot)).list) {
    if (anchor.suspect) continue;
    const held = await fs.stat(anchor.file, { bigint: true }).catch(() => null);
    if (held && inodeKey(held) === inodeKey(stat)) return true;
  }
  return false;
}

/**
 * Живые якоря: у каждого большого архива игры, копии которого держит Astral. Ответ:
 * `inUse` — их отпечатки (уборка их не снимает), `keep` — `dev:ino` файлов, которые
 * якоря держат по праву, `updateTargets` — у каких целей update.rpf под якорем,
 * `unsettled` — какой-то архив только что сменили: отпускать прежние якоря рано,
 * они держат всё, что он унёс, и следующий проход разберётся спокойно.
 */
export async function settleLiveAnchors({ stateDir = DEFAULT_DIR, isBusy = () => false, pace = null, minBytes = STORED_MIN_BYTES, now = Date.now(), hotMs = LIVE_SETTLE_MS, linkFile = undefined } = {}) {
  const paths = statePaths(stateDir);
  const report = { inUse: new Set(), keep: new Set(), updateTargets: new Set(), anchored: [], unsettled: false, left: 0, skipped: null };
  if ((await fs.readdir(paths.transactions).catch(() => [])).length) {
    report.skipped = "pending-transaction";
    return report;
  }
  const state = await readStateShared(stateDir).catch(() => null);
  if (!state) {
    report.skipped = "no-state";
    return report;
  }
  const chunksRoot = copyStoreRoot(stateDir);
  noteDiskPlaces(Object.values(state.targets || {}).map((target) => target?.gameRoot));
  const lives = [];
  for (const live of liveArchivesOf(state)) {
    const stat = await fs.stat(live.path, { bigint: true }).catch(() => null);
    if (!stat?.isFile() || Number(stat.size) < minBytes) continue;
    lives.push({ path: live.path, homeInGame: live.homeInGame });
    if (liveAnchorRefused(live.path)) continue;
    /* У архива цепочка дозаписи (`append-item.js`): вторая ссылка запретила бы следующую запись (`Linked`). */
    if (await appendChainStands(live.path)) continue;
    /* Человек работает, архив меняется каждые пять минут: резать каждый из них незачем, ссылка на прежний держит его байты. */
    const known = await sameLiveAnchor(chunksRoot, stat);
    if (!known && now - touchedAt(await fs.stat(live.path)) < hotMs) {
      report.unsettled = true;
      report.left += 1;
      continue;
    }
    if (isBusy()) {
      report.skipped = "busy";
      return report;
    }
    const anchor = await ensureLiveAnchor({ chunksRoot, source: live.path, homeInGame: live.homeInGame, isBusy, pace, ...(linkFile ? { linkFile } : {}) }).catch((error) => {
      console.warn(`[astral-engine] Живой якорь не встал (${live.archive}): ${error?.message || error}`);
      return null;
    });
    if (anchor?.busy) {
      report.skipped = "busy";
      return report;
    }
    if (anchor?.changed) {
      report.unsettled = true;
      report.left += 1;
      continue;
    }
    if (!anchor?.sha256) continue;
    report.inUse.add(anchor.sha256);
    report.keep.add(inodeKey(stat));
    if (!anchor.reused) report.anchored.push(live.archive);
    if (live.archive === "update/update.rpf") report.updateTargets.add(live.targetKey);
  }
  if (lives.length) await rememberLiveArchives(chunksRoot, lives).catch(() => {});
  return report;
}

/**
 * Чистый оригинал update.rpf — в куски, когда у его цели живой якорь уже стоит. Файл
 * уходит только после обратной сборки (`packFile`), в очереди движка и если его не
 * спрашивали; отпечаток — из якоря этого же файла.
 */
export async function packProtectedOriginals({ stateDir = DEFAULT_DIR, updateTargets = new Set(), isBusy = () => false, pace = null, now = Date.now(), hotMs = HOT_COPY_MS } = {}) {
  const paths = statePaths(stateDir);
  const chunksRoot = copyStoreRoot(stateDir);
  const report = { packed: [], packedBytes: 0, bytes: 0, left: 0, skipped: null };
  for (const targetKey of updateTargets) {
    const file = path.join(paths.bases, targetKey, PROTECTED_UPDATE_COPY);
    const stat = await fs.stat(file, { bigint: true }).catch(() => null);
    if (!stat?.isFile()) continue;
    const size = Number(stat.size);
    const plain = await fs.stat(file);
    if (now - Math.max(touchedAt(plain), storedUseAt(file)) < hotMs) {
      report.left += 1;
      continue;
    }
    if (isBusy()) {
      report.skipped = "busy";
      return report;
    }
    let sha256 = (await readPackedManifest(file))?.sha256 || "";
    if (!sha256)
      for (const item of (await loadAnchors(chunksRoot)).list) {
        const held = await fs.stat(item.file, { bigint: true }).catch(() => null);
        if (held?.ino === stat.ino && held.dev === stat.dev) sha256 = item.sha256;
      }
    /* Отпечатка нет: файл ещё не был якорем. Следующий проход снимет его (`ensureCopyAnchors`). */
    if (!sha256) continue;
    const result = await packFile({ file, expectedSha256: sha256, chunksRoot, isBusy, pace, keepFile: true, store: path.relative(path.dirname(file), chunksRoot) }).catch((error) => ({
      packed: false,
      reason: String(error?.message || error),
    }));
    if (result.reason === "busy") {
      report.skipped = "busy";
      return report;
    }
    if (!result.packed) continue;
    const dropped = await serializeMutation(async () => {
      if (isBusy() || Math.max(now, Date.now()) - storedUseAt(file) < hotMs) return false;
      return fs.rm(file, { force: true, maxRetries: 8, retryDelay: 250 }).then(
        () => true,
        () => false,
      );
    });
    if (!dropped) {
      report.left += 1;
      continue;
    }
    report.packed.push(file);
    report.packedBytes += size;
  }
  return report;
}

/**
 * Куда уходят куски отпущенных якорей. `keep` от `settleLiveAnchors`; оригиналы,
 * которые пока файлом, держатся сами. `manifests` — описи точек отката.
 */
export async function retireStaleAnchors({ stateDir = DEFAULT_DIR, keep = new Set(), manifests = [], isBusy = () => false, pace = null } = {}) {
  const paths = statePaths(stateDir);
  const kept = new Set(keep);
  for (const entry of await fs.readdir(paths.bases, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const stat = await fs.stat(path.join(paths.bases, entry.name, PROTECTED_UPDATE_COPY), { bigint: true }).catch(() => null);
    if (stat?.isFile()) kept.add(inodeKey(stat));
  }
  return retireAnchors({ chunksRoot: copyStoreRoot(stateDir), keep: kept, manifests, isBusy, pace });
}

/** Работа для якорей без чтения: сколько живых архивов без якоря, оригиналов файлом и якорей, которых пора отпустить. */
export async function pendingAnchorWork({ stateDir = DEFAULT_DIR, minBytes = STORED_MIN_BYTES } = {}) {
  const state = await readStateShared(stateDir).catch(() => null);
  if (!state) return 0;
  const paths = statePaths(stateDir);
  const { list } = await loadAnchors(copyStoreRoot(stateDir));
  const held = new Map();
  for (const anchor of list) {
    const stat = await fs.stat(anchor.file, { bigint: true }).catch(() => null);
    if (stat) held.set(inodeKey(stat), anchor);
  }
  const keep = new Set();
  let pending = 0;
  const updateTargets = new Set();
  for (const live of liveArchivesOf(state)) {
    const stat = await fs.stat(live.path, { bigint: true }).catch(() => null);
    if (!stat?.isFile() || Number(stat.size) < minBytes || liveAnchorRefused(live.path) || (await appendChainStands(live.path))) continue;
    const key = inodeKey(stat);
    keep.add(key);
    if (!held.has(key) || held.get(key).suspect) pending += 1;
    else if (live.archive === "update/update.rpf") updateTargets.add(live.targetKey);
  }
  for (const targetKey of Object.keys(state.targets || {})) {
    const stat = await fs.stat(path.join(paths.bases, targetKey, PROTECTED_UPDATE_COPY), { bigint: true }).catch(() => null);
    if (!stat?.isFile()) continue;
    keep.add(inodeKey(stat));
    if (updateTargets.has(targetKey)) pending += 1;
  }
  for (const key of held.keys()) if (!keep.has(key)) pending += 1;
  return pending;
}

/**
 * Упаковать остывшие копии, на которые ссылается состояние. Ничего не трогает,
 * пока лежит журнал транзакции или состояние не прочитать.
 */
export async function packEngineCopies({
  stateDir = DEFAULT_DIR,
  isBusy = () => false,
  pace = null,
  now = Date.now(),
  hotMs = HOT_COPY_MS,
  perRun = 8,
  dryRun = false,
  minBytes = STORED_MIN_BYTES,
} = {}) {
  const paths = statePaths(stateDir);
  const report = { packed: [], packedBytes: 0, bytes: 0, removed: [], failed: [], skipped: null, left: 0 };
  if ((await fs.readdir(paths.transactions).catch(() => [])).length) {
    report.skipped = "pending-transaction";
    return report;
  }
  const state = await readStateShared(stateDir).catch(() => null);
  if (!state || !Object.keys(state.targets || {}).length) {
    report.skipped = "no-state";
    return report;
  }
  const chunksRoot = copyStoreRoot(stateDir);
  const list = await candidates(state, stateDir, now, hotMs, minBytes);
  report.left = list.length + (list.hot || 0);
  for (const copy of list.slice(0, perRun)) {
    if (isBusy()) {
      report.skipped = "busy";
      return report;
    }
    if (dryRun) {
      report.packed.push(copy.path);
      report.packedBytes += copy.size;
      continue;
    }
    const result = await packFile({
      file: copy.path,
      expectedSha256: copy.sha256,
      chunksRoot,
      isBusy,
      pace,
      keepFile: true,
      store: path.relative(path.dirname(copy.path), chunksRoot),
    }).catch((error) => ({ packed: false, reason: String(error?.message || error) }));
    if (result.reason === "busy") {
      report.skipped = "busy";
      return report;
    }
    if (!result.packed) {
      report.failed.push({ path: copy.path, bytes: copy.size, code: result.reason || "" });
      continue;
    }
    /* Файл уходит в очереди движка: установка, стоящая в ней, ещё держит его. */
    const dropped = await serializeMutation(async () => {
      const fresh = await readStateShared(stateDir).catch(() => null);
      const still = fresh && referencedStoreCopies(fresh, stateDir).get(placeKey(copy.path));
      if (still?.sha256 !== copy.sha256 || isBusy()) return false;
      /* Пока файл упаковывался, его спросили: он снова нужен. Опись остаётся: следующая упаковка возьмёт её без чтения. */
      if (Math.max(now, Date.now()) - storedUseAt(copy.path) < hotMs) return false;
      /* Файл держит чужая программа — уйдёт следующим проходом: опись уже на месте. */
      return fs.rm(copy.path, { force: true, maxRetries: 8, retryDelay: 250 }).then(
        () => true,
        () => false,
      );
    });
    if (!dropped) continue;
    report.packed.push(copy.path);
    report.packedBytes += copy.size;
    report.bytes += Math.max(0, copy.size - (result.newBytes || 0));
    report.left -= 1;
  }
  return report;
}

/*
 * Сняли последний мод с архива игры (например, DLC с полутора гигабайтами): архив
 * снова штатный, а копия «как было» лежала бы до скончания веков — и удаление мода не
 * возвращало бы его места. Если в архиве не осталось ни одного слоя, а живой файл
 * побайтно равен копии, копия больше не нужна: следующий мод снимет её заново
 * (`ensureArchiveResource`). update.rpf и свои DLC Astral этим правилом не трогаются.
 */
export function releaseRestoredArchives({ stateDir = DEFAULT_DIR, isBusy = () => false, minBytes = STORED_MIN_BYTES, dryRun = false } = {}) {
  return serializeMutation(async () => {
    const report = { removed: [], failed: [], bytes: 0, skipped: null };
    const paths = statePaths(stateDir);
    if ((await fs.readdir(paths.transactions).catch(() => [])).length) {
      report.skipped = "pending-transaction";
      return report;
    }
    const state = await readState(stateDir);
    const released = [];
    for (const target of Object.values(state.targets || {})) {
      if (target?.vanillaGuard && target.vanillaGuard.phase !== "restored") continue;
      for (const [archive, resource] of Object.entries(target?.resources || {})) {
        const name = archive.toLowerCase();
        if (name === "update/update.rpf" || OWN_DLC_ARCHIVE.test(name) || !name.endsWith(".rpf") || resource?.persistentManaged) continue;
        if (resource?.layers?.length) continue;
        const record = target.archives?.[archive];
        if (Object.values(record?.entries || {}).some((entry) => entry?.layers?.length)) continue;
        const original = resource?.original;
        const base = resource?.compositionBase || resource?.base;
        if (!original?.exists || !base?.exists || !original.path || !HASH.test(String(original.sha256 || "")) || original.sha256 !== base.sha256) continue;
        const size = await storedFileSize(original.path);
        if (size === null || size < minBytes) continue;
        let live;
        try {
          live = resolveInside(target.gameRoot, archive);
        } catch {
          continue;
        }
        if ((await fs.stat(live).catch(() => null))?.size !== size) continue;
        if (isBusy()) {
          report.skipped = "busy";
          break;
        }
        if ((await fingerprintSha256(live).catch(() => "")) !== original.sha256) continue;
        const places = BASELINE_FIELDS.map((field) => resource?.[field]?.path).filter(Boolean);
        released.push({ places, size });
        if (dryRun) continue;
        delete target.resources[archive];
        if (record) delete target.archives[archive];
      }
    }
    if (!released.length) return report;
    if (!dryRun) await writeState(state, stateDir);
    const kept = dryRun ? new Set() : new Set(referencedStoreCopies(state, stateDir).keys());
    for (const { places, size } of released) {
      const unique = [...new Set(places.map(placeKey))];
      report.bytes += size;
      report.removed.push({ path: places[0], bytes: size });
      if (dryRun) continue;
      for (const key of unique) {
        if (kept.has(key)) continue;
        await dropStoredFile(places.find((place) => placeKey(place) === key));
      }
    }
    return report;
  });
}
