// Дрифт-машина кадра «Дым из-под колёс»: GLB и опись из .yft/.ytd игры игрока, кэш на диске.
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import sharp from "sharp";
import { inflateResource } from "@modovik/native-rs";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { writeGlb } from "@modovik/rage-drawable/glb";
import { keysFromDirectory } from "@modovik/rpf7/node";
import { readVehicle, readTextureDictionary, decodeTextureRef, joaat } from "@modovik/rage-drawable";
import { archiveKeysDirectory, provisionArchiveSupport } from "./loader-provisioner.js";
import { createGameReader } from "./optimization-layers.js";

export const WHEEL_SMOKE_GAME_CAR = Object.freeze({
  model: "driftzr350",
  name: "Annis ZR350",
  pack: "update/x64/dlcpacks/mp2023_02/dlc.rpf",
  folder: "x64/levels/gta5/vehicles/mp2023_02.rpf"
});

// Номер сборщика входит в ключ кэша: меняется то, что попадает в GLB, — меняется номер.
const BUILDER_VERSION = 2;
const SHEET_MAX_SIZE = 1024;
const GLB_LIMIT_BYTES = 48 * 1024 * 1024;
const CACHE_FOLDER = "wheel-smoke-car";
const SHARED_ARCHIVE = "x64e.rpf";
const SHARED_DICTIONARY = `${SHARED_ARCHIVE}:levels/gta5/vehicles.rpf/vehshare.ytd`;

const REASON_NO_GAME = "Подключите GTA V: машина кадра берётся из вашей игры.";
const REASON_NO_PACK = "В вашей игре нет дополнения с дрифт-машиной.";
const REASON_TOO_BIG = "Машина из игры слишком велика для кадра.";
const REASON_PACK_UNREADABLE = "Дополнение с дрифт-машиной в вашей игре не открылось.";

function reasonNoModel(model) {
  return `Модели ${model} нет в вашей игре.`;
}

function unavailable(reason) {
  return { status: "unavailable", reason };
}

// ---------- шейдеры и роли ----------

// Списки имён записаны строкой через пробел.
const words = (text) => text.split(" ");

const paintShaders = (suffix) => words("1 2 3 4 5 6 7 8 9").map((n) => `vehicle_paint${n}${suffix}`);

const KNOWN_SHADERS = [
  ...paintShaders(""),
  ...paintShaders("_enveff"),
  ...words("vehicle_paint3_lvr vehicle_shuts"),
  ...words("vehicle_mesh vehicle_mesh_enveff vehicle_mesh2_enveff vehicle_cutout vehicle_licenseplate"),
  ...words("vehicle_track vehicle_track2"),
  ...words("vehicle_interior vehicle_interior2 vehicle_detail vehicle_detail2 vehicle_dash_emissive"),
  ...words("vehicle_dash_emissive_opaque vehicle_cloth vehicle_cloth2"),
  ...words("vehicle_vehglass vehicle_vehglass_inner"),
  ...words("vehicle_lights vehicle_lightsemissive vehicle_lightsemissive_siren vehicle_emissive_opaque"),
  ...words("vehicle_emissive_alpha vehicle_badges vehicle_decal vehicle_decal2"),
  ...words("vehicle_tire vehicle_tire_emissive"),
];
// Хеш в материале модели: восемь шестнадцатеричных знаков без «0x».
const hashKey = (name) => (joaat(name) >>> 0).toString(16).padStart(8, "0");
const SHADER_BY_HASH = new Map(KNOWN_SHADERS.map((name) => [hashKey(name), name]));

const PAINT_SHADER = /^vehicle_paint[0-9](_enveff|_lvr)?$/;
// Точные имена остальных ролей; всё незнакомое и пустое — пластик (trim).
const SHADERS_OF_ROLE = [
  ["trim", "vehicle_mesh vehicle_mesh_enveff vehicle_mesh2 vehicle_mesh2_enveff vehicle_cutout "
    + "vehicle_licenseplate vehicle_track vehicle_track2"],
  ["interior", "vehicle_interior vehicle_interior2 vehicle_detail vehicle_detail2 vehicle_dash_emissive "
    + "vehicle_dash_emissive_opaque vehicle_cloth vehicle_cloth2"],
  ["glass", "vehicle_vehglass vehicle_vehglass_inner"],
  ["lights", "vehicle_lights vehicle_lightsemissive vehicle_lightsemissive_siren vehicle_emissive_opaque "
    + "vehicle_emissive_alpha"],
  ["badge", "vehicle_badges"],
  ["decal", "vehicle_decal vehicle_decal2"],
  ["tyre", "vehicle_tire vehicle_tire_emissive"],
];
const ROLE_OF_SHADER = new Map();
for (const [role, names] of SHADERS_OF_ROLE) {
  for (const name of words(names)) ROLE_OF_SHADER.set(name, role);
}

const ROLE_COLOURS = Object.fromEntries(
  words("paint=#c8c8c8 trim=#1a1a1c interior=#202022 glass=#0c1214 lights=#f2efe6 "
    + "badge=#b9b9b9 decal=#ffffff tyre=#131314 rim=#b9bdc3").map((pair) => pair.split("=")),
);
const TEXTURED_ROLES = new Set(words("trim interior lights badge decal tyre rim"));
const ALPHA_ROLES = new Set(words("badge decal"));
const BLEND_ROLES = new Set(words("glass badge decal"));
const FLAT_SHEETS = new Set(words("vehicle_generic_smallspecmap black blank white nodirt vehicle_genericmud_car"));

function isFlatSheet(sheet) {
  return FLAT_SHEETS.has(sheet) || sheet.endsWith("_spec") || sheet.endsWith("_s");
}

function isTyreSheet(sheet) {
  return ["tyre", "tire"].some((part) => sheet.includes(part));
}

function sheetOf(material) {
  const named = material?.textures?.diffuse;
  return String(named || "").toLowerCase();
}

function shaderRole(shader) {
  const isPaint = PAINT_SHADER.test(shader) || shader === "vehicle_shuts";
  return isPaint ? "paint" : (ROLE_OF_SHADER.get(shader) ?? "trim");
}

export function carRole(material, options = {}) {
  const { wheel = false } = options;
  const typed = String(material?.shader || "").toLowerCase();
  const bare = typed.startsWith("0x") ? typed.slice(2) : typed;
  const shader = SHADER_BY_HASH.get(bare) ?? typed;
  const tyreSheet = isTyreSheet(sheetOf(material));
  if (wheel) return tyreSheet ? "tyre" : "rim";
  const role = shaderRole(shader);
  if (role !== "tyre") return role;
  return tyreSheet ? "tyre" : "trim";
}

// ---------- геометрия ----------

// Оси рисунка (вверх — Y) -> оси игры (вверх — Z, нос к +Y).
function toGame(x, y, z) {
  return [x, -z, y];
}
function thousandths(v) {
  return Math.round(v * 1000) / 1000;
}
function floorHundredths(v) {
  return Math.floor(v * 100) / 100;
}
function ceilHundredths(v) {
  return Math.ceil(v * 100) / 100;
}

function* vertexTriples(values) {
  for (let i = 0; i < values.length; i += 3) yield [values[i], values[i + 1], values[i + 2]];
}

/** Рамка по трём осям; колесо описывается ею же: радиус — это reach(), ширина — thickness(). */
class Box {
  min = [Infinity, Infinity, Infinity];
  max = [-Infinity, -Infinity, -Infinity];

  grow(point) {
    point.forEach((value, axis) => {
      this.min[axis] = Math.min(this.min[axis], value);
      this.max[axis] = Math.max(this.max[axis], value);
    });
  }

  /** Раздвигает нижнюю границу по low, верхнюю — по high (оси независимы). */
  extend(low, high) {
    this.min = this.min.map((value, axis) => Math.min(value, low[axis]));
    this.max = this.max.map((value, axis) => Math.max(value, high[axis]));
  }

  reach() {
    return Math.max(-this.min[2], this.max[2], -this.min[1], this.max[1]);
  }

  thickness() {
    return this.max[0] - this.min[0];
  }
}

const inflateRaw = (bytes, size) => inflateResource(bytes, size);

// ---------- материалы и картинки листов ----------

const wantsSheet = (role, sheet) => TEXTURED_ROLES.has(role) && sheet !== "" && !isFlatSheet(sheet);

function materialEntry(role, sheet, image) {
  return {
    name: role === "paint" ? "paint" : sheet || role,
    ...(image === null ? {} : { baseColorTexture: image }),
    alphaMode: BLEND_ROLES.has(role) ? "BLEND" : "OPAQUE",
    doubleSided: role === "glass",
    extras: { role, colour: ROLE_COLOURS[role], textured: image !== null }
  };
}

async function encodeSheet(decoded, withAlpha) {
  const { rgba, width, height } = decoded;
  const pixels = sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width, height, channels: 4 }
  });
  const encoded = await (withAlpha
    ? pixels.png({ compressionLevel: 8 })
    : pixels.removeAlpha().jpeg({ quality: 88 })
  ).toBuffer();
  return {
    bytes: new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength),
    mimeType: withAlpha ? "image/png" : "image/jpeg"
  };
}

/** Результат (в том числе null) запоминается на время сборки. */
async function remember(cache, key, make) {
  if (!cache.has(key)) cache.set(key, await make());
  return cache.get(key);
}

class MaterialBook {
  materials = [];
  images = [];
  #sheets;
  #materialIndex = new Map();
  #imageIndex = new Map();

  constructor(sheets) {
    this.#sheets = sheets;
  }

  /** Номер картинки листа в списке либо null. */
  imageOf(sheet, withAlpha) {
    return remember(this.#imageIndex, `${sheet}|${withAlpha}`, async () => {
      try {
        const ref = this.#sheets.get(sheet);
        if (!ref || !ref.complete) return null;
        const decoded = decodeTextureRef(ref, { maxSize: SHEET_MAX_SIZE });
        if (!decoded?.rgba) return null;
        return this.images.push(await encodeSheet(decoded, withAlpha)) - 1;
      } catch {
        return null;
      }
    });
  }

  indexOf(material, wheel) {
    const role = carRole(material, { wheel });
    const sheet = sheetOf(material);
    const textured = wantsSheet(role, sheet);
    return remember(this.#materialIndex, `${role}|${textured ? sheet : ""}`, async () => {
      const image = textured ? await this.imageOf(sheet, ALPHA_ROLES.has(role)) : null;
      return this.materials.push(materialEntry(role, sheet, image)) - 1;
    });
  }
}

// ---------- сборка GLB ----------

/** Копия троек через преобразование convert(x, y, z) -> [x, y, z] в Float32Array. */
function remap(values, convert) {
  const out = new Float32Array(values.length);
  for (let i = 0; i < out.length; i += 3) {
    convert(values[i], values[i + 1], values[i + 2]).forEach((value, axis) => {
      out[i + axis] = value;
    });
  }
  return out;
}

/**
 * Сетка для writeGlb. Кузов сдвигается на начало и растит рамку; колесо остаётся в своих осях.
 * Нормали переводятся в оси игры, но не сдвигаются.
 */
async function gameMesh(mesh, name, book, wheel, shift = null, box = null) {
  const positions = remap(mesh.positions, (x, y, z) => {
    const point = toGame(x, y, z);
    const placed = shift ? point.map((value, axis) => value - shift[axis]) : point;
    if (box) box.grow(placed);
    return placed;
  });
  const out = { name, positions };
  if (mesh.normals) out.normals = remap(mesh.normals, toGame);
  if (mesh.uvs) out.uvs = mesh.uvs;
  out.indices = mesh.indices;
  out.material = await book.indexOf(mesh.material, wheel);
  return out;
}

function measureWheel(vehicle) {
  const box = new Box();
  for (const mesh of vehicle.wheel.meshes) {
    for (const [x, y, z] of vertexTriples(mesh.positions)) box.grow(toGame(x, y, z));
  }
  return { radius: box.reach(), width: box.thickness() };
}

// [id колеса, ось]: начало координат — середина между осями, земля под шинами.
const AXLE_OF = [["lf", "front"], ["rf", "front"], ["lr", "rear"], ["rr", "rear"]];

function groundOrigin(vehicle, radius) {
  const anchors = new Map(vehicle.wheels.map((wheel) => [wheel.id, wheel.position]));
  const ys = { front: [], rear: [] };
  for (const [id, axle] of AXLE_OF) ys[axle].push(anchors.get(id)[1]);
  const axleY = (list) => (list[0] + list[1]) / 2;
  const hubHeight = Math.min(...vehicle.wheels.map((wheel) => wheel.position[2]));
  return [0, (axleY(ys.front) + axleY(ys.rear)) / 2, hubHeight - radius];
}

function addSheets(sheets, list) {
  for (const ref of list) {
    const key = ref.name.toLowerCase();
    if (!sheets.has(key)) sheets.set(key, ref);
  }
}

/** Листы текстур: встроенные сильнее словарей, ранние словари сильнее поздних. */
function collectSheets(vehicle, dictionaries) {
  const sheets = new Map();
  addSheets(sheets, vehicle.body.embeddedTextures || []);
  for (const bytes of dictionaries) {
    try {
      addSheets(sheets, readTextureDictionary(openResourceWith(bytes, inflateRaw)));
    } catch {
      // словарь не читается — берём остальные
    }
  }
  return sheets;
}

async function emitMeshes(vehicle, sheets, origin) {
  const book = new MaterialBook(sheets);
  const bodyBox = new Box();
  const meshes = [];
  for (const mesh of vehicle.body.meshes) {
    meshes.push(await gameMesh(mesh, "body", book, false, origin, bodyBox));
  }
  if (!meshes.some((mesh) => book.materials[mesh.material].extras.role === "paint")) {
    throw new Error("У машины игры не нашлось кузова — модель другая?");
  }
  for (const mesh of vehicle.wheel.meshes) {
    meshes.push(await gameMesh(mesh, "wheel", book, true));
  }
  return { meshes, book, bodyBox };
}

const placeWheels = (vehicle, origin, { radius, width }) =>
  vehicle.wheels.map(({ id, position }) => ({
    id,
    position: position.map((value, axis) => thousandths(value - origin[axis])),
    radius: thousandths(radius),
    width: thousandths(width)
  }));

/** Габариты: рамка кузова плюс выступ каждого колеса вокруг его округлённой позиции. */
function reachBounds(bodyBox, wheels, { radius, width }) {
  for (const { position: [px, py, pz] } of wheels) {
    bodyBox.extend([px - width / 2, py - radius, pz - radius], [px + width / 2, py + radius, pz + radius]);
  }
  return { min: bodyBox.min.map(floorHundredths), max: bodyBox.max.map(ceilHundredths) };
}

export async function buildWheelSmokeCar({ model, dictionaries = [] }, { name = "car" } = {}) {
  const vehicle = readVehicle(model, { inflateRaw });
  if (!vehicle.wheel) throw new Error("У машины в игре нет модели колеса.");
  if (vehicle.wheels.length !== 4) throw new Error("У машины в игре не четыре колеса.");

  const size = measureWheel(vehicle);
  const origin = groundOrigin(vehicle, size.radius);
  const sheets = collectSheets(vehicle, dictionaries);
  const { meshes, book, bodyBox } = await emitMeshes(vehicle, sheets, origin);

  const wheels = placeWheels(vehicle, origin, size);
  const bounds = reachBounds(bodyBox, wheels, size);
  const glb = writeGlb({ meshes, materials: book.materials, images: book.images, name });
  const exhaust = vehicle.exhaust ? vehicle.exhaust.map((value, axis) => thousandths(value - origin[axis])) : null;
  return { glb, wheels, bounds, exhaust, wheelSide: vehicle.wheel.bone };
}

// ---------- чтение из игры и кэш ----------

// Сборки, которые идут сейчас: путь файла GLB -> общее обещание.
const assembling = new Map();

function bytesView(entry) {
  const { buffer, byteOffset, byteLength } = entry;
  return new Uint8Array(buffer, byteOffset, byteLength);
}

function copyToArrayBuffer(view) {
  const { buffer, byteOffset, byteLength } = view;
  return buffer.slice(byteOffset, byteOffset + byteLength);
}

async function openGameFromDisk(root, keysDirectory) {
  const keys = await keysFromDirectory(keysDirectory || "");
  return createGameReader(root, keys);
}

function defaultTools() {
  return Object.fromEntries([
    ["archiveSupport", provisionArchiveSupport],
    ["openGame", openGameFromDisk],
    ["buildCar", buildWheelSmokeCar],
  ]);
}

const absentStamp = (label) => `${label}:-`;

function stampOf(gameRoot, label) {
  const location = path.join(gameRoot, ...label.split("/"));
  return fs.stat(location).then(
    (info) => `${label}:${info.size}:${Math.round(info.mtimeMs)}`,
    () => absentStamp(label),
  );
}

// Стадии чтения: каждая видит общий контекст c и либо возвращает готовый ответ, либо ничего.

function acceptRoot(c) {
  const root = String(c.input?.gameRoot || "").trim();
  c.gameRoot = root;
  const usable = root !== "" && path.isAbsolute(root);
  return usable ? undefined : unavailable(REASON_NO_GAME);
}

async function stampArchives(c) {
  const pack = await stampOf(c.gameRoot, WHEEL_SMOKE_GAME_CAR.pack);
  const shared = await stampOf(c.gameRoot, SHARED_ARCHIVE);
  if (pack === absentStamp(WHEEL_SMOKE_GAME_CAR.pack)) return unavailable(REASON_NO_PACK);
  c.stamp = `${pack}|${shared}`;
  return undefined;
}

function deriveKey(c) {
  const identity = [BUILDER_VERSION, WHEEL_SMOKE_GAME_CAR.model, c.gameRoot.toLowerCase(), c.stamp];
  const key = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 32);
  c.cacheDir = path.join(c.stateDir || os.tmpdir(), CACHE_FOLDER);
  c.keyedName = `${WHEEL_SMOKE_GAME_CAR.model}-${key}`;
  c.glbPath = path.join(c.cacheDir, `${c.keyedName}.glb`);
  c.metaPath = path.join(c.cacheDir, `${c.keyedName}.json`);
  return undefined;
}

function parseOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readCache(c) {
  const stored = await Promise.all([fs.readFile(c.glbPath), fs.readFile(c.metaPath, "utf8")]).catch(() => null);
  if (!stored) return undefined;
  const [glbFile, description] = stored;
  // Порченое описание (оборванная запись, ручная правка) — как отсутствие кэша: машина соберётся заново и перепишет файлы.
  const car = parseOrNull(description);
  if (!car) return undefined;
  return { status: "ready", glb: copyToArrayBuffer(glbFile), car, cached: true };
}

// Стадии сборки: модель и словари из игры, GLB, запись в кэш.

async function fetchSources(c) {
  const { game } = c;
  const car = WHEEL_SMOKE_GAME_CAR;
  const failures = [];
  const read = (at) =>
    game.read(at).catch((error) => {
      failures.push(error);
      return null;
    });
  const folder = `${car.pack}:${car.folder}`;

  let modelEntry = await read(`${folder}/${car.model}_hi.yft`);
  if (!modelEntry) {
    modelEntry = await read(`${folder}/${car.model}.yft`);
  }
  if (!modelEntry) {
    // Чтец архивов на дополнении, которое не открылось, отвечает на чтение «нет» и отдаёт пустой список папки:
    // это не «машины нет в игре» — о таком отказе скажем отдельно.
    let listing = null;
    if (failures.length === 0) {
      listing = await Promise.resolve(game.list?.(folder)).catch(() => []);
    }
    const emptyFolder = Array.isArray(listing) && listing.length === 0;
    const unreadable = failures.length > 0 || emptyFolder;
    return unavailable(unreadable ? REASON_PACK_UNREADABLE : reasonNoModel(car.model));
  }
  c.model = bytesView(modelEntry);

  // Словари читаются все и по порядку: сначала свои, потом общий.
  const wanted = [`${folder}/${car.model}+hi.ytd`, `${folder}/${car.model}.ytd`, SHARED_DICTIONARY];
  c.dictionaries = [];
  for (const at of wanted) {
    const entry = await read(at);
    if (!entry) continue;
    c.dictionaries.push(bytesView(entry));
  }
  return undefined;
}

async function buildCar(c) {
  const car = WHEEL_SMOKE_GAME_CAR;
  const request = { model: c.model, dictionaries: c.dictionaries };
  const built = await c.t.buildCar(request, { name: car.model });
  if (built.glb.byteLength > GLB_LIMIT_BYTES) return unavailable(REASON_TOO_BIG);
  c.built = built;
  const measured = Object.fromEntries(["wheels", "bounds", "exhaust"].map((key) => [key, built[key]]));
  c.description = { model: car.model, name: car.name, ...measured };
  return undefined;
}

async function storeCar(c) {
  const { cacheDir, keyedName, built } = c;
  const dropQuietly = (file) => fs.rm(path.join(cacheDir, file)).catch(() => {});
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    const names = await fs.readdir(cacheDir).catch(() => []);
    const stale = names.filter((file) => !file.startsWith(`${keyedName}.`));
    for (const file of stale) await dropQuietly(file);
    await fs.writeFile(c.glbPath, built.glb);
    await fs.writeFile(c.metaPath, JSON.stringify(c.description));
  } catch {
    // Кэш не записался (диск, права, занятая папка): машина уже собрана — отдаём её, в следующий раз соберётся снова.
  }
  return { status: "ready", glb: copyToArrayBuffer(built.glb), car: c.description };
}

const ASSEMBLY_STAGES = [fetchSources, buildCar, storeCar];

async function assemble(c) {
  const { t } = c;
  const request = { keys: c.input?.keys, stateDir: c.stateDir, provision: t.archiveSupport };
  const keys = await archiveKeysDirectory(request);
  const game = await t.openGame(c.gameRoot, keys);
  c.game = game;
  try {
    for (const stage of ASSEMBLY_STAGES) {
      const reply = await stage(c);
      if (reply) return reply;
    }
    return undefined;
  } finally {
    await game.close?.();
  }
}

function joinAssembly(c) {
  const known = assembling.get(c.glbPath);
  if (known) return known;
  const started = assemble(c).finally(() => {
    assembling.delete(c.glbPath);
  });
  assembling.set(c.glbPath, started);
  return started;
}

const READ_STAGES = [acceptRoot, stampArchives, deriveKey, readCache, joinAssembly];

export async function readWheelSmokeCar(input, stateDir, tools = {}) {
  const t = Object.assign(defaultTools(), tools);
  const c = { input, stateDir, t };
  for (const stage of READ_STAGES) {
    const reply = await stage(c);
    if (reply) return reply;
  }
  return undefined;
}
