/*
 * Пиксельная подложка большой карты в окне.
 *
 * Сам конвейер — перекраска по цветам карты, тон, подкраска, текстура — живёт
 * в пакете карты (`raster.js`) и про браузер ничего не знает. Здесь то, что
 * без браузера не сделать: распаковать плитки в пиксели, собрать обработанную
 * карту в картинку для сцены и отдать экспорту обработанные плитки поимённо.
 *
 * Редактору карта нужна одной картинкой и сразу: пока человек ведёт ползунок,
 * подложка пересчитывается в половинном размере (это десятки миллисекунд), а
 * когда рука остановилась — в полном. Экспорт черновиком не пользуется
 * никогда: `exportTiles` всегда считает плитки в их родном размере тем же
 * кодом, поэтому в игру уезжает ровно то, что показывало окно.
 */

import { perfCount, perfTimedAsync, perfValue } from "../../../perf-count.js";
import {
  DEFAULT_ATLAS,
  applyColorMap,
  applyRoleOverrides,
  applyTextureLayer,
  atlasSize,
  baseColorMapActive,
  baseRasterActive,
  baseRendersVector,
  buildBaseColorMap,
  classifyRadarColour,
  createRecolorField,
  detectMapSources,
  generateMapTexture,
  normalizeAtlas,
  vectorRadarColours,
  packRadarGeometry,
} from "@modovik/vector-map";
import { atlasRectWorld, paintVectorCanvas } from "./world-map-vector-render.js";
import { vectorRunner } from "./world-map-vector-runner.js";
import { radarFromPack, radarFromPicture, radarFromStyle } from "./world-map-radar.js";
import { renderBaseDetailGpu } from "./world-map/gpu/detail-gpu.js";
import { mapRendererMode } from "./world-map/gpu/map-renderer-flag.js";
import { sharedMapCanvas } from "./world-map/gpu/map-canvas.js";

/*
 * Что в стиле подложки меняет её пиксели. Остальное (фон редактора, ширина
 * дорог схемы, ореол берега) подложку не пересчитывает: гонять шесть
 * миллионов точек из-за цвета поля за картой незачем.
 */
const RASTER_KEYS = Object.freeze([
  "source",
  "templateId",
  "recolor",
  "roleOverrides",
  "sea",
  "land",
  "terrain",
  "sand",
  "water",
  "roads",
  "highways",
  "buildings",
  "runway",
  "outline",
  "brightness",
  "contrast",
  "saturation",
  "tintColor",
  "tintBlend",
  "tintOpacity",
  "textureId",
  "textureAssetId",
  "textureBlend",
  "textureOpacity",
  "textureScale",
  "textureColor",
  /* Векторная подложка рисует берег, свечение и биомы в пиксели. */
  "render",
  "shallow",
  "highwayCasing",
  "rail",
  "paths",
  /* Правки цветов готовой векторной карты (`pack-colors.js`, 10.10). */
  "paletteMap",
  "biomes",
  "relief",
  /* Рельеф из высот игры (11.10, `terrain.js`). */
  "reliefOn",
  "reliefShade",
  "reliefLight",
  "reliefHeight",
  "reliefTint",
  "reliefLow",
  "reliefHigh",
  "reliefContours",
  "reliefStep",
  "reliefContourColor",
  "reliefContourOpacity",
  "roadCasing",
  "waterSmooth",
  "shallowReach",
  "outline",
  "outlineWidth",
  "edgeGlow",
  "edgeGlowColor",
  /* Спрятанные глазом слои подложки (редизайн 04.10). */
  "hidden",
]);

/** Ключ пикселей подложки: меняется только от того, что их меняет. */
export const baseRasterKey = (base) =>
  JSON.stringify(RASTER_KEYS.map((key) => base?.[key]));

/** Сторона плитки в черновом проходе — пока ползунок в движении. */
const DRAFT_SIDE = 512;
/** Ширина векторной подложки во весь атлас: полный кадр и черновик. */
const VECTOR_PREVIEW_WIDTH = { full: 2048, draft: 1024 };

export { atlasRectWorld };

/**
 * Векторная подложка куска атласа в пикселях — для экспорта плиток, где
 * пиксели нужны сами по себе. Окно берёт картинку из фонового потока
 * (`vectorRunner`). `null` — среда рисовать не умеет (тесты без канвы).
 */
export function renderVectorPixels(source, rect, width, height, sea = null) {
  // Пиксели читаются сразу (`getImageData`): холст — на процессоре, без чтения с видеокарты.
  const canvas = paintVectorCanvas(source, rect, width, height, sea, { cpu: true });
  const context = canvas?.getContext("2d");
  if (!context) return null;
  const image = context.getImageData(0, 0, width, height);
  return { data: image.data, width, height };
}
/** Своя картинка-подложка крупнее этого не обрабатывается: дальше — 8K-атлас. */
const IMAGE_LIMIT = 4096;
/** Своя текстура ужимается до раппорта готовых: крупнее карте не нужно. */
const TEXTURE_LIMIT = 1024;

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === "function")
    return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas) {
  try {
    return canvas?.getContext("2d", { willReadFrequently: true }) || null;
  } catch {
    return null;
  }
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

/**
 * Пиксели картинки по ссылке. `limit` ужимает большую сторону.
 * `null`, когда среда рисовать не умеет (тесты) или картинка не читается.
 */
async function decodePixels(href, limit = 0) {
  if (!href || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(await (await fetch(href)).blob());
    const scale =
      limit > 0
        ? Math.min(1, limit / Math.max(bitmap.width, bitmap.height))
        : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const context = context2d(createCanvas(width, height));
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const image = context.getImageData(0, 0, width, height);
    return { data: image.data, width, height };
  } catch {
    return null;
  }
}

/** Уменьшенная копия пикселей — через канву, с её же сглаживанием. */
function shrinkPixels(pixels, side) {
  const scale = Math.min(1, side / Math.max(pixels.width, pixels.height));
  if (scale >= 1) return pixels;
  const width = Math.max(1, Math.round(pixels.width * scale));
  const height = Math.max(1, Math.round(pixels.height * scale));
  const source = createCanvas(pixels.width, pixels.height);
  const sourceContext = context2d(source);
  const target = context2d(createCanvas(width, height));
  if (!sourceContext || !target) return pixels;
  sourceContext.putImageData(
    new ImageData(pixels.data, pixels.width, pixels.height),
    0,
    0,
  );
  target.imageSmoothingQuality = "high";
  target.drawImage(source, 0, 0, width, height);
  return { data: target.getImageData(0, 0, width, height).data, width, height };
}

const WHOLE_ATLAS = Object.freeze({ u: 0, v: 0, width: 1, height: 1 });

/*
 * Подложка-картинка: своя картинка человека или готовая карта из пака
 * (редизайн 04.10). В окне обе — одна картинка на весь атлас; в игру своя
 * уходит ею же, готовая — своими плитками в родном размере (`exportSource`).
 */
const pictureBase = (base) => base?.source === "image" || base?.source === "template";

/** Байт в две шестнадцатеричные цифры — как их пишет нативный хост. */
const hex2 = (value) => value.toString(16).padStart(2, "0").toUpperCase();

/** Сетка атласа по прямоугольникам плиток: она задаёт пропорцию штата. */
function gridOf(tiles) {
  const rect = tiles.find((tile) => tile?.rect)?.rect;
  if (!rect?.width || !rect?.height)
    return { columns: DEFAULT_ATLAS.columns, rows: DEFAULT_ATLAS.rows };
  return {
    columns: Math.max(1, Math.round(1 / rect.width)),
    rows: Math.max(1, Math.round(1 / rect.height)),
  };
}

const sameRect = (left, right) =>
  left &&
  right &&
  Math.abs(left.u - right.u) < 1e-6 &&
  Math.abs(left.v - right.v) < 1e-6;

/**
 * Подложка одного открытого редактора: распакованные плитки, найденные цвета
 * карты и всё, что из них считается.
 */
export function createMapBaseProcessor(seed = null) {
  /* `seed` — состояние другого обработчика (`fork`): ссылки на то, что он уже распаковал. */
  let tiles = seed?.tiles || [];
  let landTiles = seed?.landTiles || [];
  let picture = seed?.picture || null;
  let pictureHref = seed?.pictureHref || "";
  let grid = seed?.grid || { columns: DEFAULT_ATLAS.columns, rows: DEFAULT_ATLAS.rows };
  /* Цвета карты ищутся отдельно на плитках игры и на своей картинке: смена
     источника подложки не должна оставлять в панели цвета прежней карты. */
  let tileSources = seed?.tileSources || [];
  let pictureSources = seed?.pictureSources || [];
  let field = seed?.field || null;
  let fieldKey = seed?.fieldKey || "";
  let ownTexture = seed?.ownTexture || null;
  let ownTextureHref = seed?.ownTextureHref || "";
  /* Плитки готовой карты из пака: ссылки и места, без пикселей — пиксели
     4096² читаются по одной, когда до плитки дошёл экспорт. */
  let templateTiles = seed?.templateTiles || [];
  /* Геометрия радара игры и атлас, в котором она лежит (Т-159). */
  let geometry = seed?.geometry || null;
  let geometryAtlas = seed?.geometryAtlas || DEFAULT_ATLAS;
  /* Геометрия векторного пака у готовой карты (`pack-geometry.js`). */
  let templateGeometry = seed?.templateGeometry || null;
  /** Рисуется ли подложка векторной: геометрия есть и палитра — не «как есть».
      Готовая карта из векторного пака — всегда вектором, своими цветами. */
  const vectorOn = (base) =>
    base?.source === "template"
      ? Boolean(templateGeometry)
      : Boolean(geometry) &&
        (base?.source === "game" || base?.source === "schematic") &&
        /* Без плиток игры (окно в браузере, геометрия из поставки) рисовать
           больше нечем — только вектором, и «Как в игре» тоже. */
        (baseRendersVector(base) || !tiles.length);
  /*
   * Шаблон вида на векторной готовой карте (ТЗ 05.10, задача 8): пак
   * рисуется по слоям радара (суша, кварталы, дороги, вода —
   * `packRadarGeometry`) палитрой шаблона, а без шаблона — своими цветами.
   * Раскладка по слоям считается раз на геометрию: один и тот же объект
   * уходит в фоновый поток и не пересылается заново.
   */
  const roleGeometries = new WeakMap();
  /* Последняя причина, по которой GPU не нарисовал подложку (для журнала при флаге gpu). */
  let lastGpuReason = "";
  const styledTemplate = () => {
    if (!templateGeometry) return null;
    if (!roleGeometries.has(templateGeometry)) roleGeometries.set(templateGeometry, packRadarGeometry(templateGeometry));
    return roleGeometries.get(templateGeometry);
  };
  const vectorGeometry = (base) =>
    base?.source === "template" ? (base.recolor ? styledTemplate() : templateGeometry) : geometry;
  /*
   * Поколение данных. Распаковка асинхронна, а редактор может закрыться (или,
   * в режиме разработки, React может размонтировать и тут же смонтировать его
   * заново) раньше, чем она кончится: результат прежнего поколения
   * выбрасывается, а сам процессор после `dispose` остаётся годным к работе.
   */
  let generation = 0;

  /** Поле перекраски зависит только от цветов карты — считается раз на карту. */
  const recolorFor = (sources) => {
    const key = sources.map((item) => item.color).join(",");
    if (key !== fieldKey) {
      field = createRecolorField(sources.map((item) => item.color));
      fieldKey = key;
    }
    return { field, sources };
  };

  const detectedFor = (base) =>
    pictureBase(base) ? pictureSources : tileSources;

  const sourcesFor = (base) =>
    applyRoleOverrides(detectedFor(base), base?.roleOverrides);

  const textureFor = (base) => {
    if (!base || base.textureId === "none" || !base.textureOpacity) return null;
    if (base.textureId === "image") return ownTexture;
    return generateMapTexture(base.textureId);
  };

  /* Таблица цвета векторной подложки — только тон и подкраска: цвета ролей
     уже лежат в геометрии. */
  const toneMapFor = (base) => {
    const toned = { ...base, recolor: false };
    return baseColorMapActive(toned, []) ? buildBaseColorMap(toned, null) : null;
  };

  /** Состояние одного прохода: таблица цвета и текстура, общие всем плиткам. */
  const passFor = (base) => {
    const sources = sourcesFor(base);
    return {
      colorMap: vectorOn(base)
        ? toneMapFor(base)
        : baseColorMapActive(base, sources)
          ? buildBaseColorMap(base, base.recolor ? recolorFor(sources) : null)
          : null,
      texture: textureFor(base),
      layer: {
        blend: base.textureBlend,
        opacity: base.textureOpacity,
        scale: base.textureScale,
        color: base.textureColor,
        columns: grid.columns,
        rows: grid.rows,
      },
    };
  };

  const run = (pixels, region, pass) => {
    const data = new Uint8ClampedArray(pixels.data);
    if (pass.colorMap) applyColorMap(data, pass.colorMap);
    if (pass.texture)
      applyTextureLayer(
        data,
        pixels.width,
        pixels.height,
        region,
        pass.texture,
        pass.layer,
      );
    return new ImageData(data, pixels.width, pixels.height);
  };

  const active = (base) => {
    if (!base) return false;
    if (vectorOn(base)) return true;
    if (pictureBase(base) ? !picture : !tiles.length) return false;
    const texture = textureFor(base);
    return baseRasterActive(
      texture ? base : { ...base, textureId: "none" },
      sourcesFor(base),
    );
  };

  /*
   * Плитки игры «как есть» окно тоже показывает одной картинкой (15.10,
   * тестер deo: две тонкие линии через всю карту на 1794 %). Шесть
   * отдельных `<image>` встык браузер рисует каждую со сглаженным краем:
   * когда край плитки падает между точками экрана, обе соседки закрывают
   * эту точку частично, и сквозь стык просвечивает поле под картой — на
   * приближении это линия через весь экран, а дотяжка резкости делает её
   * ещё и светлой каймой. У одной картинки стыка нет. Склейка не зависит
   * от правок — одна на набор плиток, и черновик ей не нужен.
   */
  const stitchOnly = (base) => Boolean(base) && !active(base) && !pictureBase(base) && tiles.length > 1;
  let stitched = null;

  const vectorSource = (base) => ({
    geometry: vectorGeometry(base),
    atlas: geometryAtlas,
    base,
    pass: passFor(base),
  });

  /* Радар карты — `{ pairs, reason }`: пары «было=стало» и, если пар нет,
     почему (`world-map-radar.js`). Пустой ответ без причины — тихо оставленный
     штатный угол экрана, того и не должно быть. */
  const radarReport = (base, palette, { sea } = {}) => {
    const list = Array.isArray(palette) ? palette : [];
    if (!list.length) return { pairs: [], reason: "no-palette" };
    if (vectorOn(base)) {
      /* Тон и подкраска красят и векторную подложку — угол экрана проходит ту
         же таблицу, что и карта паузы. */
      const tone = toneMapFor(base);
      if (base.source === "template" && !base.recolor) {
        /* Готовая векторная карта «как есть» — цвета самого пака, а не проекта. */
        const own = radarFromPack({ palette: list, geometry: templateGeometry, base, sea, colorMap: tone });
        if (own.reason !== "no-table") return own;
        /* У пака нет таблицы элементов — цвета берутся с его склейки, как у картинки. */
        return radarFromPicture({
          palette: list,
          geometry,
          atlas: geometryAtlas,
          picture: picture?.full || null,
          colorMap: tone,
          sea,
        });
      }
      /* Векторная подложка — те же роли, что у радара: угол экрана получает
         ровно цвета карты паузы. */
      if (tone) return radarFromStyle({ palette: list, base, colorMap: tone });
      const pairs = vectorRadarColours(base, list, classifyRadarColour);
      return { pairs, reason: pairs.length ? "" : "unchanged" };
    }
    const sources = sourcesFor(base);
    const map = baseColorMapActive(base, sources)
      ? buildBaseColorMap(base, base.recolor ? recolorFor(sources) : null)
      : null;
    /* Картинка (растровая готовая карта, своя): у неё нет ролей, цвета берутся
       из неё самой под вершинами радара. */
    if (pictureBase(base))
      return radarFromPicture({
        palette: list,
        geometry,
        atlas: geometryAtlas,
        picture: picture?.full || null,
        colorMap: map,
        sea,
      });
    if (!map) return { pairs: [], reason: "unchanged" };
    const pairs = [];
    const pixels = new Uint8ClampedArray(4);
    for (const item of list) {
      const from = String(item?.rgba || "").toUpperCase();
      if (!/^[0-9A-F]{8}$/.test(from)) continue;
      pixels[0] = parseInt(from.slice(0, 2), 16);
      pixels[1] = parseInt(from.slice(2, 4), 16);
      pixels[2] = parseInt(from.slice(4, 6), 16);
      /* Таблица цвета пропускает полностью прозрачные пиксели — вершине
         с нулевой прозрачностью цвет и правда не нужен, но саму пару
         считать всё равно надо: подставляем непрозрачность на время. */
      pixels[3] = 255;
      applyColorMap(pixels, map);
      const to = `${hex2(pixels[0])}${hex2(pixels[1])}${hex2(pixels[2])}${from.slice(6, 8)}`;
      if (to !== from) pairs.push(`${from}=${to}`);
    }
    return { pairs, reason: pairs.length ? "" : "unchanged" };
  };

  const api = {
    /**
     * Геометрия радара игры (`decodeRadarGeometry`) и атлас, в котором она
     * лежит. `null` — векторной подложки нет, работает растр.
     */
    setGeometry(next, atlas = DEFAULT_ATLAS) {
      geometry = next?.groups?.length ? next : null;
      geometryAtlas = normalizeAtlas(atlas);
    },

    /**
     * Готовая карта из пака: плитки `{ row, column, href, rect }` — для
     * экспорта. Окно рисует её склейкой через `loadPicture`.
     */
    setTemplate(next) {
      templateTiles = Array.isArray(next?.tiles) ? next.tiles : [];
    },

    /** Геометрия векторного пака готовой карты; `null` — растр шаблона. */
    setTemplateGeometry(next) {
      templateGeometry = next?.groups?.length ? next : null;
    },

    /** Векторная ли подложка у этой палитры сейчас. */
    vector: vectorOn,

    /**
     * Векторная подложка куска атласа — для приближения в редакторе: кадр
     * рисуется заново в размере экрана, и дороги остаются резкими.
     * @returns {Promise<{href: string, rect: object}|null>}
     */
    async detail(base, rect, width, height) {
      if (!vectorOn(base)) return null;
      const mine = generation;
      /* Переключатель `map-renderer=gpu` (по умолчанию растр): плоский кусок рисует видеокарта, при любом отказе —
         растр ниже, как раньше. */
      /* Всё, что GPU не возьмёт (шаблон, нет геометрии, неподдержанный эффект), объясняет причина в журнале окна. */
      if (mapRendererMode() === "gpu") {
        /* Геометрия та же, что у растра: шаблон — свой пакет радара, игра — радар игры. */
        const result = await perfTimedAsync("map.detail.gpuTime", () => renderBaseDetailGpu({ geometry: vectorGeometry(base), atlas: geometryAtlas, base, colorMap: toneMapFor(base), textured: Boolean(textureFor(base)), rect, width, height, canvasFactory: sharedMapCanvas }));
        if (result.blob) {
          perfCount("map.detail.gpu");
          if (result.bytes) perfValue("map.detail.gpuBytes", result.bytes);
          return mine === generation ? { href: URL.createObjectURL(result.blob), rect } : null;
        }
        /* Растр вместо GPU — не тихо: причину пишем в журнал окна, один раз на каждую новую причину. */
        if (result.reason !== lastGpuReason) {
          lastGpuReason = result.reason;
          console.warn(`[карта] подложка растром: ${result.reason}`);
        }
      }
      /* Рисует фоновый поток: окно в это время отвечает. На процессоре, а не
         на видеокарте: тот же кусок на GPU держал её занятой до 800 мс, и
         карта замирала после каждого сдвига и зума (13.10). */
      /* Оценка памяти растра: слой воды и выходной холст, по четыре байта на точку каждый (не измерено — канва в воркере). */
      perfValue("map.detail.rasterBytesEstimate", width * height * 4 * 2);
      const blob = await perfTimedAsync("map.detail.raster", () => vectorRunner().render(vectorSource(base), rect, width, height, null, { cpu: true }));
      if (!blob || mine !== generation) return null;
      return { href: URL.createObjectURL(blob), rect };
    },

    /**
     * Принимает плитки игры: распаковывает и ищет цвета карты.
     * @returns найденные цвета с ролями (пусто, если среда не умеет рисовать)
     */
    async loadTiles(nextTiles, nextLandTiles = []) {
      const mine = generation;
      const decoded = await Promise.all(
        nextTiles.map(async (tile) => ({
          tile,
          full: await decodePixels(tile.href),
        })),
      );
      const decodedLand = await Promise.all(
        nextLandTiles.map(async (tile) => ({
          tile,
          full: await decodePixels(tile.href),
        })),
      );
      if (mine !== generation) return [];
      tiles = decoded
        .filter((item) => item.full)
        .map((item) => ({
          ...item,
          draft: shrinkPixels(item.full, DRAFT_SIDE),
        }));
      landTiles = decodedLand.filter((item) => item.full);
      grid = gridOf(nextTiles);
      tileSources = tiles.length
        ? detectMapSources({
            base: tiles.map((item) => item.full),
            /* Маска моря — плитка суши того же места атласа. */
            underlay: landTiles.map((item) => ({
              ...item.full,
              mask:
                tiles.find((base) => sameRect(base.tile.rect, item.tile.rect))
                  ?.full || null,
            })),
          })
        : [];
      return tileSources;
    },

    /** Своя картинка-подложка. Цвета карты ищутся и на ней. */
    async loadPicture(href) {
      if (href === pictureHref) return pictureSources;
      const mine = generation;
      pictureHref = href || "";
      const full = href ? await decodePixels(href, IMAGE_LIMIT) : null;
      if (mine !== generation) return [];
      picture = full
        ? { full, draft: shrinkPixels(full, DRAFT_SIDE * 2) }
        : null;
      pictureSources = picture
        ? detectMapSources({ base: [picture.full] })
        : [];
      return pictureSources;
    },

    /** Своя текстура (картинка человека). Пустая ссылка снимает её. */
    async loadTexture(href) {
      if (href === ownTextureHref) return;
      const mine = generation;
      ownTextureHref = href || "";
      const pixels = href ? await decodePixels(href, TEXTURE_LIMIT) : null;
      if (mine !== generation) return;
      ownTexture = pixels ? { ...pixels, kind: "image" } : null;
    },

    /** Найденные цвета карты для текущего источника, с правками ролей. */
    sourcesFor,

    active,

    /**
     * Вся подложка одной картинкой — для окна редактора.
     * @param {"draft"|"full"} quality черновик (ползунок в движении) или
     *   родной размер плиток
     * @returns {Promise<{href: string, quality: string}|null>} `null`, когда
     *   обрабатывать нечего и сцена рисует плитки как есть
     */
    preview(base, quality = "full") {
      return perfTimedAsync(`map.raster.${quality}`, () => api.previewRaw(base, quality));
    },

    async previewRaw(base, quality = "full") {
      const stitch = stitchOnly(base);
      if (!active(base) && !stitch) return null;
      const mine = generation;
      /* Склейка плиток как есть — одна на набор: черновик и полный кадр
         отдают одну и ту же картинку родного размера. */
      if (stitch && stitched?.tiles === tiles)
        return { href: URL.createObjectURL(stitched.blob), quality: "full" };
      const pass = passFor(base);
      const usePicture = pictureBase(base);
      const level = quality === "draft" && !stitch ? "draft" : "full";
      if (vectorOn(base)) {
        const size = atlasSize(geometryAtlas);
        const width = VECTOR_PREVIEW_WIDTH[level];
        const height = Math.round((width * size.height) / size.width);
        /* Весь атлас рисует фоновый поток: смена шаблона больше не
           замораживает окно на полсекунды (жалоба 04.10). */
        const blob = await vectorRunner().render(vectorSource(base), WHOLE_ATLAS, width, height);
        if (!blob || mine !== generation) return null;
        return { href: URL.createObjectURL(blob), quality: level };
      }
      let canvas;
      if (usePicture) {
        const pixels = picture[level];
        canvas = createCanvas(pixels.width, pixels.height);
        context2d(canvas)?.putImageData(run(pixels, WHOLE_ATLAS, pass), 0, 0);
      } else {
        const side = Math.max(
          ...tiles.map((item) =>
            Math.max(item[level].width, item[level].height),
          ),
        );
        canvas = createCanvas(grid.columns * side, grid.rows * side);
        const context = context2d(canvas);
        if (!context) return null;
        const scratch = createCanvas(side, side);
        const scratchContext = context2d(scratch);
        for (const item of tiles) {
          const pixels = item[level];
          const image = run(pixels, item.tile.rect, pass);
          const x = Math.round(item.tile.rect.u * canvas.width);
          const y = Math.round(item.tile.rect.v * canvas.height);
          if (pixels.width === side && pixels.height === side) {
            context.putImageData(image, x, y);
            continue;
          }
          /* Плитка мельче соседей (у чужих карт бывает) — дотягивается. */
          scratchContext.clearRect(0, 0, side, side);
          scratchContext.putImageData(image, 0, 0);
          context.drawImage(
            scratch,
            0,
            0,
            pixels.width,
            pixels.height,
            x,
            y,
            side,
            side,
          );
        }
      }
      if (!canvas) return null;
      const blob = await canvasBlob(canvas);
      if (mine !== generation) return null;
      if (stitch) stitched = { tiles, blob };
      return { href: URL.createObjectURL(blob), quality: level };
    },

    /**
     * Показывает ли окно подложку одной картинкой (`preview`): обработанную
     * или склейку плиток игры как есть — без стыков между плитками.
     */
    windowRaster: (base) => active(base) || stitchOnly(base),

    /**
     * Сырьё для записи в игру: пиксели плиток игрока и проход обработки.
     *
     * Плитки для игры собираются не здесь: карта паузы пишется крупнее плиток
     * игрока (`export.detail`), и обработка каждой — секунды пиксельной
     * работы, которая идёт в фоновом потоке (`world-map-tile-runner.js`).
     * Отсюда уезжает только то, из чего её собрать: пиксели, таблица цвета и
     * описание текстуры. Конвейер при этом тот же, что показывает окно, —
     * `processBaseTile` зовёт те же функции пакета карты в том же порядке.
     *
     * @returns {{tiles: object[], landTiles: object[], pass: object,
     *   picture: {href: string, pixels: object}|null}}
     */
    exportSource(base) {
      const sources = sourcesFor(base);
      const textured = Boolean(textureFor(base));
      const vector = vectorOn(base);
      /*
       * Готовая карта уходит в игру своими плитками в родном размере пака, а
       * не склейкой окна: у паков Akio плитка — 4096 точек, и вдвое ужатая
       * склейка мылилась бы на ближнем приближении. Пиксели — по требованию
       * (`load`): шесть плиток разом — четыреста мегабайт памяти.
       */
      const template =
        base.source === "template" && templateTiles.length
          ? templateTiles.map((item) => ({
              name: `template-${item.row}-${item.column}`,
              href: item.href,
              rect: item.rect,
              load: () => decodePixels(item.href),
            }))
          : null;
      return {
        /* Векторная подложка: плитки рисуются из геометрии в своём размере. */
        vector: vector ? { geometry: vectorGeometry(base), atlas: geometryAtlas, base } : null,
        tiles:
          template ||
          tiles.map((item) => ({
            name: item.tile.name,
            href: item.tile.href,
            rect: item.tile.rect,
            pixels: item.full,
          })),
        /* У паков обе семьи плиток одинаковы: вода уже в картинке, и семье
           радара подкладывается та же плитка. */
        landTiles:
          template ||
          landTiles.map((item) => ({
            name: item.tile.name,
            href: item.tile.href,
            rect: item.tile.rect,
            pixels: item.full,
          })),
        picture:
          base.source === "image" && picture
            ? { href: pictureHref, pixels: picture.full }
            : null,
        pass: {
          colorMap: vector
            ? toneMapFor(base)
            : baseColorMapActive(base, sources)
              ? buildBaseColorMap(base, base.recolor ? recolorFor(sources) : null)
              : null,
          /* Готовая текстура считается в потоке — нужной стороны, под размер
             плитки; своя картинка уезжает пикселями как есть. */
          texture: !textured
            ? null
            : base.textureId === "image"
              ? { pixels: ownTexture }
              : { id: base.textureId },
          layer: {
            blend: base.textureBlend,
            opacity: base.textureOpacity,
            scale: base.textureScale,
            color: base.textureColor,
            columns: grid.columns,
            rows: grid.rows,
          },
        },
      };
    },

    /**
     * Обработанные плитки в родном размере — для выгрузки карты картинкой.
     * Ссылки живут до `release()` результата.
     */
    async exportTiles(base) {
      const pass = passFor(base);
      const urls = [];
      const vector = vectorOn(base);
      const render = async (item) => {
        const canvas = createCanvas(item.full.width, item.full.height);
        const context = context2d(canvas);
        if (!context) return item.tile;
        if (vector) {
          /* Картинкой карту смотрят крупно — плитки рисуются вдвое крупнее. */
          const side = item.full.width * 2;
          const pixels = renderVectorPixels(vectorSource(base), item.tile.rect, side, side);
          canvas.width = side;
          canvas.height = side;
          if (pixels) context.putImageData(new ImageData(pixels.data, side, side), 0, 0);
        } else context.putImageData(run(item.full, item.tile.rect, pass), 0, 0);
        const href = URL.createObjectURL(await canvasBlob(canvas));
        urls.push(href);
        return { ...item.tile, href };
      };
      const result = {
        tiles: await Promise.all(tiles.map(render)),
        landTiles: await Promise.all(landTiles.map(render)),
        picture: null,
        release: () => urls.forEach((href) => URL.revokeObjectURL(href)),
      };
      if (pictureBase(base) && picture) {
        const canvas = createCanvas(picture.full.width, picture.full.height);
        const context = context2d(canvas);
        if (context) {
          context.putImageData(run(picture.full, WHOLE_ATLAS, pass), 0, 0);
          result.picture = URL.createObjectURL(await canvasBlob(canvas));
          urls.push(result.picture);
        }
      }
      return result;
    },

    /**
     * Цвета векторных плиток радара: что игра рисует в углу экрана, пока
     * карта паузы показывает вашу.
     *
     * Мини-карта в углу экрана рисуется не картинкой, а вершинами с цветом:
     * перекрасить её значит перекрасить палитру. Откуда новые цвета — решает
     * подложка: векторная — своя палитра ролей, готовая векторная карта —
     * цвета пака, картинка — цвета под вершинами радара, карта игры с тоном —
     * та же таблица цвета, что и у растровой карты. Текстура и мазки кисти
     * сюда не попадают: они привязаны к месту на карте, а у вершины места в
     * палитре нет.
     *
     * @param {object} base `config.base`
     * @param {{rgba: string}[]} palette цвета из игры игрока (RRGGBBAA)
     * @param {{sea?: string}} [options] `sea` — цвет моря под прозрачными
     *   местами картинки (по умолчанию штатный)
     * @returns {string[]} пары «было=стало», без цветов, оставшихся прежними
     */
    radarColours: (base, palette, options) => radarReport(base, palette, options).pairs,

    /** То же, но с причиной, когда пар нет (`world-map-radar.js`). */
    radarReport,

    /**
     * Свой экземпляр с тем же содержимым — для заявки на установку.
     *
     * Заявка ждёт очереди и рисует плитки позже нажатия, а редактор к тому
     * времени бывает закрыт, и `dispose` обнуляет плитки, геометрию и цвета: карта
     * уезжала в игру БЕЗ подложки (зоны и подписи поверх пустоты), а мини-карта
     * оставалась нерасцвеченной, и в журнале стояло «готово» (04.11.2026). Копия
     * держит ссылки на уже распакованное и от `dispose` оригинала не страдает;
     * освобождать её не надо — она уходит вместе с заявкой.
     */
    fork() {
      return createMapBaseProcessor({
        tiles,
        landTiles,
        picture,
        pictureHref,
        grid,
        tileSources,
        pictureSources,
        field,
        fieldKey,
        ownTexture,
        ownTextureHref,
        templateTiles,
        geometry,
        geometryAtlas,
        templateGeometry,
      });
    },

    dispose() {
      generation += 1;
      templateTiles = [];
      templateGeometry = null;
      geometry = null;
      tiles = [];
      landTiles = [];
      stitched = null;
      picture = null;
      pictureHref = "";
      ownTexture = null;
      ownTextureHref = "";
      tileSources = [];
      pictureSources = [];
      field = null;
      fieldKey = "";
    },
  };
  return api;
}
