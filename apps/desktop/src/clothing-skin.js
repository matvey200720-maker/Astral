import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  CLOTHING_SKIN_CAPABILITIES,
  CLOTHING_SKIN_DLC_TARGET,
  CLOTHING_SKIN_FOLDERS,
  canonicalManifest,
  clothingSkinSlot,
  clothingSkinSourceDigest,
  engineInstallEnabled,
  installLocalClothingSkinPackage,
  planPackage,
  uninstallPackage,
} from "@modovik/install-engine";
import { variantGender } from "@modovik/clothing/gender";
import { callNativeEngine } from "./native-engine.js";
import {
  composeRpfArchive,
  inspectYtd,
  installRpfPrebuilt,
  patchYtdTextures,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { provisionClothingInfrastructure } from "./clothing-dlc-provisioner.js";
import { nativeRestorePointsRoot } from "./native-restore-chain.js";
import { clothingSkinReplayRecord } from "./clothing-skin-replay.js";
import { clothingContainerOptions } from "./clothing-container-options.js";
import { clothingUpdateRouteEnabled, translateClothingFiles } from "@modovik/install-engine/clothing-update-route.js";
import { clothingSkinNotes } from "./clothing-write-note.js";
import { clothingVisibilityNotes } from "./clothing-registration-check.js";
import {
  chooseGameTexture,
  clothingArchiveTools,
  clothingGameRoot,
  clothingSource,
  listGameClothing,
  textureByIndex,
  textureIndexOf,
  texturePlaceOf,
} from "./clothing-models.js";
import { atomicWrite, bakeYtd, normalizePaintedTextures } from "./ytd-bake.js";

const MESSAGES = {
  CLOTHING_SKIN_SLOT: "Эту вещь в игру не поставить: она не из набора мужского свободного персонажа.",
  CLOTHING_SKIN_FEMALE: "Покраска женской вещи едет в игру заменой вещи сервера («Сделать заменёнку»): " +
    "прямая подмена мужской текстуры её не ставит.",
  CLOTHING_SKIN_VARIANT: "Такой вещи в игре нет.",
  CLOTHING_SKIN_TEXTURE: "У этой вещи в игре нет текстуры цвета — покраске некуда лечь.",
  CLOTHING_SKIN_MOD: "Непонятная покраска.",
};
const REMOVABLE_PREFIXES = [
  "local-clothing-skin-",
  "local-clothing-replace-",
  "local-server-tattoo-",
  "local-tattoo-paint-",
];
const WORK_SEGMENTS = ["clothing-skins", "work"];
const PACKAGE_SEGMENTS = ["clothing-skins", "packages"];
const WRITE_POLICY = { allowGameRootWrites: true, requireSignature: false };
const BAKE_FLAGS = { missing: "нет в текстуре вещи", sole: true };
const DLC_PARTS = {
  rpfComposer: composeRpfArchive,
  dlcListProvider: provideLegacyDlcList,
  contentXmlProvider: provideUpdateContentXml,
};

const swallow = () => {};

function sha256Hex(data) {
  const hash = createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}

const describeSkip = (entry) => `${entry.texture} — ${entry.reason}`;
const modIdOf = (conflict) => conflict.modId;

function skinFail(code, text) {
  const error = new Error(text === undefined ? MESSAGES[code] : text);
  error.code = code;
  return error;
}

/** Стрелка без параметров: всё, что ей передадут, игнорируется. */
function safetyOf(dependencies, game) {
  const named = { assertRuntimeSafety: () => dependencies.assertRuntimeSafety?.(game) };
  return named.assertRuntimeSafety;
}

async function confirmGameReady(dependencies, gameRoot) {
  return dependencies.assertGameReady?.(gameRoot, { mutate: true });
}

// --- запрос окна: первые поля, затем остальные по таблице чтения ---

const REQUEST_READERS = [
  ["gameRoot", (input) => clothingGameRoot(input)],
  ["targetId", (input) => String(input?.targetId || "default")],
  ["name", (input) => String(input?.name || "Покраска").slice(0, 80)],
  ["textures", (input) => normalizePaintedTextures(input?.textures, "CLOTHING_SKIN")],
  ["texture", (input) => textureIndexOf(input?.texture)],
];

const folderOf = (source) => path.posix.basename(String(source.folder || ""));

function pickSource(slot) {
  const source = clothingSource(slot);
  const allowed = !source.fixed && CLOTHING_SKIN_FOLDERS.includes(folderOf(source));
  if (!allowed) throw skinFail("CLOTHING_SKIN_SLOT");
  return { source, folder: folderOf(source) };
}

// Порядок важен: женский номер отвергается раньше проверки диапазона.
const VARIANT_RULES = [
  ["CLOTHING_SKIN_FEMALE", (variant) => variantGender(variant) === "female"],
  ["CLOTHING_SKIN_VARIANT", (variant) => !Number.isInteger(variant) || variant < 0 || variant > 999],
];

function pickVariant(input) {
  const variant = Number(input?.variant);
  for (const [code, rejects] of VARIANT_RULES) {
    if (rejects(variant)) throw skinFail(code);
  }
  return variant;
}

export function normalizeClothingSkinRequest(input) {
  const typedSlot = input?.slot || "";
  const slot = String(typedSlot);
  const { source, folder } = pickSource(slot);
  const request = { slot, source, folder, variant: pickVariant(input) };
  for (const [field, read] of REQUEST_READERS) request[field] = read(input);
  return request;
}

// --- манифест пакета ---

function identityOf(digest) {
  const short = digest.slice(0, 12);
  return { id: `local-clothing-skin-${short}`, version: `1.0.0-${short}` };
}

function importRecord(item) {
  const segments = item.entry.split("/");
  const source = `payload/${segments.pop()}`;
  const { entry, size, sha256 } = item;
  return { source, target: CLOTHING_SKIN_DLC_TARGET, action: "import", entry, size, sha256 };
}

function fixedManifestFields() {
  return {
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    gameplayChanges: false,
    capabilities: [...CLOTHING_SKIN_CAPABILITIES],
  };
}

export function buildClothingSkinManifest({ component, variant, name, file }) {
  const digest = clothingSkinSourceDigest([file]);
  const manifest = { ...identityOf(digest) };
  manifest.name = `Astral paint: ${name}`.slice(0, 120);
  Object.assign(manifest, fixedManifestFields());
  manifest.slots = [clothingSkinSlot(component, variant)];
  manifest.clothingSkin = { schemaVersion: 1, component, variant, sourceDigest: `sha256:${digest}` };
  manifest.files = [importRecord(file)];
  return manifest;
}

// --- сборка пакета ---

const readTextures = (input, output, context) => {
  return callNativeEngine("extract-textures", { input, output }, context);
};

function defaultSkinTools(stateDir) {
  const extras = { inspectYtd, patchYtd: patchYtdTextures, readTextures };
  return { ...clothingArchiveTools(stateDir), ...extras };
}

function whyNothingBaked(skipped) {
  if (!skipped.length) return "Покраска не легла на текстуру вещи.";
  return `Покраска не легла на текстуру вещи: ${skipped.map(describeSkip).join("; ")}.`;
}

function itemFault(item) {
  if (!item) return "CLOTHING_SKIN_VARIANT";
  return item.texture ? null : "CLOTHING_SKIN_TEXTURE";
}

/** Одна сборка: общее состояние в полях, шаги — методы в порядке вызова. */
class SkinJob {
  constructor(input, stateDir, tools, context) {
    this.stateDir = stateDir;
    this.context = context;
    this.resolved = Object.assign({}, defaultSkinTools(stateDir), tools);
    this.request = normalizeClothingSkinRequest(input);
  }

  async findItem() {
    const { request, stateDir, context, resolved } = this;
    const wanted = { gameRoot: request.gameRoot, slot: request.slot };
    const { variants } = await listGameClothing(wanted, context, stateDir, resolved);
    const wantedVariant = request.variant;
    const item = variants.find((entry) => entry.variant === wantedVariant);
    const fault = itemFault(item);
    if (fault) throw skinFail(fault);
    this.item = item;
  }

  placeWork() {
    this.work = path.join(this.stateDir, ...WORK_SEGMENTS, randomUUID());
    this.place = texturePlaceOf(this.request.source, this.item);
    this.prefix = this.place.archive.replace(/\.rpf$/i, "");
  }

  async pickTexture() {
    const { request, item, place, work, context, resolved } = this;
    const indexed = textureByIndex(item, request.texture);
    if (indexed) return indexed;
    const query = { gameRoot: request.gameRoot, source: place, item };
    return chooseGameTexture(query, context, resolved, work);
  }

  async readSource(texture) {
    const { request, place, prefix, work, context, resolved } = this;
    const output = path.join(work, "source", texture);
    const progress = { phase: "search", archive: place.archive };
    const folder = path.dirname(output);
    await fs.mkdir(folder, { recursive: true });
    context?.onProgress?.(progress);
    const entry = `${prefix}:/${place.folder}/${texture}`;
    await resolved.read({ gameRoot: request.gameRoot, entry, output }, context);
    return output;
  }

  async bake(texture, input) {
    const { request, work, context, resolved } = this;
    const task = { input, file: texture };
    task.textures = request.textures;
    task.work = work;
    task.gameRoot = request.gameRoot;
    Object.assign(task, BAKE_FLAGS);
    const { bytes, baked, skipped } = await bakeYtd(task, resolved, context);
    if (bytes) return { bytes, baked, skipped };
    throw skinFail("CLOTHING_SKIN_NOTHING", whyNothingBaked(skipped));
  }

  async pack(texture, outcome) {
    const { request, stateDir } = this;
    const { bytes, baked, skipped } = outcome;
    const entry = `astral_stream_00.rpf/${request.folder}/${texture}`;
    const file = { entry, size: bytes.length, sha256: sha256Hex(bytes) };
    const { source, variant, name } = request;
    const manifest = buildClothingSkinManifest({ component: source.component, variant, name, file });
    const { sourceDigest } = manifest.clothingSkin;
    const fingerprint = sourceDigest.slice(7, 19);
    const directory = path.join(stateDir, ...PACKAGE_SEGMENTS, fingerprint);
    const payloadFile = path.join(directory, "payload", texture);
    await atomicWrite(payloadFile, bytes);
    const manifestHash = "sha256:" + sha256Hex(Buffer.from(canonicalManifest(manifest)));
    return Object.assign({ request, directory, manifest, manifestHash }, { texture, baked, skipped });
  }

  async run() {
    await this.findItem();
    this.placeWork();
    try {
      const texture = await this.pickTexture();
      const sourcePath = await this.readSource(texture);
      const outcome = await this.bake(texture, sourcePath);
      return await this.pack(texture, outcome);
    } finally {
      await fs.rm(this.work, { recursive: true, force: true }).catch(swallow);
    }
  }
}

export async function buildClothingSkin(input, stateDir, tools = {}, context = null) {
  return new SkinJob(input, stateDir, tools, context).run();
}

// --- установка ---

function conflictIds(plan) {
  const ids = (plan.conflicts || []).map(modIdOf);
  return [...new Set(ids)].sort();
}

function engineSection(dependencies, built, gameRoot) {
  if (!engineInstallEnabled("clothing-skin")) return {};
  const engineInstall = { install: dependencies.installPrebuilt ?? installRpfPrebuilt, edition: "Legacy", gameRoot };
  engineInstall.pointsRoot = nativeRestorePointsRoot();
  engineInstall.multi = true;
  engineInstall.replay = clothingSkinReplayRecord(built);
  return { engineInstall };
}

/** Установка собранного пакета: шаги по порядку, состояние в полях. */
class Installation {
  constructor(dependencies, stateDir, built) {
    this.dependencies = dependencies;
    this.stateDir = stateDir;
    this.built = built;
    this.gameRoot = built.request.gameRoot;
    this.targetId = built.request.targetId;
  }

  async confirmGame() {
    const game = await confirmGameReady(this.dependencies, this.gameRoot);
    this.safety = safetyOf(this.dependencies, game);
  }

  /* Покраска целиком уходит в контейнер update.rpf (`ASTRAL_CLOTHING_VIA_UPDATE`, путь `<папка педа>/<файл>`): пакет одежды не нужен, хост не готовится. Базовый реквизит (`base-props`) в контейнер не кладётся — тогда всё как раньше. */
  goesToContainer() {
    const env = this.dependencies.env || process.env;
    return clothingUpdateRouteEnabled(env) && translateClothingFiles({ files: this.built.manifest.files }).all;
  }

  async provision() {
    if (this.goesToContainer()) return;
    const { dependencies, gameRoot, targetId, stateDir, safety } = this;
    const request = { gameRoot, targetId, edition: "Legacy", stateDir, assertRuntimeSafety: safety, activate: false };
    await (dependencies.provision || provisionClothingInfrastructure)(request);
  }

  async plan() {
    const { dependencies, built, gameRoot, targetId, stateDir } = this;
    this.base = {
      manifest: built.manifest,
      packageRoot: built.directory,
      gameRoot,
      targetId,
      edition: "Legacy",
      stateDir,
      ...WRITE_POLICY,
      rpfProbe: probeRpfArchive,
    };
    /* В контейнер план по хосту не нужен (хоста нет): прежнюю покраску той же вещи находит установка (`previousSkinsOf`). */
    this.planAnswer = this.goesToContainer() ? { conflicts: [] } : await (dependencies.plan || planPackage)(this.base);
  }

  async install() {
    const { dependencies, built, gameRoot } = this;
    /* Маршрут контейнера: настройки установки (`clothingUpdateRoute`, дозапись) — те же, что у заменёнок (`clothing-replace.js`); точка движка `clothing-skin` с ним не берётся. */
    this.container = await clothingContainerOptions(this.stateDir, dependencies, dependencies.env || process.env);
    const engine = this.container.clothingUpdateRoute ? {} : engineSection(dependencies, built, gameRoot);
    this.installed = await (dependencies.install || installLocalClothingSkinPackage)(this.installRequest(engine));
  }

  installRequest(engine) {
    const { dependencies, base, planAnswer, safety } = this;
    return {
      ...base,
      replaceModIds: conflictIds(planAnswer),
      ...DLC_PARTS,
      assertRuntimeSafety: safety,
      onProgress: dependencies.onProgress,
      ...engine,
      ...(this.container || {}),
    };
  }

  answer() {
    const { slot, variant } = this.built.request;
    const { texture, baked, skipped } = this.built;
    const modId = this.built.manifest.id;
    return { ...this.installed, modId, slot, variant, texture, baked, skipped, restartRequired: true };
  }
}

export async function applyClothingSkin(input, stateDir, dependencies = {}) {
  const sink = dependencies.onProgress;
  const context = { onProgress: sink };
  const built = await buildClothingSkin(input, stateDir, dependencies.tools || {}, context);
  const job = new Installation(dependencies, stateDir, built);
  await job.confirmGame();
  await job.provision();
  await job.plan();
  await job.install();
  /* Журнал (13.11.2026): куда легла покраска — архив, путь записи, ped/компонент/номер. */
  for (const note of clothingSkinNotes(built.manifest)) dependencies.journal?.(note);
  if (dependencies.journal)
    for (const note of await clothingVisibilityNotes(built.request.gameRoot, {
      ...(dependencies.checkRegistration ? { checkRegistration: dependencies.checkRegistration } : {}),
      ...(dependencies.readRage ? { readRage: dependencies.readRage } : {}),
    }))
      dependencies.journal(note);
  return job.answer();
}

// --- снятие ---

function isRemovableMod(modId) {
  for (const prefix of REMOVABLE_PREFIXES) {
    if (modId.startsWith(prefix)) return /^[0-9a-f]{12}$/.test(modId.slice(prefix.length));
  }
  return false;
}

function removalRequest(modId, input, stateDir, dependencies, game) {
  const request = { modId, targetId: String(input?.targetId || "default"), stateDir };
  Object.assign(request, DLC_PARTS);
  request.assertRuntimeSafety = safetyOf(dependencies, game);
  request.onProgress = dependencies.onProgress;
  return request;
}

export async function removeClothingSkin(input, stateDir, dependencies = {}) {
  const typedMod = input?.modId || "";
  const modId = String(typedMod);
  if (!isRemovableMod(modId)) throw skinFail("CLOTHING_SKIN_MOD");
  const enteredRoot = input?.gameRoot || "";
  const gameRoot = path.resolve(String(enteredRoot));
  const game = await confirmGameReady(dependencies, gameRoot);
  return (dependencies.uninstall || uninstallPackage)(removalRequest(modId, input, stateDir, dependencies, game));
}
