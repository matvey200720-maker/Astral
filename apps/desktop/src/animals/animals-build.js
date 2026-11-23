/*
 * Сборка облика животных в файлы игры (05.11.2026) — функция потока чтения игры (`game-read-host.js`): читает файлы животных из
 * игры человека, красит листы, дописывает метку и свечение в модель и складывает всё в пакет движка установки.
 *
 *   • перекраска — только пиксели листов `*_diff_*` в словарях `.ytd` животного: размер, формат и число ступеней листа те же,
 *     остальные листы и байты словаря не трогаются (запись «на месте» движком, `ytd-texture-patch`); цвет считают те же
 *     формулы, что рисуют кадр окна (`@modovik/climb-contract/recolor/colour`);
 *   • метка и свечение — новая геометрия в модели тела `.ydd` (нативная команда `patch-animal-model`); `.yft` — скелет, физика
 *     и хитбокс — не читается и не пишется вовсе. Метка — одного из трёх видов (06.11.2026): готовый значок, своя картинка
 *     человека (лист-атлас 256×128) или копия сетки тела самого животного одним цветом (`buildModelMarker`) — все три идут
 *     той же командой хоста;
 *   • пакет — `local-legacy-animals-<хэш>`: имя и версия считаются от содержимого, повторное «Применить» тем же обликом архив
 *     игры не пересобирает.
 *
 * Игра и её файлы не меняются: читаются копии, итог лежит в папке состояния Astral до установки движком.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { BLOCK_FORMATS, bleedTransparent, encodeDds, fullMipLevels } from "@modovik/dds";
import {
  ANIMAL_LIMITS,
  EMBLEM_ATLAS,
  EMBLEM_HASH,
  EMBLEM_POLE_UV,
  MARKER_ATLAS,
  MODEL_CULL_RADIUS,
  animalById,
  animalEntryAt,
  animalEmblemHashes,
  animalInstallable,
  animalLookProblems,
  animalLookTouchesModel,
  animalsProjectIsEmpty,
  buildMarkerMesh,
  buildModelMarker,
  fitMarkerHeight,
  iconSvg,
  markerTop,
  measureModelMarker,
  normalizeAnimalsProject,
} from "@modovik/climb-contract/animals";
import { meanLuma, hexBytes } from "@modovik/climb-contract/recolor/colour";
import { tintRgba } from "@modovik/climb-contract/recolor/pixels";
import { decodeTextureRef, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { inflateRawNode } from "@modovik/rpf7/node";
import { buildAnimalsManifest, isLocalAnimalsManifest } from "@modovik/install-engine/animals-manifest-trust.js";
import { animalFilesInGame, readBodyParts } from "./animal-reads.js";
import { readerCall } from "../game-archive-reader.js";
import { provisionArchiveSupport } from "../loader-provisioner.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export { fitMarkerHeight };

/** Версия сборки: растёт, когда меняется то, что получается из того же облика (входит в имя пакета через содержимое). */
export const ANIMALS_BUILD = 1;

async function readerFor(gameRoot, stateDir, extra) {
  if (extra?.reader) return extra.reader;
  const support = await provisionArchiveSupport({ stateDir }).catch(() => null);
  const keys = support?.directory || "";
  return {
    has: (at) => readerCall(gameRoot, keys, "has", [at]),
    read: (at) => readerCall(gameRoot, keys, "read", [at]),
    list: (at) => readerCall(gameRoot, keys, "list", [at]),
  };
}

/* ----------------------------------------------------------- перекраска */

/*
 * Запись листов в словарь на месте — командой движка `ytd-texture-patch` (Rust): список правок идёт файлом рядом с выходом,
 * размер, формат и число ступеней листа движок сверяет сам. Тот же вызов делает `rpf-composer.js`; здесь он без помощника,
 * чтобы работать в потоке чтения игры.
 */
export const enginePatchYtd = (native) => async ({ input, output, patches }) => {
  const listFile = path.join(path.dirname(output), `.astral-ytd-${randomUUID()}.json`);
  await fs.writeFile(listFile, JSON.stringify(patches.map((patch) => ({ texture: patch.texture, source: patch.source, sha256: patch.sha256 ?? null }))));
  try {
    const result = await native("ytd-texture-patch", { input, output, patches: listFile });
    if (result?.status !== "ready") throw refusal("ANIMALS_YTD", "Движок не подтвердил правку листов животного.");
  } finally {
    await fs.rm(listFile, { force: true }).catch(() => {});
  }
};


const DIFFUSE_NAME = /_diff_/i;
/* Листы-пустышки 4×4 (цвет «пустого» компонента) красить незачем. */
const MIN_EDGE = 16;
const PAINTABLE = new Set([...BLOCK_FORMATS, "A8R8G8B8"]);

/**
 * Окраска листов одного словаря: новые байты `.ytd` или `null`, если красить нечего.
 * `colour` — `{ hex, strength, brightness }`. Листы красятся по отдельности: опора тона — средняя яркость самого листа, поэтому
 * средний пиксель каждой расцветки становится выбранным цветом, а светотень (шерсть, пятна, глаза) остаётся.
 */
export async function recolourDictionary(bytes, colour, { work, patchYtd, gameRoot, isDiffuse = (name) => DIFFUSE_NAME.test(name) }) {
  const dictionary = readTextureDictionary(bytes, { inflateRaw: inflateRawNode });
  const patches = [];
  const painted = [];
  await fs.mkdir(work, { recursive: true });
  for (const ref of dictionary) {
    if (!isDiffuse(ref.name) || ref.width < MIN_EDGE || ref.height < MIN_EDGE) continue;
    if (!PAINTABLE.has(ref.format) || !ref.complete) continue;
    const full = decodeTextureRef(ref, { level: 0 });
    const tinted = tintRgba(full.rgba, full.width, full.height, {
      kind: "tint",
      colour: colour.hex,
      ref: meanLuma(full.rgba),
      brightness: colour.brightness,
      strength: colour.strength,
    });
    const dds = encodeDds({ width: ref.width, height: ref.height, format: ref.format, mipLevels: ref.levels, rgba: tinted });
    const source = path.join(work, `${patches.length}-${ref.name}.dds`);
    await fs.writeFile(source, dds);
    patches.push({ texture: ref.name, source, sha256: sha256(dds) });
    painted.push(ref.name);
  }
  if (!patches.length) return null;
  const input = path.join(work, "in.ytd");
  const output = path.join(work, "out.ytd");
  await fs.writeFile(input, bytes);
  await patchYtd({ input, output, patches, gameRoot, edition: "Legacy" });
  return { bytes: await fs.readFile(output), painted };
}

/* ---------------------------------------------------------- метка и свечение */

/** Лист метки: значок слева (64×64), сплошной цвет палочки справа; DXT5 со всеми ступенями. */
export async function markerAtlasDds(marker) {
  const { width, height } = MARKER_ATLAS;
  const half = height;
  const icon = await sharp(Buffer.from(iconSvg(marker.icon, marker.hex)), { density: 144 })
    .resize(half, half, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const rgba = new Uint8ClampedArray(width * height * 4);
  const [r, g, b] = hexBytes(marker.hex);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (x < half) {
        const from = (y * half + x) * 4;
        /* Цвет значка в прозрачной кайме тот же, что в теле: сжатие DXT5 не размазывает чёрную кайму по краю. */
        rgba[at] = r;
        rgba[at + 1] = g;
        rgba[at + 2] = b;
        rgba[at + 3] = icon[from + 3];
      } else {
        rgba[at] = r;
        rgba[at + 1] = g;
        rgba[at + 2] = b;
        rgba[at + 3] = 255;
      }
    }
  return encodeDds({ width, height, format: "DXT5", mipLevels: 8, rgba });
}

/** Свои картинки метки: сколько, насколько велики (окно присылает ≤128 пикселей, но входу не верим). */
const MAX_EMBLEMS = 64;
const MAX_EMBLEM_BASE64 = 4 * 1024 * 1024;
const MAX_EMBLEM_EDGE = 1024;

/**
 * Свои эмблемы от окна: отпечаток → PNG. Установщик входу не верит: у каждой картинки сверяется отпечаток SHA-256, она
 * разбирается заново (формат, размеры), а нужной работе, но не присланной картинке — отказ словами, не пустая метка.
 */
export async function normalizeEmblems(input, project) {
  const wanted = animalEmblemHashes(project);
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (wanted.size > MAX_EMBLEMS) throw refusal("ANIMALS_EMBLEM", "Слишком много своих эмблем в одной работе.");
  const out = new Map();
  for (const hash of wanted) {
    const data = String(raw[hash] || "");
    if (!EMBLEM_HASH.test(hash) || !data || data.length > MAX_EMBLEM_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      throw refusal("ANIMALS_EMBLEM", "Своя эмблема метки не читается — выберите картинку заново.");
    const bytes = Buffer.from(data, "base64");
    if (sha256(bytes) !== hash) throw refusal("ANIMALS_EMBLEM", "Своя эмблема метки не совпала с отпечатком — выберите картинку заново.");
    let meta;
    try {
      meta = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_EMBLEM_EDGE * MAX_EMBLEM_EDGE * 4 }).metadata();
    } catch {
      throw refusal("ANIMALS_EMBLEM", "Своя эмблема метки не читается — выберите PNG, JPG или WebP заново.");
    }
    if (!meta.width || !meta.height || meta.width > MAX_EMBLEM_EDGE || meta.height > MAX_EMBLEM_EDGE) throw refusal("ANIMALS_EMBLEM", "Своя эмблема метки слишком велика.");
    out.set(hash, bytes);
  }
  return out;
}

/**
 * Лист своей эмблемы: плитка 128×128 слева — картинка со своими цветами и прозрачностью, вписанная целиком с полем в 8
 * точек, — прозрачная полоса и сплошной цвет палочки у правого края (с 192-й точки); DXT5 со всеми ступенями. Непрозрачность
 * эмблемы (`marker.opacity`) умножает альфу картинки; палочка остаётся плотной. Цвет под
 * прозрачным краем — от ближайшего видимого (сжатие и фильтрация не дают тёмной каймы), под полосой — цвет палочки. Сплошной
 * цвет не примыкает к плитке, поэтому на краю метки нет цветной каймы (билинейная фильтрация и ступени смешивают соседей).
 */
export async function emblemAtlasDds(marker, png) {
  const { width, height, icon: edge, inset, solid } = EMBLEM_ATLAS;
  const inner = edge - inset * 2;
  const picture = await sharp(png, { failOn: "error", limitInputPixels: MAX_EMBLEM_EDGE * MAX_EMBLEM_EDGE * 4 })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: inset, bottom: inset, left: inset, right: inset, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const tile = new Uint8ClampedArray(picture.buffer, picture.byteOffset, picture.length).slice();
  bleedTransparent(tile, edge, edge);
  const opacity = Number.isFinite(marker.opacity) ? Math.max(0, Math.min(1, marker.opacity)) : 1;
  if (opacity < 1) for (let at = 3; at < tile.length; at += 4) tile[at] = Math.round(tile[at] * opacity);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const [r, g, b] = hexBytes(marker.hex);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (x < edge) {
        const from = (y * edge + x) * 4;
        rgba[at] = tile[from];
        rgba[at + 1] = tile[from + 1];
        rgba[at + 2] = tile[from + 2];
        rgba[at + 3] = tile[from + 3];
      } else {
        rgba[at] = r;
        rgba[at + 1] = g;
        rgba[at + 2] = b;
        rgba[at + 3] = x >= solid ? 255 : 0;
      }
    }
  return encodeDds({ width, height, format: "DXT5", mipLevels: fullMipLevels(width, height), rgba });
}

/** Лист копии животного: 4×4 сплошного цвета метки (вся копия и палочка берут одну точку листа), DXT5 со всеми ступенями. */
export function solidMarkerDds(marker) {
  const [r, g, b] = hexBytes(marker.hex);
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  for (let at = 0; at < rgba.length; at += 4) {
    rgba[at] = r;
    rgba[at + 1] = g;
    rgba[at + 2] = b;
    rgba[at + 3] = 255;
  }
  return encodeDds({ width: 4, height: 4, format: "DXT5", mipLevels: fullMipLevels(4, 4), rgba });
}

/** Лист оболочки свечения: 4×4, цвет и полупрозрачность уже внутри. */
export function glowTextureDds(glow) {
  const [r, g, b] = hexBytes(glow.hex);
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  for (let at = 0; at < rgba.length; at += 4) {
    rgba[at] = r;
    rgba[at + 1] = g;
    rgba[at + 2] = b;
    rgba[at + 3] = Math.round(glow.alpha * 255);
  }
  return encodeDds({ width: 4, height: 4, format: "DXT5", mipLevels: 3, rgba });
}

const topOf = (parts) => {
  let top = -Infinity;
  for (const part of parts)
    for (const mesh of part.drawable.meshes)
      for (let at = 1; at < mesh.positions.length; at += 3) if (mesh.positions[at] > top) top = mesh.positions[at];
  return Number.isFinite(top) ? top : 0;
};

/**
 * Модель тела с меткой и свечением: `[{ name, bytes }]` по файлам моделей животного и заметки.
 * Файлов модели у животного может быть несколько (собаки: голова, грудь, зад) — оболочка ложится в каждый, метка — в самый
 * крупный.
 */
async function patchModels({ animal, look, found, reader, work, native, emblems = new Map() }) {
  await fs.mkdir(work, { recursive: true });
  const parts = await readBodyParts(reader, animal, found);
  if (!parts.length) throw refusal("ANIMALS_BODY", `У животного «${animal.name}» не нашлось тела — метка и свечение не ставятся.`);
  const anchor = [...parts].sort((left, right) => right.vertices - left.vertices)[0];
  const top = topOf(parts);
  const notes = [];
  const marker = look.marker.on ? look.marker : null;
  const glow = look.glow.on ? look.glow : null;
  let markerPlan = null;
  if (marker) {
    if (marker.kind === "model") {
      /* Копия самого животного: все части тела (у собак — голова, грудь, зад), метры по длинной стороне, одним цветом. */
      const bodyParts = parts.flatMap((part) => part.drawable.meshes.map((mesh) => ({ positions: mesh.positions, normals: mesh.normals, indices: mesh.indices })));
      let measured;
      try {
        measured = measureModelMarker(bodyParts, marker.modelSize);
      } catch (error) {
        throw refusal("ANIMALS_MARKER", String(error?.message || error));
      }
      const fitted = fitMarkerHeight({ height: marker.height, size: measured.height }, top, ANIMAL_LIMITS.markerHeight.min);
      if (fitted.clamped) notes.push({ code: "marker-height", height: fitted.height });
      let mesh;
      try {
        mesh = buildModelMarker({ parts: bodyParts, height: fitted.height, size: marker.modelSize, pole: marker.pole, base: top });
      } catch (error) {
        throw refusal("ANIMALS_MARKER", String(error?.message || error));
      }
      if (mesh.top > MODEL_CULL_RADIUS) throw refusal("ANIMALS_MARKER", "Копия животного выходит за пределы видимости модели — уменьшите высоту или размер.");
      markerPlan = { mesh, height: fitted.height, kind: "model" };
    } else {
      const fitted = fitMarkerHeight(marker, top, ANIMAL_LIMITS.markerHeight.min);
      if (fitted.clamped) notes.push({ code: "marker-height", height: fitted.height });
      const mesh = buildMarkerMesh({ height: fitted.height, size: marker.size, pole: marker.pole, base: top, ...(marker.kind === "emblem" ? { poleUv: EMBLEM_POLE_UV } : {}) });
      if (markerTop({ height: fitted.height, size: marker.size, base: top }) > MODEL_CULL_RADIUS) throw refusal("ANIMALS_MARKER", "Метка выходит за пределы видимости животного — уменьшите высоту.");
      markerPlan = { mesh, height: fitted.height, kind: marker.kind };
    }
  }
  const markerDds = marker ? path.join(work, "marker.dds") : null;
  const glowDds = glow ? path.join(work, "glow.dds") : null;
  if (marker) {
    let atlas;
    if (marker.kind === "model") atlas = solidMarkerDds(marker);
    else if (marker.kind === "emblem") atlas = await emblemAtlasDds(marker, emblems.get(marker.emblem));
    else atlas = await markerAtlasDds(marker);
    await fs.writeFile(markerDds, atlas);
  }
  if (glow) await fs.writeFile(glowDds, glowTextureDds(glow));

  const files = [...new Set(parts.map((part) => part.file))];
  const out = [];
  for (const [index, file] of files.entries()) {
    const own = parts.filter((part) => part.file === file);
    const carriesMarker = marker && anchor.file === file;
    if (!carriesMarker && !glow) continue;
    const bytes = await reader.read(animalEntryAt(animal, file));
    const inputFile = path.join(work, `model-${index}.ydd`);
    const outputFile = path.join(work, `model-${index}-out.ydd`);
    const requestFile = path.join(work, `model-${index}.json`);
    await fs.writeFile(inputFile, bytes);
    await fs.writeFile(
      requestFile,
      JSON.stringify({
        format: "astral.animal-model",
        version: 1,
        input: inputFile,
        output: outputFile,
        marker: carriesMarker
          ? {
              drawable: anchor.hash,
              positions: markerPlan.mesh.positions,
              uvs: markerPlan.mesh.uvs,
              indices: markerPlan.mesh.indices,
              ...(markerPlan.mesh.normals ? { normals: markerPlan.mesh.normals } : {}),
              texture: markerDds,
              emissive: marker.power,
            }
          : null,
        glow: glow
          ? { drawables: own.map((part) => part.hash), inflate: glow.reach / 100, texture: glowDds, emissive: glow.power }
          : null,
      }),
    );
    await native("patch-animal-model", { input: requestFile, output: outputFile });
    const patched = await fs.readFile(outputFile);
    /* «Готово» — только по файлу: он читается, тело на месте, а геометрии прибавилось. */
    let model;
    try {
      model = readDrawable(patched, { inflateRaw: inflateRawNode, kind: "ydd" });
    } catch (error) {
      throw refusal("ANIMALS_PATCH", `Модель животного «${animal.name}» после правки не читается: ${String(error?.message || error)}`);
    }
    const before = readDrawable(bytes, { inflateRaw: inflateRawNode, kind: "ydd" });
    if (model.drawables.length !== before.drawables.length) throw refusal("ANIMALS_PATCH", `Модель животного «${animal.name}» после правки потеряла части — не ставим.`);
    const meshesBefore = before.drawables.reduce((sum, drawable) => sum + drawable.meshes.length, 0);
    const meshesAfter = model.drawables.reduce((sum, drawable) => sum + drawable.meshes.length, 0);
    if (meshesAfter <= meshesBefore) throw refusal("ANIMALS_PATCH", `В модель животного «${animal.name}» ничего не добавилось — не ставим.`);
    out.push({ name: file, bytes: patched });
  }
  return { files: out, notes, anchor: { file: anchor.file, name: anchor.name }, top };
}

/* --------------------------------------------------------------- пакет */

const atomicWrite = async (file, bytes) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
};

/** Пакеты в кэше по хэшу содержимого: сколько последних держать (планы, ещё не нажатые «Применить»). */
const KEEP_PACKAGES = 4;

async function pruneOldPackages(directory, current, keep = new Set()) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (full === current || keep.has(entry.name)) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (stat) packages.push({ full, time: stat.mtimeMs });
  }
  packages.sort((a, b) => b.time - a.time);
  for (const stale of packages.slice(KEEP_PACKAGES - 1)) await fs.rm(stale.full, { recursive: true, force: true }).catch(() => {});
}

export const animalsPackagesRoot = (stateDir) => path.join(path.resolve(String(stateDir || os.tmpdir())), "animals", "packages");

/**
 * Пакет облика: читает игру, красит, дописывает модели и кладёт файлы в папку пакета.
 * Ответ — `{ manifest, packageRoot, files, animals }` (только то, что переносится между потоками).
 */
export async function buildAnimalsPackage(input, context, stateDir, extra = {}) {
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot || !path.isAbsolute(gameRoot)) throw refusal("ANIMALS_GAME", "Выберите папку GTA V Legacy.");
  const project = normalizeAnimalsProject(input?.project);
  if (animalsProjectIsEmpty(project))
    throw refusal("ANIMALS_EMPTY", "Ничего не включено — ставить нечего. Чтобы убрать облик животных из игры, нажмите «Снять из игры».");
  /* Метка «своя эмблема» без картинки не ставится: тихо подменить её значком нельзя. */
  for (const look of Object.values(project.animals))
    if (animalLookProblems(look).includes("marker-emblem")) throw refusal("ANIMALS_EMBLEM", "У метки выбран вид «Своя эмблема», но картинки нет — выберите картинку или другой вид метки.");
  const emblems = await normalizeEmblems(input?.pictures, project);
  const reader = await readerFor(gameRoot, stateDir, extra);
  /* В потоке чтения хост приходит готовым (`extra.native`); вне потока — общий движок главного процесса. */
  const native = extra.native || (await import("../native-engine.js").then((module) => (command, request) => module.callNativeEngine(command, request, context)));
  const patchYtd = extra.patchYtd || enginePatchYtd(native);
  const work = path.join(path.resolve(String(stateDir || os.tmpdir())), "animals", "work", randomUUID());
  await fs.mkdir(work, { recursive: true });
  const built = new Map();
  const animals = [];
  try {
    for (const id of Object.keys(project.animals)) {
      const animal = animalById(id);
      const look = project.animals[id];
      if (!animalInstallable(animal)) continue;
      const found = await animalFilesInGame(reader, animal);
      if (!found.present) {
        animals.push({ id, skipped: "missing" });
        continue;
      }
      const row = { id, painted: 0, models: 0, notes: [] };
      if (look.colour.on) {
        for (const [index, name] of found.textures.entries()) {
          const bytes = await reader.read(animalEntryAt(animal, name)).catch(() => null);
          if (!bytes) continue;
          const folder = path.join(work, `${id}-${index}`);
          const recoloured = await recolourDictionary(bytes, look.colour, { work: folder, patchYtd, gameRoot, ...(extra.isDiffuse ? { isDiffuse: extra.isDiffuse } : {}) });
          if (!recoloured) continue;
          built.set(name, recoloured.bytes);
          row.painted += recoloured.painted.length;
        }
        if (!row.painted) row.notes.push({ code: "no-sheets" });
      }
      if (animalLookTouchesModel(look)) {
        const patched = await patchModels({ animal, look, found, reader, work: path.join(work, `${id}-model`), native, emblems });
        for (const file of patched.files) built.set(file.name, file.bytes);
        row.models = patched.files.length;
        row.notes.push(...patched.notes);
        row.anchor = patched.anchor;
      }
      animals.push(row);
    }
    if (!built.size) throw refusal("ANIMALS_NOTHING", "Для выбранных животных нечего менять в файлах игры — проверьте, что их файлы есть в вашей игре.");
    const described = [...built].map(([name, bytes]) => ({ name, size: bytes.length, sha256: sha256(bytes) }));
    const manifest = buildAnimalsManifest(described);
    if (!isLocalAnimalsManifest(manifest, "Legacy")) throw refusal("ANIMALS_TRUST", "Собранные файлы животных не прошли строгую проверку доверия.");
    const root = animalsPackagesRoot(stateDir);
    const packageRoot = path.join(root, manifest.animals.sourceDigest.slice("sha256:".length, "sha256:".length + 16));
    for (const [name, bytes] of built) {
      const target = path.join(packageRoot, "payload", ...name.split("/"));
      const current = await fs.readFile(target).catch(() => null);
      if (!current || !current.equals(bytes)) await atomicWrite(target, bytes);
    }
    await pruneOldPackages(root, packageRoot);
    return { manifest, packageRoot, files: described, animals };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
