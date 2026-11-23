import fs from "node:fs/promises";
import { LIVE_CARRIER_TARGETS } from "./carrier-targets.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inOperation } from "./operation-scope.js";
import { trustedPackageUrl } from "./network-policy.js";
export { trustedPackageUrl };
import { PACKAGE_FILE_DEFAULTS, assertDownloadSpace, createDownloadShare, fetchPackageFileWithRetry, localCopyOf, placeLocalCopy } from "./package-download.js";
import { mapLimitDynamic } from "./map-limit.js";
export { announceLaneLimitChanged } from "./map-limit.js";
import {
  checkedRecordKey,
  ownRecordValue,
  setRecordValue,
} from "./state-record.js";
import {
  ASTRAL_UPDATE_TARGET,
  isAstralUpdateTarget,
  MANAGED_DLC_LIST_TARGET,
  composeAstralContentRegistry,
  composeDirectDlcRegistry,
  composeManagedDlcList,
  addCarrierRegistryArchive,
} from "./registry-composers.js";
import {
  ASTRAL_CONTAINER_ROOT,
  ASTRAL_LAYER_MARKER_ENTRY,
  ASTRAL_LAYER_MOD_ID,
  ASTRAL_LAYER_SCHEMA,
  AstralLayerError,
  astralContentRegistrations,
  astralDlcRegistrations,
  astralLayerStatus,
  inspectModsShadow,
  MODS_SHADOW_ARCHIVE,
  prepareAstralLayerCore,
} from "./astral-layer.js";
import { astralContainerOf } from "./astral-paths.js";
import {
  FAST_WEAPON_DLC_NAME,
  FAST_WEAPON_DLC_TARGET,
  fastWeaponHostReady as checkFastWeaponHostReady,
  provisionFastWeaponDlcCore,
} from "./fast-weapon-dlc.js";
import {
  CLOTHING_DLC_NAME,
  CLOTHING_DLC_TARGET,
  clothingRegistrationStatus,
  provisionClothingDlcCore,
} from "./clothing-dlc.js";
import {
  rebaseBeforeUninstall,
  rebaseDirectUpdateIfNeeded,
} from "./direct-update-rebase.js";
import { directDlcsOf } from "./direct-dlcs.js";
import { rebaseArchiveIfNeeded } from "./archive-rebase.js";
import { auditTarget, parkedModsInArchives, parkRevertedMods, repairTarget } from "./target-repair.js";
import { restoreTargetBaseline } from "./target-restore.js";
import { removeModLayers, settleAudioSlotLayer } from "./mod-layers.js";
import {
  ASI_LOADERS,
  MODS_PLUGINS,
  VANILLA_GUARD_ITEMS,
} from "./loader-policy.js";
import {
  activeBaseline,
  activeBaselinePath,
  assertGameRoot,
  DEFAULT_DIR,
  exists,
  missingBaseline,
  statePaths,
  targetKeyFor,
} from "./storage-state.js";
import { copyFileCancellable } from "./transaction.js";
import {
  FORBIDDEN_EXTENSIONS,
  resolveInside,
  sha256File,
  validateManifest,
  verifyManifest,
} from "./manifest.js";
import { assertRuntimeSafe, throwIfAborted } from "./runtime-guard.js";
import { assertCompositeSource } from "./composite-home.js";
import {
  assertAbsoluteInside,
  atomicJson,
  canonicalTargetRecords,
  readState,
  readStateShared,
  restorePointSnapshot,
  serializeMutation,
  writeState,
} from "./engine-state.js";
import {
  composeArchiveResource,
  ensureArchiveResource,
} from "./resource-composition.js";
import { reanchorStatePaths } from "./state-paths.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
export { reanchorStatePaths, relocateState, rewriteStateRoot } from "./state-paths.js";
export { relocateStateFile } from "./engine-state.js";
export { noteReconcile, reconcileEventsSince } from "./reconcile-report.js";
export { engineLayerGaps } from "./engine-layer-gaps.js";
export { parkedSummary } from "./parked-mods.js";
export { enginePoint } from "./transactions.js";
import { defaultOpsEngineFor, deferredBuildFor, opsAllowedFor } from "./ops-build.js";
export { restoreParkedMods } from "./parked-restore.js";
import { forgetParked } from "./parked-mods.js";
export {
  canonicalManifest,
  mergeAstralContentXml,
  mergeDlcListXml,
  normalizeRelativePath,
  resolveInside,
  sha256File,
  stripAstralContentXml,
  stripAstralDlcListXml,
  validateManifest,
  verifyManifest,
} from "./manifest.js";
export {
  ASTRAL_REGISTRATION_ROOT,
  LEGACY_ASTRAL_CONTAINER_ROOT,
  astralContainerOf,
  canonicalArchiveEntry,
} from "./astral-paths.js";
export { releaseStockHold, stockHoldOf } from "./stock-hold.js";
export {
  mergeTimecycleModifierXml,
  parseTimecycleModifierXml,
  selectTimecycleModifierXml,
} from "./timecycle-merge.js";
export {
  ENTRY_MATERIALIZER_NAMES,
  resolveEntryMaterializers,
  setDefaultEntryMaterializers,
} from "./entry-materializers.js";
export {
  cleanDirectUpdateBase,
  directBaseReferences,
  setDefaultBaseTools,
} from "./direct-base-cleanup.js";
export { setNativeArchiveHistory } from "./native-history.js";
export { setUpdateDriftObserver } from "./update-guard.js";
export { setEngineStepRecorder } from "./engine-steps.js";
export { assertReplayInside, engineInstallEnabled, engineSwapItem, newEngineSwapNames } from "./engine-swap.js";
export {
  FOREIGN_ALL_KEPT_CODE,
  FOREIGN_ALL_KEPT_PREFIX,
  FOREIGN_CHOICES,
  FOREIGN_CONFLICT_CODE,
  FOREIGN_CONFLICT_PREFIX,
  ForeignAllKeptError,
  ForeignConflictError,
  findForeignConflicts,
  foreignChoiceOf,
  forgetForeignChoices,
  getForeignChoices,
  loadForeignChoices,
  isForeignAllKept,
  isForeignConflict,
  readPendingForeignConflicts,
  setForeignChoices,
  setForeignDetector,
  wholesaleEntries,
} from "./foreign-entries.js";

export { FAST_WEAPON_DLC_NAME, FAST_WEAPON_DLC_TARGET };
export { CLOTHING_DLC_NAME, CLOTHING_DLC_TARGET };
export { clothingItemSlots } from "./clothing-slots.js";
export { AUDIO_DLC_NAME, AUDIO_DLC_TARGET } from "./audio-dlc.js";
export {
  ASTRAL_CONTAINER_ROOT,
  ASTRAL_LAYER_MARKER_ENTRY,
  ASTRAL_LAYER_MOD_ID,
  ASTRAL_LAYER_SCHEMA,
  ASTRAL_UPDATE_TARGET,
  AstralLayerError,
  astralContentRegistrations,
  astralDlcRegistrations,
  inspectModsShadow,
  MODS_SHADOW_ARCHIVE,
};
/* Единственный список того, чем игру заставляют читать `mods`: его спрашивают
   и предпросмотр в apps/desktop, и охрана ванильной установки. */
export { ASI_LOADERS, MODS_PLUGINS };
export {
  parkForeignPlugins,
  parkModsShadowArchive,
  returnParkedLoaders,
} from "./foreign-loaders.js";
export { takeHostStandingReport } from "./host-standing.js";
export { conflictsReplacedWhole } from "./plan-conflict-ids.js";
// Реэкспорт трастовых символов арены как у соседей: адаптеры и тесты работают
// через "@modovik/install-engine", не залезая во внутренние модули пакета.
export {
  arenaSourceDigest,
  isLocalArenaManifest,
  LOCAL_ARENA_TRUST,
} from "./arena-manifest-trust.js";
export {
  isLocalWorldMapManifest,
  LOCAL_WORLD_MAP_TRUST,
  WORLD_MAP_ISLAND_ENTRY,
  WORLD_MAP_ISLAND_SOURCE,
  WORLD_MAP_PAUSE_BLUR_ENTRY,
  WORLD_MAP_PAUSE_BLUR_SOURCE,
  WORLD_MAP_PAUSE_ENTRY,
  WORLD_MAP_PAUSE_SOURCE,
  WORLD_MAP_RADAR_OVERLAY_ARCHIVE,
  WORLD_MAP_RADAR_MASK_ENTRY,
  WORLD_MAP_RADAR_MASK_SOURCE,
  WORLD_MAP_RADAR_OVERLAY_DIRECTORY,
  WORLD_MAP_RADAR_TILES_ENTRY,
  WORLD_MAP_RADAR_TILES_SOURCE,
  WORLD_MAP_RADAR_TUNABLES_ENTRY,
  WORLD_MAP_RADAR_TUNABLES_SOURCE,
  WORLD_MAP_ZOOM_ENTRY,
  WORLD_MAP_ZOOM_SOURCE,
  worldMapSourceDigest,
} from "./world-map-manifest-trust.js";
export {
  climbSourceDigest,
  isLocalClimbManifest,
  LOCAL_CLIMB_TRUST,
} from "./climb-manifest-trust.js";
export {
  isLocalMapPackManifest,
  isMapPackEntry,
  LOCAL_MAP_PACK_TRUST,
  mapPackSourceDigest,
} from "./map-pack-manifest-trust.js";
export {
  buildSkyRainbowManifest,
  isLocalSkyRainbowManifest,
  isSkyRainbowCurrent,
  isSkyRainbowModId,
  LOCAL_SKY_RAINBOW_TRUST,
  SKY_RAINBOW_CONTAINER,
  SKY_RAINBOW_MAX_TIERS,
  SKY_RAINBOW_SCHEMA,
  SKY_RAINBOW_SHARED_FILES,
  SKY_RAINBOW_SLOT,
  skyRainbowDigest,
  skyRainbowFiles,
  skyRainbowModelFile,
} from "./sky-rainbow-manifest-trust.js";
export {
  isLocalSoundPackManifest,
  isSoundPackBank,
  isSoundPackEntry,
  LOCAL_SOUND_PACK_TRUST,
  SOUND_PACK_ARCHIVES,
  soundPackArchiveOfBank,
  soundPackBankOfEntry,
  soundPackSourceDigest,
} from "./sound-pack-manifest-trust.js";
export {
  CLOTHING_SKIN_CAPABILITIES,
  CLOTHING_SKIN_DLC_TARGET,
  CLOTHING_SKIN_FOLDERS,
  LOCAL_CLOTHING_SKIN_TRUST,
  clothingSkinEntry,
  clothingSkinSlot,
  clothingSkinSourceDigest,
  isLocalClothingSkinManifest,
} from "./clothing-skin-manifest-trust.js";
export * from "./clothing-replace-manifest-trust.js";
export * from "./weapon-skin-manifest-trust.js";
export * from "./gunpack-manifest-trust.js";
export {
  WEAPON_SOUND_DLC_FOLDERS,
  isWeaponAudioLayerPlace,
} from "./local-sound-trust.js";

import {
  astralLayerDependencies,
  recoverInterruptedTransactions,
  recoverPendingTransactions,
  transact,
  opsHoldIsKnown,
  opsRouteIsOpen,
} from "./transactions.js";
import { orderForCarriers, orderForRestoreOf } from "./carrier-order.js";
import { addSubpackHostArchives, pruneEmptySubpackResources } from "./subpack-closure.js";
import { getVanillaGuardStatus } from "./vanilla-guard-status.js";
import { pruneEmptyManagedDirectories } from "./fs-guards.js";
import { installPackage, installPackageBatch, planPackage } from "./plan-install.js";
import { reduxLayerOf } from "./redux-state.js";

export { recoverInterruptedTransactions, recoverPendingTransactions };
export { installPackage, installPackageBatch, planPackage };
export { auditTarget, parkedModsInArchives, parkRevertedMods, repairTarget };
export {
  refreshStaleComposites,
  staleCompositeArchives,
} from "./composite-refresh.js";
export {
  installLocalArenaPackage,
  installLocalClimbPackage,
  installLocalInteriorPackage,
  installLocalLampLightsPackage,
  installLocalMapPackPackage,
  installLocalMegaMallOverlayPackage,
  installLocalSkyRainbowPackage,
  installLocalSoundPackage,
  installLocalSoundPackPackage,
  installLocalWallbangPackage,
  installLocalAnimalsPackage,
  installLocalProjectInteriorsPackage,
  installLocalMajesticInteriorsPackage,
  installLocalDrawDistancePackage,
  installLocalWeaponSkinPackage,
  installLocalClothingSkinPackage,
  installLocalGunpackPackage,
  installLocalClothingReplacePackage,
  installLocalClothingReplacePackages,
  installLocalTattooPaintPackage,
  installLocalWorldMapPackage,
  installPinnedLoaderPackage,
  planLocalMapPackPackage,
  planLocalSoundPackage,
  planLocalSoundPackPackage,
  planLocalWeaponSkinPackage,
  planLocalClothingSkinPackage,
  planLocalGunpackPackage,
  planLocalClothingReplacePackage,
  planLocalTattooPaintPackage,
  planLocalWorldMapPackage,
} from "./local-packages.js";
export * from "./tattoo-paint-manifest-trust.js";

/**
 * Подготовка слоя Astral в update.rpf: резервная копия, кэш исходных
 * content.xml/dlclist.xml, папка x64/astral с меткой и отпечаток архива.
 * Без composer живой архив не меняется (только резервная копия).
 */
export function prepareAstralLayer(...args) {
  return inOperation(() => prepareAstralLayerNow(...args));
}

async function prepareAstralLayerNow(input) {
  return prepareAstralLayerCore(
    {
      targetId: "default",
      edition: "Legacy",
      stateDir: DEFAULT_DIR,
      contentXmlProvider: null,
      dlcListProvider: null,
      rpfComposer: null,
      rpfProbe: null,
      signal: null,
      assertRuntimeSafety: null,
      onProgress: null,
      ...input,
    },
    astralLayerDependencies(),
  );
}

/** Состояние слоя Astral без записи и без восстановления транзакций. */
export async function getAstralLayerStatus({
  targetId = "default",
  stateDir = DEFAULT_DIR,
} = {}) {
  const state = await readState(stateDir);
  const targetKey = checkedRecordKey(targetId, "Target ID");
  const target = ownRecordValue(state.targets, targetKey);
  if (!target) return { targetId, status: "missing", prepared: false };
  const status = await astralLayerStatus(target, { resolveInside, sha256File: fingerprintSha256 });
  return {
    targetId,
    ...status,
    container: ASTRAL_CONTAINER_ROOT,
    registered: Object.keys(
      target.archives?.[ASTRAL_UPDATE_TARGET]?.entries || {},
    )
      .map(astralContainerOf)
      .filter((value, index, all) => value && all.indexOf(value) === index),
    backup: target.resources?.[ASTRAL_UPDATE_TARGET]?.compositionBase || null,
    preparedAt: target.astralLayer?.preparedAt || null,
  };
}

export async function downloadSignedPackage({
  manifest,
  baseUrl,
  publicKey,
  stateDir = DEFAULT_DIR,
  downloadsDir = null,
  allowInsecureLocalhost = false,
  allowedHosts = null,
  maxFileBytes = 4 * 1024 * 1024 * 1024,
  maxTotalBytes = 12 * 1024 * 1024 * 1024,
  onProgress = null,
  signal = null,
  /* Свободное место тома загрузок (подменяют тесты). */
  statfs = fs.statfs,
  /* Повтор при обрыве связи: `{ retries, delayMs }` (`package-download.js`). */
  networkRetry = {},
  /* Сколько файлов качать сразу. Функцию перечитывают перед каждым файлом:
     ускоренная загрузка меняет её на ходу (map-limit.js). */
  downloadLanes = () => 1,
  /* Большие файлы — блоками по Range на нескольких соединениях (`PACKAGE_FILE_DEFAULTS`); тестам нужны свои пороги. */
  parallelFiles = {},
  /* Пакет данных «Интерьеров проектов» (`project-interiors-data.js`) качает только редактор: обычная установка его отвергает здесь же, до первого запроса. */
  projectInteriorsData = false,
  /* Только эти файлы пакета (`file => boolean`): подпись и состав проверяются у всего манифеста, а качается лишнее не нужно — «3D» вещи каталога берёт модель и файлы одного
     цвета, а не пакет целиком (замер 28.10.2026: 25 с на холодном пакете в 20 МБ). Неполный пакет манифест не пишет: «скачан целиком» он не считается, остальное догрузит установка. */
  only = null,
}) {
  if (!verifyManifest(manifest, publicKey))
    throw new Error("Цифровая подпись пакета недействительна.");
  const parsed = validateManifest(manifest, null, {
    allowGameRootWrites: true,
    projectInteriorsData,
  });
  const base = trustedPackageUrl(baseUrl, {
    allowInsecureLocalhost,
    allowedHosts,
  });
  const paths = statePaths(stateDir);
  const downloadsRoot = downloadsDir
    ? path.resolve(downloadsDir)
    : paths.downloads;
  const packageRoot = path.join(downloadsRoot, parsed.id, parsed.version);
  /* Один бюджет на все линии: у каждой своя копия «сколько уже» развела бы
     лимит по байтам. */
  const budget = { total: 0, maxFileBytes, maxTotalBytes };
  let completed = 0;
  /* Сколько файлов качается из сети прямо сейчас — между ними делятся соединения. */
  let downloading = 0;
  const downloadableFiles = parsed.files.filter(
    (file) => file.action !== "delete" && (!only || only(file)),
  );
  const fileCount = downloadableFiles.length;
  /* Доли файлов, которые качаются сейчас: линий бывает несколько. */
  const inFlight = new Map();
  /* Полоса и «сколько осталось» идут по байтам (`createDownloadShare`). */
  const share = createDownloadShare(downloadableFiles);
  const report = (payload = {}) => {
    const { finished, ...rest } = payload;
    if (finished) {
      inFlight.delete(payload.file);
      share.finish(payload.file);
    } else if (payload.fileTotalBytes > 0)
      inFlight.set(
        payload.file,
        Math.min(1, (payload.fileBytes || 0) / payload.fileTotalBytes),
      );
    const fraction = share.fraction(inFlight);
    const percent = Math.max(2, Math.min(84, Math.round(fraction * 82) + 2));
    onProgress?.({
      phase: "download",
      percent,
      fraction,
      completed,
      total: fileCount,
      downloadedBytes: budget.total,
      ...rest,
    });
  };
  report({ percent: 2 });
  await assertDownloadSpace({ files: downloadableFiles, packageRoot, downloadsRoot, statfs });
  /* Отмена до первого файла — как раньше: ни одного запроса. */
  throwIfAborted(signal);
  /* Отмена всей загрузки и первая ошибка одной линии останавливают остальные. */
  const laneAbort = new AbortController();
  const stopLanes = () => laneAbort.abort();
  signal?.addEventListener?.("abort", stopLanes, { once: true });
  const laneSignal = laneAbort.signal;
  const fetchOne = async (file) => {
    throwIfAborted(laneSignal);
    const destination = resolveInside(packageRoot, file.source);
    if (
      (await exists(destination)) &&
      (!file.sha256 || (await fingerprintSha256(destination)) === file.sha256)
    ) {
      completed++;
      report({ file: file.source, cached: true, finished: true });
      return;
    }
    const targetUrl = trustedPackageUrl(
      new URL(
        file.source,
        base.href.endsWith("/") ? base.href : `${base.href}/`,
      ).toString(),
      { allowInsecureLocalhost, allowedHosts },
    );
    if (
      targetUrl.origin !== base.origin ||
      !targetUrl.pathname.startsWith(
        base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`,
      )
    )
      throw new Error(`URL файла выходит за пределы пакета: ${file.source}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    /* Тот же файл уже лежит у Astral — без сети (`package-download.js`). */
    const local = await localCopyOf(file, {
      payloadsRoot: paths.payloads,
      downloadsRoot,
      packageId: parsed.id,
      destination,
    });
    if (local) {
      await placeLocalCopy(local, destination, file.sha256);
      completed++;
      report({
        file: file.source,
        cached: true,
        reused: true,
        finished: true,
      });
      return;
    }
    /*
     * Соединения на всю загрузку делятся между файлами, которые качаются
     * сейчас, а не на предел линий: раньше «Ускоренная загрузка» (4 линии)
     * давала единственному архиву мода 6 / 4 → 2 соединения вместо 6 — с ней
     * качалось медленнее, чем без неё (бета 15.10). Ускоренная — вдвое больше
     * соединений и раньше режет файл на блоки; переключение действует на ходу.
     */
    const accelerated = () => Math.floor(Number(downloadLanes()) || 1) > 1;
    downloading += 1;
    const { fileBytes, declared } = await fetchPackageFileWithRetry({
      file,
      targetUrl,
      destination,
      signal: laneSignal,
      budget,
      parallel: {
        connections: () =>
          Math.max(
            2,
            Math.floor(
              (PACKAGE_FILE_DEFAULTS.connections * (accelerated() ? 2 : 1)) / Math.max(1, downloading),
            ),
          ),
        ...(accelerated() ? { minFileBytes: 16 * 1024 * 1024 } : {}),
        ...parallelFiles,
      },
      onBytes: (bytes, size, resumedFrom) => {
        report({
          file: file.source,
          fileBytes: bytes,
          fileTotalBytes: size || null,
          ...(resumedFrom ? { resumedFrom } : {}),
        });
      },
    }, { ...networkRetry, onRetry: (attempt) => report({ file: file.source, retrying: attempt }) }).finally(() => {
      downloading -= 1;
    });
    completed++;
    report({
      file: file.source,
      fileBytes,
      fileTotalBytes: declared || fileBytes,
      cached: false,
      finished: true,
    });
  };
  try {
    await mapLimitDynamic(downloadableFiles, downloadLanes, fetchOne);
  } catch (error) {
    laneAbort.abort();
    throw error;
  } finally {
    signal?.removeEventListener?.("abort", stopLanes);
  }
  if (!only) await atomicJson(path.join(packageRoot, "manifest.json"), manifest);
  return { packageRoot, manifest };
}

export function installRemotePackage(...args) {
  return inOperation(() => installRemotePackageNow(...args));
}

async function installRemotePackageNow(input) {
  await assertRuntimeSafe(
    input.assertRuntimeSafety,
    input.signal,
    "before-download",
  );
  const downloaded = await downloadSignedPackage(input);
  await assertRuntimeSafe(
    input.assertRuntimeSafety,
    input.signal,
    "after-download",
  );
  input.onProgress?.({ phase: "verify", percent: 88 });
  try {
    const result = await installPackage({
      ...input,
      ...downloaded,
      requireSignature: true,
      onProgress: input.onProgress,
      /* Кэш загрузок выключен — загрузка уйдёт ниже: её файлы переезжают в хранилище, а не копируются. */
      moveDownloads: input.retainDownloads === false,
    });
    input.onProgress?.({ phase: "complete", percent: 100 });
    return result;
  } finally {
    if (input.retainDownloads === false) {
      await fs.rm(downloaded.packageRoot, {
        recursive: true,
        force: true,
      });
    }
  }
}

/*
 * Несколько подписанных пакетов каталога одной транзакцией, плюс снятие других модов в ней же (смена варианта сборки,
 * компонент из двух пакетов одного слота). `packages` — `[{ manifest, baseUrl, replaceModIds?, origin? }]`; остальное —
 * общее, как у `installRemotePackage`; `removeModIds` — кого снять, даже если файлов и слотов с пакетами нет общих.
 * Скачивание — по очереди, до первой записи в игру: отказ любого пакета или любого шага установки оставляет игру и состояние
 * прежними (`installPackageBatch`: проверки всех пакетов до записи, подмена архивов одной журналируемой транзакцией).
 */
export function installRemotePackages(...args) {
  return inOperation(() => installRemotePackagesNow(...args));
}

async function installRemotePackagesNow({ packages, preparedPackages = [], ...common }) {
  if (!Array.isArray(packages) || !packages.length) throw new Error("Нечего ставить: пакетов нет.");
  await assertRuntimeSafe(common.assertRuntimeSafety, common.signal, "before-download");
  const downloaded = [];
  try {
    for (const [index, item] of packages.entries()) {
      /* Полоса скачивания — одна на всех: пакет с номером i занимает свою долю. */
      const scaled = common.onProgress
        ? (event) =>
            common.onProgress(
              event?.phase === "download" && Number.isFinite(event.percent)
                ? { ...event, percent: Math.round((index * 84 + event.percent) / packages.length) }
                : event,
            )
        : null;
      const loaded = await downloadSignedPackage({ ...common, manifest: item.manifest, baseUrl: item.baseUrl, onProgress: scaled });
      downloaded.push({ ...loaded, replaceModIds: item.replaceModIds ?? [], origin: item.origin ?? null });
    }
    /* Готовые пакеты главного процесса (`preparedPackages`, «прочее ганпака»): качать нечего, доверие несёт `_internalTrust` — его окно передать не может (`rendererInstallPackagesInput` оставляет пакету четыре поля). */
    for (const item of preparedPackages)
      downloaded.push({ manifest: item.manifest, packageRoot: item.packageRoot, replaceModIds: item.replaceModIds ?? [], origin: item.origin ?? null, _internalTrust: item._internalTrust ?? null });
    await assertRuntimeSafe(common.assertRuntimeSafety, common.signal, "after-download");
    common.onProgress?.({ phase: "verify", percent: 88 });
    const result = await installPackageBatch({
      ...common,
      packages: downloaded.map(({ manifest, packageRoot, replaceModIds, origin, _internalTrust }) => ({ manifest, packageRoot, replaceModIds, origin, ...(_internalTrust ? { _internalTrust } : {}) })),
      requireSignature: true,
      moveDownloads: common.retainDownloads === false,
    });
    common.onProgress?.({ phase: "complete", percent: 100 });
    return result;
  } finally {
    if (common.retainDownloads === false)
      for (const { packageRoot } of downloaded) await fs.rm(packageRoot, { recursive: true, force: true });
  }
}

export function provisionFastWeaponDlc(...args) {
  return inOperation(() => provisionFastWeaponDlcNow(...args));
}

async function provisionFastWeaponDlcNow(input) {
  return provisionFastWeaponDlcCore(
    {
      targetId: "default",
      edition: "Legacy",
      stateDir: DEFAULT_DIR,
      signal: null,
      assertRuntimeSafety: null,
      onProgress: null,
      ...input,
    },
    {
      assertGameRoot,
      assertRuntimeSafe,
      checkedRecordKey,
      composeArchiveResource,
      copyFileCancellable,
      ensureArchiveResource,
      exists,
      missingBaseline,
      readState,
      rebaseDirectUpdateIfNeeded,
      recoverPendingTransactions,
      resolveInside,
      serializeMutation,
      /* Отпечатки по записи файла: подготовка идёт при каждом запуске
         (задача 6 ТЗ 10.10.2026). */
      sha256File: fingerprintSha256,
      statePaths,
      ownRecordValue,
      setRecordValue,
      targetKeyFor,
      transact,
      writeState,
    },
  );
}

/** Что состояние знает о DLC одежды цели (`clothingRegistrationStatus`): без записи и без чтения dlclist.xml — для самопочинки приложения. */
export async function getClothingRegistrationStatus({ targetId = "default", stateDir = DEFAULT_DIR } = {}) {
  /* Общий разбор состояния (`inspectProfile`): проверка идёт при каждом возврате фокуса и не должна разбирать тяжёлый файл заново. Состояние только читается. */
  const state = await readStateShared(stateDir);
  const target = ownRecordValue(state.targets, checkedRecordKey(targetId, "Target ID"));
  return target ? clothingRegistrationStatus(target, { resolveInside }) : { inUse: false };
}

export function provisionClothingDlc(...args) {
  return inOperation(() => provisionClothingDlcNow(...args));
}

async function provisionClothingDlcNow(input) {
  return provisionClothingDlcCore(
    {
      targetId: "default",
      edition: "Legacy",
      stateDir: DEFAULT_DIR,
      signal: null,
      assertRuntimeSafety: null,
      onProgress: null,
      ...input,
    },
    {
      assertGameRoot,
      assertRuntimeSafe,
      checkedRecordKey,
      composeArchiveResource,
      copyFileCancellable,
      ensureArchiveResource,
      exists,
      missingBaseline,
      readState,
      rebaseDirectUpdateIfNeeded,
      recoverPendingTransactions,
      resolveInside,
      serializeMutation,
      /* Отпечатки по записи файла: подготовка идёт при каждом запуске
         (задача 6 ТЗ 10.10.2026). */
      sha256File: fingerprintSha256,
      statePaths,
      ownRecordValue,
      setRecordValue,
      targetKeyFor,
      transact,
      writeState,
    },
  );
}

export function uninstallPackage(...args) {
  return inOperation(() => uninstallPackageNow(...args));
}

async function uninstallPackageNow({
  modId,
  targetId = "default",
  stateDir = DEFAULT_DIR,
  rpfComposer = null,
  contentXmlProvider = null,
  dlcListProvider = null,
  signal = null,
  assertRuntimeSafety = null,
  onProgress = null,
  tracerMaterializer = null,
  ptfxTextureMaterializer = null,
  awcMaterializer = null,
  bloodRoutingMaterializer = null,
  audioRelMaterializer = null,
  audioChunkMaterializer = null, audioSlotSettler = null, /* слой слотов звука: `audio-slot-layer.js` */
  /* Снятие редукса со слоем движка (`redux-state.js`): `async ({ item, target, gameRoot, stateDir, signal })`; слой снимается, свои dlc освобождаются. */
  reduxRemover = null,
  /* Дозапись в update.rpf (`append-item.js`): снятие последнего дозаписанного мода — откат его записи вместо пересборки архива. Без неё — прежний путь. */
  appendInstall = null,
}) {
  return serializeMutation(async () => {
    onProgress?.({ phase: "prepare", percent: 6, cancellable: true });
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-uninstall");
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const next = structuredClone(current);
    const targetKey = checkedRecordKey(targetId, "Target ID");
    const target = ownRecordValue(next.targets, targetKey);
    if (!target) throw new Error("Игровой профиль не найден.");
    if (target.vanillaGuard && target.vanillaGuard.phase !== "restored")
      throw new Error(
        "Сначала завершите сеанс Vanilla Guard и восстановите профиль.",
      );
    const installed = (target.installed || []).find(
      (item) => item.modId === modId,
    );
    /* Мод из «снятых проверкой файлов» — в игре его уже нет: уходит запись. */
    if (!installed) return forgetParked(target, modId) ? writeState(next, stateDir) : next;
    /* Редукс: данные в своём dlc, регистрация — малый слой движка. Снимает его крючок приложения (слой `remove`, dlc `release`);
       отказ — запись остаётся, а не прячется, чтобы человек мог повторить или «Починить». */
    if (reduxLayerOf(installed)) {
      if (typeof reduxRemover !== "function")
        throw new Error("Редукс снимается только приложением с движком: без него слой не снять.");
      onProgress?.({ phase: "compose", percent: 24, cancellable: true });
      await reduxRemover({ item: structuredClone(installed), target: structuredClone(target), gameRoot: target.gameRoot, stateDir, signal });
      target.installed = target.installed.filter((item) => item.modId !== modId);
      onProgress?.({ phase: "commit", percent: 94, cancellable: false });
      const written = await writeState(next, stateDir);
      onProgress?.({ phase: "finalizing", percent: 99, cancellable: false });
      return written;
    }
    onProgress?.({ phase: "compose", percent: 24, cancellable: true });
    if (
      (installed.archiveEntries || []).some(
        (item) => item.target === FAST_WEAPON_DLC_TARGET,
      ) &&
      !(await checkFastWeaponHostReady(target, { resolveInside, sha256File: fingerprintSha256 }))
    ) {
      throw new Error(
        "Astral Weapons DLC изменён. Сначала повторите подготовку GTA V в Astral.",
      );
    }
    const affected = [];
    for (const relativePath of installed.resources || []) {
      const resource = target.resources[relativePath];
      if (!resource) continue;
      resource.layers = (resource.layers || []).filter(
        (layer) => layer.modId !== modId,
      );
      const top = resource.layers.at(-1);
      affected.push({
        relativePath,
        livePath: resolveInside(target.gameRoot, relativePath),
        sourcePath: top?.cachePath || activeBaselinePath(target, resource),
      });
    }
    const affectedArchives = new Set();
    /* Прямые DLC Astral включены, пока в них что-то стоит: снятие последней
       вещи выключает DLC, и update.rpf возвращается к прежнему виду. */
    const directDlcs = directDlcsOf(installed, target.directDlcRegistrations);
    /* Отпечатки файлов после снятия помнит только DLC оружия. */
    const uninstallsFastWeapon = directDlcs.some(
      (dlc) => dlc.name === FAST_WEAPON_DLC_NAME,
    );
    const paths = statePaths(stateDir);
    await rebaseBeforeUninstall({
      target,
      installed,
      touchesDirectDlc: directDlcs.length > 0,
      paths,
      targetKey,
      contentXmlProvider,
      dlcListProvider,
      signal,
    });
    /* Остальные архивы мода (звук, пакеты дополнений): правка, сделанная
       в них после Astral, остаётся при снятии (задача 1 ТЗ 07.10.2026). */
    for (const archiveTarget of new Set(
      (installed.archiveEntries || []).map((item) => item.target),
    ))
      await rebaseArchiveIfNeeded({ target, archiveTarget, paths, targetKey, signal });
    for (const archiveTarget of removeModLayers(target, installed, modId))
      affectedArchives.add(archiveTarget);
    addCarrierRegistryArchive(target, affectedArchives); /* контейнер в носителе (`update2.rpf`) снят: из `content.xml` в `update.rpf` уходит и его регистрация */
    await addSubpackHostArchives({ target, archives: affectedArchives, root: target.gameRoot, paths, targetKey, signal }); /* контейнер в подпакете (`dlc<N>.rpf`) снят: из `content.xml` и `setup2.xml` хозяина уходят регистрация и число (`subpack-closure.js`) */
    if (await settleAudioSlotLayer({ audioSlotSettler, target, targetKey, paths, signal })) affectedArchives.add("update/update.rpf"); /* снят пак звуков или редукс со своим audioconfig: слот звука пересчитан */
    for (const dlc of directDlcs) {
      const remainingLayers = Object.values(
        target.archives?.[dlc.target]?.entries || {},
      ).some((entry) => (entry.layers || []).length > 0);
      if (remainingLayers) continue;
      delete target.directDlcRegistrations?.[dlc.name];
      await composeDirectDlcRegistry({
        target,
        targetKey,
        paths,
        dlcListProvider,
        archiveTarget: "update/update.rpf",
      });
      if (dlc.state && target[dlc.state]) target[dlc.state].preparedOnly = true;
      affectedArchives.add("update/update.rpf");
    }
    /* «Одна запись вместо двух» при снятии (`ops-build.js`): подмена по умолчанию от приложения; `null` — прежний путь. */
    const engineInstall = defaultOpsEngineFor({ gameRoot: target.gameRoot, workId: modId });
    const opsHold = opsAllowedFor(engineInstall) && typeof engineInstall.writerFor === "function" && (await opsHoldIsKnown(engineInstall));
    for (const archiveTarget of affectedArchives) {
      if (isAstralUpdateTarget(archiveTarget)) {
        await composeAstralContentRegistry({
          target,
          targetKey,
          paths,
          contentXmlProvider,
          archiveTarget,
          carrierWriting: new Set([...affectedArchives].filter((archive) => LIVE_CARRIER_TARGETS.includes(archive))),
        });
      }
      const sourcePath = await composeArchiveResource({
        target,
        archiveTarget,
        targetKey: targetId,
        edition: target.edition,
        gameRoot: target.gameRoot,
        paths,
        rpfComposer,
        tracerMaterializer,
        ptfxTextureMaterializer,
        awcMaterializer,
        bloodRoutingMaterializer,
        audioRelMaterializer,
        audioChunkMaterializer,
        signal,
        assertRuntimeSafety,
        /* update.rpf не пишется, пока не ясно, откатить ли запись дозаписи или собрать архив (`transact` решает и собирает сам). */
        deferBuild:
          (Boolean(appendInstall) && archiveTarget.toLowerCase() === "update/update.rpf" && affectedArchives.size === 1) ||
          /* «Одна запись вместо двух»: движок соберёт архив рядом с живым файлом и подменит сам (`ops-build.js`). */
          (opsHold && archiveTarget === ASTRAL_UPDATE_TARGET),
      });
      affected.push({
        relativePath: archiveTarget,
        livePath: resolveInside(target.gameRoot, archiveTarget),
        sourcePath,
      });
    }
    if (installed.dlcName) {
      target.dlcRegistrations ||= {};
      const registration = target.dlcRegistrations[installed.dlcName];
      if (registration?.modId === modId) {
        delete target.dlcRegistrations[installed.dlcName];
      }
      const sourcePath = await composeManagedDlcList({
        target,
        targetKey: targetId,
        paths,
      });
      affected.push({
        relativePath: MANAGED_DLC_LIST_TARGET,
        livePath: resolveInside(target.gameRoot, MANAGED_DLC_LIST_TARGET),
        sourcePath,
      });
    }
    pruneEmptySubpackResources(target, affectedArchives); /* подпакет без записей: файл удалится подменой без источника, ресурс и записи уходят из состояния */
    orderForCarriers(affected, "remove"); /* носитель среди целей (`carrier-order.js`): при снятии `update.rpf` первым, носители последними; без носителя порядок прежний */
    /* Отложенную сборку `update.rpf` движок возьмёт в два шага (`transactions.js`); проверка между шагами пустая, как у прежнего
       пути при снятии. Кто исполнит сборку (дозапись, движок, прежний способ), решает `transact`. */
    if (opsHold)
      for (const item of affected) {
        if (item.relativePath !== ASTRAL_UPDATE_TARGET) continue;
        const build = deferredBuildFor(item.sourcePath);
        if (build && (await opsRouteIsOpen(item, build, engineInstall, signal))) item.verifyHeld = async () => {};
      }
    target.installed = target.installed.filter((item) => item.modId !== modId);
    onProgress?.({
      phase: "ready-to-commit",
      percent: 90,
      cancellable: true,
    });
    await assertRuntimeSafe(
      assertRuntimeSafety,
      signal,
      "before-uninstall-commit",
    );
    onProgress?.({ phase: "commit", percent: 94, cancellable: false });
    const result = await transact({
      stateDir,
      current,
      next,
      targetId,
      affected,
      action: "uninstall",
      signal,
      engineInstall,
      ...(appendInstall ? { appendInstall } : {}),
      /* Байты подмены идут той же фазой `commit`: снятие мода — это тоже
         пересборка и подмена архива игры, и молчать ей нельзя. */
      onStaging: onProgress
        ? ({ copiedBytes, totalBytes }) =>
            onProgress({
              phase: "commit",
              percent: 94,
              cancellable: false,
              copiedBytes,
              totalBytes,
            })
        : null,
    });
    await pruneEmptyManagedDirectories(
      target.gameRoot,
      affected.map((item) => item.relativePath),
    );
    if (uninstallsFastWeapon) {
      const savedTarget = ownRecordValue(result.targets, targetKey);
      const [updateStat, hostStat] = await Promise.all([
        fs.lstat(resolveInside(target.gameRoot, "update/update.rpf")),
        fs.lstat(resolveInside(target.gameRoot, FAST_WEAPON_DLC_TARGET)),
      ]);
      savedTarget.fastWeaponDlc.updateIdentity = {
        size: updateStat.size,
        mtimeMs: updateStat.mtimeMs,
      };
      savedTarget.fastWeaponDlc.hostIdentity = {
        size: hostStat.size,
        sha256: await sha256File(
          resolveInside(target.gameRoot, FAST_WEAPON_DLC_TARGET),
        ),
      };
      await writeState(result, stateDir);
    }
    onProgress?.({ phase: "finalizing", percent: 99, cancellable: false });
    return result;
  });
}

export function resetTarget(input = {}) {
  return restoreTargetBaseline({ ...input, mode: "clean" });
}

export function restoreOriginalTarget(input = {}) {
  return restoreTargetBaseline({ ...input, mode: "original" });
}

export async function listRestorePoints({
  targetId = "default",
  stateDir = DEFAULT_DIR,
} = {}) {
  await recoverPendingTransactions({ stateDir });
  const state = await readState(stateDir);
  return (state.restorePoints?.[targetId] || []).map(
    ({ snapshot: _snapshot, snapshotZ: _packed, ...point }) => point,
  );
}

export async function restorePoint({
  targetId = "default",
  restorePointId,
  stateDir = DEFAULT_DIR,
  /* Чем собрать архив точки заново, если копии её сборки в кэше нет («одна запись вместо двух»: сборка перенесена в игру). */
  rpfComposer = null,
  signal = null,
}) {
  return serializeMutation(async () => {
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const targetKey = checkedRecordKey(targetId, "Target ID");
    const target = ownRecordValue(current.targets, targetKey);
    if (!target) throw new Error("Игровой профиль не найден.");
    if (target.vanillaGuard && target.vanillaGuard.phase !== "restored")
      throw new Error(
        "Сначала завершите сеанс Vanilla Guard и восстановите профиль.",
      );

    const point = (current.restorePoints?.[targetId] || []).find(
      (item) => item.id === String(restorePointId || ""),
    );
    const snapshot = restorePointSnapshot(point);
    if (!snapshot)
      throw new Error("Контрольная точка больше не найдена.");
    /* Точка снята до переноса хранилища — её пути тоже к текущему. */
    await reanchorStatePaths(snapshot, statePaths(stateDir).root);
    if (
      snapshot.gameRoot &&
      path.resolve(snapshot.gameRoot) !== path.resolve(target.gameRoot)
    ) {
      throw new Error("Контрольная точка относится к другой установке GTA V.");
    }

    const next = structuredClone(current);
    const desired = ownRecordValue(next.targets, targetKey);
    desired.baselineMode =
      snapshot.baselineMode === "clean" ? "clean" : "original";
    desired.installed = structuredClone(snapshot.installed || []);
    desired.archives = structuredClone(snapshot.archives || {});
    /* Снимок бывает старше строчных путей: записи и опись — к ним. */
    canonicalTargetRecords(desired);
    desired.dlcRegistrations = structuredClone(snapshot.dlcRegistrations || {});
    desired.directDlcRegistrations = structuredClone(
      snapshot.directDlcRegistrations || {},
    );
    desired.fastWeaponDlc = structuredClone(snapshot.fastWeaponDlc || null);
    desired.clothingDlc = structuredClone(snapshot.clothingDlc || null);
    // Контрольные точки старого формата не знали о слое Astral: его
    // подготовка не зависит от списка модов, поэтому текущее значение
    // остаётся, а не стирается.
    if (Object.hasOwn(snapshot, "astralLayer")) {
      desired.astralLayer = structuredClone(snapshot.astralLayer || null);
    }
    const paths = statePaths(stateDir);
    const affected = [];

    for (const [relativePath, resource] of Object.entries(
      desired.resources || {},
    )) {
      resource.layers = structuredClone(
        snapshot.layers?.[relativePath] || [],
      );
      const top = resource.layers.at(-1);
      let sourcePath = null;
      let expectedHash = null;
      if (top) {
        sourcePath = assertCompositeSource(paths, top.cachePath);
        expectedHash = top.sha256 || null;
      } else {
        const baseline = activeBaseline(desired, resource);
        if (baseline.exists) {
          sourcePath = assertAbsoluteInside(paths.bases, baseline.path);
          expectedHash = baseline.sha256 || null;
        }
      }
      if (sourcePath) {
        /* Сборки точки в кэше нет — она собирается заново из основы и слоёв снимка: отпечаток сверяется ниже, как у копии. */
        if (top && !(await exists(sourcePath)) && typeof rpfComposer === "function" && desired.archives?.[relativePath])
          sourcePath = assertCompositeSource(
            paths,
            await composeArchiveResource({ target: desired, archiveTarget: relativePath, targetKey, edition: desired.edition, gameRoot: desired.gameRoot, paths, rpfComposer, signal }),
          );
        if (!(await exists(sourcePath)))
          throw new Error(`Файл контрольной точки недоступен: ${relativePath}`);
        if (expectedHash && (await sha256File(sourcePath)) !== expectedHash)
          throw new Error(`Файл контрольной точки повреждён: ${relativePath}`);
      }
      affected.push({
        relativePath,
        livePath: resolveInside(target.gameRoot, relativePath),
        sourcePath,
      });
    }

    return transact({
      stateDir,
      current,
      next,
      targetId,
      affected: orderForRestoreOf(affected, target, desired) /* носитель среди целей — порядок по точке (`carrier-order.js`), без носителя прежний */,
      action: "restore-point",
    });
  });
}

export { getVanillaGuardStatus };

export async function suspendTarget({
  gameRoot,
  targetId = "default",
  edition = null,
  stateDir = DEFAULT_DIR,
} = {}) {
  return serializeMutation(async () => {
    const root = path.resolve(String(gameRoot || ""));
    await assertGameRoot(root);
    const key = targetKeyFor(targetId, root);
    checkedRecordKey(key, "Target ID");
    const current = await readState(stateDir);
    const next = structuredClone(current);
    const target = ownRecordValue(next.targets, key) || {
      id: key,
      gameRoot: root,
      edition,
      baselineMode: "original",
      installed: [],
      resources: {},
    };
    if (path.resolve(target.gameRoot) !== root)
      throw new Error("Игровой профиль уже связан с другой папкой GTA V.");
    if (target.vanillaGuard && target.vanillaGuard.phase !== "restored")
      return getVanillaGuardStatus({ targetId: key, stateDir });

    const sessionId = randomUUID();
    const guardRelative = `.astral-vanilla/${sessionId}`;
    const guardRoot = resolveInside(root, guardRelative);
    const items = [];
    for (const source of VANILLA_GUARD_ITEMS) {
      const originalPath = resolveInside(root, source);
      if (!(await exists(originalPath))) continue;
      const details = await fs.lstat(originalPath);
      if (details.isSymbolicLink())
        throw new Error(
          `Vanilla Guard не перемещает символические ссылки: ${source}`,
        );
      if (
        source === "mods" || source === "newmods"
          ? !details.isDirectory()
          : !details.isFile()
      )
        throw new Error(`Неожиданный тип объекта в папке GTA V: ${source}`);
      items.push({
        source,
        disabled: `${guardRelative}/${source}`,
        moved: false,
      });
    }

    target.gameRoot = root;
    target.edition = edition || target.edition || null;
    target.vanillaGuard = {
      id: sessionId,
      phase: "prepared",
      startedAt: new Date().toISOString(),
      items,
    };
    setRecordValue(next.targets, key, target);
    await writeState(next, stateDir);

    try {
      await fs.mkdir(guardRoot, { recursive: true });
      for (const item of target.vanillaGuard.items) {
        const sourcePath = resolveInside(root, item.source);
        const disabledPath = resolveInside(root, item.disabled);
        await fs.mkdir(path.dirname(disabledPath), { recursive: true });
        await fs.rename(sourcePath, disabledPath);
        item.moved = true;
        await writeState(next, stateDir);
      }
      target.vanillaGuard.phase = "active";
      await writeState(next, stateDir);
      return getVanillaGuardStatus({ targetId: key, stateDir });
    } catch (error) {
      for (const item of [...target.vanillaGuard.items].reverse()) {
        if (!item.moved) continue;
        const sourcePath = resolveInside(root, item.source);
        const disabledPath = resolveInside(root, item.disabled);
        if (!(await exists(sourcePath)) && (await exists(disabledPath)))
          await fs.rename(disabledPath, sourcePath).catch(() => {});
      }
      delete target.vanillaGuard;
      await writeState(next, stateDir).catch(() => {});
      await fs.rm(guardRoot, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  });
}

export async function resumeTarget({
  targetId = "default",
  stateDir = DEFAULT_DIR,
} = {}) {
  return serializeMutation(async () => {
    const state = await readState(stateDir);
    const targetKey = checkedRecordKey(targetId, "Target ID");
    const target = ownRecordValue(state.targets, targetKey);
    const guard = target?.vanillaGuard;
    if (!target || !guard)
      return { targetId, active: false, phase: "inactive", moved: [] };
    const root = path.resolve(target.gameRoot);
    await assertGameRoot(root);
    guard.phase = "restoring";
    await writeState(state, stateDir);

    for (const item of [...(guard.items || [])].reverse()) {
      const sourcePath = resolveInside(root, item.source);
      const disabledPath = resolveInside(root, item.disabled);
      if (!(await exists(disabledPath))) {
        item.moved = false;
        continue;
      }
      if (await exists(sourcePath)) {
        guard.phase = "restore-conflict";
        await writeState(state, stateDir);
        throw new Error(
          `Нельзя восстановить ${item.source}: в папке игры уже появился объект с таким именем.`,
        );
      }
      await fs.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.rename(disabledPath, sourcePath);
      item.moved = false;
      await writeState(state, stateDir);
    }

    const guardRoot = resolveInside(root, `.astral-vanilla/${guard.id}`);
    await fs.rm(guardRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rmdir(resolveInside(root, ".astral-vanilla")).catch(() => {});
    delete target.vanillaGuard;
    await writeState(state, stateDir);
    return { targetId, active: false, phase: "inactive", moved: [] };
  });
}

export async function getProfile({ stateDir = DEFAULT_DIR } = {}) {
  await recoverPendingTransactions({ stateDir });
  return readState(stateDir);
}

// UI status discovery is intentionally read-only. Pending transaction
// recovery may restore snapshots into GTA and therefore belongs only to an
// explicit mutating workflow, never to opening the Mega Mall editor.
// Read-only also means shared: one frozen parse per version of the state
// file for every reader (`readStateShared`, задача 6 ТЗ 08.10.2026).
export async function inspectProfile({ stateDir = DEFAULT_DIR } = {}) {
  return readStateShared(stateDir);
}

const ENGINE_FEATURES =
  "layered-rollback,signed-packages,preflight-conflicts,auto-heal,vanilla-guard,rpf-entry-composition,rageopenv-loose-vfs,managed-addon-dlc-registry,clean-and-original-global-restore,astral-layer".split(
    ",",
  );
export const installEngineInfo = {
  schemaVersion: 6,
  mode: "transactional",
  features: ENGINE_FEATURES,
  forbiddenExtensions: [...FORBIDDEN_EXTENSIONS],
  defaultStateDirectory: DEFAULT_DIR,
};
