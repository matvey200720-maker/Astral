/*
 * Здания из игры в файлах — «Мегамолл» и «Ашан / Икея».
 *
 * Основа — штатные файлы игры игрока (адреса — опись места, читаются из его
 * игры). Пакет везёт только файлы, где что-то поменялось; всё «Стандарт» —
 * пакета нет вовсе, «Применить» снимает установку.
 *
 *   Части здания (стены, крыша, отделка, навесы, земля) — листы на месте
 *     (`recolor-sheets.js`): тон по светотени, эффект полосой, общая
 *     отделка. Лист у нескольких частей красится обликом той, чьих граней
 *     больше (площади — опись); вывески внутри листа стены не красятся
 *     (`exclude` — острова надписи и табличек).
 *   Надпись и таблички — картинками окна в острова своих листов (слои
 *     `layers`), «Убрать» — прозрачные острова (или пустая плашка у листа
 *     без прозрачности). Каждая правка — и в HD-копию листа (`+hi`,
 *     `+hidr`): игра подменяет лист на неё вблизи.
 *   Стороны, эмблемы, надписи, стены с картинкой и надпись-плашка — плашками одним вызовом нативного
 *     хоста (`compile-emblem-plates`): лист плашки собирается здесь из
 *     исходной картинки той же арифметикой, что у кадра
 *     (`building-images.js`), рельеф стены — лист игры игрока.
 *   Дальние планы — общей системой LOD: тон частей и наложения по плоскости
 *     (стороны, логотипы, надпись) — в листах LOD и SLOD; издалека здание
 *     не прыгает в штатный облик.
 */

import { decodeTextureRef, readDrawable } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import { colourEffectAt, hexBytes, normalizeColourEffect } from "@modovik/climb-contract/recolor";
import {
  BUILDING_PART_IDS,
  BUILDING_SIDE_IDS,
  buildingPanelPlateSize,
  buildingSidePanels,
  buildingSideUsesPanels,
  BUILDING_TINT_LIFT,
  buildingBillboardDecal,
  buildingBillboards,
  buildingCoverErasures,
  buildingCoverRails,
  buildingCoverJobs,
  buildingDominantPart,
  buildingGrimeHidden,
  buildingEmblemDecals,
  buildingInventory,
  buildingOrigin,
  buildingPartSettings,
  buildingPlateNames,
  buildingPlates,
  buildingProjectIsStock,
  buildingSide,
  buildingSideDecal,
  buildingSidePrints,
  buildingTextJobs,
  buildingTextPlates,
  buildingTitle,
  buildingClearedRegions,
  buildingWallDecals,
  buildingWallTexture,
  normalizeBuildingProject,
} from "@modovik/climb-contract/recolor/buildings";
import { clearOnPlate, fitImagePixels, islandImage, maskSidePlate, printOnPlate, sideBannerPixels, sidePlateSize, sideColourPixels, wallPanelPixels } from "@modovik/climb-contract/recolor/building-images";
import { finishSource } from "./finish-bake.js";
import { buildEmblemPlates } from "./recolor-emblem.js";
import { placementTransform } from "@modovik/climb-contract/recolor/placement";
import { hideGrimeDecals } from "./recolor-grime.js";
import { buildLodFiles, createLookField, createSurfaceSampler, nearPlateTriangles } from "./recolor-lod.js";
import { bakeFile, inflateRaw, resourceRefs } from "./recolor-sheets.js";

const isPlate = (record) => Math.max(record?.width || 0, record?.height || 0) <= 8;

/* Картинка плашки одним цветом (место таблички «Убрать» у листа без прозрачности). */
function solidImage(hex) {
  const [r, g, b] = hexBytes(hex);
  const rgba = new Uint8ClampedArray(16 * 16 * 4);
  for (let at = 0; at < rgba.length; at += 4) {
    rgba[at] = r;
    rgba[at + 1] = g;
    rgba[at + 2] = b;
    rgba[at + 3] = 255;
  }
  return { rgba, width: 16, height: 16 };
}
const opaqueFormat = (format) => /DXT1|BC1/i.test(String(format || ""));

/* ------------------------------------------------------------------ *
 * Облик листа
 * ------------------------------------------------------------------ */

/** Часть, чьих граней у листа больше (из частей здания), или `null` — общая с кадром (`buildingDominantPart`). */
export const dominantPart = buildingDominantPart;

/* Правка листа по облику части: тон, эффект полосой или отделка. */
function surfaceOp(settings, record) {
  if (!settings || settings.mode === "standard") return null;
  if (settings.mode === "colour") {
    const look = normalizeColourEffect(settings.look);
    if (look.mode === "solid") return isPlate(record) ? { flat: hexBytes(look.colour) } : { tint: look.colour, lift: BUILDING_TINT_LIFT };
    return { strip: look, lift: BUILDING_TINT_LIFT };
  }
  return { finish: settings };
}

/* Острова надписи и табличек в листе — для `exclude`. */
const regionRects = (record) => (record?.regions || []).flatMap((region) => region.islands.map((island) => island.rect));

/**
 * Правки по файлам: `Map` имя файла → `{ at, ops: Map(лист → правка) }`.
 * HD-копия листа получает ту же правку под своим именем файла.
 */
export function buildingOpsByFile(place, input, { pictures = {} } = {}) {
  const project = normalizeBuildingProject(place, input);
  const inventory = buildingInventory(place)?.building;
  const byFile = new Map();
  const add = (file, at, name, op) => {
    const entry = byFile.get(file) || { at, ops: new Map() };
    entry.ops.set(name, op);
    byFile.set(file, entry);
  };
  /* Текст и «Убрать» — слоями по листам. */
  const layers = new Map();
  const pushLayer = (texture, layer) => layers.set(texture, [...(layers.get(texture) || []), layer]);
  const records = new Map((inventory?.textures || []).map((record) => [record.name, record]));
  for (const job of buildingTextJobs(project, place)) {
    job.regions.forEach((region, regionIndex) => {
      const record = records.get(region.texture);
      const opaque = opaqueFormat(record?.format);
      region.islands.forEach((island, islandIndex) => {
        const key = `text:${job.key}:${regionIndex}:${islandIndex}`;
        if (!pictures[key]) throw new Error("Картинка надписи не пришла — нажмите «Применить» ещё раз.");
        const clear = !opaque && job.settings.background !== "colour";
        pushLayer(region.texture, { islands: [island], image: key, transform: { fit: "stretch", background: clear ? "clear" : "colour", backgroundColour: job.settings.backgroundColour } });
      });
    });
  }
  /* «Убрать» и острова, разошедшиеся по плашкам мест (их рисуют плашки
     `buildingTextPlates`), — прозрачными (или пустой плашкой у листа без
     прозрачности). */
  for (const region of buildingClearedRegions(project, place))
    pushLayer(region.texture, { islands: region.islands, image: null, transform: { background: region.opaque ? "colour" : "clear", backgroundColour: region.colour } });

  for (const record of inventory?.textures || []) {
    /* Палитра тинта перекрашенного листа — белая: цвет работы виден как есть. */
    if (record.role === "palette") {
      const tinted = records.get(record.tints);
      const part = dominantPart(tinted);
      if (!part || !surfaceOp(buildingPartSettings(project, place, part), tinted)) continue;
      const op = { flat: [255, 255, 255] };
      add(record.file, record.at || null, record.name, op);
      if (record.hd?.file) add(record.hd.file, record.hd.at || null, record.name, op);
      continue;
    }
    if (record.role !== "diffuse") continue;
    const part = dominantPart(record);
    const base = part ? surfaceOp(buildingPartSettings(project, place, part), record) : null;
    const own = layers.get(record.name) || null;
    if (!base && !own) continue;
    const exclude = base ? regionRects(record) : [];
    const op = own ? { ...(base ? { base: { ...base, ...(exclude.length ? { exclude } : {}) } } : {}), layers: own } : { ...base, ...(exclude.length ? { exclude } : {}) };
    add(record.file, record.at || null, record.name, op);
    if (record.hd?.file) add(record.hd.file, record.hd.at || null, record.name, op);
  }
  return byFile;
}

/* ------------------------------------------------------------------ *
 * Плашки
 * ------------------------------------------------------------------ */

/* Рельеф стороны — лист стены из игры игрока пикселями (кэш на сборку). */
async function reliefOf(game, side, cache) {
  if (!side?.relief?.at) return null;
  const key = `${side.relief.at}|${side.relief.texture}`;
  if (cache.has(key)) return cache.get(key);
  let pixels = null;
  try {
    const bytes = await game.read(side.relief.at);
    if (bytes) {
      const { refs } = resourceRefs(new Uint8Array(bytes), side.relief.at.split("/").pop());
      const ref = refs.find((item) => item.name.toLowerCase() === side.relief.texture && item.complete);
      if (ref) {
        /* Мип-уровень около 512 px: плотности плашки хватает, а сборка лёгкая. */
        const level = Math.max(0, Math.min(ref.levels - 1, Math.round(Math.log2(Math.max(ref.width, ref.height) / 512))));
        const decoded = decodeTextureRef(ref, { level });
        pixels = { rgba: new Uint8ClampedArray(decoded.rgba), width: decoded.width, height: decoded.height };
      }
    }
  } catch {
    pixels = null;
  }
  cache.set(key, pixels);
  return pixels;
}

/* Лист надписи или таблички из игры игрока пикселями (HD-копия, если есть). */
async function signSheetOf(game, place, texture, cache) {
  if (cache.has(texture)) return cache.get(texture);
  const record = (buildingInventory(place)?.building?.textures || []).find((item) => item.name === texture);
  let pixels = null;
  for (const where of [record?.hd, record].filter(Boolean)) {
    try {
      const bytes = where.at ? await game.read(where.at) : null;
      if (!bytes) continue;
      const { refs } = resourceRefs(new Uint8Array(bytes), where.file);
      const ref = refs.find((item) => item.name.toLowerCase() === texture && item.complete);
      if (!ref) continue;
      const level = Math.max(0, Math.min(ref.levels - 1, Math.round(Math.log2(Math.max(ref.width, ref.height) / 1024))));
      const decoded = decodeTextureRef(ref, { level });
      pixels = { rgba: new Uint8ClampedArray(decoded.rgba), width: decoded.width, height: decoded.height };
      break;
    } catch {
      pixels = null;
    }
  }
  cache.set(texture, pixels);
  return pixels;
}

/*
 * Надпись и таблички стены — печатью поверх плашки стороны: свой текст —
 * картинкой окна, стандартный — островом листа игры (та же раскладка у
 * кадра, `buildingSidePrints`).
 */
async function printSide(image, project, place, id, { game, pictures, sheets }) {
  const prints = buildingSidePrints(project, place, id);
  if (!prints.length) return image;
  const rgba = new Uint8ClampedArray(image.rgba);
  for (const print of prints) {
    if (print.hole) {
      clearOnPlate(rgba, image.width, image.height, print.rect);
      continue;
    }
    const item = print.group === "title" ? project.title : project.signs[print.group.slice(5)];
    let picture = null;
    if (item?.mode === "text" && item.lines.some((line) => line.trim())) picture = pictures[`text:${print.group}:${print.regionIndex}:${print.islandIndex}`] || null;
    else {
      const sheet = game ? await signSheetOf(game, place, print.texture, sheets) : null;
      if (sheet) picture = islandImage(sheet, print.island, { longest: 1024 });
    }
    if (picture) printOnPlate(rgba, image.width, image.height, print.rect, picture);
  }
  return { ...image, rgba };
}

/**
 * Листы плашек работы: `{ key → { rgba, width, height, texture } }` —
 * стороны (баннер или цвет), логотипы, надпись-плашка. `pictures` —
 * картинки окна (`side:<id>`, `emblem:<id>`, `title`).
 */
export async function buildingPlateImages(place, input, { game = null, pictures = {} } = {}) {
  const project = normalizeBuildingProject(place, input);
  const out = {};
  const cache = new Map();
  const sheets = new Map();
  /* Стороны, чьи плашки собраны панелями целиком (печать и маска уже наложены). */
  const paneled = new Set();
  for (const id of BUILDING_SIDE_IDS) {
    const side = buildingSide(place, id);
    const item = project.sides[id];
    if (!side || !buildingSideDecal(project, place, id)) continue;
    const [width, height] = sidePlateSize(side.width, side.height);
    if (item.mode === "banner" && buildingSideUsesPanels(project, place, id)) {
      /*
       * Широкая стена со своей картинкой выше 2048 px — панелями (задача 6Б):
       * картинка вписывается во всю стену в разрешении листов панелей, надпись и
       * таблички печатаются на целой стене, маска — по стене, и стена режется на
       * куски `side:<id>:<n>`, каждый — лист своей плашки. Целая стена в размере
       * обычной плашки (`side:<id>`) нужна дальним планам: плашкой она не ставится.
       */
      const image = pictures[`side:${id}`];
      if (!image) throw new Error(`Картинка баннера «${side.label}» не пришла — выберите её ещё раз.`);
      const layout = buildingSidePanels(place, id);
      const [plateWidth, plateHeight] = buildingPanelPlateSize(place, id);
      /* Стена в тех же пикселях, что и листы панелей: каждая панель — ровно свой кусок, без пересчёта. */
      const wallWidth = plateWidth * layout.count;
      const wallHeight = plateHeight;
      const wall = { rgba: fitImagePixels(image, wallWidth, wallHeight, { fit: item.fit, background: item.background, aspect: side.width / side.height }), width: wallWidth, height: wallHeight, texture: [wallWidth, wallHeight] };
      const printed = await printSide(wall, project, place, id, { game, pictures, sheets });
      for (const panel of layout.panels) {
        const sheet = wallPanelPixels(printed, [panel.s0, panel.s1], plateWidth, plateHeight);
        out[panel.key] = { rgba: maskSidePlate(sheet, plateWidth, plateHeight, side.mask, [panel.s0, panel.s1]), width: plateWidth, height: plateHeight, texture: [plateWidth, plateHeight] };
      }
      const far = fitImagePixels({ rgba: printed.rgba, width: wallWidth, height: wallHeight }, width, height, { fit: "stretch" });
      out[`side:${id}`] = { rgba: maskSidePlate(far, width, height, side.mask), width, height, texture: [width, height] };
      paneled.add(id);
      continue;
    }
    if (item.mode === "banner") {
      const image = pictures[`side:${id}`];
      if (!image) throw new Error(`Картинка баннера «${side.label}» не пришла — выберите её ещё раз.`);
      /* До краёв своей рамки: у стены уступом — самая большая её часть. */
      out[`side:${id}`] = { rgba: sideBannerPixels(image, width, height, side, { fit: item.fit, background: item.background }), width, height, texture: [width, height] };
    } else if (item.mode === "colour") {
      const relief = item.relief ? await reliefOf(game, side, cache) : null;
      const repeat = side.relief ? side.width / Math.max(0.5, side.relief.metres[0]) : 1;
      out[`side:${id}`] = {
        rgba: sideColourPixels(item.look, width, height, { relief: relief ? { ...relief, repeat, vertical: side.relief.vertical, swap: side.relief.swap } : null }),
        width,
        height,
        texture: [width, height],
      };
    }
  }
  for (const id of BUILDING_SIDE_IDS) {
    if (!out[`side:${id}`] || paneled.has(id)) continue;
    const printed = await printSide(out[`side:${id}`], project, place, id, { game, pictures, sheets });
    /* Строго по стене (маска описи): где у стороны нет стены, плашка
       прозрачна — и в игре, и в листах дальних планов. */
    out[`side:${id}`] = { ...printed, rgba: maskSidePlate(new Uint8ClampedArray(printed.rgba), printed.width, printed.height, buildingSide(place, id).mask) };
  }
  /* Фото на щитах крыши — как баннер стороны: вписано в лист плашки. */
  for (const board of buildingBillboards(place)) {
    const item = project.billboards[board.id];
    if (!buildingBillboardDecal(project, place, board.id)) continue;
    const image = pictures[`billboard:${board.id}`];
    if (!image) throw new Error(`Фото для «${board.label}» не пришло — выберите его ещё раз.`);
    const [width, height] = sidePlateSize(board.width, board.height);
    out[`billboard:${board.id}`] = { rgba: fitImagePixels(image, width, height, { fit: item.fit, background: item.background, aspect: board.width / board.height }), width, height, texture: [width, height] };
  }
  /* Эмблемы и надписи (общая система): картинка — по отпечатку в хранилище окна. */
  for (const decal of buildingEmblemDecals(project, place)) {
    const image = pictures.emblems?.get?.(decal.asset);
    if (!image) throw new Error(decal.kind === "text" ? "Картинка надписи не пришла — нажмите «Применить» ещё раз." : "Картинка эмблемы не пришла — выберите её ещё раз.");
    out[`emblem:${decal.id}`] = image;
  }
  /* Стены с картинкой (3В): развёрнутая стена из студии, до 2048 px; лист плашки — степени двойки по самой картинке. */
  for (const decal of buildingWallDecals(project, place)) {
    const image = pictures.walls?.get?.(decal.asset);
    if (!image) throw new Error("Картинка стены не пришла — поставьте её на стену в студии ещё раз.");
    out[`wall:${decal.id}`] = { ...image, texture: buildingWallTexture(image) };
  }
  const title = buildingTitle(place);
  if (title?.kind === "plate" && project.title.mode === "text" && project.title.lines.some((line) => line.trim())) {
    if (!pictures.title) throw new Error("Картинка надписи не пришла — нажмите «Применить» ещё раз.");
    out.title = pictures.title;
  }
  /* Плашки поверх объёмных букв — картинкой окна (текст на плашке цветом). */
  for (const job of buildingCoverJobs(project, place)) {
    if (!pictures[job.key]) throw new Error("Картинка надписи не пришла — нажмите «Применить» ещё раз.");
    out[job.key] = pictures[job.key];
  }
  /* Места разошедшихся надписей и табличек: штатный кусок листа игры,
     свой текст (картинка окна) или плашка цветом. */
  for (const mark of buildingTextPlates(project, place)) {
    if (mark.kind === "text") {
      if (!pictures[mark.key]) throw new Error("Картинка надписи не пришла — нажмите «Применить» ещё раз.");
      out[mark.key] = pictures[mark.key];
    } else if (mark.kind === "restore") {
      const sheet = game ? await signSheetOf(game, place, mark.texture, sheets) : null;
      if (sheet) out[mark.key] = islandImage(sheet, mark.island, { longest: 1024 });
    } else out[mark.key] = solidImage(mark.colour);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Дальние планы
 * ------------------------------------------------------------------ */

/* Облик части вдали: тон основного цвета (эффект — его средний цвет, узор
   — первый цвет, картинка — подкраска или серый: рисунка вдали не видно). */
function lodColourOf(settings) {
  if (!settings || settings.mode === "standard") return null;
  if (settings.mode === "colour") {
    const look = normalizeColourEffect(settings.look);
    if (look.mode === "solid") return look.colour;
    const steps = 16;
    const sum = [0, 0, 0];
    for (let index = 0; index < steps; index += 1) colourEffectAt(look, index / (steps - 1)).forEach((value, axis) => (sum[axis] += value));
    return `#${sum.map((value) => Math.round(value / steps).toString(16).padStart(2, "0")).join("")}`;
  }
  if (settings.mode === "pattern") return settings.pattern?.colours?.[0] || "#8a8a8a";
  if (settings.mode === "gradient") return settings.gradient?.colours?.[0] || "#8a8a8a";
  return settings.image?.strength ? settings.image.tint : "#8a8a8a";
}

/* Y-вверх rage-drawable → Z-вверх игры. */
const toGame = (x, y, z) => [x, -z, y];

/*
 * Поле облика здания — треугольник за треугольником: облик — часть листа
 * грани. Грани стен, отделки и навесов, что смотрят вверх (верх парапета,
 * основания фонарей и столбиков на парковке), в поле не идут: иначе земля
 * вдали вокруг каждого столбика брала бы цвет стен пятном. Крыша и земля
 * идут целиком — у них верх и есть поверхность.
 */
const UPWARD_SKIPPED = new Set(["walls", "trim", "awnings"]);
/* Облик «вывеска» — острова надписи и табличек: вдали их не тонируют, на
   них ложатся только наложения своего текста. */
const SIGN_LOOK = BUILDING_PART_IDS.length;
function addBuildingDrawable(field, drawable, placement, records, colourOf = null) {
  const place = placementTransform(placement);
  for (const mesh of drawable.meshes || []) {
    const diffuse = (mesh.material?.samplers || []).find((sampler) => sampler.role === "diffuse" && sampler.texture)?.texture?.toLowerCase();
    /* Цвет листа HD под гранью — облику `transfer` (эффекты вдали как вблизи). */
    const sample = colourOf && mesh.uvs ? colourOf(mesh) : null;
    const record = diffuse ? records.get(diffuse) : null;
    const part = dominantPart(record);
    const rects = (record?.regions || []).flatMap((region) => region.islands.map((island) => island.rect));
    /* Поверхность без своей части (наклейки, стекло) в поле не идёт. */
    if (!part && !rects.length) continue;
    const partLook = part ? BUILDING_PART_IDS.indexOf(part) : null;
    const points = [];
    for (let at = 0; at < mesh.positions.length; at += 3) points.push(place(toGame(mesh.positions[at], mesh.positions[at + 1], mesh.positions[at + 2])));
    for (let at = 0; at + 2 < mesh.indices.length; at += 3) {
      const a = points[mesh.indices[at]];
      const b = points[mesh.indices[at + 1]];
      const c = points[mesh.indices[at + 2]];
      let look = partLook;
      if (rects.length && mesh.uvs) {
        const ids = [mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]];
        const u = (mesh.uvs[ids[0] * 2] + mesh.uvs[ids[1] * 2] + mesh.uvs[ids[2] * 2]) / 3;
        const v = (mesh.uvs[ids[0] * 2 + 1] + mesh.uvs[ids[1] * 2 + 1] + mesh.uvs[ids[2] * 2 + 1]) / 3;
        if (rects.some((rect) => u >= rect[0] && u <= rect[2] && v >= rect[1] && v <= rect[3])) look = SIGN_LOOK;
      }
      if (look === null) continue;
      if (look !== SIGN_LOOK && UPWARD_SKIPPED.has(part)) {
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const length = Math.hypot(...n);
        if (!length || n[2] / length > 0.4) continue;
      }
      const uvIds = sample ? [mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]] : null;
      field.addTriangle(a, b, c, look, sample ? { sample, uv: uvIds.map((id) => [mesh.uvs[id * 2], mesh.uvs[id * 2 + 1]]) } : null);
    }
  }
}

async function buildBuildingLod(place, project, { game, lod, plateImages, pictures, files = [] }) {
  if (!lod || !game) return null;
  const inventory = buildingInventory(place)?.building;
  const ops = [
    ...BUILDING_PART_IDS.map((id) => {
      const settings = buildingPartSettings(project, place, id);
      const colour = lodColourOf(settings);
      if (!colour) return null;
      const lift = settings?.mode === "colour" ? { lift: BUILDING_TINT_LIFT } : {};
      /* Ровный цвет вдали — тоном (с тем же подъёмом тёмного, что вблизи);
         эффект, узор, градиент, картинка — переносом листа HD (`transfer`):
         вдали тот же рисунок, а не один средний цвет (фикс 1 ТЗ 06.10.2026). */
      const solid = settings?.mode === "colour" && normalizeColourEffect(settings.look).mode === "solid";
      return solid ? { kind: "tint", colour, ...lift } : { kind: "transfer", fallback: colour, ...lift };
    }),
    /* Вывески — как в игре (поверх ложатся наложения). */
    null,
  ];
  const origin = buildingOrigin(place);
  const toWorld = (point) => point.map((value, axis) => value + origin[axis]);
  const overlays = [];
  for (const id of BUILDING_SIDE_IDS) {
    const decal = buildingSideDecal(project, place, id);
    const image = plateImages[`side:${id}`];
    if (decal && image) overlays.push({ ...decal, point: toWorld(decal.point), image, opacity: decal.opacity });
  }
  /* Фото на щитах крыши — и вдали, той же картинкой по грани щита. */
  for (const board of buildingBillboards(place)) {
    const decal = buildingBillboardDecal(project, place, board.id);
    const image = plateImages[`billboard:${board.id}`];
    if (decal && image) overlays.push({ ...decal, point: toWorld(decal.point), image, opacity: 1 });
  }
  /* Эмблемы и надписи — и вдали, той же картинкой по плоскости стены. */
  for (const decal of buildingEmblemDecals(project, place)) {
    const image = plateImages[`emblem:${decal.id}`];
    if (image) overlays.push({ ...decal, point: toWorld(decal.point), image, opacity: decal.opacity });
  }
  /* Картинки на стенах — и вдали, той же картинкой по плоскости стены (прозрачное остаётся стеной). */
  for (const decal of buildingWallDecals(project, place)) {
    const image = plateImages[`wall:${decal.id}`];
    if (image) overlays.push({ ...decal, point: toWorld(decal.point), image, opacity: decal.opacity });
  }
  /* Убранные из модели буквы — и с дальних листов: их место берёт тон стены
     вокруг (наложения-картинки ложатся уже поверх). */
  for (const { cover } of buildingCoverErasures(project, place))
    overlays.push({ point: toWorld(cover.point), normal: cover.normal, width: cover.width, height: cover.height, erase: true, reach: 2 });
  /* Своё название и таблички поверх объёмных букв — и вдали. */
  for (const job of buildingCoverJobs(project, place)) {
    const image = plateImages[job.key];
    if (image) overlays.push({ point: toWorld(job.cover.point), normal: job.cover.normal, width: job.cover.width, height: job.cover.height, image, reach: 2 });
  }
  /* Надпись и таблички в одно место листа — по своим местам в мире. */
  for (const job of buildingTextJobs(project, place))
    job.regions.forEach((region, regionIndex) => {
      if (region.islands.length !== 1) return;
      const image = pictures[`text:${job.key}:${regionIndex}:0`];
      if (!image) return;
      for (const spot of region.places || []) overlays.push({ point: toWorld(spot.point), normal: spot.normal, width: spot.width, height: spot.height, image, reach: 2 });
    });
  /* Места разошедшихся надписей и табличек — картинкой своей плашки. */
  for (const mark of buildingTextPlates(project, place)) {
    const image = plateImages[mark.key];
    if (image) overlays.push({ point: toWorld(mark.point), normal: mark.normal, width: mark.width, height: mark.height, image, reach: 2 });
  }
  if (!ops.some(Boolean) && !overlays.length) return null;

  /* Поле облика: HD-модели места, облик грани — по части её листа. */
  const records = new Map((inventory?.textures || []).map((record) => [record.name, record]));
  const sampler = ops.some((op) => op?.kind === "transfer") ? createSurfaceSampler({ game, files, records }) : null;
  if (sampler) await sampler.prepare();
  const field = createLookField();
  const drawables = new Map();
  for (const placement of inventory?.placements || []) {
    if (!placement.at) continue;
    if (!drawables.has(placement.at)) {
      const bytes = await game.read(placement.at).catch(() => null);
      let drawable = null;
      try {
        drawable = bytes ? readDrawable(openResourceWith(new Uint8Array(bytes), inflateRaw), { inflateRaw, kind: placement.at.split(".").pop() }).drawables[0] || null : null;
      } catch {
        drawable = null;
      }
      drawables.set(placement.at, drawable);
    }
    const drawable = drawables.get(placement.at);
    if (!drawable) continue;
    addBuildingDrawable(field, drawable, placement, records, sampler ? sampler.colourOf : null);
  }
  return buildLodFiles({ lod, game, field, ops, overlays });
}

/* ------------------------------------------------------------------ *
 * Сборка
 * ------------------------------------------------------------------ */

/**
 * Файлы здания под работу. `game` — чтение игры игрока, `pictures` —
 * картинки окна (баннеры, логотипы, текст островов, надпись-плашка) RGBA,
 * `images` — картинки отделки. `{ files, patches, report, lodReport? }`.
 */
export async function buildBuildingFiles(place, input, { game = null, pictures = {}, images = new Map(), compile = null, stateDir = "", lod = null } = {}) {
  const project = normalizeBuildingProject(place, input);
  if (buildingProjectIsStock(place, project)) return { files: [], patches: [], report: { stock: true } };
  const inventory = buildingInventory(place)?.building;
  if (!inventory) throw new Error(`Здания ${place} нет в этой версии Astral.`);
  if (!game) throw new Error("Здание собирается из файлов вашей игры — подключите GTA V.");
  const sources = new Map();
  const sourceOf = (item) => {
    const key = JSON.stringify([item.mode, item.pattern, item.image, item.gradient]);
    if (!sources.has(key)) sources.set(key, finishSource(item, images));
    return sources.get(key);
  };

  const files = [];
  const patches = [];
  const report = { place, changed: 0, skippedTextures: 0, missing: [], plates: 0 };

  /* Листы частей, надписи и табличек — на месте в файлах игры. */
  for (const [name, entry] of buildingOpsByFile(place, project, { pictures })) {
    const base = entry.at ? await game.read(entry.at).catch(() => null) : null;
    if (!base) {
      report.missing.push(name);
      continue;
    }
    const baked = await bakeFile(base, name, (texture) => entry.ops.get(texture) || null, { images: pictures, sources: sourceOf });
    report.skippedTextures += baked.skipped;
    if (!baked.textures.length) continue;
    report.changed += 1;
    patches.push({ file: name, textures: baked.textures });
    files.push({ name, bytes: baked.bytes });
  }

  /* Потёки грязи поверх покрашенных стен и крыши — прочь из моделей места
     (`BUILDING_GRIME`): иначе краска легла бы под чёрные пятна. Модель, чьи
     листы уже правлены выше, берётся из уже собранных байтов. */
  const hidden = buildingGrimeHidden(project, place);
  report.grime = 0;
  for (const model of hidden.size ? inventory.grime || [] : []) {
    const textures = model.textures.filter((item) => hidden.has(item.part)).map((item) => item.name);
    if (!textures.length) continue;
    const already = files.find((file) => file.name === model.name);
    const base = already ? already.bytes : await game.read(model.at).catch(() => null);
    if (!base) {
      report.missing.push(model.name);
      continue;
    }
    const cleaned = hideGrimeDecals(base, textures);
    if (!cleaned.bytes) continue;
    report.grime += cleaned.removed;
    if (already) already.bytes = cleaned.bytes;
    else files.push({ name: model.name, bytes: cleaned.bytes });
    patches.push({ file: model.name, grime: textures });
  }

  /* Объёмные буквы, что работа заменяет своими (`erase`, DAVIS MEGA MALL):
     их треугольники сводятся в точку там же, в модели места — по листу и
     рамке граней описи (середина треугольника в мире). */
  const origin = buildingOrigin(place);
  report.erased = 0;
  /* Рейки крепления букв и тени грязи, что уходят вместе с ними (`erase.also`). */
  report.erasedAlso = 0;
  /* Штатные буквы на покрашенной стороне остаются, а их рейки уходят (`buildingCoverRails`): иначе они торчат перед плашкой цветом стены. */
  report.rails = 0;
  const railsOnly = buildingCoverRails(project, place).map((item) => ({ ...item, rails: true }));
  for (const { erase, key, rails } of [...buildingCoverErasures(project, place), ...railsOnly]) {
    const placements = (inventory.placements || []).filter((item) => item.model === erase.model);
    if (!erase.at || !placements.length) {
      report.missing.push(erase.file);
      continue;
    }
    const already = files.find((file) => file.name === erase.file);
    const base = already ? already.bytes : await game.read(erase.at).catch(() => null);
    if (!base) {
      report.missing.push(erase.file);
      continue;
    }
    const min = erase.box.min.map((value, axis) => value + origin[axis]);
    const max = erase.box.max.map((value, axis) => value + origin[axis]);
    const transforms = placements.map((item) => placementTransform(item));
    const within = (centre) =>
      transforms.some((toWorld) => {
        const point = toWorld(centre);
        return point.every((value, axis) => value >= min[axis] && value <= max[axis]);
      });
    if (!rails) {
      const cleaned = hideGrimeDecals(base, erase.textures, { within });
      if (!cleaned.bytes) continue;
      report.erased += cleaned.removed;
      if (already) already.bytes = cleaned.bytes;
      else files.push({ name: erase.file, bytes: cleaned.bytes });
      patches.push({ file: erase.file, erased: key });
    }
    /* Рейки крепления букв и наклейки-тени грязи (`also`): по глубине перед стеной, а у граней листа стены — ещё и ниже `maxHeight`
       (пилястры в рамке букв — высотой во весь этаж, они остаются). Буквы убраны, а рейки без этого висели бы поверх картинки. */
    for (const extra of erase.also || []) {
      /* Буквы остаются — уходят только рейки (грани листа стены ниже `maxHeight`), тени грязи — как были. */
      if (rails && !extra.maxHeight) continue;
      const extraPlacements = (inventory.placements || []).filter((item) => item.model === extra.model);
      const extraAlready = files.find((file) => file.name === extra.file);
      const extraBase = extraAlready ? extraAlready.bytes : extra.at ? await game.read(extra.at).catch(() => null) : null;
      if (!extraBase || !extraPlacements.length) {
        report.missing.push(extra.file);
        continue;
      }
      const toWorlds = extraPlacements.map((item) => placementTransform(item));
      const wall = erase.wall;
      const extraWithin = (centre, _uv, _normal, height) => {
        if (extra.maxHeight && height > extra.maxHeight) return false;
        return toWorlds.some((toWorld) => {
          const point = toWorld(centre);
          if (!point.every((value, axis) => value >= min[axis] && value <= max[axis])) return false;
          const depth = (point[0] - origin[0]) * wall.normal[0] + (point[1] - origin[1]) * wall.normal[1] - wall.plane;
          return depth >= extra.depth[0] && depth <= extra.depth[1];
        });
      };
      const extraCleaned = hideGrimeDecals(extraBase, extra.textures, { within: extraWithin });
      if (!extraCleaned.bytes) continue;
      if (rails) report.rails += extraCleaned.removed;
      else report.erasedAlso += extraCleaned.removed;
      if (extraAlready) extraAlready.bytes = extraCleaned.bytes;
      else files.push({ name: extra.file, bytes: extraCleaned.bytes });
      patches.push({ file: extra.file, erased: `${key}:${rails ? "rails" : "also"}` });
    }
  }

  /* Плашки: стороны, логотипы, надпись — одним вызовом хоста. */
  const plateImages = await buildingPlateImages(place, project, { game, pictures });
  const plates = buildingPlates(project, place, { titleAspect: pictures.title?.aspect || 4 })
    .map((plate) => ({
      ...plate,
      image: plateImages[plate.key],
      texture: plateImages[plate.key]?.texture || null,
      /* Плашка стороны — сама стена: и «Покрасить», и свой баннер (до 26.10.2026 баннер выносили вперёд перед деталями стены,
         до 76 см, — картинка парила, и на углах оставалась щель) лежит вплотную, детали перед стеной остаются перед ней. */
      ...(plate.key.startsWith("side:") ? { hug: true } : {}),
    }))
    .filter((plate) => plate.image);
  if (plates.length) {
    const names = buildingPlateNames(place);
    /* У каждой плашки — дальняя копия перед дальними моделями здания; вблизи —
       перед деталями стены (наличники, пилястры, водостоки): по граням моделей
       HD места, убранные буквы — уже из правленых моделей пакета (задача 11). */
    const read = async (placement) => {
      const name = String(placement.at || "").split("/").pop().toLowerCase();
      const own = files.find((file) => file.name.toLowerCase() === name);
      return own ? own.bytes : placement.at ? game.read(placement.at).catch(() => null) : null;
    };
    const near = await nearPlateTriangles(plates, inventory.placements || [], read);
    const built = await buildEmblemPlates({ plates, compile, stateDir, set: place, names: { types: names.types, map: names.map }, far: { lod, game }, near });
    files.push(...built);
    patches.push({ file: "plates", plates: plates.map((plate) => plate.key) });
    report.plates = plates.length;
  }

  /* Дальние планы. */
  let lodReport = null;
  const lodBuilt = await buildBuildingLod(place, project, { game, lod, plateImages, pictures, files });
  if (lodBuilt?.files?.length) {
    const names = new Set(lodBuilt.files.map((file) => file.name));
    for (let index = files.length - 1; index >= 0; index -= 1) if (names.has(files[index].name)) files.splice(index, 1);
    files.push(...lodBuilt.files);
    patches.push({ file: "lod", lod: true, files: [...names] });
    lodReport = lodBuilt.report;
  }
  return { files, patches, report, ...(lodReport ? { lodReport } : {}) };
}
