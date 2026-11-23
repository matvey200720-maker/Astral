import fs from "node:fs/promises";
import path from "node:path";
import { ownManifestContainer } from "@modovik/install-engine/manifest-containers.js";
import {
  arenaSourceDigest,
  engineInstallEnabled,
  inspectProfile,
  installLocalArenaPackage,
  isLocalArenaManifest,
  planPackage,
  sha256File,
  uninstallPackage,
} from "@modovik/install-engine";
import {
  composeRpfArchive,
  installRpfPrebuilt,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";

// Копия описания слота arenas из @modovik/mod-targets: desktop-пакет не
// зависит от mod-targets, а список расширений обязан совпадать с трастом
// install-engine — иначе опись покажет файлы, которые установка отвергнет.
/*
 * Готовый набор интерьеров — те же файлы игры в тот же контейнер, но свой
 * слот: набор интерьеров не должен вытеснять арену, и наоборот.
 */
const SET_KINDS = Object.freeze({
  arena: { slot: "arenas", prefix: "local-legacy-arena-", label: "arena" },
  interiors: {
    slot: "interiors",
    prefix: "local-legacy-interior-set-",
    label: "interior set",
  },
});
const ARENA_RESOURCE_EXTENSIONS = Object.freeze([
  ".ymap",
  ".ytyp",
  ".ybn",
  ".ydr",
  ".yft",
  ".ydd",
  ".ytd",
  ".ymf",
]);
// Тот же паттерн, что ASTRAL_CONTENT_ENTRY_PATTERN движка допускает для
// сегмента внутри astral_maps.rpf: имя вне паттерна — честный отказ, а не
// молчаливое переименование (иначе digest и entry разъедутся с источником).
const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9._+~-]{0,119}$/;
/*
 * Имя ресурса обязано заранее проходить `ASTRAL_CONTENT_ENTRY_PATTERN`
 * движка. Единственное имя с подчёркиванием впереди — `_manifest.ymf`: по
 * нему игра связывает `.ymap` с его `.ytyp`, и без него расстановка просто
 * не грузится («never forget your _manifest.ymf» — первое, что отвечают
 * сообществу на «мод встал, а в игре ничего нет»). Имя задано игрой, и
 * переименовать его нельзя — а именно это и предлагал прежний отказ, из-за
 * чего готовый набор арены или интерьеров нельзя было поставить вовсе.
 */
const MANIFEST_RESOURCE_NAME = "_manifest.ymf";
const isSetResourceName = (name) =>
  name === MANIFEST_RESOURCE_NAME || RESOURCE_NAME_PATTERN.test(name);

const SET_MOD_ID_PATTERN =
  /^local-legacy-(?:arena|interior-set)-[a-z0-9]{8,16}$/;
const MAX_RESOURCE_COUNT = 256;
const MAX_RESOURCE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_WALK_DEPTH = 32;

function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Свой маленький рекурсивный обход без зависимостей: симлинки пропускаются с
// предупреждением (симлинк может увести чтение за пределы папки мода),
// файлы вне слота арен просто не считаются ресурсами.
async function collectArenaSource(sourceRoot) {
  const rawRoot = String(sourceRoot || "");
  if (!rawRoot || !path.isAbsolute(rawRoot)) {
    throw refusal(
      "ARENA_SOURCE_MISSING",
      "Нужен абсолютный путь к папке мода арены.",
    );
  }
  const root = path.resolve(rawRoot);
  let rootStat;
  try {
    rootStat = await fs.stat(root);
  } catch {
    throw refusal("ARENA_SOURCE_MISSING", "Папка мода арены не найдена.");
  }
  if (!rootStat.isDirectory()) {
    throw refusal(
      "ARENA_SOURCE_MISSING",
      "Путь мода арены не является папкой.",
    );
  }
  const files = [];
  const warnings = [];
  const foreignNames = [];
  const duplicateNames = [];
  const seenNames = new Set();
  let ignoredCount = 0;
  const walk = async (directory, depth) => {
    if (depth > MAX_WALK_DEPTH) {
      throw refusal(
        "ARENA_SOURCE_TOO_DEEP",
        "Папка мода арены вложена слишком глубоко.",
      );
    }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        warnings.push(`Символическая ссылка пропущена: ${entry.name}`);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!ARENA_RESOURCE_EXTENSIONS.includes(extension)) {
        ignoredCount += 1;
        continue;
      }
      if (!isSetResourceName(entry.name)) {
        foreignNames.push(entry.name);
        continue;
      }
      // Payload плоский (payload/<имя>), поэтому одинаковые имена из разных
      // подпапок — конфликт, который пользователь должен решить сам.
      if (seenNames.has(entry.name)) {
        duplicateNames.push(entry.name);
        continue;
      }
      seenNames.add(entry.name);
      const stat = await fs.stat(absolutePath);
      files.push({
        name: entry.name,
        absolutePath,
        bytes: stat.size,
        extension,
      });
    }
  };
  await walk(root, 0);
  if (foreignNames.length > 0) {
    const shown = foreignNames.slice(0, 5).join(", ");
    const suffix = foreignNames.length > 5 ? " и другие" : "";
    throw refusal(
      "ARENA_SOURCE_FOREIGN_NAMES",
      `Имена файлов должны состоять из латиницы, цифр и ._+~- : ${shown}${suffix}. Переименуйте файлы вручную — автозамена скрыла бы связь с исходником.`,
    );
  }
  if (files.length === 0) {
    throw refusal(
      "ARENA_SOURCE_EMPTY",
      "В папке мода нет ни одного ресурса арены (.ymap, .ytyp, .ybn, .ydr, .ytd, .ymf).",
    );
  }
  if (files.length > MAX_RESOURCE_COUNT) {
    throw refusal(
      "ARENA_SOURCE_TOO_MANY_FILES",
      `Мод арены содержит ${files.length} ресурсов — установка ограничена ${MAX_RESOURCE_COUNT}.`,
    );
  }
  if (ignoredCount > 0) {
    warnings.push(
      `Файлы вне слота арен пропущены: ${ignoredCount}. Устанавливаются только ${ARENA_RESOURCE_EXTENSIONS.join(", ")}.`,
    );
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { root, files, warnings, duplicateNames };
}

export function buildArenaManifest({ digest, files, kind = "arena" }) {
  const set = SET_KINDS[kind] || SET_KINDS.arena;
  const suffix = digest.slice(0, 12);
  return {
    id: `${set.prefix}${suffix}`,
    version: `1.0.0-${suffix}`,
    name: `Custom ${set.label}: ${suffix}`,
    editions: ["Legacy"],
    // Прямая схема слоя Astral: ресурсы ложатся в настоящий update.rpf, в
    // свой контейнер x64/astral/astral_arena.rpf (набор интерьеров —
    // astral_interiors.rpf: у каждого свой _manifest.ymf, задача 3 ТЗ
    // 10.10.2026) и регистрируются в content.xml.
    // Загрузчик ASI и папка mods не нужны — игра читает контейнер сама.
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Арена меняет игровой мир — это заявляется честно, а не прячется.
    gameplayChanges: true,
    capabilities: [
      "rpf-container-entry-v1",
      "astral-content-rpf-v1",
      "direct-update-rpf-v1",
      "direct-update-entries-v1",
    ],
    slots: [set.slot],
    arena: {
      schemaVersion: 1,
      sourceDigest: `sha256:${digest}`,
      resourceCount: files.length,
    },
    files: files.map((file) => ({
      source: `payload/${file.name}`,
      target: "update/update.rpf",
      action: "import",
      entry: `${ownManifestContainer(`${set.prefix}${suffix}`)}/${file.name}`,
      merge: { strategy: "rpf-resource-layer-v1" },
      size: file.bytes,
      sha256: file.sha256,
    })),
  };
}

/*
 * Запись переигрывания арены (`engineReplay`, шаг 3 фазы 7, за флагом `ASTRAL_ENGINE_INSTALL=arena-customizer`):
 * имя пакета, отпечаток и список файлов. Сами файлы лежат в постоянной папке пакета в `stateDir`.
 */
export function arenaReplayRecord(built) {
  return {
    module: "arena-customizer",
    workId: built.manifest.id,
    version: built.manifest.version,
    sourceDigest: built.digest,
    order: {
      kind: built.kind,
      files: built.files.map((file) => ({ name: file.name, sha256: file.sha256 })),
    },
  };
}

/*
 * Пакет арены для переигрывания: файлы на месте, их SHA-256 — те, что в записи, и отпечаток набора
 * пересчитывается и сходится с записью. Иначе — отказ, который называет работу, до записи в игру.
 */
export async function arenaReplayPackage(stateDir, replay) {
  const workName = String(replay?.workId || "арена");
  const digest = String(replay?.sourceDigest || "");
  const listed = Array.isArray(replay?.order?.files) ? replay.order.files : [];
  if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !listed.length)
    throw new Error(`Работа «${workName}»: запись переигрывания испорчена — поставьте работу заново из мастерской.`);
  const kind = replay?.order?.kind === "interiors" ? "interiors" : "arena";
  const packageRoot = path.join(
    path.resolve(String(stateDir || "")),
    "arena-customizer",
    "packages",
    `${kind === "interiors" ? "interiors-" : ""}${digest.slice("sha256:".length)}`,
  );
  const files = [];
  for (const item of listed) {
    const name = String(item?.name || "");
    const file = path.join(packageRoot, "payload", name);
    const stat = name ? await fs.stat(file).catch(() => null) : null;
    if (!stat?.isFile())
      throw new Error(`Работа «${workName}»: пакет для переигрывания удалён — переустановите работу из мастерской.`);
    const sha256 = await sha256File(file);
    if (sha256 !== String(item.sha256 || ""))
      throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите работу из мастерской.`);
    files.push({ name, sha256, bytes: stat.size });
  }
  if (`sha256:${arenaSourceDigest(files)}` !== digest)
    throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите работу из мастерской.`);
  return { packageRoot, files };
}

export function createArenaCustomizerService({
  storageOptions,
  findGame,
  assertRuntimeSafe,
  plan = planPackage,
  install = installLocalArenaPackage,
  uninstall = uninstallPackage,
  inspectYtd = null,
  readInstallState = inspectProfile,
  composeRpf = composeRpfArchive,
  probeRpf = probeRpfArchive,
  provideContentXml = provideUpdateContentXml,
  provideDlcList = provideLegacyDlcList,
  /* Установка движком за флагом модуля: функция `compose-rpf` с блоком `install`, корень точек. */
  installPrebuilt = installRpfPrebuilt,
  pointsRoot = nativeRestorePointsRoot(),
  /* Пересборка архива игры идёт десятки секунд. Без вестей окно выглядит
     зависшим, и человек закрывает его посреди работы. */
  onProgress = null,
} = {}) {
  if (
    typeof storageOptions !== "function" ||
    typeof findGame !== "function" ||
    typeof assertRuntimeSafe !== "function"
  ) {
    throw new TypeError(
      "Arena customizer требует storage/game/runtime boundaries.",
    );
  }
  // Мутации сериализуются: параллельные установки/снятия ломают транзакции
  // движка и журнал восстановления.
  let mutation = Promise.resolve();
  const serialized = (operation) => {
    const result = mutation.then(operation, operation);
    mutation = result.catch(() => {});
    return result;
  };

  const stateDirectory = async () => {
    const options = await storageOptions();
    return path.resolve(String(options?.stateDir || ""));
  };

  const assertGameTarget = async ({ gameRoot, targetId }) => {
    const raw = String(gameRoot || "");
    if (!raw || !path.isAbsolute(raw)) {
      throw new Error("Нужен абсолютный путь к папке GTA V.");
    }
    const root = path.resolve(raw);
    const game = await findGame(String(targetId || "default"));
    // Установка идёт только в ту копию игры, которую подтвердил discovery:
    // произвольный gameRoot из запроса — повод остановиться.
    if (!game || path.resolve(String(game.path || "")) !== root) {
      throw new Error(
        "Выбранная установка GTA V не совпадает с планом установки арены.",
      );
    }
    if (String(game.edition || "").toLowerCase() !== "legacy") {
      throw new Error("Установка арен поддерживает только GTA V Legacy.");
    }
    return { game, root };
  };

  const replacementIds = (planResult) =>
    [...new Set((planResult.conflicts || []).map((item) => item.modId))].sort();

  const ytdTextureNames = (report) => {
    const list = Array.isArray(report?.textures)
      ? report.textures
      : Array.isArray(report)
        ? report
        : [];
    return list
      .map((item) => String(item?.name ?? item ?? "").trim())
      .filter(Boolean);
  };

  const inspectSource = async ({ sourceRoot } = {}) => {
    const collected = await collectArenaSource(sourceRoot);
    const resources = {};
    for (const extension of ARENA_RESOURCE_EXTENSIONS) {
      resources[extension.slice(1)] = 0;
    }
    for (const file of collected.files) {
      resources[file.extension.slice(1)] += 1;
    }
    const warnings = [...collected.warnings];
    const conflicts = collected.duplicateNames.map((name) => ({
      name,
      reason: "duplicate-name",
    }));
    let textures = null;
    if (typeof inspectYtd === "function") {
      textures = {};
      for (const file of collected.files) {
        if (file.extension !== ".ytd") continue;
        // Ошибка одного словаря — предупреждение, не отказ: опись по
        // расширениям остаётся полезной и без просмотра текстур.
        try {
          const report = await inspectYtd({ input: file.absolutePath });
          textures[file.name] = ytdTextureNames(report);
        } catch (error) {
          warnings.push(
            `Не удалось прочитать текстуры ${file.name}: ${error?.message || error}`,
          );
        }
      }
    }
    return {
      ok: conflicts.length === 0,
      resources,
      files: collected.files.map((file) => ({
        name: file.name,
        bytes: file.bytes,
      })),
      ...(textures ? { textures } : {}),
      warnings,
      conflicts,
    };
  };

  const buildArenaPackage = async ({ sourceRoot, stateDir, kind } = {}) => {
    const stateRoot = path.resolve(String(stateDir || ""));
    if (!path.isAbsolute(String(stateDir || ""))) {
      throw new Error("Нужен абсолютный stateDir для сборки пакета арены.");
    }
    const collected = await collectArenaSource(sourceRoot);
    if (collected.duplicateNames.length > 0) {
      const shown = collected.duplicateNames.slice(0, 5).join(", ");
      throw refusal(
        "ARENA_SOURCE_DUPLICATE_NAMES",
        `Одинаковые имена ресурсов в разных подпапках: ${shown}. Payload плоский — оставьте по одному файлу на имя.`,
      );
    }
    const files = [];
    let totalBytes = 0;
    for (const file of collected.files) {
      if (file.bytes < 1 || file.bytes > MAX_RESOURCE_BYTES) {
        throw refusal(
          "ARENA_RESOURCE_SIZE",
          `Ресурс ${file.name} занимает ${file.bytes} байт — допустимо от 1 байта до 64 МиБ.`,
        );
      }
      totalBytes += file.bytes;
      files.push({ ...file, sha256: await sha256File(file.absolutePath) });
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw refusal(
        "ARENA_SOURCE_TOO_LARGE",
        "Суммарный размер ресурсов арены превышает 512 МиБ.",
      );
    }
    const digest = arenaSourceDigest(files);
    // Content-addressed packageRoot: повторная сборка того же мода попадает в
    // тот же каталог и даёт байт-в-байт тот же манифест.
    const packageRoot = path.join(
      stateRoot,
      "arena-customizer",
      "packages",
      /* Один и тот же набор в двух слотах — два разных пакета: id у них
         разные, и складывать их в одну папку значило бы перезаписывать
         манифест соседа. */
      `${kind === "interiors" ? "interiors-" : ""}${digest}`,
    );
    const payloadDirectory = path.join(packageRoot, "payload");
    await fs.mkdir(payloadDirectory, { recursive: true });
    for (const file of files) {
      const destination = path.join(payloadDirectory, file.name);
      await fs.copyFile(file.absolutePath, destination);
      // Readback после копирования: облачные папки и антивирусы умеют молча
      // подменять содержимое — установка обязана видеть ровно то, что хэшировали.
      if ((await sha256File(destination)) !== file.sha256) {
        throw new Error(
          `Payload ${file.name} изменился при копировании — установка остановлена.`,
        );
      }
    }
    const manifest = buildArenaManifest({ digest, files, kind });
    // Самопроверка перед возвратом: собранный манифест обязан проходить траст
    // install-engine, иначе расхождение обнаружится только на установке.
    if (!isLocalArenaManifest(manifest, "Legacy")) {
      throw new Error(
        "Собранный манифест арены не прошёл строгую проверку доверия.",
      );
    }
    return {
      manifest,
      packageRoot,
      kind: kind === "interiors" ? "interiors" : "arena",
      digest: `sha256:${digest}`,
      totalBytes,
      files: files.map((file) => ({
        name: file.name,
        bytes: file.bytes,
        sha256: file.sha256,
      })),
    };
  };

  const installOptions = (built, { root, targetId, stateDir }, extra = {}) => ({
    manifest: built.manifest,
    packageRoot: built.packageRoot,
    gameRoot: root,
    targetId: String(targetId || "default"),
    edition: "Legacy",
    stateDir,
    // Слой Astral пишет в настоящий update.rpf; право на это подтверждает
    // строгий траст манифеста, а не сам флаг.
    allowGameRootWrites: true,
    requireSignature: false,
    ...(typeof probeRpf === "function" ? { rpfProbe: probeRpf } : {}),
    ...extra,
  });

  const planInstall = async ({ gameRoot, sourceRoot, targetId, kind } = {}) => {
    const stateDir = await stateDirectory();
    const { root } = await assertGameTarget({ gameRoot, targetId });
    const built = await buildArenaPackage({ sourceRoot, stateDir, kind });
    const planResult = await plan(
      installOptions(built, { root, targetId, stateDir }),
    );
    return {
      ...planResult,
      modId: built.manifest.id,
      digest: built.digest,
      totalBytes: built.totalBytes,
      resourceCount: built.files.length,
      resources: built.files.map((file) => ({
        name: file.name,
        bytes: file.bytes,
      })),
      replaceModIds: replacementIds(planResult),
      edition: "Legacy",
      rollbackReady: true,
    };
  };

  const applyInstall = ({ gameRoot, sourceRoot, targetId, kind } = {}) =>
    serialized(async () => {
      const stateDir = await stateDirectory();
      const { game, root } = await assertGameTarget({ gameRoot, targetId });
      const built = await buildArenaPackage({ sourceRoot, stateDir, kind });
      // Runtime-гейт до первой записи: запущенная игра держит RPF открытыми,
      // и установка в этот момент повредила бы профиль.
      await assertRuntimeSafe(game);
      const currentPlan = await plan(
        installOptions(built, { root, targetId, stateDir }),
      );
      /* Флаг `ASTRAL_ENGINE_INSTALL=arena-customizer`: подмену `update.rpf` ведёт движок, точка — с `replay.json`. */
      const engineInstall = engineInstallEnabled("arena-customizer")
        ? {
            install: installPrebuilt,
            edition: "Legacy",
            gameRoot: root,
            pointsRoot,
            replay: arenaReplayRecord(built),
          }
        : null;
      const installed = await install(
        installOptions(
          built,
          { root, targetId, stateDir },
          {
            replaceModIds: replacementIds(currentPlan),
            rpfComposer: composeRpf,
            contentXmlProvider: provideContentXml,
            dlcListProvider: provideDlcList,
            assertRuntimeSafety: () => assertRuntimeSafe(game),
            onProgress,
            ...(engineInstall ? { engineInstall } : {}),
          },
        ),
      );
      return {
        ...installed,
        installId: built.manifest.id,
        modId: built.manifest.id,
        kind:
          kind === "interiors"
            ? "local-legacy-interior-set"
            : "local-legacy-arena",
        status: "active",
        digest: built.digest,
        resourceCount: built.files.length,
        totalBytes: built.totalBytes,
        gameRoot: root,
        targetId: String(targetId || "default"),
        installedAt: new Date().toISOString(),
      };
    });

  const removeInstall = ({ modId, targetId } = {}) =>
    serialized(async () => {
      const id = String(modId || "");
      if (!SET_MOD_ID_PATTERN.test(id)) {
        throw new Error("Некорректный modId локального набора.");
      }
      const stateDir = await stateDirectory();
      const game = await findGame(String(targetId || "default"));
      // Без подтверждённой игры нельзя проверить, что она не запущена, —
      // снятие останавливается, а не работает вслепую.
      if (!game) {
        throw new Error(
          "Установка GTA V не найдена — снятие арены остановлено.",
        );
      }
      await assertRuntimeSafe(game);
      const result = await uninstall({
        modId: id,
        targetId: String(targetId || "default"),
        stateDir,
        rpfComposer: composeRpf,
        contentXmlProvider: provideContentXml,
        dlcListProvider: provideDlcList,
        assertRuntimeSafety: () => assertRuntimeSafe(game),
        onProgress,
      });
      return {
        ...result,
        installId: id,
        modId: id,
        kind: id.startsWith("local-legacy-interior-set-")
          ? "local-legacy-interior-set"
          : "local-legacy-arena",
        status: "rolled-back",
        targetId: String(targetId || "default"),
      };
    });

  const listInstalled = async ({ targetId } = {}) => {
    const stateDir = await stateDirectory();
    const state = await readInstallState({ stateDir });
    const target = state?.targets?.[String(targetId || "default")];
    return (target?.installed || []).filter((item) =>
      SET_MOD_ID_PATTERN.test(String(item?.modId || "")),
    );
  };

  return Object.freeze({
    inspectSource,
    buildArenaPackage,
    planInstall,
    applyInstall,
    removeInstall,
    listInstalled,
  });
}
