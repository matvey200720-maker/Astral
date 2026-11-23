/*
 * Прострелы в игре.
 *
 * Набор — шестнадцать оболочек укрытий из мода prostrel, их типы,
 * расстановка на 48 мест и `_manifest.ymf` (`resources/wallbang`, готовит
 * `scripts/prepare-wallbang-resources.mjs`). Облик оболочки задаёт зашитая
 * текстура 4×4 и множитель свечения шейдера, поэтому работа человека
 * доезжает до игры правкой моделей на месте (`patchDrawable`): цвет и альфа
 * — в текстуру, свечение — в `emissiveMultiplier`. Геометрия, места и
 * развороты остаются модовыми; типы, расстановка и манифест едут как есть.
 *
 * Всё ложится в свой контейнер слоя Astral — `x64/astral/astral_wallbang.rpf`
 * — пакетом движка установки. Залазы того же мода живут в `astral_maps.rpf`
 * своим пакетом: прострелы их не ставят, не снимают и не заменяют.
 *
 * Пакет детерминирован: тот же облик — тот же id, и повторное «Применить»
 * без правок архив игры не пересобирает.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { discoverGames } from "@modovik/game-discovery";
import { patchDrawable } from "@modovik/ypt";
import {
  WALLBANG_EMISSIVE_PARAMETER,
  WALLBANG_OBJECTS,
  WALLBANG_PLACEMENTS,
  WALLBANG_RESOURCES,
  WALLBANG_TEXTURE_NAME,
  normalizeWallbangProject,
  wallbangAssetName,
  wallbangObjectLook,
  wallbangProjectIsEmpty,
  wallbangTexturePayload,
} from "@modovik/climb-contract/wallbang";
import {
  engineInstallEnabled,
  inspectProfile,
  installLocalWallbangPackage,
  planPackage,
  sha256File,
} from "@modovik/install-engine";
import {
  buildWallbangManifest,
  isLocalWallbangManifest,
  isWallbangModId,
  WALLBANG_CONTAINER,
  WALLBANG_FILES,
} from "@modovik/install-engine/wallbang-manifest-trust.js";
import {
  composeRpfArchive,
  installRpfPrebuilt,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { readSetFiles } from "./set-resources.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const TYPES_FILE = "astral_wallbang.ytyp";
const PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_PLANS = 8;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const exists = (target) =>
  fs
    .access(target)
    .then(() => true)
    .catch(() => false);

async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Где лежат файлы набора: в собранном приложении — рядом с ресурсами, в
 * разработке — в репозитории. Переменная окружения — для тестов.
 */
export async function wallbangResourceRoot() {
  const candidates = [
    process.env.ASTRAL_WALLBANG_RESOURCES,
    process.resourcesPath && path.join(process.resourcesPath, "wallbang"),
    path.resolve(dirname, "../../../resources/wallbang"),
  ].filter(Boolean);
  for (const candidate of candidates)
    if (await exists(path.join(candidate, TYPES_FILE))) return candidate;
  throw new Error(
    "Файлы прострелов не найдены рядом с приложением — переустановите Astral.",
  );
}

/*
 * Файлы набора как они лежат рядом с приложением. Своему входу установщик
 * не верит: каждый сверяется с описью контракта — повреждённый или чужой
 * файл уехал бы в игру молча (`set-resources.js`: три причины отказа).
 */
const readResources = (root) =>
  readSetFiles(root, WALLBANG_RESOURCES, "Прострелы");

/**
 * Файлы набора под эту работу: модели оболочек с обликом из работы, типы,
 * расстановка и манифест — как есть. Скрытое укрытие едет моделью с
 * прозрачной текстурой: место в расстановке ждёт свою модель.
 */
export function buildWallbangFiles(project, resources) {
  const built = [];
  const looks = [];
  for (const name of WALLBANG_FILES) {
    const source = resources.get(name);
    if (!source) throw new Error(`В наборе прострелов нет ${name}.`);
    const object = WALLBANG_OBJECTS.find(
      (item) => `${wallbangAssetName(item.id)}.ydr` === name,
    );
    if (!object) {
      built.push({ name, bytes: source });
      continue;
    }
    const look = wallbangObjectLook(project, object.id);
    const { bytes } = patchDrawable(source, {
      textures: { [WALLBANG_TEXTURE_NAME]: wallbangTexturePayload(look) },
      vectors: { [WALLBANG_EMISSIVE_PARAMETER]: [look.emissive] },
    });
    built.push({ name, bytes });
    looks.push({
      id: object.id,
      visible: look.visible,
      colour: look.colour,
      alpha: look.alpha,
      emissive: look.emissive,
      places: WALLBANG_PLACEMENTS[object.id].length,
    });
  }
  return { files: built, looks };
}

/** Набор в кэше под хэшем содержимого: повторная сборка копий не плодит. */
export async function buildWallbangPackage(
  input,
  stateDir,
  { resourceRoot = null } = {},
) {
  const project = normalizeWallbangProject(input);
  if (wallbangProjectIsEmpty(project))
    throw new Error(
      "Все укрытия скрыты — ставить нечего. Чтобы убрать прострелы из игры, нажмите «Откатить».",
    );
  const root = resourceRoot || (await wallbangResourceRoot());
  const resources = await readResources(root);
  const { files, looks } = buildWallbangFiles(project, resources);
  const described = files.map((file) => ({
    name: file.name,
    size: file.bytes.length,
    sha256: sha256(file.bytes),
  }));
  const manifest = buildWallbangManifest(described);
  if (!isLocalWallbangManifest(manifest, "Legacy"))
    throw new Error("Собранные прострелы не прошли строгую проверку доверия.");
  const packageRoot = path.join(
    stateDir || os.tmpdir(),
    "wallbang",
    "packages",
    manifest.wallbang.sourceDigest.slice(
      "sha256:".length,
      "sha256:".length + 16,
    ),
  );
  for (const file of files) {
    const target = path.join(packageRoot, "payload", file.name);
    const current = await fs.readFile(target).catch(() => null);
    if (!current || !current.equals(file.bytes))
      await atomicWrite(target, file.bytes);
  }
  await pruneOldPackages(path.dirname(packageRoot), packageRoot, await replayPackageNames(stateDir));
  return {
    manifest,
    packageRoot,
    project,
    looks,
    files: described.map(({ name, size, sha256: hash }) => ({ name, size, sha256: hash })),
  };
}

/*
 * Запись переигрывания прострелов (`engineReplay`, шаг 3 фазы 7, за флагом `ASTRAL_ENGINE_INSTALL=wallbang-customizer`):
 * имя пакета, отпечаток и список файлов. Сами файлы лежат в постоянной папке пакета в `stateDir`.
 */
export function wallbangReplayRecord(built) {
  return {
    module: "wallbang-customizer",
    workId: built.manifest.id,
    version: built.manifest.version,
    sourceDigest: built.manifest.wallbang.sourceDigest,
    order: { files: built.files.map(({ name, size, sha256: hash }) => ({ name, size, sha256: hash })) },
  };
}

/*
 * Пакет прострелов для переигрывания: файлы на месте, их SHA-256 и размеры — те, что в записи, а манифест,
 * пересобранный из них, даёт тот же дайджест. Иначе — отказ, который называет работу, до записи в игру.
 */
export async function wallbangReplayPackage(stateDir, replay) {
  const workName = String(replay?.workId || "прострелы");
  const digest = String(replay?.sourceDigest || "");
  const listed = Array.isArray(replay?.order?.files) ? replay.order.files : [];
  if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !listed.length)
    throw new Error(`Работа «${workName}»: запись переигрывания испорчена — поставьте прострелы заново из мастерской.`);
  const packageRoot = path.join(path.resolve(String(stateDir || "")), "wallbang", "packages", digest.slice("sha256:".length, "sha256:".length + 16));
  const files = [];
  for (const item of listed) {
    const name = String(item?.name || "");
    const file = path.join(packageRoot, "payload", name);
    const stat = name ? await fs.stat(file).catch(() => null) : null;
    if (!stat?.isFile())
      throw new Error(`Работа «${workName}»: пакет для переигрывания удалён — переустановите прострелы из мастерской.`);
    const hash = await sha256File(file);
    if (hash !== String(item.sha256 || "") || stat.size !== item.size)
      throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите прострелы из мастерской.`);
    files.push({ name, size: stat.size, sha256: hash });
  }
  const rebuilt = buildWallbangManifest(files);
  if (rebuilt.wallbang.sourceDigest !== digest || rebuilt.id !== replay.workId)
    throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите прострелы из мастерской.`);
  return { packageRoot, files };
}

/*
 * Собранный набор нужен только между планом и установкой: движок кладёт
 * файлы пакета в своё хранилище. Каждая правка облика — новая папка на два
 * мегабайта, поэтому старые уходят, а несколько последних остаются —
 * планы ещё не нажатых «Применить».
 */
const KEEP_PACKAGES = 4;

/*
 * Пакеты прострелов, на которые ссылается установленная работа (`engineReplay`): их не уносит уборка.
 */
async function replayPackageNames(stateDir) {
  const profile = await inspectProfile({ stateDir }).catch(() => null);
  /* Состояние не прочиталось — `null`: тогда ничего не удаляем. */
  if (!profile) return null;
  const names = new Set();
  for (const target of Object.values(profile?.targets || {}))
    for (const item of target?.installed || []) {
      const replay = item?.engineReplay;
      if (replay?.module === "wallbang-customizer")
        names.add(String(replay.sourceDigest || "").slice("sha256:".length, "sha256:".length + 16));
    }
  return names;
}

async function pruneOldPackages(directory, current, keep = new Set()) {
  if (keep === null) return;
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (full === current || keep.has(entry.name)) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (stat) packages.push({ full, time: stat.mtimeMs });
  }
  packages.sort((a, b) => b.time - a.time);
  for (const stale of packages.slice(KEEP_PACKAGES - 1))
    await fs.rm(stale.full, { recursive: true, force: true }).catch(() => {});
}

/*
 * Между планом и установкой проходят секунды, но папка — на диске
 * человека: облачные папки и антивирусы умеют подменять файлы на лету.
 * Ставится ровно то, что посчитано в манифесте.
 */
async function assertPackageIntact(built) {
  for (const file of built.manifest.files) {
    const payload = path.join(built.packageRoot, file.source);
    const actual = await sha256File(payload).catch(() => null);
    if (actual !== file.sha256)
      throw new Error(
        `Файл прострелов ${path.basename(payload)} изменился после проверки — нажмите «Применить» ещё раз.`,
      );
  }
}

/* ------------------------------------------------------------------ *
 * Игра
 * ------------------------------------------------------------------ */

const defaultTools = () => ({
  discover: discoverGames,
  readState: inspectProfile,
  plan: planPackage,
  install: installLocalWallbangPackage,
  installPrebuilt: installRpfPrebuilt,
  composeRpf: composeRpfArchive,
  probeRpf: probeRpfArchive,
  provideContentXml: provideUpdateContentXml,
  provideDlcList: provideLegacyDlcList,
});

/* Установка идёт только в копию игры, которую подтвердил поиск Astral. */
async function confirmedGame(gameRoot, discover) {
  const games = await discover();
  const game = (games || []).find(
    (item) =>
      item?.path &&
      path.resolve(item.path).toLowerCase() === gameRoot.toLowerCase(),
  );
  if (!game) throw new Error("Папка GTA V Legacy не подтверждена Astral.");
  if (String(game.edition || "Legacy").toLowerCase() !== "legacy")
    throw new Error("Прострелы ставятся только в GTA V Legacy.");
  /* План по архиву, который лаунчер сейчас переписывает, — шум, а запись в
     него — порча. */
  if (game.launcherState?.busy)
    throw new Error(
      "Лаунчер обновляет или проверяет GTA V. Дождитесь завершения операции.",
    );
  return game;
}

/** Пакеты прострелов, которые движок числит за этой игрой. */
export async function installedWallbang(readState, stateDir, targetId) {
  const state = await readState({ stateDir });
  const target = state?.targets?.[targetId];
  return (target?.installed || []).filter((item) =>
    isWallbangModId(item?.modId),
  );
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
    ...(typeof tools.probeRpf === "function"
      ? { rpfProbe: tools.probeRpf }
      : {}),
  };
}

const summaryOf = (built) => ({
  modId: built.manifest.id,
  entry: WALLBANG_CONTAINER,
  archive: "update/update.rpf",
  files: built.manifest.files.length,
  objects: built.looks,
  visible: built.looks.filter((item) => item.visible).length,
  places: built.looks
    .filter((item) => item.visible)
    .reduce((sum, item) => sum + item.places, 0),
  edition: "Legacy",
  restartRequired: true,
});

/*
 * Планы живут в главном процессе: установка ставит ровно собранный набор, и
 * работа второй раз через мост окна не едет.
 */
export function createWallbangService({
  stateDir,
  tools: overrides = {},
  resourceRoot = null,
  onProgress = null,
  clock = Date.now,
}) {
  const tools = { ...defaultTools(), ...overrides };
  const plans = new Map();
  const prune = () => {
    const now = clock();
    for (const [id, plan] of plans) if (plan.expiresAt <= now) plans.delete(id);
    while (plans.size > MAX_PLANS) plans.delete(plans.keys().next().value);
  };

  /**
   * План: собрать набор и сказать, что сделает «Применить». `status` —
   * `install` (набора в игре нет или он другой) или `unchanged` (в игре
   * ровно такой же — ставить незачем).
   */
  async function plan(input) {
    const gameRoot = path.resolve(String(input?.gameRoot || ""));
    const game = await confirmedGame(gameRoot, tools.discover);
    const targetId = String(game.id);
    const built = await buildWallbangPackage(input?.project, stateDir, {
      resourceRoot,
    });
    const current = await installedWallbang(
      tools.readState,
      stateDir,
      targetId,
    );
    const same = current.length === 1 && current[0].modId === built.manifest.id;
    prune();
    const planId = randomUUID();
    plans.set(planId, {
      built,
      gameRoot,
      targetId,
      expiresAt: clock() + PLAN_TTL_MS,
    });
    return {
      planId,
      status: same ? "unchanged" : "install",
      replaces: current
        .map((item) => item.modId)
        .filter((modId) => modId !== built.manifest.id),
      ...summaryOf(built),
    };
  }

  /**
   * «Применить» по плану. Прежний набор прострелов уходит тем же движением
   * (`replaceModIds`): прострелы в игре одни. Пакеты других слотов — залазы
   * в том числе — не трогаются.
   */
  async function apply(input, { assertRuntimeSafety } = {}) {
    const gameRoot = path.resolve(String(input?.gameRoot || ""));
    const planId = String(input?.planId || "");
    const planned = plans.get(planId);
    plans.delete(planId);
    if (!planned || planned.gameRoot.toLowerCase() !== gameRoot.toLowerCase())
      throw new Error(
        "План установки прострелов устарел — нажмите «Применить» ещё раз.",
      );
    const { built, targetId } = planned;
    await confirmedGame(gameRoot, tools.discover);
    await assertRuntimeSafety?.(gameRoot);
    await assertPackageIntact(built);

    const current = await installedWallbang(
      tools.readState,
      stateDir,
      targetId,
    );
    if (current.length === 1 && current[0].modId === built.manifest.id)
      return {
        status: "unchanged",
        layerModId: built.manifest.id,
        gameRoot,
        targetId,
        ...summaryOf(built),
      };

    const options = engineOptions(built, gameRoot, targetId, stateDir, tools);
    const enginePlan = await tools.plan(options);
    const replaceModIds = [
      ...new Set([
        ...(enginePlan?.conflicts || []).map((item) => item.modId),
        ...current.map((item) => item.modId),
      ]),
    ]
      .filter((modId) => modId !== built.manifest.id)
      .sort();
    /* Флаг `ASTRAL_ENGINE_INSTALL=wallbang-customizer`: подмену `update.rpf` ведёт движок, точка — с `replay.json`. */
    const engineInstall = engineInstallEnabled("wallbang-customizer")
      ? {
          install: tools.installPrebuilt ?? installRpfPrebuilt,
          edition: "Legacy",
          gameRoot,
          pointsRoot: nativeRestorePointsRoot(),
          replay: wallbangReplayRecord(built),
        }
      : null;
    await tools.install({
      ...options,
      replaceModIds,
      rpfComposer: tools.composeRpf,
      contentXmlProvider: tools.provideContentXml,
      dlcListProvider: tools.provideDlcList,
      assertRuntimeSafety: () => assertRuntimeSafety?.(gameRoot),
      /* Пересборка архива игры идёт десятки секунд. Без вестей окно
         выглядит зависшим, и человек закрывает его посреди работы. */
      onProgress,
      ...(engineInstall ? { engineInstall } : {}),
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
