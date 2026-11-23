/*
 * Граница главного процесса для готового набора звуков из папки.
 *
 * Обвязка та же, что у готовой карты, залазов и интерьеров: строгая форма
 * входа, один план на одно применение с временем жизни, и одна и та же
 * проверка игры на все операции. Второго способа добраться до каталога
 * состояния здесь не заводится.
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { discoverGames } from "@modovik/game-discovery";
import { assertInstallRuntimeSafe } from "./install-safety.js";
import { legacyRuntimeGuard } from "./legacy-runtime-guard.js";
import { resolvePackSource } from "./pack-source.js";
import {
  applySoundPack,
  collectSoundPack,
  installedSoundPacks,
  planSoundPack,
  removeSoundPack,
} from "./sound-pack-customizer.js";

const PLAN_TTL_MS = 10 * 60 * 1000;

function exact(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} должен быть объектом.`);
  const expected = new Set(fields);
  for (const field of Object.keys(value))
    if (!expected.has(field))
      throw new TypeError(`${label}.${field}: неизвестное поле.`);
  for (const field of fields)
    if (!Object.hasOwn(value, field))
      throw new TypeError(`${label}.${field}: поле обязательно.`);
}

export function createSoundPackService({
  stateDir,
  /* Установка ищется по папке, а не по `targetId`, — почему, сказано у
     `assertGameReady`. Параметром обнаружение стоит ради тестов. */
  listGames = discoverGames,
  /* Тот же предохранитель, что у слоёв студии звука: набор пишет в те же
     звуковые архивы. Параметром он стоит ради тестов — проверять надо решение
     ворот, а не tasklist машины. */
  runtimeGuard = legacyRuntimeGuard("звукового пака", "Звуковой пак"),
  chooseFolder,
  onProgress,
}) {
  const plans = new Map();
  const prune = () => {
    const now = Date.now();
    for (const [id, plan] of plans) if (plan.expiresAt <= now) plans.delete(id);
  };
  /*
   * Годится ли игра для готового набора звуков.
   *
   * Готовность «к модам» (`installReadiness`) здесь нарочно не спрашивается.
   * Она про ASI-загрузчик для папки mods, а набор кладёт банки прямо в
   * звуковые архивы игры (`scope: game-root`, `requiresLoader: false`) — так
   * же, как слои студии рядом, которые этой готовности не требуют. Прежнее
   * требование запирало панель на машинах без `dinput8.dll`, а подготовка игры
   * при чужом загрузчике (OpenIV) отказывает — выхода не было.
   *
   * Установка ищется по папке. `targetId` у звука — ключ профиля движка, а не
   * номер установки: студия пишет свои слои в профиль "default", и панель
   * наборов — туда же, иначе набор и слой не видели бы друг друга на одних и
   * тех же банках. Поиск установки по этому ключу (`findGame("default")`) не
   * находил её никогда и отвечал «Установка GTA V больше не найдена». Номер
   * самой установки вместо "default" принимается, если это она и есть.
   *
   * Держится то, что действительно важно: установка, найденная Astral, издание
   * Legacy и лаунчер, который не переписывает архивы прямо сейчас. Установка и
   * снятие вдобавок проходят предохранитель — закрытая игра, нет тени папки
   * mods.
   */
  const assertGameReady = async (
    gameRoot,
    targetId,
    { mutate = false } = {},
  ) => {
    const root = path.resolve(gameRoot);
    const games = await listGames();
    const game = (Array.isArray(games) ? games : []).find(
      (item) =>
        path.resolve(String(item?.path || "")).toLowerCase() ===
        root.toLowerCase(),
    );
    if (!game) throw new Error("Папка GTA V Legacy не подтверждена Astral.");
    const profile = String(targetId || "default");
    if (profile !== "default" && profile !== String(game.id || ""))
      throw new Error(
        "Профиль установки не совпадает с выбранной папкой GTA V.",
      );
    if (String(game.edition || "").toLowerCase() !== "legacy")
      throw new Error(
        "Готовые наборы звуков поддерживаются только в GTA V Legacy.",
      );
    /* Это прежняя готовность тоже держала («launcher-busy»), и уходить вместе
       с загрузчиком ему нельзя: план по архиву, который лаунчер переписывает,
       — шум, а запись в него — порча. */
    if (game.launcherState?.busy)
      throw new Error(
        "Лаунчер обновляет или проверяет GTA V. Дождитесь завершения операции.",
      );
    /* План только читает архивы, и запущенная игра ему не помеха — как у слоёв
       студии. Предохранитель стоит там, где пишут. */
    if (mutate) await runtimeGuard.assertRuntimeSafety(root);
    return game;
  };
  const dependencies = (targetId) => ({
    assertGameReady: (gameRoot, options) =>
      assertGameReady(gameRoot, targetId, options),
    assertRuntimeSafety: assertInstallRuntimeSafe,
    /* Фазы пересборки уходят в окно: без них «Применить» молчит десятки
       секунд, и это выглядит как зависание. */
    onProgress,
  });

  return Object.freeze({
    /**
     * Показать папку или архив с набором звуков и сказать, что нашлось.
     *
     * Архив распаковывается здесь, а наружу уходит уже папка: план и
     * установка ниже про архивы ничего не знают и знать не должны.
     */
    async choose(input) {
      exact(input, [], "chooseSoundPack");
      const chosen = await chooseFolder();
      if (!chosen) return { cancelled: true };
      const source = await resolvePackSource(chosen, { stateDir });
      const collected = await collectSoundPack(source.root);
      return {
        cancelled: false,
        fromArchive: source.extracted,
        sourceRoot: collected.root,
        entries: collected.files.map((file) => ({
          entry: file.entry,
          archive: file.archive,
          bank: file.bank,
          source: file.source,
          size: file.size,
        })),
        skipped: collected.skipped,
        bytes: collected.bytes,
      };
    },

    async installed(input) {
      exact(input, ["targetId"], "installedSoundPacks");
      return installedSoundPacks(stateDir, input.targetId);
    },

    async plan(input) {
      exact(
        input,
        ["sourceRoot", "name", "gameRoot", "targetId"],
        "planSoundPack",
      );
      const result = await planSoundPack(
        input,
        stateDir,
        dependencies(input.targetId),
      );
      prune();
      const planId = randomUUID();
      const expiresAt = Date.now() + PLAN_TTL_MS;
      plans.set(planId, {
        sourceRoot: path.resolve(input.sourceRoot),
        targetId: input.targetId,
        gameRoot: path.resolve(input.gameRoot),
        manifestHash: result.manifestHash,
        expiresAt,
      });
      return {
        ...result,
        planId,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },

    async apply(input) {
      exact(
        input,
        ["sourceRoot", "name", "planId", "gameRoot", "targetId"],
        "applySoundPack",
      );
      prune();
      const plan = plans.get(String(input.planId || ""));
      plans.delete(String(input.planId || ""));
      if (
        !plan ||
        plan.targetId !== input.targetId ||
        plan.sourceRoot.toLowerCase() !==
          path.resolve(input.sourceRoot).toLowerCase() ||
        plan.gameRoot.toLowerCase() !==
          path.resolve(input.gameRoot).toLowerCase()
      )
        throw new Error(
          "План установки набора звуков отсутствует, устарел или изменён.",
        );
      return applySoundPack(
        { ...input, expectedManifestHash: plan.manifestHash },
        stateDir,
        dependencies(input.targetId),
      );
    },

    async remove(input) {
      exact(input, ["modId", "gameRoot", "targetId"], "removeSoundPack");
      return removeSoundPack(input, stateDir, dependencies(input.targetId));
    },
  });
}

/* Обвязка та же, что у залазов и интерьеров: одна форма зависимостей на все
   редакторы, чтобы в main.js не заводить второй способ добраться до
   каталога состояния. `findGame` и `gameProcessRunning`, которые приходят из
   main.js вместе с остальной обвязкой, здесь не нужны: установку ищут по
   папке, закрытую игру проверяет предохранитель, а внутри транзакции — ещё
   раз движок. */
export function registerSoundPackIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  installOptions,
  chooseFolder,
  operations = null,
}) {
  let servicePromise;
  const service = async () => {
    if (!servicePromise)
      servicePromise = installOptions().then(({ stateDir }) =>
        createSoundPackService({
          stateDir,
          chooseFolder,
          onProgress: (status) => operations?.report(status),
        }),
      );
    return servicePromise;
  };
  const run = (method) => (event, input) =>
    trusted(event, async () => (await service())[method](safeInput(input)));
  handleIpc(IPC.WORKSHOP_CHOOSE_SOUND_PACK, run("choose"));
  handleIpc(IPC.WORKSHOP_SOUND_PACKS_INSTALLED, run("installed"));
  handleIpc(IPC.WORKSHOP_PLAN_SOUND_PACK, run("plan"));
  handleIpc(IPC.WORKSHOP_APPLY_SOUND_PACK, run("apply"));
  handleIpc(IPC.WORKSHOP_REMOVE_SOUND_PACK, run("remove"));
}
