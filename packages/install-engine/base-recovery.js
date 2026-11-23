/*
 * Пропавшая основа архива — по живому архиву игры (задача 1 ТЗ 10.10.2026).
 *
 * Основа — копия архива игры, на которую движок кладёт слои модов. Её может
 * не оказаться на месте: кэш почистили руками или «чистильщиком», файл забрал
 * антивирус, папку Astral восстановили из старой резервной копии. Раньше на
 * этом падала каждая установка и каждое снятие (`ENOENT …original.rpf`), и
 * выйти можно было, только переустановив игру.
 *
 * Теперь основа берётся с того, что лежит в игре:
 *
 *   • та же копия под другим именем (основа совпадает с `original` или
 *     `pristine`) — путь просто переписывается;
 *   • update.rpf — копия живого архива, очищенная от записей Astral
 *     (`cleanDirectUpdateBase`): контейнеры `x64/astral` уходят, а записи
 *     игры, которые моды заменили, остаются как есть — их прежнего вида
 *     больше нигде нет;
 *   • другие архивы — копия живого как есть.
 *
 * Что Astral уже не сможет вернуть к штатному виду, пишется в отчёт цели
 * (`base-readopted`, `kept`): «Вернуть без модов» вернёт игру к этой основе, а
 * до настоящего оригинала её доведёт только проверка файлов в Steam.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { resolveInside } from "./manifest.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
import { ShiftBaseRefused, cleanDirectUpdateBase, directBaseReferences } from "./direct-base-cleanup.js";
import { noteReconcile } from "./reconcile-report.js";
import { copyFileCancellable } from "./transaction.js";
import { ensureStoredFile } from "./chunk-store.js";

const UPDATE_ARCHIVE = "update/update.rpf";
/* Метка папки `x64/astral` (`astral-layer.js`): пропала — её снова положит
   подготовка, собирать архив без неё можно. */
const MARKER_MOD_ID = "@astral-layer";
const BASELINE_KEYS = Object.freeze(["base", "compositionBase", "original", "clean", "pristine"]);

const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

const samePath = (left, right) =>
  Boolean(left && right) && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

const insideRoot = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(String(candidate || "")));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
};

/*
 * Файл слоя пропал из хранилища (почистили кэш, забрал антивирус). Хранилище
 * называет файлы их sha256 (`payloads/<мод>/<sha256>`, `package-payload.js`),
 * так что тот же файл часто лежит у другого мода или другой версии — он
 * кладётся на место ссылкой или копией. `true` — файл снова на месте.
 */
async function restoreLayerPayload(layer, paths) {
  const sha = String(layer?.sha256 || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha) || !layer.cachePath || !insideRoot(paths.payloads, layer.cachePath)) return false;
  for (const name of await fs.readdir(paths.payloads).catch(() => [])) {
    if (name.startsWith("_")) continue;
    const candidate = path.join(paths.payloads, name, sha);
    if (samePath(candidate, layer.cachePath) || !(await exists(candidate))) continue;
    await fs.mkdir(path.dirname(layer.cachePath), { recursive: true });
    try {
      await fs.link(candidate, layer.cachePath);
    } catch {
      await fs.copyFile(candidate, layer.cachePath);
    }
    return true;
  }
  return false;
}

/* Метка папки — те же байты, что пишет подготовка (`astral-layer.js`);
   кладётся, только если совпал её отпечаток. */
async function restoreMarker(layer, paths) {
  const bytes = Buffer.from(`${JSON.stringify({ product: "Astral", layer: 1, container: "x64/astral" })}\n`, "utf8");
  if (createHash("sha256").update(bytes).digest("hex") !== String(layer.sha256 || "").toLowerCase()) return false;
  if (!insideRoot(paths.payloads, layer.cachePath)) return false;
  await fs.mkdir(path.dirname(layer.cachePath), { recursive: true });
  await fs.writeFile(layer.cachePath, bytes);
  return true;
}

/**
 * Слои архива, чьих файлов больше нет ни на месте, ни в хранилище: такие
 * моды из этого архива снимаются (без них архив не собрать), а мод, у
 * которого слоёв не осталось нигде, уходит из установленного — окно покажет
 * его неустановленным и предложит поставить снова. Возвращает id снятых.
 */
export async function dropLostLayers({ target, archiveTarget, paths }) {
  const archive = target?.archives?.[archiveTarget];
  if (!archive?.entries) return [];
  const lost = new Set();
  for (const record of Object.values(archive.entries))
    for (const layer of record?.layers || []) {
      if (!layer?.cachePath || layer.action === "delete") continue;
      /* Реестры движок собирает заново сам, метка папки — постоянные байты. */
      if (String(layer.modId || "").startsWith("@") && layer.modId !== MARKER_MOD_ID) continue;
      if (insideRoot(paths.payloads, layer.cachePath) && (await exists(layer.cachePath))) continue;
      if (await restoreLayerPayload(layer, paths)) continue;
      /* Метка не мод: не легла — сборка скажет о ней сама. */
      if (layer.modId === MARKER_MOD_ID) {
        await restoreMarker(layer, paths);
        continue;
      }
      lost.add(layer.modId);
    }
  if (!lost.size) return [];
  for (const record of Object.values(archive.entries))
    if (Array.isArray(record?.layers)) record.layers = record.layers.filter((layer) => !lost.has(layer?.modId));
  delete archive.lastBuilt;
  const stillThere = (modId) =>
    Object.values(target.archives || {}).some((other) =>
      Object.values(other?.entries || {}).some((record) => (record?.layers || []).some((layer) => layer?.modId === modId)),
    ) || Object.values(target.resources || {}).some((resource) => (resource?.layers || []).some((layer) => layer?.modId === modId));
  const gone = [...lost].filter((modId) => !stillThere(modId));
  if (gone.length) target.installed = (target.installed || []).filter((item) => !gone.includes(item?.modId));
  noteReconcile(target, { kind: "mods-lost", archive: archiveTarget, modIds: [...lost].sort() });
  return [...lost];
}

/**
 * Возвращает основу ресурса на диск, если её файла нет. `true` — основа
 * сменилась (состояние цели поправлено на месте).
 */
export async function ensureBaseFile({ target, archiveTarget, paths, targetKey, gameRoot = null, signal = null }) {
  const resource = target?.resources?.[archiveTarget];
  const base = resource?.compositionBase || resource?.base;
  /* Основа кусками — не пропажа: собирается здесь (`chunk-store.js`). Испорченная — как пропавшая. */
  if (!base?.exists || !base.path || (await ensureStoredFile(base.path, { signal }))) return false;

  /* Та же копия под другим именем. */
  for (const key of BASELINE_KEYS) {
    const candidate = resource[key];
    if (
      candidate?.exists &&
      candidate.path &&
      !samePath(candidate.path, base.path) &&
      (!base.sha256 || candidate.sha256 === base.sha256) &&
      (await exists(candidate.path))
    ) {
      for (const name of BASELINE_KEYS)
        if (samePath(resource[name]?.path, base.path)) resource[name] = { ...resource[name], path: candidate.path };
      return true;
    }
  }

  const livePath = resolveInside(gameRoot || target.gameRoot, archiveTarget);
  if (!(await exists(livePath)))
    throw new Error(
      `Копия ${archiveTarget} пропала из кэша Astral, а в игре этого архива нет. Проверьте файлы игры в Steam, Epic или Rockstar Games Launcher и повторите.`,
    );
  const liveSha = await fingerprintSha256(livePath);
  const directory = path.join(paths.bases, targetKey, "recovered");
  await fs.mkdir(directory, { recursive: true });
  const copy = path.join(directory, `${liveSha}.rpf`);
  if (!(await exists(copy))) {
    const stage = `${copy}.${randomUUID()}.stage`;
    try {
      await copyFileCancellable(livePath, stage, signal);
      await fs.rename(stage, copy);
    } catch (error) {
      await fs.rm(stage, { force: true }).catch(() => {});
      throw error;
    }
  }
  let baseline = { exists: true, path: copy, sha256: liveSha, verified: true };
  let kept = [];
  if (String(archiveTarget).toLowerCase() === UPDATE_ARCHIVE) {
    let cleaned = null;
    try {
      /* Образцы — защищённая копия игры и всё, что от прежней основы осталось: без них любая собранная запись «не совпадала» и уходила в основу
         как есть, а сдвиг слоя «Окружения» лёг в основу вместе с живым архивом (10.11.2026). */
      cleaned = await cleanDirectUpdateBase({
        target,
        source: { path: copy, sha256: liveSha },
        references: await directBaseReferences({ resource, gameRoot: gameRoot || target.gameRoot, paths, targetKey, previous: null }),
        paths,
        targetKey,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof ShiftBaseRefused) throw error;
      console.warn(`[astral-engine] Основа update.rpf по живому архиву не очищена: ${error?.message || error}`);
    }
    if (cleaned?.changed)
      baseline = {
        exists: true,
        path: cleaned.path,
        sha256: cleaned.sha256,
        verified: true,
        withoutAstral: true,
        liveSha256: liveSha,
      };
    kept = (cleaned?.kept || []).map((item) => item.entry);
  } else {
    kept = Object.keys(target.archives?.[archiveTarget]?.entries || {}).filter(
      (entry) => (target.archives[archiveTarget].entries[entry]?.layers || []).length,
    );
  }
  /* Каждая основа ресурса, чей файл пропал, — на новую. Игра «до Astral»
     (`pristine`) новой основой не притворяется: пропала — забывается. */
  for (const key of BASELINE_KEYS) {
    const current = resource[key];
    if (key === "pristine" || !current?.exists || !current.path) continue;
    if (!samePath(current.path, base.path) && (await exists(current.path))) continue;
    resource[key] = key === "clean" ? { ...baseline, verified: false } : { ...baseline };
  }
  if (!resource.original?.exists) resource.original = { ...baseline };
  if (resource.pristine?.path && !(await exists(resource.pristine.path))) delete resource.pristine;
  if (target.archives?.[archiveTarget]) delete target.archives[archiveTarget].lastBuilt;
  noteReconcile(target, { kind: "base-readopted", archive: archiveTarget, kept });
  return true;
}
