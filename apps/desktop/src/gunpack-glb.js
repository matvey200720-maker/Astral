import path from "node:path";
import zlib from "node:zlib";
import * as roles from "@modovik/gunpack/roles";
import * as gameWeapon from "@modovik/gunpack/game-weapon";
import * as gunpackModel from "@modovik/gunpack/model";
import * as shaderColour from "@modovik/gunpack/shader-colour";
import * as drawableGlb from "@modovik/rage-drawable/glb";
import * as packParts from "./pack-attachments.js";

// Роли файлов, из которых строится кадр ствола.
const FRAME_ROLES = new Set(["model", "model-hi", "texture", "texture-hi"]);

const PACK_ID_FORM = /^[0-9a-f]{24}$/;
const MODEL_FORM = /^w_[a-z0-9_]{1,80}$/;

const STUDIO = Object.freeze({ maxTexture: 2048, maxBytes: 96 * 1024 * 1024, pngLevel: 2 });
const CATALOG_PNG_LEVEL = 9;

// Значение настройки либо запасное, если её нет (undefined); null и 0 остаются как есть.
const optionOr = (options, key, fallback) => (options[key] === undefined ? fallback : options[key]);

// Сырой deflate из архива игры бывает оборван: отдаём то, что успело распаковаться.
function inflateRaw(bytes) {
  const { buffer, byteOffset, byteLength } = bytes;
  const packed = Buffer.from(buffer, byteOffset, byteLength);
  return new Uint8Array(zlib.inflateRawSync(packed, { finishFlush: zlib.constants.Z_SYNC_FLUSH }));
}

const asRaw = (rgba) => Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
const viewOf = (out) => new Uint8Array(out.buffer, out.byteOffset, out.byteLength);

// Кодировщик PNG с заданным уровнем сжатия; у результата нет собственного имени.
function pngWriter(compressionLevel) {
  const pngOptions = { compressionLevel };
  return async (rgba, width, height) => {
    const sharp = (await import("sharp")).default;
    const input = { raw: { width, height, channels: 4 } };
    const out = await sharp(asRaw(rgba), input).png(pngOptions).toBuffer();
    return viewOf(out);
  };
}

const catalogPng = pngWriter(CATALOG_PNG_LEVEL);
const encodePng = async (rgba, width, height) => catalogPng(rgba, width, height);

// Файлы кадра читаются по одному, в порядке, который назвал shotFiles.
async function readShotFiles(weapon, tree) {
  const byPath = new Map(tree.files.map((file) => [file.path, file]));
  const files = [];
  for (const entry of roles.shotFiles(weapon)) {
    const source = FRAME_ROLES.has(entry.role) && byPath.get(entry.path);
    if (!source) continue;
    const { name, role } = entry;
    files.push({ name, role, bytes: await source.read() });
  }
  return files;
}

// Модель ствола с обвесами собирает game-weapon, без них — обычный weaponModel.
function modelWithParts(files, maxTexture, parts) {
  const options = { inflateRaw, maxTexture, parts };
  const { drawable, texture: textureFor, parts: placed } = gameWeapon.packWeaponWithAttachments(files, options);
  return { drawable, textureFor, placed };
}

function plainModel(files, maxTexture) {
  const model = gunpackModel.weaponModel(files, { inflateRaw, maxTexture });
  const textureFor = function texture(material, role) {
    return model.texture(material?.textures?.[role]);
  };
  const { drawable } = model;
  return { drawable, textureFor, placed: [] };
}

function modelOf(files, settings) {
  const { maxTexture, parts } = settings;
  return parts.length > 0 ? modelWithParts(files, maxTexture, parts) : plainModel(files, maxTexture);
}

/* Свечение мешей со светящимся шейдером — той же силы, что в кадре обложки (`EMISSIVE_STRENGTH`). Материал копируется: общий объект модели не трогается. */
function asCoverMaterials(drawable) {
  const glowing = new Map();
  const glowOf = (material) => {
    if (!glowing.has(material)) glowing.set(material, { ...material, emissiveStrength: shaderColour.EMISSIVE_STRENGTH });
    return glowing.get(material);
  };
  const meshes = (drawable?.meshes || []).map((mesh) => {
    const material = mesh?.material;
    return material?.emissive ? { ...mesh, material: glowOf(material) } : mesh;
  });
  return { ...drawable, meshes };
}

// Не отдаём в GLB чёрный лист диффуза материала с листом отражения.
function diffuseOrNothing(textureFor) {
  return (material, role) => (role === "diffuse" && material?.reflectSheet ? null : textureFor(material, role));
}

/**
 * GLB из готовой модели ствола `{ drawable, textureFor }` (то, что отдаёт `modelOf`): один шов сборки для каталога и студии. `encodePng` — кодировщик картинок.
 * `asCover` — цвет, как на обложке: материал с шейдером отражения (`reflect`, `*_reflect`: диффуз чёрный, цвет в листе отражения) красится цветом листа (`packages/gunpack/shader-colour.js`), чёрный лист в GLB не едет.
 * Это для «3D» карточки каталога; студия ганпака красит по листу диффуза и ждёт его у каждого материала, поэтому у неё прежнее.
 */
export async function glbOfModel(model, settings) {
  const { drawable, textureFor } = model;
  const { name, encodePng: pngEncoder } = settings;
  const asCover = optionOr(settings, "asCover", false);
  const reflected = asCover
    ? shaderColour.withReflectColours(drawable, (sheet) => textureFor({ textures: { sheet } }, "sheet"))
    : null;
  const options = {
    name,
    encodePng: pngEncoder,
    textureFor: diffuseOrNothing(textureFor),
    materialName: (material) => material?.textures?.diffuse || "",
    /* Цвета вершин у оружия — служебные маски шейдера, а не оттенок: просмотрщик glTF умножил бы на них картинку цвета. У «Боевого PDW · FrozenLove» стоял (1; 0,976; 0): розово-голубой ствол
       в «3D» выходил жёлто-зелёным, как и у ствола из игры (`weapon-glb-thread.js`). */
    vertexColours: false,
  };
  return drawableGlb.drawableToGlb(asCover ? asCoverMaterials(reflected) : drawable, options);
}

// Ошибок не ловит: решает вызывающий.
async function assembleGlb(weapon, files, settings, pngEncoder, extra = {}) {
  const model = modelOf(files, settings);
  const glbSettings = { name: weapon.model, encodePng: pngEncoder, asCover: optionOr(extra, "asCover", false) };
  const bytes = await glbOfModel(model, glbSettings);
  return { bytes, placed: model.placed };
}

export async function weaponGlb(weapon, tree, limits = {}) {
  const maxTexture = optionOr(limits, "maxTexture", 1024);
  const maxBytes = optionOr(limits, "maxBytes", 41943040);
  const files = await readShotFiles(weapon, tree);
  const built = assembleGlb(weapon, files, { maxTexture, parts: [] }, encodePng, { asCover: true });
  return built.then((glb) => (glb.bytes.byteLength <= maxBytes ? glb.bytes : null)).catch(() => null);
}

// Части ответа: сначала собранные обвесы (с источником файла), затем недостающие.
function describeParts(placed, attached) {
  const sources = new Map(attached.parts.map((part) => [part.bone, part.source]));
  const assembled = placed.map((part) => Object.assign({}, part, { source: sources.get(part.bone) }));
  const absent = attached.missing.map(({ bone, component, reason }) => ({ bone, component, skipped: reason }));
  return assembled.concat(absent);
}

// Проверка запроса студии: формы идентификатора пака и модели.
function studioTarget(input) {
  const packId = String(input?.packId || "");
  const model = String(input?.model || "");
  const formsOk = PACK_ID_FORM.test(packId) && MODEL_FORM.test(model);
  if (!formsOk) throw new Error("Неизвестный ствол пака.");
  return { packId, model };
}

// Вариант пака и ствол в нём (кроме строк «parts»).
function findWeapon(pack, input, model) {
  const variantKey = String(input?.variantKey ?? "");
  const variant = (pack.variants || []).find((item) => item.key === variantKey);
  const weapon = variant?.weapons.find((item) => item.model === model && item.kind !== "parts");
  return { variant, weapon };
}

// Запрос студии разбирается по порядку: проверка, поиск ствола, обвесы, сборка модели, ответ.
export async function packWeaponGlb(input, deps) {
  const { studio } = deps;
  const gameFiles = optionOr(deps, "gameFiles", null);
  const { packId, model } = studioTarget(input);

  const pack = await studio.pack(packId);
  const { variant, weapon } = findWeapon(pack, input, model);
  if (!weapon) throw new Error(`В паке нет ствола ${model}.`);
  const tree = await studio.tree(packId);

  const chosen = packParts.packAttachmentParts(model, input?.attachments, input?.looks);
  const requestedRoot = input.gameRoot;
  const gameRoot = typeof requestedRoot === "string" && path.isAbsolute(requestedRoot) ? requestedRoot : "";
  const attached = chosen.length
    ? await packParts.packAttachmentFiles({ variant, tree, model, parts: chosen, gameRoot, gameFiles })
    : { parts: [], missing: [] };

  const files = await readShotFiles(weapon, tree);
  const settings = { maxTexture: STUDIO.maxTexture, parts: attached.parts };
  const built = await assembleGlb(weapon, files, settings, pngWriter(STUDIO.pngLevel)).catch(() => null);
  const bytes = built?.bytes;
  if (!bytes || bytes.byteLength > STUDIO.maxBytes) {
    throw new Error(`Модель «${weapon.name || model}» не разобралась или слишком велика для студии.`);
  }
  return chosen.length ? { bytes, parts: describeParts(built.placed, attached) } : { bytes };
}
