// Векторная подложка большой карты в холст: одна функция для окна и для
// фонового потока. Холст по умолчанию — без willReadFrequently (рисует видеокарта);
// пиксели читаются, только когда без них не обойтись (тон, подкраска, текстура).
import {
  applyTextureLayer,
  applyColorMap,
  paintVectorBase,
  normalizeAtlas,
  atlasSize,
  DEFAULT_ATLAS,
} from "@modovik/vector-map";

// Сколько геометрий держит фоновый поток: смена игры не копит их в памяти.
const VECTOR_GEOMETRY_KEEP = 2;

const attempt = (job, otherwise = undefined) => {
  try {
    return job();
  } catch {
    return otherwise;
  }
};

const when = (condition, action) => (condition ? action() : undefined);

// Координата края: начало + знак * (доля) * размер атласа по оси.
const edge = (origin, sign, share, size) => origin + sign * share * size;

// Мировой прямоугольник куска атласа. Ось v растёт вниз, мировая y — вверх.
const atlasRectWorld = (rect, atlas = DEFAULT_ATLAS) => {
  const frame = normalizeAtlas(atlas);
  const { width: spanX, height: spanY } = atlasSize(frame);
  const { originX, originY } = frame;
  return {
    x0: edge(originX, 1, rect.u, spanX),
    y0: edge(originY, -1, rect.v, spanY),
    x1: edge(originX, 1, rect.u + rect.width, spanX),
    y1: edge(originY, -1, rect.v + rect.height, spanY),
  };
};

const blankCanvas = (width, height) => {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  return typeof document === "undefined"
    ? null
    : Object.assign(document.createElement("canvas"), { width, height });
};

const createVectorCanvas = (width, height, { cpu = false } = {}) => {
  const canvas = blankCanvas(width, height);
  // Первый запрос контекста задаёт признак: холст рисуется на процессоре.
  // Если контекст уже взят иначе — рисуется как рисуется.
  when(cpu, () => attempt(() => canvas?.getContext("2d", { willReadFrequently: true })));
  return canvas;
};

const contextOf = (canvas) => attempt(() => canvas.getContext("2d"), null);

// Море подкладывается под уже нарисованное.
const fillSeaBehind = (context, sea, { width, height }) => {
  context.save();
  Object.assign(context, { globalCompositeOperation: "destination-over", fillStyle: sea });
  context.fillRect(0, 0, width, height);
  context.restore();
};

// Проход по пикселям: таблица цвета и/или текстура, одним чтением и одной записью.
const pixelPass = (context, pass, rect, { width, height }) => {
  const image = context.getImageData(0, 0, width, height);
  const steps = [
    [pass.colorMap, () => applyColorMap(image.data, pass.colorMap)],
    [
      pass.texture,
      () => applyTextureLayer(image.data, width, height, rect, pass.texture, pass.layer),
    ],
  ];
  steps.filter(([wanted]) => wanted).forEach(([, run]) => run());
  context.putImageData(image, 0, 0);
};

const paintVectorCanvas = (
  { geometry, atlas, base, pass },
  rect,
  width,
  height,
  sea = null,
  { cpu = false } = {},
) => {
  const canvas = createVectorCanvas(width, height, { cpu });
  const context = contextOf(canvas);
  if (!(context && geometry)) return null;

  const size = { width, height };
  paintVectorBase(context, geometry, {
    world: atlasRectWorld(rect, atlas),
    width,
    height,
    base,
    createCanvas: (layerWidth, layerHeight) => createVectorCanvas(layerWidth, layerHeight, { cpu }),
  });
  when(sea, () => fillSeaBehind(context, sea, size));
  when(pass?.colorMap || pass?.texture, () => pixelPass(context, pass, rect, size));
  return canvas;
};

const canvasBlob = async (canvas) =>
  typeof canvas.convertToBlob === "function"
    ? canvas.convertToBlob({ type: "image/png" })
    : new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Канва не отдала PNG"));
        }, "image/png");
      });

export {
  VECTOR_GEOMETRY_KEEP,
  atlasRectWorld,
  canvasBlob,
  createVectorCanvas,
  paintVectorCanvas,
};
