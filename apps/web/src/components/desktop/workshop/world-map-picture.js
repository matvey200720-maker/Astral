// Подготовка картинки человека для большой карты: GIF узнаётся по байтам,
// GIF/BMP/AVIF переводятся в PNG (для GIF берётся первый кадр).
import { tr } from "../../../locales/ui.js";

const MAP_PICTURE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml";
const PICTURE_EXTENSIONS = ["png", "jpe?g", "webp", "svg", "gif", "bmp", "avif"];
const MAP_PICTURE_NAME = new RegExp(`\\.(${PICTURE_EXTENSIONS.join("|")})$`, "i");
const GIF_NOTE = "GIF в игре не двигается: на карту ложится его первый кадр.";

const GIF_SIGNATURES = Object.freeze(["GIF87a", "GIF89a"]);
const NEEDS_CONVERSION = /\.(bmp|avif)$/;
const LAST_EXTENSION = /\.[^.]+$/;

const raise = (text) => {
  throw new Error(text);
};

const lettersOf = (buffer) => String.fromCharCode(...new Uint8Array(buffer).slice(0, 6));

// Читаются только первые шесть байт; любая ошибка — «не GIF».
const isGifFile = async (file) => {
  const head = await new Promise((resolve) => resolve(file.slice(0, 6).arrayBuffer()))
    .then(lettersOf)
    .catch(() => "");
  return GIF_SIGNATURES.includes(head);
};

const readWithBrowser = (file) =>
  typeof createImageBitmap === "function"
    ? createImageBitmap(file, { imageOrientation: "from-image" })
    : raise(tr("Окно не умеет читать картинку."));

const encodePng = (canvas) =>
  typeof canvas.convertToBlob === "function"
    ? canvas.convertToBlob({ type: "image/png" })
    : new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error(tr("Кадр не сохранён.")));
        }, "image/png");
      });

// Холст нужного размера: OffscreenCanvas, а без него холст документа.
const CANVAS_MAKERS = [
  {
    usable: () => typeof OffscreenCanvas === "function",
    make: (width, height) => new OffscreenCanvas(width, height),
  },
  {
    usable: () => true,
    make: (width, height) => Object.assign(document.createElement("canvas"), { width, height }),
  },
];

const newCanvas = (width, height) =>
  CANVAS_MAKERS.find((maker) => maker.usable()).make(width, height);

const paintToPng = async (width, height, draw) => {
  const canvas = newCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return raise(tr("Окно не умеет рисовать картинку."));
  draw(context);
  return encodePng(canvas);
};

const wrapAsFile = (blob, name) => {
  if (typeof File !== "function") return Object.assign(blob, { name });
  return new File([blob], name, { type: "image/png" });
};

// Результат под именем исходного файла: без расширения (если после точки есть знаки), плюс .png.
const namedPng = (blob, file) => {
  const stem = String(file.name || tr("картинка")).replace(LAST_EXTENSION, "");
  return wrapAsFile(blob, `${stem || tr("картинка")}.png`);
};

// Картинка закрывается в любом исходе: и после успеха, и после отказа рисования.
const pictureAsPng = async (file, { decode = readWithBrowser, render = paintToPng } = {}) => {
  const bitmap = await decode(file);
  const painted = new Promise((resolve) => {
    resolve(render(bitmap.width, bitmap.height, (context) => context.drawImage(bitmap, 0, 0)));
  });
  return painted.then((blob) => namedPng(blob, file)).finally(() => bitmap.close?.());
};

const wantsPng = (file, gif) =>
  gif || NEEDS_CONVERSION.test(String(file?.name || "").toLowerCase());

const prepareMapPicture = async (file, options = {}) => {
  const gif = await isGifFile(file);
  if (!wantsPng(file, gif)) return { file, gif: false };
  return pictureAsPng(file, options).then(
    (converted) => ({ file: converted, gif }),
    (cause) => {
      const text = gif
        ? tr("Не удалось взять первый кадр GIF — сохраните его PNG и загрузите ещё раз.")
        : tr("Картинка не читается: формат не поддерживается — сохраните её PNG или JPG.");
      throw new Error(text, { cause });
    },
  );
};

export {
  GIF_NOTE,
  MAP_PICTURE_ACCEPT,
  MAP_PICTURE_NAME,
  isGifFile,
  pictureAsPng,
  prepareMapPicture,
};
