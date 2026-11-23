/*
 * Редукс в свой dlc со стороны приложения (17.11.2026, проводка редуксов, проект `docs/INSTALL-RUST-REDUX.md`, записка `-WIRING.md`).
 *
 * Движок установки (`installPackageBatch({ reduxInstall })`, `plan-install.js`) до `stagePackage` спрашивает у приложения две вещи:
 *   - `accepts(input)` — берёт ли путь этот пакет: включён ли выключатель (`ASTRAL_ENGINE_REDUX_DLC=redux`), найден ли движок и
 *     ложится ли пакет целиком в dlc (записи только классов D: контейнеры слоя; общие записи корня и записи вложенных штатных
 *     архивов остаются прежнему пути);
 *   - `install(input)` — поставить: оркестратор `installReduxDlc` на движке (`createExpressEngine`, слово модуля `redux`),
 *     сводный `dlclist.xml` — из живого `update.rpf` и dlc включённых редуксов, состояние слоя — в `redux-layers.json` рядом с
 *     состоянием установки. Пару «редукс + мод каталога на ту же запись» не запрещаем: до установки приложение зовёт `notify`
 *     (слова — `REDUX_PAIR_NOTICE`, словарь на шести языках).
 *
 * Выключатель пуст (по умолчанию) — `reduxInstallFor` отдаёт `null`, и ни один модуль ниже не подключается: установка идёт
 * прежним путём. Видимых человеку строк здесь нет, кроме слова пары (его показывает окно по полю `notice`).
 *
 * Что не сделано (записка `-WIRING.md`): слой не пишется в основное состояние установки (`stage-package.js`, `engine-state.js`),
 * поэтому «Снять», «Починить» и «Библиотека» такой слой пока не знают; состояние слоёв лежит отдельным файлом и читается
 * `readReduxLayers`.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { composeReduxDlcList } from "@modovik/install-engine/redux-dlc-host.js";
import { REDUX_DLC_ENV, disableReduxDlc, enableReduxDlc, installReduxDlc, reduxDlcEnabled, removeReduxDlc } from "@modovik/install-engine/redux-dlc.js";
import { dlcPackPath } from "@modovik/install-engine/express-dlc.js";
import { REDUX_PAIR_NOTICE, reduxPairConflicts } from "@modovik/install-engine/redux-pair.js";
import { routeReduxFiles } from "@modovik/install-engine/redux-routes.js";
import { readState, serializeMutation, writeState } from "@modovik/install-engine/engine-state.js";
import { newEngineSwapNames } from "@modovik/install-engine/engine-swap.js";
import { recordReduxLayer, reduxLayerOf, reduxLayersOf } from "@modovik/install-engine/redux-state.js";
import { reduxRefusal } from "@modovik/install-engine/redux-refusal.js";
import { runEngineCommand } from "./engine-run.js";
import { createExpressEngine } from "./express-engine.js";

/** Слово модуля: им включается выключатель оркестратора и ставятся выключатели движка этому процессу. */
export const REDUX_MODULE = "redux";
const DLCLIST_ENTRY = "common/data/dlclist.xml";
const UPDATE_TARGETS = new Set(["update/update.rpf", "mods/update/update.rpf"]);

/** Включён ли путь редуксов хоть для одного модуля. */
export const reduxSwitchedOn = (env = process.env) => String(env[REDUX_DLC_ENV] || "").trim() !== "";

/**
 * Установленные редуксы цели из основного состояния установки (`[{ modId, layerId, dlcs, state }]`, `installed.reduxLayer`);
 * состояния нет или оно негодно — пустой список.
 */
export async function readReduxLayers(stateDir, targetId = "default") {
  try {
    return reduxLayersOf((await readState(stateDir)).targets?.[targetId || "default"]);
  } catch {
    return [];
  }
}

/**
 * Осиротевшие dlc редуксов: каталог `astral_redux_*` с одним `dlc.rpf`, который не назван ни в одной записи состояния (любой цели) и не
 * назван в живом `dlclist.xml`. Такой файл не читает ни игра, ни Astral; он остаётся от оборванной установки. Каталог с другими
 * файлами (недостроенный dlc, который можно достроить) не трогается. Ответ — сколько убрано.
 */
export async function sweepOrphanReduxDlcs({ gameRoot, stateDir, dlclistText = "" }) {
  const packs = path.join(gameRoot, "update", "x64", "dlcpacks");
  const claimed = new Set();
  const state = await readState(stateDir);
  for (const target of Object.values(state.targets || {})) for (const layer of reduxLayersOf(target)) for (const dlc of layer.dlcs) claimed.add(dlc.name);
  const lowerList = String(dlclistText).toLowerCase();
  let removed = 0;
  for (const name of await fs.readdir(packs).catch(() => [])) {
    if (!name.startsWith("astral_redux_") || claimed.has(name) || lowerList.includes(`dlcpacks:/${name.toLowerCase()}/`)) continue;
    const directory = path.join(packs, name);
    const inside = await fs.readdir(directory).catch(() => []);
    if (inside.length !== 1 || inside[0] !== "dlc.rpf") continue;
    await fs.rm(path.join(directory, "dlc.rpf"), { force: true });
    await fs.rmdir(directory).catch(() => {});
    removed += 1;
  }
  return removed;
}

/** Живое тело `dlclist.xml` из `update.rpf` игры: движок извлекает запись во временную папку. */
async function readLiveDlcList({ executable, keysDirectory, gameRoot, scratch, run = runEngineCommand, signal = null }) {
  const update = path.join(gameRoot, "update", "update.rpf");
  const output = await fs.mkdtemp(path.join(scratch, "dlclist-"));
  const keys = keysDirectory ? ["--keys", keysDirectory] : [];
  const result = await run(executable, ["extract-archive-entries", "--input", update, "--output-dir", output, "--entry", DLCLIST_ENTRY, ...keys], { signal });
  const item = (result?.files || [])[0];
  if (!item?.file) throw new Error("Редукс: движок не отдал dlclist.xml игры.");
  return fs.readFile(path.join(output, String(item.file)), "utf8");
}

/**
 * Путь редукса для движка установки: `{ accepts, install }`.
 *
 * `locate()` — где движок: `{ executable, keysDirectory, pointsRoot }` (спрашивается, когда путь впервые понадобился).
 * `notify(notice)` — слово человеку до установки (пара с модом каталога). Остальное — для проверок.
 */
export function createReduxInstall({
  locate,
  env = process.env,
  fastInstall = false,
  writeLimitMbps = null,
  onProgress = null,
  notify = null,
  scratchRoot = os.tmpdir(),
  makeEngine = createExpressEngine,
  install = installReduxDlc,
  readDlcList = readLiveDlcList,
  baseHasArchive = undefined,
} = {}) {
  if (typeof locate !== "function") throw new Error("Редукс: не сказано, где движок.");
  let located = null;
  const place = () => (located ||= Promise.resolve().then(locate));
  const routesOf = (files) => routeReduxFiles(files, baseHasArchive ? { baseHasArchive } : {});

  const api = {
    async accepts({ files }) {
      if (!reduxDlcEnabled(REDUX_MODULE, env)) return false;
      if (!Array.isArray(files) || files.length === 0 || files.some((file) => !UPDATE_TARGETS.has(String(file.target || "").toLowerCase()))) return false;
      const routes = routesOf(files);
      if (routes.d.length === 0 || routes.switch.length > 0 || routes.linked.length > 0) return false;
      const { executable } = (await place().catch(() => null)) || {};
      return Boolean(executable);
    },

    async install({ parsed, files, gameRoot, targetId, edition = null, stateDir, signal = null }) {
      const { executable, keysDirectory = null, pointsRoot = null } = await place();
      const routes = routesOf(files);
      /* Слово человеку — до первого байта: пару не запрещаем, но говорим. */
      if (typeof notify === "function") {
        const targetKey = targetId || "default";
        const found = reduxPairConflicts({ routes, state: await readState(stateDir).catch(() => null), targetKey, modId: parsed.id });
        if (found.entries.length > 0) notify({ code: REDUX_PAIR_NOTICE.code, text: REDUX_PAIR_NOTICE.text, entries: found.entries, modIds: found.modIds });
      }
      const requestDir = await fs.mkdtemp(path.join(scratchRoot, "astral-redux-"));
      const stageDir = path.join(requestDir, "stage");
      try {
        const engine = makeEngine({ executable, moduleName: REDUX_MODULE, gameRoot, keysDirectory, pointsRoot, requestDir, fastInstall, writeLimitMbps, env });
        const baseList = await readDlcList({ executable, keysDirectory, gameRoot, scratch: requestDir, signal });
        const known = await readReduxLayers(stateDir, targetId || "default");
        let counter = 0;
        const registry = async (change) => {
          counter += 1;
          const stands = known.filter((layer) => layer.state === "enabled" && layer.layerId !== change.layerId).flatMap((layer) => layer.dlcs.map((dlc) => dlc.name));
          const names = change.action === "remove" || change.action === "disable" ? stands : [...stands, ...(change.dlcs ?? []).map((dlc) => dlc.name)];
          const source = path.join(requestDir, `dlclist-${counter}.xml`);
          await fs.writeFile(source, composeReduxDlcList(baseList, { reduxPacks: names }));
          return [{ entry: DLCLIST_ENTRY, source }];
        };
        /* Слой — запись `installed` основного состояния (не отдельный файл): «Библиотека», «Снять» и «Починить» видят его как мод.
           Мы уже внутри мутации установки (`installPackageBatch`), поэтому читаем и пишем состояние напрямую. */
        /* Точка отката дозаписи (`restore.json` с `createdFiles`): без неё созданный dlc и откат байт в байт не к чему привязать. */
        const { pointId } = newEngineSwapNames();
        const commit = async ({ layerId, dlcs, state }) => {
          const current = await readState(stateDir);
          recordReduxLayer(current, { targetKey: targetId || "default", gameRoot, edition, modId: parsed.id, version: parsed.version, layerId, dlcs, state, pointId });
          await writeState(current, stateDir);
        };
        const attempt = () =>
          install({
            engine,
            gameRoot,
            moduleName: REDUX_MODULE,
            cardId: parsed.id,
            files,
            stageDir,
            registry,
            commit,
            update: { pointId },
            /* Первый свободный `order` (58–104) вне уже записанных слоёв; чужие свои dlc игры в этот список пока не входят. */
            usedOrders: known.flatMap((layer) => layer.dlcs.map((dlc) => dlc.order)).filter(Number.isFinite),
            linked: "refuse",
            signal,
            onProgress,
          });
        try {
          return await attempt();
        } catch (error) {
          /* Обрыв процесса между готовым dlc и слоем оставляет целый dlc рядом с прежним `update.rpf`: повторная установка отказывала
             бы «файл уже есть». Осиротевший свой dlc (не назван ни в состоянии, ни в живом dlclist) убирается, и установка идёт заново. */
          if (error?.code !== "OUTPUT_EXISTS") throw error;
          const swept = await sweepOrphanReduxDlcs({ gameRoot, stateDir, dlclistText: baseList });
          if (swept === 0) throw error;
          return await attempt();
        }
      } finally {
        await fs.rm(requestDir, { recursive: true, force: true }).catch(() => {});
      }
    },

    /**
     * Пачка пакетов одной установкой: по порядку манифестов, каждый — отдельным dlc, слоем и записью (`install`); `order` берётся
     * первый свободный по состоянию, поэтому растёт: 58, 59, … Отказ любого пакета — ранее поставленные пакеты ЭТОЙ пачки снимаются в
     * обратном порядке (слой `remove`, dlc `release`, запись уходит), ошибка идёт наружу как была. Точки отката у каждого пакета свои.
     */
    async installBatch(inputs) {
      const done = [];
      const results = [];
      try {
        for (const input of inputs) {
          results.push(await api.install(input));
          done.push(input);
        }
        return results;
      } catch (error) {
        const remove = createReduxRemover({ locate, env, fastInstall, writeLimitMbps, scratchRoot, makeEngine, readDlcList });
        for (const input of done.reverse()) {
          try {
            const state = await readState(input.stateDir);
            const target = state.targets?.[input.targetId || "default"];
            const item = (target?.installed || []).find((entry) => entry.modId === input.parsed.id && reduxLayerOf(entry));
            if (!item) continue;
            await remove({ item, target, gameRoot: input.gameRoot, signal: null });
            target.installed = target.installed.filter((entry) => entry !== item);
            await writeState(state, input.stateDir);
          } catch (undoError) {
            console.warn(`[astral] Редукс: пачка не смогла снять ${input.parsed.id}: ${undoError?.message || undoError}`);
          }
        }
        throw error;
      }
    },
  };
  return api;
}

/*
 * Снятие и «Починить» установленных редуксов (`installed.reduxLayer`): крючки `reduxRemover` и `reduxRepairer` для
 * `uninstallPackage` и `repairTarget`. Выключателем не закрыты: слой, который уже стоит, снимается и чинится и при пустом выключателе.
 */
async function withReduxEngine({ locate, makeEngine, env, fastInstall, writeLimitMbps, scratchRoot, readDlcList }, { gameRoot, signal }, work) {
  const { executable, keysDirectory = null, pointsRoot = null } = await Promise.resolve().then(locate);
  const requestDir = await fs.mkdtemp(path.join(scratchRoot, "astral-redux-"));
  try {
    const engine = makeEngine({ executable, moduleName: REDUX_MODULE, gameRoot, keysDirectory, pointsRoot, requestDir, fastInstall, writeLimitMbps, env });
    const baseList = await readDlcList({ executable, keysDirectory, gameRoot, scratch: requestDir, signal });
    let counter = 0;
    /* Сводный dlclist: основа игры + dlc остальных включённых редуксов, без снимаемого слоя. */
    const registryWithout = (layerId, others) => async () => {
      counter += 1;
      const source = path.join(requestDir, `dlclist-${counter}.xml`);
      await fs.writeFile(source, composeReduxDlcList(baseList, { reduxPacks: others.filter((layer) => layer.state === "enabled" && layer.layerId !== layerId).flatMap((layer) => layer.dlcs.map((dlc) => dlc.name)) }));
      return [{ entry: DLCLIST_ENTRY, source }];
    };
    return await work({ engine, registryWithout });
  } finally {
    await fs.rm(requestDir, { recursive: true, force: true }).catch(() => {});
  }
}

const toolDefaults = ({ locate, env = process.env, fastInstall = false, writeLimitMbps = null, scratchRoot = os.tmpdir(), makeEngine = createExpressEngine, readDlcList = readLiveDlcList } = {}) => {
  if (typeof locate !== "function") throw new Error("Редукс: не сказано, где движок.");
  return { locate, env, fastInstall, writeLimitMbps, scratchRoot, makeEngine, readDlcList };
};

/**
 * Отказ движка человеку словами: ошибка уходит фразой «Редукс: …» (`redux-refusal.js`), а код и английский текст остаются в журнале.
 * Отмена (сигнал) отказом не считается и идёт как была.
 */
async function refusedInWords(work) {
  try {
    return await work();
  } catch (error) {
    if (error?.code === "CANCELLED" || error?.name === "AbortError") throw error;
    const refusal = reduxRefusal(error);
    console.warn(`[astral] Редукс: отказ «${refusal.kind}»: ${error?.message || error}`);
    throw Object.assign(new Error(refusal.text, { cause: error }), { code: `redux-${refusal.kind}` });
  }
}

/** Установленные редуксы всех целей для окна: `[{ targetId, modId, state, bytes }]`; `bytes` — сколько занимают свои dlc («занимает N ГБ»). */
export async function listReduxLayers(stateDir) {
  const state = await readState(stateDir);
  return Object.entries(state.targets || {}).flatMap(([targetId, target]) =>
    reduxLayersOf(target).map((layer) => ({ targetId, modId: layer.modId, state: layer.state, bytes: layer.dlcs.reduce((sum, dlc) => sum + (Number(dlc.bytes) || 0), 0) })),
  );
}

const LAYER_ACTIONS = new Set(["disable", "enable", "free"]);

/**
 * «Выключить / Включить / Освободить место» над установленным редуксом (окно, `REDUX_LAYER`). Выключить — слой снимается сменой
 * оглавления, dlc лежит; включить — dlc сверяется и слой включается; освободить место — только у выключенного: слой снят, dlc
 * освобождены, запись уходит (включить после этого — только загрузкой). `reduxLayer.state` пишется после успеха движка; отказ движка
 * оставляет запись как была. Идёт внутри очереди мутаций установки. Ответ: `{ state, bytes, freedBytes }`.
 */
export async function applyReduxLayerAction({ action, modId, targetId = "default", stateDir, signal = null, ...options }) {
  if (!LAYER_ACTIONS.has(action)) throw new Error("Редукс: неизвестное действие.");
  const tools = toolDefaults(options);
  return serializeMutation(async () => {
    const state = await readState(stateDir);
    const target = state.targets?.[targetId];
    const item = (target?.installed || []).find((entry) => entry.modId === modId && reduxLayerOf(entry));
    if (!item) throw new Error("Редукс не найден среди установленных.");
    const layer = reduxLayerOf(item);
    if (action === "free" && layer.state !== "disabled") throw new Error("Освободить место можно только у выключенного редукса.");
    const gameRoot = target.gameRoot;
    const others = reduxLayersOf(target).filter((entry) => entry.layerId !== layer.layerId);
    const bytes = layer.dlcs.reduce((sum, dlc) => sum + (Number(dlc.bytes) || 0), 0);
    const outcome = await refusedInWords(() => withReduxEngine(tools, { gameRoot, signal }, async ({ engine, registryWithout }) => {
      const common = { engine, gameRoot, moduleName: REDUX_MODULE, layerId: layer.layerId, dlcs: layer.dlcs, signal };
      if (action === "enable") {
        const standing = [...others, { layerId: layer.layerId, state: "enabled", dlcs: layer.dlcs }];
        await enableReduxDlc({ ...common, registry: registryWithout("", standing) });
        return { state: "enabled", freedBytes: 0 };
      }
      if (action === "disable") {
        await disableReduxDlc({ ...common, registry: registryWithout(layer.layerId, others) });
        return { state: "disabled", freedBytes: 0 };
      }
      const removed = await removeReduxDlc({ ...common, registry: registryWithout(layer.layerId, others), layerGone: "ignore", release: true });
      return { state: null, freedBytes: (removed.released || []).reduce((sum, entry) => sum + (entry.freedBytes || 0), 0) };
    }));
    if (outcome.state === null) target.installed = target.installed.filter((entry) => entry !== item);
    else layer.state = outcome.state;
    await writeState(state, stateDir);
    return { ...outcome, bytes };
  });
}

/** «Снять»: слой снимается (`remove`), свои dlc освобождаются; слоя в движке уже нет (архив пересоздан) — файлы всё равно освобождаются. */
export function createReduxRemover(options = {}) {
  const tools = toolDefaults(options);
  const remove = options.remove ?? removeReduxDlc;
  return async ({ item, target, gameRoot, signal = null }) => {
    const layer = reduxLayerOf(item);
    if (!layer) throw new Error("Редукс: у записи нет слоя.");
    return refusedInWords(() =>
      withReduxEngine(tools, { gameRoot, signal }, ({ engine, registryWithout }) =>
        remove({ engine, gameRoot, moduleName: REDUX_MODULE, layerId: layer.layerId, dlcs: layer.dlcs, registry: registryWithout(layer.layerId, reduxLayersOf(target)), layerGone: "ignore", release: true, signal }),
      ),
    );
  };
}

/**
 * «Починить»: каждый dlc редукса сверяется полностью (`verify-rpf-dlc`, чтение файла); не цел или пропал — редукс потерян: слой
 * снимается, dlc освобождаются (файл, который не наш, не трогается), запись уходит из установленного, и окно предложит поставить заново.
 * Цел — слой остаётся как был. Вернуть `{ lost: [modId] }`.
 */
export function createReduxRepairer(options = {}) {
  const tools = toolDefaults(options);
  const remove = options.remove ?? removeReduxDlc;
  return async ({ items, target, gameRoot, signal = null }) => {
    const lost = [];
    await withReduxEngine(tools, { gameRoot, signal }, async ({ engine, registryWithout }) => {
      for (const item of items) {
        const layer = reduxLayerOf(item);
        if (!layer) continue;
        let intact = true;
        for (const dlc of layer.dlcs) {
          const answer = await engine("verify-rpf-dlc", { module: REDUX_MODULE, path: dlcPackPath(gameRoot, dlc.name), bytes: dlc.bytes, sha256: dlc.sha256 }, { signal }).catch(() => null);
          if (answer?.verdict !== "intact") intact = false;
        }
        if (intact) continue;
        const others = reduxLayersOf(target).filter((entry) => entry.layerId !== layer.layerId && !lost.includes(entry.modId));
        await remove({ engine, gameRoot, moduleName: REDUX_MODULE, layerId: layer.layerId, dlcs: layer.dlcs, registry: registryWithout(layer.layerId, others), layerGone: "ignore", release: true, signal });
        /* Движок освобождает только файл, который доказанно наш (длина и хэш); испорченный остаётся и мешал бы новой установке
           («файл уже есть»). Слой снят, dlclist его уже не называет, имя `astral_redux_*` — наше: убираем сами. */
        for (const dlc of layer.dlcs) {
          const file = dlcPackPath(gameRoot, dlc.name);
          await fs.rm(file, { force: true });
          await fs.rmdir(path.dirname(file)).catch(() => {});
        }
        lost.push(item.modId);
      }
    });
    return { lost };
  };
}

/** Крючки снятия и «Починить» из приложения: движок, ключи и папка точек — как у остальных установок. Выключателем не закрыты. */
export function appReduxLocator({ stateDir, env = process.env } = {}) {
  let bridge = null;
  return {
    env,
    locate: async () => {
      const [native, rust, provisioner, chain] = await Promise.all([
        import("./native-engine.js"),
        import("./native-engine-rust.js"),
        import("./loader-provisioner.js"),
        import("./native-restore-chain.js"),
      ]);
      bridge = native;
      return {
        executable: rust.resolveRustExecutable({ ...native.engineLocationDefaults(), ...(native.nativeContextDefaultsOf() || {}) }),
        keysDirectory: (await provisioner.archiveKeysDirectory({ stateDir })) || null,
        pointsRoot: chain.nativeRestorePointsRoot(),
      };
    },
    fastInstall: () => bridge?.nativeFastInstall() === true,
    writeLimitMbps: () => bridge?.nativeWriteLimit() ?? null,
  };
}

export function appReduxTools({ stateDir, env = process.env } = {}) {
  const options = appReduxLocator({ stateDir, env });
  return { reduxRemover: createReduxRemover(options), reduxRepairer: createReduxRepairer(options) };
}

/** Путь редукса этой установки или `null`, если выключатель пуст: тогда движок установки идёт прежним путём. */
export function reduxInstallFor({ env = process.env, ...options } = {}) {
  return reduxSwitchedOn(env) ? createReduxInstall({ env, ...options }) : null;
}

/**
 * Путь редукса из приложения: движок, ключи и папка точек — как у остальных установок. Выключатель пуст — `null`, и ни один
 * модуль ниже не подключается.
 */
export function appReduxInstall({ stateDir, onProgress = null, notify = null, env = process.env } = {}) {
  if (!reduxSwitchedOn(env)) return null;
  let bridge = null;
  return createReduxInstall({
    env,
    notify,
    locate: async () => {
      const [native, rust, provisioner, chain] = await Promise.all([
        import("./native-engine.js"),
        import("./native-engine-rust.js"),
        import("./loader-provisioner.js"),
        import("./native-restore-chain.js"),
      ]);
      bridge = native;
      return {
        executable: rust.resolveRustExecutable({ ...native.engineLocationDefaults(), ...(native.nativeContextDefaultsOf() || {}) }),
        keysDirectory: (await provisioner.archiveKeysDirectory({ stateDir })) || null,
        pointsRoot: chain.nativeRestorePointsRoot(),
      };
    },
    fastInstall: () => bridge?.nativeFastInstall() === true,
    writeLimitMbps: () => bridge?.nativeWriteLimit() ?? null,
    onProgress: onProgress ? (step) => onProgress({ phase: "commit", percent: 99, cancellable: false, copiedBytes: step.done, totalBytes: step.total }) : null,
  });
}
