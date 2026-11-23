/*
 * «Остановки» в файлах (задача 5 ТЗ 06.10.2026).
 *
 * Основа — штатные остановки игры игрока (опись `busstops`): у каждого вида
 * модель-фрагмент (`prop_busstop_0N.yft`, листы зашиты в неё) и словарь
 * высокой чёткости (`+hifr.ytd`) — те же листы крупнее, для взгляда вблизи.
 * Обе едут с одной и той же правкой: на любой дистанции остановка одна.
 *
 *   • облик частей (свой цвет, «Без текстуры», узор, картинка, градиент) —
 *     правкой листов на месте (`bakeFile`, та же арифметика, что у зданий);
 *   • прозрачность — прозрачными шейдерами игры: листы каркаса, рекламы и
 *     светильника становятся DXT5 с альфой, шейдеры — пресетами `_alpha` в
 *     корзине прозрачных (`restyle-model` нативного хоста — на месте формат
 *     не сменить), у стекла — его альфа × прозрачность. У рекламного щита
 *     (`emissive_speclum`) прозрачного пресета в игре нет — хост переводит
 *     его на `emissive` с `emissive_alpha.sps`, как светильник навеса.
 *
 * Файлы остановок берут только остановки (опись мира: других вещей у этих
 * моделей и словарей нет), поэтому правка не расползается на другие объекты.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { decodeTextureRef } from "@modovik/rage-drawable";
import { encodeDds, fullMipLevels } from "@modovik/dds";
import { hexBytes } from "@modovik/climb-contract/recolor/colour";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import {
  BUSSTOPS_INVENTORY,
  BUSSTOP_CAPPED_PARTS,
  BUSSTOP_HIGHLIGHT_CAP,
  busStopLookOf,
  busStopsProjectIsStock,
  normalizeBusStopsProject,
} from "@modovik/climb-contract/recolor/busstops";
import { finishSource } from "./finish-bake.js";
import { buildBoothFiles } from "./recolor-busstop-booths.js";
import { buildBusStopLive } from "./recolor-busstop-live.js";
import { bakeFile, resourceRefs, sheetPixels } from "./recolor-sheets.js";

/* Подъём тёмного у тона: как у зданий, чёрные швы листа не остаются чёрными. */
const TINT_LIFT = 0.2;
/* Шейдеры, что становятся прозрачными: каркас, его ночное свечение, светильник, реклама. */
const ALPHA_SHADERS = Object.freeze(["normal_spec", "emissivenight", "emissive", "emissive_speclum"]);
const TRANSPARENT_PARTS = new Set(["frame", "poster", "light"]);

/*
 * Белое на перекрашенной остановке (снимок владельца 10.11: фиолетовая городская 05, а окошко на коробе и прямоугольник на крыше белые). На листе каркаса лежит люминесцентная
 * панель (светлая, `prop_busstop_2`, `prop_busstop_5`): она и окошко на торце короба, и светильник на потолке (`emissivenight`, множитель 4). Таблица тона по светотени сводит
 * светлое к белому, а потолочный светильник ещё и светится. Каркасу и светильнику потолок яркости пикселя листа до таблицы — 0,6: панель, белые таблички листа и полосы светильника
 * получают цвет работы, а не лаванду. Лист светильника навеса `prop_busstop_4_lite` игра умножает на 9: яркость пикселя до множителя — не выше 1/9.
 */
export { BUSSTOP_HIGHLIGHT_CAP };
export const BUSSTOP_EMISSIVE_GAIN = Object.freeze({ prop_busstop_4_lite: 9 });

/** Правка листа по облику части или `null` — лист как в игре. */
export function busStopSurfaceOp(surface) {
  if (!surface || surface.mode === "standard") return null;
  if (surface.mode === "colour") {
    const look = normalizeColourEffect(surface.look);
    return look.mode === "solid" ? { tint: look.colour, lift: TINT_LIFT } : { strip: look, lift: TINT_LIFT };
  }
  if (surface.mode === "flat") return { flat: hexBytes(normalizeColourEffect(surface.look).colour) };
  return { finish: surface };
}

/* Пиксели листа нулевого уровня: с правкой облика или как в игре. */
function sheetRgba(ref, op, context) {
  if (op) {
    const rgba = sheetPixels(ref, op, context);
    if (rgba) return { rgba: new Uint8ClampedArray(rgba), width: ref.width, height: ref.height };
  }
  const level = decodeTextureRef(ref, { level: 0 });
  return { rgba: new Uint8ClampedArray(level.rgba), width: level.width, height: level.height };
}

/*
 * Прозрачная остановка: листы частей — DDS (каркас, реклама и светильник —
 * DXT5 с альфой прозрачности, стекло — своя альфа × прозрачность), модель —
 * с прозрачными шейдерами. Возвращает байты файла или `null`, если в
 * словаре нечего менять.
 */
async function transparentFile({ bytes, file, kind, partOf, opOf, opacity, context, compile, stateDir }) {
  if (typeof compile !== "function") throw new Error("Сборщик прозрачных остановок не подключён — обновите Astral.");
  const { refs } = resourceRefs(new Uint8Array(bytes), file);
  const staging = path.join(stateDir, "recolor", "busstops", "restyle", randomUUID());
  await fs.mkdir(staging, { recursive: true });
  try {
    const textures = [];
    for (const ref of refs) {
      const name = ref.name.toLowerCase();
      const part = partOf.get(name);
      if (!part || !ref.complete) continue;
      const op = opOf(name);
      const transparent = TRANSPARENT_PARTS.has(part) || part === "glass";
      if (!op && !transparent) continue;
      const { rgba, width, height } = sheetRgba(ref, op, context);
      let format = ref.format;
      if (TRANSPARENT_PARTS.has(part)) {
        for (let at = 3; at < rgba.length; at += 4) rgba[at] = Math.round(255 * opacity);
        format = "DXT5";
      } else if (part === "glass") {
        for (let at = 3; at < rgba.length; at += 4) rgba[at] = Math.round(rgba[at] * opacity);
        if (format === "DXT1") format = "DXT5";
      }
      const dds = encodeDds({ width, height, format, mipLevels: fullMipLevels(width, height), rgba });
      const target = path.join(staging, `${textures.length}.dds`);
      await fs.writeFile(target, dds, { flag: "wx" });
      textures.push({ name, dds: target });
    }
    /* Словарь, где нет ни одного листа прозрачных частей, — как в игре. */
    if (kind !== "model" && !textures.length) return null;
    const input = path.join(staging, `in${path.extname(file)}`);
    const output = path.join(staging, `out${path.extname(file)}`);
    const request = path.join(staging, "request.json");
    await fs.writeFile(input, bytes, { flag: "wx" });
    await fs.writeFile(
      request,
      JSON.stringify({ format: "astral.restyle-model", version: 1, target: input, textures, alpha: kind === "model" ? ALPHA_SHADERS : [] }),
    );
    await compile("restyle-model", { input: request, output });
    const built = await fs.readFile(output).catch(() => null);
    if (!built?.length) throw new Error(`Сборка прозрачной остановки ${file} не дала файла.`);
    return built;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Файлы остановок под работу: `{ files: [{ name, bytes }], patches, report }`.
 * `game` — читатель игры игрока, `images` — свои картинки отделки,
 * `compile(команда, вход)` — нативный хост (прозрачность и плашки гифок).
 */
export async function buildBusStopFiles(input, { game = null, images = new Map(), compile = null, stateDir = "" } = {}) {
  const project = normalizeBusStopsProject(input);
  if (busStopsProjectIsStock(project)) return { files: [], patches: [], report: { stock: true } };
  if (!game) throw new Error("Остановки собираются из файлов вашей игры — подключите GTA V.");
  const sources = new Map();
  const sourceOf = (item) => {
    const key = JSON.stringify([item.mode, item.pattern, item.image, item.gradient]);
    if (!sources.has(key)) sources.set(key, finishSource(item, images));
    return sources.get(key);
  };
  const context = { images: {}, sources: sourceOf };
  const files = [];
  const patches = [];
  const report = { types: [], transparent: 0, missing: [] };
  for (const type of BUSSTOPS_INVENTORY.types) {
    const look = busStopLookOf(project, type.id);
    const partOf = new Map(type.sheets.map((sheet) => [sheet.name, sheet.part]));
    const opOf = (texture) => {
      const part = partOf.get(texture);
      const op = part ? busStopSurfaceOp(look.parts[part]) : null;
      if (!op) return null;
      const gain = BUSSTOP_EMISSIVE_GAIN[texture];
      return { ...op, ...((op.tint || op.strip) && BUSSTOP_CAPPED_PARTS.includes(part) ? { cap: BUSSTOP_HIGHLIGHT_CAP } : {}), ...(gain ? { gain } : {}) };
    };
    const opacity = Math.min(1, look.opacity / 100);
    if (opacity >= 1 && !type.sheets.some((sheet) => opOf(sheet.name))) continue;
    const targets = [{ file: type.file, at: type.at, kind: "model" }, ...(type.hd ? [{ file: type.hd.file, at: type.hd.at, kind: "hd" }] : [])];
    for (const target of targets) {
      const base = await game.read(target.at).catch(() => null);
      if (!base) {
        report.missing.push(target.file);
        continue;
      }
      if (opacity < 1) {
        const bytes = await transparentFile({ bytes: base, file: target.file, kind: target.kind, partOf, opOf, opacity, context, compile, stateDir });
        if (!bytes) continue;
        files.push({ name: target.file, bytes });
        patches.push({ file: target.file, type: type.id, transparent: opacity });
        continue;
      }
      const baked = await bakeFile(base, target.file, (texture) => opOf(texture), { images: {}, sources: sourceOf });
      if (!baked.textures.length) continue;
      files.push({ name: target.file, bytes: baked.bytes });
      patches.push({ file: target.file, type: type.id, textures: baked.textures });
    }
    report.types.push(type.id);
    if (opacity < 1) report.transparent += 1;
  }
  /* Будки (задача 11 ТЗ 18.10.2026): штатные модели «24 HRS. PARK» едут тем же ходом — палитры, листы частей, картинки. */
  const booths = await buildBoothFiles(project.booths, { game, images });
  files.push(...booths.files);
  patches.push(...booths.patches);
  report.booths = booths.report.types;
  report.boothMissing = booths.report.missing;
  report.missing.push(...booths.report.missing);
  /* Гифка на постере: на листе лежит первый кадр (выше), живая плашка по геометрии постера — на каждой остановке вида. */
  const live = await buildBusStopLive(project, { images, compile, stateDir });
  files.push(...live.files);
  if (live.files.length) patches.push({ file: "models", live: live.report.live, stops: live.report.stops });
  report.live = live.report.live;
  report.liveStops = live.report.stops;
  report.liveBytes = live.report.bytes;
  report.liveClips = live.report.clips;
  return { files, patches, report };
}
