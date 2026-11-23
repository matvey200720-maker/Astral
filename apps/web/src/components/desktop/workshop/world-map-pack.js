// «Взять карту из пака»: плитки архива большой карты склеиваются в один PNG,
// который становится подложкой проекта. Из пака берутся только плитки.
import { tr } from "../../../locales/ui.js";
import { unzipSync, inflateSync } from "fflate";
import { stitchMapPack, readMapPack, describeMapPack } from "@modovik/vector-map";
import { mapText as fillTemplate } from "./world-map/map-copy.js";

const MAP_PACK_ACCEPT = ".zip,application/zip";
const MAP_PACK_NAME = /\.zip$/i;
const PACK_COPY_NOTE =
  "Картинка — копия плиток вашего пака, она живёт в вашем проекте. В поставку Astral чужие карты не входят.";

const ARCHIVE_LIMIT = 512 * 1024 * 1024;
const EXTENSION = /\.[^.]+$/;
const MOSAIC_LAYOUT = Object.freeze({ rows: 3, columns: 2 });

const STRETCH_NOTE =
  "Плитки пака лежат {columns} × {rows}, а карта Astral — 2 × 3: подложка вышла растянутой. Лучше взять пак с шестью плитками.";

const failure = (text) => new Error(text);

const attempt = (job, otherwise = undefined) => {
  try {
    return job();
  } catch {
    return otherwise;
  }
};

// Имена файлов из центрального каталога zip: распаковка не нужна (фильтр всё отбрасывает).
const namesInArchive = (zipBytes) => {
  const names = [];
  unzipSync(zipBytes, {
    filter: ({ name }) => {
      names.push(name);
      return false;
    },
  });
  return names;
};

const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const pngCanvas = (width, height) => {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
};

const requireContext = (canvas) => {
  const context = canvas.getContext("2d");
  if (!context) throw failure(tr("Окно не умеет рисовать картинку."));
  return context;
};

const encodePng = (canvas) =>
  typeof canvas.convertToBlob === "function"
    ? canvas.convertToBlob({ type: "image/png" })
    : new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

const encodeChecked = async (canvas) => {
  const blob = await encodePng(canvas);
  if (!blob) throw failure(tr("Картинка не сохранена."));
  return blob;
};

const asFile = (blob, name) => {
  if (typeof File !== "function") return Object.assign(blob, { name });
  return new File([blob], name, { type: "image/png" });
};

const writePng = async (width, height, rgba, name) => {
  const canvas = pngCanvas(width, height);
  requireContext(canvas).putImageData(new ImageData(rgba, width, height), 0, 0);
  return asFile(await encodeChecked(canvas), name);
};

const DEFAULT_STEPS = Object.freeze({
  unzip: unzipSync,
  inflateRaw: (bytes) => inflateSync(bytes),
  stitch: stitchMapPack,
  toPng: writePng,
  side: 1024,
  yieldToUi: pause,
});

// Только заданные (не undefined) параметры перекрывают умолчания.
const definedOnly = (options) =>
  Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));

const readPack = (bytes, unzip) => {
  const pack = attempt(() => readMapPack(bytes, { unzip, list: namesInArchive }), null);
  if (!pack) throw failure(tr("Архив не читается — нужен zip с картой."));
  return pack;
};

// Предупреждение о растяжении, если плитки лежат не 2 × 3.
const stretchNotes = ({ rows, columns }) =>
  rows === MOSAIC_LAYOUT.rows && columns === MOSAIC_LAYOUT.columns
    ? []
    : [fillTemplate(STRETCH_NOTE, { columns, rows })];

const describeLayout = (pack, mosaic) => [
  ...describeMapPack(pack, { side: mosaic.sourceSide }),
  ...stretchNotes(mosaic),
];

const resultName = (file) => `${String(file.name || tr("пак")).replace(EXTENSION, "")}.png`;

const importMapPack = async (file, options = {}) => {
  const steps = { ...DEFAULT_STEPS, ...definedOnly(options) };

  if (Number(file?.size || 0) > ARCHIVE_LIMIT) {
    throw failure(tr("Архив больше 512 МБ — для карты это слишком много."));
  }
  const pack = readPack(new Uint8Array(await file.arrayBuffer()), steps.unzip);
  if (pack.tiles.length === 0) {
    throw failure(tr("В архиве нет плиток карты — это не пак большой карты."));
  }

  await steps.yieldToUi();
  const mosaic = steps.stitch(pack, { inflateRaw: steps.inflateRaw, side: steps.side });
  const lines = describeLayout(pack, mosaic);
  const name = resultName(file);
  const picture = await steps.toPng(mosaic.width, mosaic.height, mosaic.rgba, name);
  return { file: picture, lines, mosaic };
};

export { MAP_PACK_ACCEPT, MAP_PACK_NAME, PACK_COPY_NOTE, importMapPack };
