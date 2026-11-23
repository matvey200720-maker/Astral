import fs from "node:fs/promises";
import path from "node:path";
import { fingerprintSha256 } from "./file-fingerprint.js";
import {
  ASTRAL_UPDATE_TARGET,
  composeAstralContentRegistry,
  composeDirectDlcRegistry,
  expectedManagedHostSha256,
} from "./registry-composers.js";

export const CLOTHING_DLC_NAME = "astral_clothing";
export const CLOTHING_DLC_TARGET =
  "update/x64/dlcpacks/astral_clothing/dlc.rpf";
const CLOTHING_DLC_SCHEMA = 1;

/*
 * Регистрация DLC одежды живёт в update.rpf (`common/data/dlclist.xml`): без неё игра DLC не монтирует, и вещь, лежащая в astral_clothing/dlc.rpf, невидима на любом сервере.
 * Состояние Astral о возврате update.rpf снаружи (лаунчер Rockstar «проверил файлы», Steam, ручная подмена) не знает, и установка, увидев «DLC готов, зарегистрирован», ставила
 * вещь за пару секунд «успешно» (13.11.2026, песочница: после возврата update.rpf без регистрации следующая покраска оставляла dlclist без astral_clothing). Теперь «зарегистрирован» —
 * только пока живой update.rpf тот, что собрал Astral (последний слой состояния); иначе DLC готовится заново, и пакет регистрирует его при установке.
 * Отпечаток — по записи файла на диске (`file-fingerprint.js`): без правок файла это не чтение двух гигабайт.
 */
async function updateKeepsRegistration(target, resolveInside) {
  if (!target.directDlcRegistrations?.[CLOTHING_DLC_NAME]) return true;
  const composed = target.resources?.[ASTRAL_UPDATE_TARGET]?.layers?.at(-1)?.sha256;
  if (!composed) return true;
  try {
    return (await fingerprintSha256(resolveInside(target.gameRoot, ASTRAL_UPDATE_TARGET))) === composed;
  } catch {
    return false;
  }
}

/*
 * Что состояние Astral знает о DLC одежды — для самопочинки приложения (13.11.2026): без записи, без восстановления транзакций, без чтения dlclist.xml.
 *  - `inUse` — одежда Astral стоит: DLC записан в состоянии как зарегистрированный или в нём лежит вещь из `astral_clothing/dlc.rpf`;
 *  - `host` — `present` | `missing`: файл DLC в игре;
 *  - `paused` — `vanilla` (идёт сеанс игры без модов: регистрации в update.rpf нет намеренно, её вернёт конец сеанса), `stock-hold` (игра возвращена к исходной и удерживается), иначе `null`: пока так, ничего не чинится;
 *  - `update` — `same` (живой update.rpf — тот, что собрал Astral, регистрация в нём), `changed` (файл правили снаружи: лаунчер Rockstar, Steam, ручная подмена),
 *    `unregistered` (состояние не считает DLC зарегистрированным), `unknown` (слоёв update.rpf в состоянии ещё нет).
 */
export async function clothingRegistrationStatus(target, { resolveInside }) {
  const registered = Boolean(target?.directDlcRegistrations?.[CLOTHING_DLC_NAME]);
  const placed = (target?.installed || []).some((item) =>
    (item?.archiveEntries || []).some((entry) => entry.target === CLOTHING_DLC_TARGET),
  );
  if (!target?.gameRoot || (!registered && !placed)) return { inUse: false };
  let host = "missing";
  try {
    const stat = await fs.lstat(resolveInside(target.gameRoot, CLOTHING_DLC_TARGET));
    if (stat.isFile() && !stat.isSymbolicLink()) host = "present";
  } catch {
    /* файла нет — host остаётся missing */
  }
  let update = "unregistered";
  if (registered) update = (await updateKeepsRegistration(target, resolveInside)) ? "same" : "changed";
  if (registered && !target.resources?.[ASTRAL_UPDATE_TARGET]?.layers?.at(-1)?.sha256) update = "unknown";
  const paused = target.vanillaGuard && target.vanillaGuard.phase !== "restored" ? "vanilla" : target.stockHold ? "stock-hold" : null;
  return { inUse: true, registered, host, update, paused };
}

export async function clothingHostReady(
  target,
  { resolveInside, sha256File, allowPrepared = false },
) {
  const state = target?.clothingDlc;
  if (
    state?.schema !== CLOTHING_DLC_SCHEMA ||
    state?.target !== CLOTHING_DLC_TARGET ||
    (!target.directDlcRegistrations?.[CLOTHING_DLC_NAME] &&
      !(allowPrepared && state.preparedOnly === true))
  ) {
    return false;
  }
  const hostPath = resolveInside(target.gameRoot, CLOTHING_DLC_TARGET);
  try {
    const stat = await fs.lstat(hostPath);
    const resource = target.resources?.[CLOTHING_DLC_TARGET];
    /* Без слоёв в игре лежит исходный файл, а не основа Astral. */
    const expected = expectedManagedHostSha256(target, resource);
    const hostIntact = Boolean(
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      expected &&
      (await sha256File(hostPath)) === expected,
    );
    return hostIntact && (await updateKeepsRegistration(target, resolveInside));
  } catch {
    return false;
  }
}

async function ensureHostResource(
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
  const existing = target.resources[CLOTHING_DLC_TARGET];
  if (existing) {
    target.archives[CLOTHING_DLC_TARGET] ||= { entries: {} };
    target.archives[CLOTHING_DLC_TARGET].entries ||= {};
    existing.persistentManaged = true;
    /*
     * Основа хоста сменилась (схема 3 — `GROUP_STARTUP`, 04.10.2026): слои
     * собираются уже на новой. Без этого архив в игре навсегда оставался
     * на старой основе с `GROUP_UPDATE_STREAMING`, которую игра не
     * монтирует, — покраски одежды и тату в игре были не видны. Так же
     * сделано у Astral Weapons DLC (`fast-weapon-dlc.js`).
     */
    const desiredHash = await sha256File(baseDlc);
    if (existing.compositionBase?.sha256 !== desiredHash) {
      const directory = path.join(paths.bases, targetKey, "clothing-dlc");
      const compositionPath = path.join(
        directory,
        `astral_clothing.${desiredHash.slice(0, 16)}.base.rpf`,
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
      delete target.archives[CLOTHING_DLC_TARGET].lastBuilt;
    }
    return existing;
  }
  const stat = await fs.lstat(baseDlc);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Подготовленный Astral Clothing DLC небезопасен.");
  }
  const directory = path.join(paths.bases, targetKey, "clothing-dlc");
  const compositionPath = path.join(directory, "astral_clothing.base.rpf");
  await fs.mkdir(directory, { recursive: true });
  await copyFileCancellable(baseDlc, compositionPath, signal);
  const compositionBase = {
    exists: true,
    path: compositionPath,
    sha256: await sha256File(compositionPath),
    verified: true,
  };
  const livePath = resolveInside(root, CLOTHING_DLC_TARGET);
  const originalExists = await exists(livePath);
  let original = missingBaseline();
  if (originalExists) {
    const liveStat = await fs.lstat(livePath);
    if (!liveStat.isFile() || liveStat.isSymbolicLink()) {
      throw new Error("Существующий Astral Clothing DLC небезопасен.");
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
  target.resources[CLOTHING_DLC_TARGET] = resource;
  target.archives[CLOTHING_DLC_TARGET] = { entries: {} };
  return resource;
}

async function changedFile(relativePath, sourcePath, root, deps) {
  const { exists, resolveInside, sha256File } = deps;
  const livePath = resolveInside(root, relativePath);
  if (!(await exists(livePath))) return { relativePath, livePath, sourcePath };
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

export async function provisionClothingDlcCore(
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
       складывает заново все его записи, а не только одежду. */
    materializers = {},
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
    await assertRuntimeSafe(
      assertRuntimeSafety,
      signal,
      "before-clothing-host",
    );
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const targetKey = targetKeyFor(targetId, root);
    checkedRecordKey(targetKey, "Target ID");
    const currentTarget = ownRecordValue(current.targets, targetKey);
    /* Основа хоста сменилась (новая схема) — собрать хост заново. */
    const baseCurrent = async () => {
      if (!baseDlc || !(await exists(baseDlc))) return true;
      const resource = currentTarget?.resources?.[CLOTHING_DLC_TARGET];
      return (
        resource?.compositionBase?.sha256 === (await sha256File(baseDlc))
      );
    };
    if (
      currentTarget &&
      (await clothingHostReady(currentTarget, {
        resolveInside,
        sha256File,
        allowPrepared: !activate,
      })) &&
      (await baseCurrent())
    ) {
      return { ready: true, changed: false, target: CLOTHING_DLC_TARGET };
    }
    if (!baseDlc || !(await exists(baseDlc))) {
      throw new Error("Базовый Astral Clothing DLC не подготовлен.");
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
      throw new Error("Сначала завершите сеанс Vanilla Guard.");
    }
    target.gameRoot = root;
    target.edition = edition;
    target.resources ||= {};
    target.archives ||= {};
    target.dlcRegistrations ||= {};
    target.directDlcRegistrations ||= {};
    setRecordValue(next.targets, targetKey, target);
    const paths = statePaths(stateDir);
    onProgress?.({ phase: "clothing-host-backup", percent: 20 });
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
    await ensureHostResource(
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
    if (activate) {
      target.directDlcRegistrations[CLOTHING_DLC_NAME] = {
        owner: "@astral-clothing-host",
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
    } else {
      delete target.directDlcRegistrations[CLOTHING_DLC_NAME];
    }
    onProgress?.({ phase: "clothing-host-compose", percent: 65 });
    const hostSource = await composeArchiveResource({
      target,
      archiveTarget: CLOTHING_DLC_TARGET,
      targetKey,
      edition,
      gameRoot: root,
      paths,
      rpfComposer,
      signal,
      assertRuntimeSafety,
      onProgress,
    });
    const updateSource = activate
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
        activate
          ? changedFile(ASTRAL_UPDATE_TARGET, updateSource, root, deps)
          : null,
        changedFile(CLOTHING_DLC_TARGET, hostSource, root, deps),
      ])
    ).filter(Boolean);
    target.clothingDlc = {
      schema: CLOTHING_DLC_SCHEMA,
      target: CLOTHING_DLC_TARGET,
      preparedAt: new Date().toISOString(),
      preparedOnly: !activate,
    };
    const result = affected.length
      ? await transact({
          stateDir,
          current,
          next,
          targetId: targetKey,
          affected,
          action: "prepare-clothing-dlc",
          signal,
        })
      : await writeState(next, stateDir);
    const savedTarget = ownRecordValue(result.targets, targetKey);
    savedTarget.clothingDlc.hostSha256 = await sha256File(
      resolveInside(root, CLOTHING_DLC_TARGET),
    );
    await writeState(result, stateDir);
    onProgress?.({ phase: "clothing-host-ready", percent: 100 });
    return {
      ready: true,
      active: activate,
      changed: affected.length > 0,
      target: CLOTHING_DLC_TARGET,
    };
  });
}
