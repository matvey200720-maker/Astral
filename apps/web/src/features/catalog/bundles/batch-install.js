import { getCloudDownloadGrant, installRemotePackages, planLocalPackage } from "./bundle-api.js";
import { cloudCatalogIDPattern } from "../../../catalog-utils.js";
import { packageUrlForRegion } from "../../../network-regions.js";
import { buildBlockedNotice } from "../../builds/logic.js";
import { recordDesktopCatalogDownload } from "../../telemetry/index.js";
import { prepareBuildInstallPlan } from "../../builds/install-plan.js";
import { installOrigin } from "../../library/install-origin.js";

/*
 * Пачка пакетов в очереди «Загрузок» (ТЗ ведущей 10.11.2026, этап 2). Правила «что ставить и что снимать» — `batch-plan.js`; здесь — подготовка пачки к очереди
 * (подписанные манифесты, планы, `replaceModIds`, происхождение каждого пакета) и сам ход через `installRemotePackages` движка: пачка идёт ОДНОЙ строкой очереди и одной
 * транзакцией, отказ ничего не меняет. Модуль ленивый: оболочка берёт его по `import()`, в стартовый кусок он не входит (потолок `main-*.js`).
 */

/** Пределы пачки движка (IPC Хелпера 27): пакетов и снимаемых модов. Больше — пачка не уходит, окно возвращается к ходу по пакетам. Пакетов 64 (было 40): ганпак «Brick» — 41 ствол и «прочее», см. `MAX_INSTALL_PACKAGES` в `installer-ipc.js`. */
export const MAX_BATCH_PACKAGES = 64;
export const MAX_BATCH_REMOVALS = 64;
export const withinBatchLimits = (item) => Boolean(item) && item.batch.packages.length <= MAX_BATCH_PACKAGES && item.batch.removeModIds.length <= MAX_BATCH_REMOVALS;

const sum = (list, pick) => list.reduce((total, item) => total + (Number(pick(item)) || 0), 0);

/**
 * Строка очереди из уже подготовленных добавлений (`prepareBuildInstallPlan`): `additions` — пакеты пачки с манифестами, `removeModIds` — что снять той же транзакцией.
 * `replaceModIds` пакетов не повторяют `removeModIds`: снятие — дело пачки, а не конфликта пакета.
 */
export function batchItemOf({ name, bundle = null, additions = [], removeModIds = [], packageURL = () => "", region = "" }) {
  const removing = new Set(removeModIds);
  const packages = additions.map(({ mod, replaceIds = [] }) => ({
    manifest: mod.manifest,
    baseUrl: packageURL(mod, region) || mod.packageBaseUrl || "",
    replaceModIds: replaceIds.filter((id) => !removing.has(id)),
    origin: installOrigin({ ...mod, ...(bundle ? { bundleId: bundle.id, bundleName: bundle.name } : {}) }),
  }));
  const first = additions[0]?.mod || {};
  return {
    id: first.id || `batch-${Date.now()}`,
    name: name || bundle?.name || first.name || "",
    cover: bundle?.cover || first.cover,
    author: bundle?.author || first.author,
    sizeBytes: sum(additions, (item) => item.mod.sizeBytes),
    ...(bundle ? { bundleId: bundle.id, bundleName: bundle.name } : {}),
    batch: { packages, removeModIds: [...removing], ids: additions.map((item) => item.mod.id) },
    packageBaseUrl: "",
    replaceIds: [],
    installPlan: {
      summary: { fileCount: sum(additions, (item) => item.plan?.summary?.fileCount), writeBytes: sum(additions, (item) => item.plan?.summary?.writeBytes) },
      conflicts: [],
    },
  };
}

// Облачным профиль считается, если хотя бы у одного пакета id — uuid каталога.
const isCloud = (parts) => parts.some((part) => cloudCatalogIDPattern.test(part.id || ""));

/**
 * Подготовить пачку: манифесты и планы пакетов, затем строка очереди.
 * @returns {Promise<{ item?: object, blocked: object[], internalConflicts: object[] }>} без `item`, если какой-то пакет не встаёт: пачка не идёт целиком
 */
export async function prepareBatch({ name, parts, removeModIds = [], bundle = null, installed = [], allMods = [], region, game, getDownloadGrant, recordDownload, planPackage, packageURL }) {
  const removing = new Set(removeModIds);
  const profile = { name: name || bundle?.name || "", modIds: parts.map((part) => part.id), cloud: isCloud(parts), items: parts.map((part) => ({ modId: part.id, releaseId: part.releaseId })) };
  const plan = await prepareBuildInstallPlan({
    profile,
    desiredMods: parts,
    missingIds: [],
    // Что снимает сама пачка, конфликтом для её пакетов не считается.
    installed: installed.filter((id) => !removing.has(id)),
    allMods,
    region,
    game,
    getDownloadGrant,
    recordDownload,
    planPackage,
    packageURL,
  });
  if (plan.blocked.length || plan.internalConflicts.length || !plan.additions.length) return { blocked: plan.blocked, internalConflicts: plan.internalConflicts };
  const item = batchItemOf({ name, bundle, additions: plan.additions, removeModIds, packageURL, region });
  return withinBatchLimits(item) ? { item, blocked: [], internalConflicts: [] } : { blocked: [], internalConflicts: [], tooBig: true };
}

/**
 * Пачка — одна строка очереди «Загрузок». `shell` — состояние оболочки (`DesktopShell.bundleShell`): `queue`, `setQueue`, `source` (откуда идёт установка), `notify`, `notices`.
 * @returns {boolean} встала ли пачка в очередь (повтор той же пачки — нет)
 */
export function enqueueBatch(item, shell) {
  const { queue, setQueue, notify, notices } = shell;
  if (queue.some((row) => !row.failed && row.id === item.id && row.operation === "install")) {
    notify(notices.alreadyQueued(item.name));
    return false;
  }
  setQueue((previous) => [
    ...previous.filter((row) => !(row.failed && row.id === item.id)),
    { ...item, queueId: `install-${item.id}-${Date.now()}`, queuedAt: Date.now(), operation: "install", progress: 0, progressSource: shell.source },
  ]);
  notify(notices.queued(item.name));
  return true;
}

/**
 * Пачка из окна «Компоненты»: `parts` ставятся, `removeModIds` снимаются одной транзакцией. `false` — пачка не встала в очередь, окно вернёт выбор.
 * Играть может только вошедший человек с готовой игрой, вне сеанса Vanilla Guard и не в демо.
 */
export async function installPackages({ name, parts, removeModIds = [], bundle = null }, shell) {
  const { game, preparation, installed, mods, region, notify, language } = shell;
  if (!shell.account || !game || shell.demoMode || preparation.status !== "ready" || shell.guard()) return false;
  const prepared = await prepareBatch({
    name,
    parts,
    removeModIds,
    bundle,
    installed,
    allMods: mods,
    region,
    game,
    getDownloadGrant: getCloudDownloadGrant,
    recordDownload: recordDesktopCatalogDownload,
    planPackage: planLocalPackage,
    packageURL: packageUrlForRegion,
  });
  if (prepared.item) return enqueueBatch(prepared.item, shell);
  if (prepared.blocked.length || prepared.internalConflicts.length) notify(buildBlockedNotice({ build: name, blocked: prepared.blocked, internalConflicts: prepared.internalConflicts }, language), "error");
  return false;
}

/** Ход строки очереди с пачкой: одна транзакция движка (`installRemotePackages`). */
export function runInstallBatch(current, game) {
  return installRemotePackages({
    operationId: current.queueId,
    targetId: game.id,
    name: current.name,
    packages: current.batch.packages,
    ...(current.batch.removeModIds.length ? { removeModIds: current.batch.removeModIds } : {}),
    /* «Прочее ганпака» (`gunpack-parts.js`): подписанный пак и файлы, из которых главный процесс соберёт служебную запись в той же транзакции. */
    ...(current.batch.extras ? { extras: current.batch.extras } : {}),
  });
}
