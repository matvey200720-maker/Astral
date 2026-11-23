/*
 * Растеризация большой карты.
 *
 * Игра принимает карту плитками текстур, а не сценой, поэтому перед установкой
 * сцену нужно нарисовать. Рисует её тот же код, что и предпросмотр
 * (`paintMapScene` из пакета карты), поэтому «получилось не как в редакторе»
 * здесь невозможно по построению.
 *
 * Растеризация живёт в окне, а не в main process. Причина простая: в окне уже
 * есть шрифты, канва и загруженные картинки эмблем, а в main process ничего из
 * этого нет и пришлось бы тащить второй растеризатор. Main process получает
 * готовые DDS и занимается тем, чем должен: проверкой, упаковкой и записью в
 * архив игры.
 *
 * Пиксельная часть работы — увеличение плитки, перекраска, текстура, сжатие —
 * идёт в фоновом потоке (`world-map-tile-runner.js`): плитка карты паузы в
 * 4096 точек — это секунды счёта, и окно во время установки обязано жить.
 */

import {
  MAP_TILE_SIDE_LIMIT,
  PAUSE_MAP_GAME_SEA,
  exportTileSpec,
  mapOpaqueBounds,
  paintMapScene,
  sceneTileGrid,
} from "@modovik/vector-map";
import { textureSideFor } from "./world-map-pixels.js";
import { renderVectorPixels } from "./world-map-base.js";
import { createTileRunner } from "./world-map-tile-runner.js";
import { mapText } from "./world-map/map-copy.js";

/** Плиток в атласе не бывает много; ограничение отсекает подложку-обманку. */
const MAX_TILES = 24;

async function loadImage(href) {
  const response = await fetch(href);
  if (!response.ok)
    throw new Error(`Не удалось прочитать изображение: ${href}`);
  return createImageBitmap(await response.blob());
}

/** Собирает все растровые источники сцены: плитки подложки, подложки семьи с морем и эмблемы. */
export async function collectSceneImages(scene) {
  const hrefs = new Set();
  for (const layer of scene.layers)
    for (const item of layer.items)
      /* Плитки готовой карты (`lazy`) читает сам экспорт — по одной. */
      if (item.kind === "image" && item.href && !item.lazy) hrefs.add(item.href);
  for (const tile of scene.landTiles || []) if (tile.href) hrefs.add(tile.href);
  const images = new Map();
  await Promise.all(
    [...hrefs].map(async (href) => {
      try {
        images.set(href, await loadImage(href));
      } catch {
        /* Пропавшая картинка не должна ронять экспорт: она просто не рисуется. */
      }
    }),
  );
  return images;
}

/*
 * Шрифты надписей — до того, как канва начнёт рисовать (ТЗ 05.10).
 *
 * Шрифты карты лежат в проекте и грузятся по требованию: @font-face с
 * `unicode-range` отдаёт браузеру файл, только когда буквы этого алфавита
 * впервые нужны. Канва ждать не умеет — нарисовала бы запасной гарнитурой, и
 * в игру уехала бы не та надпись, что видна в окне. Поэтому каждый шрифт
 * сцены с её же буквами грузится заранее; пропавший шрифт экспорт не роняет.
 */
export async function loadSceneFonts(scene) {
  const fonts = globalThis.document?.fonts;
  if (typeof fonts?.load !== "function") return;
  const wanted = new Map();
  for (const layer of scene.layers || [])
    for (const item of layer.items || []) {
      if (item.kind !== "text" || !item.family) continue;
      const key = `${item.weight || 400} 32px ${item.family}`;
      const text = item.lines?.length ? item.lines.join("") : String(item.value ?? "");
      wanted.set(key, `${wanted.get(key) || ""}${text}`.slice(0, 600));
    }
  await Promise.all(
    [...wanted].map(([font, text]) => fonts.load(font, text || "Aa").catch(() => [])),
  );
}

function createCanvas(size) {
  if (typeof OffscreenCanvas === "function")
    return new OffscreenCanvas(size, size);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

async function canvasBlob(canvas) {
  if (typeof canvas.convertToBlob === "function")
    return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Канва не отдала PNG")),
      "image/png",
    ),
  );
}

const sameRect = (left, right) =>
  left &&
  right &&
  Math.abs(left.u - right.u) < 1e-6 &&
  Math.abs(left.v - right.v) < 1e-6;

/*
 * Плитка карты паузы без подложки — не карта (04.11.2026). Подложку (сушу, дороги) в плитку кладёт обработчик растра по
 * месту плитки; не нашёл её или не прочитал — прежний код молча пропускал подложку, рисовал зоны и подписи поверх
 * пустоты и отчитывался «готово»: в игре зоны висели без суши. Теперь это отказ: ничего не пишется, причина названа.
 * Карта-картинка (`source.picture`) держит подложку сама, схема (`source` пуст) подложки не просит.
 */
export function missingBaseTiles(grid, source) {
  if (!source || source.picture) return [];
  return (grid?.tiles || [])
    .filter((tile) => tile.family === "sea" && !source.tiles?.some((item) => sameRect(item.rect, tile.rect)))
    .map((tile) => tile.name);
}

const baseMissing = (name) =>
  new Error(
    mapText("Подложка карты не легла в плитку «{name}»: редактор закрылся или основа не прочиталась. Откройте карту и нажмите «Применить» ещё раз — в игру ничего не записано.", { name }),
  );

/** Пиксели холстом: ими подложка попадает в сцену как обычная картинка. */
function pixelsCanvas(pixels) {
  const canvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(pixels.width, pixels.height)
      : Object.assign(document.createElement("canvas"), {
          width: pixels.width,
          height: pixels.height,
        });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Браузер не дал контекст канвы.");
  context.putImageData(
    new ImageData(pixels.data, pixels.width, pixels.height),
    0,
    0,
  );
  return canvas;
}

/**
 * Рисует сцену плитками атласа и сжимает их так, как ждёт игра.
 *
 * Возвращает то, что уедет в main process: имя плитки, её место в сетке и DDS
 * в base64. Порядок плиток — построчный, как их кладёт игра. PNG здесь нет
 * намеренно: игре нужен блочно-сжатый DDS, и лишний проход через PNG стоил бы
 * времени и памяти, ничего не добавляя.
 *
 * @param {object} scene сцена карты (`buildMapScene`)
 * @param {object} [options]
 * @param {number} [options.detail] во сколько раз плитки карты паузы крупнее
 *   плиток игрока
 * @param {object} [options.source] сырьё подложки от процессора
 *   (`exportSource`): пиксели плиток и проход обработки. Без него сцена
 *   рисуется из своих картинок как есть.
 * @param {(tile: object) => Promise<void>} [options.onTile] забирает готовую
 *   плитку сразу (например, отдаёт её главному процессу); в результате такая
 *   плитка остаётся без `dds`
 * @param {(done: number, total: number, stage: string) => void} [options.onProgress]
 */
/*
 * Плитка подложки с пикселями. У готовой карты из пака пикселей заранее нет —
 * она читается здесь, когда экспорт дошёл до её места (`load`), и уходит из
 * памяти вместе с этим проходом.
 */
async function withPixels(item) {
  if (!item) return null;
  if (item.pixels) return item;
  const pixels = await item.load?.();
  return pixels ? { ...item, pixels } : null;
}

export async function renderMapTiles(scene, options = {}) {
  const grid = sceneTileGrid(scene, options.resolution || 4096, {
    detail: options.detail,
    sideLimit: MAP_TILE_SIDE_LIMIT,
    radar: options.radar,
    /* Воды нет (31.10): плитки паузы с прозрачным морем, без заливки фильма. */
    pauseOpaque: options.pauseOpaque,
  });
  if (grid.tiles.length > MAX_TILES)
    throw new Error("Слишком много плиток в атласе карты.");
  const lacking = missingBaseTiles(grid, options.source);
  if (lacking.length) throw baseMissing(lacking[0]);
  await loadSceneFonts(scene);
  const images = options.images || (await collectSceneImages(scene));
  const source = options.source || null;
  const runner = options.runner || createTileRunner();
  /*
   * Прозрачность обязана дожить до DDS: у плиток игры вырезаны целые области,
   * и непрозрачный холст залил бы их чёрным ещё до сжатия. Холсты — по одному
   * на размер: у игрока плитки семей бывают разного размера, и каждая пишется
   * своим.
   */
  const canvases = new Map();
  const canvasFor = (size) => {
    if (!canvases.has(size)) {
      const canvas = createCanvas(size);
      const context = canvas.getContext("2d", {
        alpha: true,
        willReadFrequently: true,
      });
      const composite = createCanvas(size);
      const compositeContext = composite.getContext("2d", {
        alpha: true,
        willReadFrequently: true,
      });
      if (!context) throw new Error("Браузер не дал контекст канвы.");
      canvases.set(size, { canvas, context, compositeContext });
    }
    return canvases.get(size);
  };

  /*
   * Обработанная подложка куска атласа в нужном размере — холстом. Раппорт
   * текстуры считается от атласа, а её сторона — от размера плитки: точка
   * текстуры должна приходиться на точку карты, иначе на увеличенной плитке
   * рисунок мылится.
   */
  const processed = async (tile, factor, sea = null) => {
    const { pass } = source;
    const side = tile.pixels.width * factor;
    /*
     * Векторная подложка рисуется сразу в размере плитки — увеличивать
     * нечего, дороги резкие на любой стороне. Тон и текстура — тем же
     * потоком, что у растра.
     */
    if (source.vector) {
      const texture = pass.texture?.id
        ? {
            id: pass.texture.id,
            side: textureSideFor(
              side / tile.rect.width / Math.max(0.25, pass.layer.scale || 1),
            ),
          }
        : pass.texture?.pixels || null;
      const pixels = renderVectorPixels(
        { ...source.vector, pass: null },
        tile.rect,
        side,
        side,
        sea,
      );
      return pixelsCanvas(
        await runner.processBase({
          pixels,
          factor: 1,
          colorMap: pass.colorMap,
          texture,
          region: tile.rect,
          layer: pass.layer,
        }),
      );
    }
    const texture = pass.texture?.id
      ? {
          id: pass.texture.id,
          side: textureSideFor(
            side / tile.rect.width / Math.max(0.25, pass.layer.scale || 1),
          ),
        }
      : pass.texture?.pixels || null;
    return pixelsCanvas(
      await runner.processBase({
        pixels: tile.pixels,
        factor,
        colorMap: pass.colorMap,
        texture,
        region: tile.rect,
        layer: pass.layer,
      }),
    );
  };

  const chosen = options.format === "bc1" ? "bc1" : "bc3";
  /* Море плиток паузы — цветом моря фильма карты (`pauseTileSea`): плитки
     непрозрачные, и вода в них обязана совпасть с заливкой за их краем. */
  const pauseSea = options.pauseSea || PAUSE_MAP_GAME_SEA;
  const result = [];
  try {
    /* Своя картинка-подложка обрабатывается один раз: она одна на весь атлас. */
    if (source?.picture)
      images.set(
        source.picture.href,
        await processed(
          {
            pixels: source.picture.pixels,
            rect: { u: 0, v: 0, width: 1, height: 1 },
          },
          1,
        ),
      );
    /*
     * Семья `minimap_sea_r_c` — кусок сцены на заливке моря фильма карты
     * (с 17.10 непрозрачный, BC1: `PAUSE_TILE_FORMAT`). Семья `minimap_r_c` —
     * тот же кусок поверх собственной плитки игрока с запечённым морем: море
     * остаётся его, суша и рисунок — наши. Одинаковые запросы (кусок +
     * подложка + формат + размер) сжимаются один раз.
     */
    const rendered = new Map();
    for (const tile of grid.tiles) {
      // Плитка игрока диктует формат и размер; общий выбор работает там, где
      // заменять нечего — то есть до того, как карта прочитана из игры. Те же
      // правила считают вес карты в видеопамяти (`worldMapVideoWeight`).
      const { pixels, format, mipmaps } = exportTileSpec(tile, grid, chosen);
      const key = [
        tile.view.x,
        tile.view.y,
        tile.view.width,
        tile.view.height,
        format,
        mipmaps,
        pixels,
        tile.underlay || "",
        tile.underlay ? options.seaColor || "" : "",
        tile.opaque ? pauseSea : "",
      ].join(":");
      let dds = rendered.get(key);
      if (!dds) {
        options.onProgress?.(result.length, grid.tiles.length, "base");
        /*
         * Подложка этой плитки — обработанная и в размере самой плитки —
         * подменяет в сцене картинку игрока на время отрисовки. Соседние
         * плитки лежат за краем холста и в кадр не попадают.
         */
        const own = await withPixels(
          source?.tiles.find((item) => sameRect(item.rect, tile.rect)),
        );
        /* Плитка есть, а её картинка не прочиталась (`load` вернул `null`): тоже отказ, а не пропуск подложки. */
        if (!own && source && tile.family === "sea" && !source.picture) throw baseMissing(tile.name);
        const original = own ? images.get(own.href) : null;
        if (own)
          images.set(
            own.href,
            await processed(own, Math.max(1, pixels / own.pixels.width)),
          );
        const { canvas, context, compositeContext } = canvasFor(pixels);
        paintMapScene(context, scene, {
          view: tile.view,
          width: pixels,
          height: pixels,
          images,
        });
        if (own) {
          if (original) images.set(own.href, original);
          else images.delete(own.href);
        }
        let painted = context;
        if (tile.opaque && compositeContext) {
          /*
           * Плитка паузы — непрозрачная BC1 (`PAUSE_TILE_FORMAT`): море, которое
           * у штатной плитки вырезано в прозрачность, запекается заливкой
           * фильма. Полупрозрачная кромка берега и вода озёр ложатся на неё
           * так же, как игра положила бы их на заливку сама.
           */
          compositeContext.clearRect(0, 0, pixels, pixels);
          compositeContext.fillStyle = pauseSea;
          compositeContext.fillRect(0, 0, pixels, pixels);
          compositeContext.drawImage(canvas, 0, 0);
          painted = compositeContext;
        } else if (tile.underlay && compositeContext) {
          /*
           * Море семьи радара. Своё — тем же цветом, что и на карте паузы:
           * иначе радар показывал бы штатное сине-серое море под чёрной
           * картой. Без своего цвета море остаётся морем игрока — из его же
           * плитки.
           */
          if (options.seaColor) {
            compositeContext.clearRect(0, 0, pixels, pixels);
            compositeContext.fillStyle = options.seaColor;
            compositeContext.fillRect(0, 0, pixels, pixels);
            compositeContext.drawImage(canvas, 0, 0);
            painted = compositeContext;
          } else {
            const land = await withPixels(
              source?.landTiles.find((item) => sameRect(item.rect, tile.rect)),
            );
            /* Векторной подложке морю семьи радара взяться неоткуда, кроме
               палитры: оно рисуется цветом моря проекта. */
            const underlay = land
              ? await processed(
                  land,
                  1,
                  source?.vector ? source.vector.base.sea : null,
                )
              : images.get(tile.underlay);
            if (underlay) {
              compositeContext.clearRect(0, 0, pixels, pixels);
              compositeContext.drawImage(underlay, 0, 0, pixels, pixels);
              compositeContext.drawImage(canvas, 0, 0);
              painted = compositeContext;
            }
          }
        }
        const image = painted.getImageData(0, 0, pixels, pixels);
        options.onProgress?.(result.length, grid.tiles.length, "encode");
        dds = await runner.encode({
          data: image.data,
          width: pixels,
          height: pixels,
          format,
          mipmaps,
        });
        /* Плитка, которую забирают сразу, в памяти не копится: шесть строк по
           тридцать мегабайт — это то, что потом отнимает память у записи. */
        if (!options.onTile) rendered.set(key, dds);
      }
      const ready = {
        name: tile.name,
        file: tile.file,
        family: tile.family || null,
        column: tile.column,
        row: tile.row,
        pixels,
        format,
        dds,
      };
      if (options.onTile) {
        await options.onTile(ready);
        ready.dds = null;
      }
      result.push(ready);
      options.onProgress?.(result.length, grid.tiles.length, "done");
    }
  } finally {
    if (!options.runner) runner.dispose();
  }
  return {
    tiles: result,
    /* Сторона плитки карты паузы — то, что человек увидит при приближении. */
    pixels:
      Math.max(
        ...result
          .filter((tile) => tile.family !== "land")
          .map((tile) => tile.pixels),
        0,
      ) || Math.min(MAP_TILE_SIDE_LIMIT, grid.pixels),
    format: chosen,
    atlas: grid.atlas,
  };
}

/*
 * Обложка работы (01.11.2026, владелец: «превьюшка как будто в свёртке, а нужна просто большая карта»). Снимок окна брал кадр редактора: тёмные полигоны поля, рамку выделенной подписи и
 * плашку масштаба, а сам штат выходил мелким посередине. Карта рисуется отдельно тем же кодом, что и в игру, и обрезается по видимому: на обложке только штат на тёмном поле плитки.
 */
const MAP_COVER_FIELD = "#0c0c0c";

export async function renderMapCoverBitmap(scene, { width = 1600, images = null } = {}) {
  const blob = await renderMapImage(scene, { width, ...(images ? { images } : {}) });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const box = mapOpaqueBounds(context.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height) || { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  const framed = new OffscreenCanvas(box.width, box.height);
  const paint = framed.getContext("2d");
  paint.fillStyle = MAP_COVER_FIELD;
  paint.fillRect(0, 0, box.width, box.height);
  paint.drawImage(bitmap, -box.x, -box.y);
  bitmap.close?.();
  return createImageBitmap(framed);
}

/** Одно изображение всей карты — для выгрузки картинкой и для обложки. */
export async function renderMapImage(scene, options = {}) {
  const width = options.width || 2048;
  const height = Math.round((width * scene.height) / scene.width);
  const canvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Браузер не дал контекст канвы.");
  await loadSceneFonts(scene);
  paintMapScene(context, scene, {
    width,
    height,
    images: options.images || (await collectSceneImages(scene)),
  });
  return canvasBlob(canvas);
}
