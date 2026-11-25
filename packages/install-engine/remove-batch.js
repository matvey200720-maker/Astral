import fs from "node:fs/promises";
import { LIVE_CARRIER_TARGETS } from "./carrier-targets.js";
import { inOperation } from "./operation-scope.js";
import { checkedRecordKey, ownRecordValue } from "./state-record.js";
import {
  ASTRAL_UPDATE_TARGET,
  isAstralUpdateTarget,
  MANAGED_DLC_LIST_TARGET,
  composeAstralContentRegistry,
  composeManagedDlcList,
  addCarrierRegistryArchive,
} from "./registry-composers.js";
import { FAST_WEAPON_DLC_NAME, FAST_WEAPON_DLC_TARGET, fastWeaponHostReady as checkFastWeaponHostReady } from "./fast-weapon-dlc.js";
import { rebaseBeforeUninstall } from "./direct-update-rebase.js";
import { directDlcsOf } from "./direct-dlcs.js";
import { rebaseArchiveIfNeeded } from "./archive-rebase.js";
import { removeModLayers, settleAudioSlotLayer } from "./mod-layers.js";
import { activeBaselinePath, DEFAULT_DIR, statePaths } from "./storage-state.js";
import { resolveInside, sha256File } from "./manifest.js";
import { assertRuntimeSafe } from "./runtime-guard.js";
import { readState, serializeMutation, writeState } from "./engine-state.js";
import { composeArchiveResource } from "./resource-composition.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
import { defaultOpsEngineFor, deferredBuildFor, opsAllowedFor } from "./ops-build.js";
import { recoverPendingTransactions, transact, opsHoldIsKnown, opsRouteIsOpen } from "./transactions.js";
import { orderForCarriers } from "./carrier-order.js";
import { addSubpackHostArchives, pruneEmptySubpackResources } from "./subpack-closure.js";
import { pruneEmptyManagedDirectories } from "./fs-guards.js";
import { reduxLayerOf } from "./redux-state.js";
import { forgetParked } from "./parked-mods.js";

/*
 * Снятие нескольких модов одной транзакцией (23.11.2026, «удаление стволов из библиотеки слишком долгое»: пак из N стволов снимался N раз
 * подряд, каждый раз сборка и подмена затронутых архивов, а последний ствол — ещё и `update.rpf` на 2 ГБ ради регистрации DLC).
 * Снятие (одного мода и пачкой) вынесено из `index.js` 24.11.2026 (потолок строк); `index.js` отдаёт `uninstallPackage` и `uninstallPackages` наружу как прежде.
 *
 * `modIds` снимаются разом: слои всех модов уходят из состояния, каждый затронутый архив собирается один раз, подмена одна, состояние
 * пишется один раз. Всё или ничего: отказ сборки или подмены оставляет и игру, и состояние прежними (так отвечает `transact`).
 * Моды, которым пачка не подходит — редукс со слоем движка, нет в описи («снят проверкой файлов»), — и пачка при дозаписи (`appendInstall`:
 * снятие последнего дозаписанного мода откатом) идут прежним `uninstallPackage` по одному. Один мод — тоже прежний путь, байт в байт.
 * Неизвестный id и повтор молча пропускаются, как у снятия по одному.
 */
export function uninstallPackagesBatched(input = {}) {
  const modIds = [...new Set((Array.isArray(input.modIds) ? input.modIds : []).map(String).filter(Boolean))];
  const { modIds: _ignored, ...common } = input;
  return inOperation(async () => {
    if (!modIds.length) return null;
    if (modIds.length === 1 || common.appendInstall) {
      let state = null;
      for (const modId of modIds) state = await uninstallPackageNow({ ...common, modId });
      return state;
    }
    const stateDir = common.stateDir ?? DEFAULT_DIR;
    const targetKey = checkedRecordKey(common.targetId ?? "default", "Target ID");
    /* Какие из названных идут пачкой, а какие по одному: по записям состояния (после доводки прерванной транзакции). */
    const plain = await serializeMutation(async () => {
      await recoverPendingTransactions({ stateDir });
      const target = ownRecordValue((await readState(stateDir)).targets, targetKey);
      return modIds.filter((modId) => {
        const installed = (target?.installed || []).find((item) => item.modId === modId);
        return installed && !reduxLayerOf(installed);
      });
    });
    const rest = modIds.filter((modId) => !plain.includes(modId));
    let state = null;
    if (plain.length === 1) rest.unshift(plain[0]);
    else if (plain.length > 1) state = await uninstallBatchNow({ ...common, modIds: plain });
    for (const modId of rest) state = await uninstallPackageNow({ ...common, modId });
    return state;
  });
}

export async function uninstallPackageNow({
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
    await (await import("./direct-dlc-settle.js")).settleEmptyDirectDlcs({ target, targetKey, paths, dlcListProvider, directDlcs, touched: affectedArchives }); /* опустевший прямой DLC выключается (`direct-dlc-settle.js`) */
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

async function uninstallBatchNow({
  modIds,
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
  audioChunkMaterializer = null,
  audioSlotSettler = null,
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
      throw new Error("Сначала завершите сеанс Vanilla Guard и восстановите профиль.");
    /* Состояние могло измениться после выбора пачки: чего уже нет — пропускаем, редукс сюда не пускаем. */
    const records = modIds.map((modId) => (target.installed || []).find((item) => item.modId === modId)).filter(Boolean);
    for (const installed of records)
      if (reduxLayerOf(installed)) throw new Error("Редукс снимается отдельно: пачка его не берёт.");
    if (!records.length) return next;
    onProgress?.({ phase: "compose", percent: 24, cancellable: true });
    for (const installed of records)
      if (
        (installed.archiveEntries || []).some((item) => item.target === FAST_WEAPON_DLC_TARGET) &&
        !(await checkFastWeaponHostReady(target, { resolveInside, sha256File: fingerprintSha256 }))
      )
        throw new Error("Astral Weapons DLC изменён. Сначала повторите подготовку GTA V в Astral.");
    const paths = statePaths(stateDir);
    /* Перебазирование по каждому моду — до того, как слои хоть одного уйдут: каждое видит состояние, как оно было до пачки. */
    const directDlcsOfMod = new Map();
    for (const installed of records) {
      const directDlcs = directDlcsOf(installed, target.directDlcRegistrations);
      directDlcsOfMod.set(installed.modId, directDlcs);
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
      for (const archiveTarget of new Set((installed.archiveEntries || []).map((item) => item.target)))
        await rebaseArchiveIfNeeded({ target, archiveTarget, paths, targetKey, signal });
    }
    const affectedArchives = new Set();
    const removedResources = new Set();
    for (const installed of records) {
      for (const relativePath of installed.resources || []) {
        const resource = target.resources[relativePath];
        if (!resource) continue;
        resource.layers = (resource.layers || []).filter((layer) => layer.modId !== installed.modId);
        removedResources.add(relativePath);
      }
      for (const archiveTarget of removeModLayers(target, installed, installed.modId)) affectedArchives.add(archiveTarget);
    }
    /* Источник ресурса — верхний слой, что остался ПОСЛЕ снятия всех модов пачки. */
    const affected = [...removedResources].map((relativePath) => {
      const resource = target.resources[relativePath];
      const top = resource.layers.at(-1);
      return {
        relativePath,
        livePath: resolveInside(target.gameRoot, relativePath),
        sourcePath: top?.cachePath || activeBaselinePath(target, resource),
      };
    });
    addCarrierRegistryArchive(target, affectedArchives);
    await addSubpackHostArchives({ target, archives: affectedArchives, root: target.gameRoot, paths, targetKey, signal });
    if (await settleAudioSlotLayer({ audioSlotSettler, target, targetKey, paths, signal })) affectedArchives.add("update/update.rpf");
    /* Прямые DLC: пока в них что-то стоит, они включены; снятие последней вещи выключает DLC (регистрация уходит из `update.rpf`). */
    const directDlcs = [...new Map([...directDlcsOfMod.values()].flat().map((dlc) => [dlc.name, dlc])).values()];
    const uninstallsFastWeapon = directDlcs.some((dlc) => dlc.name === FAST_WEAPON_DLC_NAME);
    await (await import("./direct-dlc-settle.js")).settleEmptyDirectDlcs({ target, targetKey, paths, dlcListProvider, directDlcs, touched: affectedArchives });
    const engineInstall = defaultOpsEngineFor({ gameRoot: target.gameRoot, workId: records[0].modId });
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
        deferBuild: opsHold && archiveTarget === ASTRAL_UPDATE_TARGET,
      });
      affected.push({ relativePath: archiveTarget, livePath: resolveInside(target.gameRoot, archiveTarget), sourcePath });
    }
    /* Список DLC хоста: регистрация каждого снятого мода с DLC уходит; список собирается один раз. */
    for (const installed of records) {
      if (!installed.dlcName) continue;
      target.dlcRegistrations ||= {};
      if (target.dlcRegistrations[installed.dlcName]?.modId === installed.modId) delete target.dlcRegistrations[installed.dlcName];
    }
    if (records.some((installed) => installed.dlcName)) {
      const sourcePath = await composeManagedDlcList({ target, targetKey: targetId, paths });
      affected.push({ relativePath: MANAGED_DLC_LIST_TARGET, livePath: resolveInside(target.gameRoot, MANAGED_DLC_LIST_TARGET), sourcePath });
    }
    pruneEmptySubpackResources(target, affectedArchives);
    orderForCarriers(affected, "remove");
    if (opsHold)
      for (const item of affected) {
        if (item.relativePath !== ASTRAL_UPDATE_TARGET) continue;
        const build = deferredBuildFor(item.sourcePath);
        if (build && (await opsRouteIsOpen(item, build, engineInstall, signal))) item.verifyHeld = async () => {};
      }
    const removed = new Set(records.map((installed) => installed.modId));
    target.installed = target.installed.filter((item) => !removed.has(item.modId));
    onProgress?.({ phase: "ready-to-commit", percent: 90, cancellable: true });
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-uninstall-commit");
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
      onStaging: onProgress
        ? ({ copiedBytes, totalBytes }) => onProgress({ phase: "commit", percent: 94, cancellable: false, copiedBytes, totalBytes })
        : null,
    });
    await pruneEmptyManagedDirectories(target.gameRoot, affected.map((item) => item.relativePath));
    if (uninstallsFastWeapon) {
      const savedTarget = ownRecordValue(result.targets, targetKey);
      const [updateStat, hostStat] = await Promise.all([
        fs.lstat(resolveInside(target.gameRoot, "update/update.rpf")),
        fs.lstat(resolveInside(target.gameRoot, FAST_WEAPON_DLC_TARGET)),
      ]);
      savedTarget.fastWeaponDlc.updateIdentity = { size: updateStat.size, mtimeMs: updateStat.mtimeMs };
      savedTarget.fastWeaponDlc.hostIdentity = {
        size: hostStat.size,
        sha256: await sha256File(resolveInside(target.gameRoot, FAST_WEAPON_DLC_TARGET)),
      };
      await writeState(result, stateDir);
    }
    onProgress?.({ phase: "finalizing", percent: 99, cancellable: false });
    return result;
  });
}
