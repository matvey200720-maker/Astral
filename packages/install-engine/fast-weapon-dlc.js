import fs from "node:fs/promises";
import path from "node:path";
import {
  ASTRAL_UPDATE_TARGET,
  composeAstralContentRegistry,
  composeDirectDlcRegistry,
  expectedManagedHostSha256,
} from "./registry-composers.js";
import { reachedByOwnNativeChanges } from "./native-history.js";
import { activeBaseline } from "./storage-state.js";

export const FAST_WEAPON_DLC_NAME = "astral_weapons";
export const FAST_WEAPON_DLC_TARGET =
  "update/x64/dlcpacks/astral_weapons/dlc.rpf";

const FAST_WEAPON_STREAM_PREFIX = "astral_stream.rpf/";
const LEGACY_WEAPON_STREAM_PREFIX = "x64/astral/astral_weapons.rpf/";
const FAST_WEAPON_SCHEMA = 1;

/*
 * update.rpf наш: ровно тот, что движок записал последним, или получен из него работами мастерской. Эффект убийства, трассеры, мини-карта,
 * прицел пишут архив нативным хостом, мимо состояния движка (`native-history.js`), поэтому один хэш движка тут мало: 30.10.2026 ганпак после
 * «Эффекта убийства» падал с «Astral Weapons DLC не подготовлен или изменён» до перезапуска Astral. Архив, к которому вернула проверка файлов, —
 * не наш, даже если старая цепочка точек к нему ведёт: регистрации хоста в нём нет.
 */
async function ownUpdateArchive(target, updatePath, sha256File) {
  const resource = target.resources?.[ASTRAL_UPDATE_TARGET];
  const baseline = activeBaseline(target, resource || {});
  const expected = resource?.layers?.at(-1)?.sha256 || baseline.sha256;
  if (!expected) return false;
  const live = await sha256File(updatePath);
  if (live === expected) return true;
  if ([resource?.original?.sha256, resource?.pristine?.sha256].includes(live)) return false;
  return reachedByOwnNativeChanges({
    gameRoot: target.gameRoot,
    known: [expected, resource?.compositionBase?.liveSha256],
    live,
  });
}

export async function fastWeaponHostReady(
  target,
  { resolveInside, sha256File, allowPrepared = false },
) {
  const preparedOnly = target?.fastWeaponDlc?.preparedOnly === true;
  if (
    target?.fastWeaponDlc?.schema !== FAST_WEAPON_SCHEMA ||
    (!target.directDlcRegistrations?.[FAST_WEAPON_DLC_NAME] &&
      !(allowPrepared && preparedOnly))
  ) {
    return false;
  }
  const updatePath = resolveInside(target.gameRoot, ASTRAL_UPDATE_TARGET);
  const hostPath = resolveInside(target.gameRoot, FAST_WEAPON_DLC_TARGET);
  try {
    const [updateStat, hostStat] = await Promise.all([
      fs.lstat(updatePath),
      fs.lstat(hostPath),
    ]);
    if (
      !updateStat.isFile() ||
      updateStat.isSymbolicLink() ||
      !hostStat.isFile() ||
      hostStat.isSymbolicLink()
    ) {
      return false;
    }
    const identity = target.fastWeaponDlc.updateIdentity;
    const sameUpdate = Boolean(
      identity &&
      updateStat.size === identity.size &&
      Math.trunc(updateStat.mtimeMs) === Math.trunc(identity.mtimeMs),
    );
    /*
     * Отпечаток помнит update.rpf на последней записи оружия. Мини-карта,
     * трассер, таймцикл, починка после проверки файлов лаунчером — любая
     * своя запись движка переписывает update.rpf, и отпечаток устаревает.
     * Раньше это читалось как «DLC изменён»: ганпак после мини-карты не
     * снимался и новый не ставился до перезапуска Astral (стенд установки,
     * Т-75). Чей файл — говорит хэш, который движок записал последним (его
     * же сверяет аудит): совпал — архив наш, нет — его правили снаружи.
     */
    if (
      !sameUpdate &&
      !(await ownUpdateArchive(target, updatePath, sha256File))
    )
      return false;
    const hostResource = target.resources?.[FAST_WEAPON_DLC_TARGET];
    /* Без слоёв в игре лежит исходный файл, а не основа Astral. */
    const expectedHostHash = expectedManagedHostSha256(target, hostResource);
    return Boolean(
      expectedHostHash && (await sha256File(hostPath)) === expectedHostHash,
    );
  } catch {
    return false;
  }
}

function migrateLegacyWeaponLayers(target) {
  const updateArchive = target.archives?.[ASTRAL_UPDATE_TARGET];
  const hostArchive = target.archives?.[FAST_WEAPON_DLC_TARGET];
  if (!updateArchive || !hostArchive) return 0;
  let migrated = 0;
  for (const [entry, entryState] of Object.entries(
    updateArchive.entries || {},
  )) {
    if (
      !entry.toLowerCase().startsWith(LEGACY_WEAPON_STREAM_PREFIX.toLowerCase())
    ) {
      continue;
    }
    const relativeEntry = entry.slice(LEGACY_WEAPON_STREAM_PREFIX.length);
    if (!relativeEntry) continue;
    const destination = `${FAST_WEAPON_STREAM_PREFIX}${relativeEntry}`;
    const destinationState =
      hostArchive.entries[destination] ||
      (hostArchive.entries[destination] = { layers: [] });
    const migratedLayers = (entryState.layers || []).map((layer) => {
      const copy = { ...layer };
      delete copy.astralContent;
      return copy;
    });
    destinationState.layers = [
      ...(destinationState.layers || []).filter(
        (layer) => !migratedLayers.some((item) => item.modId === layer.modId),
      ),
      ...migratedLayers,
    ];
    delete updateArchive.entries[entry];
    migrated += migratedLayers.length;
    for (const installed of target.installed || []) {
      installed.archiveEntries = (installed.archiveEntries || []).map((item) =>
        item.target === ASTRAL_UPDATE_TARGET && item.entry === entry
          ? { target: FAST_WEAPON_DLC_TARGET, entry: destination }
          : item,
      );
    }
  }
  return migrated;
}

async function ensureFastWeaponArchiveResource(
  { target, targetKey, paths, root, baseDlc, signal },
  deps,
) {
  const {
    copyFileCancellable,
    exists,
    missingBaseline,
    resolveInside,
    sha256File,
  } = deps;
  target.resources ||= {};
  target.archives ||= {};
  const existing = target.resources[FAST_WEAPON_DLC_TARGET];
  if (existing) {
    target.archives[FAST_WEAPON_DLC_TARGET] ||= { entries: {} };
    target.archives[FAST_WEAPON_DLC_TARGET].entries ||= {};
    existing.persistentManaged = true;
    const desiredHash = await sha256File(baseDlc);
    if (existing.compositionBase?.sha256 !== desiredHash) {
      const directory = path.join(paths.bases, targetKey, "fast-weapons");
      const compositionPath = path.join(
        directory,
        `astral_weapons.${desiredHash.slice(0, 16)}.base.rpf`,
      );
      await fs.mkdir(directory, { recursive: true });
      if (!(await exists(compositionPath))) {
        await copyFileCancellable(baseDlc, compositionPath, signal);
      }
      const compositionBase = {
        exists: true,
        path: compositionPath,
        sha256: desiredHash,
        verified: true,
      };
      existing.base = compositionBase;
      existing.compositionBase = compositionBase;
      delete target.archives[FAST_WEAPON_DLC_TARGET].lastBuilt;
    }
    return existing;
  }
  const sourceStat = await fs.lstat(baseDlc);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error("Подготовленный Astral Weapons DLC небезопасен.");
  }
  const directory = path.join(paths.bases, targetKey, "fast-weapons");
  const compositionPath = path.join(directory, "astral_weapons.base.rpf");
  await fs.mkdir(directory, { recursive: true });
  await copyFileCancellable(baseDlc, compositionPath, signal);
  const compositionBase = {
    exists: true,
    path: compositionPath,
    sha256: await sha256File(compositionPath),
    verified: true,
  };
  const livePath = resolveInside(root, FAST_WEAPON_DLC_TARGET);
  const originalExists = await exists(livePath);
  let original = missingBaseline();
  if (originalExists) {
    const liveStat = await fs.lstat(livePath);
    if (!liveStat.isFile() || liveStat.isSymbolicLink()) {
      throw new Error("Существующий Astral Weapons DLC небезопасен.");
    }
    const originalPath = path.join(directory, "pre-astral.original.rpf");
    await copyFileCancellable(livePath, originalPath, signal);
    original = {
      exists: true,
      path: originalPath,
      sha256: await sha256File(originalPath),
      verified: true,
    };
  }
  const resource = {
    base: compositionBase,
    compositionBase,
    original,
    clean: missingBaseline(),
    persistentManaged: true,
    layers: [],
  };
  target.resources[FAST_WEAPON_DLC_TARGET] = resource;
  target.archives[FAST_WEAPON_DLC_TARGET] = { entries: {} };
  return resource;
}

async function changedFile(relativePath, sourcePath, root, deps) {
  const { exists, resolveInside, sha256File } = deps;
  const livePath = resolveInside(root, relativePath);
  if (!(await exists(livePath))) {
    return { relativePath, livePath, sourcePath };
  }
  const [sourceStat, liveStat] = await Promise.all([
    fs.lstat(sourcePath),
    fs.lstat(livePath),
  ]);
  if (
    !sourceStat.isFile() ||
    sourceStat.isSymbolicLink() ||
    !liveStat.isFile() ||
    liveStat.isSymbolicLink()
  ) {
    throw new Error(`Небезопасный файл в транзакции: ${relativePath}`);
  }
  if (
    sourceStat.size === liveStat.size &&
    (await sha256File(sourcePath)) === (await sha256File(livePath))
  ) {
    return null;
  }
  return { relativePath, livePath, sourcePath };
}

export async function provisionFastWeaponDlcCore(
  {
    gameRoot,
    targetId,
    edition,
    stateDir,
    baseDlc,
    rpfComposer,
    dlcListProvider,
    contentXmlProvider,
    signal,
    assertRuntimeSafety,
    onProgress,
    activate = true,
    /* Сборщики слоёв update.rpf (трассеры, PTFX, кровь): пересборка архива
       складывает заново все его записи, а не только оружейные. */
    materializers = {},
    /* Точка движка для подготовки (`kind=provision`, шаг 3 фазы 7): `{ install, pointsRoot }`. Без неё — прежний путь. */
    engineInstall = null,
  },
  deps,
) {
  const {
    assertGameRoot,
    assertRuntimeSafe,
    checkedRecordKey,
    composeArchiveResource,
    ensureArchiveResource,
    exists,
    readState,
    rebaseDirectUpdateIfNeeded,
    recoverPendingTransactions,
    resolveInside,
    serializeMutation,
    sha256File,
    statePaths,
    ownRecordValue,
    setRecordValue,
    targetKeyFor,
    transact,
    writeState,
  } = deps;
  return serializeMutation(async () => {
    if (edition !== "Legacy") {
      return { ready: false, changed: false, reason: "unsupported-edition" };
    }
    const root = path.resolve(gameRoot);
    await assertGameRoot(root);
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-weapon-host");
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const targetKey = targetKeyFor(targetId, root);
    checkedRecordKey(targetKey, "Target ID");
    const currentTarget = ownRecordValue(current.targets, targetKey);
    /* Основа хоста сменилась (новая схема \`setup2.xml\`/\`content.xml\`) —
       хост собирается заново, даже если нынешний цел: иначе в игре так и
       оставался бы прежний, который игра не монтирует. */
    const baseCurrent = async () => {
      if (!baseDlc || !(await exists(baseDlc))) return true;
      const resource = currentTarget?.resources?.[FAST_WEAPON_DLC_TARGET];
      return (
        resource?.compositionBase?.sha256 === (await sha256File(baseDlc))
      );
    };
    if (
      currentTarget &&
      (await fastWeaponHostReady(currentTarget, {
        resolveInside,
        sha256File,
        allowPrepared: !activate,
      })) &&
      (await baseCurrent())
    ) {
      return { ready: true, changed: false, target: FAST_WEAPON_DLC_TARGET };
    }
    if (!baseDlc || !(await exists(baseDlc))) {
      throw new Error("Базовый Astral Weapons DLC не подготовлен.");
    }
    const next = structuredClone(current);
    const target = currentTarget
      ? ownRecordValue(next.targets, targetKey)
      : {
          id: targetKey,
          gameRoot: root,
          edition,
          baselineMode: "original",
          installed: [],
          resources: {},
          archives: {},
          dlcRegistrations: {},
          directDlcRegistrations: {},
        };
    if (target.vanillaGuard && target.vanillaGuard.phase !== "restored") {
      throw new Error(
        "Сначала завершите сеанс Vanilla Guard и восстановите профиль.",
      );
    }
    target.gameRoot = root;
    target.edition = edition;
    target.resources ||= {};
    target.archives ||= {};
    target.dlcRegistrations ||= {};
    target.directDlcRegistrations ||= {};
    setRecordValue(next.targets, targetKey, target);
    const paths = statePaths(stateDir);
    onProgress?.({ phase: "weapon-host-backup", percent: 20 });
    await ensureArchiveResource({
      target,
      archiveTarget: ASTRAL_UPDATE_TARGET,
      root,
      paths,
      targetKey,
      signal,
      onProgress,
    });
    await rebaseDirectUpdateIfNeeded({
      target,
      root,
      paths,
      targetKey,
      contentXmlProvider,
      dlcListProvider,
      signal,
    });
    await ensureFastWeaponArchiveResource(
      {
        target,
        targetKey,
        paths,
        root,
        baseDlc: path.resolve(baseDlc),
        signal,
      },
      deps,
    );
    const migratedLayers = migrateLegacyWeaponLayers(target);
    /* Стволы уже стоят в хосте — DLC остаётся включённым: иначе запись снималась в состоянии, а в dlclist.xml оставалась, и правка update.rpf снаружи упиралась
       в «registers unknown Astral DLC» (07.10.2026). Пустой хост со стоящей записью выключается, как при снятии (`direct-dlc-settle.js`). */
    const hostInUse = Object.values(
      target.archives?.[FAST_WEAPON_DLC_TARGET]?.entries || {},
    ).some((entry) => (entry?.layers || []).length > 0);
    const shouldActivate = activate || migratedLayers > 0 || hostInUse;
    let touchesUpdate = shouldActivate;
    if (shouldActivate) {
      target.directDlcRegistrations[FAST_WEAPON_DLC_NAME] = {
        owner: "@astral-fast-weapon-host",
        registeredAt: new Date().toISOString(),
      };
      await composeDirectDlcRegistry({
        target,
        targetKey,
        paths,
        dlcListProvider,
        archiveTarget: ASTRAL_UPDATE_TARGET,
      });
      await composeAstralContentRegistry({
        target,
        targetKey,
        paths,
        contentXmlProvider,
        archiveTarget: ASTRAL_UPDATE_TARGET,
      });
    } else if (target.directDlcRegistrations[FAST_WEAPON_DLC_NAME]) {
      touchesUpdate = true;
      await (await import("./direct-dlc-settle.js")).unregisterDirectDlc({ target, targetKey, paths, dlcListProvider, name: FAST_WEAPON_DLC_NAME });
    } else {
      delete target.directDlcRegistrations[FAST_WEAPON_DLC_NAME];
    }
    onProgress?.({ phase: "weapon-host-compose", percent: 65 });
    const hostSource = await composeArchiveResource({
      target,
      archiveTarget: FAST_WEAPON_DLC_TARGET,
      targetKey,
      edition,
      gameRoot: root,
      paths,
      rpfComposer,
      signal,
      assertRuntimeSafety,
      onProgress,
    });
    const updateSource = touchesUpdate
      ? await composeArchiveResource({
          target,
          archiveTarget: ASTRAL_UPDATE_TARGET,
          targetKey,
          edition,
          gameRoot: root,
          paths,
          rpfComposer,
          ...materializers,
          signal,
          assertRuntimeSafety,
          onProgress,
        })
      : null;
    const affected = (
      await Promise.all([
        touchesUpdate
          ? changedFile(ASTRAL_UPDATE_TARGET, updateSource, root, deps)
          : null,
        changedFile(FAST_WEAPON_DLC_TARGET, hostSource, root, deps),
      ])
    ).filter(Boolean);
    target.fastWeaponDlc = {
      schema: FAST_WEAPON_SCHEMA,
      target: FAST_WEAPON_DLC_TARGET,
      migratedLayers,
      preparedAt: new Date().toISOString(),
      preparedOnly: !shouldActivate,
    };
    onProgress?.({ phase: "weapon-host-commit", percent: 95 });
    /* Подготовка — точкой движка `kind=provision`: хост и регистрация, без переигрывания. Состояние профиля — прежнее. */
    const provisionEngine =
      engineInstall && affected.length
        ? {
            install: engineInstall.install,
            edition,
            gameRoot: root,
            pointsRoot: engineInstall.pointsRoot,
            multi: true,
            replay: {
              module: "weapon-host",
              kind: "provision",
              workId: "astral-weapons-host",
              version: "1",
              sourceDigest: `sha256:${await sha256File(path.resolve(baseDlc))}`,
              order: { kind: "provision" },
            },
          }
        : null;
    const result = affected.length
      ? await transact({
          stateDir,
          current,
          next,
          targetId: targetKey,
          affected,
          action: "prepare-fast-weapons",
          signal,
          ...(provisionEngine ? { engineInstall: provisionEngine } : {}),
        })
      : await writeState(next, stateDir);
    const [updateStat, hostStat] = await Promise.all([
      fs.lstat(resolveInside(root, ASTRAL_UPDATE_TARGET)),
      fs.lstat(resolveInside(root, FAST_WEAPON_DLC_TARGET)),
    ]);
    const savedTarget = ownRecordValue(result.targets, targetKey);
    savedTarget.fastWeaponDlc.updateIdentity = {
      size: updateStat.size,
      mtimeMs: updateStat.mtimeMs,
    };
    savedTarget.fastWeaponDlc.hostIdentity = {
      size: hostStat.size,
      sha256: await sha256File(resolveInside(root, FAST_WEAPON_DLC_TARGET)),
    };
    await writeState(result, stateDir);
    onProgress?.({ phase: "weapon-host-ready", percent: 100 });
    return {
      ready: true,
      active: shouldActivate,
      changed: affected.length > 0 || migratedLayers > 0,
      migratedLayers,
      target: FAST_WEAPON_DLC_TARGET,
    };
  });
}
