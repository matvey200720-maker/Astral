// Установка паков оружия: файлы моделей и текстур стволов едут в «Astral Weapons DLC» через движок установки.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { normalizeModelScale } from "@modovik/rage-drawable";
import { readResourceHeader } from "@modovik/ypt/resource-core";
import * as engine from "@modovik/install-engine";
import * as attachmentKit from "./weapon-attachments.js";
import * as bake from "./ytd-bake.js";
import * as packParts from "./pack-attachments.js";
import * as glow from "./weapon-glow.js";
import * as pieces from "./weapon-paint-pieces.js";
import * as rpf from "./rpf-composer.js";
import * as decorations from "./weapon-decorations.js";
import * as gunpackPaint from "./gunpack-paint.js";
import * as provisioner from "./weapon-dlc-provisioner.js";
import { appWeaponUpdateRoute } from "./weapon-update-install.js";

const FILE_LIMIT = 64 * 1024 * 1024;
const MODELS_LIMIT = 160;
const PACK_ID = /^[0-9a-f]{24}$/;
const MOD_ID = /^local-gunpack-[0-9a-f]{12}$/;
const STREAM_FILE = /\.(?:ydr|ytd)$/i;
// Точка не экранирована намеренно: прежнее поведение принимает за ствол и «a_ydr», и «xydr».
const SCALABLE_MODEL = /.ydr$/i;
const TEXTURE_NAME = /^[\p{L}\p{N} _+.-]{1,96}$/u;
const LEGACY_EXTENSION = /\.(?:ydr|ytd|yft)$/;
const LEGACY_VERSIONS = { ".ydr": 165, ".ytd": 13 };
const TEXTURE_ROLES = [
  ["+hi.ytd", "texture-hi"],
  [".ytd", "texture"],
];
const HI_SUFFIX = "_hi.ydr";
const ENTRY_ROOT = "astral_stream.rpf/";
const PAINT_REQUEST_FIELDS = "model name textures decorations decorationImages paintPieces scale parts".split(" ");
// Что из зависимостей идёт в покраску: [поле покраски, имя зависимости].
const PAINT_DEPENDENCIES = [
  ["gameFiles", "gameFiles"],
  ["attachmentTools", "attachmentTools"],
  ["embed", "embedAttachments"],
  ["native", "native"],
];

const TEXTS = {
  GUNPACK_ID: "Неизвестный пак.",
  GUNPACK_EMPTY: "Выберите хотя бы один ствол пака.",
  GUNPACK_MODELS: "Непонятный список стволов.",
  GUNPACK_GAME: "Выберите папку GTA V Legacy.",
  GUNPACK_VARIANT: "Такого варианта в паке нет.",
  GUNPACK_SKIN_ATTACHMENTS:
    "Обвесы не встали на ствол пака: у его модели нет костей под них или моделей обвесов нет ни в паке, ни в игре.",
  GUNPACK_SKIN_ID: "Непонятная установка покраски.",
  GUNPACK_NOT_INSTALLED: "Этот пак не стоит в игре.",
};

function refuse(code, text = TEXTS[code]) {
  const failure = new Error(text);
  failure.code = code;
  return failure;
}

function ensure(condition, code, detail) {
  if (condition) return;
  throw refuse(code, detail);
}

function sha256Of(bytes) {
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

function byFileName(left, right) {
  return left.name.localeCompare(right.name);
}

function dropFolder(folder) {
  const removal = { recursive: true, force: true };
  return fs.rm(folder, removal).catch(() => {});
}

async function putFile(target, bytes) {
  const folder = path.dirname(target);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(target, bytes);
}

// ---------------------------------------------------------------------------------------------
// Запросы окна

function parseModelList(raw) {
  const unique = new Set();
  const given = Array.isArray(raw) ? raw : [];
  given.forEach((item) => {
    unique.add(String(item || "").trim().toLowerCase());
  });
  const models = [...unique].sort();
  ensure(models.length > 0, "GUNPACK_EMPTY");
  ensure(models.length <= MODELS_LIMIT && models.every((model) => engine.GUNPACK_MODEL.test(model)), "GUNPACK_MODELS");
  return models;
}

// Идентификатор пака из ввода: либо годный, либо отказ GUNPACK_ID.
function packIdOf(input) {
  const packId = String(input?.packId || "");
  ensure(PACK_ID.test(packId), "GUNPACK_ID");
  return packId;
}

// Папка игры из ввода: абсолютный путь либо отказ GUNPACK_GAME.
function absoluteGameRoot(input) {
  const root = String(input?.gameRoot || "");
  ensure(path.isAbsolute(root), "GUNPACK_GAME");
  return root;
}

export function normalizeGunpackInstallRequest(input) {
  const packId = packIdOf(input);
  const models = parseModelList(input?.models);
  const root = absoluteGameRoot(input);
  const request = { packId };
  request.variantKey = String(input?.variantKey ?? "");
  request.models = models;
  request.attachments = input?.attachments !== false;
  /* Размер модели в руках (библиотека v2, 14.11.2026): запекается в модели стволов при сборке, как у скина; 1 — как в игре. */
  request.scale = normalizeModelScale(input?.scale);
  request.gameRoot = path.resolve(root);
  request.targetId = String(input?.targetId || "default");
  return request;
}

// Рисунки покраски и картинки к ним; картинки проверяются раньше рисунков.
function skinDecorations(input) {
  const sketches = Array.isArray(input?.decorations) ? input.decorations : [];
  const images = decorations.normalizeDecorationImages(input?.decorationImages, sketches);
  return { drawn: decorations.requestDecorations(sketches, images), images };
}

function skinTextures(input, allowEmpty) {
  return bake.normalizePaintedTextures(input?.textures, "GUNPACK_SKIN", { names: TEXTURE_NAME, allowEmpty });
}

export function normalizePackSkinRequest(input) {
  const base = normalizeGunpackInstallRequest({ ...input, models: [input?.model], attachments: false });
  const model = base.models[0];
  const { drawn, images } = skinDecorations(input);
  const parts = packParts.packAttachmentParts(model, input?.attachments, input?.looks);
  const scale = normalizeModelScale(input?.scale);
  const textures = skinTextures(input, drawn.length > 0 || parts.length > 0 || scale !== 1);
  const paintPieces = pieces.normalizePaintPieces(input?.paintPieces, textures);
  const name = String(input?.name || "Скин").slice(0, 80);
  const skin = Object.fromEntries([
    ["model", model],
    ["name", name],
    ["textures", textures],
    ["decorations", drawn],
    ["decorationImages", images],
    ["paintPieces", paintPieces],
    ["parts", parts],
    ["scale", scale],
  ]);
  return { ...base, ...skin };
}

// ---------------------------------------------------------------------------------------------
// Отбор файлов пака

function heavyReason(file) {
  const megabytes = Math.round(file.size / 1024 / 1024);
  return `«${file.name}» весит ${megabytes} МБ — больше предела 64 МБ, игра на таком падает.`;
}

// Причины пропуска ствола по приоритету: блокирующая проверка, тяжёлый файл, пустой пак.
function judgeWeapon(weapon) {
  const blocker = (weapon.checks || []).find((check) => check.severity === "block");
  const files = weapon.files.filter((file) => STREAM_FILE.test(file.name));
  const heavy = files.find((file) => file.size > FILE_LIMIT);
  const refusals = [
    [blocker, () => blocker.message],
    [heavy, () => heavyReason(heavy)],
    [files.length === 0, () => "В паке нет ни модели, ни текстур этого ствола."],
  ];
  const refusal = refusals.find(([applies]) => applies);
  return refusal ? { reason: refusal[1]() } : { files };
}

const usableAttachmentFile = (file) => STREAM_FILE.test(file.name) && file.size > 0 && file.size <= FILE_LIMIT;

function attachmentGroup(attachment) {
  const files = attachment.files.filter(usableAttachmentFile);
  if (files.length === 0) return null;
  return { model: attachment.model, name: attachment.name, weapon: false, files };
}

// Одно имя — одна запись в архиве: владеет файл побольше, при равенстве — тот, что пришёл раньше.
function dedupeGroups(found) {
  const keepBigger = (owners, file) => {
    const holder = owners.get(file.name);
    return !holder || file.size > holder.size ? owners.set(file.name, file) : owners;
  };
  const owners = found.flatMap((group) => group.files).reduce(keepBigger, new Map());
  const ownedOnly = (group) => ({
    ...group,
    files: group.files.filter((file) => owners.get(file.name) === file).sort(byFileName),
  });
  return found.map(ownedOnly).filter((group) => group.files.length);
}

export function selectGunpackFiles(pack, request) {
  const variants = pack?.variants || [];
  const variant = variants.find((entry) => entry.key === request.variantKey);
  ensure(variant, "GUNPACK_VARIANT");
  const weaponOf = new Map();
  for (const weapon of variant.weapons) weaponOf.set(weapon.model, weapon);
  const stranger = request.models.find((model) => !weaponOf.has(model));
  ensure(!stranger, "GUNPACK_MODELS", `Ствола ${stranger} в этом варианте нет.`);

  const verdicts = request.models.map((model) => {
    const weapon = weaponOf.get(model);
    return { model, weapon, verdict: judgeWeapon(weapon) };
  });
  const skipped = verdicts
    .filter(({ verdict }) => !verdict.files)
    .map(({ model, weapon, verdict }) => ({ model, name: weapon.name, reason: verdict.reason }));
  const found = verdicts
    .filter(({ verdict }) => verdict.files)
    .map(({ model, weapon, verdict }) => ({ model, name: weapon.name, weapon: true, files: verdict.files }));
  if (request.attachments) found.push(...(variant.attachments || []).map(attachmentGroup).filter(Boolean));
  return { variant, groups: dedupeGroups(found), skipped };
}

// ---------------------------------------------------------------------------------------------
// Заголовок ресурса, манифест, размер

// Заголовок ресурса либо пометка, что байты — не ресурс GTA V.
function readHeader(bytes) {
  try {
    return { header: readResourceHeader(bytes) };
  } catch {
    return { unreadable: true };
  }
}

export function legacyResourceProblem(name, bytes) {
  const extension = LEGACY_EXTENSION.exec(String(name || "").toLowerCase())?.[0];
  const read = readHeader(bytes);
  if (read.unreadable) return `«${name}» — не ресурс GTA V.`;
  const version = read.header.declaredVersion || read.header.version;
  const expected = LEGACY_VERSIONS[extension];
  if (version === expected) return "";
  return `«${name}» — ресурс версии ${version}, а GTA V Legacy ждёт ${expected} (файл для Enhanced?).`;
}

function manifestEntry(file) {
  const { name, entry, size, sha256 } = file;
  return Object.fromEntries([
    ["source", `payload/${name}`],
    ["target", engine.GUNPACK_DLC_TARGET],
    ["action", "import"],
    ["entry", entry],
    ["size", size],
    ["sha256", sha256],
  ]);
}

export function buildGunpackManifest(spec) {
  const { label, models, files } = spec;
  const records = files.map((file) => ({ ...file, entry: ENTRY_ROOT + file.name }));
  const digest = engine.gunpackSourceDigest(records);
  const stamp = digest.slice(0, 12);
  return Object.fromEntries([
    ["id", `local-gunpack-${stamp}`],
    ["version", `1.0.0-${stamp}`],
    ["name", `Astral gunpack: ${label}`.slice(0, 120)],
    ["editions", ["Legacy"]],
    ["scope", "game-root"],
    ["adapter", "rpf-entry"],
    ["requiresLoader", false],
    ["gameplayChanges", false],
    ["capabilities", engine.GUNPACK_CAPABILITIES],
    ["slots", models.map((model) => `weapon-${model}`)],
    ["gunpack", { schemaVersion: 1, models, sourceDigest: `sha256:${digest}` }],
    ["files", records.map(manifestEntry)],
  ]);
}

function resizeModel(file, scale, adjust) {
  const answer = adjust(file.bytes, { scale });
  if (!answer.bytes) {
    const reason = answer.skipped[0]?.reason || "модель не изменилась";
    return { failure: { file: file.name, reason } };
  }
  return { changed: { ...file, bytes: answer.bytes } };
}

export function scalePackFiles(files, scale, adjust = glow.adjustWeaponModel) {
  const outcome = { files: [], models: [], failed: [] };
  for (const file of files) {
    const step = SCALABLE_MODEL.test(file.name) ? resizeModel(file, scale, adjust) : null;
    outcome.files.push(step?.changed || file);
    if (step?.changed) outcome.models.push(file.name);
    else if (step) outcome.failed.push(step.failure);
  }
  if (outcome.models.length === 0) {
    const causes = outcome.failed.map((item) => `${item.file} — ${item.reason}`);
    const why = causes.length ? causes.join("; ") : "в пакете нет модели";
    throw refuse("GUNPACK_SKIN_SCALE", `Размер ствола в игре не поменять: ${why}.`);
  }
  return outcome;
}

// ---------------------------------------------------------------------------------------------
// Украшения и обвесы одного ствола

function textureRole(name, stem) {
  const lower = name.toLowerCase();
  if (!lower.startsWith(stem)) return null;
  const rule = TEXTURE_ROLES.find(([suffix]) => lower.endsWith(suffix));
  return rule ? rule[1] : null;
}

// Складывает файлы обвесов и текстуры ствола в рабочую папку, откуда их берёт сборка обвесов.
async function stashAttachmentSources(job, files, workDir) {
  const { paint, selection, tree, request } = job;
  const stem = String(paint.model).toLowerCase();
  const query = Object.fromEntries([
    ["variant", selection.variant],
    ["tree", tree],
    ["model", paint.model],
    ["parts", paint.parts],
    ["gameRoot", request.gameRoot],
    ["gameFiles", paint.gameFiles || null],
  ]);
  const found = await packParts.packAttachmentFiles(query);
  const fromParts = found.parts.flatMap((part) => {
    return part.files.map((file) => ({ file, role: `part:${part.bone}:${file.role}` }));
  });
  const fromTextures = files.flatMap((file) => {
    const role = textureRole(file.name, stem);
    return role ? [{ file, role }] : [];
  });
  const sources = [];
  for (const [index, { file, role }] of [...fromParts, ...fromTextures].entries()) {
    const output = path.join(workDir, "sources", String(index + 1), file.name);
    await putFile(output, file.bytes);
    sources.push({ name: file.name, role, output });
  }
  const painted = new Map((paint.textures || []).map((item) => [String(item.texture || "").toLowerCase(), item.png]));
  return { found, sources, painted };
}

function absorbEmbedding(section, answer) {
  for (const name of answer?.painted || []) {
    if (!section.painted.includes(name)) section.painted.push(name);
  }
  for (const part of answer?.report?.parts || []) {
    const { bone, component } = part;
    const bucket = part.skipped ? section.skipped : section.embedded;
    if (!bucket.some((entry) => entry.bone === bone)) {
      bucket.push(part.skipped ? { bone, component, reason: part.skipped } : { bone, component, model: part.model });
    }
  }
}

function bonesOf(answer) {
  return answer.report?.result?.semantic?.bones || answer.report?.semantic?.bones || [];
}

// Украшение файлов ствола: состояние живёт в замыкании, наружу отдаётся только run().
function makeDecorator(job, files) {
  const paint = job.paint;
  const workDir = path.join(job.directory, "decorate");
  const stem = String(job.paint.model).toLowerCase();
  const models = [];
  const bones = new Set();
  const skipped = [];
  let kit = null;
  let section = null;

  const isHi = (file) => file.name.toLowerCase().endsWith(HI_SUFFIX);
  const ownsModel = (file) => {
    const lower = file.name.toLowerCase();
    return lower.startsWith(stem) && (lower === `${stem}.ydr` || lower.endsWith(HI_SUFFIX));
  };
  const hasHi = files.some((file) => ownsModel(file) && isHi(file));

  function embedRequest(file, input, lod) {
    const weaponFile = { name: file.name, role: isHi(file) ? "model-hi" : "model", output: input };
    const parts = kit.found.parts.map(({ bone, component }) => ({ bone, component }));
    const staging = path.join(workDir, "attachments", file.name);
    return { weaponFile, parts, sources: kit.sources, painted: kit.painted, staging, lod };
  }

  function decorateRequest(file, input, lod, embedded) {
    return Object.fromEntries([
      ["input", input],
      ["output", path.join(workDir, "out", file.name)],
      ["decorations", paint.decorations || []],
      ["images", paint.decorationImages],
      ["staging", path.join(workDir, "staging", file.name)],
      ["lod", lod],
      ["attachments", embedded?.attachments || null],
      ["pieces", paint.paintPieces || []],
    ]);
  }

  // Обвесы вшиваются в модель до украшения; в отчёт попадает то, что встало и что нет.
  async function embedInto(file, input, lod) {
    const tools = paint.attachmentTools || {};
    const embed = paint.embed || attachmentKit.embeddedAttachments;
    const embedded = await embed(embedRequest(file, input, lod), tools);
    absorbEmbedding(section, embedded);
    return embedded;
  }

  async function decorate(file) {
    const input = path.join(workDir, "in", file.name);
    await putFile(input, file.bytes);
    const lod = !isHi(file) && hasHi ? "low" : "high";
    const embedded = kit?.found.parts.length ? await embedInto(file, input, lod) : undefined;
    const request = decorateRequest(file, input, lod, embedded);
    const answer = await decorations.decorateWeaponModel(request, job.context, paint.native || undefined);
    if (!answer) return file;
    models.push(file.name);
    for (const bone of bonesOf(answer)) bones.add(bone);
    return { ...file, bytes: new Uint8Array(answer.bytes) };
  }

  async function attempt(file) {
    try {
      return await decorate(file);
    } catch (error) {
      skipped.push({ file: file.name, reason: String(error?.message || error) });
      return file;
    }
  }

  function report() {
    const summary = { models, bones: [...bones], skipped };
    if (section) summary.attachments = section;
    return summary;
  }

  async function run() {
    if (paint.parts?.length) {
      kit = await stashAttachmentSources(job, files, workDir);
      const missing = kit.found.missing.map(({ bone, component, reason }) => ({ bone, component, reason }));
      section = { embedded: [], skipped: missing, painted: [] };
    }
    const finished = [];
    for (let at = 0; at < files.length; at += 1) {
      const file = files[at];
      finished.push(ownsModel(file) ? await attempt(file) : file);
    }
    await dropFolder(workDir);
    return { files: finished, report: report() };
  }

  return { run };
}

// ---------------------------------------------------------------------------------------------
// Покраска ствола: украшение и масштаб идут по очереди

async function decoratePainted(job, painted) {
  const decorated = await makeDecorator(job, painted.files).run();
  painted.files = decorated.files;
  painted.decorations = decorated.report;
  const attached = new Set(decorated.report.attachments?.painted || []);
  painted.skipped = painted.skipped.filter((entry) => !attached.has(String(entry.texture || "").toLowerCase()));
}

function scalePainted(job, painted) {
  const resized = scalePackFiles(painted.files, job.paint.scale);
  painted.files = resized.files;
  painted.scaled = resized.models;
}

function restamp(file) {
  return { ...file, size: file.bytes.byteLength, sha256: sha256Of(file.bytes) };
}

async function paintStage(job, group) {
  const painted = await gunpackPaint.paintWeaponFiles(group.files, job.paint.textures);
  const { paint } = job;
  if (paint.decorations?.length || paint.paintPieces?.length || paint.parts?.length) {
    await decoratePainted(job, painted);
  }
  if (paint.scale && paint.scale !== 1) {
    scalePainted(job, painted);
  }
  group.files.splice(0, group.files.length, ...painted.files.map(restamp));
  return painted;
}

// ---------------------------------------------------------------------------------------------
// Сборка пакета: группы идут по очереди, прочитанный ствол покраски красится сразу

async function loadFile(job, file, counter) {
  const { sources, context } = job;
  const notice = { phase: "prepare", current: counter.done, total: counter.total };
  context?.onProgress?.(notice);
  counter.done += 1;
  const source = sources.get(file.path);
  ensure(source, "GUNPACK_CHANGED", `В архиве пака нет «${file.name}» — пак изменился, добавьте его заново.`);
  const bytes = await source.read();
  const problem = legacyResourceProblem(file.name, bytes);
  if (problem) return { problem };
  return { record: { name: file.name, size: bytes.byteLength, sha256: sha256Of(bytes), bytes } };
}

async function readGroupFiles(job, group, counter) {
  const files = [];
  let at = 0;
  while (at < group.files.length) {
    const loaded = await loadFile(job, group.files[at], counter);
    if (loaded.problem) return loaded;
    files.push(loaded.record);
    at += 1;
  }
  return { files };
}

/* Размер всего пака: модели каждого ствола пересчитываются (`scalePackFiles`), обвесы и текстуры едут как есть. Ствол, у которого модель не поменять, не ставится и называется в «пропущенных». */
function scaleWeaponGroup(job, current, state) {
  try {
    const resized = scalePackFiles(current.files, job.request.scale, job.adjust);
    current.files = resized.files.map(restamp);
    state.scaled.push(...resized.models);
    return true;
  } catch (error) {
    state.dropped.push({ model: current.model, name: current.name, reason: error.message });
    return false;
  }
}

async function readAndPaintGroups(job) {
  const { selection, paint } = job;
  const total = selection.groups.reduce((sum, group) => sum + group.files.length, 0);
  const counter = { done: 0, total };
  const state = { ready: [], dropped: [], painted: null, scaled: [] };
  const wholePackScale = !paint && job.request.scale !== 1;
  for (const group of selection.groups) {
    const outcome = await readGroupFiles(job, group, counter);
    if (!outcome.problem) {
      const current = { ...group, files: outcome.files };
      if (wholePackScale && current.weapon && !scaleWeaponGroup(job, current, state)) continue;
      state.ready.push(current);
      const aimed = paint && current.weapon && current.model === paint.model;
      if (aimed && !state.painted) state.painted = await paintStage(job, current);
    } else if (group.weapon) {
      state.dropped.push({ model: group.model, name: group.name, reason: outcome.problem });
    }
  }
  return state;
}

function packageLabel(pack, selection, paint) {
  const skin = paint?.name ? `скин «${paint.name}»` : "";
  const variantLabel = pack.variants.length > 1 ? selection.variant.label : "";
  const text = [pack.name, variantLabel, skin].filter(Boolean).join(" — ");
  return text || "ганпак";
}

function nothingMessage(skipped) {
  const list = skipped.map((entry) => `${entry.name} — ${entry.reason}`).join("; ");
  return list ? `Ни один выбранный ствол не ставится: ${list}` : "Ставить нечего.";
}

function emptyPaintMessage(painted) {
  const reasons = (painted?.skipped || []).map((entry) => `${entry.texture || entry.file}: ${entry.reason}`);
  return ["Покраска не легла ни на одну текстуру ствола.", ...reasons].join(" ");
}

function assertPaintWorked(job, painted) {
  const { paint } = job;
  const onlyParts = paint.parts?.length && !paint.textures?.length && !paint.decorations?.length;
  ensure(!onlyParts || painted?.decorations?.attachments?.embedded.length, "GUNPACK_SKIN_ATTACHMENTS");
  const worked = painted?.baked.length || painted?.decorations?.models.length || painted?.scaled?.length;
  if (!worked) throw refuse("GUNPACK_SKIN_EMPTY", emptyPaintMessage(painted));
}

async function storePayload(directory, models, file) {
  if (engine.gunpackModelOfFile(file.name, models)) {
    const target = path.join(directory, "payload", file.name);
    await bake.atomicWrite(target, file.bytes);
    return;
  }
  throw refuse("GUNPACK_RESOURCE", `«${file.name}» — не файл ствола.`);
}

async function composePackage(job) {
  const { pack, selection, paint, directory } = job;
  const { ready, dropped, painted, scaled } = await readAndPaintGroups(job);
  const skipped = selection.skipped.concat(dropped);
  const weaponGroups = ready.filter((group) => group.weapon);
  if (!weaponGroups.length) throw refuse("GUNPACK_NOTHING", nothingMessage(skipped));
  if (paint) assertPaintWorked(job, painted);

  const models = ready.map((group) => group.model).sort();
  const files = ready.flatMap((group) => group.files).sort(byFileName);
  for (let at = 0; at < files.length; at += 1) await storePayload(directory, models, files[at]);

  const label = packageLabel(pack, selection, paint);
  const summary = files.map(({ name, size, sha256 }) => ({ name, size, sha256 }));
  const manifest = buildGunpackManifest({ label, models, files: summary });
  return Object.fromEntries([
    ["directory", directory],
    ["manifest", manifest],
    ["weapons", weaponGroups.map((group) => group.model)],
    ["attachments", ready.length - weaponGroups.length],
    ["skipped", skipped],
    ["baked", painted?.baked || []],
    ["paintSkipped", painted?.skipped || []],
    ["scaled", painted?.scaled?.length ? painted.scaled : scaled],
    ["decorations", painted?.decorations || null],
  ]);
}

export async function buildGunpackPackage(spec, stateDir, context = null) {
  const { pack, tree, request } = spec;
  const paint = spec.paint === undefined ? null : spec.paint;
  const selection = selectGunpackFiles(pack, request);
  const sources = new Map(tree.files.map((file) => [file.path, file]));
  const directory = path.join(stateDir, "gunpack-installs", randomUUID());
  const job = { pack, tree, request, paint, context, selection, sources, directory, adjust: spec.adjust };
  return composePackage(job).catch(async (error) => {
    await dropFolder(directory);
    throw error;
  });
}

// ---------------------------------------------------------------------------------------------
// Установка и снятие

const noState = () => null;

export async function gunpackInstalled(record, stateDir, inspect = engine.inspectProfile) {
  if (!record?.modId) return false;
  const state = await inspect({ stateDir }).catch(noState);
  if (!state) return null;
  const installed = state.targets?.[record.targetId || "default"]?.installed || [];
  return installed.some((entry) => entry.modId === record.modId);
}

function archiveToolsOf(dependencies) {
  const defaults = Object.fromEntries([
    ["rpfProbe", rpf.probeRpfArchive],
    ["rpfComposer", rpf.composeRpfArchive],
    ["dlcListProvider", rpf.provideLegacyDlcList],
    ["contentXmlProvider", rpf.provideUpdateContentXml],
  ]);
  return Object.assign(defaults, dependencies.archiveTools);
}

// Все ключи archiveTools, кроме rpfProbe (его забирает план): известные по порядку, затем лишние.
function composersOf(tools) {
  const composers = { ...tools };
  delete composers.rpfProbe;
  return composers;
}

function runtimeGuard(dependencies, game) {
  return function safety() {
    return dependencies.assertRuntimeSafety?.(game);
  };
}

function removalGuards(dependencies, game) {
  return {
    assertRuntimeSafety: () => dependencies.assertRuntimeSafety?.(game),
    onProgress: dependencies.onProgress,
  };
}

function withdrawPackage(spec) {
  const { modId, targetId, stateDir, tools, guards } = spec;
  return engine.uninstallPackage(Object.assign({ modId, targetId, stateDir }, composersOf(tools), guards));
}

// Игра готова к изменениям (если зависимость есть): ждём её ответ.
function gameReady(dependencies, gameRoot) {
  return dependencies.assertGameReady?.(gameRoot, { mutate: true });
}

// Идентификаторы модов, которые план велит заменить: без повторов, по возрастанию. Работа со стволами, которых нет у нового ганпака (`keeps` плана), не заменяется целиком: новая ляжет слоем поверх общих записей.
export function conflictModIds(plan) {
  return engine.conflictsReplacedWhole(plan);
}

/* Оружие через контейнер, `ASTRAL_WEAPONS_VIA_UPDATE=container` (GTA 5 RP, 21.11.2026): ганпак «Мои паки», скин на ствол пака и ганпак с масштабом ложатся тем же маршрутом,
   что скин на штатный ствол (`weapon-skin.js`) и ганпак каталога, — в контейнер `x64/astral/astral_rp_weapons.rpf` в update.rpf, а не в хост `astral_weapons` (RAGE MP его не подключает).
   Хост и план по его записям не нужны (прежний ганпак или скин на тех же слотах заменяет `previousSkinsOf` установки); они остаются только пакету, у которого есть файл, в контейнер
   не идущий (`needsHost`), — тогда всё как раньше. Без выключателя маршрута нет, путь прежний. */
function containerRouteOf(spec) {
  const { request, stateDir, dependencies } = spec;
  const route = appWeaponUpdateRoute({ gameRoot: request.gameRoot, stateDir, env: dependencies.env || process.env, note: (line) => dependencies.note?.(line) });
  return route?.mode === "container" ? route : null;
}

/* Копия мода каталога (смена размера) заменяет то же, что его установка в 100 %: названное (`spec.catalog.replaceModIds`, `catalog-replacements.js`) и конфликты плана без работ мастерской — как `planConflicts` окна
   (свой скин и «Мои паки» остаются под модом каталога, Т-107b). Снимается только установленное. */
async function catalogCopyReplaced(plan, asked, stateDir, targetId) {
  const state = await engine.inspectProfile({ stateDir });
  const installed = new Set((state?.targets?.[targetId]?.installed || []).map((item) => item.modId));
  const named = [...engine.conflictsReplacedWhole(plan, (conflict) => !conflict.stack), ...asked];
  return [...new Set(named)].filter((id) => installed.has(id)).sort();
}

async function installBuilt(spec) {
  const { built, request, stateDir, dependencies, tools, safety } = spec;
  const { gameRoot, targetId } = request;
  const common = { gameRoot, targetId, edition: "Legacy", stateDir };
  const route = containerRouteOf(spec);
  const hostNeeded = !route || (await route.needsHost([built.manifest]));
  const provision = dependencies.provision || provisioner.provisionFastWeaponInfrastructure;
  if (hostNeeded) await provision({ ...common, assertRuntimeSafety: safety, activate: false });
  const base = { manifest: built.manifest, packageRoot: built.directory, ...common, rpfProbe: tools.rpfProbe };
  const plan = hostNeeded ? await engine.planLocalGunpackPackage(base) : { conflicts: [] };
  const replaceModIds = spec.catalog ? await catalogCopyReplaced(plan, spec.catalog.replaceModIds, stateDir, targetId) : conflictModIds(plan);
  const options = { replaceModIds, assertRuntimeSafety: safety, onProgress: dependencies.onProgress, ...(route ? { weaponUpdateRoute: route } : {}), ...(spec.origin ? { origin: spec.origin } : {}) };
  const installed = await engine.installLocalGunpackPackage(Object.assign({}, base, composersOf(tools), options));
  return { installed, replaceModIds };
}

// Общее начало установок: игра, студия, опись и дерево пака.
async function openSession(request, dependencies) {
  const { studio } = dependencies;
  const game = await gameReady(dependencies, request.gameRoot);
  const safety = runtimeGuard(dependencies, game);
  const pack = await studio.pack(request.packId);
  const tree = await studio.tree(request.packId);
  return { studio, safety, pack, tree };
}

// Сессия и сборка пакета с отчётом о ходе; покраска (если есть) считается после открытия сессии.
async function openAndBuild(request, stateDir, dependencies, paintOf) {
  const session = await openSession(request, dependencies);
  const spec = { pack: session.pack, tree: session.tree, request, adjust: dependencies.adjustModel };
  if (paintOf) spec.paint = paintOf(request, dependencies);
  const built = await buildGunpackPackage(spec, stateDir, { onProgress: dependencies.onProgress });
  return { session, built };
}

// Рабочая папка сборки стирается при любом исходе работы.
function cleanAfter(built, work) {
  return work().finally(() => dropFolder(built.directory));
}

async function isStaleInstall(previous, modId, replaceModIds, stateDir) {
  if (!previous?.modId) return false;
  if (previous.modId === modId || replaceModIds.includes(previous.modId)) return false;
  const present = await gunpackInstalled(previous, stateDir);
  return present === true;
}

function installRecord(spec) {
  const { request, built, replaceModIds, previous } = spec;
  return Object.fromEntries([
    ["modId", built.manifest.id],
    ["targetId", request.targetId],
    ["variantKey", request.variantKey],
    ["requested", request.models],
    ["attachments", request.attachments],
    ["scale", request.scale],
    ["scaled", built.scaled],
    ["models", built.weapons],
    ["attachmentCount", built.attachments],
    ["skipped", built.skipped],
    ["replaced", replaceModIds.filter((id) => id !== previous?.modId)],
    ["installedAt", new Date().toISOString()],
  ]);
}

export async function applyGunpack(input, stateDir, dependencies = {}) {
  const request = normalizeGunpackInstallRequest(input);
  const { session, built } = await openAndBuild(request, stateDir, dependencies);
  const { studio, safety, pack } = session;
  return cleanAfter(built, async () => {
    const tools = archiveToolsOf(dependencies);
    const { installed, replaceModIds } = await installBuilt({ built, request, stateDir, dependencies, tools, safety });
    const previous = pack.installed;
    if (await isStaleInstall(previous, built.manifest.id, replaceModIds, stateDir)) {
      await withdrawPackage({
        modId: previous.modId,
        targetId: previous.targetId || request.targetId,
        stateDir,
        tools,
        guards: { assertRuntimeSafety: safety, onProgress: dependencies.onProgress },
      });
    }
    const record = installRecord({ request, built, replaceModIds, previous });
    await studio.setInstalled(request.packId, record);
    return { ...installed, ...record, restartRequired: true };
  });
}

function skinPaint(request, dependencies) {
  const paint = Object.fromEntries(PAINT_REQUEST_FIELDS.map((key) => [key, request[key]]));
  for (const [field, dependency] of PAINT_DEPENDENCIES) paint[field] = dependencies[dependency] || null;
  return paint;
}

function skinReply(installed, built, request, replaceModIds) {
  const reply = { ...installed };
  const fields = [
    ["modId", built.manifest.id],
    ["targetId", request.targetId],
    ["model", request.model],
    ["baked", built.baked],
    ["skipped", built.paintSkipped],
    ...(built.scaled.length ? [["scaled", built.scaled]] : []),
    ["decorations", built.decorations],
    ...(built.decorations?.attachments ? [["attachments", built.decorations.attachments]] : []),
    ["replaced", replaceModIds],
    ["restartRequired", true],
  ];
  for (const [key, value] of fields) reply[key] = value;
  return reply;
}

export async function applyPackSkin(input, stateDir, dependencies = {}) {
  const request = normalizePackSkinRequest(input);
  const { session, built } = await openAndBuild(request, stateDir, dependencies, skinPaint);
  const { safety } = session;
  return cleanAfter(built, async () => {
    const tools = archiveToolsOf(dependencies);
    const { installed, replaceModIds } = await installBuilt({ built, request, stateDir, dependencies, tools, safety });
    return skinReply(installed, built, request, replaceModIds);
  });
}

export async function removePackSkin(input, stateDir, dependencies = {}) {
  const modId = String(input?.modId || "");
  ensure(MOD_ID.test(modId), "GUNPACK_SKIN_ID");
  const root = absoluteGameRoot(input);
  const tools = archiveToolsOf(dependencies);
  const game = await gameReady(dependencies, path.resolve(root));
  const targetId = String(input?.targetId || "default");
  const present = await gunpackInstalled({ modId, targetId }, stateDir);
  if (present === false) return { status: "missing", modId, restartRequired: false };
  const guards = removalGuards(dependencies, game);
  const outcome = await withdrawPackage({ modId, targetId, stateDir, tools, guards });
  return { ...outcome, modId, restartRequired: true };
}

/**
 * Убрать один ствол из установленного пака (библиотека v2, 14.11.2026). Пак ставится ОДНИМ пакетом на выбранные стволы (`slots: weapon-<ствол>` в одной записи), поэтому
 * отдельный ствол не снять: пакет пересобирается без него теми же настройками (вариант, обвесы, размер) — прежняя установка снимается следом, если набор не пересёкся.
 * Единственный ствол — это снятие пака целиком.
 * @returns {Promise<object>} ответ `applyGunpack` или `removeGunpack`; `restartRequired: true`
 */
export async function removeGunpackModel(input, stateDir, dependencies = {}) {
  const packId = packIdOf(input);
  const model = String(input?.model || "").trim().toLowerCase();
  ensure(engine.GUNPACK_MODEL.test(model), "GUNPACK_MODELS");
  const installed = (await dependencies.studio.pack(packId)).installed;
  ensure(MOD_ID.test(installed?.modId), "GUNPACK_NOT_INSTALLED");
  const standing = Array.isArray(installed.models) && installed.models.length ? installed.models : installed.requested || [];
  ensure(standing.includes(model), "GUNPACK_MODELS", "Этого ствола в установленном паке нет.");
  const left = standing.filter((item) => item !== model);
  if (left.length === 0) return removeGunpack(input, stateDir, dependencies);
  return applyGunpack(
    {
      packId,
      variantKey: installed.variantKey ?? "",
      models: left,
      attachments: installed.attachments !== false,
      scale: installed.scale ?? 1,
      gameRoot: input.gameRoot,
      targetId: installed.targetId || input.targetId,
    },
    stateDir,
    dependencies,
  );
}

export async function removeGunpack(input, stateDir, dependencies = {}) {
  const packId = packIdOf(input);
  const { studio } = dependencies;
  const installed = (await studio.pack(packId)).installed;
  ensure(MOD_ID.test(installed?.modId), "GUNPACK_NOT_INSTALLED");
  const game = await gameReady(dependencies, path.resolve(String(input?.gameRoot || "")));
  const present = await gunpackInstalled(installed, stateDir);
  const outcome = present === false
    ? { status: "missing" }
    : await withdrawPackage({
      modId: installed.modId,
      targetId: installed.targetId || String(input?.targetId || "default"),
      stateDir,
      tools: archiveToolsOf(dependencies),
      guards: removalGuards(dependencies, game),
    });
  await studio.setInstalled(packId, null);
  return { ...outcome, modId: installed.modId, restartRequired: true };
}

function preparedPackage(spec) {
  const records = spec.files
    .map((file) => ({ name: file.name, bytes: file.bytes, size: file.bytes.byteLength, sha256: sha256Of(file.bytes) }))
    .sort(byFileName);
  const models = [...spec.models].sort();
  const manifest = buildGunpackManifest({ label: spec.label, models, files: records.map(({ name, size, sha256 }) => ({ name, size, sha256 })) });
  return { records, models, manifest };
}

/** Влезает ли готовый набор в локальный пакет ганпака: пределы числа стволов и файлов и веса файла проверяет движок. */
export function preparedGunpackFits(spec) {
  return engine.isLocalGunpackManifest(preparedPackage(spec).manifest, "Legacy");
}

/**
 * Готовый набор файлов — в игру пакетом ганпака (библиотека v2, 14.11.2026): тот же путь, что у сборки из «Моих паков» (план, замена по слотам, строгая локальная форма
 * манифеста), только файлы пришли не из пака, а из каталожного пакета с перешитыми моделями (`catalog-model-scale.js`).
 * @param {{ label: string, models: string[], files: { name: string, bytes: Uint8Array }[], gameRoot: string, targetId?: string, origin?: object, catalog?: { replaceModIds: string[] } }} spec
 *   `catalog` — это копия мода каталога: замена по его правилам (`catalogCopyReplaced`), а не по всем конфликтам плана
 */
export async function installPreparedGunpack(spec, stateDir, dependencies = {}) {
  const request = { gameRoot: path.resolve(spec.gameRoot), targetId: String(spec.targetId || "default") };
  const { records, models, manifest } = preparedPackage(spec);
  const directory = path.join(stateDir, "gunpack-installs", randomUUID());
  try {
    for (const file of records) await bake.atomicWrite(path.join(directory, "payload", file.name), file.bytes);
    const game = await gameReady(dependencies, request.gameRoot);
    const safety = runtimeGuard(dependencies, game);
    const tools = archiveToolsOf(dependencies);
    const { installed, replaceModIds } = await installBuilt({ built: { manifest, directory }, request, stateDir, dependencies, tools, safety, origin: spec.origin, catalog: spec.catalog });
    return { ...installed, modId: manifest.id, targetId: request.targetId, models, replaced: replaceModIds, restartRequired: true };
  } finally {
    await dropFolder(directory);
  }
}
