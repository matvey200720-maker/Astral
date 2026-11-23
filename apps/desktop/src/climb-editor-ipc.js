import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertInstallRuntimeSafe } from "./install-safety.js";
import { legacyRuntimeGuard } from "./legacy-runtime-guard.js";
import { callNativeEngine } from "./native-engine.js";
import { compileClimbMarkers } from "./game-donor.js";
import { provisionArchiveSupport } from "./loader-provisioner.js";
import { appLog } from "./app-log.js";
import {
  applyClimbCustomization,
  climbDesignHash,
  planClimbCustomization,
  removeClimbCustomization,
} from "./climb-customizer.js";

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

export function createClimbEditorService({
  stateDir,
  findGame,
  /* Сборка моделей — нативный хост (`compile-climb-markers`). Параметром он
     стоит ради тестов: проверять надо пакет и ворота, а не Windows. */
  compile,
  /* Тот же предохранитель, что у большой карты, неба и воды. Параметром он
     стоит ради тестов: проверять надо решение ворот, а не tasklist машины. */
  runtimeGuard = legacyRuntimeGuard("залазов", "Залазы"),
  onProgress,
  resourceRoot = null,
}) {
  const plans = new Map();
  const prune = () => {
    const now = Date.now();
    for (const [id, plan] of plans) if (plan.expiresAt <= now) plans.delete(id);
  };
  /*
   * Годится ли игра для залазов.
   *
   * Готовность «к модам» (`installReadiness`) здесь нарочно не спрашивается.
   * Она про ASI-загрузчик — `dinput8.dll` и плагин архивов для папки mods, — а
   * залазы едут прямой схемой слоя Astral: в настоящий update.rpf, в контейнер
   * x64/astral/astral_climbs.rpf, с `requiresLoader: false`. Требование
   * загрузчика запирало редактор на машинах без `dinput8.dll`, а подготовка
   * игры, куда окно отправляло человека, отказывает при чужом загрузчике
   * (OpenIV) — выхода не было вовсе.
   *
   * Держится то, что для записи в update.rpf действительно важно: установка,
   * подтверждённая Astral, издание Legacy и лаунчер, который не переписывает
   * архив прямо сейчас. Установка и снятие вдобавок проходят предохранитель
   * слоя — закрытая игра, нет тени папки mods. Подготовка слоя отдельным шагом
   * тоже не нужна: первая прямая запись сама сохраняет оригинал update.rpf и
   * ищет чужой слой Astral (`installPackage`, ветка `direct-update-entries-v1`).
   */
  const assertGameReady = async (
    gameRoot,
    targetId,
    { mutate = false } = {},
  ) => {
    const game = await findGame(targetId);
    const root = path.resolve(gameRoot);
    if (path.resolve(game.path).toLowerCase() !== root.toLowerCase())
      throw new Error(
        "Выбранная папка GTA V не совпадает с найденной установкой Astral.",
      );
    if (String(game.edition || "").toLowerCase() !== "legacy")
      throw new Error("Залазы поддерживаются только в GTA V Legacy.");
    /* Это прежняя готовность тоже держала («launcher-busy»), и уходить вместе
       с загрузчиком ему нельзя: план по архиву, который лаунчер переписывает,
       — шум, а запись в него — порча. */
    if (game.launcherState?.busy)
      throw new Error(
        "Лаунчер обновляет или проверяет GTA V. Дождитесь завершения операции.",
      );
    /* План только читает архив, и запущенная игра ему не помеха — как у
       большой карты. Предохранитель стоит там, где пишут. */
    if (mutate) await runtimeGuard.assertRuntimeSafety(root);
    return game;
  };
  const dependencies = (targetId) => ({
    assertGameReady: (gameRoot, options) =>
      assertGameReady(gameRoot, targetId, options),
    assertRuntimeSafety: assertInstallRuntimeSafe,
    compile,
    resourceRoot,
    /* Фазы пересборки уходят в окно: без них «Применить» молчит десятки
       секунд, и это выглядит как зависание. */
    onProgress,
  });

  return Object.freeze({
    /*
     * План собирает набор по текстурам от окна и запоминает его за собой:
     * установка ставит ровно этот набор, и пять картинок второй раз через
     * мост окна не едут.
     */
    async plan(input) {
      exact(
        input,
        ["projectId", "design", "textures", "gameRoot", "targetId"],
        "planClimbs",
      );
      const { plan, built } = await planClimbCustomization(
        input,
        stateDir,
        dependencies(input.targetId),
      );
      prune();
      const planId = randomUUID();
      const expiresAt = Date.now() + PLAN_TTL_MS;
      plans.set(planId, {
        projectId: input.projectId,
        targetId: input.targetId,
        gameRoot: path.resolve(input.gameRoot),
        manifestHash: plan.manifestHash,
        designHash: built.designHash,
        built,
        expiresAt,
      });
      return {
        ...plan,
        planId,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },

    async apply(input) {
      exact(
        input,
        ["projectId", "design", "planId", "gameRoot", "targetId"],
        "applyClimbs",
      );
      prune();
      const plan = plans.get(String(input.planId || ""));
      plans.delete(String(input.planId || ""));
      if (
        !plan ||
        plan.projectId !== input.projectId ||
        plan.targetId !== input.targetId ||
        plan.gameRoot.toLowerCase() !==
          path.resolve(input.gameRoot).toLowerCase() ||
        plan.designHash !== climbDesignHash(input.design)
      )
        throw new Error(
          "План установки залазов отсутствует, устарел или изменён.",
        );
      return applyClimbCustomization(
        {
          ...input,
          built: plan.built,
          expectedManifestHash: plan.manifestHash,
        },
        stateDir,
        dependencies(input.targetId),
      );
    },

    async remove(input) {
      exact(input, ["modId", "gameRoot", "targetId"], "removeClimbs");
      return removeClimbCustomization(
        input,
        stateDir,
        dependencies(input.targetId),
      );
    },
  });
}

/*
 * Обвязка та же, что у интерьеров: своя форма зависимостей стоила бы в
 * main.js лишних строк и лишнего способа добраться до каталога состояния.
 *
 * `gameProcessRunning`, который приходит из main.js вместе с остальной
 * обвязкой, здесь не нужен: закрытую игру проверяет предохранитель слоя, а
 * внутри транзакции — ещё раз движок.
 */
export function registerClimbEditorIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  installOptions,
  findGame,
  nativeContext,
  operations = null,
}) {
  let servicePromise;
  const service = async () => {
    if (!servicePromise)
      servicePromise = installOptions().then(({ stateDir }) =>
        createClimbEditorService({
          stateDir,
          findGame,
          compile: (command, input) =>
            compileClimbMarkers(command, input, {
              stateDir,
              context: nativeContext?.(),
              call: callNativeEngine,
              provision: provisionArchiveSupport,
              log: (entry) => appLog.record(entry),
            }),
          onProgress: (status) => operations?.report(status),
        }),
      );
    return servicePromise;
  };
  const run = (method) => (event, input) =>
    trusted(event, async () => (await service())[method](safeInput(input)));
  handleIpc(IPC.WORKSHOP_PLAN_CLIMBS, run("plan"));
  handleIpc(IPC.WORKSHOP_APPLY_CLIMBS, run("apply"));
  handleIpc(IPC.WORKSHOP_REMOVE_CLIMBS, run("remove"));
}
