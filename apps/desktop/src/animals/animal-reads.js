/*
 * Чтение животных для окна «Животные» (05.11.2026) — функции потока чтения игры (`game-read-host.js`): главный процесс Electron
 * игру не читает. Каждая функция — `(запрос, context, stateDir, extra)`, как у остальных читателей (`animations/animation-reads.js`).
 *
 *   listAnimals — какие животные каталога есть в файлах игры у человека;
 *   readAnimal  — тело одного животного одним GLB (сетки и текстуры из его же файлов) и всё, что нужно для настройки:
 *                 какая модель принимает метку, какие листы красятся, где верх тела.
 *
 * Только чтение: игра и файлы человека не меняются. Это те же файлы, что увидит игра: `x64e.rpf` (базовая игра) или
 * `dlc.rpf` дополнения — модель, а не рисунок.
 */

import path from "node:path";
import {
  ANIMALS,
  animalById,
  animalEntryAt,
  animalFileNames,
  animalInstallable,
} from "@modovik/climb-contract/animals";
import { decodeTextureRef, findTexture, normalMapRgba, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import { drawableToGlb } from "@modovik/rage-drawable/glb";
import { inflateRawNode } from "@modovik/rpf7/node";
import { jenkinsHash } from "@modovik/ypt";
import { readerCall } from "../game-archive-reader.js";
import { provisionArchiveSupport } from "../loader-provisioner.js";
import { encodePngFast } from "../png-fast.js";

const refusal = (code, message) => Object.assign(new Error(message), { code });

/* Пустышки игры (четырёхугольник на пустой компонент) — от трёх до восьми вершин; тело — сотни. */
export const MIN_BODY_VERTICES = 24;
/* Большие листы окну не нужны: 1024 по длинной стороне — глаз не отличит, а GLB не раздувается. */
const MAX_TEXTURE = 1024;

/* Названия частей педа: по хэшу имени drawable узнаётся компонент. */
const PART_NAMES = ["head_000_r", "uppr_000_r", "uppr_000_u", "uppr_001_u", "lowr_000_r", "lowr_000_u", "accs_000_u", "teef_000_u", "hair_000_u", "head_001_r"];
const PART_BY_HASH = new Map(PART_NAMES.map((name) => [jenkinsHash(name), name]));

function gameRootOf(input) {
  const gameRoot = String(input?.gameRoot || "");
  if (!gameRoot) throw refusal("ANIMALS_GAME", "Выберите папку GTA V Legacy.");
  if (!path.isAbsolute(gameRoot)) throw refusal("ANIMALS_GAME", "Выберите папку GTA V Legacy.");
  return gameRoot;
}

/** Читатель архивов игры: в потоке — общий (`readerCall` держит архивы открытыми), в проверках — подставной. */
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

/** Файлы животного в игре: `{ model, models, textures, present }`; `present` — есть ли тело. */
export async function animalFilesInGame(reader, animal) {
  if (animal.layout === "streamed") {
    const listed = await reader.list(animalEntryAt(animal, animal.id)).catch(() => []);
    const prefix = `${animal.label}:${animal.container}/`.toLowerCase();
    const relative = listed.map((at) => String(at).toLowerCase()).filter((at) => at.startsWith(prefix)).map((at) => at.slice(prefix.length));
    const names = animalFileNames(animal, relative);
    return {
      present: relative.includes(names.model),
      models: relative.filter((name) => name.endsWith(".ydd")).sort(),
      textures: names.textures,
      all: relative,
    };
  }
  const names = animalFileNames(animal);
  const present = await reader.has(animalEntryAt(animal, names.model)).catch(() => false);
  return { present, models: present ? [names.model] : [], textures: names.textures, all: [] };
}

/** Список: какие животные каталога лежат в игре. Нет игры — отказ словами, нет файлов животного — `present: false`. */
export async function listAnimals(input, context, stateDir, extra = {}) {
  const gameRoot = gameRootOf(input);
  const reader = await readerFor(gameRoot, stateDir, extra);
  const animals = [];
  for (const animal of ANIMALS) {
    const files = await animalFilesInGame(reader, animal);
    animals.push({ id: animal.id, present: files.present, installable: animalInstallable(animal) });
  }
  return { animals, found: animals.filter((item) => item.present).length };
}

/* Все словари листов животного: у компонента один `.ytd`, у потоковых — по одному на лист. */
async function readDictionaries(reader, animal, files) {
  const dictionaries = [];
  const problems = [];
  for (const texture of files.textures) {
    const bytes = await reader.read(animalEntryAt(animal, texture)).catch(() => null);
    if (!bytes) {
      problems.push(texture);
      continue;
    }
    try {
      dictionaries.push(readTextureDictionary(bytes, { inflateRaw: inflateRawNode }));
    } catch {
      problems.push(texture);
    }
  }
  return { dictionaries, problems };
}

/** Тело животного: все модели игры, кроме пустышек. */
export async function readBodyParts(reader, animal, files) {
  const parts = [];
  for (const file of files.models) {
    const bytes = await reader.read(animalEntryAt(animal, file)).catch(() => null);
    if (!bytes) continue;
    let model;
    try {
      model = readDrawable(bytes, { inflateRaw: inflateRawNode, kind: "ydd" });
    } catch (error) {
      throw refusal("ANIMALS_MODEL", `Модель ${file} не читается: ${String(error?.message || error)}`);
    }
    for (const drawable of model.drawables) {
      const vertices = drawable.meshes.reduce((sum, mesh) => sum + (mesh.positions?.length || 0) / 3, 0);
      if (vertices < MIN_BODY_VERTICES) continue;
      parts.push({
        file,
        hash: drawable.hash,
        name: PART_BY_HASH.get(drawable.hash) || null,
        vertices,
        shaders: [...new Set(drawable.meshes.map((mesh) => mesh.material?.shader).filter(Boolean))],
        drawable,
      });
    }
  }
  return parts;
}

const dimensions = (drawables) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const drawable of drawables)
    for (const mesh of drawable.meshes)
      for (let at = 0; at + 2 < mesh.positions.length; at += 3)
        for (let axis = 0; axis < 3; axis += 1) {
          const value = mesh.positions[at + axis];
          if (value < min[axis]) min[axis] = value;
          if (value > max[axis]) max[axis] = value;
        }
  return Number.isFinite(min[0]) ? { min, max } : null;
};

/**
 * Животное для окна: `{ id, glb, parts, anchor, glow, bounds, recolour, files }`.
 *
 * `bounds` — габарит тела в осях модели окна (glTF, Y вверх): метка и кадр считаются от него. `anchor` — модель тела, в которую
 * ляжет метка (самая крупная: у кабана `head_000_r`, у курицы `uppr_000_r`, у собак `lowr_000_u`); `glow.drawables` — модели
 * тела, по которым строится светящаяся оболочка. `recolour.textures` — листы, которые красит перекраска (все `*_diff_*`).
 */
export async function readAnimal(input, context, stateDir, extra = {}) {
  const gameRoot = gameRootOf(input);
  const animal = animalById(input?.id);
  if (!animal) throw refusal("ANIMALS_UNKNOWN", "Такого животного нет в списке.");
  const reader = await readerFor(gameRoot, stateDir, extra);
  const files = await animalFilesInGame(reader, animal);
  if (!files.present) throw refusal("ANIMALS_MISSING", "Файлов этого животного нет в вашей игре.");
  const parts = await readBodyParts(reader, animal, files);
  if (!parts.length) throw refusal("ANIMALS_BODY", "В модели животного не нашлось тела.");
  const { dictionaries, problems } = await readDictionaries(reader, animal, files);

  const lookups = new Map();
  const pictureOf = (name) => {
    const key = String(name || "").toLowerCase();
    if (!key) return null;
    if (!lookups.has(key)) {
      const ref = findTexture(key, dictionaries);
      let picture = null;
      if (ref?.format && ref.complete)
        try {
          picture = { ...decodeTextureRef(ref, { maxSize: MAX_TEXTURE }), format: ref.format };
        } catch {
          picture = null;
        }
      lookups.set(key, picture);
    }
    return lookups.get(key);
  };

  const drawable = { name: animal.id, meshes: parts.flatMap((part) => part.drawable.meshes), embeddedTextures: [] };
  const glb = await drawableToGlb(drawable, {
    textureFor: (material, role) => {
      const picture = pictureOf(material?.textures?.[role]);
      if (!picture) return null;
      if (role === "normal") return { width: picture.width, height: picture.height, rgba: normalMapRgba(picture.rgba, picture.format) };
      return role === "diffuse" ? picture : null;
    },
    materialName: (material) => material?.textures?.diffuse || material?.shader || "animal",
    encodePng: encodePngFast,
    name: animal.id,
    vertexColours: false,
  });

  const anchor = [...parts].sort((left, right) => right.vertices - left.vertices)[0];
  const diffuse = [];
  for (const dictionary of dictionaries)
    for (const texture of dictionary)
      if (/_diff_/i.test(texture.name) && texture.width >= 16 && texture.height >= 16) diffuse.push({ name: texture.name, width: texture.width, height: texture.height, format: texture.format });
  return {
    id: animal.id,
    installable: animalInstallable(animal),
    glb: glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
    parts: parts.map((part) => ({ file: part.file, hash: part.hash, name: part.name, vertices: part.vertices, shaders: part.shaders })),
    anchor: { file: anchor.file, hash: anchor.hash, name: anchor.name, vertices: anchor.vertices },
    glow: { drawables: parts.map((part) => ({ file: part.file, hash: part.hash })) },
    bounds: dimensions(parts.map((part) => part.drawable)),
    recolour: { textures: diffuse },
    files: { models: files.models, textures: files.textures },
    problems,
  };
}
