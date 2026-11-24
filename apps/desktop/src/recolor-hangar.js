/*
 * Ангар в файлах — штатный ангар ограблений из игры игрока (Ангар
 * стандартный, ТЗ 12.10.2026, ночь; до него — мод panika со своими листами).
 *
 * Основа — штатные файлы игры игрока (адреса — опись `hangar.files`), как у
 * «Зданий» (`recolor-buildings.js`): пакет везёт только файлы, где что-то
 * поменялось; всё «Стандарт GTA» — пакета нет, «Применить» снимает
 * установку. Каждая правка — и в модели сетевой карты (`hei_…`, mpheist), и в
 * сюжетном двойнике (`ap1_01_c_…`, x64l): игра ставит в сети одни, в сюжете —
 * другие. Файлы `hei_` сами ложатся в архивы сетевой карты пакета мест
 * (`placesArchiveOf`, группа `GROUP_MAP`).
 *
 *   Стены, нутро, пол — листы, встроенные в модели ангара, и их копии
 *     высокой чёткости (`+hidr`): тон по светотени листа или общая отделка
 *     по развёртке (`hangarSheetLook` договора — та же арифметика у кадра).
 *     Листы словаря архетипа не трогаются: их делят соседние здания.
 *   Фермы под крышей и кран — треугольники модели нутра сводятся в точку
 *     (длина ресурса та же); без ферм подвесы ламп тянутся до крыши
 *     (`hangar-geometry.js`) — лампы висят на крыше, а не в воздухе.
 *   Лампы выключены — сила, объём и ореол всех огней нутра и детали 0,
 *     свечение плафонов и лампочек (`emissiveMultiplier`) 0: лампы висят
 *     тёмными.
 *   Эмблемы и надписи — плашками в мире одним вызовом хоста
 *     (`compile-emblem-plates`), с дальней копией.
 *   Дальний ангар — общей системой LOD (`recolor-lod.js`): тон стен вдали
 *     тот же, отделка — переносом листа HD; «Стандарт» вдали не трогается.
 *
 * Ангар стандартный (ТЗ 13.10.2026):
 *   Чистая покраска — лист крашеной стороны чистится перед тоном
 *     (`hangarCleanPixels`: пятна и ржавчина), накладки корпуса этой
 *     стороны (потёки, трапеции гофры, грязь — `overlays` описи) сводятся
 *     в точку по сторонам граней (`hangarShellLabels`). Листы соседей
 *     (цоколь из блоков, панели у ворот — `copy` описи) зашиваются в модели
 *     корпуса штатной копией (`shop-embed-textures` нативного хоста) и
 *     красятся на месте, как свои: соседние здания аэропорта не меняются.
 *   Вентиляция, галерея, связи, трубы — треугольники нутра и детали в
 *     точку; без галереи модель перил (`ap1_01_c_sthbld3_intc`) — целиком.
 *
 * ТЗ 17.10.2026 (владелец: «чтобы лампы из ангара тоже можно было убирать»,
 * «чтобы была дефолтная разметка на стандартном полу в ангаре и чтобы
 * разметку можно было тоже включать и выключать»):
 *   Лампы убраны — плафоны, лампочки и подвесы нутра, фонари на стенах
 *     детали с кронштейнами и стёклами в точку, огни и свечение 0.
 *   Разметка пола — своя модель обеих карт (`*_sthbld3_lines`): выключенная —
 *     её линии и знаки в точку; грязь той же модели уходит с крашеного пола
 *     и стен, как накладки корпуса.
 *   Цвет ржавчины («добавь возможность красить ржавчину») — у листов, что
 *     остаются штатными: ржавые тексели (`hangarRustPixels`) берут тон цвета
 *     работы при своей яркости; накладка ржавых подтёков и рольставни из
 *     словаря архетипа — копией в модели корпуса, как цоколь.
 *
 * ТЗ 31.10.2026: крыша (`im_roof04`) — лист общего родителя города
 * (`globalroads.ytd`), им крыты здания по всей карте; красится копией в модели
 * корпуса той же дорогой, что цоколь, — город не меняется.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import zlib from "node:zlib";
import { writeDdsHeader } from "@modovik/dds";
import { decodeTextureRef, readDrawable } from "@modovik/rage-drawable";
import {
  openResourceWith,
  pointerAt,
  readPointerList,
  RSC7_HEADER_BYTES,
} from "@modovik/ypt/resource-core";
import { jenkinsHash, patchDrawable, readDrawableShaders } from "@modovik/ypt";
import { deflateRaw, inflateResource } from "@modovik/native-rs";
import {
  HANGAR_FACE_SURFACES,
  HANGAR_FILES,
  HANGAR_INTERIOR,
  HANGAR_INTERIOR_PART,
  HANGAR_INVENTORY,
  HANGAR_MARKINGS,
  HANGAR_OVERLAYS,
  HANGAR_PLATE,
  HANGAR_RUST,
  HANGAR_SHEETS,
  hangarCleanPixels,
  hangarEmblemPlates,
  hangarInteriorParts,
  hangarLinesLabels,
  hangarPlateFiles,
  hangarProjectIsStock,
  hangarRodHeight,
  hangarRustLook,
  hangarRustPixels,
  hangarSheetLook,
  hangarSheetSurface,
  hangarShellLabels,
  hangarSidePainted,
  hangarStructure,
  hangarSurfaceSettings,
  normalizeHangarProject,
  placementTransform,
} from "@modovik/climb-contract/recolor";
import { hangarHouseSheetCopies } from "@modovik/climb-contract/recolor/hangar-house";
import { bakeSheetFinish, finishSource } from "./finish-bake.js";
import { buildAssetPlates } from "./recolor-emblem.js";
import {
  buildLodFiles,
  createLookField,
  createSurfaceSampler,
  nearPlateTriangles,
} from "./recolor-lod.js";
import { hangarLightsPass } from "./recolor-hangar-lights.js";
import { hangarPaintPass } from "./recolor-hangar-paint.js";
import { tintTable } from "./recolor-pixels.js";
import { resourceRefs } from "./recolor-sheets.js";
import { patchResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";

const inflateRaw = inflateResource;
const LUT_STEPS = 1024;
/* Проходы мастерской ангара — цвета (порядок слияния частей: А, Б; договор прохода — в `recolor-hangar-lights.js`). Дом красится листами (`hangar-house.js`), своего прохода не имеет. */
const HANGAR_PASSES = Object.freeze([hangarLightsPass, hangarPaintPass]);
/* Облики дальнего вида: номер — место в `SURFACES`. Потолок — свой облик (у листов гофры потолка в описи поверхность `inside`, но настройки потолка свои: `hangarSheetSurface`). */
export const SURFACES = Object.freeze(["outside", "inside", "floor", "ceiling"]);
/* Огонь (CodeWalker LightAttributes): 168 байт; сила, объём и ореол. */
const LIGHT_BYTES = 168;
const LIGHT_OFF = Object.freeze([0x1c, 0x4c, 0x6c]);
const EMISSIVE = jenkinsHash("emissiveMultiplier");

/* Y-вверх rage-drawable → Z-вверх игры. */
const toGame = (x, y, z) => [x, -z, y];
const sheetOf = (mesh) =>
  (mesh.material?.samplers || [])
    .find((sampler) => sampler.role === "diffuse" && sampler.texture)
    ?.texture?.toLowerCase() || null;

function repack(raw, resource) {
  const compressed = deflateRaw(resource.data, {
    level: zlib.constants.Z_BEST_COMPRESSION,
  });
  const out = Buffer.alloc(RSC7_HEADER_BYTES + compressed.length);
  Buffer.from(raw.buffer, raw.byteOffset, RSC7_HEADER_BYTES).copy(out, 0);
  compressed.copy(out, RSC7_HEADER_BYTES);
  return out;
}

/* ------------------------------------------------------------------ *
 * Листы
 * ------------------------------------------------------------------ */

/* Тон по светотени листа: таблица на 1024 ступени яркости. */
function tintSheet(rgba, look) {
  const table = tintTable({
    colour: look.colour,
    ref: look.ref,
    brightness: look.brightness,
  });
  const out = new Uint8ClampedArray(rgba);
  for (let at = 0; at < rgba.length; at += 4) {
    const luma =
      (0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]) / 255;
    const step =
      Math.min(LUT_STEPS - 1, Math.round(luma * (LUT_STEPS - 1))) * 3;
    out[at] = table[step];
    out[at + 1] = table[step + 1];
    out[at + 2] = table[step + 2];
  }
  return out;
}

/**
 * Листы ангара в файле игры (модель со встроенными листами или словарь
 * высокой чёткости) — по облику работы, на месте: тот же формат и та же
 * цепочка мипов. Лист сперва чистится от пятен и ржавчины
 * (`hangarCleanPixels`, Ангар стандартный, ТЗ 13.10.2026), потом — тон или
 * отделка. Штатный лист с ржавчиной — только ржавчина цветом работы
 * (`hangarRustLook`, ТЗ 17.10.2026). `sourceOf(settings)` — источник
 * отделки. `{ bytes, textures }`.
 */
export function bakeHangarSheets(base, fileName, input, sourceOf, { interior } = {}) {
  const project = normalizeHangarProject(input);
  const raw = base instanceof Uint8Array ? base : new Uint8Array(base);
  const { refs } = resourceRefs(raw, fileName);
  /* Блочный лист и окна дома — листы модели нутра (`hangar-house.js`): у корпуса тот же блочный лист — цоколь «Снаружи», его красит облик «Снаружи». */
  const ofInterior = interior ?? HANGAR_FILES.some((file) => file.name === fileName && file.role === "interior");
  const replacements = {};
  for (const ref of refs) {
    if (!ref.complete) continue;
    const look = hangarSheetLook(project, ref.name, { interior: ofInterior });
    const rust = look ? null : hangarRustLook(project, ref.name);
    if (!look && !rust) continue;
    const decoded = decodeTextureRef(ref, { level: 0 }).rgba;
    let rgba;
    if (rust) rgba = hangarRustPixels(decoded, ref.width, ref.height, rust);
    else {
      /* Листы дома (`hangar-house.js`): ржавчины и пятен чистки у них нет, рисунок штатного листа остаётся целиком (`look.clean === false`); у стен ангара чистка прежняя. */
      const pixels = look.clean === false ? decoded : hangarCleanPixels(decoded, ref.width, ref.height);
      rgba =
        look.kind === "tint"
          ? tintSheet(pixels, look)
          : bakeSheetFinish(
              pixels,
              ref.width,
              ref.height,
              look.settings,
              sourceOf(look.settings),
            );
    }
    replacements[ref.name] = texturePayload(
      {
        name: ref.name,
        format: ref.format,
        width: ref.width,
        height: ref.height,
        levels: ref.levels,
        bytes: ref.bytes,
      },
      rgba,
    );
  }
  if (!Object.keys(replacements).length) return { bytes: null, textures: [] };
  const patched = patchResourceTextures(raw, fileName, replacements);
  return { bytes: Buffer.from(patched.bytes), textures: patched.patched };
}

/* ------------------------------------------------------------------ *
 * Нутро: фермы, кран, вентиляция, галерея, связи, трубы, лампы
 * ------------------------------------------------------------------ */

/* Метка части нутра → переключатель работы (`hangarStructure`). */
const PART_SWITCHES = Object.freeze([
  [HANGAR_INTERIOR_PART.trusses, "trusses"],
  [HANGAR_INTERIOR_PART.crane, "crane"],
  /* Ангар стандартный (ТЗ 13.10.2026). */
  [HANGAR_INTERIOR_PART.vents, "vents"],
  [HANGAR_INTERIOR_PART.gallery, "gallery"],
  [HANGAR_INTERIOR_PART.bracing, "bracing"],
  [HANGAR_INTERIOR_PART.pipes, "pipes"],
  /* Лампы убраны (ТЗ 17.10.2026): плафоны с фонарями и подвесы над ними. */
  [HANGAR_INTERIOR_PART.lamps, "lampModels"],
  [HANGAR_INTERIOR_PART.rods, "lampModels"],
]);
const emptyRemoved = () =>
  Object.fromEntries(PART_SWITCHES.map(([, key]) => [key, 0]));
/* Имя части по метке — как в `counts` разбора нутра. */
const PART_NAME = Object.freeze(
  Object.fromEntries(
    Object.entries(HANGAR_INTERIOR_PART).map(([name, label]) => [label, name]),
  ),
);

/*
 * Треугольники сетки в точку (`drop(номер)`): все три индекса — первая
 * вершина, длина ресурса та же. Число сведённых.
 */
function collapseTriangles(view, mesh, drop, what) {
  let count = 0;
  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    if (!drop(triangle)) continue;
    if (!Number.isInteger(mesh.indicesAt))
      throw new Error(
        `Буфер индексов модели ангара не найден — ${what} не убрать.`,
      );
    const first = mesh.indices[triangle * 3];
    view.setUint16(mesh.indicesAt + (triangle * 3 + 1) * 2, first, true);
    view.setUint16(mesh.indicesAt + (triangle * 3 + 2) * 2, first, true);
    count += 1;
  }
  return count;
}

/* Все огни модели — сила, объём и ореол 0. Число погашенных. */
function darkenLights(resource) {
  const pointer = resource.view.getBigUint64(0xb0, true);
  const count = resource.view.getUint16(0xb8, true);
  if (!pointer || !count) return 0;
  const listAt = resource.at(pointer);
  const data = new DataView(
    resource.data.buffer,
    resource.data.byteOffset,
    resource.data.byteLength,
  );
  for (let index = 0; index < count; index += 1)
    for (const offset of LIGHT_OFF)
      data.setFloat32(listAt + index * LIGHT_BYTES + offset, 0, true);
  return count;
}

/* Свечение шейдеров модели (плафоны, лампочки) — 0; без свечения в модели — как было. */
function darkenGlow(bytes) {
  const shaders = readDrawableShaders(bytes).shaders.filter((shader) =>
    shader.parameters.some(
      (parameter) => parameter.hash === EMISSIVE && parameter.type === 1,
    ),
  );
  if (!shaders.length) return { bytes, glow: 0 };
  return {
    bytes: Buffer.from(
      patchDrawable(bytes, { vectors: { emissiveMultiplier: [0] } }).bytes,
    ),
    glow: shaders.length,
  };
}

/*
 * Коробки геометрий модели высокой детализации по адресу буфера вершин:
 * `Map(адрес данных вершин → { box, model })` — коробка самой геометрии и
 * общая коробка части (если геометрий больше одной). Подвес, вытянутый до
 * крыши, выходит за коробку своей геометрии (кран — до 7,1 м), и игра
 * отбрасывала бы его, глядя вверх.
 */
function geometryBoxes(resource) {
  const view = resource.view;
  const rootAt = resource.at(resource.root);
  const out = new Map();
  const listAt = pointerAt(resource, rootAt + 0x50);
  if (listAt < 0) return out;
  const list = readPointerList(resource, listAt);
  const entriesAt = resource.at(list.entries);
  for (let index = 0; index < list.count && entriesAt >= 0; index += 1) {
    const modelAt = pointerAt(resource, entriesAt + index * 8);
    if (modelAt < 0) continue;
    const count = view.getUint16(modelAt + 0x10, true);
    const geometriesAt = pointerAt(resource, modelAt + 0x08);
    const boundsAt = pointerAt(resource, modelAt + 0x18);
    if (geometriesAt < 0 || boundsAt < 0) continue;
    for (let slot = 0; slot < count; slot += 1) {
      const geometryAt = pointerAt(resource, geometriesAt + slot * 8);
      const bufferAt =
        geometryAt >= 0 ? pointerAt(resource, geometryAt + 0x18) : -1;
      if (bufferAt < 0) continue;
      let dataAt = pointerAt(resource, bufferAt + 0x10);
      if (dataAt < 0) dataAt = pointerAt(resource, bufferAt + 0x20);
      out.set(dataAt, {
        box: boundsAt + slot * 32,
        model: count > 1 ? boundsAt + count * 32 : null,
      });
    }
  }
  return out;
}

/* Верх коробки (Z, оси модели) — не ниже `top`. */
function raiseBox(view, boxAt, top) {
  if (boxAt == null || boxAt < 0) return;
  if (view.getFloat32(boxAt + 24, true) < top)
    view.setFloat32(boxAt + 24, top, true);
}

/* Части нутра, которых в модели нет, хотя работа их убирает: файлы не те. */
const PART_WORDS = Object.freeze({
  trusses: "ферм",
  crane: "крана",
  vents: "вентиляции",
  gallery: "галереи",
  bracing: "связей на стенах",
  pipes: "труб",
  lampModels: "ламп",
});

/**
 * Модель нутра ангара (и деталь со стенными трубами и фонарями) под
 * переключатели работы (`hangarStructure`): фермы, кран, вентиляция,
 * галерея, связи, трубы, убранные лампы с подвесами — треугольники в точку,
 * без ферм — подвесы ламп до крыши, лампы выключены или убраны — огни и
 * свечение 0. Длина ресурса та же. `required` — части, что обязаны быть в
 * модели, если работа их убирает (подвесы у ламп — по желанию: у детали их
 * нет). `{ bytes, changed, removed: { trusses, crane, vents, gallery,
 * bracing, pipes, lampModels }, raised, lights, glow }`.
 */
export function patchHangarInterior(
  bytes,
  input,
  interior = HANGAR_INTERIOR,
  {
    required = ["trusses", "crane", "vents", "gallery", "bracing", "lampModels"],
    rods = true,
  } = {},
) {
  const structure = hangarStructure(input);
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const result = {
    bytes: raw,
    changed: false,
    removed: emptyRemoved(),
    raised: 0,
    lights: 0,
    glow: 0,
  };
  const dropped = PART_SWITCHES.filter(([, key]) => !structure[key]);
  /* Убранным лампам подвесы до крыши не нужны — они уходят вместе с лампами. */
  const raise = rods && !structure.trusses && structure.lampModels;
  if (!dropped.length && structure.lamps) return result;
  const resource = openResourceWith(raw, inflateRaw);
  const view = resource.view;
  if (dropped.length) {
    const drawable = readDrawable(resource, { inflateRaw }).drawables[0];
    const { meshes, counts } = hangarInteriorParts(
      drawable.meshes,
      sheetOf,
      interior,
    );
    const absent = [
      ...new Set(
        dropped
          .filter(
            ([label, key]) =>
              label !== HANGAR_INTERIOR_PART.rods &&
              required.includes(key) &&
              !counts[PART_NAME[label]],
          )
          .map(([, key]) => key),
      ),
    ];
    if (absent.length)
      throw new Error(
        `В модели ангара не нашлось ${absent.map((key) => PART_WORDS[key]).join(", ")} — файлы игры не те, что знает Astral.`,
      );
    const labelsOff = new Map(dropped);
    const boxes = raise ? geometryBoxes(resource) : null;
    const rootAt = resource.at(resource.root);
    drawable.meshes.forEach((mesh, meshIndex) => {
      const { labels, rods: rodVertices } = meshes[meshIndex];
      for (const [label, key] of labelsOff)
        result.removed[key] += collapseTriangles(
          view,
          mesh,
          (triangle) => labels[triangle] === label,
          PART_WORDS[key],
        );
      if (!raise || !rodVertices.size) return;
      /* Подвесы — до крыши: верх стойки поднимается, низ у лампы остаётся.
         Позиция вершины — первые три float (оси модели, Z вверх). */
      let top = -Infinity;
      for (const [vertex, rod] of rodVertices) {
        const at = mesh.vertexDataAt + vertex * mesh.vertexStride;
        const x = view.getFloat32(at, true);
        const z = view.getFloat32(at + 8, true);
        if (
          Math.abs(x - mesh.positions[vertex * 3]) > 1e-3 ||
          Math.abs(z - mesh.positions[vertex * 3 + 1]) > 1e-3
        )
          throw new Error(
            "Раскладка вершин модели нутра не та — подвесы ламп не вытянуть.",
          );
        const next = hangarRodHeight(rod, z);
        if (next === z) continue;
        view.setFloat32(at + 8, next, true);
        top = Math.max(top, next);
        result.raised += 1;
      }
      const box = boxes.get(mesh.vertexDataAt);
      if (box && Number.isFinite(top)) {
        raiseBox(view, box.box, top);
        raiseBox(view, box.model, top);
        /* Коробка всей модели: низ — 0x30, верх — 0x40 (Z — +0x48). */
        raiseBox(view, rootAt + 0x30, top);
      }
    });
  }
  if (!structure.lamps) result.lights = darkenLights(resource);
  let out = repack(raw, resource);
  if (!structure.lamps) {
    const dimmed = darkenGlow(out);
    out = dimmed.bytes;
    result.glow = dimmed.glow;
  }
  return { ...result, bytes: out, changed: true };
}

/** Лампы на стенах (деталь ангара) выключены: огни и свечение плафонов 0. `{ bytes, lights, glow }`. */
export function darkenHangarLamps(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateRaw);
  const lights = darkenLights(resource);
  const dimmed = darkenGlow(repack(raw, resource));
  return { bytes: dimmed.bytes, lights, glow: dimmed.glow };
}

/**
 * Деталь ангара (синие трубы и фонари на стенах) под работу: без труб —
 * треугольники труб в точку, лампы выключены — огни и свечение 0 (Ангар
 * стандартный, ТЗ 13.10.2026), лампы убраны — ещё и фонари с кронштейнами
 * и стёклами в точку (ТЗ 17.10.2026). `{ bytes, changed, pipes, lamps,
 * lights }` — `lamps` — сведённых треугольников фонарей.
 */
export function patchHangarDetail(bytes, input, interior = HANGAR_INTERIOR) {
  const structure = hangarStructure(input);
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (structure.pipes && structure.lamps)
    return { bytes: raw, changed: false, pipes: 0, lamps: 0, lights: 0 };
  /* Железяк нутра в детали нет: на месте только трубы и фонари работы. */
  const result = patchHangarInterior(
    raw,
    {
      ...normalizeHangarProject(input),
      trusses: true,
      crane: true,
      vents: true,
      gallery: true,
      bracing: true,
    },
    interior,
    {
      required: [
        ...(structure.pipes ? [] : ["pipes"]),
        ...(structure.lampModels ? [] : ["lampModels"]),
      ],
      rods: false,
    },
  );
  return {
    bytes: result.bytes,
    changed: result.changed,
    pipes: result.removed.pipes,
    lamps: result.removed.lampModels,
    lights: result.lights,
  };
}

/** Модель перил галереи без галереи — все треугольники в точку. `{ bytes, removed }`. */
export function collapseHangarRailings(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const resource = openResourceWith(raw, inflateRaw);
  let removed = 0;
  for (const drawable of readDrawable(resource, { inflateRaw }).drawables)
    for (const mesh of drawable.meshes)
      removed += collapseTriangles(
        resource.view,
        mesh,
        () => true,
        "перила галереи",
      );
  if (!removed)
    throw new Error(
      "В модели перил галереи нет треугольников — файлы игры не те, что знает Astral.",
    );
  return { bytes: repack(raw, resource), removed };
}

/* ------------------------------------------------------------------ *
 * Корпус: накладки и копии листов соседей (Ангар стандартный, ТЗ 13.10.2026)
 * ------------------------------------------------------------------ */

/**
 * Накладки корпуса крашеных сторон — в точку: грани накладок (`overlays`
 * описи) по сторонам (`hangarShellLabels`): снаружи, внутри, пол. Сторона
 * «Стандарт GTA» — накладки как в игре. `{ bytes, removed: { outside,
 * inside, floor } }`; нечего убирать — `bytes` те же.
 */
export function patchHangarShell(bytes, input, overlays = HANGAR_OVERLAYS) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const removed = { outside: 0, inside: 0, floor: 0 };
  const painted = HANGAR_FACE_SURFACES.map(
    (surface) => Boolean(surface) && hangarSidePainted(input, surface),
  );
  if (!painted.some(Boolean)) return { bytes: raw, removed };
  const names = new Set(overlays);
  const resource = openResourceWith(raw, inflateRaw);
  const drawable = readDrawable(resource, { inflateRaw }).drawables[0];
  const labels = hangarShellLabels(drawable.meshes);
  drawable.meshes.forEach((mesh, meshIndex) => {
    if (!names.has(sheetOf(mesh))) return;
    for (const [label, surface] of HANGAR_FACE_SURFACES.entries())
      if (surface && painted[label])
        removed[surface] += collapseTriangles(
          resource.view,
          mesh,
          (triangle) => labels[meshIndex][triangle] === label,
          "накладки",
        );
  });
  if (!removed.outside && !removed.inside && !removed.floor)
    return { bytes: raw, removed };
  return { bytes: repack(raw, resource), removed };
}

/**
 * Модель разметки пола (ТЗ 17.10.2026): разметка выключена — линии и знаки
 * (`markings` описи) в точку; грязь той же модели (всё, что не разметка) —
 * в точку по сторонам граней у крашеного пола (грани вверх) и стен изнутри
 * (`hangarLinesLabels`). `{ bytes, markings, overlays: { inside, floor } }`;
 * нечего менять — `bytes` те же.
 */
export function patchHangarLines(bytes, input, markings = HANGAR_MARKINGS) {
  const project = normalizeHangarProject(input);
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const result = { bytes: raw, markings: 0, overlays: { inside: 0, floor: 0 } };
  const painted = HANGAR_FACE_SURFACES.map(
    (surface) => Boolean(surface) && hangarSidePainted(project, surface),
  );
  if (project.markings && !painted.some(Boolean)) return result;
  const names = new Set(markings);
  const resource = openResourceWith(raw, inflateRaw);
  const drawable = readDrawable(resource, { inflateRaw }).drawables[0];
  const labels = hangarLinesLabels(drawable.meshes);
  let found = 0;
  drawable.meshes.forEach((mesh, meshIndex) => {
    if (names.has(sheetOf(mesh))) {
      found += 1;
      if (!project.markings)
        result.markings += collapseTriangles(
          resource.view,
          mesh,
          () => true,
          "разметку пола",
        );
      return;
    }
    for (const [label, surface] of HANGAR_FACE_SURFACES.entries())
      if (surface && painted[label] && surface in result.overlays)
        result.overlays[surface] += collapseTriangles(
          resource.view,
          mesh,
          (triangle) => labels[meshIndex][triangle] === label,
          "грязь у разметки",
        );
  });
  if (!project.markings && !found)
    throw new Error(
      "В модели разметки пола ангара нет линий и знаков — файлы игры не те, что знает Astral.",
    );
  if (!result.markings && !result.overlays.inside && !result.overlays.floor)
    return result;
  return { ...result, bytes: repack(raw, resource) };
}

/*
 * Листы соседей, что едут копией в модели корпуса: `[{ name, record }]` с
 * обликом работы — крашеные листы поверхностей и (ТЗ 17.10.2026) штатные
 * листы и накладки с ржавчиной своего цвета; лист в обеих описях — один раз.
 */
function sheetCopies(project, fileName) {
  const out = new Map();
  for (const [table, lookOf] of [
    [HANGAR_SHEETS, hangarSheetLook],
    [HANGAR_RUST, hangarRustLook],
  ])
    for (const [name, record] of Object.entries(table))
      if (
        record.copy &&
        record.files.includes(fileName) &&
        !out.has(name) &&
        lookOf(project, name)
      )
        out.set(name, { name, record });
  return [...out.values()];
}

/*
 * Копии листов соседей — в модель корпуса: штатный лист читается из своего
 * словаря игры и едет в нативный хост DDS той же раскладки, байт в байт
 * (формат, мипы); имя и флаги хост берёт у штатного листа. Красит копию потом
 * `bakeHangarSheets` — на месте, как свои листы корпуса.
 */
async function embedSheetCopies({
  base,
  fileName,
  copies,
  game,
  compile,
  stateDir,
}) {
  if (typeof compile !== "function")
    throw new Error("Сборщик листов ангара не подключён — обновите Astral.");
  const staging = path.join(
    stateDir || "",
    "recolor",
    "hangar",
    "embed",
    randomUUID(),
  );
  await fs.mkdir(staging, { recursive: true });
  try {
    const sources = new Map();
    const textures = [];
    for (const [index, { name, record }] of copies.entries()) {
      let source = sources.get(record.copy.at);
      if (!source) {
        const bytes = await game.read(record.copy.at).catch(() => null);
        if (!bytes)
          throw new Error(
            `Лист ${name} не прочитан из игры (${record.copy.file}) — проверьте файлы GTA V.`,
          );
        const file = path.join(staging, `s${sources.size}.ytd`);
        await fs.writeFile(file, bytes, { flag: "wx" });
        const { refs } = resourceRefs(new Uint8Array(bytes), record.copy.file);
        source = {
          file,
          refs: new Map(refs.map((ref) => [ref.name.toLowerCase(), ref])),
        };
        sources.set(record.copy.at, source);
      }
      const ref = source.refs.get(name);
      if (!ref?.complete)
        throw new Error(
          `Лист ${name} в ${record.copy.file} не найден или повреждён.`,
        );
      const data = ref.resource.data.subarray(
        ref.dataAt,
        ref.dataAt + ref.bytes,
      );
      const dds = Buffer.concat([
        Buffer.from(
          writeDdsHeader({
            width: ref.width,
            height: ref.height,
            mipLevels: ref.levels,
            format: ref.format,
          }),
        ),
        Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      ]);
      const target = path.join(staging, `t${index}.dds`);
      await fs.writeFile(target, dds, { flag: "wx" });
      textures.push({ name, dds: target, source: source.file });
    }
    const extension = path.extname(fileName);
    const input = path.join(staging, `in${extension}`);
    const output = path.join(staging, `out${extension}`);
    const request = path.join(staging, "request.json");
    await fs.writeFile(input, base, { flag: "wx" });
    await fs.writeFile(
      request,
      JSON.stringify({
        format: "astral.shop-embed-textures",
        version: 1,
        target: input,
        textures,
      }),
    );
    await compile("shop-embed-textures", { input: request, output });
    const bytes = await fs.readFile(output).catch(() => null);
    if (!bytes?.length)
      throw new Error(`Сборка листов ангара ${fileName} не дала файла.`);
    return bytes;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ *
 * Дальний ангар
 * ------------------------------------------------------------------ */

/* Облик поверхности вдали: «Стандарт» — как в игре, свой цвет — тоном, отделка — переносом листа HD. */
export function lodOp(project, surface) {
  const settings = hangarSurfaceSettings(project, surface);
  if (!settings) return null;
  if (settings.mode === "colour")
    return {
      kind: "tint",
      colour: settings.colour,
      brightness:
        surface === "floor" && project.floor.mode === "colour"
          ? 1
          : settings.brightness / 100,
    };
  const fallback =
    settings.mode === "pattern"
      ? settings.pattern?.colours?.[0]
      : settings.mode === "gradient"
        ? settings.gradient?.colours?.[0]
        : settings.image?.tint;
  return { kind: "transfer", fallback: fallback || "#8a8a8a" };
}

/** Номер облика дальнего вида у листа: поверхность листа по настройкам (потолок — свой), `-1` — лист вдали не правится. */
export function lodLookOf(sheet, record) {
  return record ? SURFACES.indexOf(hangarSheetSurface(sheet, record)) : -1;
}

/**
 * Дальний ангар — общей системой LOD: поле облика — грани корпуса и нутра
 * сетевой карты на своих местах, облик грани — поверхность её листа.
 * `files` — собранные файлы (для переноса правленых листов). `{ files, report }`.
 */
export async function buildHangarLod(input, { game, lod, files = [] }) {
  const project = normalizeHangarProject(input);
  const ops = SURFACES.map((surface) => lodOp(project, surface));
  if (!lod || !game || !ops.some(Boolean)) return { files: [], report: null };
  /* Лист HD под текселем дальней модели — из файла сетевой карты. */
  const records = new Map();
  for (const [sheet, record] of Object.entries(HANGAR_SHEETS)) {
    const file = HANGAR_FILES.find(
      (item) =>
        /\.ydr$/.test(item.name) &&
        /^hei_/.test(item.name) &&
        record.files.includes(item.name),
    );
    if (file) records.set(sheet, { at: file.at, file: file.name });
  }
  const sampler = ops.some((op) => op?.kind === "transfer")
    ? createSurfaceSampler({ game, files, records })
    : null;
  if (sampler) await sampler.prepare();
  const field = createLookField();
  const own = new Map(
    files.map((file) => [file.name.toLowerCase(), file.bytes]),
  );
  for (const placement of HANGAR_INVENTORY.hangar.placements || []) {
    const name = String(placement.at || "")
      .split("/")
      .pop()
      .toLowerCase();
    if (!/sthbld3(_int)?\.ydr$/.test(name)) continue;
    const bytes =
      own.get(name) || (await game.read(placement.at).catch(() => null));
    if (!bytes) continue;
    const drawable = readDrawable(
      openResourceWith(new Uint8Array(bytes), inflateRaw),
      { inflateRaw },
    ).drawables[0];
    const toWorld = placementTransform(placement);
    for (const mesh of drawable.meshes) {
      const record = HANGAR_SHEETS[sheetOf(mesh)];
      const look = lodLookOf(sheetOf(mesh), record);
      if (look < 0 || !ops[look]) continue;
      const sample = sampler && mesh.uvs ? sampler.colourOf(mesh) : null;
      const points = [];
      for (let at = 0; at < mesh.positions.length; at += 3)
        points.push(
          toWorld(
            toGame(
              mesh.positions[at],
              mesh.positions[at + 1],
              mesh.positions[at + 2],
            ),
          ),
        );
      for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
        const ids = [
          mesh.indices[at],
          mesh.indices[at + 1],
          mesh.indices[at + 2],
        ];
        field.addTriangle(
          points[ids[0]],
          points[ids[1]],
          points[ids[2]],
          look,
          sample
            ? {
                sample,
                uv: ids.map((id) => [mesh.uvs[id * 2], mesh.uvs[id * 2 + 1]]),
              }
            : null,
        );
      }
    }
  }
  /* Нутро, пол и потолок издалека не видны: уровням SLOD — только облик снаружи. */
  return buildLodFiles({ lod, game, field, ops, interior: [1, 2, 3] });
}

/* ------------------------------------------------------------------ *
 * Сборка
 * ------------------------------------------------------------------ */

/**
 * Файлы ангара под работу. `game` — чтение игры игрока, `images` — картинки
 * отделки (ключ → картинка), `emblems` — картинки эмблем и надписей по
 * `asset`, `compile` — нативный хост (плашки), `lod` — опись дальней
 * прорисовки. `{ files, patches, report, lodReport? }`; всё «Стандарт GTA» —
 * файлов нет.
 */
export async function buildHangarFiles(
  input,
  {
    game = null,
    images = new Map(),
    emblems = new Map(),
    compile = null,
    stateDir = "",
    lod = null,
  } = {},
) {
  const project = normalizeHangarProject(input);
  if (hangarProjectIsStock(project))
    return { files: [], patches: [], report: { stock: true } };
  if (!game)
    throw new Error(
      "Ангар собирается из файлов вашей игры — подключите GTA V.",
    );
  const structure = hangarStructure(project);
  const sources = new Map();
  const sourceOf = (settings) => {
    const key = JSON.stringify([
      settings.mode,
      settings.pattern,
      settings.image,
      settings.gradient,
    ]);
    if (!sources.has(key)) sources.set(key, finishSource(settings, images));
    return sources.get(key);
  };
  const files = [];
  const patches = [];
  const report = {
    changed: 0,
    missing: [],
    removed: emptyRemoved(),
    raised: 0,
    lights: 0,
    plates: 0,
    /* Ангар стандартный (ТЗ 13.10.2026): накладки крашеных сторон и копии листов соседей. */
    overlays: { outside: 0, inside: 0, floor: 0 },
    copies: 0,
    /* Сведённых треугольников разметки пола (ТЗ 17.10.2026). */
    markings: 0,
  };

  for (const file of HANGAR_FILES) {
    /* Перила галереи едут, только если галерею убрали. */
    if (file.role === "railings" && structure.gallery) continue;
    const base = await game.read(file.at).catch(() => null);
    if (!base) {
      report.missing.push(file.name);
      continue;
    }
    const patch = { file: file.name };
    let bytes = null;
    /* Корпус: копии листов соседей — до покраски, покраска — как своих. Нутро: блочный лист дома из словаря района (`hangar-house.js`) — только когда у «Стен» дома задан свой цвет. */
    const copies =
      file.role === "shell" && /\.ydr$/.test(file.name)
        ? sheetCopies(project, file.name)
        : file.role === "interior" && /\.ydr$/.test(file.name)
          ? hangarHouseSheetCopies(project, file.name)
          : [];
    if (copies.length) {
      bytes = await embedSheetCopies({
        base,
        fileName: file.name,
        copies,
        game,
        compile,
        stateDir,
      });
      patch.copies = copies.map((item) => item.name);
      report.copies += copies.length;
    }
    const baked = bakeHangarSheets(bytes || base, file.name, project, sourceOf);
    if (baked.bytes) bytes = baked.bytes;
    if (baked.textures.length) patch.textures = baked.textures;
    if (file.role === "shell" && /\.ydr$/.test(file.name)) {
      const shell = patchHangarShell(bytes || base, project);
      if (shell.bytes !== (bytes || base)) {
        bytes = shell.bytes;
        patch.overlays = shell.removed;
        for (const side of Object.keys(report.overlays))
          report.overlays[side] += shell.removed[side];
      }
    }
    if (file.role === "interior") {
      const result = patchHangarInterior(bytes || base, project);
      if (result.changed) {
        bytes = result.bytes;
        patch.structure = {
          ...structure,
          removed: result.removed,
          raised: result.raised,
        };
        for (const key of Object.keys(report.removed))
          report.removed[key] += result.removed[key];
        report.raised += result.raised;
        report.lights += result.lights;
      }
    }
    if (file.role === "detail") {
      const result = patchHangarDetail(bytes || base, project);
      if (result.changed) {
        bytes = result.bytes;
        if (!structure.lamps) patch.lamps = false;
        if (!structure.lampModels) patch.lampModels = false;
        if (!structure.pipes) patch.pipes = false;
        report.removed.pipes += result.pipes;
        report.removed.lampModels += result.lamps;
        report.lights += result.lights;
      }
    }
    if (file.role === "railings") {
      const result = collapseHangarRailings(bytes || base);
      bytes = result.bytes;
      patch.gallery = false;
      report.removed.gallery += result.removed;
    }
    /* Разметка пола (ТЗ 17.10.2026). */
    if (file.role === "lines") {
      const result = patchHangarLines(bytes || base, project);
      if (result.bytes !== (bytes || base)) {
        bytes = result.bytes;
        if (!project.markings) patch.markings = false;
        if (result.overlays.inside || result.overlays.floor)
          patch.overlays = { outside: 0, ...result.overlays };
        report.markings += result.markings;
        for (const side of Object.keys(result.overlays))
          report.overlays[side] += result.overlays[side];
      }
    }
    /* Мастерская ангара — цвета: проходы частей А (свет ламп), Б (конструкции и трубы) — над тем, что уже собрано для файла; пока части не готовы, проходы ничего не меняют. */
    for (const pass of HANGAR_PASSES) {
      const current = bytes || base;
      const result = await pass({ file, bytes: current, project, structure });
      if (result?.bytes && result.bytes !== current) {
        bytes = result.bytes;
        Object.assign(patch, result.patch || {});
      }
    }
    if (!bytes) continue;
    files.push({ name: file.name, bytes: Buffer.from(bytes) });
    patches.push(patch);
    report.changed += 1;
  }

  /* Эмблемы и надписи — плашками, перед деталями стен ангара. */
  const plates = hangarEmblemPlates(project);
  if (plates.length) {
    const own = new Map(
      files.map((file) => [file.name.toLowerCase(), file.bytes]),
    );
    const read = async (placement) =>
      own.get(
        String(placement.at || "")
          .split("/")
          .pop()
          .toLowerCase(),
      ) || (placement.at ? game.read(placement.at).catch(() => null) : null);
    const near = await nearPlateTriangles(
      plates,
      HANGAR_INVENTORY.hangar.placements || [],
      read,
    );
    const built = await buildAssetPlates({
      far: { lod, game },
      near,
      plates,
      images: emblems,
      compile,
      stateDir,
      set: "hangar",
      names: { types: HANGAR_PLATE.types, map: HANGAR_PLATE.map },
      files: hangarPlateFiles,
    });
    files.push(...built);
    patches.push({ file: "plates", plates: plates.map((plate) => plate.name) });
    report.plates = plates.length;
  }

  /* Дальний ангар. */
  let lodReport = null;
  const lodBuilt = await buildHangarLod(project, { game, lod, files });
  if (lodBuilt.files.length) {
    const names = new Set(lodBuilt.files.map((file) => file.name));
    for (let index = files.length - 1; index >= 0; index -= 1)
      if (names.has(files[index].name)) files.splice(index, 1);
    files.push(...lodBuilt.files);
    patches.push({ file: "lod", lod: true, files: [...names] });
    lodReport = lodBuilt.report;
  }
  return { files, patches, report, ...(lodReport ? { lodReport } : {}) };
}
