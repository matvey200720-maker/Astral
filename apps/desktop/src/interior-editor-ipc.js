import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  getInteriorLocation,
  INTERIOR_LOCATIONS,
} from "@modovik/interior-contract";
import { assertInstallRuntimeSafe } from "./install-safety.js";
import {
  applyInteriorCustomization,
  installedInteriorCustomizations,
  planInteriorCustomization,
  removeInteriorCustomization,
} from "./interior-customizer.js";

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

export function createInteriorEditorService({
  stateDir,
  findGame,
  compileNative,
  gameProcessRunning,
  onProgress,
}) {
  const plans = new Map();
  const prune = () => {
    const now = Date.now();
    for (const [id, plan] of plans) if (plan.expiresAt <= now) plans.delete(id);
  };
  const assertGameReady = async (
    gameRoot,
    targetId,
    { mutate = false } = {},
  ) => {
    const game = await findGame(targetId);
    if (
      path.resolve(game.path).toLowerCase() !==
      path.resolve(gameRoot).toLowerCase()
    )
      throw new Error(
        "Выбранная папка GTA V не совпадает с найденной установкой Astral.",
      );
    if (String(game.edition || "").toLowerCase() !== "legacy")
      throw new Error("Редактор интерьеров поддерживает только GTA V Legacy.");
    if (game.installReadiness !== "ready")
      throw new Error("Сначала подготовьте GTA V для модификаций.");
    if (mutate && (await gameProcessRunning(game)))
      throw new Error("Закройте GTA V перед изменением интерьера.");
    return game;
  };
  const dependencies = (targetId) => ({
    compileNative,
    assertGameReady: (gameRoot, options) =>
      assertGameReady(gameRoot, targetId, options),
    assertRuntimeSafety: assertInstallRuntimeSafe,
    /* Фазы пересборки уходят в окно: без них «Применить» молчит десятки
       секунд, и это выглядит как зависание. */
    onProgress,
  });

  return Object.freeze({
    async capabilities(input) {
      exact(input, ["targetId"], "interiorCapabilities");
      const game = await findGame(input.targetId);
      const installed = await installedInteriorCustomizations(
        stateDir,
        input.targetId,
      );
      return {
        available:
          String(game.edition || "").toLowerCase() === "legacy" &&
          String(game.buildId || "") === "24129523" &&
          game.installReadiness === "ready" &&
          INTERIOR_LOCATIONS.some(
            (location) =>
              location.installable &&
              location.supportedBuildIds.includes(String(game.buildId || "")),
          ),
        edition: game.edition,
        buildId: game.buildId,
        installed,
      };
    },

    async plan(input) {
      exact(
        input,
        ["projectId", "design", "expectedDesignHash", "gameRoot", "targetId"],
        "planInterior",
      );
      const location = getInteriorLocation(
        input.design?.locationBinding?.locationId,
      );
      if (!location) throw new Error("Локация проекта не найдена.");
      const result = await planInteriorCustomization(
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
        designHash: input.expectedDesignHash,
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
        [
          "projectId",
          "design",
          "expectedDesignHash",
          "planId",
          "gameRoot",
          "targetId",
        ],
        "applyInterior",
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
        plan.designHash !== input.expectedDesignHash
      )
        throw new Error(
          "План установки интерьера отсутствует, устарел или изменён.",
        );
      return applyInteriorCustomization(
        { ...input, expectedManifestHash: plan.manifestHash },
        stateDir,
        dependencies(input.targetId),
      );
    },

    async remove(input) {
      exact(input, ["modId", "gameRoot", "targetId"], "removeInterior");
      return removeInteriorCustomization(
        input,
        stateDir,
        dependencies(input.targetId),
      );
    },
  });
}

/*
 * Обвязка принимается той же, что у воды, звука и растительности
 * (`installOptions`): своя форма зависимостей стоила бы в main.js лишних строк
 * и лишнего способа добраться до каталога состояния.
 */
export function registerInteriorEditorIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  installOptions,
  findGame,
  compileNative,
  gameProcessRunning,
  operations = null,
}) {
  let servicePromise;
  const service = async () => {
    if (!servicePromise)
      servicePromise = installOptions().then(({ stateDir }) =>
        createInteriorEditorService({
          stateDir,
          findGame,
          compileNative,
          gameProcessRunning,
          onProgress: (status) => operations?.report(status),
        }),
      );
    return servicePromise;
  };
  const run = (method) => (event, input) =>
    trusted(event, async () => (await service())[method](safeInput(input)));
  handleIpc(IPC.WORKSHOP_INTERIOR_CAPABILITIES, run("capabilities"));
  handleIpc(IPC.WORKSHOP_PLAN_INTERIOR, run("plan"));
  handleIpc(IPC.WORKSHOP_APPLY_INTERIOR, run("apply"));
  handleIpc(IPC.WORKSHOP_REMOVE_INTERIOR, run("remove"));
}
