import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { tracedStep } from "./install-trace.js";
import {
  checkedRecordKey,
  cleanId,
  ownRecordValue,
  setRecordValue,
} from "./state-record.js";
import {
  ASTRAL_UPDATE_TARGET,
  isAstralUpdateTarget,
  MANAGED_DLC_LIST_TARGET,
  composeAstralContentRegistry,
  composeManagedDlcList,
  ownedCarrierContainers,
  addCarrierRegistryArchive,
} from "./registry-composers.js";
import { LIVE_CARRIER_TARGETS, UPDATE_CONTENT_CARRIER_TARGETS, carrierOfTarget, isSubpackCarrier } from "./carrier-targets.js";
import { actionOverStockAbsent, isAstralOwnEntry } from "./astral-paths.js";
import { explainPreflightRefusal } from "./preflight-refusal.js";
import { gameStillThere, settleTargetPlace } from "./moved-target.js";
import { planCatalogAppend, UPDATE_RPF as APPEND_UPDATE_RPF } from "./append-item.js";
import { FAST_WEAPON_DLC_TARGET } from "./fast-weapon-dlc.js";
import { ownDlcHostFor, ownDlcOverlaysFor, verifyOwnDlcPacks } from "./own-dlcs.js";
import { isMergeCompatible, sharesIdenticalEntry, slidesUnderMerges } from "./merge-compatibility.js";
import {
  activeBaselinePath,
  DEFAULT_DIR,
  exists,
  statePaths,
} from "./storage-state.js";
import { resolveInside, validateManifest, verifyManifest } from "./manifest.js";
import { fingerprintSha256 as sha256File } from "./file-fingerprint.js"; /* из памяти, как у `index.js`: установка оружия читала update.rpf заново (02.11.2026) */
import { assertRuntimeSafe, throwIfAborted } from "./runtime-guard.js";
import { readState, serializeMutation, writeState } from "./engine-state.js";
import { composeArchiveResource, ensureManagedDlcListResource } from "./resource-composition.js";
import { pruneEmptyManagedDirectories } from "./fs-guards.js";
import { assertNoMixedCarrierWrite, orderForCarriers } from "./carrier-order.js";
import { addSubpackHostArchives, pruneEmptySubpackResources } from "./subpack-closure.js";
import { joinStaleAffected, settleStaleForInstall } from "./stale-managed-dlc.js";
import { opsHoldIsKnown, opsRouteIsOpen, recoverPendingTransactions, transact } from "./transactions.js";
import { expressRouteIsOpen } from "./express-item.js";
import { beginExpressFallback, shouldFallBack } from "./express-fallback.js";
import { expressPackNameOf } from "./express-packs.js";
import { defaultOpsEngineFor, deferredBuildFor, materializeDeferredBuild, opsAllowedFor } from "./ops-build.js";
import { assertReplayInside } from "./engine-swap.js";
import { checkPackage, stagePackage } from "./stage-package.js";
import { inContainerItems, previousSkinsOf, translateCheckedWeapons } from "./weapon-update-install.js";
import { refuseHeroWithoutContainer, translateCheckedClothing } from "./clothing-update-install.js";
import { translateCheckedOverlays } from "./overlays-update-install.js";
import { hostSkipSet, hostWorksOver, rememberHostStanding } from "./host-standing.js";
import { WAITING_SAME_VERSION, rememberRefusedRelease } from "./stock-guard.js";
import { nativeWorksUnder } from "./foreign-entries.js";
import { settleAudioSlotLayer, stripAudioSlotsLayer, withoutAudioSlotsLayer } from "./audio-slot-layer.js";

/* Отказ «компонент ждёт новой версии, а пакет прежний» (`stock-guard.js`) запоминается в сохранённом состоянии: установка, которой отказали, своей копии не сохраняла. */
async function refuseWaitingSameVersion(error, { stateDir, targetKey }) {
  if (error?.code === WAITING_SAME_VERSION) {
    const saved = await readState(stateDir);
    if (rememberRefusedRelease(saved, { targetKey, modId: error.modId, releaseId: error.releaseId })) await writeState(saved, stateDir);
  }
  throw error;
}

/*
 * План и установка пакета — две самые крупные операции движка. План считает,
 * что произойдёт с файлами игры, установка это применяет; общего у них
 * столько, что разносить их по разным файлам смысла нет.
 */
export async function planPackage({
  manifest,
  gameRoot,
  targetId = "default",
  edition = null,
  stateDir = DEFAULT_DIR,
  allowGameRootWrites = false,
  publicKey = null,
  requireSignature = false,
  rpfProbe = null,
  settingsPlanner = null,
  audioDlcHost = null,
  vegetationDlcHost = null,
  vegetationDlcBHost = null,
  vegetationDlcCHost = null,
  texturesDlcHost = null,
  texturesDlcBHost = null,
  texturesDlcCHost = null,
  placesDlcHost = null,
  roadsDlcHost = null,
  roadsDlcBHost = null,
}) {
  await recoverPendingTransactions({ stateDir });
  if (requireSignature && !verifyManifest(manifest, publicKey))
    throw new Error("Цифровая подпись пакета недействительна.");
  const parsed = validateManifest(manifest, edition, { allowGameRootWrites });
  if (parsed.adapter === "gta-settings") {
    if (typeof settingsPlanner !== "function")
      throw new Error(
        "Пакеты gta-settings требуют защищённый settings-manager.",
      );
    return settingsPlanner({
      manifest,
      parsed,
      gameRoot,
      targetId,
      edition,
      stateDir,
    });
  }
  const state = await readState(stateDir);
  const targetKey = cleanId(targetId) || "default";
  checkedRecordKey(targetKey, "Target ID");
  const target = ownRecordValue(state.targets, targetKey);
  /* Прежней папки игры больше нет — цель переедет на новую при установке
     (`moved-target.js`); отказ — только если на месте обе копии. */
  if (
    target &&
    path.resolve(target.gameRoot) !== path.resolve(gameRoot) &&
    (await gameStillThere(target.gameRoot))
  )
    throw new Error("Идентификатор профиля уже связан с другой папкой GTA V.");
  const conflicts = new Map();
  const root = path.resolve(gameRoot);
  let writeBytes = 0;
  let unknownWriteBytes = 0;
  let transactionBackupBytes = 0;
  let newFiles = 0;
  let replacedFiles = 0;
  const files = [];
  const countedArchives = new Set();
  const rpfProbeTargets = new Map();
  for (const file of parsed.files) {
    const resource = target?.resources?.[file.target];
    /* Слой слотов звука производный и невидим для владения записью (`audio-slot-layer.js`). */
    const entryState =
      parsed.adapter === "rpf-entry"
        ? withoutAudioSlotsLayer(target?.archives?.[file.target]?.entries?.[file.entry])
        : null;
    const mergeCompatible =
      isMergeCompatible(parsed, file, entryState) ||
      sharesIdenticalEntry(parsed, file, entryState);
    /* Таймцикл целиком ляжет под модификаторы — сменит только файл под ними. */
    const slide = slidesUnderMerges(parsed, file, entryState);
    const owner =
      parsed.adapter === "rpf-entry"
        ? mergeCompatible
          ? null
          : slide
            ? slide.owner
            : entryState?.layers?.at(-1)?.modId || null
        : resource?.layers?.at(-1)?.modId || null;
    if (owner && owner !== parsed.id) {
      const conflict = conflicts.get(owner) || {
        fileCount: 0,
        slots: new Set(),
      };
      conflict.fileCount += 1;
      conflicts.set(owner, conflict);
    }
    let livePath = resolveInside(root, file.target);
    let liveSize = 0;
    let liveExists = false;
    try {
      const stat = await fs.lstat(livePath);
      if (stat.isSymbolicLink())
        throw new Error(
          `Символическая ссылка запрещена в пути: ${file.target}`,
        );
      liveExists = stat.isFile();
      liveSize = liveExists ? stat.size : 0;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      parsed.adapter === "rpf-entry" &&
      !liveExists &&
      file.target.startsWith("mods/")
    ) {
      const originalPath = resolveInside(root, file.target.slice(5));
      try {
        const stat = await fs.lstat(originalPath);
        if (stat.isSymbolicLink())
          throw new Error(
            `Символическая ссылка запрещена в пути: ${file.target}`,
          );
        if (stat.isFile()) {
          livePath = originalPath;
          liveExists = true;
          liveSize = stat.size;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (parsed.adapter === "rpf-entry") {
      /*
       * Проверка смотрит на тот же архив, от которого идёт пересборка.
       *
       * Композиция всегда собирается из `compositionBase` — сохранённого
       * оригинала, — а не из последнего собранного файла: слои складываются
       * заново на чистую базу. Проверка же брала сначала `layers.at(-1)`, то
       * есть архив с уже установленными модами, и спрашивала у него то, чего
       * он не решает. На переустановке того же мода это ломалось насмерть:
       * запись в собранном архиве уже лежала (её положил он сам), `import`
       * получал «такая запись есть» и падал техническим «RPF preflight
       * failed» — при том что пересборка из базы прошла бы без единой
       * заминки. Человек видел это, просто нажав «Применить» второй раз.
       *
       * Кто владеет записью и можно ли её занимать, решают владельцы слоёв и
       * `replaceModIds` ниже — с понятным отказом «пакет не объявляет
       * конфликт с модификацией X». Проверке остаётся её собственный вопрос:
       * не спорит ли пакет с тем, что лежит в самой игре.
       */
      /* Копия основы могла пропасть из кэша — проверке хватит и живого
         архива: установка сама возьмёт его основой (`base-recovery.js`). */
      const baseOnDisk = async (baseline) =>
        baseline?.path && (await exists(baseline.path)) ? baseline.path : null;
      /* Какая основа взята — вид идёт в отказ проверки (`preflight-refusal.js`): по одной строке движка не понять, на каком архиве она отказала. */
      const probeBase = async () => {
        const composition = await baseOnDisk(resource?.compositionBase);
        if (composition) return { archivePath: composition, baseKind: "composition" };
        const stored = await baseOnDisk(resource?.base);
        if (stored) return { archivePath: stored, baseKind: "stored-copy" };
        if (liveExists) return { archivePath: livePath, baseKind: "live" };
        /* Своих пакетов Astral (звук, растительность, текстуры) до первой
           установки в игре нет: их основа — хост, который собрало
           приложение (`own-dlcs.js`). */
        return {
          archivePath: ownDlcHostFor(file.target, { audioDlcHost, vegetationDlcHost, vegetationDlcBHost, vegetationDlcCHost, texturesDlcHost, texturesDlcBHost, texturesDlcCHost, placesDlcHost, roadsDlcHost, roadsDlcBHost }),
          baseKind: "own-host",
        };
      };
      const probe = rpfProbeTargets.get(file.target) || { ...(await probeBase()), operations: [] };
      /* Запись, которую основа уже несёт от прежней установки движка
         (`direct-update-rebase.js`), ляжет поверх — и спрашивать про неё
         надо как про `upsert`, а не как про новую. Так же — запись, которую
         пишет только Astral (`isAstralOwnEntry`): сборка кладёт её поверх
         того, что застала, а удалять отсутствующую там нечего. Копии основы
         после чистки кэша нет — проверка смотрит в живой архив с прежней
         версией той же работы, и `import` на нём отказывал по кругу. */
      const own = isAstralOwnEntry(file.target, file.entry, { ours: Boolean(resource) && Boolean(target?.archives?.[file.target]?.entries?.[file.entry]) });
      const carried = [
        ...(resource?.compositionBase?.carried || []),
        ...ownDlcOverlaysFor(file.target),
      ].includes(file.entry);
      /* Маска `allowMissing` с основой не спорит: записи нет — ничего. Радар большой карты, которого в штатном архиве нет, а основа
         несёт от прежней карты (`isStockAbsentEntry`), — тоже `upsert`: `import` над ним отказывал «RPF preflight failed: x64/levels/gta5/minimap.rpf». */
      if (!(file.action === "delete" && (file.allowMissing || own)))
        probe.operations.push({
          entry: file.entry,
          action: own || (file.action === "import" && carried) ? "upsert" : actionOverStockAbsent(file.target, file.entry, file.action),
        });
      rpfProbeTargets.set(file.target, probe);
    }
    if (file.size == null) unknownWriteBytes += 1;
    else writeBytes += file.size;
    const archiveAlreadyCounted =
      parsed.adapter === "rpf-entry" && countedArchives.has(file.target);
    if (parsed.adapter === "rpf-entry") countedArchives.add(file.target);
    if (liveExists && !archiveAlreadyCounted) {
      replacedFiles += 1;
      transactionBackupBytes += liveSize;
    } else if (!liveExists && !archiveAlreadyCounted) newFiles += 1;
    files.push({
      target: file.target,
      ...(file.entry ? { entry: file.entry } : {}),
      operation: file.action,
      currentOwner: owner,
      size: file.size,
      currentSize: liveExists ? liveSize : null,
      action:
        parsed.adapter === "rpf-entry"
          ? file.action === "delete"
            ? "delete-entry"
            : file.action === "import"
              ? "add-entry"
              : "replace-entry"
          : liveExists
            ? "replace"
            : "create",
      replacesOriginal: Boolean(
        !owner && (resource?.base?.exists || liveExists),
      ),
    });
  }
  const rpfCompatibility = [];
  if (parsed.adapter === "rpf-entry") {
    for (const [archiveTarget, probe] of rpfProbeTargets) {
      if (typeof rpfProbe !== "function") {
        rpfCompatibility.push({
          archiveTarget,
          status: "not-checked",
          checkedOperations: 0,
        });
        continue;
      }
      /* Подпакет штатного пакета (`dlc<N>.rpf`) создаёт установка: файла для сверки операций ещё нет, «не проверено» (создание с нуля, `resource-composition.js`). */
      if (!probe.archivePath && isSubpackCarrier(carrierOfTarget(String(archiveTarget).toLowerCase()))) {
        rpfCompatibility.push({ archiveTarget, status: "not-checked", checkedOperations: 0 });
        continue;
      }
      if (!probe.archivePath)
        throw new Error(
          `Базовый RPF-архив для проверки не найден: ${archiveTarget}`,
        );
      /* Движок отказывает одной строкой «RPF preflight failed: <запись>» и на `import` над существующей записью, и на `replace` над
         отсутствующей: код и деталь добавляет вызвавший, который знает, что отправил (`preflight-refusal.js`). */
      let result;
      try {
        result = await rpfProbe({
          archivePath: probe.archivePath,
          archiveTarget,
          gameRoot: root,
          edition,
          operations: probe.operations,
        });
      } catch (error) {
        throw explainPreflightRefusal(error, {
          archiveTarget,
          operations: probe.operations,
          baseKind: probe.baseKind,
          modId: parsed.id,
        });
      }
      rpfCompatibility.push({
        archiveTarget,
        status: result.status,
        mode: result.mode,
        bytes: result.bytes,
        checkedOperations: result.checkedOperations,
        operations: result.operations,
      });
    }
  }
  for (const installed of target?.installed || []) {
    if (installed.modId === parsed.id) continue;
    const overlappingSlots = (installed.slots || []).filter((slot) =>
      parsed.slots.includes(slot),
    );
    if (!overlappingSlots.length) continue;
    const conflict = conflicts.get(installed.modId) || {
      fileCount: 0,
      slots: new Set(),
    };
    for (const slot of overlappingSlots) conflict.slots.add(slot);
    conflicts.set(installed.modId, conflict);
  }
  /* Работа мастерской (`local-*`) под модом каталога не сменяется, а
     остаётся под ним (Т-107b): виден верхний, снятие верхнего возвращает
     нижний. `stack` — «ляжет поверх», а не «сменит». */
  /* Работы мастерской, которые закроет этот мод: он ляжет поверх без вопроса
     (`foreign-entries.js`, «новый мод старше» 18.11.2026), окно называет их в строке установки. */
  const nativeUnder = target
    ? await nativeWorksUnder({ target, parsed }).catch(() => [])
    : [];
  /* Слоты прежней работы, которых у нового пакета нет (`keeps`): граница замены — по стволам, не по записям (решение лида 1, 22.11.2026, `weapon-update-install.js: replacedWhole`). Путь мастерской в хост
     (`gunpack-install.js`) такую работу целиком не заменяет — новая ложится слоем поверх общих записей. */
  const keepsOf = (modId) => (target?.installed || []).find((item) => item.modId === modId)?.slots?.filter((slot) => !parsed.slots.includes(slot)) || [];
  const conflictList = [...conflicts].map(([modId, conflict]) => ({
    modId,
    fileCount: conflict.fileCount,
    ...(conflict.slots.size ? { slots: [...conflict.slots] } : {}),
    ...(keepsOf(modId).length ? { keeps: keepsOf(modId) } : {}),
    ...(modId.startsWith("local-") ? { stack: true } : {}),
  }));
  return {
    modId: parsed.id,
    version: parsed.version,
    adapter: parsed.adapter,
    slots: parsed.slots,
    targetId: targetKey,
    edition,
    files,
    rpfCompatibility,
    conflicts: conflictList,
    ...(nativeUnder.length ? { nativeUnder } : {}),
    safeRoot: allowGameRootWrites
      ? "game-root"
      : ["rageopenv-loose", "managed-addon-dlc"].includes(parsed.adapter)
        ? "newmods-vfs"
        : "mods-only",
    summary: {
      fileCount: files.length,
      writeBytes,
      unknownWriteBytes,
      transactionBackupBytes,
      newFiles,
      replacedFiles,
      conflictingFiles: conflictList.reduce(
        (total, item) => total + item.fileCount,
        0,
      ),
      rollbackReady: true,
      risk: allowGameRootWrites
        ? "elevated"
        : conflictList.length
          ? "replacement"
          : "isolated",
    },
  };
}

export async function installPackage({
  manifest,
  packageRoot,
  replaceModIds = [],
  origin = null,
  _internalTrust = null,
  ...common
}) {
  return installPackageBatch({
    ...common,
    packages: [{ manifest, packageRoot, replaceModIds, origin, _internalTrust }],
  });
}

/*
 * Несколько пакетов одной транзакцией (02.11.2026, «Скелеты на руки» на 14 вещей Majestic за 513 с):
 * каждый пакет ложится в состояние своей записью и своим слотом, как при установке по одному, а
 * архивы игры, которые они трогают, собираются ОДИН раз на всех и подменяются одной транзакцией.
 * По одному на 3-гигабайтном mpheist/dlc.rpf каждая вещь пересобирала архив целиком и копировала его в
 * игру заново: десять вещей — тридцать гигабайт записи вместо трёх. Итог в игре тот же: сборка — из
 * основы и верхних слоёв всех записей (`composeArchiveResource`), порядок слоёв — порядок пакетов.
 *
 * Пакет — `{ manifest, packageRoot, replaceModIds, origin, _internalTrust }`; остальное — общее, как у
 * `installPackage`. Больше одного пакета — только `rpf-entry` и без подмены движком (у точки движка
 * одна запись переигрывания на работу).
 */
export async function installPackageBatch({
  packages,
  gameRoot,
  targetId = "default",
  edition = null,
  stateDir = DEFAULT_DIR,
  allowGameRootWrites = false,
  publicKey = null,
  requireSignature = false,
  onProgress = null,
  rpfComposer = null,
  rpfProbe = null,
  dlcListProvider = null,
  contentXmlProvider = null,
  signal = null,
  assertRuntimeSafety = null,
  settingsInstaller = null,
  tracerMaterializer = null,
  ptfxTextureMaterializer = null,
  awcMaterializer = null,
  bloodRoutingMaterializer = null,
  audioRelMaterializer = null,
  audioChunkMaterializer = null,
  /* Слой слотов звука в audioconfig.dat4.rel (`audio-slot-layer.js`); без него — тот, что зарегистрировало приложение. */
  audioSlotSettler = null,
  audioDlcHost = null,
  vegetationDlcHost = null,
  vegetationDlcBHost = null,
  vegetationDlcCHost = null,
  texturesDlcHost = null,
  texturesDlcBHost = null,
  texturesDlcCHost = null,
  placesDlcHost = null,
  roadsDlcHost = null,
  roadsDlcBHost = null,
  /* Самопроверка до подмены файлов в игре (`dlc-archive-check.js`): `dlcVerifier` — пакеты дополнения, `layerVerifier` — контейнеры слоя Astral в update.rpf; отказ — ошибка, в игру ничего не записано. */
  dlcVerifier = null, layerVerifier = null,
  /* Проверка чужих правок в сборке человека (`foreign-entries.js`); без неё — проверка, которую зарегистрировало приложение. */
  foreignDetector = null,
  /* Подмена `update.rpf` движком (шаг 3 ядра фазы 7, за флагом модуля): `{ install, edition,
     pointsRoot, replay }` — см. `transactions.js`, `engineInstall`. Без неё — прежняя подмена. */
  engineInstall = null,
  /* Загрузку после установки удалят (кэш загрузок выключен): файлы переезжают в хранилище, а не копируются (`package-payload.js`). */
  moveDownloads = false,
  /* Экспресс-установка своего dlc (`express-item.js`, этап A): `{ accepts(build), build(request) }` от приложения. С ней
     архив своего пакета дополнения не собирается в кэш и не кладётся в игру второй записью: движок строит его сразу
     под живым именем внутри транзакции. Без неё (по умолчанию) — прежний путь. */
  expressInstall = null,
  /* Редукс в свой dlc (`redux-install.js` приложения): `{ accepts(input), install(input) }`. Без него (по умолчанию) — прежний путь. */
  reduxInstall = null,
  /* Дозапись в update.rpf мода каталога (`append-item.js`, `catalog-append.js` приложения): `{ accepts, append, rollback, note }`. Без неё
     (по умолчанию) — прежний путь: архив собирается и копируется в игру. Любая ошибка дозаписи — тот же прежний путь. */
  appendInstall = null,
  /* Оружие через update.rpf (`weapon-update-install.js`, GTA 5 RP): `{ routesFor({ names }), note(строка) }` приложения. Без него (по умолчанию) —
     прежний путь: ганпак идёт в пакет `astral_weapons`. Берёт пакеты только вместе с дозаписью (`appendInstall`). */
  weaponUpdateRoute = null,
  /* Одежда freemode через контейнер в update.rpf (`clothing-update-install.js`, GTA 5 RP): `{ note(строка) }` приложения. Без него (по умолчанию) — прежний путь: пакет `astral_clothing`. Дозаписи не требует. */
  clothingUpdateRoute = null,
  /* Наложения тела (тату, бороды) через контейнер в update.rpf (`overlays-update-install.js`): `{ note(строка) }` приложения; без него — прежний путь, картинки в пакет `astral_clothing`. */
  overlaysUpdateRoute = null,
  /* Моды, которые уходят в той же транзакции, даже если с пакетами нет общих файлов и слотов (смена варианта сборки: «поставить A, снять B»).
     Общее с новым вариантом в список не кладут — оно остаётся как есть. Ненайденный id молча пропускается: снимать нечего. */
  removeModIds = [],
}) {
  if (!Array.isArray(packages) || !packages.length) throw new Error("Нечего ставить: пакетов нет.");
  if (!Array.isArray(removeModIds)) throw new Error("Список снимаемых модов должен быть массивом.");
  /* Подмена без своей точки (`opsOnly`: установка из операций, точка движка после неё не остаётся) записи переигрывания
     не оставляет — эти два правила её не касаются. */
  const keepsPoint = Boolean(engineInstall) && engineInstall.opsOnly !== true;
  if (packages.length > 1 && keepsPoint)
    throw new Error("Подмена движком ставит одну работу за раз: у её точки одна запись переигрывания.");
  /* Запись переигрывания пишется только для пакета внутри хранилища: иначе переигрывание откажет после уборки. */
  if (keepsPoint) assertReplayInside(stateDir, packages[0].packageRoot, packages[0].manifest?.id);
  return serializeMutation(async () => {
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-prepare");
    onProgress?.({ phase: "prepare", percent: 90 });
    await recoverPendingTransactions({ stateDir });
    /* Проверки каждого пакета — до любой записи: отказ пятого не оставляет четыре полуготовых. */
    /* Оружие через update.rpf (`weapon-update-install.js`, за `ASTRAL_WEAPONS_VIA_UPDATE`): перевод разобранного пакета — после проверки подписи. */
    const checkedRaw = packages.map((item) => checkPackage(item, { edition, publicKey, requireSignature, allowGameRootWrites, settingsInstaller }));
    /* Записи пакетов до перевода в контейнер (цель — хост): по ним правило «новое заменяет старое» видит, что стоит на тех же записях хоста (`host-standing.js`). */
    const hostFilesOf = new Map(checkedRaw.map(({ parsed }) => [parsed.id, parsed.files]));
    const weaponsTranslated = await translateCheckedWeapons({
      checked: checkedRaw,
      route: weaponUpdateRoute,
      appendInstall,
    });
    const { containerItems } = weaponsTranslated;
    /* Одежда freemode через контейнер (за `ASTRAL_CLOTHING_VIA_UPDATE`): после оружия, перевод только разобранного пакета; дозаписи не требует. */
    const clothingTranslated = translateCheckedClothing({ checked: weaponsTranslated.checked, route: clothingUpdateRoute, already: weaponsTranslated.fullyTranslated });
    /* Наложения тела (за `ASTRAL_OVERLAYS_VIA_UPDATE`): после одежды; плоские имена картинок, дозаписи не требует. */
    const overlaysTranslated = translateCheckedOverlays({ checked: clothingTranslated.checked, route: overlaysUpdateRoute, already: new Set([...weaponsTranslated.fullyTranslated, ...clothingTranslated.fullyTranslated]) });
    const checked = overlaysTranslated.checked;
    refuseHeroWithoutContainer(checked);
    const fullyTranslated = overlaysTranslated.fullyTranslated;
    if (checked.length > 1 && checked.some(({ parsed }) => parsed.adapter !== "rpf-entry"))
      throw new Error("Одной транзакцией ставятся только пакеты записей RPF.");
    if (new Set(checked.map(({ parsed }) => parsed.id)).size !== checked.length)
      throw new Error("В одной установке один пакет встречается дважды.");
    const root = path.resolve(gameRoot);
    if (!(await exists(root))) throw new Error("Папка GTA V не найдена.");
    for (const { sourceRoot } of checked)
      if (!(await exists(sourceRoot))) throw new Error("Папка пакета не найдена.");
    if (checked[0].parsed.adapter === "gta-settings") {
      const [{ manifest, parsed, sourceRoot, replaceModIds }] = checked;
      const result = await settingsInstaller({
        manifest,
        parsed,
        packageRoot: sourceRoot,
        gameRoot: root,
        targetId,
        edition,
        stateDir,
        replaceModIds,
        signal,
        assertRuntimeSafety,
        onProgress,
      });
      onProgress?.({ phase: "complete", percent: 100 });
      return result;
    }
    /* Редукс в свой dlc (`redux-install.js` приложения, за `ASTRAL_ENGINE_REDUX_DLC`): маршрут до `stagePackage`. Один пакет
       записей RPF; `accepts` отказал или маршрута нет — всё идёт прежним путём. Ошибку приложения (`install`) не гасим: молчаливый
       уход на прежний путь поставил бы то же самое второй раз поверх недоделанного. */
    /* Пачка из нескольких пакетов (волна `speed/redux-usable`): все пакеты — записи RPF, у приложения есть `installBatch`, снимать никого
       не нужно, и приняты ВСЕ — приложение ставит их по порядку, каждый своим dlc и слоем (при отказе одного ранее поставленные
       снимаются). Хоть один отказан — вся пачка идёт прежним путём, как и пачка без `installBatch`. */
    const routable =
      reduxInstall &&
      checked.every(({ parsed }) => parsed.adapter === "rpf-entry") &&
      (checked.length === 1 || (typeof reduxInstall.installBatch === "function" && removeModIds.length === 0));
    if (routable) {
      const inputs = [];
      for (const { manifest, parsed, sourceRoot } of checked) {
        const files = await Promise.all(
          parsed.files.map(async (file) => {
            const source = resolveInside(sourceRoot, file.source);
            return { ...file, source, size: file.action === "delete" ? 0 : (await fs.stat(source)).size };
          }),
        );
        inputs.push({ manifest, parsed, packageRoot: sourceRoot, files, gameRoot: root, targetId, edition, stateDir, signal, onProgress });
      }
      let accepted = true;
      for (const input of inputs) if ((await reduxInstall.accepts(input)) !== true) accepted = false;
      if (accepted) {
        if (inputs.length === 1) await reduxInstall.install(inputs[0]);
        else await reduxInstall.installBatch(inputs);
        onProgress?.({ phase: "complete", percent: 100 });
        return readState(stateDir);
      }
    }
    for (const item of checked) {
      const { manifest, parsed } = item;
      /* Пакет оружия, переведённый в update.rpf целиком, хоста не касается: план-проверка по хосту ему не нужна. */
      if (parsed.adapter === "rpf-entry" && typeof rpfProbe === "function" && !fullyTranslated.has(item)) {
        await tracedStep("план-проверка", () =>
          planPackage({
            manifest,
            gameRoot: root,
            targetId,
            edition,
            stateDir,
            allowGameRootWrites,
            rpfProbe,
            audioDlcHost,
            vegetationDlcHost,
            vegetationDlcBHost,
            vegetationDlcCHost,
            texturesDlcHost,
            texturesDlcBHost,
            texturesDlcCHost,
            placesDlcHost,
            roadsDlcHost,
            roadsDlcBHost,
          }),
        );
      }
    }
    const current = await readState(stateDir);
    const next = structuredClone(current);
    const targetKey =
      cleanId(targetId) ||
      createHash("sha256")
        .update(root.toLowerCase())
        .digest("hex")
        .slice(0, 16);
    checkedRecordKey(targetKey, "Target ID");
    /* Игра переехала в другую папку — её цель переезжает с ней вместе с
       установленным (`moved-target.js`, задача 1 ТЗ 10.10.2026). */
    await settleTargetPlace(next, {
      targetKey,
      root,
      edition,
      liveSha: () => sha256File(resolveInside(root, ASTRAL_UPDATE_TARGET)),
    });
    const target = ownRecordValue(next.targets, targetKey) || {
      id: targetKey,
      gameRoot: root,
      edition,
      baselineMode: "original",
      installed: [],
      resources: {},
      archives: {},
      dlcRegistrations: {},
    };
    if (target.vanillaGuard && target.vanillaGuard.phase !== "restored")
      throw new Error(
        "Сначала завершите сеанс Vanilla Guard и восстановите профиль.",
      );
    target.gameRoot = root;
    target.edition = edition || target.edition || null;
    target.dlcRegistrations ||= {};
    target.directDlcRegistrations ||= {};
    setRecordValue(next.targets, targetKey, target);
    /* Слой слотов звука производный: проверки владения его не видят, после укладки пакетов он пересчитывается заново. */
    stripAudioSlotsLayer(target);
    const paths = statePaths(stateDir);
    /* Своей подмены вызывающий не дал — берётся подмена по умолчанию (`ops-build.js`): установка из операций без своей точки. */
    const engine = engineInstall ?? defaultOpsEngineFor({ gameRoot: root, workId: checked[0]?.parsed?.id });
    const affectedPaths = new Set();
    const ownDlcs = [];
    let dlcRegistryChanged = false;
    let activatesFastWeaponDlc = false;
    /* Следы управляемых DLC в newmods, о которых состояние не знает, уходят этой же установкой (`stale-managed-dlc.js`). */
    let staleManaged = null;
    for (const [position, original] of checked.entries()) {
      /* Скин оружия и покраска вещи в контейнере заменяют прежнюю работу того же места (`previousSkinsOf`). */
      /* Ушёл ли пакет в контейнер: оружие что-то перенесло (`containerItems`) или одежда и наложения перевели ВСЕ файлы (`fullyTranslated`) — а смешанный пакет (файл в контейнер, реквизит base-props остался в хосте) не в этих наборах.
         У него после перевода есть запись `update/update.rpf`, которой не было до перевода (`hostFilesOf`): правило «новое заменяет старое» обязано сработать, иначе файл остаётся в двух местах. Пакет, который и до перевода целил в
         update.rpf (свои записи, не переводился), сюда не попадает: его записи уже были в `hostFilesOf`. */
      const toContainer =
        inContainerItems(containerItems, original) ||
        fullyTranslated.has(original) ||
        (original.parsed.files || []).some(
          (file) =>
            String(file?.target).toLowerCase() === "update/update.rpf" &&
            !(hostFilesOf.get(original.parsed.id) || []).some((raw) => String(raw?.target).toLowerCase() === "update/update.rpf" && raw.entry === file.entry),
        );
      const previous = toContainer ? previousSkinsOf(original.parsed, target, original.origin) : [];
      /* «Новое заменяет старое» (слово владельца 22.11.2026, `host-standing.js`): работа, целиком перекрытая записями нового пакета в хосте, уходит той же установкой; частичное перекрытие — прежнее поведение и отчёт. */
      const over = toContainer ? hostWorksOver({ files: hostFilesOf.get(original.parsed.id), dlcName: original.parsed.dlcName, target, skip: hostSkipSet({ batchIds: checked.map((entry) => entry.parsed.id), replaceModIds: original.replaceModIds || [], previous }) }) : null;
      const covered = over?.covered || [];
      if (over?.coveredParked.length) target.parked = (target.parked || []).filter((parked) => !over.coveredParked.includes(parked?.modId));
      rememberHostStanding(original.parsed.id, { replaced: covered, partial: over?.partial || [] });
      const named = [...previous, ...covered];
      const item = named.length ? { ...original, replaceModIds: [...new Set([...(original.replaceModIds || []), ...named])], coveredModIds: covered } : original;
      const staged = await stagePackage(item, {
        /* Снимаемые уходят вместе с первым пакетом: слои чистятся один раз, остальные пакеты ложатся на уже чистое состояние. */
        removeModIds: position === 0 ? removeModIds : [],
        root,
        target,
        targetKey,
        paths,
        stateDir,
        signal,
        onProgress,
        rpfProbe,
        contentXmlProvider,
        dlcListProvider,
        foreignDetector,
        engineInstall: engine,
        moveDownloads,
        affectedPaths,
        hosts: { audioDlcHost, vegetationDlcHost, vegetationDlcBHost, vegetationDlcCHost, texturesDlcHost, texturesDlcBHost, texturesDlcCHost, placesDlcHost, roadsDlcHost, roadsDlcBHost },
        settleStale: () =>
          staleManaged
            ? Promise.resolve(staleManaged)
            : settleStaleForInstall({ target, targetKey, root, paths, edition, dlcListProvider }).then((settled) => (staleManaged = settled)),
      }).catch((error) => refuseWaitingSameVersion(error, { stateDir, targetKey }));
      ownDlcs.push(...staged.ownDlcs);
      dlcRegistryChanged ||= staged.dlcRegistryChanged;
      activatesFastWeaponDlc ||= staged.activatesFastWeaponDlc;
    }
    /* Контейнер в носителе (`update2.rpf`, `carrier-targets.js`): его регистрация — строка в `content.xml` файла `update.rpf`, поэтому обе цели попадают в `affected` вместе
       (порядок записи — носитель, потом `update.rpf` — задаёт сортировка `affected` соседней ветки). Носитель без слоя Astral в `update.rpf` не ставится: регистрировать было бы негде. */
    if (!addCarrierRegistryArchive(target, affectedPaths) && UPDATE_CONTENT_CARRIER_TARGETS.some((carrier) => affectedPaths.has(carrier)) && ownedCarrierContainers(target).length)
      throw new Error("Контейнер в носителе требует подготовленного слоя Astral в update.rpf: регистрировать его негде.");
    /* Контейнер в подпакете штатного пакета (`dlc<N>.rpf`, `subpack-closure.js`): его регистрация и число подпакетов лежат в `content.xml` и `setup2.xml` хозяина — архив хозяина попадает в `affected` вместе с подпакетом. */
    await addSubpackHostArchives({ target, archives: affectedPaths, root, paths, targetKey, signal, onProgress });
    /* Слот памяти звука под банки паков: поднят, понижен или снят вместе с ними (`audio-slot-layer.js`). Сбор архивов ниже уже видит слой. */
    if (await tracedStep("слот звука", () => settleAudioSlotLayer({ audioSlotSettler, target, targetKey, paths, signal, onProgress }))) affectedPaths.add(ASTRAL_UPDATE_TARGET);
    /* «Одна запись вместо двух» (`ops-build.js`, 19.11.2026): `update.rpf` не собирается в кэш, если подмене разрешена
       установка из операций и движок умеет два шага — собрать рядом с живым файлом, дать приложению проверить, подменить.
       Кто исполнит отложенную сборку, решается ниже; не движок — она делается прежним способом по тому же запросу. */
    const opsHold = opsAllowedFor(engine) && typeof engine.writerFor === "function" && (await opsHoldIsKnown(engine));
    /* Архив, который трогают несколько пакетов, собирается один раз — на всех. */
    for (const archiveTarget of affectedPaths) {
      if (!target.archives?.[archiveTarget]) continue;
      if (isAstralUpdateTarget(archiveTarget)) {
        await composeAstralContentRegistry({
          target,
          targetKey,
          paths,
          contentXmlProvider,
          archiveTarget,
          carrierWriting: new Set([...affectedPaths].filter((archive) => LIVE_CARRIER_TARGETS.includes(archive))),
        });
      }
      await composeArchiveResource({
        target,
        archiveTarget,
        targetKey,
        edition: target.edition,
        gameRoot: target.gameRoot,
        paths,
        rpfComposer,
        /* Свой dlc при экспресс-пути не собирается здесь: сборка откладывается, кто её исполнит — решается ниже. update.rpf при дозаписи
           и при установке из операций тоже: файл не пишется, пока не ясно, дописать в него, собрать движком рядом с живым или собрать как раньше. */
        deferBuild:
          (Boolean(expressInstall) && expressPackNameOf(archiveTarget) !== null) ||
          (Boolean(appendInstall) && archiveTarget.toLowerCase() === APPEND_UPDATE_RPF && affectedPaths.size === 1) ||
          (opsHold && archiveTarget === ASTRAL_UPDATE_TARGET),
        tracerMaterializer,
        ptfxTextureMaterializer,
        awcMaterializer,
        bloodRoutingMaterializer,
        audioRelMaterializer,
        audioChunkMaterializer,
        /* Слой крови, который ставят сейчас, без правил не встаёт; прежние слои без правил (ядро заменили) каскад снимает. */
        protectedModIds: new Set(checked.map(({ parsed }) => parsed.id)),
        signal,
        assertRuntimeSafety,
        onProgress,
      });
    }
    for (const { parsed } of checked) {
      if (parsed.adapter !== "managed-addon-dlc") continue;
      await ensureManagedDlcListResource({
        target,
        root,
        paths,
        targetKey,
        edition: target.edition,
        dlcListProvider,
      });
      for (const [name, registration] of Object.entries(
        target.dlcRegistrations,
      )) {
        if (registration.modId === parsed.id && name !== parsed.dlcName) {
          delete target.dlcRegistrations[name];
          dlcRegistryChanged = true;
        }
      }
      target.dlcRegistrations[parsed.dlcName] = {
        modId: parsed.id,
        registeredAt: new Date().toISOString(),
      };
      dlcRegistryChanged = true;
    }
    if (dlcRegistryChanged && target.resources?.[MANAGED_DLC_LIST_TARGET]) {
      await composeManagedDlcList({ target, targetKey, paths });
      affectedPaths.add(MANAGED_DLC_LIST_TARGET);
    }
    const affected = [...affectedPaths].map((relativePath) => {
      const resource = target.resources[relativePath];
      const top = resource.layers.at(-1);
      return {
        relativePath,
        livePath: resolveInside(root, relativePath),
        sourcePath: top?.cachePath || activeBaselinePath(target, resource),
      };
    });
    /* Подпакет без единой записи (работа ушла в другой носитель): файл удалится подменой без источника, а ресурс и записи уходят из состояния (`subpack-closure.js`). */
    pruneEmptySubpackResources(target, [...affectedPaths]);
    if (staleManaged) joinStaleAffected(affected, staleManaged, target);
    /* Носитель контейнеров среди целей (`carrier-order.js`): носители пишутся первыми, `update.rpf` последним; установка вместе со снятием при носителе отказывается. Без носителя порядок прежний. */
    assertNoMixedCarrierWrite(affected, removeModIds);
    orderForCarriers(affected, "install");
    /* Отложенные сборки своих dlc: что экспресс-путь берёт — строится движком на месте и сверяется после сборки; что не
       берёт (выключатель модуля, состав, который путь не умеет) — собирается сейчас прежним способом и сверяется как раньше. */
    const express = new Set();
    /* Дозапись в update.rpf (`append-item.js`): решение по каждому отложенному архиву; взявший дозапись не собирается и не копируется. */
    const appendPlans = new Map();
    const rest = [];
    for (const item of affected) {
      const build = deferredBuildFor(item.sourcePath);
      if (!build) continue;
      if (await expressRouteIsOpen(item, build, expressInstall)) {
        express.add(item);
        continue;
      }
      const plan = await planCatalogAppend({ appendInstall, item, build, current, next, targetKey, affectedCount: affected.length, signal });
      if (plan) appendPlans.set(item.relativePath, plan);
      if (plan?.kind) continue;
      if (plan?.declined) appendInstall.note?.(`Дозапись в update.rpf не берёт установку (${plan.declined}): прежний путь.`);
      rest.push([item, build]);
    }
    /* `update.rpf`, который движок соберёт из операций рядом с живым файлом: до установки файла нет, поэтому проверка
       «игра это откроет» идёт внутри транзакции по удержанному стейджу (`verifyHeld`, `transactions.js`) — между сборкой и
       подменой. Вместе с экспресс-сборкой своего dlc путь не открывается: её вторым заходом не повторить. */
    let held = null;
    for (const [item, build] of rest) {
      if (opsHold && !express.size && item.relativePath === ASTRAL_UPDATE_TARGET && (await opsRouteIsOpen(item, build, engine, signal))) held = item;
      else await materializeDeferredBuild(item.sourcePath);
    }
    const expressTargets = new Set([...express].map((item) => item.relativePath.toLowerCase()));
    /* `updateFile` — где лежит собранный `update.rpf`, если не в месте сборки: стейдж движка. */
    const verifyBuiltArchives = (updateFile = null) =>
      verifyOwnDlcPacks(
        dlcVerifier,
        ownDlcs.filter((dlc) => !expressTargets.has(dlc.target.toLowerCase())),
        affected
          .filter((item) => !express.has(item) && !appendPlans.get(item.relativePath)?.kind)
          .map((item) => (updateFile && item === held ? { ...item, sourcePath: updateFile } : item)),
        { target, root, signal, layerVerifier },
      );
    if (held) held.verifyHeld = verifyBuiltArchives;
    else await verifyBuiltArchives();
    /* Дописанный архив сверяется после записи, по живому файлу: собранного файла до неё нет (`transact`, `appendVerify`). */
    const appendVerify = new Map(
      [...appendPlans].filter(([, plan]) => plan?.kind).map(([relativePath]) => [
        relativePath,
        () => verifyOwnDlcPacks(null, [], [{ relativePath, livePath: resolveInside(root, relativePath), sourcePath: resolveInside(root, relativePath) }], { target, root, signal, layerVerifier }),
      ]),
    );
    if (express.size) {
      /* Сверка построенных на месте — один раз, после последнего из них: проверка читает живые архивы, а остальные
         изменённые архивы установки (update.rpf со строкой пакета) — по-прежнему собранными. */
      const built = affected.map((item) => (express.has(item) ? { ...item, sourcePath: item.livePath } : item));
      [...express].at(-1).verifyBuilt = () =>
        verifyOwnDlcPacks(
          dlcVerifier,
          ownDlcs.filter((dlc) => expressTargets.has(dlc.target.toLowerCase())),
          built,
          { target, root, signal },
        );
    }
    onProgress?.({ phase: "ready-to-commit", percent: 99, cancellable: true });
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-commit");
    throwIfAborted(signal);
    const runTransaction = (expressForRun) => transact({
      stateDir,
      current,
      next,
      targetId: targetKey,
      affected,
      action: "install",
      signal,
      engineInstall: engine,
      expressInstall: expressForRun,
      ...(appendInstall ? { appendInstall, appendPlans, appendVerify } : {}),
      onPrepared: () =>
        onProgress?.({ phase: "commit", percent: 99, cancellable: false }),
      /* Байты подмены идут той же фазой `commit`: окно показывает не
         «идёт что-то», а сколько из четырёх гигабайт уже на месте. */
      onStaging: onProgress
        ? ({ copiedBytes, totalBytes }) =>
            onProgress({
              phase: "commit",
              percent: 99,
              cancellable: false,
              copiedBytes,
              totalBytes,
            })
        : null,
    });
    /* Откат на старый путь (`express-fallback.js`): экспресс-фаза отказала — транзакция уже вернула игру как была, свои пакеты
       собираются прежним способом, сверяются до подмены и ставятся второй транзакцией без экспресс-пути. Отмена не откатывается. */
    const fallback = beginExpressFallback({ express, next });
    const result = await tracedStep("транзакция", async () => {
      try {
        return await runTransaction(expressInstall);
      } catch (error) {
        if (!fallback || !shouldFallBack(error, signal)) throw error;
        await fallback.fallBack({ error, onFallback: expressInstall?.onFallback });
        await verifyOwnDlcPacks(
          dlcVerifier,
          ownDlcs.filter((dlc) => expressTargets.has(dlc.target.toLowerCase())),
          affected,
          { target, root, signal, layerVerifier },
        );
        return runTransaction(null);
      }
    });
    await pruneEmptyManagedDirectories(
      root,
      affected.map((item) => item.relativePath),
    );
    if (activatesFastWeaponDlc) {
      const savedTarget = ownRecordValue(result.targets, targetKey);
      const [updateStat, hostStat] = await Promise.all([
        fs.lstat(resolveInside(root, "update/update.rpf")),
        fs.lstat(resolveInside(root, FAST_WEAPON_DLC_TARGET)),
      ]);
      savedTarget.fastWeaponDlc.updateIdentity = {
        size: updateStat.size,
        mtimeMs: updateStat.mtimeMs,
      };
      savedTarget.fastWeaponDlc.hostIdentity = {
        size: hostStat.size,
        sha256: await sha256File(resolveInside(root, FAST_WEAPON_DLC_TARGET)),
      };
      await writeState(result, stateDir);
    }
    onProgress?.({ phase: "complete", percent: 100 });
    return result;
  });
}
