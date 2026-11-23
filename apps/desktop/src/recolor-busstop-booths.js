/*
 * «Будки» в файлах (задача 11 ТЗ 18.10.2026): парковочные будки «24 HRS. PARK»
 * едут тем же ходом, что остановки (`recolor-busstops.js`).
 *
 * Основа — штатные будки игры игрока (опись `busstop-booths`): у каждой
 * модели сама модель (`prop_parking_hut_2.yft`, `prop_parking_hut_2b.yft` —
 * листы и палитры зашиты в неё) и словарь высокой чёткости (`+hifr.ytd`) —
 * те же листы крупнее, для взгляда вблизи. Оба едут с одной и той же правкой:
 * на любой дистанции будка одна.
 *
 *   • корпус, козырёк с цоколем и рамы — столбцы палитры тинта
 *     (`<модель>_pal`, у второго уровня детализации — `_l1_pal`): лист стен
 *     умножается в игре на цвет столбца, и правка цвета — это правка
 *     столбцов (`boothPaletteChanges`), лист остаётся как был;
 *   • крыша и пол — общая отделка листа (свой цвет эффектом, «Без текстуры»,
 *     узор, картинка, градиент): листы `_ml_idroof01`, `dc_underside_roof_001`
 *     (и их копии высокой чёткости), `et_nonslip_vrusty`;
 *   • надписи «24 HRS.» и «PARKING», листки NOTICE и WARNING и табличка клиентов
 *     — места листа декалей (`areas` описи): правка ложится только в своё место,
 *     соседние места листа остаются байт в байт — блоки DXT без тронутых
 *     текселей едут прежними (`texturePayload` с оригиналом); своя картинка
 *     встаёт в острова места (`placeImageInIslands` — та же функция, что у
 *     кадра окна);
 *   • стёкла — оттенок листа нужной силы (шейдер стекла у игры отдельный,
 *     «прозрачность» здесь — сила оттенка).
 *
 * Файлы будок берут только будки (опись мира: других вещей у этих моделей и
 * словарей нет), поэтому правка не расползается на другие объекты.
 */

import { decodeTextureRef } from "@modovik/rage-drawable";
import { placeImageInIslands } from "@modovik/climb-contract/recolor/arena-slots";
import { atmSurfaceHasPicture, atmSurfaceIsStock, atmSurfaceTransform } from "@modovik/climb-contract/recolor/atms";
import { hexBytes } from "@modovik/climb-contract/recolor/colour";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import { normalizeFinishImage } from "@modovik/climb-contract/recolor/finish";
import {
  BOOTHS_INVENTORY,
  boothLookIsStock,
  boothLookOf,
  boothPaletteChanges,
  boothsAreStock,
  findBoothPart,
  normalizeBooths,
} from "@modovik/climb-contract/recolor/busstop-booths";
import { bakeSheetFinish, finishSource } from "./finish-bake.js";
import { atmAreaMap, atmPalettePixels } from "./recolor-atms.js";
import { resourceRefs, stripPixels, tintPixels } from "./recolor-sheets.js";
import { patchResourceTextures } from "./recolor-textures.js";
import { texturePayload } from "./texture-payload.js";

/* Подъём тёмного у тона: как у зданий, остановок и банкоматов, чёрные швы листа не остаются чёрными. */
const TINT_LIFT = 0.2;

/** Правка листа по облику части (цвет тоном, эффект, «Без текстуры», отделка) или `null` — лист как в игре. */
export function boothSurfaceOp(partId, surface) {
  if (atmSurfaceIsStock(surface)) return null;
  const kind = findBoothPart(partId)?.kind;
  /* Крыша и пол — общая отделка листа, как у остановок (`busStopSurfaceOp`). */
  if (kind === "finish") {
    if (surface.mode === "colour") {
      const look = normalizeColourEffect(surface.look);
      return look.mode === "solid" ? { tint: look.colour, lift: TINT_LIFT } : { strip: look, lift: TINT_LIFT };
    }
    if (surface.mode === "flat") return { flat: hexBytes(normalizeColourEffect(surface.look).colour) };
    return { finish: surface };
  }
  /* Надписи, листки и стекло: тон листа или ровный цвет; картинка — в острова. */
  if (surface.mode === "colour") return { tint: surface.colour, lift: TINT_LIFT };
  if (surface.mode === "flat") return { flat: hexBytes(surface.colour) };
  return null;
}

/* Пиксели уровня по операции: ровный цвет, тон, полоса эффекта, общая отделка. Альфа листа (декали, стекло) остаётся. */
function opPixels(level, op, sources) {
  const { rgba, width, height } = level;
  if (op.flat) {
    const out = new Uint8ClampedArray(rgba);
    for (let at = 0; at < out.length; at += 4) {
      out[at] = op.flat[0];
      out[at + 1] = op.flat[1];
      out[at + 2] = op.flat[2];
    }
    return out;
  }
  if (op.tint) return tintPixels(rgba, op.tint, op.lift || 0);
  if (op.strip) return stripPixels(rgba, width, height, op.strip, op.lift || 0);
  if (op.finish) return bakeSheetFinish(rgba, width, height, op.finish, sources(op.finish));
  return null;
}

/**
 * Новые пиксели листа по облику на уровне `level` (`{ rgba, width, height }`)
 * или `null` — лист как в игре. `sheet` — запись описи (места листа),
 * `images` — свои картинки (`Map` ключ → `{ rgba, width, height }`), `sources` —
 * источник отделки. Размер уровня любой: у листа высокой чёткости те же места
 * (`areas` — доли листа) и те же острова.
 */
export function boothSheetFromLevel(level, sheet, look, { images = new Map(), sources = null } = {}) {
  const original = new Uint8ClampedArray(level.rgba);
  const out = new Uint8ClampedArray(original);
  const base = { rgba: original, width: level.width, height: level.height };
  let map = null;
  let changed = false;
  sheet.areas.forEach((area, index) => {
    if (!area.part) return;
    const surface = look.parts[area.part];
    if (atmSurfaceIsStock(surface)) return;
    let pixels = null;
    if (atmSurfaceHasPicture(surface)) {
      const image = images.get(normalizeFinishImage(surface.image).asset);
      if (!image) throw new Error("Своя картинка будки не пришла — выберите её ещё раз.");
      pixels = new Uint8ClampedArray(original);
      placeImageInIslands(pixels, level.width, level.height, area.islands || [], image, atmSurfaceTransform(surface));
    } else {
      const op = boothSurfaceOp(area.part, surface);
      if (!op) return;
      pixels = opPixels(base, op, sources);
      /* Стекло: сила оттенка — доля оттенка поверх листа (0 % — стекло как есть). */
      if (pixels && area.part === "glass" && surface.strength < 100) {
        const keep = 1 - surface.strength / 100;
        for (let at = 0; at < pixels.length; at += 4)
          for (let channel = 0; channel < 3; channel += 1) pixels[at + channel] = Math.round(original[at + channel] * keep + pixels[at + channel] * (1 - keep));
      }
    }
    if (!pixels) return;
    map ||= atmAreaMap(sheet.areas, level.width, level.height);
    for (let texel = 0; texel < map.length; texel += 1) {
      if (map[texel] !== index) continue;
      const at = texel * 4;
      out[at] = pixels[at];
      out[at + 1] = pixels[at + 1];
      out[at + 2] = pixels[at + 2];
      out[at + 3] = pixels[at + 3];
    }
    changed = true;
  });
  return changed ? { rgba: out, original } : null;
}

/** Новые пиксели листа модели (лист игры `ref`) по облику или `null` — лист как в игре. */
export const boothSheetPixels = (ref, sheet, look, options = {}) => boothSheetFromLevel(decodeTextureRef(ref, { level: 0 }), sheet, look, options);

/* Байты листа ресурса: для `texturePayload` с оригиналом — пережимаются только тронутые блоки. */
const payloadOf = (ref, { rgba, original }) =>
  texturePayload({ name: ref.name, format: ref.format, width: ref.width, height: ref.height, levels: ref.levels, bytes: ref.bytes }, rgba, {
    original,
    originalData: ref.resource?.data && ref.dataAt >= 0 ? ref.resource.data.subarray(ref.dataAt, ref.dataAt + ref.bytes) : null,
  });

/*
 * Один файл модели или словаря: листы с правкой (места частей) и палитры.
 * Ответ — `{ bytes, textures }` или `null`, если в файле нечего менять.
 */
function bakeBoothFile(base, file, { type, look, palettes, images, sources }) {
  const raw = base instanceof Uint8Array ? base : new Uint8Array(base);
  const { refs } = resourceRefs(raw, file);
  const replacements = {};
  for (const ref of refs) {
    if (!ref.complete) continue;
    const name = ref.name.toLowerCase();
    const sheet = type.sheets.find((item) => item.name === name);
    const columns = palettes.get(name);
    const pixels = sheet ? boothSheetPixels(ref, sheet, look, { images, sources }) : columns ? atmPalettePixels(ref, columns) : null;
    if (pixels) replacements[ref.name] = payloadOf(ref, pixels);
  }
  if (!Object.keys(replacements).length) return null;
  const patched = patchResourceTextures(raw, file, replacements);
  return { bytes: patched.bytes, textures: patched.patched };
}

const asBuffer = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * Файлы будок под работу «Остановок» (`project.booths`):
 * `{ files: [{ name, bytes }], patches, report }`. `game` — читатель игры
 * игрока, `images` — свои картинки (`Map` ключ → `{ rgba, width, height }`).
 */
export async function buildBoothFiles(input, { game = null, images = new Map() } = {}) {
  const booths = normalizeBooths(input?.booths ?? input);
  if (boothsAreStock(booths)) return { files: [], patches: [], report: { stock: true, types: [], missing: [] } };
  if (!game) throw new Error("Будки собираются из файлов вашей игры — подключите GTA V.");
  const sources = new Map();
  const sourceOf = (item) => {
    const key = JSON.stringify([item.mode, item.pattern, item.image, item.gradient]);
    if (!sources.has(key)) sources.set(key, finishSource(item, images));
    return sources.get(key);
  };
  const files = [];
  const patches = [];
  const report = { types: [], placements: 0, missing: [] };
  for (const type of BOOTHS_INVENTORY.types) {
    const look = boothLookOf(booths, type.id);
    if (boothLookIsStock(look, type.id)) continue;
    const palettes = boothPaletteChanges(type.id, look);
    const context = { type, look, palettes, images, sources: sourceOf };
    let touched = false;

    /* Модель: листы и палитры. */
    const base = await game.read(type.at).catch(() => null);
    if (!base) report.missing.push(type.file);
    else {
      const baked = bakeBoothFile(base, type.file, context);
      if (baked) {
        files.push({ name: type.file, bytes: asBuffer(baked.bytes) });
        patches.push({ file: type.file, type: type.id, textures: baked.textures });
        touched = true;
      }
    }

    /* Словарь высокой чёткости — те же листы крупнее (палитр в нём нет). */
    const hdSheets = type.sheets.filter((sheet) => sheet.hd && sheet.areas.some((area) => area.part && !atmSurfaceIsStock(look.parts[area.part])));
    if (type.hd && hdSheets.length) {
      const hd = await game.read(type.hd.at).catch(() => null);
      if (!hd) report.missing.push(type.hd.file);
      else {
        const baked = bakeBoothFile(hd, type.hd.file, { ...context, type: { ...type, sheets: hdSheets }, palettes: new Map() });
        if (baked) {
          files.push({ name: type.hd.file, bytes: asBuffer(baked.bytes) });
          patches.push({ file: type.hd.file, type: type.id, textures: baked.textures });
          touched = true;
        }
      }
    }
    if (touched) {
      report.types.push(type.id);
      report.placements += type.placements || 0;
    }
  }
  return { files, patches, report };
}
