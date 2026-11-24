import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { carrierOfTarget, isSubpackCarrier, protectedOriginalName } from "./carrier-targets.js";
import {
  checkedRecordKey,
  ownRecordValue,
  setRecordValue,
} from "./state-record.js";
import { MANAGED_DLC_LIST_TARGET } from "./registry-composers.js";
import {
  activeBaselinePath,
  copyBaseline,
  exists,
  missingBaseline,
} from "./storage-state.js";
import { copyFileCancellable } from "./transaction.js";
import { observeUpdateBase } from "./update-guard.js";
import {
  isModsTarget,
  mergeDlcListXml,
  resolveInside,
  sha256File,
  stripAstralDlcListXml,
} from "./manifest.js";
import {
  materializeTimecycleComposite,
  timecycleCompositionNeedsBase,
} from "./timecycle-composition.js";
import { materializeDecorationOverlayComposite } from "./decoration-overlay-merge.js";
import { resolveEntryMaterializers } from "./entry-materializers.js";
import { composePackOverlayRegistry } from "./pack-overlay.js";
import { composePackCarrierRegistry } from "./pack-carrier-registry.js";
import { composePackSubpackSetup } from "./pack-subpack-setup.js";
import { SEED_METHOD, composeSubpackInTwoSteps, largestContainerBytes } from "./subpack-two-step.js";
import { isUnifiedPtfxEntry } from "./ptfx-core-entry.js";
import { dropDependentMods } from "./dependents.js";
import { isEffectsCoreEntry } from "./effect-rules.js";
import { assertRuntimeSafe, throwIfAborted } from "./runtime-guard.js";
import { assertAbsoluteInside } from "./engine-state.js";
import { fingerprintSha256, rememberSha256 } from "./file-fingerprint.js";
import { dropLostLayers, ensureBaseFile } from "./base-recovery.js";
import { actionOverStockAbsent, isAstralOwnEntry } from "./astral-paths.js";
import { installTraceActive, megabytes, traceNote, tracedStep } from "./install-trace.js";
import { packedManifestPath } from "./chunk-store.js";
import { compositePlace } from "./composite-home.js";
import { recipeFile, registerDeferredBuild } from "./ops-build.js";

/* Версия формы собранного архива: меняется, когда helper начинает писать
   иначе при тех же операциях. 2 — имена строчными (26.09.2026). 3 — записи
   хранятся, как у игры: банк AWC несжатым, сжатое не шире 24-битного поля
   оглавления (прежняя сборка weapons.awc роняла игру с ERR_GEN_ZLIB_2). */
export const COMPOSITE_FORMAT = 3;

/* Настоящий архив игры (RPF7), а не JSON-подделка тестов. */
async function isRpfArchive(file) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const head = Buffer.alloc(4);
    const { bytesRead } = await handle.read(head, 0, 4, 0);
    return bytesRead === 4 && head.toString("latin1") === "7FPR";
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/*
 * Копия архива «как было» — жёсткой ссылкой, если том позволяет (01.11.2026, диск в
 * сотку у тестеров): архив в игре подменяется переименованием, поэтому ссылка держит
 * прежние байты, а установка первого мода в DLC на полтора гигабайта не пишет их второй
 * раз. Остыв, такая копия уходит в куски и опись (`stored-copies.js`). Другой том или том
 * без ссылок — копия, как раньше.
 */
async function keepBaseCopy(source, destination, signal, onProgress) {
  const stage = `${destination}.${randomUUID()}.stage`;
  try {
    await fs.link(source, stage);
    await fs.rename(stage, destination);
    const { size } = await fs.stat(destination);
    onProgress?.(size, size);
    /* Те же байты: отпечаток архива, если он уже известен, не читается второй раз. */
    await rememberSha256(destination, await fingerprintSha256(source));
    return;
  } catch {
    await fs.rm(stage, { force: true }).catch(() => {});
  }
  await copyFileCancellable(source, destination, signal, onProgress);
}

async function ensureArchiveResource({
  target,
  archiveTarget,
  root,
  paths,
  targetKey,
  signal = null,
  onProgress = null,
}) {
  throwIfAborted(signal);
  target.resources ||= {};
  target.archives ||= {};
  const resourceKey = checkedRecordKey(archiveTarget, "Archive target");
  let resource = ownRecordValue(target.resources, resourceKey);
  /*
   * Подпакет штатного пакета (`pack-sub`, `carrier-targets.js`): файла в чистой игре нет, его создаёт установка, поэтому основа — «нет файла» (`missingBaseline`), а собирается он с нуля (`composeArchiveResourceOnce`).
   * Файл на месте цели, о котором состояние не знает, — чужой: полоса недоступна, файл не трогаем (решение лида 1, Р7).
   */
  if (!resource && isSubpackCarrier(carrierOfTarget(archiveTarget))) {
    if (await exists(resolveInside(root, archiveTarget)))
      throw new Error(
        `На месте ${archiveTarget} лежит файл, которого Astral не создавал (в состоянии его нет): подпакет недоступен, файл не тронут. Уберите его или поставьте работу в другой носитель.`,
      );
    resource = setRecordValue(target.resources, resourceKey, {
      base: missingBaseline(),
      compositionBase: missingBaseline(),
      original: missingBaseline(),
      clean: missingBaseline(),
      layers: [],
    });
  }
  if (!resource) {
    const livePath = resolveInside(root, archiveTarget);
    const originalExists = await exists(livePath);
    let baseSource = originalExists ? livePath : null;
    if (!baseSource && archiveTarget.startsWith("mods/")) {
      const originalRelative = archiveTarget.slice("mods/".length);
      const originalPath = resolveInside(root, originalRelative);
      if (await exists(originalPath)) baseSource = originalPath;
    }
    if (!baseSource)
      throw new Error(
        `Не найден исходный RPF-архив для выборочной сборки: ${archiveTarget}`,
      );
    const sourceStat = await fs.lstat(baseSource);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
      throw new Error(`Исходный RPF-архив небезопасен: ${archiveTarget}`);
    /* `update.rpf` и носитель (`update2.rpf`) — под защищённым именем (`carrier-targets.js`), остальные — `<sha256 пути>.composition.rpf`. */
    const compositionName =
      protectedOriginalName(archiveTarget) ?? `${createHash("sha256").update(archiveTarget.toLowerCase()).digest("hex")}.composition.rpf`;
    const compositionPath = path.join(paths.bases, targetKey, compositionName);
    await fs.mkdir(path.dirname(compositionPath), { recursive: true });
    /* Копия снимается заново: прежняя опись кусков (`chunk-store.js`) называла другие байты. */
    await fs.rm(packedManifestPath(compositionPath), { force: true }).catch(() => {});
    /*
     * Копирование в резерв считается для любого архива, а не только для
     * update.rpf. Раньше исключение имело смысл ради процентов — шкала
     * `90 + доля * 3` подогнана под него одного, — но молчала на нём и
     * `RESIDENT.rpf`, в котором полтора гигабайта: звуковой набор ставился
     * с той же немой паузой, от которой избавляли карты.
     */
    await keepBaseCopy(
      baseSource,
      compositionPath,
      signal,
      onProgress
        ? (copied, total) =>
            onProgress({
              phase: "backup",
              percent: Math.min(93, 90 + Math.floor((copied / total) * 3)),
              copiedBytes: copied,
              totalBytes: total,
              cancellable: true,
            })
        : null,
    );
    throwIfAborted(signal);
    const compositionBase = {
      exists: true,
      path: compositionPath,
      sha256: await fingerprintSha256(compositionPath),
      verified: true,
    };
    resource = {
      base: compositionBase,
      compositionBase,
      original: originalExists
        ? copyBaseline(compositionBase)
        : missingBaseline(),
      clean: isModsTarget(archiveTarget)
        ? missingBaseline()
        : { ...copyBaseline(compositionBase), verified: false },
      layers: [],
    };
    setRecordValue(target.resources, resourceKey, resource);
  }
  let archive = ownRecordValue(target.archives, resourceKey);
  if (!archive) {
    archive = setRecordValue(target.archives, resourceKey, { entries: {} });
  }
  archive.entries ||= {};
  return { resource, archive };
}

async function ensureManagedDlcListResource({
  target,
  root,
  paths,
  targetKey,
  edition,
  dlcListProvider,
}) {
  target.resources ||= {};
  const existing = ownRecordValue(target.resources, MANAGED_DLC_LIST_TARGET);
  if (existing) return existing;
  const livePath = resolveInside(root, MANAGED_DLC_LIST_TARGET);
  let originalExists = await exists(livePath);
  const compositionPath = path.join(
    paths.bases,
    targetKey,
    `${createHash("sha256").update(MANAGED_DLC_LIST_TARGET).digest("hex")}.composition.xml`,
  );
  await fs.mkdir(path.dirname(compositionPath), { recursive: true });
  /* `newmods` — папка самого Astral, и строку `dlcpacks:/astral_…/` в её списке пишет только управляемый DLC. Список со
     следами, о которых состояние ничего не знает (оставшийся от прежней установки), — наш же прежний результат, а не «игра до
     Astral»: принять его за оригинал значило бы возвращать строку при каждом снятии (стенд Х15, 26.10.2026: `astral_davis_megamall`). */
  let leftover = null;
  if (originalExists) {
    const stat = await fs.lstat(livePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Существующий newmods dlclist.xml небезопасен.");
    }
    const cleaned = stripAstralDlcListXml(await fs.readFile(livePath, "utf8"));
    if (cleaned.removed.length) {
      leftover = cleaned.xml;
      originalExists = false;
    } else await fs.copyFile(livePath, compositionPath);
  }
  if (!originalExists) {
    if (typeof dlcListProvider !== "function") {
      if (leftover === null)
        throw new Error(
          "Компонент извлечения чистого dlclist.xml не установлен. Обновите Astral или запустите Setup Doctor.",
        );
      mergeDlcListXml(leftover, []);
      await fs.writeFile(compositionPath, leftover, "utf8");
    } else {
      const stage = `${compositionPath}.${randomUUID()}.stage`;
      try {
        await dlcListProvider({
          gameRoot: root,
          edition,
          output: stage,
        });
        const stat = await fs.lstat(stage);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 32) {
          throw new Error("Извлечённый dlclist.xml некорректен.");
        }
        mergeDlcListXml(await fs.readFile(stage, "utf8"), []);
        await fs.rename(stage, compositionPath);
      } catch (error) {
        await fs.rm(stage, { force: true }).catch(() => {});
        throw error;
      }
    }
  }
  const compositionBase = {
    exists: true,
    path: compositionPath,
    sha256: await sha256File(compositionPath),
    verified: true,
  };
  const resource = {
    base: compositionBase,
    compositionBase,
    original: originalExists
      ? copyBaseline(compositionBase)
      : missingBaseline(),
    clean: missingBaseline(),
    layers: [],
  };
  setRecordValue(target.resources, MANAGED_DLC_LIST_TARGET, resource);
  return resource;
}

/*
 * Сборка архива с каскадом зависимых слоёв (10.11.2026): слой крови, которому после этой сборки не хватает правил в ядре эффектов (ядро автора снято или
 * заменено ядром другого редукса), снимается той же операцией, а не остаётся стоять на правилах, которых нет. Ставящиеся прямо сейчас пакеты
 * (`protectedModIds`) не снимаются: кровь без правил при установке по-прежнему отказ. Каскад — либо для всех зависимых, либо отказ.
 */
const MAX_CASCADE_ROUNDS = 3;
const MODEL_ENTRY = /\.(?:ydr|ydd|yft)$/i;
async function composeArchiveResource({ protectedModIds = null, ...options }) {
  for (let round = 0; ; round += 1) {
    try {
      return await composeArchiveResourceOnce(options);
    } catch (error) {
      if (error?.code !== "effect-rules-missing" || round >= MAX_CASCADE_ROUNDS) throw error;
      const decision = dropDependentMods(options.target, options.archiveTarget, error.dependents || [], { protectedModIds, dryRun: true });
      if (decision.kept.length || !decision.removed.length) throw error;
      dropDependentMods(options.target, options.archiveTarget, error.dependents, { protectedModIds, cause: "в собранном ядре эффектов нет их правил" });
    }
  }
}

async function composeArchiveResourceOnce({
  target,
  archiveTarget,
  targetKey,
  edition,
  gameRoot,
  paths,
  rpfComposer,
  signal = null,
  assertRuntimeSafety = null,
  onProgress = null,
  /* Сборка откладывается (`ops-build.js`): файл не пишется, запрос на сборку запоминается, а `transact` отдаёт его движку. */
  deferBuild = false,
  /* Подпакеты хозяина (`dlc<N>.rpf`, `pack-carrier-registry.js`): `Set` имён контейнеров, что лежат в файлах подпакетов сейчас, или `null` — по состоянию (регистрации и число подпакетов без сверки с диском). */
  subpackPresence = null,
  ...explicitMaterializers
}) {
  /* Сборщики записей: переданные вызовом или зарегистрированные
     приложением (`entry-materializers.js`). */
  const {
    tracerMaterializer,
    ptfxTextureMaterializer,
    awcMaterializer,
    bloodRoutingMaterializer,
    audioRelMaterializer,
    weaponsMetaMaterializer,
    timecycleMaterializer,
    audioChunkMaterializer,
    clipRowsMaterializer,
    packContentMaterializer,
    modelSafetyGuard,
  } = resolveEntryMaterializers(explicitMaterializers);
  const resource = target.resources[archiveTarget];
  const archive = target.archives?.[archiveTarget];
  /* Копия основы пропала из кэша — основой становится живой архив игры
     (`base-recovery.js`), а не отказ на каждой установке. */
  await ensureBaseFile({ target, archiveTarget, paths, targetKey, gameRoot, signal });
  /* Наблюдатель `update.rpf` (`update-guard.js`): расхождение с основой — в журнал, сборка идёт как раньше. */
  if (!deferBuild) await observeUpdateBase({ target, archiveTarget, gameRoot });
  /* У мода пропали файлы в хранилище — он снимается из архива (тот же файл
     у другого мода кладётся на место), остальные ставятся. */
  await dropLostLayers({ target, archiveTarget, paths });
  const compositionBase = resource?.compositionBase || resource?.base;
  /* Подпакет, которого ещё нет в игре (`ensureArchiveResource`: основа «нет файла»), собирается с нуля из своих записей: `baseArchive: null` — помощник создаёт корневой архив. */
  const fromScratch = !compositionBase?.exists && isSubpackCarrier(carrierOfTarget(archiveTarget));
  if ((!compositionBase?.exists && !fromScratch) || !archive)
    throw new Error(`Состояние RPF-архива повреждено: ${archiveTarget}`);
  /* Свой overlay-RPF в штатном паке: строки в его `content.xml` — пока в нём что-то стоит (`pack-overlay.js`). */
  await composePackOverlayRegistry({
    target,
    archiveTarget,
    targetKey,
    gameRoot,
    edition,
    paths,
    compositionBase,
    reader: packContentMaterializer,
    signal,
  });
  /* Штатный пакет-носитель (`carrier-targets.js`): регистрация наших контейнеров — в `content.xml` самого пакета, пока они в нём стоят (`pack-carrier-registry.js`); `update.rpf` не нужен. */
  await composePackCarrierRegistry({
    target,
    archiveTarget,
    targetKey,
    gameRoot,
    edition,
    paths,
    compositionBase,
    reader: packContentMaterializer,
    presence: subpackPresence,
    signal,
  });
  /* Число подпакетов в `setup2.xml` хозяина (`pack-subpack-setup.js`): штатное плюс занятые нашими контейнерами подпакеты; рядом с регистрацией, из того же состояния. */
  await composePackSubpackSetup({
    target,
    archiveTarget,
    targetKey,
    gameRoot,
    edition,
    paths,
    compositionBase,
    reader: packContentMaterializer,
    presence: subpackPresence,
    signal,
  });
  const operations = [];
  /* Все записи таймцикла по именам собраны поверх файла игры (падение
     12.10.2026, `composite-refresh.js` пересобирает сборки без отметки). */
  let timecycleOverBase = true;
  /* Записи движка, которые основа уже несёт (`direct-update-rebase.js`):
     новая установка ложится поверх, снятая — уходит из основы. */
  const carried = new Set(compositionBase.carried || []);
  /* Записи основы, которые слой перекрывает, а снятие слоя возвращает
     (пустые постоянные типы основы пакета мест). */
  const overlays = new Set(compositionBase.overlays || []);
  /* Записи, где работа мастерской лежит поверх слоя (`workOver`, перебазирование на живой
     архив): пока сверху тот же слой, запись остаётся как в основе — слой, лёгший раньше работы,
     её не затирает. Запись о слое, который сняли или перекрыл другой, здесь же забывается. */
  const workOver = compositionBase.workOver || null;
  const stillOver = {};
  for (const entry of carried) {
    const top = ownRecordValue(archive.entries || {}, entry)?.layers?.at(-1);
    if (top && top.action !== "delete") continue;
    operations.push({
      entry,
      action: "delete",
      allowDelete: true,
      allowMissing: true,
      modId: "@carried-removal",
    });
  }
  /* Ядро эффектов собирается раньше остального: кровь сверяет правила с ним (`composedCore`), и порядок пакетов в пачке этого не решает. */
  const coreFirst = [...Object.entries(archive.entries || {})].sort(([left], [right]) => Number(isEffectsCoreEntry(right)) - Number(isEffectsCoreEntry(left)));
  for (const [entry, entryState] of coreFirst) {
    const layers = entryState.layers || [];
    const top = layers.at(-1);
    if (!top) continue;
    if (carried.has(entry) && top.action === "delete") continue;
    if (isUnifiedPtfxEntry(layers)) {
      if (typeof ptfxTextureMaterializer !== "function") {
        throw new Error("Компонент композиции PTFX не установлен.");
      }
      const source = await ptfxTextureMaterializer({
        layers,
        entry,
        archiveTarget,
        baseArchive: compositionBase.path,
        targetKey,
        edition,
        gameRoot,
        stateDir: paths.root,
        signal,
      });
      operations.push({
        entry,
        action:
          layers.find((layer) => layer.merge?.strategy === "ptfx-core-base-v1")
            ?.action || "replace",
        source,
        sha256: await sha256File(source),
        modId: top.modId,
      });
      continue;
    }
    if (top.merge?.strategy === "astral-tracer-v1") {
      if (typeof tracerMaterializer !== "function") {
        throw new Error(
          "Компонент композиции трассеров не установлен. Обновите системные компоненты Astral.",
        );
      }
      const source = await tracerMaterializer({
        layers,
        entry,
        archiveTarget,
        baseArchive: compositionBase.path,
        targetKey,
        edition,
        gameRoot,
        stateDir: paths.root,
        signal,
      });
      operations.push({
        entry,
        action: "replace",
        source,
        sha256: await sha256File(source),
        modId: top.modId,
      });
      continue;
    }
    if (top.merge?.strategy === "ypt-texture-layer-v1") {
      if (typeof ptfxTextureMaterializer !== "function") {
        throw new Error("Компонент композиции PTFX не установлен.");
      }
      const source = await ptfxTextureMaterializer({
        layers,
        entry,
        archiveTarget,
        baseArchive: compositionBase.path,
        targetKey,
        edition,
        gameRoot,
        stateDir: paths.root,
        signal,
      });
      operations.push({
        entry,
        action:
          layers.find((layer) => layer.merge?.strategy === "ptfx-core-base-v1")
            ?.action || "replace",
        source,
        sha256: await sha256File(source),
        modId: top.modId,
      });
      continue;
    }
    if (top.merge?.strategy === "awc-stream-layer-v1") {
      if (typeof awcMaterializer !== "function") {
        throw new Error("Компонент композиции звуков AWC не установлен.");
      }
      const source = await awcMaterializer({
        /* Слот банка берётся из audioconfig, записанного в состоянии (`audio-slot-layer.js`). */
        target,
        layers,
        entry,
        archiveTarget,
        baseArchive: compositionBase.path,
        targetKey,
        edition,
        gameRoot,
        stateDir: paths.root,
        signal,
      });
      operations.push({
        entry,
        action: "replace",
        source,
        sha256: await sha256File(source),
        modId: top.modId,
      });
      continue;
    }
    if (top.merge?.strategy === "blood-routing-v1") {
      if (typeof bloodRoutingMaterializer !== "function") {
        throw new Error(
          "Компонент композиции bloodfx.dat не установлен. Обновите системные компоненты Astral.",
        );
      }
      /* Ядро эффектов, каким оно ляжет в архив после этой сборки (слои автора, тот же проход); нет слоёв на ядре — `null`, и кровь смотрит ядро основы. */
      const composedCore = operations.findLast((operation) => isEffectsCoreEntry(operation.entry) && operation.action !== "delete" && operation.source)?.source || null;
      const source = await bloodRoutingMaterializer({
        layers,
        entry,
        archiveTarget,
        baseArchive: compositionBase.path,
        composedCore,
        targetKey,
        edition,
        gameRoot,
        stateDir: paths.root,
        signal,
      });
      operations.push({
        entry,
        action: "replace",
        source,
        sha256: await sha256File(source),
        modId: top.modId,
      });
      continue;
    }
    if (top.merge?.strategy === "ptx-clip-rows-v1") {
      if (typeof clipRowsMaterializer !== "function") {
        throw new Error(
          "Компонент композиции ptxclipregions.dat не установлен. Обновите системные компоненты Astral.",
        );
      }
      const source = await clipRowsMaterializer({
        layers,
        entry,
        archiveTarget,
        baseArchive: compositionBase.path,
        targetKey,
        edition,
        gameRoot,
        stateDir: paths.root,
        signal,
      });
      operations.push({
        entry,
        action: "replace",
        source,
        sha256: await sha256File(source),
        modId: top.modId,
      });
      continue;
    }
    if (top.merge?.strategy === "weapons-meta-tracer-patch-v1") {
      if (typeof weaponsMetaMaterializer !== "function") {
        throw new Error(
          "Компонент композиции привязок трассеров weapons.meta не установлен. Обновите системные компоненты Astral.",
        );
      }
      const source = await weaponsMetaMaterializer({
        layers,
        entry,
        archiveTarget,
        baseArchive: compositionBase.path,
        targetKey,
        edition,
        gameRoot,
        stateDir: paths.root,
        signal,
      });
      operations.push({
        entry,
        action: "replace",
        source,
        sha256: await sha256File(source),
        modId: top.modId,
      });
      continue;
    }
    if (top.merge?.strategy === "audio-rel-patch-v1") {
      if (typeof audioRelMaterializer !== "function") {
        throw new Error(
          "Компонент правки звуковых метаданных не установлен. Обновите системные компоненты Astral.",
        );
      }
      const source = await audioRelMaterializer({
        layers,
        entry,
        archiveTarget,
        baseArchive: compositionBase.path,
        targetKey,
        edition,
        gameRoot,
        stateDir: paths.root,
        signal,
      });
      operations.push({
        entry,
        action: "replace",
        source,
        sha256: await sha256File(source),
        modId: top.modId,
      });
      continue;
    }
    if (top.merge?.strategy === "astral-audio-chunk-v1") {
      if (typeof audioChunkMaterializer !== "function") {
        throw new Error(
          "Компонент сборки звукового пакета Astral не установлен. Обновите системные компоненты Astral.",
        );
      }
      const source = await audioChunkMaterializer({
        layers,
        entry,
        archiveTarget,
        baseArchive: compositionBase.path,
        targetKey,
        edition,
        gameRoot,
        stateDir: paths.root,
        signal,
      });
      operations.push({
        entry,
        action: "replace",
        source,
        sha256: await sha256File(source),
        modId: top.modId,
      });
      continue;
    }
    /* Коллекция наложений педа — место тату мастерской одежды: свои
       наложения слоёв поверх нижнего документа (`decoration-overlay-merge.js`). */
    if (top.merge?.strategy === "decoration-overlay-v1") {
      const source = await materializeDecorationOverlayComposite({
        layers,
        entry,
        targetKey,
        payloadsRoot: paths.payloads,
        resolveLayerSource: (cachePath) => assertAbsoluteInside(paths.payloads, cachePath),
      });
      operations.push({
        entry,
        /* Файл, которого у игрока не было (`dlc_patch` дополнения), —
           добавляется; бывший — переписывается. Перебазирование делает из
           `import` слоя `upsert` (`direct-update-rebase.js`), а очищенная
           основа файла уже не несёт: `replace` падал «RPF entry not found»
           на любой следующей пересборке update.rpf (07.10.2026). */
        action: layers.some((layer) => layer.action === "import" || layer.action === "upsert")
          ? "upsert"
          : "replace",
        source,
        sha256: await sha256File(source),
        modId: top.modId,
      });
      continue;
    }
    if (top.merge?.strategy === "timecycle-modifier-v1") {
      const resolveLayerSource = (cachePath) =>
        assertAbsoluteInside(paths.payloads, cachePath);
      /*
       * Падение 12.10.2026: update.rpf, собранный скриптом без сборщиков
       * приложения, нёс в timecycle_mods_1.xml одни 16 модификаторов слоя
       * воды вместо 646 файла игры, и GTA V падала на экране загрузки
       * (GTA5.exe+0xe75333: CTimeCycle::Init ищет модификатор по имени,
       * получает −1 и читает мимо массива). Слои по именам поверх
       * настоящего архива без сборщика приложения не собираются — отказ,
       * как у трассеров и звука, а не «огрызок» в игре.
       */
      const needsBase = timecycleCompositionNeedsBase(layers);
      if (typeof timecycleMaterializer !== "function" && needsBase) {
        if (await isRpfArchive(compositionBase.path))
          throw new Error(
            `Компонент композиции таймцикла не установлен: ${entry} собирается поверх файла игры. Обновите системные компоненты Astral.`,
          );
        timecycleOverBase = false;
      }
      /* Сборщик приложения кладёт слои поверх файла из основы и правок
         мастерской; без него — прежняя сборка из одних слоёв. */
      const source =
        typeof timecycleMaterializer === "function"
          ? await timecycleMaterializer({
              layers,
              entry,
              archiveTarget,
              baseArchive: compositionBase.path,
              baseSha256: compositionBase.sha256 || null,
              targetKey,
              edition,
              gameRoot,
              stateDir: paths.root,
              resolveLayerSource,
              signal,
            })
          : await materializeTimecycleComposite({
              layers,
              entry,
              targetKey,
              payloadsRoot: paths.payloads,
              resolveLayerSource,
            });
      operations.push({
        entry,
        action: "replace",
        source,
        sha256: await sha256File(source),
        modId: top.modId,
      });
      continue;
    }
    const over = workOver?.[entry];
    if (over && top.action !== "delete" && over.modId === top.modId && over.sha256 === top.sha256) {
      stillOver[entry] = over;
      continue;
    }
    /* Модель без группы шейдеров («пустышка» автора) игра Legacy не переживает: сторож приложения (`modelSafetyGuard`) запись не кладёт, вещь остаётся штатной (`model-safety-guard.js`). */
    /* Решение сторожа остаётся на слое (`guardDropped`): проверка контейнеров (`own-dlcs.js: verifyAstralLayers`) не требует запись, которую сборка
       сама не положила (23.11.2026: ганпак автора со «спрятанным» обвесом отказывал «стоит в состоянии, а в контейнере нет»). Решение пишется при
       КАЖДОМ обходе слоёв, и когда сборка берётся из кэша: список операций, а с ним и отпечаток сборки, строится здесь же. */
    delete top.guardDropped;
    if (typeof modelSafetyGuard === "function" && top.action !== "delete" && MODEL_ENTRY.test(entry)) {
      const verdict = await modelSafetyGuard({ entry, source: assertAbsoluteInside(paths.payloads, top.cachePath), sha256: top.sha256, modId: top.modId });
      if (verdict?.drop) {
        top.guardDropped = true;
        continue;
      }
    }
    /* Запись, которую пишет только Astral (`isAstralOwnEntry`: папка слоя в
       update.rpf и свои пакеты дополнения), ложится поверх того, что застала
       в основе: манифест работы требует `import`, усыновлённая метка —
       `replace`, а основа после чистки кэша или проверки файлов игры бывает
       и с прежней версией, и без записи. Удалять там то, чего уже нет, —
       нечего. */
    const own = isAstralOwnEntry(archiveTarget, entry, { ours: Boolean(resource) && Boolean(archive?.entries?.[entry]) });
    const action = top.action || "replace";
    operations.push({
      entry,
      /* Радар большой карты, которого в штатном архиве нет (`isStockAbsentEntry`): основа несёт его от прежней карты, очистка вложенный
         архив убрать не умеет, `carried` у очищенной основы пуст — `import` над ним отказывал, как и проверка плана. */
      action:
        (action === "import" && (carried.has(entry) || overlays.has(entry))) ||
        (own && action !== "delete")
          ? "upsert"
          : actionOverStockAbsent(archiveTarget, entry, action),
      ...(top.action === "delete"
        ? {
            allowDelete: top.allowDelete === true,
            ...(top.allowMissing === true || own ? { allowMissing: true } : {}),
          }
        : {
            source: assertAbsoluteInside(paths.payloads, top.cachePath),
            sha256: top.sha256,
          }),
      modId: top.modId,
    });
  }
  if (workOver) {
    if (Object.keys(stillOver).length) compositionBase.workOver = stillOver;
    else delete compositionBase.workOver;
  }
  operations.sort((a, b) => a.entry.localeCompare(b.entry));
  if (!operations.length) {
    resource.layers = [];
    return activeBaselinePath(target, resource);
  }
  if (typeof rpfComposer !== "function")
    throw new Error(
      "Компонент выборочной пересборки RPF не установлен. Обновите Astral или выполните Setup Doctor.",
    );
  for (const operation of operations) {
    if (operation.action === "delete") continue;
    if (!(await exists(operation.source)))
      throw new Error(`Payload RPF-entry недоступен: ${operation.entry}`);
    /* Отпечаток по записи файла (`file-fingerprint.js`): файл хранилища,
       уже сверенный установкой, второй раз не читается. Помощник RPF всё
       равно сверит каждую запись собранного архива с этим SHA-256. */
    if (
      operation.sha256 &&
      (await fingerprintSha256(operation.source)) !== operation.sha256
    )
      throw new Error(`Payload RPF-entry повреждён: ${operation.entry}`);
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        /* Сборки прежнего helper'а (имена как пришли, папка `x64/Astral`)
           из кэша не берутся: те же операции на той же основе давали архив,
           в котором игра не находила наши контейнеры. */
        format: COMPOSITE_FORMAT,
        base: compositionBase.sha256,
        edition,
        /* Подпакет с нуля собирается в два хода (`subpack-two-step.js`): файл не тот же, что одноходовой `create`, — другая сборка, другой отпечаток; у прочих целей поля нет, их отпечатки прежние. */
        ...(fromScratch ? { scratch: SEED_METHOD } : {}),
        operations: operations.map(({ entry, action, sha256 }) => ({
          entry,
          action,
          sha256: sha256 || null,
        })),
      }),
    )
    .digest("hex");
  /* Хранилище на другом томе, чем игра, — сборка ложится на диск игры (`composite-home.js`): два
     гигабайта не пишутся на диск хранилища, а свой пакет дополнения встаёт в игру ссылкой. */
  /* Подпакет с нуля: размеры источников записей — по ним строится затравка и считается место; результат ≈ их сумма. */
  const scratchSizes = fromScratch
    ? new Map(await Promise.all(operations.filter((operation) => operation.action !== "delete").map(async (operation) => [operation, (await fs.stat(operation.source).catch(() => null))?.size || 0])))
    : null;
  const scratchSizeOf = (operation) => scratchSizes?.get(operation) ?? 0;
  const baseBytes = fromScratch ? [...scratchSizes.values()].reduce((sum, size) => sum + size, 0) : (await fs.stat(compositionBase.path).catch(() => null))?.size || 0;
  const { output, cached } = await compositePlace({
    name: `${fingerprint}.rpf`,
    paths,
    targetKey,
    gameRoot,
    /* Второй ход подпакета выносит вложенный контейнер (до 1 ГиБ) во временный файл рядом со сборкой, пока растёт стейдж: место нужно и под него. */
    expectedBytes: fromScratch ? baseBytes + largestContainerBytes(operations, scratchSizeOf) : baseBytes,
  });
  traceNote(`композит ${archiveTarget}`, cached ? "кэш" : deferBuild === true ? "отложен: соберёт движок" : "пересобран");
  const allowDeletes = operations.some((operation) => operation.action === "delete");
  const buildComposite = async () => {
    await fs.mkdir(path.dirname(output), { recursive: true });
    /* Сборка с нуля (подпакет, `fromScratch`): в два хода (`subpack-two-step.js`) — затравка `create` и `compose` остального; помощник в режиме `create` требует имя выходного архива на `.rpf` («Created archive must use the
       .rpf extension», `CreateAsync`), в режиме `compose` проверки нет: стейдж с основой — `.stage`, затравка — `.seed.stage.rpf`, одиночный `create` — `.stage.rpf`; уборка недописанных (`cache-housekeeping.js`) знает все имена,
       готовой сборкой `<отпечаток>.rpf` такой файл не считается. */
    const stageBase = `${output}.${process.pid}.${randomUUID()}`;
    let stage = `${stageBase}.stage`;
    /* Каталог стейджа движка — свой, с предсказуемым путём (абсолютным): при отказе или отмене
       удаляем его сами, даже если движок не успел убрать своё. */
    const stagingDirectory = path.resolve(path.dirname(output), `${path.basename(output)}.${randomUUID()}.work`);
    try {
      onProgress?.({ phase: "compose", percent: 94, cancellable: true });
      await assertRuntimeSafe(
        assertRuntimeSafety,
        signal,
        "before-rpf-compose",
      );
      await fs.mkdir(stagingDirectory, { recursive: true });
      const composed = await tracedStep(`сборка ${archiveTarget}`, async () => {
        if (fromScratch) {
          const built = await composeSubpackInTwoSteps({ rpfComposer, operations, sizeOf: scratchSizeOf, stageBase, stagingDirectory, archiveTarget, edition, gameRoot, allowDeletes, signal, note: traceNote });
          stage = built.stage;
          return built.composed;
        }
        return rpfComposer({
          baseArchive: compositionBase.path,
          outputArchive: stage,
          stagingDirectory,
          archiveTarget,
          edition,
          gameRoot,
          operations,
          allowDeletes,
          signal,
        });
      });
      await assertRuntimeSafe(assertRuntimeSafety, signal, "after-rpf-compose");
      onProgress?.({ phase: "verify", percent: 98, cancellable: true });
      const stat = await fs.lstat(stage);
      if (!stat.isFile() || stat.size < 16)
        throw new Error(
          `RPF helper создал некорректный архив: ${archiveTarget}`,
        );
      await fs.rename(stage, output);
      await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
      /* Помощник сам считает SHA-256 того, что записал (задача 8): второе
         чтение двух гигабайт не нужно. Неверный отпечаток не пройдёт сверку
         при подмене архива в игре. */
      if (/^[a-f0-9]{64}$/i.test(String(composed?.sha256 || "")))
        await rememberSha256(output, String(composed.sha256).toLowerCase());
    } catch (error) {
      await fs.rm(stage, { force: true }).catch(() => {});
      await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  };
  if (!cached && deferBuild === true) {
    /* Сборку сделает `transact`: движок — из операций рядом с живым файлом, а если не он, то прежним способом по этому же
       запросу (`materialize`). Отпечаток итога станет известен после сборки: до неё в слое и в `lastBuilt` пусто. */
    const layer = { modId: "@rpf-composite", version: fingerprint.slice(0, 12), cachePath: output, sha256: "" };
    const built = {
      fingerprint,
      sha256: "",
      cachePath: output,
      format: COMPOSITE_FORMAT,
      timecycleOverBase,
      deferred: true,
    };
    resource.layers = [layer];
    archive.lastBuilt = built;
    registerDeferredBuild(output, {
      archiveTarget,
      targetKey,
      edition,
      gameRoot,
      fingerprint,
      baseArchive: fromScratch ? null : compositionBase.path,
      operations,
      allowDeletes,
      paths,
      recipeFile: recipeFile(paths, targetKey, fingerprint),
      materialize: async () => {
        await buildComposite();
        const sha256 = await fingerprintSha256(output);
        layer.sha256 = sha256;
        built.sha256 = sha256;
        delete built.deferred;
      },
    });
    return output;
  }
  if (!cached) await buildComposite();
  /* Сборка из кэша, уже посчитанная в этом процессе, не перечитывается (задача 8). */
  const sha256 = await tracedStep(`отпечаток ${archiveTarget}`, () => fingerprintSha256(output));
  if (installTraceActive()) traceNote(`размер ${archiveTarget}`, megabytes((await fs.stat(output)).size));
  resource.layers = [
    {
      modId: "@rpf-composite",
      version: fingerprint.slice(0, 12),
      cachePath: output,
      sha256,
    },
  ];
  archive.lastBuilt = {
    fingerprint,
    sha256,
    cachePath: output,
    format: COMPOSITE_FORMAT,
    timecycleOverBase,
  };
  return output;
}

export {
  composeArchiveResource,
  ensureArchiveResource,
  ensureManagedDlcListResource,
};
