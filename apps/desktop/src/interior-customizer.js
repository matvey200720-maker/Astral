import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  createInteriorCompileRequest,
  getInteriorLocation,
  hashInteriorDesign,
  normalizeInteriorDesign,
  validateInteriorDesign,
} from "@modovik/interior-contract";
import {
  canonicalManifest,
  engineInstallEnabled,
  getProfile,
  installLocalInteriorPackage,
  planPackage,
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

const clean = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

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

export function buildInteriorManifest({ designHash, locationId, artifact }) {
  const entryName = `astral_int_${locationId.replace(/-/g, "_")}.ymap`;
  const artifactHash = artifact.sha256.replace(/^sha256:/, "");
  return {
    id: `local-legacy-interior-${locationId}`,
    version: `1.0.0-${artifactHash.slice(0, 12)}`,
    name: `Custom interior: ${locationId}`,
    editions: ["Legacy"],
    // Прямая схема слоя Astral: настоящий update.rpf, контейнер
    // x64/astral/astral_maps.rpf, регистрация в content.xml, без загрузчика.
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    gameplayChanges: false,
    capabilities: [
      "rpf-container-entry-v1",
      "astral-content-rpf-v1",
      "direct-update-rpf-v1",
      "direct-update-entries-v1",
    ],
    slots: [`interior-location-${locationId}`],
    interior: {
      schemaVersion: 1,
      locationId,
      designHash,
      artifactHash: `sha256:${artifactHash}`,
    },
    files: [
      {
        source: `payload/${entryName}`,
        target: "update/update.rpf",
        action: "import",
        entry: `x64/astral/astral_maps.rpf/${entryName}`,
        merge: { strategy: "rpf-resource-layer-v1" },
        size: artifact.bytes,
        sha256: artifactHash,
      },
    ],
  };
}

export async function compileInteriorPackage({
  design: input,
  expectedDesignHash,
  stateDir,
  compileNative,
}) {
  if (typeof compileNative !== "function")
    throw new Error("Нативный компилятор интерьеров недоступен.");
  const design = normalizeInteriorDesign(input);
  const designHash = hashInteriorDesign(design);
  if (designHash !== expectedDesignHash)
    throw new Error("Проект интерьера изменился после создания запроса.");
  const report = validateInteriorDesign(design);
  if (!report.valid)
    throw new Error(report.errors[0]?.message || "Макет интерьера невалиден.");
  if (!design.entities.some((entity) => !entity.editor.hidden))
    throw new Error("Добавьте хотя бы один видимый объект перед установкой.");
  const locationId = design.locationBinding.locationId;
  const location = getInteriorLocation(locationId);
  if (!location || location.evidenceStatus !== "build-verified")
    throw new Error("Локация не подтверждена локальными файлами GTA V.");
  const request = createInteriorCompileRequest(design, {
    targetId: "gta5-legacy-story",
  });
  const digest = designHash.replace(/^sha256:/, "");
  const directory = path.join(
    stateDir,
    "interior-editor",
    "packages",
    clean(locationId),
    digest,
  );
  const requestPath = path.join(directory, "compile-request.json");
  const outputPath = path.join(directory, "payload", request.destination.entry);
  const requestBytes = Buffer.from(JSON.stringify(request), "utf8");
  try {
    const existing = await fs.readFile(requestPath);
    if (!existing.equals(requestBytes))
      throw new Error("Content-addressed compile request cache повреждён.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await atomicWrite(requestPath, requestBytes);
  }
  const artifact = await compileNative({
    input: requestPath,
    output: outputPath,
  });
  const bytes = await fs.readFile(outputPath);
  const actualHash = sha256(bytes);
  if (
    artifact.designHash !== designHash ||
    artifact.locationId !== locationId ||
    artifact.entityCount !== request.entities.length ||
    artifact.semanticReopen !== true ||
    artifact.deterministic !== true ||
    artifact.bytes !== bytes.length ||
    artifact.sha256 !== actualHash
  ) {
    throw new Error("Нативный YMAP не прошёл semantic readback.");
  }
  const manifest = buildInteriorManifest({
    designHash,
    locationId,
    artifact: { bytes: bytes.length, sha256: `sha256:${actualHash}` },
  });
  return Object.freeze({
    directory,
    design,
    designHash,
    location,
    artifact: { ...artifact, path: outputPath, sha256: `sha256:${actualHash}` },
    manifest,
    manifestHash: `sha256:${sha256(Buffer.from(canonicalManifest(manifest)))}`,
  });
}

/*
 * Запись переигрывания интерьера (`engineReplay`, шаг 3 фазы 7, за флагом `ASTRAL_ENGINE_INSTALL=interior-customizer`):
 * локация, файл YMAP внутри пакета и его SHA-256. Сам файл лежит в постоянной папке пакета в `stateDir`.
 */
export function interiorReplayRecord(generated) {
  const hex = String(generated.designHash).replace(/^sha256:/, "");
  return {
    module: "interior-customizer",
    workId: generated.manifest.id,
    version: generated.manifest.version,
    sourceDigest: `sha256:${hex}`,
    order: {
      locationId: generated.design.locationBinding.locationId,
      file: path
        .relative(path.join(generated.directory, "payload"), generated.artifact.path)
        .split(path.sep)
        .join("/"),
      sha256: generated.artifact.sha256,
    },
  };
}

/*
 * Интерьер для переигрывания: YMAP на месте, его SHA-256 — тот, что в записи. Иначе — отказ,
 * который называет работу, до записи в игру.
 */
export async function interiorReplayPackage(stateDir, replay) {
  const workName = String(replay?.workId || "интерьер");
  const digest = String(replay?.sourceDigest || "");
  const order = replay?.order || {};
  if (!/^sha256:[0-9a-f]{64}$/.test(digest) || !order.file || !order.locationId || !/^sha256:[0-9a-f]{64}$/.test(String(order.sha256 || "")))
    throw new Error(`Работа «${workName}»: запись переигрывания испорчена — поставьте работу заново из мастерской.`);
  const packageRoot = path.join(
    path.resolve(String(stateDir || "")),
    "interior-editor",
    "packages",
    clean(order.locationId),
    digest.slice("sha256:".length),
  );
  const file = path.join(packageRoot, "payload", ...String(order.file).split("/"));
  const bytes = await fs.readFile(file).catch(() => null);
  if (!bytes)
    throw new Error(`Работа «${workName}»: пакет для переигрывания удалён — переустановите работу из мастерской.`);
  if (`sha256:${sha256(bytes)}` !== order.sha256)
    throw new Error(`Работа «${workName}»: пакет для переигрывания изменён — переустановите работу из мастерской.`);
  return { packageRoot, file };
}

function installOptions(generated, input, stateDir, extra = {}) {
  return {
    manifest: generated.manifest,
    packageRoot: generated.directory,
    gameRoot: path.resolve(String(input.gameRoot || "")),
    targetId: String(input.targetId || "default"),
    edition: "Legacy",
    stateDir,
    // Слой Astral пишет в настоящий update.rpf; право даёт строгий траст
    // манифеста интерьера, а не этот флаг сам по себе.
    allowGameRootWrites: true,
    requireSignature: false,
    rpfProbe: probeRpfArchive,
    ...extra,
  };
}

function replacementIds(plan) {
  return [...new Set((plan.conflicts || []).map((item) => item.modId))].sort();
}

function assertBuild(location, game) {
  if (!game || String(game.edition || "").toLowerCase() !== "legacy")
    throw new Error("Редактор интерьеров поддерживает только GTA V Legacy.");
  if (!location.supportedBuildIds.includes(String(game.buildId || "")))
    throw new Error(
      `Build ${game.buildId || "unknown"} отсутствует в проверенном реестре локации.`,
    );
  if (!location.installable)
    throw new Error(
      "Установка этой локации закрыта до завершения визуального smoke-теста.",
    );
}

export async function planInteriorCustomization(
  input,
  stateDir,
  dependencies = {},
) {
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  const game = await dependencies.assertGameReady?.(gameRoot, {
    mutate: false,
  });
  const generated = await compileInteriorPackage({
    ...input,
    stateDir,
    compileNative: dependencies.compileNative,
  });
  assertBuild(generated.location, game);
  const plan = await planPackage(installOptions(generated, input, stateDir));
  return {
    ...plan,
    modId: generated.manifest.id,
    designHash: generated.designHash,
    manifestHash: generated.manifestHash,
    artifactHash: generated.artifact.sha256,
    artifactBytes: generated.artifact.bytes,
    entityCount: generated.artifact.entityCount,
    locationId: generated.location.id,
    entry: generated.manifest.files[0].entry,
    replaceModIds: replacementIds(plan),
    rollbackReady: true,
    edition: "Legacy",
  };
}

export async function applyInteriorCustomization(
  input,
  stateDir,
  dependencies = {},
) {
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  const game = await dependencies.assertGameReady?.(gameRoot, { mutate: true });
  const generated = await compileInteriorPackage({
    ...input,
    stateDir,
    compileNative: dependencies.compileNative,
  });
  assertBuild(generated.location, game);
  if (generated.manifestHash !== input.expectedManifestHash)
    throw new Error("План установки интерьера устарел.");
  const currentPlan = await planPackage(
    installOptions(generated, input, stateDir),
  );
  /* Флаг `ASTRAL_ENGINE_INSTALL=interior-customizer`: подмену `update.rpf` ведёт движок, точка — с `replay.json`. */
  const engineInstall = engineInstallEnabled("interior-customizer")
    ? {
        install: dependencies.installPrebuilt ?? installRpfPrebuilt,
        edition: "Legacy",
        gameRoot,
        pointsRoot: dependencies.pointsRoot ?? nativeRestorePointsRoot(),
        replay: interiorReplayRecord(generated),
      }
    : null;
  const installed = await installLocalInteriorPackage(
    installOptions(generated, input, stateDir, {
      replaceModIds: replacementIds(currentPlan),
      rpfComposer: composeRpfArchive,
      dlcListProvider: provideLegacyDlcList,
      contentXmlProvider: provideUpdateContentXml,
      assertRuntimeSafety: () => dependencies.assertRuntimeSafety?.(game),
      /* Пересборка архива игры идёт десятки секунд. Без вестей окно
         выглядит зависшим, и человек закрывает его посреди работы. */
      onProgress: dependencies.onProgress,
      ...(engineInstall ? { engineInstall } : {}),
    }),
  );
  return {
    ...installed,
    installId: generated.manifest.id,
    modId: generated.manifest.id,
    kind: "native-legacy-interior",
    status: "active",
    designHash: generated.designHash,
    manifestHash: generated.manifestHash,
    artifactHash: generated.artifact.sha256,
    locationId: generated.location.id,
    gameRoot,
    targetId: String(input.targetId || "default"),
    installedAt: new Date().toISOString(),
  };
}

export async function removeInteriorCustomization(
  input,
  stateDir,
  dependencies = {},
) {
  const gameRoot = path.resolve(String(input?.gameRoot || ""));
  const game = await dependencies.assertGameReady?.(gameRoot, { mutate: true });
  const modId = String(input?.modId || "");
  if (!/^local-legacy-interior-[a-z0-9-]+$/.test(modId))
    throw new Error("Некорректный local interior modId.");
  const result = await uninstallPackage({
    modId,
    targetId: String(input?.targetId || "default"),
    stateDir,
    rpfComposer: composeRpfArchive,
    contentXmlProvider: provideUpdateContentXml,
    dlcListProvider: provideLegacyDlcList,
    assertRuntimeSafety: () => dependencies.assertRuntimeSafety?.(game),
    onProgress: dependencies.onProgress,
  });
  return {
    ...result,
    installId: modId,
    modId,
    kind: "native-legacy-interior",
    status: "rolled-back",
    gameRoot,
    targetId: String(input?.targetId || "default"),
  };
}

export async function installedInteriorCustomizations(stateDir, targetId) {
  const profile = await getProfile({ stateDir });
  const target = profile.targets?.[String(targetId || "default")];
  return (target?.installed || []).filter((item) =>
    String(item.modId || "").startsWith("local-legacy-interior-"),
  );
}
