import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  MEGA_MALL_ATOMIC_SLOT,
  MEGA_MALL_PROFILE_ID,
  YOU_TOOL_ATOMIC_SLOT,
  YOU_TOOL_PROFILE_ID,
} from "@modovik/mega-mall-contract";
import {
  inspectProfile,
  installLocalMegaMallOverlayPackage,
  planPackage,
  sha256File,
  uninstallPackage,
} from "@modovik/install-engine";
import {
  composeRpfArchive,
  createRpfArchive,
  extractRpfEntry,
  patchYtdTextures,
  probeRpfArchive,
  provideLegacyDlcList,
} from "./rpf-composer.js";

const PACKAGE_SOURCE_ROOT = "payload";
const MAX_PATCHED_DICTIONARIES = 8;
const OVERLAY_CONFIGS = Object.freeze(
  [
    Object.freeze({
      profileId: MEGA_MALL_PROFILE_ID,
      atomicSlot: MEGA_MALL_ATOMIC_SLOT,
      dlcName: "astral_davis_megamall",
      assetName: "astral_davis_megamall_overlay",
      modPrefix: "local-mega-mall",
      displayName: "Davis Mega Mall Overlay",
      kind: "davis-mega-mall-overlay",
      capability: "astral-mega-mall-overlay-v1",
    }),
    Object.freeze({
      profileId: YOU_TOOL_PROFILE_ID,
      atomicSlot: YOU_TOOL_ATOMIC_SLOT,
      dlcName: "astral_you_tool",
      assetName: "astral_you_tool_overlay",
      modPrefix: "local-you-tool",
      displayName: "Ашан / You Tool Overlay",
      kind: "you-tool-ashan-overlay",
      capability: "astral-you-tool-overlay-v1",
    }),
  ].map((config) =>
    Object.freeze({
      ...config,
      target: `newmods/dlcpacks/${config.dlcName}/dlc.rpf`,
    }),
  ),
);

function overlayConfigForProfile(profile) {
  return (
    OVERLAY_CONFIGS.find(
      (config) =>
        config.profileId === profile?.id &&
        config.atomicSlot === profile?.atomicSlot,
    ) || null
  );
}

const sha256Bytes = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

function cleanProjectId(value) {
  const result = String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return result || "project";
}

function cleanRelativeArchive(value) {
  const result = String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
  if (
    !result ||
    result !== result.toLowerCase() ||
    result.startsWith("mods/") ||
    result.startsWith("newmods/") ||
    result.split("/").some((part) => !part || part === "." || part === "..") ||
    path.posix.extname(result) !== ".rpf"
  ) {
    throw new TypeError("Mega Mall profile содержит небезопасный archivePath.");
  }
  return result;
}

function cleanNestedYtdEntry(value) {
  const result = String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
  if (
    result !== result.toLowerCase() ||
    !result.endsWith(".ytd") ||
    !result.includes(".rpf/") ||
    result.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new TypeError(
      "Mega Mall profile содержит небезопасный YTD entryPath.",
    );
  }
  return result;
}

async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/*
 * Файл кэша по содержимому. Сверка — потоком по кускам (`sha256File`), не
 * целиком в памяти: `ytd` мода весит десятки мегабайт, и прежняя сверка держала
 * главный процесс на каждом полном хэше (20.10: «Применить» Мега Молла).
 */
async function publishContentAddressed(file, bytes) {
  const digest = sha256Bytes(bytes);
  try {
    if ((await sha256File(file)) !== digest) {
      throw new TypeError(
        `Content-addressed cache collision: ${path.basename(file)}.`,
      );
    }
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await atomicWrite(file, bytes);
  if ((await sha256File(file)) !== digest) {
    throw new TypeError(
      `Content-addressed cache readback failed: ${path.basename(file)}.`,
    );
  }
}

function replacementIds(plan) {
  return [
    ...new Set((plan.conflicts || []).map((entry) => entry.modId)),
  ].sort();
}

function overlayMetadataXml(config) {
  const device = config.dlcName.toUpperCase();
  const stream = `dlc_${device}:/astral_stream.rpf`;
  return {
    content: `<?xml version="1.0" encoding="utf-8"?>
<CDataFileMgr__ContentsOfDataFileXml>
  <disabledFiles />
  <includedXmlFiles />
  <dataFiles><Item><filename>${stream}</filename><fileType>RPF_FILE</fileType><locked value="true" /><disabled value="true" /><persistent value="true" /><overlay value="true" /></Item></dataFiles>
  <contentChangeSets><Item><changeSetName>CCS_${device}_STREAMING</changeSetName><filesToEnable><Item>${stream}</Item></filesToEnable></Item></contentChangeSets>
  <patchFiles />
</CDataFileMgr__ContentsOfDataFileXml>
`,
    setup: `<?xml version="1.0" encoding="utf-8"?>
<SSetupData>
  <deviceName>dlc_${device}</deviceName><datFile>content.xml</datFile><timeStamp>01/01/2026 00:00:00</timeStamp><nameHash>${device}</nameHash>
  <contentChangeSets /><contentChangeSetGroups><Item><NameHash>GROUP_UPDATE_STREAMING</NameHash><ContentChangeSets><Item>CCS_${device}_STREAMING</Item></ContentChangeSets></Item></contentChangeSetGroups>
  <startupScript /><scriptCallstackSize value="0" /><type>EXTRACONTENT_LEVEL_PACK</type><order value="100" /><minorOrder value="0" /><isLevelPack value="true" /><dependencyPackHash /><requiredVersion /><subPackCount value="0" />
</SSetupData>
`,
  };
}

function exactArtifactMap(profile, artifacts) {
  if (
    !Array.isArray(artifacts) ||
    artifacts.length !== profile.surfaces.length
  ) {
    throw new TypeError(
      "Mega Mall compiler должен вернуть ровно один artifact на поверхность.",
    );
  }
  const result = new Map();
  for (const artifact of artifacts) {
    const surface = profile.surfaces.find(
      (entry) => entry.id === artifact?.surfaceId,
    );
    if (!surface?.target || result.has(surface.id)) {
      throw new TypeError(
        "Mega Mall artifacts не совпадают с проверенным профилем.",
      );
    }
    if (canonicalJson(artifact.target) !== canonicalJson(surface.target)) {
      throw new TypeError(
        `Physical target ${surface.id} изменился после компиляции.`,
      );
    }
    const bytes = Buffer.from(artifact.dds || []);
    if (
      !bytes.length ||
      artifact.ddsSha256 !== `sha256:${sha256Bytes(bytes)}`
    ) {
      throw new TypeError(
        `DDS artifact ${surface.id} не прошёл SHA-256 readback.`,
      );
    }
    result.set(surface.id, { ...artifact, dds: bytes });
  }
  return result;
}

function resourceGroups(profile, artifactMap) {
  const resources = new Map(
    profile.resources.map((entry) => [entry.id, entry]),
  );
  const groups = new Map();
  for (const surface of profile.surfaces) {
    const target = surface.target;
    const resource = resources.get(target.resourceId);
    if (!resource)
      throw new TypeError(`Resource ${target.resourceId} отсутствует.`);
    const archivePath = cleanRelativeArchive(resource.archivePath);
    const entryPath = cleanNestedYtdEntry(target.entryPath);
    const key = `${resource.id}\u0000${entryPath}`;
    const group = groups.get(key) || {
      resource,
      archivePath,
      entryPath,
      baseEntrySha256: target.baseEntrySha256,
      patches: [],
    };
    if (group.baseEntrySha256 !== target.baseEntrySha256) {
      throw new TypeError(`YTD ${entryPath} имеет противоречивые base hashes.`);
    }
    if (group.patches.some((entry) => entry.texture === target.textureName)) {
      throw new TypeError(
        `Texture ${target.textureName} назначена двум поверхностям.`,
      );
    }
    group.patches.push({
      texture: target.textureName,
      artifact: artifactMap.get(surface.id),
    });
    groups.set(key, group);
  }
  if (groups.size > MAX_PATCHED_DICTIONARIES) {
    throw new TypeError(
      "Mega Mall profile затрагивает слишком много YTD dictionaries.",
    );
  }
  return [...groups.values()].sort((left, right) =>
    `${left.archivePath}/${left.entryPath}`.localeCompare(
      `${right.archivePath}/${right.entryPath}`,
    ),
  );
}

function assertVerifiedProfile(profile) {
  if (
    !profile?.installable ||
    profile.evidenceStatus !== "verified" ||
    ![MEGA_MALL_ATOMIC_SLOT, YOU_TOOL_ATOMIC_SLOT].includes(
      profile.atomicSlot,
    ) ||
    !profile.buildIds?.length ||
    !profile.resources?.length
  ) {
    throw new TypeError(
      "Mega Mall install adapter принимает только проверенный профиль.",
    );
  }
  if (
    profile.atomicSlot === YOU_TOOL_ATOMIC_SLOT &&
    profile.id !== YOU_TOOL_PROFILE_ID
  ) {
    throw new TypeError(
      "Слот You Tool принимает только pinned профиль здания.",
    );
  }
}

function gameBuildId(game) {
  return String(game?.buildId || game?.build || game?.version || "").trim();
}

async function assertGameTarget({
  findGame,
  assertRuntimeSafe,
  targetId,
  gameRoot,
  mutate,
  profile,
}) {
  const game = await findGame(targetId);
  if (!game || path.resolve(game.path || "") !== path.resolve(gameRoot)) {
    throw new TypeError(
      "Выбранная установка GTA V не совпадает с Mega Mall plan.",
    );
  }
  if (String(game.edition || "").toLowerCase() !== profile.edition) {
    throw new TypeError("Редакция GTA V не совпадает с Mega Mall profile.");
  }
  const buildId = gameBuildId(game);
  if (!profile.buildIds.includes(buildId)) {
    throw new TypeError(
      `Build GTA V ${buildId || "unknown"} отсутствует в проверенном профиле.`,
    );
  }
  if (mutate) await assertRuntimeSafe(game);
  return game;
}

export function buildMegaMallInstallManifest({
  projectId,
  designHash,
  profile,
  files,
}) {
  assertVerifiedProfile(profile);
  if (!Array.isArray(files) || !files.length)
    throw new TypeError("Mega Mall package не содержит YTD payload.");
  const digest = String(designHash || "").replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new TypeError("Некорректный Mega Mall designHash.");
  const overlayConfig = overlayConfigForProfile(profile);
  if (overlayConfig) {
    if (
      files.length !== 1 ||
      files[0]?.source !== `payload/${overlayConfig.target}` ||
      files[0]?.target !== overlayConfig.target
    ) {
      throw new TypeError(
        "Mega Mall overlay package требует ровно один управляемый DLC.",
      );
    }
    return {
      id: `${overlayConfig.modPrefix}-${cleanProjectId(projectId)}`,
      version: `2.0.0-${digest.slice(0, 12)}`,
      name: `${overlayConfig.displayName}: ${cleanProjectId(projectId)}`,
      editions: ["Legacy"],
      scope: "newmods-vfs",
      adapter: "managed-addon-dlc",
      dlcName: overlayConfig.dlcName,
      requiresLoader: true,
      gameplayChanges: false,
      capabilities: [overlayConfig.capability],
      slots: [profile.atomicSlot],
      megaMall: {
        schemaVersion: 2,
        profileId: profile.id,
        designHash,
        assetName: overlayConfig.assetName,
        independentSurfaces: profile.surfaces.length,
      },
      files,
    };
  }
  return {
    id: `local-mega-mall-${cleanProjectId(projectId)}`,
    version: `1.0.0-${digest.slice(0, 12)}`,
    name: `Davis Mega Mall: ${cleanProjectId(projectId)}`,
    editions: [profile.edition === "legacy" ? "Legacy" : "Enhanced"],
    scope: "mods-dir",
    adapter: "rpf-entry",
    requiresLoader: true,
    gameplayChanges: false,
    capabilities: ["rpf-container-entry-v1"],
    slots: [profile.atomicSlot],
    megaMall: {
      schemaVersion: 1,
      profileId: profile.id,
      designHash,
    },
    files,
  };
}

export function createMegaMallInstallAdapter({
  storageOptions,
  findGame,
  assertRuntimeSafe,
  plan = planPackage,
  install = installLocalMegaMallOverlayPackage,
  uninstall = uninstallPackage,
  /* Пара загрузчиков (23.11.2026): мегамоллу она нужна (`newmods`-VFS), ставится перед установкой и уходит со снятием; без них — как раньше. */
  ensureLoaders = null,
  retireLoaders = null,
  compileOverlay = null,
  createRpf = createRpfArchive,
  provideDlcList = provideLegacyDlcList,
  extractEntry = extractRpfEntry,
  patchYtd = patchYtdTextures,
  composeRpf = composeRpfArchive,
  probeRpf = probeRpfArchive,
  hashFile = sha256File,
  readInstallState = inspectProfile,
} = {}) {
  if (
    typeof storageOptions !== "function" ||
    typeof findGame !== "function" ||
    typeof assertRuntimeSafe !== "function"
  ) {
    throw new TypeError(
      "Mega Mall install adapter требует storage/game/runtime boundaries.",
    );
  }
  let mutation = Promise.resolve();
  const serialized = (operation) => {
    const result = mutation.then(operation, operation);
    mutation = result.catch(() => {});
    return result;
  };

  const installed = async () => {
    const options = await storageOptions();
    const stateDir = path.resolve(options.stateDir);
    const state = await readInstallState({ stateDir });
    const records = [];
    for (const [targetId, target] of Object.entries(state?.targets || {})) {
      const installedItems = Array.isArray(target?.installed)
        ? target.installed
        : [];
      for (const item of installedItems) {
        const overlayConfig = OVERLAY_CONFIGS.find((config) => {
          const acceptedSlots = new Set([
            config.atomicSlot,
            config.atomicSlot.replaceAll(":", "-"),
          ]);
          return (
            item?.adapter === "managed-addon-dlc" &&
            item?.dlcName === config.dlcName &&
            Array.isArray(item.slots) &&
            item.slots.some((slot) => acceptedSlots.has(slot))
          );
        });
        if (!overlayConfig) {
          continue;
        }
        const acceptedSlots = new Set([
          overlayConfig.atomicSlot,
          overlayConfig.atomicSlot.replaceAll(":", "-"),
        ]);
        const resource = target.resources?.[overlayConfig.target];
        const layer = resource?.layers?.at(-1);
        const registration = target.dlcRegistrations?.[overlayConfig.dlcName];
        const rawGameRoot = target?.gameRoot;
        const resolvedGameRoot =
          typeof rawGameRoot === "string" && path.isAbsolute(rawGameRoot)
            ? path.resolve(rawGameRoot)
            : null;
        const gameRoot =
          resolvedGameRoot &&
          path.parse(resolvedGameRoot).root !== resolvedGameRoot
            ? resolvedGameRoot
            : null;
        const livePath = gameRoot
          ? path.join(gameRoot, ...overlayConfig.target.split("/"))
          : null;
        const stateOwned =
          Boolean(gameRoot) &&
          typeof item.modId === "string" &&
          item.modId.length > 0 &&
          item.targetId === targetId &&
          item.slots.length === 1 &&
          acceptedSlots.has(item.slots[0]) &&
          Array.isArray(item.resources) &&
          item.resources.length === 1 &&
          item.resources[0] === overlayConfig.target &&
          layer?.modId === item.modId &&
          /^[a-f0-9]{64}$/.test(layer?.sha256 || "") &&
          registration?.modId === item.modId;
        let liveSha256 = null;
        let status = stateOwned ? "missing" : "state-invalid";
        if (stateOwned) {
          try {
            const details = await fs.lstat(livePath);
            if (!details.isFile() || details.isSymbolicLink()) {
              throw new TypeError("Mega Mall live DLC не является файлом.");
            }
            liveSha256 = await hashFile(livePath);
            status = liveSha256 === layer.sha256 ? "active" : "drifted";
          } catch (error) {
            if (error?.code !== "ENOENT") status = "unreadable";
          }
        }
        records.push(
          Object.freeze({
            modId: item.modId,
            targetId,
            gameRoot,
            installedAt: item.installedAt || null,
            version: item.version || null,
            profileId: overlayConfig.profileId,
            kind: overlayConfig.kind,
            status,
            removable: status === "active",
            liveSha256,
          }),
        );
      }
    }
    return Object.freeze(
      records.sort((left, right) =>
        `${left.targetId}:${left.modId}`.localeCompare(
          `${right.targetId}:${right.modId}`,
        ),
      ),
    );
  };

  const materialize = async ({
    projectId,
    designHash,
    profile,
    artifacts,
    gameRoot,
    targetId,
  }) => {
    assertVerifiedProfile(profile);
    const overlayConfig = overlayConfigForProfile(profile);
    await assertGameTarget({
      findGame,
      assertRuntimeSafe,
      targetId,
      gameRoot,
      mutate: false,
      profile,
    });
    const options = await storageOptions();
    const stateDir = path.resolve(options.stateDir);
    const digest = designHash.replace(/^sha256:/, "");
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new TypeError("Некорректный Mega Mall designHash.");
    }
    const packageRoot = path.join(
      stateDir,
      "mega-mall-editor",
      "packages",
      cleanProjectId(projectId),
      profile.id,
      digest,
    );
    const artifactMap = exactArtifactMap(profile, artifacts);
    if (overlayConfig) {
      if (typeof compileOverlay !== "function") {
        throw new TypeError("Native Mega Mall overlay compiler не подключён.");
      }
      const markerPath = path.join(packageRoot, "package.json");
      try {
        const cached = JSON.parse(await fs.readFile(markerPath, "utf8"));
        const file = cached?.manifest?.files?.[0];
        if (
          cached?.format !== "astral.mega-mall-package" ||
          cached.version !== 2 ||
          cached.manifest?.megaMall?.profileId !== profile.id ||
          cached.manifest?.megaMall?.designHash !== designHash ||
          file?.source !== `payload/${overlayConfig.target}` ||
          file?.target !== overlayConfig.target
        ) {
          throw new TypeError(
            "Mega Mall overlay package cache marker повреждён.",
          );
        }
        const payloadPath = path.join(packageRoot, ...file.source.split("/"));
        const stat = await fs.stat(payloadPath);
        if (
          stat.size !== file.size ||
          (await hashFile(payloadPath)) !== file.sha256
        ) {
          throw new TypeError(
            "Mega Mall overlay cache payload не прошёл readback.",
          );
        }
        const packagePlan = await plan({
          manifest: cached.manifest,
          packageRoot,
          gameRoot,
          targetId,
          edition: "Legacy",
          stateDir,
          requireSignature: false,
        });
        return {
          packageRoot,
          manifest: cached.manifest,
          stateDir,
          gameRoot,
          targetId,
          replaceModIds: replacementIds(packagePlan),
          summary: {
            ...packagePlan.summary,
            profileId: profile.id,
            designHash,
            ytdCount: 1,
            textureCount: profile.surfaces.length,
            overlayArtifactCount: 4,
            rollbackReady: true,
            officialArchivesModified: false,
            cacheHit: true,
          },
        };
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }

      const workRoot = path.join(
        packageRoot,
        `.staging-${crypto.randomUUID()}`,
      );
      const assetsRoot = path.join(workRoot, "compiled");
      const requestPath = path.join(workRoot, "compile-request.json");
      const payloadRelative = `payload/${overlayConfig.target}`;
      const payloadPath = path.join(packageRoot, ...payloadRelative.split("/"));
      try {
        await fs.mkdir(workRoot, { recursive: true });
        const surfaces = [];
        for (const surface of profile.surfaces) {
          const artifact = artifactMap.get(surface.id);
          const ddsPath = path.join(workRoot, `${surface.id}.dds`);
          await atomicWrite(ddsPath, artifact.dds);
          surfaces.push({
            surfaceId: surface.id,
            textureName: surface.target.textureName,
            width: surface.target.width,
            height: surface.target.height,
            format: surface.target.format,
            mipLevels: surface.target.mipLevels,
            ddsPath,
            ddsSha256: artifact.ddsSha256,
          });
        }
        await atomicWrite(
          requestPath,
          Buffer.from(
            canonicalJson({
              format: "astral.compile-mega-mall-overlay",
              version: 1,
              targetId: "gta5-legacy-story",
              profileId: profile.id,
              buildId: gameBuildId(await findGame(targetId)),
              designHash,
              surfaces,
            }),
            "utf8",
          ),
        );
        const compiled = await compileOverlay({
          input: requestPath,
          output: assetsRoot,
        });
        if (
          compiled?.format !== "astral.mega-mall-overlay-artifacts" ||
          compiled?.version !== 1 ||
          compiled?.profileId !== profile.id ||
          compiled?.assetName !== overlayConfig.assetName ||
          compiled?.overlay?.independentSurfaceCount !==
            profile.surfaces.length ||
          compiled?.overlay?.vanillaArchivesModified !== false ||
          !Array.isArray(compiled.artifacts) ||
          compiled.artifacts.length !== 4
        ) {
          throw new TypeError(
            "Native Mega Mall overlay report не прошёл проверку.",
          );
        }
        const operations = [];
        const expectedArtifacts = new Set([".ydr", ".ytd", ".ymap", ".ytyp"]);
        for (const artifact of compiled.artifacts) {
          const extension = path.extname(artifact.file);
          if (
            path.basename(artifact.file, extension) !==
              overlayConfig.assetName ||
            !expectedArtifacts.delete(extension)
          ) {
            throw new TypeError(
              "Native Mega Mall overlay вернул неожиданный artifact.",
            );
          }
          const source = path.join(assetsRoot, artifact.file);
          const stat = await fs.lstat(source);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.size !== artifact.bytes ||
            (await hashFile(source)) !== artifact.sha256
          ) {
            throw new TypeError(
              `Overlay artifact ${artifact.file} не прошёл readback.`,
            );
          }
          operations.push({
            entry: `astral_stream.rpf/${artifact.file}`,
            source,
            sha256: artifact.sha256,
            modId: `${overlayConfig.modPrefix}-${cleanProjectId(projectId)}`,
            action: "import",
          });
        }
        if (expectedArtifacts.size)
          throw new TypeError("Overlay artifact set неполон.");
        const metadata = overlayMetadataXml(overlayConfig);
        const contentPath = path.join(workRoot, "content.xml");
        const setupPath = path.join(workRoot, "setup2.xml");
        await atomicWrite(contentPath, Buffer.from(metadata.content, "utf8"));
        await atomicWrite(setupPath, Buffer.from(metadata.setup, "utf8"));
        operations.push(
          {
            entry: "content.xml",
            source: contentPath,
            sha256: await hashFile(contentPath),
            modId: `@${overlayConfig.dlcName}`,
            action: "import",
          },
          {
            entry: "setup2.xml",
            source: setupPath,
            sha256: await hashFile(setupPath),
            modId: `@${overlayConfig.dlcName}`,
            action: "import",
          },
        );
        await fs.mkdir(path.dirname(payloadPath), { recursive: true });
        const creation = await createRpf({
          outputArchive: payloadPath,
          archiveTarget: overlayConfig.target,
          edition: "Legacy",
          gameRoot,
          operations,
        });
        const payloadStat = await fs.lstat(payloadPath);
        const payloadHash = await hashFile(payloadPath);
        if (
          !payloadStat.isFile() ||
          payloadStat.isSymbolicLink() ||
          creation?.status !== "ready" ||
          creation?.outputSha256 !== payloadHash
        ) {
          throw new TypeError(
            "Mega Mall DLC RPF не прошёл финальный readback.",
          );
        }
        const files = [
          {
            source: payloadRelative,
            target: overlayConfig.target,
            action: "replace",
            size: payloadStat.size,
            sha256: payloadHash,
          },
        ];
        const manifest = buildMegaMallInstallManifest({
          projectId,
          designHash,
          profile,
          files,
        });
        await publishContentAddressed(
          markerPath,
          Buffer.from(
            canonicalJson({
              format: "astral.mega-mall-package",
              version: 2,
              manifest,
            }),
            "utf8",
          ),
        );
        const packagePlan = await plan({
          manifest,
          packageRoot,
          gameRoot,
          targetId,
          edition: "Legacy",
          stateDir,
          requireSignature: false,
        });
        return {
          packageRoot,
          manifest,
          stateDir,
          gameRoot,
          targetId,
          replaceModIds: replacementIds(packagePlan),
          summary: {
            ...packagePlan.summary,
            profileId: profile.id,
            designHash,
            ytdCount: 1,
            textureCount: profile.surfaces.length,
            overlayArtifactCount: 4,
            rollbackReady: true,
            officialArchivesModified: false,
          },
        };
      } finally {
        await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});
      }
    }
    const groups = resourceGroups(profile, artifactMap);
    const markerPath = path.join(packageRoot, "package.json");
    try {
      const cached = JSON.parse(await fs.readFile(markerPath, "utf8"));
      if (
        cached?.format !== "astral.mega-mall-package" ||
        cached.version !== 1 ||
        cached.manifest?.megaMall?.profileId !== profile.id ||
        cached.manifest?.megaMall?.designHash !== designHash ||
        !Array.isArray(cached.manifest.files) ||
        cached.manifest.files.length !== groups.length
      ) {
        throw new TypeError("Mega Mall package cache marker повреждён.");
      }
      for (const file of cached.manifest.files) {
        const source = String(file.source || "").replaceAll("\\", "/");
        if (!/^payload\/[a-z0-9-]+\.ytd$/.test(source)) {
          throw new TypeError(
            "Mega Mall package cache содержит небезопасный source path.",
          );
        }
        const payloadPath = path.join(packageRoot, ...source.split("/"));
        const stat = await fs.stat(payloadPath);
        if (
          stat.size !== file.size ||
          (await hashFile(payloadPath)) !== file.sha256
        ) {
          throw new TypeError(
            "Mega Mall package cache payload не прошёл readback.",
          );
        }
      }
      const packagePlan = await plan({
        manifest: cached.manifest,
        packageRoot,
        gameRoot,
        targetId,
        edition: cached.manifest.editions[0],
        stateDir,
        requireSignature: false,
        rpfProbe: probeRpf,
      });
      return {
        packageRoot,
        manifest: cached.manifest,
        stateDir,
        gameRoot,
        targetId,
        replaceModIds: replacementIds(packagePlan),
        summary: {
          ...packagePlan.summary,
          profileId: profile.id,
          designHash,
          ytdCount: groups.length,
          textureCount: groups.reduce(
            (total, group) => total + group.patches.length,
            0,
          ),
          rollbackReady: true,
          officialArchivesModified: false,
          cacheHit: true,
        },
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const files = [];
    const workRoot = path.join(packageRoot, `.staging-${crypto.randomUUID()}`);
    try {
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        const officialArchive = path.join(
          gameRoot,
          ...group.archivePath.split("/"),
        );
        if (
          (await hashFile(officialArchive)) !==
          group.resource.baseSha256.slice("sha256:".length)
        ) {
          throw new TypeError(
            `Official archive ${group.archivePath} не совпадает с проверенным SHA-256.`,
          );
        }
        const work = path.join(workRoot, String(index));
        const baseYtd = path.join(work, "base.ytd");
        const stagedYtd = path.join(work, "patched.ytd");
        const outputName = `${String(index).padStart(2, "0")}-${sha256Bytes(Buffer.from(group.entryPath)).slice(0, 12)}.ytd`;
        const outputRelative = `${PACKAGE_SOURCE_ROOT}/${outputName}`;
        const outputYtd = path.join(packageRoot, ...outputRelative.split("/"));
        await fs.mkdir(work, { recursive: true });
        await extractEntry({
          archivePath: officialArchive,
          entry: group.entryPath,
          output: baseYtd,
          archiveTarget: group.archivePath,
          gameRoot,
          edition: profile.edition,
        });
        if (
          (await hashFile(baseYtd)) !==
          group.baseEntrySha256.slice("sha256:".length)
        ) {
          throw new TypeError(
            `Base YTD ${group.entryPath} не совпадает с проверенным SHA-256.`,
          );
        }
        const patches = [];
        for (const patch of group.patches) {
          const ddsPath = path.join(work, `${patch.texture}.dds`);
          await atomicWrite(ddsPath, patch.artifact.dds);
          patches.push({
            texture: patch.texture,
            source: ddsPath,
            sha256: patch.artifact.ddsSha256.replace(/^sha256:/, ""),
          });
        }
        await patchYtd({
          input: baseYtd,
          output: stagedYtd,
          patches,
          gameRoot,
          edition: profile.edition,
        });
        const outputBytes = await fs.readFile(stagedYtd);
        await publishContentAddressed(outputYtd, outputBytes);
        files.push({
          source: outputRelative,
          target: `mods/${group.archivePath}`,
          entry: group.entryPath,
          action: "replace",
          size: outputBytes.length,
          sha256: sha256Bytes(outputBytes),
        });
      }
    } finally {
      await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});
    }
    const manifest = buildMegaMallInstallManifest({
      projectId,
      designHash,
      profile,
      files,
    });
    const marker = Buffer.from(
      canonicalJson({
        format: "astral.mega-mall-package",
        version: 1,
        manifest,
      }),
      "utf8",
    );
    await publishContentAddressed(markerPath, marker);
    const packagePlan = await plan({
      manifest,
      packageRoot,
      gameRoot,
      targetId,
      edition: manifest.editions[0],
      stateDir,
      requireSignature: false,
      rpfProbe: probeRpf,
    });
    return {
      packageRoot,
      manifest,
      stateDir,
      gameRoot,
      targetId,
      replaceModIds: replacementIds(packagePlan),
      summary: {
        ...packagePlan.summary,
        profileId: profile.id,
        designHash,
        ytdCount: files.length,
        textureCount: groups.reduce(
          (total, group) => total + group.patches.length,
          0,
        ),
        rollbackReady: true,
        officialArchivesModified: false,
      },
    };
  };

  return Object.freeze({
    installed,

    plan(input) {
      return serialized(() => materialize(input));
    },

    async apply(planEnvelope) {
      const prepared = planEnvelope?.adapterPlan;
      if (!prepared?.manifest || !prepared.packageRoot) {
        throw new TypeError(
          "Mega Mall apply требует подготовленный одноразовый plan.",
        );
      }
      await assertGameTarget({
        findGame,
        assertRuntimeSafe,
        targetId: prepared.targetId,
        gameRoot: prepared.gameRoot,
        mutate: true,
        profile: planEnvelope.profile,
      });
      const overlayConfig = overlayConfigForProfile(planEnvelope.profile);
      if (ensureLoaders) await ensureLoaders({ targetId: prepared.targetId, stateDir: prepared.stateDir });
      const result = await install({
        manifest: prepared.manifest,
        packageRoot: prepared.packageRoot,
        gameRoot: prepared.gameRoot,
        targetId: prepared.targetId,
        edition: prepared.manifest.editions[0],
        stateDir: prepared.stateDir,
        requireSignature: false,
        replaceModIds: prepared.replaceModIds,
        rpfComposer: composeRpf,
        rpfProbe: probeRpf,
        dlcListProvider: provideDlcList,
        assertRuntimeSafety: async () => {
          const game = await findGame(prepared.targetId);
          await assertRuntimeSafe(game);
        },
      });
      return {
        ...result,
        installId: prepared.manifest.id,
        modId: prepared.manifest.id,
        kind: overlayConfig?.kind || "davis-mega-mall-overlay",
        status: "active",
        designHash: planEnvelope.designHash,
        profileId: planEnvelope.profile.id,
        officialArchivesModified: false,
      };
    },

    async remove(input) {
      const options = await storageOptions();
      const game = await findGame(input.targetId);
      if (
        !game ||
        path.resolve(game.path || "") !== path.resolve(input.gameRoot)
      ) {
        throw new TypeError(
          "Выбранная установка GTA V не совпадает с Mega Mall remove.",
        );
      }
      await assertRuntimeSafe(game);
      const result = await uninstall({
        modId: input.modId,
        targetId: input.targetId,
        stateDir: path.resolve(options.stateDir),
        rpfComposer: composeRpf,
        dlcListProvider: provideDlcList,
        assertRuntimeSafety: async () => {
          const current = await findGame(input.targetId);
          await assertRuntimeSafe(current);
        },
      });
      if (retireLoaders) await retireLoaders({ targetId: input.targetId, stateDir: path.resolve(options.stateDir) });
      return {
        ...result,
        installId: input.modId,
        modId: input.modId,
        kind: String(input.modId).startsWith("local-you-tool-")
          ? "you-tool-ashan-overlay"
          : "davis-mega-mall-overlay",
        status: "rolled-back",
        officialArchivesModified: false,
      };
    },
  });
}
