/*
 * «Дирижабли» в файлах (ТЗ 11.10.2026).
 *
 * Работа говорит, каким быть дирижаблю игры и что летает в небе
 * (`@modovik/climb-contract/recolor/airships`); здесь это становится файлами
 * пакета мест:
 *
 *   • лист надписи `blimp_sign_1` — своя надпись или картинка, цвета
 *     оболочки и полос: лист рисует окно (`paintAirshipSign`, та же разметка
 *     листа игры) и присылает картинкой; «как в игре» — лист игрока;
 *   • штатный дирижабль игры (машина `blimp`) — копия его словаря
 *     `blimp.ytd` из игры игрока, где на месте листа надписи — лист работы
 *     (остальные листы — байт в байт): пакет мест главнее `vehicles.rpf`,
 *     и игра берёт словарь машины из него;
 *   • летающие — по модели и клипу полёта на вид (`compile-sky-flyer`):
 *     дирижабль — снаружи видные сетки `blimp.yft` игрока (оболочка с листом
 *     работы, гондола, окна), остальные — модели Astral (`airship-models.js`)
 *     одним листом цветов, а с лого или своей текстурой — ещё листом
 *     картинки, который нарисовало окно (`paintAirshipSkin`, ТЗ 11.10.2026,
 *     вечер); путь — круг над центром сущности (`airshipFlight`); крылья,
 *     хвост, огонь и огни движутся второй костью шаблона (доли `flex` у
 *     вершин и «местное» движение `airshipMotionFrames`, ТЗ того же вечера,
 *     задача 3);
 *   • расстановка — архетипы с флагами анимированной модели 0x80200 и
 *     словарями клипов, сущности по одной на летающего
 *     (`airshipPlacements`: центр круга над крышами и горами, поворот круга),
 *     типы, карта и манифест (`compile-placements`).
 *
 * Ничего из этого не скрипт: карта и модели лежат в файлах игры, их грузит и
 * одиночная игра, и клиент РП-сервера.
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { encodeDds, fullMipLevels, resample } from "@modovik/dds";
import { decodeTextureRef, readDrawable, readTextureDictionary } from "@modovik/rage-drawable";
import {
  AIRSHIP_BLIMP,
  AIRSHIP_KINDS,
  AIRSHIP_MAP,
  AIRSHIP_SIGN_SIZE,
  AIRSHIP_TYPES,
  airshipBlimpPart,
  airshipClipsName,
  airshipFlight,
  airshipGameRepainted,
  airshipKind,
  airshipModelName,
  airshipPlacements,
  airshipsIsStock,
  normalizeAirshipsProject,
} from "@modovik/climb-contract/recolor/airships";
import { airshipModel, airshipMotionFrames } from "@modovik/climb-contract/recolor/airship-models";
import { resourceRefs } from "./recolor-sheets.js";
import { patchResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";

const ANIMATED_ARCHETYPE_FLAGS = 0x80200;
/* Предел дальности модели у хоста и запас на круг полёта. */
const MAX_FLYER_LOD = 6000;

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const round = (value, digits = 5) => Math.round(value * 10 ** digits) / 10 ** digits;

/* Первый файл из списка мест, который есть у игрока: `{ at, bytes }` или `null`. */
async function readFirst(game, addresses) {
  for (const at of addresses) {
    const bytes = await game.read(at).catch(() => null);
    if (bytes?.length) return { at, bytes };
  }
  return null;
}

/* Лист в RGBA из словаря или модели игры по имени (наибольший уровень не крупнее `maxSize`). */
function sheetFrom(refs, name, maxSize = 1024) {
  const ref = refs.find((item) => item.name.toLowerCase() === name.toLowerCase() && item.complete);
  if (!ref) return null;
  try {
    return decodeTextureRef(ref, { maxSize });
  } catch {
    return null;
  }
}

/**
 * Лист надписи работы для игры: пиксели окна (`sheet` — `{ rgba, width,
 * height }`, ровно 512 × 256) или лист игрока («как в игре»).
 */
function signSheet(project, sheet, blimpDictionary) {
  if (project.blimp.sign !== "game") {
    if (!sheet?.rgba) throw new Error("Лист дирижабля не пришёл из окна — нажмите «Применить» ещё раз.");
    if (sheet.width !== AIRSHIP_SIGN_SIZE.width || sheet.height !== AIRSHIP_SIGN_SIZE.height)
      throw new RangeError(`Лист дирижабля — ${sheet.width} × ${sheet.height}, а нужен ${AIRSHIP_SIGN_SIZE.width} × ${AIRSHIP_SIGN_SIZE.height}.`);
    return { rgba: new Uint8ClampedArray(sheet.rgba), width: sheet.width, height: sheet.height };
  }
  const own = blimpDictionary ? sheetFrom(blimpDictionary.refs, AIRSHIP_BLIMP.sheet) : null;
  if (!own) throw new Error("В игре нет листа надписи дирижабля (blimp_sign_1) — проверьте файлы игры в Steam/Epic.");
  return own;
}

/**
 * Копия словаря дирижабля игры с листом работы на месте `blimp_sign_1`:
 * остальные листы — байт в байт. Лист работы — того же размера, что у
 * игры (у Legacy 512 × 256): своя надпись ложится в ту же разметку.
 */
export function repaintBlimpDictionary(bytes, sheet) {
  const file = `${AIRSHIP_BLIMP.dictionary}.ytd`;
  const { refs } = resourceRefs(bytes, file);
  const ref = refs.find((item) => item.name.toLowerCase() === AIRSHIP_BLIMP.sheet);
  if (!ref?.complete) throw new Error("В словаре дирижабля игры нет листа надписи — проверьте файлы игры.");
  const rgba =
    ref.width === sheet.width && ref.height === sheet.height
      ? sheet.rgba
      : new Uint8ClampedArray(resample(new Uint8ClampedArray(sheet.rgba), sheet.width, sheet.height, ref.width, ref.height));
  const payload = texturePayload({ name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, bytes: ref.bytes }, rgba);
  const patched = patchResourceTextures(bytes, file, { [ref.name]: payload });
  return Buffer.from(patched.bytes.buffer, patched.bytes.byteOffset, patched.bytes.byteLength);
}

/* DDS листа для хоста: файл, имя, размеры, отпечаток. */
async function writeSheet(directory, name, { rgba, width, height }, format = "DXT1") {
  const dds = encodeDds({ width, height, format, mipLevels: fullMipLevels(width, height), rgba });
  const file = path.join(directory, `${name}.dds`);
  await fs.writeFile(file, dds, { flag: "wx" });
  return { name, file, sha256: `sha256:${sha(dds)}`, width, height };
}

/* Сетки игры (оси glTF у `readDrawable`) → оси игры: Z вверх, нос +Y. */
const toGame = (source) => {
  const out = new Float32Array(source.length);
  for (let at = 0; at < source.length; at += 3) {
    out[at] = source[at];
    out[at + 1] = -source[at + 2];
    out[at + 2] = source[at + 1];
  }
  return out;
};

/**
 * Модель дирижабля для полёта: снаружи видные сетки `blimp.yft` игрока
 * (`airshipBlimpPart`), середина — в начале координат, размер работы.
 * Ответ — `{ textures, geometries, radius }` для хоста.
 */
async function blimpFlyer({ project, sheet, model, shared, blimpDictionary, directory }) {
  const drawable = readDrawable(model.bytes, { inflateRaw: zlib.inflateRawSync, kind: "yft", lod: "high" }).drawables[0];
  if (!drawable) throw new Error("Модель дирижабля игры не читается — проверьте файлы игры.");
  const kept = [];
  for (const mesh of drawable.meshes) {
    const texture = String(mesh.material?.textures?.diffuse || "").toLowerCase();
    const part = airshipBlimpPart(texture);
    if (part && mesh.positions?.length && mesh.uvs) kept.push({ part, texture, mesh });
  }
  if (!kept.some((item) => item.part.id === "sign")) throw new Error("У дирижабля игры не нашлось оболочки — модель другая?");
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const placed = kept.map((item) => {
    const positions = toGame(item.mesh.positions);
    for (let at = 0; at < positions.length; at += 1) {
      min[at % 3] = Math.min(min[at % 3], positions[at]);
      max[at % 3] = Math.max(max[at % 3], positions[at]);
    }
    return { ...item, positions, normals: item.mesh.normals ? toGame(item.mesh.normals) : null };
  });
  const centre = min.map((value, axis) => (value + max[axis]) / 2);
  const factor = project.fleet.blimp.size / 100;
  /* Листы: надпись — работы; гондола и окна — из общего словаря машин игрока. */
  const sharedRefs = shared ? readTextureDictionary(shared.bytes, { inflateRaw: zlib.inflateRawSync }) : [];
  const ownRefs = [...(drawable.embeddedTextures || []), ...(blimpDictionary?.refs || [])];
  const textures = [await writeSheet(directory, `${airshipModelName("blimp")}_t0`, sheet)];
  const byTexture = new Map([[AIRSHIP_BLIMP.sheet, textures[0].name]]);
  for (const item of placed) {
    if (byTexture.has(item.texture)) continue;
    const pixels = sheetFrom([...ownRefs, ...sharedRefs], item.texture, 512);
    if (!pixels) {
      byTexture.set(item.texture, null);
      continue;
    }
    const written = await writeSheet(directory, `${airshipModelName("blimp")}_t${textures.length}`, pixels);
    textures.push(written);
    byTexture.set(item.texture, written.name);
  }
  let radius = 0;
  const geometries = [];
  for (const item of placed) {
    const texture = byTexture.get(item.texture);
    if (!texture) continue;
    const positions = new Array(item.positions.length);
    for (let at = 0; at < positions.length; at += 1) {
      positions[at] = round((item.positions[at] - centre[at % 3]) * factor, 4);
      if (at % 3 === 2) radius = Math.max(radius, Math.hypot(positions[at - 2], positions[at - 1], positions[at]));
    }
    geometries.push({
      shader: "default",
      texture,
      positions,
      normals: item.normals ? Array.from(item.normals, (value) => round(value, 4)) : positions.map(() => 0),
      uvs: Array.from(item.mesh.uvs, (value) => round(value, 5)),
      indices: Array.from(item.mesh.indices),
    });
  }
  return { textures, geometries, radius };
}

/*
 * Своя модель вида: лист цветов и части (тело — `default`, свечение —
 * `emissive`). С лого или своей текстурой (ТЗ 11.10.2026, вечер) у модели
 * второй лист — лист картинки, нарисованный окном (`skin`, ровно размера
 * `AIRSHIP_SKINS`): часть `skin` модели развёрнута на него.
 */
async function ownFlyer({ kindId, project, skin = null, directory }) {
  const model = airshipModel(kindId, project);
  const textures = [await writeSheet(directory, `${airshipModelName(kindId)}_t0`, model.atlas)];
  if (model.skin) {
    if (!skin?.rgba) throw new Error(`Лист картинки «${airshipKind(kindId).label}» не пришёл из окна — нажмите «Применить» ещё раз.`);
    if (skin.width !== model.skin.width || skin.height !== model.skin.height)
      throw new RangeError(`Лист картинки «${airshipKind(kindId).label}» — ${skin.width} × ${skin.height}, а нужен ${model.skin.width} × ${model.skin.height}.`);
    textures.push(await writeSheet(directory, `${airshipModelName(kindId)}_t1`, skin));
  }
  /* Гнущиеся вершины (крылья, хвост, огонь, огни) — доля «местного» движения (ТЗ 11.10.2026, вечер, задача 3). */
  const geometries = model.parts.map((part) => ({
    shader: part.shader,
    texture: textures[part.texture === "skin" ? 1 : 0].name,
    ...(part.shader === "emissive" ? { emissive: part.emissive } : {}),
    positions: Array.from(part.positions, (value) => round(value, 4)),
    normals: Array.from(part.normals, (value) => round(value, 4)),
    uvs: Array.from(part.uvs, (value) => round(value, 5)),
    indices: Array.from(part.indices),
    ...(part.flex?.some((value) => value > 0) ? { flex: Array.from(part.flex, (value) => round(value, 3)) } : {}),
  }));
  return { textures, geometries, radius: model.radius };
}

/**
 * Файлы «Дирижаблей» под работу: `{ files, patches, report }`. `sheet` —
 * лист надписи из окна (`{ rgba, width, height }`, при «как в игре» —
 * `null`), `game` — чтение игры игрока (`createGameReader`), `compile` —
 * вызов нативного хоста.
 */
export async function buildAirshipFiles(input, { sheet = null, skins = {}, game = null, compile = null, stateDir = "" } = {}) {
  const project = normalizeAirshipsProject(input);
  if (airshipsIsStock(project)) return { files: [], patches: [], report: { stock: true } };
  const flying = AIRSHIP_KINDS.filter((item) => project.fleet[item.id].count > 0);
  const repaint = airshipGameRepainted(project);
  if (flying.length && typeof compile !== "function") throw new Error("Сборщик моделей не подключён — обновите Astral.");
  const needsBlimp = repaint || project.fleet.blimp.count > 0;
  if (needsBlimp && !game) throw new Error("Игра не найдена — дирижабль берётся из её файлов.");

  const files = [];
  const patches = [];
  const report = { kinds: {}, entities: 0, game: repaint };

  let blimpDictionary = null;
  let model = null;
  let shared = null;
  let sign = null;
  if (needsBlimp) {
    const dictionary = await readFirst(game, AIRSHIP_BLIMP.addresses.dictionary);
    if (!dictionary) throw new Error("В игре нет словаря дирижабля (blimp.ytd) — проверьте файлы игры в Steam/Epic.");
    blimpDictionary = { ...dictionary, refs: readTextureDictionary(dictionary.bytes, { inflateRaw: zlib.inflateRawSync }) };
    sign = signSheet(project, sheet, blimpDictionary);
    if (repaint) {
      files.push({ name: `${AIRSHIP_BLIMP.dictionary}.ytd`, bytes: repaintBlimpDictionary(dictionary.bytes, sign) });
      patches.push({ file: `${AIRSHIP_BLIMP.dictionary}.ytd`, texture: AIRSHIP_BLIMP.sheet, game: true });
    }
    if (project.fleet.blimp.count > 0) {
      model = await readFirst(game, AIRSHIP_BLIMP.addresses.model);
      if (!model) throw new Error("В игре нет модели дирижабля (blimp.yft) — проверьте файлы игры в Steam/Epic.");
      shared = await readFirst(game, AIRSHIP_BLIMP.addresses.shared);
    }
  }
  if (!flying.length) return { files, patches, report };

  const staging = path.join(stateDir, "recolor", "airships", "build", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    const archetypes = [];
    for (const info of flying) {
      const directory = path.join(staging, info.id);
      await fs.mkdir(directory, { recursive: true });
      const built =
        info.id === "blimp"
          ? await blimpFlyer({ project, sheet: sign, model, shared, blimpDictionary, directory })
          : await ownFlyer({ kindId: info.id, project, skin: skins?.[info.id] || null, directory });
      const flight = airshipFlight(info.id, project);
      /* Светящиеся видны дальше (огонь шара — в полтора раза): `reach` вида. */
      const lodDist = Math.min(MAX_FLYER_LOD, Math.round(project.drawDistance * info.reach + flight.radius + built.radius));
      /* «Местное» движение — кадрами клипа на круг; только если есть гнущиеся вершины. */
      const local = built.geometries.some((item) => item.flex?.some((value) => value > 0)) ? airshipMotionFrames(info.id, project, flight.duration) : null;
      const name = airshipModelName(info.id);
      const clips = airshipClipsName(info.id);
      const request = path.join(directory, "flyer.json");
      await fs.writeFile(
        request,
        JSON.stringify({
          format: "astral.compile-sky-flyer",
          version: 1,
          name,
          clipDictionary: clips,
          lodDist,
          textures: built.textures,
          geometries: built.geometries,
          path: { duration: flight.duration, frames: flight.frames, ...(local ? { local: { frames: local } } : {}) },
        }),
      );
      const output = path.join(directory, "out");
      const result = await compile("compile-sky-flyer", { input: request, output });
      for (const file of [`${name}.ydr`, `${clips}.ycd`]) {
        const bytes = await fs.readFile(path.join(output, file)).catch(() => null);
        if (!bytes?.length) throw new Error(`Сборка «${info.label}» не дала ${file}.`);
        files.push({ name: file, bytes });
      }
      const bounds = result?.bounds?.min && result?.bounds?.max ? result.bounds : null;
      if (!bounds) throw new Error(`Сборка «${info.label}» не сказала, где летает модель.`);
      archetypes.push({ name, lodDist, bbMin: bounds.min, bbMax: bounds.max, flags: ANIMATED_ARCHETYPE_FLAGS, clipDictionary: clips });
      report.kinds[info.id] = { count: project.fleet[info.id].count, vertices: built.geometries.reduce((sum, item) => sum + item.positions.length / 3, 0), duration: flight.duration, lodDist, moving: Boolean(local) };
    }

    /* Сущности: центр круга, высота и поворот круга. В карте игры кватернион
       сущности хранится обратным повороту (как у плашек эмблем). */
    const lodOf = new Map(archetypes.map((item) => [item.name, item.lodDist]));
    const entities = airshipPlacements(project).map((place) => {
      const name = airshipModelName(place.kind);
      const [x, y, z, w] = place.rotation;
      return { archetype: name, position: place.position, rotation: [-x, -y, -z, w], lodDist: lodOf.get(name), flags: 32 };
    });
    report.entities = entities.length;
    const placeRequest = path.join(staging, "place.json");
    await fs.writeFile(
      placeRequest,
      JSON.stringify({ format: "astral.compile-placements", version: 1, types: AIRSHIP_TYPES, map: AIRSHIP_MAP, manifest: true, archetypes, entities }),
    );
    const placeOut = path.join(staging, "place");
    await compile("compile-placements", { input: placeRequest, output: placeOut });
    for (const name of [`${AIRSHIP_TYPES}.ytyp`, `${AIRSHIP_MAP}.ymap`, "_manifest.ymf"]) {
      const bytes = await fs.readFile(path.join(placeOut, name)).catch(() => null);
      if (!bytes?.length) throw new Error(`Расстановка летающих не дала ${name}.`);
      files.push({ name, bytes });
    }
    patches.push({ file: "airships", models: archetypes.map((item) => `${item.name}.ydr`), entities: entities.length });
    return { files, patches, report };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
