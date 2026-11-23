import sharp from "sharp";
import * as rpf from "@modovik/rpf7/node";
import * as rage from "@modovik/rage-drawable";
import * as placement from "@modovik/climb-contract/recolor/placement";
import * as shops from "./recolor-shops-scene.js";

const DEFAULT_COLOUR = "#9a958c";
const ALPHA_KINDS = "opaque cutout blend".split(" ");
const FOLIAGE_BUCKET = 3;
const SHEET_QUALITY = 92;
// Идентификатор сэмплера палитры цвета вещи карты (без знака, как его отдаёт читатель моделей).
const PALETTE_SAMPLER = rage.joaat("TintPaletteSampler") >>> 0;

const keepPoint = (point) => point;
const keepEverything = () => true;

const lowered = (value) => (value ? String(value) : "").toLowerCase();
const lowerNameOf = (item) => lowered(item?.name);
const diffuseNameOf = (material) => lowered(material?.textures?.diffuse);
const modelFileOf = (place) => String(place.model).toLowerCase() + ".ydr";
const glue = (separator, ...parts) => parts.map(String).join(separator);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const attempt = (task, fallback) => {
  try {
    return task();
  } catch {
    return fallback;
  }
};
const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, source[key]]));
// Недостающие (undefined) поля запроса берутся из таблицы умолчаний, null остаётся как есть.
const withDefaults = (given, defaults) =>
  Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, given[key] === undefined ? fallback : given[key]]));

const alphaKindOf = (material) => ALPHA_KINDS.find((kind) => kind === material.alphaMode) ?? "opaque";
// Y-вверх (формат модели) -> Z-вверх (игра)
const gameAxes = (list, at) => [list[at], -list[at + 2], list[at + 1]];

const embeddedNamed = (drawable, name) => {
  const sheets = drawable.embeddedTextures || [];
  return sheets[sheets.findIndex((sheet) => lowerNameOf(sheet) === name)];
};

export function placedModModels(placements = [], files = []) {
  const present = files.map(lowerNameOf).reduce((names, name) => names.add(name), new Set());
  const isPlaced = (place) => present.has(modelFileOf(place));
  return placements.filter(isPlaced);
}

export async function embeddedSheet(ref, options = {}) {
  const limit = options.maxSize === undefined ? 0 : options.maxSize;
  const { rgba, width, height } = rage.decodeTextureRef(ref, limit ? { maxSize: limit } : { level: 0 });
  // вид на те же байты, без копирования
  const view = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const encoded = await sharp(view, { raw: { width, height, channels: 4 } })
    .webp({ quality: SHEET_QUALITY })
    .toBuffer();
  return new Uint8Array(encoded);
}

export function firstDrawable(bytes) {
  return attempt(() => rage.readDrawable(new Uint8Array(bytes), { inflateRaw: rpf.inflateRawNode }).drawables[0], null);
}

// Что нужно знать о материале сетки: имя листа, вид прозрачности, признаки и палитра.
function plainSurface(material, { alphaOf, textureOf }) {
  const name = diffuseNameOf(material);
  let texture = null;
  if (name) texture = textureOf(name);
  const alpha = alphaOf(material || {});
  return { name, alpha, texture, flags: null };
}

function paletteOf(material, tint) {
  const samplers = material?.samplers || [];
  const sampler = samplers[samplers.findIndex((entry) => (entry.sampler >>> 0) === PALETTE_SAMPLER)];
  const paletteName = lowered(sampler?.texture);
  // пустое имя — палитру не запрашиваем вовсе
  return paletteName ? tint.palette(paletteName) || null : null;
}

function shopSurface(material, { textureOf, tint }) {
  const shopClass = shops.shopMaterialClass(material);
  if (!shopClass) return null;
  const name = diffuseNameOf(material) || lowered(shops.diffuseOf(material));
  const palette = shopClass.tint ? paletteOf(material, tint) : null;
  let texture = null;
  if (name) texture = textureOf(name);
  const vertex = Boolean(palette || shopClass.vertexAlpha);
  return { name, alpha: shopClass.alpha, texture, flags: { shopClass, palette, vertex } };
}

const describeSurface = (material, settings) => (settings.tint ? shopSurface : plainSurface)(material, settings);

function materialRecord(state, surface, slot) {
  const { name, alpha, flags } = surface;
  const where = slot ?? "none";
  const finish = { colour: state.colour, texture: slot };
  if (!flags) {
    return { id: glue("|", where, alpha), name, alpha, doubleSided: alpha !== "opaque", ...finish };
  }
  const { shopClass, vertex } = flags;
  const decal = Boolean(shopClass.decal);
  return {
    id: glue("|", where, alpha, decal ? 1 : 0, shopClass.emission, vertex ? 1 : 0),
    name,
    alpha,
    ...(decal && { decal: true }),
    ...(shopClass.emission && { emissive: true, emission: shopClass.emission }),
    ...(vertex && { vertex: true }),
    doubleSided: alpha === "blend" && !decal,
    ...finish,
  };
}

// Занести запись в список и в таблицу «ключ -> место»; повторный ключ возвращает прежнее место.
function enlist(list, slots, key, item) {
  if (!slots.has(key)) {
    slots.set(key, list.length);
    list.push(item);
  }
  return slots.get(key);
}

const slotOfTexture = (state, found) =>
  found ? enlist(state.textures, state.textureSlots, found.key, found.entry) : null;

// Цвета вершин: по умолчанию белые; цвет берётся из палитры по синему каналу вершины,
// а при vertexAlpha у класса альфа переносится с вершины.
function vertexColoursOf(mesh, count, flags, tint) {
  const { palette, shopClass } = flags;
  const colours = new Float32Array(count * 4).fill(1);
  const source = mesh.colours;
  if (!source) return colours;
  const row = palette ? clamp(Number(tint.row) || 0, 0, palette.height - 1) : 0;
  for (let first = 0; first < colours.length; first += 4) {
    if (palette) {
      const column = clamp(Math.round(source[first + 2] * 255), 0, palette.width - 1);
      const from = (row * palette.width + column) * 4;
      colours.set([0, 1, 2].map((shift) => palette.rgba[from + shift] / 255), first);
    }
    if (shopClass.vertexAlpha) colours[first + 3] = source[first + 3];
  }
  return colours;
}

function appendMesh(state, mesh, settings) {
  const { keep, move, turn, tint } = settings;
  if (!mesh.indices?.length || !keep(mesh)) return;
  const surface = describeSurface(mesh.material, settings);
  if (!surface) return;
  const textureSlot = slotOfTexture(state, surface.texture);
  const record = materialRecord(state, surface, textureSlot);
  const material = enlist(state.materials, state.materialSlots, record.id, record);

  const count = mesh.positions.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let at = 0; at < count * 3; at += 3) {
    positions.set(move(gameAxes(mesh.positions, at)), at);
    if (mesh.normals) normals.set(turn(gameAxes(mesh.normals, at)), at);
  }
  const uvs = mesh.uvs ? new Float32Array(mesh.uvs) : null;
  const shaded = surface.flags?.vertex ? { colours: vertexColoursOf(mesh, count, surface.flags, tint) } : {};
  state.meshes.push({ positions, normals, uvs, ...shaded, indices: mesh.indices, material, part: 0 });
}

function boundsOf(meshes) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of meshes) {
    positions.forEach((value, index) => {
      const axis = index % 3;
      low[axis] = Math.min(low[axis], value);
      high[axis] = Math.max(high[axis], value);
    });
  }
  return { min: low, max: high };
}

function sealScene(state, part) {
  if (!state.meshes.length) return null;
  const bounds = boundsOf(state.meshes);
  const scene = { bounds, parts: [{ id: part, bounds }], ...pick(state, ["materials", "textures", "meshes"]) };
  return new Uint8Array(shops.encodeShopScene(scene));
}

const ADD_DEFAULTS = { move: keepPoint, turn: keepPoint, alphaOf: alphaKindOf, keep: keepEverything, tint: null };
const settingsOf = (options) => ({ textureOf: options.textureOf, ...withDefaults(options, ADD_DEFAULTS) });

export function sceneBuilder(options = {}) {
  const colour = options.colour === undefined ? DEFAULT_COLOUR : options.colour;
  const state = {
    colour,
    meshes: [],
    materials: [],
    materialSlots: new Map(),
    textures: [],
    textureSlots: new Map(),
  };
  return {
    textures: state.textures,
    /** Сцена без кодирования — `{ bounds, parts, materials, textures, meshes }` (или `null`, если сеток нет): её склеивают с другой (`stock-building.js`). */
    scene(part) {
      if (!state.meshes.length) return null;
      const bounds = boundsOf(state.meshes);
      return { bounds, parts: [{ id: part, bounds }], ...pick(state, ["materials", "textures", "meshes"]) };
    },
    add(drawable, given) {
      const settings = settingsOf(given);
      [...drawable.meshes].forEach((mesh) => appendMesh(state, mesh, settings));
    },
    finish: (part) => sealScene(state, part),
  };
}

// Палитра вещи карты — вшитый лист модели; расшифровывается один раз на ссылку.
const paletteReader = (drawable, decoded) => (name) => {
  const ref = embeddedNamed(drawable, name);
  if (ref && !decoded.has(ref)) decoded.set(ref, rage.decodeTextureRef(ref, { level: 0 }));
  return ref ? decoded.get(ref) : null;
};

const modTexture = (fileName, name) => ({
  key: glue("|", fileName, name),
  entry: { name: glue(":", "m", fileName, name), set: "mod", resource: fileName, texture: name },
});

// Выбор листа для места: лист мода (запоминается для кодирования) или лист игры по адресу.
function textureResolver({ place, fileName, drawable, modFile, stock, wanted, gameEntries }) {
  return (name) => {
    const embedded = embeddedNamed(drawable, name);
    if (modFile && embedded) {
      if (!wanted.has(name)) wanted.set(name, embedded);
      return modTexture(fileName, name);
    }
    if (!stock) return null;
    const address = embedded
      ? place.at
      : place.prop
        ? place.sheet || place.at
        : stock.hint?.get(name) || stock.fallback;
    if (!address) return null;
    const key = glue("", "game:", address, "/", name).toLowerCase();
    const entry = { name: glue(":", "g", fileName, name), game: address, texture: name };
    gameEntries.set(key, entry); // при повторе ключа запись заменяется, место в порядке остаётся первым
    return { key, entry };
  };
}

const REQUEST_DEFAULTS = () => ({ placements: [], files: [], centre: [0, 0, 0], part: "shell", stock: null });

export async function modPlaceScene(request) {
  const { placements, files, centre, part, stock } = withDefaults(request, REQUEST_DEFAULTS());
  const visited = !stock ? placedModModels(placements, files) : placements;
  // имя в нижнем регистре -> файл; при одинаковых именах побеждает последний,
  // а дырка в разреженном списке делает запись не-парой и бросает TypeError
  const names = files.map(lowerNameOf);
  const modFiles = new Map(names.map((name, at) => [name, files[at]]));
  const builder = sceneBuilder();
  const sheets = [];
  const sheetKeys = new Set();
  const gameEntries = new Map();
  const decodedPalettes = new Map();

  for (const place of visited) {
    const fileName = modelFileOf(place);
    const modFile = modFiles.get(fileName);
    const bytes = modFile ? modFile.bytes : place.at ? await stock.read(place.at).catch(() => null) : undefined;
    const drawable = bytes ? firstDrawable(bytes) : null;
    if (!drawable) continue;

    const shifted = place.position.map((value, axis) => value - centre[axis]);
    const move = placement.placementTransform({ ...place, position: shifted });
    const turn = placement.placementRotation(place);
    const tint = place.prop ? { row: place.tint, palette: paletteReader(drawable, decodedPalettes) } : null;

    // листы этой модели, вшитые в файл мода: имя -> ссылка (в порядке обращений)
    const wanted = new Map();
    const textureOf = textureResolver({ place, fileName, drawable, modFile, stock, wanted, gameEntries });
    builder.add(drawable, { move, turn, textureOf, tint });

    // листы этого места кодируются сразу, до чтения модели следующего
    for (const name of wanted.keys()) {
      const key = glue("/", "set:mod", fileName, name);
      if (sheetKeys.has(key)) continue;
      const encoded = await embeddedSheet(wanted.get(name));
      sheets.push({ key, bytes: encoded });
      sheetKeys.add(key);
    }
  }

  const scene = builder.finish(part);
  return scene && { bytes: scene, sheets, game: Array.from(gameEntries.values()) };
}

const stockTexture = (at) => (name) => ({ key: name, entry: { name: glue(":", "g", name), game: at, texture: name } });

export function stockModelScene(request) {
  const { bytes, at } = request;
  const part = request.part === undefined ? "model" : request.part;
  const drawable = firstDrawable(bytes);
  if (!drawable) return null;
  const builder = sceneBuilder();
  builder.add(drawable, {
    // Листва: непрозрачный материал в корзине отрисовки 3 рисуется вырезным.
    alphaOf: (material) => {
      const kind = alphaKindOf(material);
      const foliage = material.renderBucket === FOLIAGE_BUCKET;
      return kind === "opaque" && foliage ? "cutout" : kind;
    },
    // Теневая оболочка кроны без диффузного листа в сцену не идёт.
    keep: (mesh) => !!mesh.material?.textures?.diffuse,
    textureOf: stockTexture(at),
  });
  const scene = builder.finish(part);
  return scene ? { bytes: scene, textures: builder.textures } : null;
}
