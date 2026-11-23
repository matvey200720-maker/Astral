import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { sha256File } from "@modovik/install-engine/manifest.js";
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import { fileURLToPath } from "node:url";
import electron from "electron";
import {
  assertCoverageMatchesPristineInventory,
  canonicalStreetLightJson,
  normalizeStreetLightModule,
  validateDetachedStreetLightCoverageSignature,
  validatePristineBuildInventory,
  validateStreetLightCoverageProfile,
} from "@modovik/street-light-contract";
import { resolveStreetLightFamily } from "@modovik/street-light-renderer";
import { enginePoint, engineInstallEnabled, recoverPendingTransactions } from "@modovik/install-engine";
import {
  composeRpfArchive,
  extractRpfEntry,
  getRpfHelperIdentity,
  installRpfPrebuilt,
  inspectLampLodPairOnEngine,
  patchLampLodPairOnEngine,
  runStreetLightRpfHelper,
} from "./rpf-composer.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const electronApp =
  electron && typeof electron === "object" ? electron.app : null;
const PLAN_TTL_MS = 10 * 60 * 1000;
const PROFILE_FILE = "legacy-24129523-coverage-candidate.json";
const PROFILE_SIGNATURE_FILE = "legacy-24129523-coverage-signature.json";
const INVENTORY_FILE = "legacy-24129523-pristine-inventory.json";
const INSTALL_STATE_SCHEMA = "astral-street-light-install-state/v1";
const TRANSACTION_SCHEMA = "astral-street-light-transaction/v1";
const PLAN_SCHEMA = "astral-street-light-prepared-plan/v1";
const COMPILED_SCHEMA = "astral-street-light-compiled-result/v1";
const COVERAGE_SIGNING_KEYS = Object.freeze({
  "astral-street-lights-release-2026-01":
    "MCowBQYDK2VwAyEAeliRZLdcrUdTJ2mdGtogtH6WT3Hv/bAkYMOzBWMuevg=",
  "astral-street-lights-release-2026-04":
    "MCowBQYDK2VwAyEAU4mY16Uu6dHJcuId0sr7yyTqtRax5lHVfS/DElw2sMI=",
  "astral-street-lights-release-2026-05":
    "MCowBQYDK2VwAyEAHSAgtIQ0BUhu4fKoc1gojnaqGDpJOOYSPTqDnApzh5Y=",
  "astral-street-lights-release-2026-06":
    "MCowBQYDK2VwAyEAQzImf+y7UL5bqmtNROmdhuaOfdDBYSlXP8v0ehStIE0=",
  "astral-street-lights-release-2026-08":
    "MCowBQYDK2VwAyEAs1sS8eK64+GLs2grHb4TvsbymJBCIcYAqfK3UxN0tgo=",
});
const KNOWN_LOADER_HASHES = Object.freeze({
  "OpenIV.asi":
    "b12ddc9ce256dc89a9c8bb77d6dd1c61683d18f0884097458658ab48bd1a4ec2",
  "dinput8.dll":
    "22fda9c71eaae02460f311bf3441638340ab591586d78f1de213c4819dcb883c",
});
const TARGETS = Object.freeze({
  hd: {
    archiveRelativePath: "x64h.rpf",
    archivePathId: "legacy-x64h",
    entry:
      "levels/gta5/props/roadside/v_traffic_lights.rpf/prop_streetlight_02.yft",
    filename: "prop_streetlight_02.yft",
    overlayRelativePath: "mods/x64h.rpf",
  },
  lod: {
    archiveRelativePath: "x64e.rpf",
    archivePathId: "legacy-x64e",
    lodEntry: "levels/gta5/lodlights.rpf/lodlights_medium013.ymap",
    distantEntry: "levels/gta5/lodlights.rpf/distlodlights_medium013.ymap",
    lodFilename: "lodlights_medium013.ymap",
    distantFilename: "distlodlights_medium013.ymap",
    overlayRelativePath: "mods/x64e.rpf",
  },
});

const shaBytes = (value) => createHash("sha256").update(value).digest("hex");
const shaCanonical = (value) => shaBytes(canonicalStreetLightJson(value));

export function streetLightCompiledContentHash(compileInputHash, operations) {
  if (!/^[0-9a-f]{64}$/.test(String(compileInputHash || "")))
    throw new Error("Street-light compileInputHash must be SHA-256.");
  if (!Array.isArray(operations) || operations.length < 1)
    throw new Error("Street-light operations are required for content hash.");
  return shaCanonical({
    compileInputHash,
    semanticOperations: operations.map((operation) => ({
      operationId: operation.operationId,
      targetId: operation.targetId,
      baseSha256: operation.baseSha256,
      semanticDiffSha256: operation.semanticDiffSha256,
    })),
  });
}

/* Отпечаток — кусками по 4 МБ в один и тот же буфер (`sha256File`), а не
   потоком по 64 КБ: на двухгигабайтном update.rpf это 32 тыс. буферов, и
   в Electron главный поток вставал на их выделении (ОЗУ 15.10, бета.15). */
const shaFile = (file) => sha256File(file);

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
  });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function resourcesDirectory() {
  return electronApp?.isPackaged
    ? path.join(process.resourcesPath, "street-lights")
    : path.resolve(dirname, "../../../resources/street-lights");
}

async function loadRegistry() {
  const directory = resourcesDirectory();
  const profile = validateStreetLightCoverageProfile(
    await readJson(path.join(directory, PROFILE_FILE)),
  );
  const inventory = validatePristineBuildInventory(
    await readJson(path.join(directory, INVENTORY_FILE)),
  );
  const detachedSignature = validateDetachedStreetLightCoverageSignature(
    await readJson(path.join(directory, PROFILE_SIGNATURE_FILE)),
  );
  assertCoverageMatchesPristineInventory(profile, inventory);
  const { profileSha256, signatureKeyId } = verifyStreetLightCoverageSignature(
    profile,
    detachedSignature,
  );
  const actualInventoryHash = shaCanonical(inventory);
  if (actualInventoryHash !== profile.sourceSet.pristineBuildInventorySha256)
    throw new Error("Street-light pristine inventory hash mismatch.");
  return {
    profile,
    inventory,
    profileSha256,
    signatureKeyId,
    inventorySha256: actualInventoryHash,
  };
}

export function verifyStreetLightCoverageSignature(
  profileInput,
  signatureInput,
  now = Date.now(),
) {
  const profile = validateStreetLightCoverageProfile(profileInput);
  const detachedSignature =
    validateDetachedStreetLightCoverageSignature(signatureInput);
  const profileSha256 = shaCanonical(profile);
  if (detachedSignature.payloadSha256 !== profileSha256)
    throw new Error("Street-light coverage signature payload hash mismatch.");
  const publicKeyBase64 =
    COVERAGE_SIGNING_KEYS[detachedSignature.signature.keyId];
  if (!publicKeyBase64)
    throw new Error("Street-light coverage signature key is not trusted.");
  const issuedAt = Date.parse(detachedSignature.signature.issuedAt);
  const expiresAt = detachedSignature.signature.expiresAt
    ? Date.parse(detachedSignature.signature.expiresAt)
    : null;
  if (issuedAt > now + 5 * 60 * 1000 || (expiresAt && expiresAt <= now))
    throw new Error(
      "Street-light coverage signature is outside its validity window.",
    );
  const signedMessage = {
    schema: detachedSignature.schema,
    payloadSha256: detachedSignature.payloadSha256,
    signature: {
      algorithm: detachedSignature.signature.algorithm,
      keyId: detachedSignature.signature.keyId,
      issuedAt: detachedSignature.signature.issuedAt,
      expiresAt: detachedSignature.signature.expiresAt,
    },
  };
  const signatureBytes = Buffer.from(
    detachedSignature.signature.valueBase64,
    "base64",
  );
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
  if (
    signatureBytes.length !== 64 ||
    !verifySignature(
      null,
      Buffer.from(canonicalStreetLightJson(signedMessage)),
      publicKey,
      signatureBytes,
    )
  )
    throw new Error("Street-light coverage signature verification failed.");
  return {
    profileSha256,
    signatureKeyId: detachedSignature.signature.keyId,
  };
}

function inventoryArchive(inventory, archivePathId) {
  const item = inventory.mountedArchives.find(
    (archive) => archive.archivePathId === archivePathId,
  );
  if (!item) throw new Error(`Coverage inventory misses ${archivePathId}.`);
  return item;
}

async function discoverLegacyGame(listGames) {
  const games = await listGames();
  const candidates = games.filter(
    (game) => String(game.edition || "").toLowerCase() === "legacy",
  );
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "Найдено несколько GTA V Legacy; выберите одну установку в Astral."
        : "GTA V Legacy не найдена.",
    );
  return candidates[0];
}

async function readInstallState(stateFile) {
  try {
    const value = await readJson(stateFile);
    if (value?.schema !== INSTALL_STATE_SCHEMA) throw new Error("schema");
    if (
      typeof value.installId !== "string" ||
      !/^street-lights:[0-9a-f-]{36}$/i.test(value.installId) ||
      !["active", "disabled"].includes(value.status) ||
      typeof value.gameRoot !== "string" ||
      !Array.isArray(value.outputs) ||
      !Array.isArray(value.previous)
    )
      throw new Error("shape");
    const allowedTargets = new Set(
      [TARGETS.hd, TARGETS.lod].map((target) => target.overlayRelativePath),
    );
    if (
      value.outputs.length !== allowedTargets.size ||
      value.outputs.some(
        (output) =>
          !allowedTargets.has(output?.relativePath) ||
          !/^[0-9a-f]{64}$/.test(String(output?.sha256 || "")) ||
          !Number.isSafeInteger(output?.bytes) ||
          output.bytes <= 0,
      ) ||
      new Set(value.outputs.map((output) => output.relativePath)).size !==
        value.outputs.length
    )
      throw new Error("outputs");
    if (
      value.previous.some(
        (item) =>
          typeof item?.target !== "string" ||
          typeof item?.backup !== "string" ||
          !/^[0-9a-f]{64}$/.test(String(item?.sha256 || "")),
      ) ||
      (value.compileInputHash != null &&
        !/^[0-9a-f]{64}$/.test(String(value.compileInputHash))) ||
      (value.compiledContentHash != null &&
        !/^[0-9a-f]{64}$/.test(String(value.compiledContentHash)))
    )
      throw new Error("metadata");
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(
      "Street-light install state повреждён; автоматическая запись заблокирована.",
    );
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

function within(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function conflict(resourceKey, severity, reasonCode, parameters = {}) {
  return { resourceKey, severity, reasonCode, parameters };
}

async function inspectCapability({ game, registry, helper, stateFile }) {
  const gameRoot = path.resolve(game.path);
  const conflicts = [];
  if (String(game.buildId || "") !== "24129523")
    conflicts.push(
      conflict("game-build", "blocking", "STREET_LIGHT_UNSUPPORTED_BUILD", {
        buildId: String(game.buildId || "unknown"),
      }),
    );
  const executable = path.join(gameRoot, "GTA5.exe");
  if (!(await exists(executable)))
    conflicts.push(
      conflict(
        "game-build",
        "blocking",
        "STREET_LIGHT_LEGACY_EXECUTABLE_MISSING",
      ),
    );
  else {
    const executableHash = await shaFile(executable);
    if (executableHash !== registry.profile.buildFingerprint)
      conflicts.push(
        conflict(
          "game-build",
          "blocking",
          "STREET_LIGHT_BUILD_FINGERPRINT_MISMATCH",
          {
            expected: registry.profile.buildFingerprint,
            actual: executableHash,
          },
        ),
      );
  }
  if (helper.sha256 !== registry.profile.compiler.helperBinarySha256)
    conflicts.push(
      conflict("helper", "blocking", "STREET_LIGHT_HELPER_HASH_MISMATCH", {
        expected: registry.profile.compiler.helperBinarySha256,
        actual: helper.sha256,
      }),
    );
  for (const [name, expected] of Object.entries(KNOWN_LOADER_HASHES)) {
    const file = path.join(gameRoot, name);
    const actual = (await exists(file)) ? await shaFile(file) : null;
    if (actual !== expected)
      conflicts.push(
        conflict(
          `loader:${name}`,
          "blocking",
          "STREET_LIGHT_OVERLAY_LOADER_UNVERIFIED",
          {
            name,
            actual: actual || "missing",
          },
        ),
      );
  }
  if (!registry.profile.overlayCapability.verified)
    conflicts.push(
      conflict(
        "overlay",
        "blocking",
        "STREET_LIGHT_REGISTRY_OVERLAY_CAPABILITY_NOT_PROMOTED",
      ),
    );

  const critical = ["legacy-x64e", "legacy-x64h", "legacy-x64m"];
  for (const archivePathId of critical) {
    const expected = inventoryArchive(registry.inventory, archivePathId);
    const file = path.join(gameRoot, expected.relativePath);
    const actual = (await exists(file)) ? await shaFile(file) : null;
    if (actual !== expected.sha256)
      conflicts.push(
        conflict(
          `base:${archivePathId}`,
          "blocking",
          "STREET_LIGHT_PRISTINE_BASE_MISMATCH",
          { archivePathId, actual: actual || "missing" },
        ),
      );
  }
  const update = inventoryArchive(registry.inventory, "legacy-update");
  const liveUpdate = path.join(gameRoot, update.relativePath);
  const backupUpdate = path.join(gameRoot, "update", "update_backup.rpf");
  const liveHash = (await exists(liveUpdate))
    ? await shaFile(liveUpdate)
    : null;
  const backupHash = (await exists(backupUpdate))
    ? await shaFile(backupUpdate)
    : null;
  if (liveHash !== update.sha256) {
    if (backupHash === update.sha256)
      conflicts.push(
        conflict(
          "base:legacy-update",
          "warning",
          "STREET_LIGHT_FOREIGN_UPDATE_DRIFT_DISJOINT",
          {
            cleanBackupVerified: true,
          },
        ),
      );
    else
      conflicts.push(
        conflict(
          "base:legacy-update",
          "blocking",
          "STREET_LIGHT_PRISTINE_UPDATE_UNAVAILABLE",
        ),
      );
  }

  const state = await readInstallState(stateFile);
  if (state && path.resolve(state.gameRoot) !== gameRoot)
    conflicts.push(
      conflict(
        "installation-state",
        "blocking",
        "STREET_LIGHT_INSTALLATION_ROOT_MISMATCH",
      ),
    );
  for (const target of [TARGETS.hd, TARGETS.lod]) {
    const overlay = path.join(gameRoot, target.overlayRelativePath);
    const expectedOutput = state?.outputs?.find(
      (output) => output.relativePath === target.overlayRelativePath,
    );
    if (!(await exists(overlay))) {
      if (state?.status === "active" && expectedOutput)
        conflicts.push(
          conflict(
            `overlay:${target.overlayRelativePath}`,
            "blocking",
            "STREET_LIGHT_MANAGED_OVERLAY_MISSING",
            { relativePath: target.overlayRelativePath },
          ),
        );
      continue;
    }
    const actual = await shaFile(overlay);
    const managed =
      state &&
      state.status === "active" &&
      path.resolve(state.gameRoot) === gameRoot &&
      state.outputs.some(
        (output) =>
          output.relativePath === target.overlayRelativePath &&
          output.sha256 === actual,
      );
    if (!managed)
      conflicts.push(
        conflict(
          `overlay:${target.overlayRelativePath}`,
          "blocking",
          "STREET_LIGHT_FOREIGN_TARGET_OVERLAY",
          { relativePath: target.overlayRelativePath },
        ),
      );
  }
  const foreignUpdateOverlay = path.join(
    gameRoot,
    "mods",
    "update",
    "update.rpf",
  );
  if (await exists(foreignUpdateOverlay))
    conflicts.push(
      conflict(
        "overlay:mods/update/update.rpf",
        "warning",
        "STREET_LIGHT_FOREIGN_OVERLAY_DISJOINT",
        { relativePath: "mods/update/update.rpf" },
      ),
    );
  return {
    game,
    gameRoot,
    conflicts,
    applyReady: conflicts.every((item) => item.severity !== "blocking"),
    state,
  };
}

function hdBaseline(inventory) {
  return {
    intensity: inventory.intensity,
    falloff: inventory.falloff,
    falloffExponent: inventory.falloffExponent,
    lightFadeDistance: inventory.lightFadeDistance,
    coronaIntensity: inventory.corona.intensity,
    coronaSize: inventory.corona.size,
    coronaZBias: inventory.corona.zBias,
    volumeIntensity: inventory.volume.intensity,
    volumeSizeScale: inventory.volume.sizeScale,
    volumeOuterIntensity: inventory.volume.outerIntensity,
    volumeOuterExponent: inventory.volume.outerExponent,
    volumetricFadeDistance: inventory.volume.fadeDistance,
  };
}

function helperHdMutation(target) {
  return {
    lightIndex: Number(target.targetId.split(":").at(-1)),
    expectedFingerprint: target.expectedFingerprint,
    ...target.values,
  };
}

function helperLodMutation(target) {
  return {
    alignedLightIndex: Number(target.targetId.split(":").at(-1)),
    expectedFingerprint: target.expectedFingerprint,
    ...target.values,
  };
}

function semanticPatchDescriptor(kind, mutations, result) {
  const validation = result?.validation || {};
  const requiredValidation =
    kind === "hd"
      ? [
          "reopened",
          "exactInputSha256",
          "exactLightFingerprints",
          "lightTopologyPreserved",
          "immutableFieldsPreserved",
          "atomicOutput",
        ]
      : [
          "reopened",
          "exactInputSha256",
          "exactLightFingerprints",
          "alignedTopologyPreserved",
          "immutableFieldsPreserved",
          "nonLightEnvelopePreserved",
          "stagingOnly",
        ];
  for (const field of requiredValidation) {
    if (validation[field] !== true)
      throw new Error(`Helper semantic validation failed: ${kind}.${field}.`);
  }
  return {
    kind,
    mutations,
    validation: Object.fromEntries(
      requiredValidation.map((field) => [field, true]),
    ),
  };
}

function requireHelperValidation(result, fields, label) {
  for (const field of fields)
    if (result?.validation?.[field] !== true)
      throw new Error(`Helper validation failed: ${label}.${field}.`);
}

async function diskSpaceFor(directory) {
  try {
    const value = await fs.statfs(directory);
    return Number(value.bavail) * Number(value.bsize);
  } catch {
    return 0;
  }
}

async function removeManagedPlanDirectory(stateDir, directory) {
  const plansRoot = path.resolve(stateDir, "street-lights", "plans");
  const resolved = path.resolve(directory);
  if (!within(plansRoot, resolved))
    throw new Error("Street-light plan cleanup escaped managed plan root.");
  const name = path.basename(resolved);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      name,
    )
  )
    throw new Error("Street-light plan cleanup rejected a non-UUID directory.");
  let stat;
  try {
    stat = await fs.lstat(resolved);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Street-light plan cleanup rejected a reparse target.");
  await fs.rm(resolved, { recursive: true, force: true });
}

async function pruneOrphanedPlanDirectories(stateDir, activePlanIds) {
  const plansRoot = path.resolve(stateDir, "street-lights", "plans");
  let entries;
  try {
    entries = await fs.readdir(plansRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const cutoff = Date.now() - PLAN_TTL_MS;
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      activePlanIds.has(entry.name) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        entry.name,
      )
    )
      continue;
    const directory = path.join(plansRoot, entry.name);
    const stat = await fs.lstat(directory);
    if (stat.mtimeMs < cutoff)
      await removeManagedPlanDirectory(stateDir, directory);
  }
}

export function resolveStreetLightFamilyHdAsset(family) {
  if (!/^prop-streetlight-[0-9a-z]+$/.test(family.familyId))
    throw new Error(
      "Signed street-light family has an unsupported asset identity.",
    );
  const expectedEntryPathId = `legacy-x64h-v-traffic-lights-${family.familyId}`;
  if (
    family.hdTargets.some(
      (target) =>
        target.archivePathId !== "legacy-x64h" ||
        target.entryPathId !== expectedEntryPathId ||
        target.kind !== "yft-light",
    )
  )
    throw new Error(`HD asset registry mismatch: ${family.familyId}.`);
  const filename = `${family.familyId.replaceAll("-", "_")}.yft`;
  return {
    filename,
    entry: `levels/gta5/props/roadside/v_traffic_lights.rpf/${filename}`,
  };
}

export function resolveStreetLightLodPair(target) {
  if (target.archivePathId !== "legacy-x64e")
    throw new Error(`LOD archive registry mismatch: ${target.targetId}.`);
  const match =
    /^legacy-x64e-(lodlights[_-](?:small|medium)[0-9]{3})-pair$/.exec(
      target.entryPathId,
    );
  if (!match)
    throw new Error(`LOD entry registry mismatch: ${target.targetId}.`);
  const pairName = match[1].replace("lodlights-", "lodlights_");
  const index = Number(target.targetId.split(":").at(-1));
  if (index !== target.selector.alignedLightIndex)
    throw new Error(`LOD target index mismatch: ${target.targetId}.`);
  return {
    pairName,
    lodFilename: `${pairName}.ymap`,
    distantFilename: `dist${pairName}.ymap`,
    lodEntry: `levels/gta5/lodlights.rpf/${pairName}.ymap`,
    distantEntry: `levels/gta5/lodlights.rpf/dist${pairName}.ymap`,
  };
}

async function compilePlan({
  planId,
  module,
  projectTarget,
  capability,
  registry,
  helper,
  stateDir,
}) {
  const binding = module.binding;
  if (!binding)
    throw new Error("Сначала выберите проверенное семейство фонарей.");
  if (binding.profileId !== registry.profile.profileId)
    throw new Error("Binding ссылается на другой coverage profile.");
  const family = registry.profile.families.find(
    (candidate) => candidate.familyId === binding.familyIds[0],
  );
  if (!family || binding.familyIds.length !== 1)
    throw new Error("V1 применяет ровно одно полностью проверенное семейство.");

  if (!isUuid(planId)) throw new Error("Street-light planId is invalid.");
  const directory = path.join(stateDir, "street-lights", "plans", planId);
  const extracted = path.join(directory, "extracted");
  const patched = path.join(directory, "patched");
  const composed = path.join(directory, "composed");
  const verified = path.join(directory, "verified");
  await fs.mkdir(extracted, { recursive: true });
  await fs.mkdir(patched, { recursive: true });
  await fs.mkdir(composed, { recursive: true });
  await fs.mkdir(verified, { recursive: true });
  const gameRoot = capability.gameRoot;
  const hdBase = path.join(gameRoot, TARGETS.hd.archiveRelativePath);
  const lodBase = path.join(gameRoot, TARGETS.lod.archiveRelativePath);
  const hdAsset = resolveStreetLightFamilyHdAsset(family);
  const hdExtracted = path.join(extracted, hdAsset.filename);
  await extractRpfEntry({
    gameRoot,
    archivePath: hdBase,
    archiveTarget: TARGETS.hd.archiveRelativePath,
    edition: "Legacy",
    entry: hdAsset.entry,
    output: hdExtracted,
  });
  const hdInspect = await runStreetLightRpfHelper({
    mode: "lamp-inspect",
    gameRoot,
    edition: "Legacy",
    inputFile: hdExtracted,
  });
  const lodGroups = new Map();
  for (const target of family.lodTargets) {
    const pair = resolveStreetLightLodPair(target);
    const group = lodGroups.get(pair.pairName) || { ...pair, targets: [] };
    group.targets.push(target);
    lodGroups.set(pair.pairName, group);
  }
  for (const group of lodGroups.values()) {
    group.lodExtracted = path.join(extracted, group.lodFilename);
    group.distantExtracted = path.join(extracted, group.distantFilename);
    await extractRpfEntry({
      gameRoot,
      archivePath: lodBase,
      archiveTarget: TARGETS.lod.archiveRelativePath,
      edition: "Legacy",
      entry: group.lodEntry,
      output: group.lodExtracted,
    });
    await extractRpfEntry({
      gameRoot,
      archivePath: lodBase,
      archiveTarget: TARGETS.lod.archiveRelativePath,
      edition: "Legacy",
      entry: group.distantEntry,
      output: group.distantExtracted,
    });
    group.inspection =
      (await inspectLampLodPairOnEngine({
        lodInputFile: group.lodExtracted,
        distantInputFile: group.distantExtracted,
      })) ??
      (await runStreetLightRpfHelper({
        mode: "lamp-lod-inspect-pair",
        gameRoot,
        edition: "Legacy",
        lodInputFile: group.lodExtracted,
        distantInputFile: group.distantExtracted,
      }));
  }
  const baselineByTarget = {};
  for (const target of family.hdTargets) {
    const light = hdInspect.inventory.lights[target.selector.lightIndex];
    if (
      !light ||
      light.fingerprint !== target.structuralFingerprint ||
      light.boneTag !== target.expectedBoneTag ||
      light.type !== target.expectedType
    )
      throw new Error(`HD selector/fingerprint drift: ${target.targetId}.`);
    baselineByTarget[target.targetId] = hdBaseline(light);
  }
  for (const group of lodGroups.values()) {
    for (const target of group.targets) {
      const light = group.inspection.lights[target.selector.alignedLightIndex];
      if (
        !light ||
        light.fingerprint !== target.structuralFingerprint ||
        light.immutableFingerprint !== target.selector.anchorFingerprint
      )
        throw new Error(`LOD selector/fingerprint drift: ${target.targetId}.`);
    }
  }
  const resolved = resolveStreetLightFamily({
    design: module.design,
    family,
    baselineByTarget,
  });
  const hdMutations = resolved.hdTargets.map(helperHdMutation);
  const hdPlan = await runStreetLightRpfHelper({
    mode: "lamp-plan",
    gameRoot,
    edition: "Legacy",
    inputFile: hdExtracted,
    expectedInputSha256: hdInspect.sha256,
    lampHdMutations: hdMutations,
  });
  requireHelperValidation(
    hdPlan,
    [
      "readOnly",
      "exactInputSha256",
      "exactLightFingerprints",
      "immutableFieldsPreserved",
    ],
    "hd-plan",
  );
  const patchedHd = path.join(patched, hdAsset.filename);
  const hdPatch = await runStreetLightRpfHelper({
    mode: "lamp-patch",
    gameRoot,
    edition: "Legacy",
    inputFile: hdExtracted,
    outputFile: patchedHd,
    expectedInputSha256: hdInspect.sha256,
    lampHdMutations: hdMutations,
  });
  const hdVerify = await runStreetLightRpfHelper({
    mode: "lamp-verify",
    gameRoot,
    edition: "Legacy",
    inputFile: hdExtracted,
    outputFile: patchedHd,
    expectedInputSha256: hdInspect.sha256,
    lampHdMutations: hdMutations,
  });
  requireHelperValidation(
    hdVerify,
    [
      "reopened",
      "exactInputSha256",
      "exactLightFingerprints",
      "lightTopologyPreserved",
      "immutableFieldsPreserved",
      "unownedLightsPreserved",
    ],
    "hd-verify",
  );
  const resolvedLodById = new Map(
    resolved.lodTargets.map((target) => [target.targetId, target]),
  );
  for (const group of lodGroups.values()) {
    group.patchedLod = path.join(patched, group.lodFilename);
    group.patchedDistant = path.join(patched, group.distantFilename);
    group.resolvedTargets = group.targets.map((target) => {
      const resolvedTarget = resolvedLodById.get(target.targetId);
      if (!resolvedTarget)
        throw new Error(`Resolved LOD target is missing: ${target.targetId}.`);
      return resolvedTarget;
    });
    group.mutations = group.resolvedTargets.map(helperLodMutation);
    group.plan = await runStreetLightRpfHelper({
      mode: "lamp-plan",
      gameRoot,
      edition: "Legacy",
      lodInputFile: group.lodExtracted,
      distantInputFile: group.distantExtracted,
      expectedLodInputSha256: group.inspection.inputs.lod.sha256,
      expectedDistantInputSha256: group.inspection.inputs.distant.sha256,
      lampLodMutations: group.mutations,
    });
    requireHelperValidation(
      group.plan,
      [
        "readOnly",
        "exactInputSha256",
        "exactLightFingerprints",
        "alignedTopologyPreserved",
        "immutableFieldsPreserved",
      ],
      `${group.pairName}-plan`,
    );
    const patchRequest = {
      gameRoot,
      edition: "Legacy",
      lodInputFile: group.lodExtracted,
      distantInputFile: group.distantExtracted,
      lodOutputFile: group.patchedLod,
      distantOutputFile: group.patchedDistant,
      expectedLodInputSha256: group.inspection.inputs.lod.sha256,
      expectedDistantInputSha256: group.inspection.inputs.distant.sha256,
      lampLodMutations: group.mutations,
    };
    group.patch =
      (await patchLampLodPairOnEngine(patchRequest)) ??
      (await runStreetLightRpfHelper({ mode: "lamp-lod-patch", ...patchRequest }));
    group.verify = await runStreetLightRpfHelper({
      mode: "lamp-verify",
      gameRoot,
      edition: "Legacy",
      lodInputFile: group.lodExtracted,
      distantInputFile: group.distantExtracted,
      lodOutputFile: group.patchedLod,
      distantOutputFile: group.patchedDistant,
      expectedLodInputSha256: group.inspection.inputs.lod.sha256,
      expectedDistantInputSha256: group.inspection.inputs.distant.sha256,
      lampLodMutations: group.mutations,
    });
    requireHelperValidation(
      group.verify,
      [
        "reopened",
        "exactInputSha256",
        "exactLightFingerprints",
        "alignedTopologyPreserved",
        "immutableFieldsPreserved",
        "nonLightEnvelopePreserved",
        "unownedLightsPreserved",
      ],
      `${group.pairName}-verify`,
    );
  }
  const x64hOutput = path.join(composed, "x64h.rpf");
  const x64eOutput = path.join(composed, "x64e.rpf");
  await composeRpfArchive({
    gameRoot,
    baseArchive: hdBase,
    outputArchive: x64hOutput,
    archiveTarget: TARGETS.hd.overlayRelativePath,
    edition: "Legacy",
    allowDeletes: false,
    operations: [
      {
        entry: hdAsset.entry,
        source: patchedHd,
        sha256: hdPatch.outputSha256,
        action: "replace",
        allowDelete: false,
        modId: "local-street-lights-v1",
      },
    ],
  });
  await composeRpfArchive({
    gameRoot,
    baseArchive: lodBase,
    outputArchive: x64eOutput,
    archiveTarget: TARGETS.lod.overlayRelativePath,
    edition: "Legacy",
    allowDeletes: false,
    operations: [...lodGroups.values()]
      .sort((a, b) => a.pairName.localeCompare(b.pairName))
      .flatMap((group) => [
        {
          entry: group.lodEntry,
          source: group.patchedLod,
          sha256: group.patch.outputs.lod.sha256,
          action: "replace",
          allowDelete: false,
          modId: "local-street-lights-v1",
        },
        {
          entry: group.distantEntry,
          source: group.patchedDistant,
          sha256: group.patch.outputs.distant.sha256,
          action: "replace",
          allowDelete: false,
          modId: "local-street-lights-v1",
        },
      ]),
  });
  const verifyComposedEntry = async ({
    archivePath,
    entry,
    expectedSha256,
  }) => {
    const output = path.join(
      verified,
      `${createHash("sha256").update(entry).digest("hex")}.bin`,
    );
    await extractRpfEntry({
      gameRoot,
      archivePath,
      archiveTarget: path.basename(archivePath),
      edition: "Legacy",
      entry,
      output,
    });
    if ((await shaFile(output)) !== expectedSha256)
      throw new Error(`Composed RPF entry verification failed: ${entry}.`);
  };
  await verifyComposedEntry({
    archivePath: x64hOutput,
    entry: hdAsset.entry,
    expectedSha256: hdPatch.outputSha256,
  });
  for (const group of lodGroups.values()) {
    await verifyComposedEntry({
      archivePath: x64eOutput,
      entry: group.lodEntry,
      expectedSha256: group.patch.outputs.lod.sha256,
    });
    await verifyComposedEntry({
      archivePath: x64eOutput,
      entry: group.distantEntry,
      expectedSha256: group.patch.outputs.distant.sha256,
    });
  }
  const outputs = [
    {
      relativePath: TARGETS.hd.overlayRelativePath,
      stagedPath: x64hOutput,
      sha256: await shaFile(x64hOutput),
      bytes: (await fs.stat(x64hOutput)).size,
    },
    {
      relativePath: TARGETS.lod.overlayRelativePath,
      stagedPath: x64eOutput,
      sha256: await shaFile(x64eOutput),
      bytes: (await fs.stat(x64eOutput)).size,
    },
  ];
  const compileInput = {
    projectTarget,
    normalizedDesignSha256: shaCanonical(module.design),
    bindingSha256: shaCanonical(module.binding),
    targetProfileSha256: registry.profileSha256,
    gameBuildFingerprint: registry.profile.buildFingerprint,
    cleanBaseSetSha256: shaCanonical({
      x64h: inventoryArchive(registry.inventory, "legacy-x64h").sha256,
      x64e: inventoryArchive(registry.inventory, "legacy-x64e").sha256,
    }),
    activeLayerGraphSha256: shaCanonical(
      capability.conflicts.filter((item) =>
        item.resourceKey.startsWith("overlay:"),
      ),
    ),
    helperBinarySha256: helper.sha256,
    compilerVersion: "street-light-resolver-v1",
    mappingRegistryVersion: registry.profile.compiler.mappingRegistryVersion,
  };
  const compileInputHash = shaCanonical(compileInput);
  const lodDescriptors = [...lodGroups.values()]
    .sort((a, b) => a.pairName.localeCompare(b.pairName))
    .map((group) => ({
      pairName: group.pairName,
      descriptor: semanticPatchDescriptor("lod", group.mutations, group.patch),
    }));
  const operations = outputs.map((output) => ({
    operationId: `replace:${output.relativePath}`,
    targetId: output.relativePath,
    baseSha256:
      output.relativePath === TARGETS.hd.overlayRelativePath
        ? inventoryArchive(registry.inventory, "legacy-x64h").sha256
        : inventoryArchive(registry.inventory, "legacy-x64e").sha256,
    outputSha256: output.sha256,
    semanticDiffSha256: shaCanonical(
      output.relativePath === TARGETS.hd.overlayRelativePath
        ? semanticPatchDescriptor("hd", hdMutations, hdPatch)
        : lodDescriptors,
    ),
  }));
  const compiledContentHash = streetLightCompiledContentHash(
    compileInputHash,
    operations,
  );
  const compiledResult = {
    schema: COMPILED_SCHEMA,
    compileInputHash,
    compiledContentHash,
    effectiveByFamily: [
      {
        familyId: family.familyId,
        values: resolved.values,
        clamps: resolved.clamps,
        unsupported: resolved.unsupported,
      },
    ],
    operations,
  };
  const requiredBytes = outputs.reduce((sum, output) => sum + output.bytes, 0);
  const freeBytes = await diskSpaceFor(gameRoot);
  const needsBackup = capability.state?.status === "active";
  const expiresAt = Date.now() + PLAN_TTL_MS;
  const envelope = {
    schema: PLAN_SCHEMA,
    planId,
    lifecycleAction: capability.state ? "replace" : "install",
    ...(capability.state
      ? { replaceInstallId: capability.state.installId }
      : {}),
    compileInputHash,
    compiledContentHash,
    displayTargets: [
      {
        targetId: `${family.familyId}-yft`,
        assetKind: "yft",
        archiveLabel: "x64h.rpf",
        entryLabel: hdAsset.filename,
      },
      ...[...lodGroups.values()].map((group) => ({
        targetId: `${family.familyId}-${group.pairName}-pair`,
        assetKind: "ymap-lod-pair",
        archiveLabel: "x64e.rpf",
        entryLabel: `${group.pairName} pair`,
      })),
    ],
    conflicts: [...capability.conflicts],
    space: {
      stagingBytes: requiredBytes,
      backupBytes: needsBackup ? requiredBytes : 0,
      requiredBytes: requiredBytes * (needsBackup ? 2 : 1),
      freeBytes,
      enoughSpace: freeBytes >= requiredBytes * (needsBackup ? 2 : 1),
    },
    expiresAt: new Date(expiresAt).toISOString(),
  };
  if (!envelope.space.enoughSpace)
    envelope.conflicts.push(
      conflict("disk-space", "blocking", "STREET_LIGHT_INSUFFICIENT_SPACE"),
    );
  return {
    planId,
    expiresAt,
    directory,
    outputs,
    compileInput,
    compiledResult,
    envelope,
  };
}

async function copyVerified(source, destination, expectedSha256) {
  await fs.copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  const actual = await shaFile(destination);
  if (actual !== expectedSha256) {
    await fs.rm(destination, { force: true }).catch(() => {});
    throw new Error("Overlay copy hash mismatch.");
  }
}

async function verifiedRegularFile(file, expectedSha256) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Street-light recovery rejected a non-regular file.");
  if ((await shaFile(file)) !== expectedSha256)
    throw new Error("Street-light recovery file hash mismatch.");
  return true;
}

async function regularFileHashOrNull(file) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Street-light recovery rejected a non-regular target.");
  return shaFile(file);
}

async function replaceFromVerified(source, target, expectedSha256) {
  await verifiedRegularFile(source, expectedSha256);
  const temporary = `${target}.astral-recovery-${randomUUID()}`;
  await copyVerified(source, temporary, expectedSha256);
  try {
    await fs.rm(target, { force: true });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function expectedTransactionTarget(gameRoot, target) {
  const resolvedRoot = path.resolve(gameRoot);
  const resolvedTarget = path.resolve(target);
  const match = [TARGETS.hd, TARGETS.lod].find(
    (candidate) =>
      path.resolve(resolvedRoot, candidate.overlayRelativePath) ===
      resolvedTarget,
  );
  if (!match || !within(resolvedRoot, resolvedTarget))
    throw new Error("Street-light transaction target escaped its allowlist.");
  return resolvedTarget;
}

async function removeManagedTransactionDirectory(stateDir, directory) {
  const transactionsRoot = path.resolve(
    stateDir,
    "street-lights",
    "transactions",
  );
  const resolved = path.resolve(directory);
  if (!within(transactionsRoot, resolved))
    throw new Error("Street-light transaction cleanup escaped managed state.");
  if (
    !/^(?:commit|deactivate|street-lights)-[0-9a-f-]{36}$/i.test(
      path.basename(resolved),
    )
  )
    throw new Error("Street-light transaction directory name is invalid.");
  let stat;
  try {
    stat = await fs.lstat(resolved);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(
      "Street-light transaction cleanup rejected a reparse target.",
    );
  await fs.rm(resolved, { recursive: true, force: true });
}

function stateMatchesCommit(state, journal) {
  if (
    !state ||
    state.status !== "active" ||
    state.installId !== journal.installId ||
    state.outputs.length !== journal.outputs.length
  )
    return false;
  return journal.outputs.every((output) => {
    const relativePath = path
      .relative(path.resolve(journal.gameRoot), path.resolve(output.target))
      .replaceAll("\\", "/");
    return state.outputs.some(
      (candidate) =>
        candidate.relativePath.replaceAll("\\", "/") === relativePath &&
        candidate.sha256 === output.sha256,
    );
  });
}

async function recoverCommitTransaction({ journal, directory, state }) {
  if (
    !isUuid(journal.planId) ||
    typeof journal.gameRoot !== "string" ||
    !/^street-lights:[0-9a-f-]{36}$/i.test(String(journal.installId || ""))
  )
    throw new Error("Street-light commit journal identity is invalid.");
  if (
    !Array.isArray(journal.outputs) ||
    !Array.isArray(journal.rollbackBackups)
  )
    throw new Error("Street-light commit journal topology is invalid.");
  const outputs = journal.outputs.map((output) => {
    if (!/^[0-9a-f]{64}$/.test(String(output?.sha256 || "")))
      throw new Error("Street-light commit journal hash is invalid.");
    const target = expectedTransactionTarget(journal.gameRoot, output.target);
    const pendingPath = path.resolve(output.pendingPath);
    if (pendingPath !== `${target}.astral-pending-${journal.planId}`)
      throw new Error("Street-light pending path is invalid.");
    return { ...output, target, pendingPath };
  });
  const backups = new Map();
  for (const backup of journal.rollbackBackups) {
    const target = expectedTransactionTarget(journal.gameRoot, backup?.target);
    const backupPath = path.resolve(backup?.backup || "");
    if (
      !within(directory, backupPath) ||
      !/^[0-9a-f]{64}$/.test(String(backup?.sha256 || "")) ||
      backups.has(target)
    )
      throw new Error("Street-light rollback backup is invalid.");
    backups.set(target, { ...backup, backup: backupPath });
  }
  if (stateMatchesCommit(state, { ...journal, outputs })) {
    for (const output of outputs) {
      await verifiedRegularFile(output.target, output.sha256);
      if (await exists(output.pendingPath)) {
        await verifiedRegularFile(output.pendingPath, output.sha256);
        await fs.rm(output.pendingPath);
      }
    }
    return "finalized";
  }
  for (const output of [...outputs].reverse()) {
    const backup = backups.get(output.target);
    if (await exists(output.pendingPath)) {
      await verifiedRegularFile(output.pendingPath, output.sha256);
      await fs.rm(output.pendingPath);
    }
    const targetHash = await regularFileHashOrNull(output.target);
    if (backup) {
      await verifiedRegularFile(backup.backup, backup.sha256);
      if (targetHash && ![output.sha256, backup.sha256].includes(targetHash))
        throw new Error("Street-light recovery detected foreign target drift.");
      if (targetHash !== backup.sha256)
        await replaceFromVerified(backup.backup, output.target, backup.sha256);
    } else if (targetHash) {
      if (targetHash !== output.sha256)
        throw new Error("Street-light recovery detected an unknown target.");
      await fs.rm(output.target);
    }
  }
  return "rolled-back";
}

async function recoverDeactivateTransaction({ journal, directory, state }) {
  if (
    typeof journal.gameRoot !== "string" ||
    !Array.isArray(journal.outputs) ||
    !["disable", "remove"].includes(journal.lifecycleAction) ||
    !/^street-lights:[0-9a-f-]{36}$/i.test(String(journal.installId || ""))
  )
    throw new Error("Street-light deactivate journal is invalid.");
  const outputs = journal.outputs.map((output) => {
    const target = expectedTransactionTarget(journal.gameRoot, output?.target);
    const currentBackup = path.resolve(output?.currentBackup || "");
    if (
      !within(directory, currentBackup) ||
      !/^[0-9a-f]{64}$/.test(String(output?.managedSha256 || ""))
    )
      throw new Error("Street-light deactivate backup is invalid.");
    if (output.restoreTemporary == null) {
      if (output.restoreSha256 != null)
        throw new Error("Street-light restore hash has no restore file.");
    } else {
      const restoreMatch = new RegExp(
        `^${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.astral-restore-([0-9a-f-]{36})$`,
        "i",
      ).exec(path.resolve(output.restoreTemporary));
      if (
        !restoreMatch ||
        !isUuid(restoreMatch[1]) ||
        !/^[0-9a-f]{64}$/.test(String(output.restoreSha256 || ""))
      )
        throw new Error("Street-light restore staging path is invalid.");
    }
    return {
      ...output,
      target,
      currentBackup,
      restoreTemporary: output.restoreTemporary
        ? path.resolve(output.restoreTemporary)
        : null,
    };
  });
  const finished =
    (journal.lifecycleAction === "remove" && !state) ||
    (journal.lifecycleAction === "disable" &&
      state?.installId === journal.installId &&
      state?.status === "disabled");
  if (finished) return "finalized";
  if (
    !state ||
    state.installId !== journal.installId ||
    state.status !== "active"
  )
    throw new Error("Street-light lifecycle state cannot be recovered safely.");
  for (const output of [...outputs].reverse()) {
    await verifiedRegularFile(output.currentBackup, output.managedSha256);
    const currentHash = await regularFileHashOrNull(output.target);
    const allowedCurrentHashes = [output.managedSha256];
    if (output.restoreSha256) allowedCurrentHashes.push(output.restoreSha256);
    if (currentHash && !allowedCurrentHashes.includes(currentHash))
      throw new Error(
        "Street-light deactivate recovery detected foreign drift.",
      );
    if (currentHash !== output.managedSha256)
      await replaceFromVerified(
        output.currentBackup,
        output.target,
        output.managedSha256,
      );
    if (output.restoreTemporary && (await exists(output.restoreTemporary))) {
      await verifiedRegularFile(output.restoreTemporary, output.restoreSha256);
      await fs.rm(output.restoreTemporary);
    }
  }
  return "rolled-back";
}

export async function recoverStreetLightTransactions(stateDir) {
  const transactionsRoot = path.resolve(
    stateDir,
    "street-lights",
    "transactions",
  );
  let entries;
  try {
    entries = await fs.readdir(transactionsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const stateFile = path.join(stateDir, "street-lights", "install-state.json");
  const state = await readInstallState(stateFile);
  const recovered = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const match = /^(commit|deactivate)-([0-9a-f-]{36})$/i.exec(entry.name);
    const legacyMatch = /^street-lights-([0-9a-f-]{36})$/i.exec(entry.name);
    if (
      (!match || !isUuid(match[2])) &&
      (!legacyMatch || !isUuid(legacyMatch[1]))
    )
      continue;
    const directory = path.join(transactionsRoot, entry.name);
    const journal = await readJson(path.join(directory, "journal.json"));
    if (legacyMatch) {
      if (
        journal?.schema !== INSTALL_STATE_SCHEMA ||
        journal.phase !== "committed" ||
        journal.installId !== `street-lights:${legacyMatch[1]}` ||
        path.resolve(journal.transactionDirectory || "") !==
          path.resolve(directory) ||
        !Array.isArray(journal.previous) ||
        journal.previous.length !== 0
      )
        throw new Error(
          "Legacy street-light transaction cannot be finalized safely.",
        );
      await removeManagedTransactionDirectory(stateDir, directory);
      recovered.push({
        transactionId: legacyMatch[1],
        action: "finalized-legacy",
      });
      continue;
    }
    if (journal?.schema !== TRANSACTION_SCHEMA)
      throw new Error("Street-light transaction journal schema is invalid.");
    if (journal.phase === "committed") {
      await removeManagedTransactionDirectory(stateDir, directory);
      recovered.push({ transactionId: match[2], action: "finalized" });
      continue;
    }
    if (journal.phase !== "prepared" || journal.installId == null)
      throw new Error("Street-light transaction journal phase is invalid.");
    const action =
      match[1].toLowerCase() === "commit"
        ? await recoverCommitTransaction({ journal, directory, state })
        : await recoverDeactivateTransaction({ journal, directory, state });
    await removeManagedTransactionDirectory(stateDir, directory);
    recovered.push({ transactionId: match[2], action });
  }
  return recovered;
}

/*
 * Выходы фонарей — точкой движка (`enginePoint`, шаг 3 фазы 7): журнал, снимок «до» и подмена общие с установкой.
 * Точка нужна только для отката (переигрывания нет, см. PLAN): состояние держит `pointId` и корень точек; `previous`
 * пуст, прежние архивы — в точке.
 */
/* Флаг `ASTRAL_ENGINE_INSTALL=street-light` ставит выходы точкой движка (`enginePoint`). Без флага — прежний журнал
   `commitOverlayJournal` со своими `transactions/commit-*`: живой модуль у тестеров, паритета на Windows по точке нет. */
export async function commitOverlay(options) {
  if (engineInstallEnabled("street-light")) return commitOverlayPoint(options);
  return commitOverlayJournal(options);
}

async function commitOverlayJournal({ plan, gameRoot, stateFile, priorState }) {
  const installId = priorState?.installId || `street-lights:${randomUUID()}`;
  const transactionId = randomUUID();
  const transactionDirectory = path.join(
    path.dirname(stateFile),
    "transactions",
    `commit-${transactionId}`,
  );
  const backupDirectory = path.join(transactionDirectory, "backup");
  await fs.mkdir(backupDirectory, { recursive: true });
  const rollbackBackups = [];
  const pending = [];
  const journalFile = path.join(transactionDirectory, "journal.json");
  let journalPrepared = false;
  try {
    for (const output of plan.outputs) {
      const target = path.resolve(gameRoot, output.relativePath);
      if (!within(gameRoot, target))
        throw new Error("Overlay target escaped GTA root.");
      await fs.mkdir(path.dirname(target), { recursive: true });
      const pendingPath = `${target}.astral-pending-${plan.planId}`;
      if (await exists(pendingPath))
        throw new Error("Stale street-light pending file exists.");
      await copyVerified(output.stagedPath, pendingPath, output.sha256);
      pending.push({ target, pendingPath, output });
      if (await exists(target)) {
        const backup = path.join(backupDirectory, path.basename(target));
        const targetHash = await regularFileHashOrNull(target);
        await copyVerified(target, backup, targetHash);
        rollbackBackups.push({ target, backup, sha256: targetHash });
      }
    }
    await atomicJson(journalFile, {
      schema: TRANSACTION_SCHEMA,
      action: "commit",
      planId: plan.planId,
      gameRoot,
      installId,
      phase: "prepared",
      outputs: pending.map((item) => ({
        target: item.target,
        pendingPath: item.pendingPath,
        sha256: item.output.sha256,
      })),
      rollbackBackups,
    });
    journalPrepared = true;
  } catch (error) {
    if (!journalPrepared) {
      for (const item of pending) {
        if (await exists(item.pendingPath)) {
          await verifiedRegularFile(item.pendingPath, item.output.sha256);
          await fs.rm(item.pendingPath);
        }
      }
      await removeManagedTransactionDirectory(
        path.resolve(path.dirname(stateFile), ".."),
        transactionDirectory,
      ).catch(() => {});
    }
    throw error;
  }
  const committed = [];
  try {
    for (const item of pending) {
      if (await exists(item.target)) await fs.rm(item.target);
      await fs.rename(item.pendingPath, item.target);
      committed.push(item);
    }
  } catch (error) {
    for (const item of committed.reverse())
      await fs.rm(item.target, { force: true }).catch(() => {});
    for (const item of rollbackBackups)
      await fs.copyFile(item.backup, item.target).catch(() => {});
    throw error;
  }
  const state = {
    schema: INSTALL_STATE_SCHEMA,
    installId,
    status: "active",
    gameRoot,
    compileInputHash: plan.compiledResult.compileInputHash,
    compiledContentHash: plan.compiledResult.compiledContentHash,
    outputs: plan.outputs.map((output) => ({
      relativePath: output.relativePath,
      sha256: output.sha256,
      bytes: output.bytes,
    })),
    previous: priorState?.previous || [],
    transactionDirectory,
    installedAt: new Date().toISOString(),
  };
  await atomicJson(stateFile, state);
  await atomicJson(journalFile, { ...state, phase: "committed" });
  await removeManagedTransactionDirectory(
    path.resolve(path.dirname(stateFile), ".."),
    transactionDirectory,
  );
  return state;
}


async function commitOverlayPoint({ plan, gameRoot, stateFile, priorState, engine }) {
  const installId = priorState?.installId || `street-lights:${randomUUID()}`;
  for (const output of plan.outputs)
    if (!within(gameRoot, path.resolve(gameRoot, output.relativePath)))
      throw new Error("Overlay target escaped GTA root.");
  const point = await enginePoint({
    stateDir: engine.stateDir,
    stateFile: engine.pointStateFile,
    targetId: "street-lights",
    affected: plan.outputs.map((output) => ({
      relativePath: output.relativePath,
      livePath: path.resolve(gameRoot, output.relativePath),
      sourcePath: output.stagedPath,
      sha256: output.sha256,
    })),
    engine: {
      install: engine.install,
      edition: "Legacy",
      gameRoot,
      pointsRoot: engine.pointsRoot,
      replay: {
        module: "street-lights",
        workId: installId,
        version: "1",
        sourceDigest: `sha256:${plan.compiledResult.compiledContentHash}`,
        order: { kind: "overlay" },
      },
    },
    action: "install",
  });
  const state = {
    schema: INSTALL_STATE_SCHEMA,
    installId,
    status: "active",
    gameRoot,
    compileInputHash: plan.compiledResult.compileInputHash,
    compiledContentHash: plan.compiledResult.compiledContentHash,
    outputs: plan.outputs.map((output) => ({
      relativePath: output.relativePath,
      sha256: output.sha256,
      bytes: output.bytes,
    })),
    previous: [],
    pointId: point.pointId,
    pointsRoot: engine.pointsRoot,
    installedAt: new Date().toISOString(),
  };
  await atomicJson(stateFile, state);
  return state;
}

/*
 * Откат через точку street-light: архивы возвращаются к копиям «до» из `restore.json` точки, точка убирается. Вперёд
 * точка не переигрывается: вернуть фонари — новым планом. Живой архив уходит в парковку до подмены и возвращается
 * назад при сбое.
 */
export async function rewindOverlayPoint({ gameRoot, pointRoot, stateFile, relativePaths }) {
  const manifest = JSON.parse(await fs.readFile(path.join(pointRoot, "restore.json"), "utf8"));
  const archives = Array.isArray(manifest.archives) ? manifest.archives : [];
  const allowed = new Set(relativePaths);
  if (archives.length !== allowed.size || archives.some((item) => !allowed.has(item?.relativePath)))
    throw new Error("Точка street-light не совпадает с установкой: откат заблокирован.");
  const parkRoot = path.join(path.dirname(stateFile), `rewind-${randomUUID()}`);
  await fs.mkdir(parkRoot, { recursive: true });
  const parked = [];
  try {
    for (const [index, item] of archives.entries()) {
      const live = path.resolve(gameRoot, item.relativePath);
      if (!within(gameRoot, live)) throw new Error("Invalid managed overlay target.");
      const before = String(item.sha256Before || "").toLowerCase();
      const parkedPath = path.join(parkRoot, `${index}.rpf`);
      const hadLive = await exists(live);
      if (hadLive) await fs.rename(live, parkedPath);
      const entry = { live, parkedPath: hadLive ? parkedPath : null, restored: false };
      parked.push(entry);
      if (!before) continue;
      const backup = path.join(pointRoot, ...item.relativePath.split("/"));
      if ((await shaFile(backup)) !== before)
        throw new Error("Копия street-light в точке отката повреждена.");
      const stage = `${live}.astral-rewind-${randomUUID()}`;
      await fs.copyFile(backup, stage);
      if ((await shaFile(stage)) !== before) {
        await fs.rm(stage, { force: true });
        throw new Error("Копия street-light в точке отката не совпала при восстановлении.");
      }
      await fs.rename(stage, live);
      entry.restored = true;
    }
  } catch (error) {
    for (const entry of [...parked].reverse()) {
      if (entry.restored) await fs.rm(entry.live, { force: true });
      if (entry.parkedPath) await fs.rename(entry.parkedPath, entry.live);
    }
    await fs.rm(parkRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  await fs.rm(parkRoot, { recursive: true, force: true });
  await fs.rm(pointRoot, { recursive: true, force: true });
}

/* Выключение по точке: проверка дрейфа, затем перемотка. Состояние точки — `pointId` и `pointsRoot`. */
async function deactivateOverlayPoint({ state, capability, stateFile }) {
  for (const output of state.outputs) {
    const target = path.resolve(capability.gameRoot, output.relativePath);
    if (!within(capability.gameRoot, target)) throw new Error("Invalid managed overlay target.");
    if (!(await exists(target)) || (await shaFile(target)) !== output.sha256)
      throw new Error("Managed street-light overlay drifted; automatic lifecycle action blocked.");
  }
  await rewindOverlayPoint({
    gameRoot: capability.gameRoot,
    pointRoot: path.join(state.pointsRoot, state.pointId),
    stateFile,
    relativePaths: state.outputs.map((output) => output.relativePath),
  });
  return null;
}

export async function deactivateManagedOverlay(options) {
  if (!["disable", "remove"].includes(options.lifecycleAction))
    throw new Error("Invalid street-light lifecycle action.");
  if (options.state.pointId) return deactivateOverlayPoint(options);
  return deactivateLegacyOverlay(options);
}

async function deactivateLegacyOverlay({
  state,
  capability,
  stateFile,
  lifecycleAction,
}) {
  if (!["disable", "remove"].includes(lifecycleAction))
    throw new Error("Invalid street-light lifecycle action.");
  const removals = [];
  for (const output of state.outputs) {
    const target = path.resolve(capability.gameRoot, output.relativePath);
    if (!within(capability.gameRoot, target))
      throw new Error("Invalid managed overlay target.");
    if (!(await exists(target)) || (await shaFile(target)) !== output.sha256)
      throw new Error(
        "Managed street-light overlay drifted; automatic lifecycle action blocked.",
      );
    const previous = state.previous.find(
      (item) => path.resolve(item.target) === target,
    );
    if (previous) {
      if (!within(path.dirname(stateFile), previous.backup))
        throw new Error("Street-light backup escaped managed state root.");
      if ((await shaFile(previous.backup)) !== previous.sha256)
        throw new Error("Street-light backup hash mismatch.");
      removals.push({ target, previous });
    } else removals.push({ target, previous: null });
  }
  const transactionId = randomUUID();
  const removeTransaction = path.join(
    path.dirname(stateFile),
    "transactions",
    `deactivate-${transactionId}`,
  );
  await fs.mkdir(removeTransaction, { recursive: true });
  const prepared = [];
  let journalPrepared = false;
  try {
    for (const [index, item] of removals.entries()) {
      const output = state.outputs.find(
        (candidate) =>
          path.resolve(capability.gameRoot, candidate.relativePath) ===
          item.target,
      );
      const currentBackup = path.join(
        removeTransaction,
        `${index}-${path.basename(item.target)}.current`,
      );
      try {
        await fs.link(item.target, currentBackup);
      } catch {
        await copyVerified(item.target, currentBackup, output.sha256);
      }
      if ((await shaFile(currentBackup)) !== output.sha256)
        throw new Error("Street-light lifecycle rollback backup mismatch.");
      let restoreTemporary = null;
      if (item.previous) {
        restoreTemporary = `${item.target}.astral-restore-${randomUUID()}`;
        await copyVerified(
          item.previous.backup,
          restoreTemporary,
          item.previous.sha256,
        );
      }
      prepared.push({
        ...item,
        output,
        currentBackup,
        restoreTemporary,
      });
    }
    const journalFile = path.join(removeTransaction, "journal.json");
    await atomicJson(journalFile, {
      schema: TRANSACTION_SCHEMA,
      action: "deactivate",
      lifecycleAction,
      installId: state.installId,
      gameRoot: capability.gameRoot,
      phase: "prepared",
      outputs: prepared.map((item) => ({
        target: item.target,
        managedSha256: item.output.sha256,
        currentBackup: item.currentBackup,
        restoreTemporary: item.restoreTemporary,
        restoreSha256: item.previous?.sha256 || null,
      })),
    });
    journalPrepared = true;
    try {
      for (const item of prepared) {
        await fs.rm(item.target);
        if (item.restoreTemporary)
          await fs.rename(item.restoreTemporary, item.target);
      }
    } catch (error) {
      for (const item of [...prepared].reverse()) {
        if (await exists(item.target))
          await fs.rm(item.target, { force: true }).catch(() => {});
        const rollbackPending = `${item.target}.astral-rollback-${randomUUID()}`;
        await copyVerified(
          item.currentBackup,
          rollbackPending,
          item.output.sha256,
        ).catch(() => {});
        if (await exists(rollbackPending))
          await fs.rename(rollbackPending, item.target).catch(() => {});
      }
      throw error;
    }
    return { directory: removeTransaction, journalFile };
  } catch (error) {
    if (!journalPrepared) {
      for (const item of prepared) {
        if (item.restoreTemporary)
          await fs.rm(item.restoreTemporary, { force: true }).catch(() => {});
      }
      await removeManagedTransactionDirectory(
        path.resolve(path.dirname(stateFile), ".."),
        removeTransaction,
      ).catch(() => {});
    }
    throw error;
  }
}

async function finalizeDeactivateTransaction(stateDir, transaction) {
  const journal = await readJson(transaction.journalFile);
  await atomicJson(transaction.journalFile, {
    ...journal,
    phase: "committed",
  });
  await removeManagedTransactionDirectory(stateDir, transaction.directory);
}

export function createStreetLightCustomizerService({
  stateDir,
  listGames,
  gameProcessRunning,
  installPrebuilt = installRpfPrebuilt,
  pointsRoot = path.join(stateDir, "street-lights", "points"),
}) {
  const plans = new Map();
  const stateFile = path.join(stateDir, "street-lights", "install-state.json");
  /* Точки фонарей: журнал движка общий, состояние точек — свой файл; корень точек — не цепочка update.rpf. */
  const pointStateFile = path.join(stateDir, "street-lights", "points-state.json");
  const engine = { stateDir, install: installPrebuilt, pointsRoot, pointStateFile };
  let recovery = null;
  const context = async () => {
    /* Восстановление при старте: журнал движка — общий для точек фонарей; свой журнал — только для старых записей. */
    recovery ||= Promise.all([recoverStreetLightTransactions(stateDir), recoverPendingTransactions({ stateDir })]);
    await recovery;
    await pruneOrphanedPlanDirectories(stateDir, new Set(plans.keys()));
    const [registry, helper, game] = await Promise.all([
      loadRegistry(),
      getRpfHelperIdentity(),
      discoverLegacyGame(listGames),
    ]);
    const capability = await inspectCapability({
      game,
      registry,
      helper,
      stateFile,
    });
    return { registry, helper, game, capability };
  };
  const prune = () => {
    const now = Date.now();
    for (const [planId, plan] of plans)
      if (plan.expiresAt <= now) plans.delete(planId);
  };
  return Object.freeze({
    async capabilities() {
      const { registry, capability, helper, game } = await context();
      return {
        available: true,
        applyReady: capability.applyReady,
        reason: capability.applyReady
          ? null
          : capability.conflicts.find((item) => item.severity === "blocking")
              ?.reasonCode,
        profileId: registry.profile.profileId,
        families: registry.profile.families.map((family) => ({
          familyId: family.familyId,
          label: family.label,
          capabilities: family.capabilities,
          effectiveOccurrenceCount:
            family.coverage.expectedInstanceOccurrenceCount,
        })),
        buildId: game.buildId,
        helperSha256: helper.sha256,
        conflicts: capability.conflicts,
        installed: capability.state
          ? {
              installId: capability.state.installId,
              status: capability.state.status,
            }
          : null,
      };
    },
    async plan(input) {
      prune();
      const { registry, helper, capability } = await context();
      if (input.projectTarget !== "gta5-legacy-story")
        throw new Error(
          "Static street-light Apply поддерживает только GTA V Legacy.",
        );
      const module = normalizeStreetLightModule(
        input.module,
        input.projectTarget,
      );
      const currentInstallId = capability.state?.installId || null;
      if (input.replaceInstallId !== currentInstallId)
        throw new Error(
          "Street-light lifecycle state changed; refresh capabilities and create a new Plan.",
        );
      if (!capability.applyReady) {
        const reasons = capability.conflicts
          .filter((item) => item.severity === "blocking")
          .map((item) => item.reasonCode)
          .join(", ");
        throw new Error(`Street-light Apply заблокирован: ${reasons}`);
      }
      const planId = randomUUID();
      let plan;
      try {
        plan = await compilePlan({
          planId,
          module,
          projectTarget: input.projectTarget,
          capability,
          registry,
          helper,
          stateDir,
        });
      } catch (error) {
        await removeManagedPlanDirectory(
          stateDir,
          path.join(stateDir, "street-lights", "plans", planId),
        ).catch(() => {});
        throw error;
      }
      const receipt = randomBytes(32);
      plans.set(plan.planId, {
        ...plan,
        projectId: input.projectId,
        receipt,
        receiptHash: shaBytes(receipt),
        gameRoot: capability.gameRoot,
        baseStateHash: shaCanonical({
          profile: registry.profileSha256,
          helper: helper.sha256,
          active: capability.state,
        }),
      });
      return { compiledResult: plan.compiledResult, envelope: plan.envelope };
    },
    async apply(planId) {
      prune();
      const plan = plans.get(planId);
      plans.delete(planId);
      if (
        !plan ||
        !(plan.receipt instanceof Buffer) ||
        plan.receipt.length !== 32
      )
        throw new Error(
          "Prepared street-light plan отсутствует, истёк или уже использован.",
        );
      const { registry, helper, capability, game } = await context();
      if (await gameProcessRunning(game))
        throw new Error("Закройте GTA V перед применением фонарей.");
      const stateHash = shaCanonical({
        profile: registry.profileSha256,
        helper: helper.sha256,
        active: capability.state,
      });
      if (!capability.applyReady || stateHash !== plan.baseStateHash)
        throw new Error(
          "Build, helper или installation state изменились после Plan.",
        );
      const state = await commitOverlay({
        plan,
        gameRoot: capability.gameRoot,
        stateFile,
        priorState: capability.state,
        engine,
      });
      await removeManagedPlanDirectory(stateDir, plan.directory).catch(
        () => {},
      );
      return {
        installId: state.installId,
        kind: "native-street-lights-v1",
        status: "active",
        compiledContentHash: state.compiledContentHash,
        installedAt: state.installedAt,
      };
    },
    async remove(installId) {
      const { capability, game } = await context();
      const state = capability.state;
      if (!state || state.installId !== installId)
        throw new Error("Main-issued street-light installId не найден.");
      if (await gameProcessRunning(game))
        throw new Error("Закройте GTA V перед удалением слоя фонарей.");
      if (state.status === "active")
        await deactivateManagedOverlay({
          state,
          capability,
          stateFile,
          lifecycleAction: "remove",
        }).then(async (transaction) => {
          await fs.rm(stateFile);
          if (transaction) await finalizeDeactivateTransaction(stateDir, transaction);
        });
      else {
        for (const output of state.outputs) {
          const target = path.resolve(capability.gameRoot, output.relativePath);
          if (await exists(target))
            throw new Error(
              "Disabled street-light state has an unexpected target overlay.",
            );
        }
      }
      if (state.status === "disabled") await fs.rm(stateFile);
      return {
        installId,
        kind: "native-street-lights-v1",
        status: "rolled-back",
        removedAt: new Date().toISOString(),
      };
    },
    async disable(installId) {
      const { capability, game } = await context();
      const state = capability.state;
      if (!state || state.installId !== installId)
        throw new Error("Main-issued street-light installId не найден.");
      if (state.status === "disabled")
        return {
          installId,
          kind: "native-street-lights-v1",
          status: "disabled",
          disabledAt: state.disabledAt || null,
        };
      if (await gameProcessRunning(game))
        throw new Error("Закройте GTA V перед отключением слоя фонарей.");
      const transaction = await deactivateManagedOverlay({
        state,
        capability,
        stateFile,
        lifecycleAction: "disable",
      });
      const disabledAt = new Date().toISOString();
      await atomicJson(stateFile, {
        ...state,
        status: "disabled",
        disabledAt,
      });
      if (transaction) await finalizeDeactivateTransaction(stateDir, transaction);
      return {
        installId,
        kind: "native-street-lights-v1",
        status: "disabled",
        disabledAt,
      };
    },
  });
}
