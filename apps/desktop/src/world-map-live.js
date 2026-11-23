/*
 * Какая большая карта стоит в игре сейчас — по плиткам живого update.rpf
 * (17.10, ТЗ владельца: «поставил атлас в высоком качестве — в игре при
 * прокрутке карты пролаги и фризы»).
 *
 * Редактор читает «как в игре» штатную карту Rockstar (`world-map-stock.js`),
 * а лагать может то, что лежит в архиве на самом деле: чужой атлас 4096 без
 * мипов или несжатые плитки. Игра вешает плитки паузы по одной и
 * подгружает плитку целиком, когда та входит в кадр
 * (`SET_BITMAP_MAP_ON` в `minimap_main_map.gfx`), поэтому мерило плавности —
 * вес одной плитки, а не только всей карты. Здесь он считается по
 * заголовкам: размер, формат и число мипов текстуры (читается начало
 * ресурса — разжимать плитку целиком незачем) и страница ресурса, которую
 * игра под неё выделяет. Ничего не пишет.
 */

import path from "node:path";
import zlib from "node:zlib";
import { readTextureDictionary } from "@modovik/rage-drawable";
import { keysFromDirectory, openRpfFile } from "@modovik/rpf7/node";
import { pageFlagSize } from "@modovik/ypt/resource-core";
import { HEAVY_TILE_BYTES, tileVideoBytes } from "@modovik/vector-map";

/** Плитки карты в оверлее `scaleform_generic.rpf` титульного обновления. */
const LIVE_TILE =
  /^x64\/data\/cdimages\/scaleform_generic\.rpf\/(minimap(_sea)?_\d{1,2}_\d{1,2})\.ytd$/i;

/* Заголовок словаря и текстуры — в начале виртуальной области ресурса:
   четверти мегабайта сжатого потока хватает с запасом. */
const HEAD_BYTES = 256 * 1024;
/*
 * Выход раскрытия ограничен (проверка границ доверия, ТЗ 17.10.2026): плитка
 * лежит в update.rpf игрока, там бывают и чужие моды, а 256 КБ сжатых нулей
 * раскрываются в 260 МБ. Не уложился в предел — начало берётся короче (заголовок
 * словаря — килобайты в самом начале потока), до четырёх килобайт сжатого.
 */
const HEAD_OUTPUT_LIMIT = 16 * 1024 * 1024;
const HEAD_LADDER = Object.freeze([HEAD_BYTES, 64 * 1024, 16 * 1024, 4 * 1024]);

/** Начало потока плитки: раскрытый префикс не больше `HEAD_OUTPUT_LIMIT`. */
export function inflateTileHead(raw, { limit = HEAD_OUTPUT_LIMIT } = {}) {
  for (const size of HEAD_LADDER) {
    try {
      return zlib.inflateRawSync(raw.subarray(0, size), {
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
        maxOutputLength: limit,
      });
    } catch (error) {
      if (error?.code !== "ERR_BUFFER_TOO_LARGE") throw error;
    }
  }
  throw new RangeError("Начало текстуры раскрывается слишком сильно — это не плитка карты.");
}

const FORMATS = Object.freeze({ DXT1: "bc1", DXT5: "bc3", A8R8G8B8: "rgba8", X8R8G8B8: "rgba8" });

/** Заголовок первой текстуры словаря без разжатия всей плитки. */
export function liveTileTexture(bytes) {
  const [texture] = readTextureDictionary(bytes, { inflateRaw: inflateTileHead });
  if (!texture) return null;
  return {
    width: texture.width,
    height: texture.height,
    format: texture.format,
    levels: texture.levels,
  };
}

/**
 * Сводка плиток: `tiles` — `[{ name, stored, page, width, format, levels }]`
 * (`page` — страница ресурса, `stored` — сжатый размер в архиве). Семья
 * паузы — `minimap_sea_*`, радара — `minimap_*`.
 */
export function summarizeLiveTiles(tiles) {
  const family = (sea) => {
    const items = tiles.filter((tile) => /^minimap_sea_/i.test(tile.name) === sea);
    const weigh = (tile) =>
      tileVideoBytes({
        pixels: tile.width || 0,
        format: FORMATS[String(tile.format || "").toUpperCase()] || "bc3",
        mipmaps: tile.levels > 1,
      });
    const bytes = items.reduce((sum, tile) => sum + weigh(tile), 0);
    const largest = items.reduce((best, tile) => (!best || weigh(tile) > weigh(best) ? tile : best), null);
    return {
      tiles: items.length,
      bytes,
      tile: largest ? weigh(largest) : 0,
      page: items.reduce((most, tile) => Math.max(most, tile.page || 0), 0),
      stored: items.reduce((most, tile) => Math.max(most, tile.stored || 0), 0),
      side: largest?.width || 0,
      format: largest?.format || null,
      mipmaps: largest ? largest.levels > 1 : null,
    };
  };
  const pause = family(true);
  const radar = family(false);
  return {
    pause,
    radar,
    bytes: pause.bytes + radar.bytes,
    heavy: pause.tile >= HEAVY_TILE_BYTES,
  };
}

/** Большая карта в живом update.rpf игрока: сводка `summarizeLiveTiles`. */
export async function describeLiveWorldMap({ gameRoot, keysDirectory }) {
  const keys = await keysFromDirectory(keysDirectory);
  const archive = await openRpfFile(path.join(gameRoot, "update", "update.rpf"), {
    keys,
    nested: true,
  });
  try {
    const tiles = [];
    for (const entry of archive.entries) {
      const match = LIVE_TILE.exec(entry.path);
      if (!match || entry.kind !== "resource") continue;
      const texture = liveTileTexture(await archive.read(entry.path));
      if (!texture) continue;
      tiles.push({
        name: match[1].toLowerCase(),
        stored: entry.storedSize || 0,
        page: pageFlagSize(entry.graphicsFlags),
        ...texture,
      });
    }
    return tiles.length ? summarizeLiveTiles(tiles) : null;
  } finally {
    await archive.close?.();
  }
}
