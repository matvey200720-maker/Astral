import path from "node:path";
import { createHash } from "node:crypto";
import * as rpf from "@modovik/rpf7/node";
import * as trust from "@modovik/install-engine/server-tattoo-manifest-trust.js";
import * as engine from "@modovik/install-engine";
import { installLocalServerTattooPackage } from "@modovik/install-engine/local-packages.js";
import * as drawable from "@modovik/rage-drawable";
import { decorationModelGlb } from "@modovik/clothing/model";
import * as clothing from "./server-clothing.js";
import * as gunpackPaint from "./gunpack-paint.js";
import * as bake from "./ytd-bake.js";
import * as composer from "./rpf-composer.js";
import { clothingContainerOptions } from "./clothing-container-options.js";
import { overlayInstallVisibility } from "./overlay-install-visibility.js";
import * as provisioner from "./clothing-dlc-provisioner.js";
import * as restoreChain from "./native-restore-chain.js";
import * as replay from "./server-tattoo-replay.js";
import * as applyFlag from "./server-tattoo-flag.js";

export { serverTattooApplyEnabled } from "./server-tattoo-flag.js";

const GLB_CEILING = 48 * 1024 * 1024;
const DECODE_CEILING = 2048;
const PAINT_NAME_RULE = /^[\w.-]{1,96}$/;
const EDITION = "Legacy";

const PLACE = "SERVER_TATTOO_PLACE";
const PICTURE = "SERVER_TATTOO_PICTURE";
const FORMAT = "SERVER_TATTOO_FORMAT";
const FLAG = "SERVER_TATTOO_FLAG";

function refuse(code, message) {
  const failure = new Error(message);
  failure.code = code;
  return failure;
}

function sha256Hex(data) {
  const hash = createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}

// ------------------------------------------------------------ где лежит тату

const normalFolder = (folder) => path.resolve(folder).toLowerCase();

function folderMatcher(input) {
  const wanted = normalFolder(String(input?.directory || ""));
  return (folder) => normalFolder(folder) === wanted;
}

function requireFolder(hit) {
  if (hit) return hit;
  throw refuse(PLACE, "Этой папки сервера у клиента RAGE нет — обнови список тату.");
}

// Корень — разрешённая папка сервера (в списке она может быть записана с косой на конце).
function pickArchive(input, directory) {
  const root = path.resolve(directory);
  const name = String(input?.archive || "");
  const archive = path.resolve(root, name);
  const inside = archive.startsWith(root + path.sep);
  if (!inside) throw refuse(PLACE, "Архив тату — вне папки сервера.");
  return archive;
}

function pickEntry(input) {
  const entry = String(input?.entry || "").replace(/\\/g, "/");
  const segments = entry.split("/");
  const isDictionary = entry.toLowerCase().endsWith(".ytd");
  if (!isDictionary || segments.includes("..")) {
    throw refuse(PLACE, "Картинка тату — не словарь .ytd.");
  }
  return entry;
}

const requireTxd = (txd) => {
  if (txd) return txd;
  throw refuse(PLACE, "У тату нет годного имени.");
};

// Текстовое поле ответа: то, что во вводе, а когда пусто — запасное значение.
const textOr = (value, fallback) => String(value || fallback);

// Текстовые поля ответа: то, что во вводе, а когда пусто — имя словаря (или пустая строка для collection).
function describePlace(input, found) {
  return {
    ...found,
    texture: textOr(input?.texture, found.txd),
    collection: textOr(input?.collection, ""),
    name: textOr(input?.name, found.txd),
  };
}

export async function locateServerTattoo(input, options = {}) {
  const roots = options.roots === undefined ? clothing.rageRoots() : options.roots;
  const folders = await clothing.serverFolders(roots);
  const directory = requireFolder(folders.find(folderMatcher(input)));
  const file = pickArchive(input, directory);
  const entry = pickEntry(input);
  const txd = requireTxd(trust.serverTattooTxd(input?.txd));
  return describePlace(input, { directory, file, entry, txd });
}

// ------------------------------------------------------------ картинка в словаре

export function tattooTexture(bytes, texture) {
  const dictionary = drawable.readTextureDictionary(bytes, { inflateRaw: rpf.inflateRawNode });
  const refs = [...dictionary].filter((ref) => ref.format);
  const sameName = (ref) => String(ref.name).toLowerCase() === texture.toLowerCase();
  const exact = refs.find(sameName);
  if (exact) return exact;
  return refs.length === 1 ? refs[0] : null;
}

// ------------------------------------------------------------ инструменты

function archiveKeys(keysDirectory) {
  if (!keysDirectory) return null;
  return rpf.keysFromDirectory(keysDirectory).catch(() => null);
}

// Закрывает архив после работы с ним, даже если работа отказала.
async function closeAfter(archive, work) {
  try {
    const result = await work();
    return result;
  } finally {
    await archive.close?.();
  }
}

async function readYtd(place, options) {
  const keys = await archiveKeys(options.keysDirectory);
  const archive = await rpf.openRpfFile(place.file, { keys });
  const content = await closeAfter(archive, () => archive.read(place.entry));
  return Buffer.from(content);
}

function decode(ref) {
  return drawable.decodeTextureRef(ref, { maxSize: DECODE_CEILING });
}

const DEFAULT_TOOLS = { readYtd, texture: tattooTexture, decode, paint: gunpackPaint.paintWeaponFiles };

// Подмена инструментов лежит в том же объекте options, что и roots с keysDirectory.
function toolsFrom(options) {
  return Object.assign({}, DEFAULT_TOOLS, options.tools);
}

async function loadPicture(tools, place, options) {
  const bytes = await tools.readYtd(place, options);
  const ref = tools.texture(bytes, place.texture);
  if (!ref) throw refuse(PICTURE, `В словаре ${place.txd}.ytd нет картинки тату, которую можно прочесть.`);
  return { bytes, ref };
}

// ------------------------------------------------------------ лист для студии

// Поля ответа берутся из ссылки словаря сервера, а не из картинки после decode.
function describePicture(ref, glb) {
  const dimensions = Object.fromEntries(["format", "width", "height"].map((field) => [field, ref[field]]));
  return {
    texture: ref.name,
    ...dimensions,
    size: glb.length,
    bytes: new Uint8Array(glb).buffer,
  };
}

async function renderSheet(tools, place, ref) {
  const naming = { texture: ref.name, name: place.name };
  const glb = await decorationModelGlb(tools.decode(ref), naming);
  if (glb.length > GLB_CEILING) {
    throw refuse(PICTURE, "Картинка тату слишком большая.");
  }
  return glb;
}

export async function readServerTattooModel(input, options = {}) {
  const tools = toolsFrom(options);
  const place = await locateServerTattoo(input, options);
  const picture = await loadPicture(tools, place, options);
  const glb = await renderSheet(tools, place, picture.ref);
  return describePicture(picture.ref, glb);
}

// ------------------------------------------------------------ пакет для «Применить»

function nothingBaked(reason) {
  const text = "Картинку тату не перезаписать";
  return refuse(FORMAT, reason ? `${text}: ${reason}.` : `${text}.`);
}

// Альфа тату — сам рисунок, поэтому покраска несёт свою, а не серверную.
async function bakeOverlay(tools, place, painted, picture) {
  const { ref, bytes } = picture;
  const overlay = { texture: ref.name, png: painted.png, opaque: false };
  const result = await tools.paint([{ name: `${place.txd}.ytd`, bytes }], [overlay]);
  if (!result.baked.length) {
    throw nothingBaked(result.skipped[0]?.reason);
  }
  const payload = Buffer.from(result.files[0].bytes);
  return { payload, baked: result.baked };
}

async function storePackage(input, stateDir, place, payload) {
  const title = `${input?.name || "Тату"} → ${place.name}`;
  const file = { size: payload.length, sha256: sha256Hex(payload) };
  const manifest = trust.serverTattooManifest({ tattoo: place, title, file });
  // Двенадцать знаков id — имя папки, по которому уборка кэша узнаёт пакеты.
  const packages = path.join(stateDir, "server-tattoos", "packages");
  const directory = path.join(packages, manifest.id.slice(-12));
  const target = path.join(directory, "payload", `${place.txd}.ytd`);
  await bake.atomicWrite(target, payload);
  return { directory, manifest };
}

function packageAnswer(input, stored, baked) {
  const manifestHash = sha256Hex(engine.canonicalManifest(stored.manifest));
  const answer = { directory: stored.directory, manifest: stored.manifest };
  answer.manifestHash = `sha256:${manifestHash}`;
  answer.gameRoot = path.resolve(String(input?.gameRoot || ""));
  answer.targetId = String(input?.targetId || "default");
  answer.baked = baked;
  return answer;
}

export async function buildServerTattooPackage(input, stateDir, options = {}) {
  const tools = toolsFrom(options);
  const place = await locateServerTattoo(input?.tattoo, options);
  const [painted] = bake.normalizePaintedTextures(input?.textures, "SERVER_TATTOO", { names: PAINT_NAME_RULE });
  const picture = await loadPicture(tools, place, options);
  const { payload, baked } = await bakeOverlay(tools, place, painted, picture);
  const stored = await storePackage(input, stateDir, place, payload);
  return packageAnswer(input, stored, baked);
}

// В поток читателя идёт только то, что можно передать копией: подмена инструментов не едет.
function threadOptions(options) {
  const forThread = { keysDirectory: options.keysDirectory ?? null };
  if (options.roots) forThread.roots = options.roots;
  return forThread;
}

export async function buildServerTattooPackageInThread(input, stateDir, options = {}) {
  return buildServerTattooPackage(input, stateDir, threadOptions(options));
}

// ------------------------------------------------------------ установка в игру

function conflictingModIds(plan) {
  const modIdOf = (conflict) => conflict.modId;
  return [...new Set((plan.conflicts || []).map(modIdOf))].sort();
}

function runtimeGuard(deps, game) {
  return function assertRuntimeSafety() {
    return deps.assertRuntimeSafety?.(game);
  };
}

function packageArguments(run) {
  const { built, stateDir } = run;
  return Object.fromEntries([
    ["manifest", built.manifest],
    ["packageRoot", built.directory],
    ["gameRoot", built.gameRoot],
    ["targetId", built.targetId],
    ["edition", EDITION],
    ["stateDir", stateDir],
    ["allowGameRootWrites", true],
    ["requireSignature", false],
    ["rpfProbe", composer.probeRpfArchive],
  ]);
}

function engineSettings(built, deps) {
  return Object.fromEntries([
    ["install", deps.installPrebuilt ?? composer.installRpfPrebuilt],
    ["edition", EDITION],
    ["gameRoot", built.gameRoot],
    ["pointsRoot", restoreChain.nativeRestorePointsRoot()],
    ["multi", true],
    ["replay", replay.serverTattooReplayRecord(built)],
  ]);
}

// Общий набор параметров плана плюс то, что нужно только установке.
function installParameters(run) {
  const { built, deps, guard, replaced } = run;
  const additions = Object.fromEntries([
    ["replaceModIds", replaced],
    ["rpfComposer", composer.composeRpfArchive],
    ["dlcListProvider", composer.provideLegacyDlcList],
    ["contentXmlProvider", composer.provideUpdateContentXml],
    ["assertRuntimeSafety", guard],
    ["onProgress", deps.onProgress],
  ]);
  if (engine.engineInstallEnabled("server-tattoos")) {
    additions.engineInstall = engineSettings(built, deps);
  }
  return Object.assign({}, packageArguments(run), additions);
}

async function flagGate(run) {
  const enabled = run.deps.enabled ?? applyFlag.serverTattooApplyEnabled();
  if (enabled) return;
  throw refuse(FLAG, "Тату сервера в игру пока не ставится: проверка в игре ещё не пройдена. Забери картинку PNG.");
}

async function packageStep(run) {
  const { input, stateDir, deps } = run;
  const build = deps.buildPackage || buildServerTattooPackage;
  run.built = await build(input, stateDir, deps);
}

async function readinessStep(run) {
  const { built, deps } = run;
  const mutation = { mutate: true };
  run.game = await deps.assertGameReady?.(built.gameRoot, mutation);
}

async function provisionStep(run) {
  const { built, deps, stateDir } = run;
  run.guard = runtimeGuard(deps, run.game);
  const provision = deps.provision || provisioner.provisionClothingInfrastructure;
  const request = {
    gameRoot: built.gameRoot,
    targetId: built.targetId,
    edition: EDITION,
    stateDir,
    assertRuntimeSafety: run.guard,
    activate: false,
  };
  await provision(request);
}

async function planStep(run) {
  const plan = await (run.deps.plan || engine.planPackage)(packageArguments(run));
  run.replaced = conflictingModIds(plan);
}

async function installStep(run) {
  /* Наложения через контейнер в update.rpf (`ASTRAL_OVERLAYS_VIA_UPDATE`): пусто — ничего не добавляется. */
  const container = await clothingContainerOptions(run.stateDir, run.deps);
  const parameters = { ...installParameters(run), ...container };
  const install = run.deps.install || installLocalServerTattooPackage;
  run.installed = await install(parameters);
  /* Режим RP (21.11.2026): картинка осталась в хосте `astral_clothing` — слова «на GTA 5 RP не видно»; ушла в контейнер или режим выключен — поля нет. */
  run.visibility = overlayInstallVisibility({ files: run.built.manifest.files, route: container.overlaysUpdateRoute });
}

// Слот манифеста читается только здесь, уже после установки.
function applyAnswer(run) {
  const { built, installed, replaced } = run;
  const answer = { ...installed };
  answer.modId = built.manifest.id;
  answer.slot = built.manifest.slots[0];
  answer.baked = built.baked;
  answer.replaced = replaced;
  answer.restartRequired = true;
  if (run.visibility) answer.visibility = run.visibility;
  return answer;
}

export async function applyServerTattoo(input, stateDir, deps = {}) {
  const run = { input, stateDir, deps };
  await flagGate(run);
  await packageStep(run);
  await readinessStep(run);
  await provisionStep(run);
  await planStep(run);
  await installStep(run);
  return applyAnswer(run);
}
