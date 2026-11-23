/*
 * Снятие кадра со сцены — для глаз человека и для автоматической проверки.
 *
 * Браузер по умолчанию очищает буфер рисования сразу после показа кадра, и
 * canvas.toDataURL() возвращает пустой прямоугольник. Лечится флагом
 * preserveDrawingBuffer при создании контекста, но контекст создаёт окно
 * превью, а его файл стенду не принадлежит. Поэтому флаг подставляется на
 * входе: getContext перехватывается до первого рендера и дописывает атрибут
 * сам. Живёт правка только на этой странице — приложение её не видит.
 */

const WEBGL_CONTEXTS = new Set(["webgl", "webgl2", "experimental-webgl"]);

let patched = false;

export function keepDrawingBuffer() {
  if (patched) return;
  patched = true;

  const original = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function getContext(
    kind,
    attributes,
  ) {
    if (!WEBGL_CONTEXTS.has(kind)) {
      return original.call(this, kind, attributes);
    }
    return original.call(this, kind, {
      ...(attributes ?? {}),
      preserveDrawingBuffer: true,
    });
  };
}

/* Пустой кадр отличается от чёрного неба тем, что в нём нет ни одного
   непрозрачного пикселя. Проверка нужна, чтобы стенд не выдал за картинку
   стёртый буфер. */
function looksEmpty(canvas) {
  const probe = document.createElement("canvas");
  probe.width = 64;
  probe.height = 64;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(canvas, 0, 0, probe.width, probe.height);
  const { data } = context.getImageData(0, 0, probe.width, probe.height);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 0) return false;
  }
  return true;
}

/* Разброс яркости по кадру. Ноль означает заливку одним цветом — такую
   «сцену» стенд обязан назвать дефектом, а не превью. */
function measure(canvas) {
  const probe = document.createElement("canvas");
  probe.width = 48;
  probe.height = 48;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(canvas, 0, 0, probe.width, probe.height);
  const { data } = context.getImageData(0, 0, probe.width, probe.height);

  let sum = 0;
  let min = 255;
  let max = 0;
  const pixels = data.length / 4;
  for (let index = 0; index < data.length; index += 4) {
    const luma = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    sum += luma;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }

  return {
    mean: Number((sum / pixels).toFixed(2)),
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    spread: Number((max - min).toFixed(2)),
  };
}

export function findSceneCanvas(root) {
  const canvases = Array.from(
    (root ?? document).querySelectorAll("canvas"),
  ).filter((canvas) => canvas.width > 8 && canvas.height > 8);
  if (canvases.length === 0) return null;
  /* Окно превью вправе держать вспомогательные холсты — берём самый крупный,
     он и есть кадр сцены. */
  return canvases.reduce((biggest, candidate) =>
    candidate.width * candidate.height > biggest.width * biggest.height
      ? candidate
      : biggest,
  );
}

/* Кадр вывозят со стенда по узкому каналу, поэтому у снимка есть предел по
   ширине: оценке «похоже на игру» хватает и половинного размера, а целый кадр
   в тот канал не влезает. */
function downscale(canvas, maxWidth, type, quality) {
  const ratio = maxWidth / canvas.width;
  const target = document.createElement("canvas");
  target.width = Math.round(canvas.width * ratio);
  target.height = Math.round(canvas.height * ratio);
  const context = target.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(canvas, 0, 0, target.width, target.height);
  return target.toDataURL(type, quality);
}

/* Качество 1.0, а не 0.92, и это не придирка к весу файла. Гладкий тёмный
   градиент — худший случай для блочного преобразования VP8: на границах
   макроблоков 16 px оно даёт скачок до двенадцати уровней яркости там, где
   настоящий градиент идёт по полуровня на пиксель. Мы дважды приняли эту
   мозаику за дефект рендера и дважды отчитались о несуществующей поломке,
   пока замер не показал, что PNG и webp 1.0 совпадают с фреймбуфером
   побитово, а расходится только 0.92. Кадр тяжелеет с 15 КБ до 97 КБ — за
   право верить тому, что видишь, это дёшево. */
export function captureFrame(
  root,
  { type = "image/webp", quality = 1, maxWidth = 0 } = {},
) {
  const canvas = findSceneCanvas(root);
  if (!canvas) return { ok: false, reason: "холст сцены не найден" };

  const dataUrl =
    maxWidth > 0 && canvas.width > maxWidth
      ? downscale(canvas, maxWidth, type, quality)
      : canvas.toDataURL(type, quality);
  return {
    ok: true,
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    empty: looksEmpty(canvas),
    stats: measure(canvas),
  };
}
