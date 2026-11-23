/*
 * Животные в игре (05.11.2026): план и «Применить».
 *
 * Сборку пакета (чтение игры, перекраска листов, метка и свечение в модели тела) делает поток чтения игры
 * (`animals-build.js`): главный процесс игру не читает. Здесь — то, что нельзя отдать потоку: подтверждённая папка игры,
 * предохранитель «игра закрыта» и сама установка пакетом движка в свой контейнер слоя Astral
 * `x64/astral/astral_animals.rpf`. Прежний пакет животных уходит тем же движением (`replaceModIds`): животные в игре одни;
 * остальные работы мастерской не трогаются. Снимается пакет корзиной библиотеки или «Снять из игры» в редакторе — как любой мод
 * слоя, по `layerModId` записи.
 *
 * Планы живут в главном процессе: установка ставит ровно собранное, и работа второй раз через мост окна не едет.
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { discoverGames } from "@modovik/game-discovery";
import { inspectProfile, installLocalAnimalsPackage, planPackage, sha256File } from "@modovik/install-engine";
import { ANIMALS_CONTAINER, isAnimalsModId, isLocalAnimalsManifest } from "@modovik/install-engine/animals-manifest-trust.js";
import { composeRpfArchive, installRpfPrebuilt, probeRpfArchive, provideLegacyDlcList, provideUpdateContentXml } from "../rpf-composer.js";

const PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_PLANS = 8;

const defaultTools = () => ({
  discover: discoverGames,
  readState: inspectProfile,
  plan: planPackage,
  install: installLocalAnimalsPackage,
  installPrebuilt: installRpfPrebuilt,
  composeRpf: composeRpfArchive,
  probeRpf: probeRpfArchive,
  provideContentXml: provideUpdateContentXml,
  provideDlcList: provideLegacyDlcList,
});

/* Установка идёт только в копию игры, которую подтвердил поиск Astral. */
async function confirmedGame(gameRoot, discover) {
  const games = await discover();
  const game = (games || []).find((item) => item?.path && path.resolve(item.path).toLowerCase() === gameRoot.toLowerCase());
  if (!game) throw new Error("Папка GTA V Legacy не подтверждена Astral.");
  if (String(game.edition || "Legacy").toLowerCase() !== "legacy") throw new Error("Животные ставятся только в GTA V Legacy.");
  /* План по архиву, который лаунчер сейчас переписывает, — шум, а запись в него — порча. */
  if (game.launcherState?.busy) throw new Error("Лаунчер обновляет или проверяет GTA V. Дождитесь завершения операции.");
  return game;
}

/** Пакеты животных, которые движок числит за этой игрой. */
export async function installedAnimals(readState, stateDir, targetId) {
  const state = await readState({ stateDir });
  const target = state?.targets?.[targetId];
  return (target?.installed || []).filter((item) => isAnimalsModId(item?.modId));
}

/*
 * Между планом и установкой проходят секунды, но папка — на диске человека: облачные папки и антивирусы умеют подменять файлы
 * на лету. Ставится ровно то, что посчитано в манифесте.
 */
async function assertPackageIntact(built) {
  for (const file of built.manifest.files) {
    const payload = path.join(built.packageRoot, file.source);
    const actual = await sha256File(payload).catch(() => null);
    if (actual !== file.sha256) throw new Error(`Файл животных ${path.basename(payload)} изменился после проверки — нажмите «Применить» ещё раз.`);
  }
}

function engineOptions(built, gameRoot, targetId, stateDir, tools) {
  return {
    manifest: built.manifest,
    packageRoot: built.packageRoot,
    gameRoot,
    targetId,
    edition: "Legacy",
    stateDir,
    allowGameRootWrites: true,
    requireSignature: false,
    ...(typeof tools.probeRpf === "function" ? { rpfProbe: tools.probeRpf } : {}),
  };
}

const summaryOf = (built) => ({
  modId: built.manifest.id,
  entry: ANIMALS_CONTAINER,
  archive: "update/update.rpf",
  files: built.manifest.files.length,
  animals: built.animals,
  edition: "Legacy",
  restartRequired: true,
});

export function createAnimalsService({ stateDir, tools: overrides = {}, build, onProgress = null, clock = Date.now }) {
  const tools = { ...defaultTools(), ...overrides };
  const plans = new Map();
  const prune = () => {
    const now = clock();
    for (const [id, plan] of plans) if (plan.expiresAt <= now) plans.delete(id);
    while (plans.size > MAX_PLANS) plans.delete(plans.keys().next().value);
  };

  /**
   * План: собрать пакет и сказать, что сделает «Применить». `status` — `install` (в игре нет такого облика) или `unchanged`
   * (стоит ровно этот — ставить незачем).
   */
  async function plan(input) {
    const gameRoot = path.resolve(String(input?.gameRoot || ""));
    const game = await confirmedGame(gameRoot, tools.discover);
    const targetId = String(game.id);
    /* `pictures` — свои эмблемы меток: отпечаток → PNG base64 (сверяются сборкой, `normalizeEmblems`). */
    const built = await build({ gameRoot, project: input?.project, pictures: input?.pictures });
    if (!isLocalAnimalsManifest(built?.manifest, "Legacy")) throw new Error("Собранные файлы животных не прошли строгую проверку доверия.");
    const current = await installedAnimals(tools.readState, stateDir, targetId);
    const same = current.length === 1 && current[0].modId === built.manifest.id;
    prune();
    const planId = randomUUID();
    plans.set(planId, { built, gameRoot, targetId, expiresAt: clock() + PLAN_TTL_MS });
    return {
      planId,
      status: same ? "unchanged" : "install",
      replaces: current.map((item) => item.modId).filter((modId) => modId !== built.manifest.id),
      ...summaryOf(built),
    };
  }

  /** «Применить» по плану. Прежний пакет животных уходит тем же движением; пакеты других слотов не трогаются. */
  async function apply(input, { assertRuntimeSafety } = {}) {
    const gameRoot = path.resolve(String(input?.gameRoot || ""));
    const planId = String(input?.planId || "");
    const planned = plans.get(planId);
    plans.delete(planId);
    if (!planned || planned.gameRoot.toLowerCase() !== gameRoot.toLowerCase()) throw new Error("План установки животных устарел — нажмите «Применить» ещё раз.");
    const { built, targetId } = planned;
    await confirmedGame(gameRoot, tools.discover);
    await assertRuntimeSafety?.(gameRoot);
    await assertPackageIntact(built);

    const current = await installedAnimals(tools.readState, stateDir, targetId);
    if (current.length === 1 && current[0].modId === built.manifest.id)
      return { status: "unchanged", layerModId: built.manifest.id, gameRoot, targetId, ...summaryOf(built) };

    const options = engineOptions(built, gameRoot, targetId, stateDir, tools);
    const enginePlan = await tools.plan(options);
    const replaceModIds = [...new Set([...(enginePlan?.conflicts || []).map((item) => item.modId), ...current.map((item) => item.modId)])]
      .filter((modId) => modId !== built.manifest.id)
      .sort();
    await tools.install({
      ...options,
      replaceModIds,
      rpfComposer: tools.composeRpf,
      contentXmlProvider: tools.provideContentXml,
      dlcListProvider: tools.provideDlcList,
      assertRuntimeSafety: () => assertRuntimeSafety?.(gameRoot),
      /* Пересборка архива игры идёт десятки секунд. Без вестей окно выглядит зависшим, и человек закрывает его посреди работы. */
      onProgress,
    });
    return {
      status: "installed",
      layerModId: built.manifest.id,
      replaced: replaceModIds,
      gameRoot,
      targetId,
      installedAt: new Date(clock()).toISOString(),
      ...summaryOf(built),
    };
  }

  return Object.freeze({ plan, apply });
}
