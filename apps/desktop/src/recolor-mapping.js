/*
 * Маппинг в пикселях: каждое место — своим тоном.
 *
 * Листы мода (`*_Base_color` A8R8G8B8) красятся тоном места по светотени
 * (`recolor-pixels.js`), опора — своя у каждого листа (`ref` в описи).
 * Ровный лист (у мода — белые и чёрные 2048²) перекрашивается ровным
 * цветом сразу во все уровни, без разбора четырёх миллионов пикселей.
 * Листы игры (стёкла, двери, окна) не трогаются. Файлы мест «как в моде»
 * едут как есть, мест «как в игре» (по умолчанию с 10.10.2026) — не едут:
 * игра берёт свои штатные модели.
 *
 * Издалека (исправление 03.10.2026, «маппинг издалека штатный»): мод меняет
 * только HD-модели мест, а игра дальше показывает их родителей — LOD,
 * SLOD1…SLOD3 со своими листами, — поэтому место «прыгало» в штатный облик.
 * Дальняя прорисовка — общей системой LOD мастерской (`recolor-lod.js`):
 * цепочки мест из `resources/recolor-lod/mapping.json`, облик места — тот
 * же, что вблизи: «как в моде» — серый (листы автора серые), свой цвет —
 * тоном. Новое место в описи (`scripts/lib/mapping-locations.mjs`) получает
 * дальнюю прорисовку перегенерацией набора, без своего кода.
 *
 * Парковка (ТЗ 17.10.2026; владелец: «чтобы была стандартная и можно было её
 * редактировать… а мод перенеси в шаблон»): модель мода у неё — своя модель
 * сервера 5RP, её ставит только шаблон («как в моде»). Свой цвет парковки
 * красит штатную парковку игры игрока (`buildMappingStockFiles`): листы стен
 * (`stockEdit` описи) в её модели и словарях — тоном по светотени, на месте,
 * тем же форматом и цепочкой мипов; асфальт, разметка, вывески — как в игре.
 * Издалека парковка штатная: дальние модели игры не трогаются.
 */

import { decodeTextureRef, readDrawable } from "@modovik/rage-drawable";
import { openResourceWith } from "@modovik/ypt/resource-core";
import {
  MAPPING_INVENTORY,
  findMappingLocation,
  flatTexturePayload,
  hexBytes,
  MAPPING_FINISH_MODES,
  mappingModePaints,
  mappingStockEdits,
  mappingStockFinish,
  mappingStockTint,
  mappingTint,
  normalizeMappingProject,
} from "@modovik/climb-contract/recolor";
import { bakeSheetFinish, finishMeanColour, finishSource } from "./finish-bake.js";
import { hideGrimeDecals } from "./recolor-grime.js";
import { splitSheetSurfaces, surfaceSheetName } from "./recolor-sheet-split.js";
import { buildLodFiles, createLookField } from "./recolor-lod.js";
import { argbPayload, bgraToRgba, tintByLabels, tintedColour } from "./recolor-pixels.js";
import { resourceRefs } from "./recolor-sheets.js";
import { patchResourceTextures, readResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";
import { inflateResource } from "@modovik/native-rs";

const inflateRaw = inflateResource;

/* Место файла мода по описи. */
const LOCATION_OF_FILE = new Map(MAPPING_INVENTORY.mapping.locations.flatMap((location) => location.files.map((file) => [file.toLowerCase(), location.id])));

/**
 * Файлы набора маппинга под работу: `{ files: [{ name, bytes }], patches }`,
 * как у остальных наборов. Места «как в игре» (10.10.2026, задача 16) в
 * игру не едут вовсе: игра берёт свои штатные модели.
 */
export function buildMappingFiles(input, resources) {
  const project = normalizeMappingProject(input);
  /* Модели мода места не едут, если место как в игре — или его свой цвет
     красит штатные модели (парковка): модель 5RP ставит только «как в моде». */
  const stock = (name) => {
    const id = LOCATION_OF_FILE.get(name.toLowerCase());
    const mode = project.locations[id]?.mode;
    return mode === "stock" || (mappingModePaints(mode) && Boolean(findMappingLocation(id)?.stockEdit));
  };
  const byFile = new Map();
  for (const texture of MAPPING_INVENTORY.mapping.textures) {
    if (texture.role !== "sheet" || stock(texture.file)) continue;
    const tint = mappingTint(project, texture.location, texture.ref);
    if (!tint) continue;
    const list = byFile.get(texture.file) || [];
    list.push({ texture, tint });
    byFile.set(texture.file, list);
  }

  const files = [];
  const patches = [];
  for (const { name } of MAPPING_INVENTORY.files) {
    if (stock(name)) continue;
    const source = resources.get(name);
    const wanted = byFile.get(name);
    if (!wanted) {
      files.push({ name, bytes: source });
      continue;
    }
    /* Ресурс распаковывается один раз на файл. */
    const present = new Map(readResourceTextures(source, name).map((item) => [item.name.toLowerCase(), item]));
    const replacements = {};
    for (const { texture, tint } of wanted) {
      const current = present.get(texture.name);
      if (!current) throw new Error(`${name}: нет текстуры ${texture.name}.`);
      if (texture.flat) {
        replacements[texture.name] = flatTexturePayload(texture, tintedColour(tint, hexBytes(texture.flat)), 255);
        continue;
      }
      const rgba = tintByLabels(bgraToRgba(current.payload, texture.width, texture.height), null, { 1: tint });
      replacements[texture.name] = argbPayload(rgba, { ...texture, bytes: current.bytes });
    }
    const { bytes } = patchResourceTextures(source, name, replacements);
    files.push({ name, bytes: Buffer.from(bytes) });
    patches.push({ file: name, textures: Object.keys(replacements) });
  }
  return { files, patches };
}

/*
 * Листы районных словарей у парковки (кромка крыши, стена `im_wall12`): их
 * словарь `globalroads` — общий у дорог и домов всей карты, красить его на
 * месте нельзя. Поэтому у частей модели парковки, что берут такой лист, — своя
 * копия листа внутри модели (`split-sheet-surfaces` нативного хоста, как у
 * арены: `recolor-sheet-split.js`), и красится уже копия — тем же тоном или
 * отделкой, что листы стен. Соседи остаются со своим листом: словарь района в
 * пакет не едет. Без сборщика моделей (проверки без нативного хоста) листы
 * остаются штатными — как у арены. `paint(sheet, rgba, ref)` → пиксели копии
 * или `null`. `{ bytes, copies }` — модель с копиями и имена копий.
 */
async function paintSheetCopies({ bytes, fileName, location, game, compile, stateDir, paint }) {
  const wanted = Object.keys(location.stockEdit.copies || {});
  const drawable = readDrawable(openResourceWith(new Uint8Array(bytes), inflateRaw), { inflateRaw, kind: "ydr" }).drawables.find((item) => item.lod === "high");
  const splits = [];
  for (const mesh of drawable?.meshes || []) {
    const sheet = String(mesh.material?.textures?.diffuse || "").toLowerCase();
    if (!wanted.includes(sheet) || !Number.isInteger(mesh.model) || !Number.isInteger(mesh.slot)) continue;
    if (/decal/i.test(String(mesh.material?.shader || ""))) continue;
    splits.push({ model: mesh.model, slot: mesh.slot, triangles: null, from: sheet, to: surfaceSheetName(sheet, location.id) });
  }
  if (!splits.length) return { bytes, copies: [] };
  /* Исходный лист — из словаря района в игре игрока (высокой чёткости, если он там есть). */
  const homes = new Map();
  for (const sheet of new Set(splits.map((split) => split.from))) {
    const copy = location.stockEdit.copies[sheet];
    const dictionary = await game.read(copy.at).catch(() => null);
    if (!dictionary) throw new Error(`Словарь ${copy.file} с листом ${sheet} не прочитан из игры — проверьте файлы GTA V.`);
    const ref = resourceRefs(new Uint8Array(dictionary), `${copy.file}.ytd`).refs.find((item) => item.name.toLowerCase() === sheet);
    if (!ref?.complete) throw new Error(`В словаре ${copy.file} нет листа ${sheet} — файлы игры не те, что знает Astral.`);
    homes.set(sheet, { ref, dictionary: Buffer.from(dictionary) });
  }
  const separated = await splitSheetSurfaces({ base: bytes, fileName, splits, sheetOf: (from) => homes.get(from) || null, compile, stateDir, set: "mapping" });
  const names = new Map(splits.map((split) => [split.to, split.from]));
  const replacements = {};
  for (const ref of resourceRefs(new Uint8Array(separated), fileName).refs) {
    const original = names.get(ref.name.toLowerCase());
    if (!original || !ref.complete) continue;
    const level = decodeTextureRef(ref, { level: 0 });
    const rgba = paint(original, level, location.stockEdit.copies[original].ref);
    if (rgba) replacements[ref.name] = texturePayload({ name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, bytes: ref.bytes }, rgba);
  }
  const patched = Object.keys(replacements).length ? patchResourceTextures(new Uint8Array(separated), fileName, replacements) : null;
  return { bytes: patched ? Buffer.from(patched.bytes) : Buffer.from(separated), copies: Object.keys(replacements) };
}

/**
 * Штатные места своим цветом или отделкой (парковка, ТЗ 17.10.2026): файлы
 * игры игрока (`stockEdit` описи — модель и словари), листы стен — тоном по
 * светотени листа или отделкой (узор, картинка, градиент, `bakeSheetFinish` —
 * та же сборка, что у завода) на месте; файл без листов стен не едет. `game` —
 * чтение игры, `images` — свои картинки отделки. `{ files, patches }`.
 */
export async function buildMappingStockFiles(input, { game = null, images = new Map(), compile = null, stateDir = "" } = {}) {
  const project = normalizeMappingProject(input);
  const edits = mappingStockEdits(project);
  const files = [];
  const patches = [];
  if (!edits.length) return { files, patches };
  if (!game) throw new Error("Парковка своим цветом собирается из файлов вашей игры — подключите GTA V.");
  for (const location of edits) {
    let tinted = 0;
    /* Источник отделки места — один на все его листы. */
    let source = null;
    const sourceOf = (settings) => (source ||= finishSource(settings, images));
    for (const file of location.stockEdit.files) {
      const base = await game.read(file.at).catch(() => null);
      if (!base) throw new Error(`Штатный файл ${file.name} не прочитан из игры — проверьте файлы GTA V.`);
      const raw = new Uint8Array(base);
      const replacements = {};
      for (const ref of resourceRefs(raw, file.name).refs) {
        if (!ref.complete) continue;
        const finish = mappingStockFinish(project, location.id, ref.name);
        const tint = finish ? null : mappingStockTint(project, location.id, ref.name);
        if (!finish && !tint) continue;
        const level = decodeTextureRef(ref, { level: 0 });
        /* Опора светотени — яркость листа из описи: в кадре та же. */
        const rgba = finish
          ? bakeSheetFinish(level.rgba, level.width, level.height, finish.settings, sourceOf(finish.settings), { ref: finish.ref })
          : tintByLabels(level.rgba, null, { 1: tint });
        replacements[ref.name] = texturePayload({ name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, bytes: ref.bytes }, rgba);
      }
      if (!Object.keys(replacements).length) continue;
      const patched = patchResourceTextures(raw, file.name, replacements);
      let bytes = Buffer.from(patched.bytes);
      /*
       * Наклейка грязи на листе стены (шейдер decal, лист общий со стеной —
       * штукатурка парковки): отделка легла бы заплаткой поверх стен, в кадре
       * её нет. Треугольники наклейки сводятся в точку (`hideGrimeDecals`);
       * у ровного цвета наклейка тонируется вместе с листом и остаётся.
       */
      let hidden = 0;
      if (file.name.endsWith(".ydr")) {
        const finished = Object.keys(replacements).filter((sheet) => mappingStockFinish(project, location.id, sheet));
        const cleaned = finished.length ? hideGrimeDecals(bytes, finished, { shader: /decal/i }) : null;
        if (cleaned?.bytes) {
          bytes = Buffer.from(cleaned.bytes);
          hidden = cleaned.removed;
        }
      }
      /* Листы районных словарей — своей копией внутри модели; без сборщика — штатные. */
      let copies = [];
      let copiesSkipped = false;
      if (file.name.endsWith(".ydr") && Object.keys(location.stockEdit.copies || {}).length) {
        if (typeof compile !== "function") copiesSkipped = true;
        else {
          const painted = await paintSheetCopies({
            bytes,
            fileName: file.name,
            location,
            game,
            compile,
            stateDir,
            paint: (sheet, level, ref) => {
              const finish = mappingStockFinish(project, location.id, sheet);
              if (finish) return bakeSheetFinish(level.rgba, level.width, level.height, finish.settings, sourceOf(finish.settings), { ref });
              const tint = mappingStockTint(project, location.id, sheet);
              return tint ? tintByLabels(level.rgba, null, { 1: tint }) : null;
            },
          });
          bytes = painted.bytes;
          copies = painted.copies;
        }
      }
      files.push({ name: file.name, bytes });
      patches.push({
        file: file.name,
        location: location.id,
        stock: true,
        textures: patched.patched,
        ...(hidden ? { decals: hidden } : {}),
        ...(copies.length ? { copies } : {}),
        ...(copiesSkipped ? { copiesSkipped: Object.keys(location.stockEdit.copies) } : {}),
      });
      tinted += patched.patched.length;
    }
    if (!tinted) throw new Error(`У штатной модели места «${location.title}» не нашлось листов стен — файлы игры не те, что знает Astral.`);
  }
  return { files, patches };
}

/*
 * Облик места издалека: свой цвет — тоном по светотени листа, «как в моде» —
 * серым (автор мода перекрасил места в серое).
 */
function mappingLodOp(project, locationId) {
  const settings = project.locations[locationId];
  if (!settings || settings.mode === "stock") return null;
  if (settings.mode === "mod") return { kind: "grey" };
  return { kind: "tint", colour: settings.colour, brightness: settings.brightness / 100 };
}

/*
 * Облик штатного места издалека (парковка, ТЗ 17.10.2026): свой цвет — тон
 * цвета места, отделка — тон её среднего цвета (с сотни метров узор не
 * различить; так и у завода), «как в игре» — не трогать.
 */
function mappingStockLodOp(project, locationId, images) {
  const settings = project.locations[locationId];
  if (settings?.mode === "colour") return { kind: "tint", colour: settings.colour, brightness: settings.brightness / 100 };
  if (MAPPING_FINISH_MODES.includes(settings?.mode)) return { kind: "tint", colour: finishMeanColour(finishSource(settings, images)) };
  return null;
}

/**
 * Дальний маппинг: поле облика — модели мода на местах игры (опись мест) и
 * штатные модели, что красит свой цвет места (парковка: листы стен штатной
 * модели из игры на её месте в картах), облик — своего места; цепочки, маски
 * и копии словарей — опись `lod`. Место «как в игре» — ни одного файла.
 * `{ files, report }`.
 */
export async function buildMappingLod(input, { game, resources, lod, images = new Map() }) {
  const project = normalizeMappingProject(input);
  const field = createLookField();
  const ops = [];
  const drawables = new Map();
  for (const location of MAPPING_INVENTORY.mapping.locations) {
    if (!location.placements?.length) continue;
    /* Место как в игре: дальние модели игры остаются штатными. */
    const op = mappingLodOp(project, location.id);
    if (!op) continue;
    const look = ops.push(op) - 1;
    for (const placement of location.placements) {
      const name = `${placement.model}.ydr`;
      const bytes = resources.get(name);
      if (!bytes) continue;
      if (!drawables.has(name)) {
        try {
          drawables.set(name, readDrawable(openResourceWith(new Uint8Array(bytes), inflateRaw), { inflateRaw }).drawables[0] || null);
        } catch {
          drawables.set(name, null);
        }
      }
      const drawable = drawables.get(name);
      if (drawable) field.addDrawable(drawable, placement, () => look);
    }
  }
  /* Штатные модели парковки: только листы стен (наклейки и асфальт — как в игре). */
  for (const location of mappingStockEdits(project)) {
    const op = mappingStockLodOp(project, location.id, images);
    if (!op || !game) continue;
    const look = ops.push(op) - 1;
    const model = location.stockEdit.files.find((file) => file.name.endsWith(".ydr"));
    const bytes = model ? await game.read(model.at).catch(() => null) : null;
    if (!bytes) throw new Error(`Штатный файл ${model?.name || "модели"} не прочитан из игры — проверьте файлы GTA V.`);
    const drawable = readDrawable(openResourceWith(new Uint8Array(bytes), inflateRaw), { inflateRaw }).drawables[0] || null;
    if (!drawable) continue;
    const painted = (mesh) => {
      const sheet = String(mesh.material?.textures?.diffuse || "").toLowerCase();
      return (sheet in location.stockEdit.sheets || sheet in location.stockEdit.copies) && !/decal/i.test(String(mesh.material?.shader || "")) ? look : -1;
    };
    for (const placement of location.stockEdit.placements) field.addDrawable(drawable, placement, painted);
  }
  return buildLodFiles({ lod, game, field, ops });
}
