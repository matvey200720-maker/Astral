import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const nodeRequire = createRequire(import.meta.url);

const ROUTE = "/ocr";
const MISSING_ID = "\0astral-ocr-missing";
const MISSING_SOURCE = "export default null;";
const CACHE_CONTROL = "public, max-age=86400";
const FALLBACK_TYPE = "application/octet-stream";
const TYPE_BY_SUFFIX = [
  [".js", "text/javascript"],
  [".gz", "application/gzip"],
];

// [адрес после /ocr/, пакет, путь внутри пакета]; порядок — порядок отдачи в сборке
const OCR_SOURCES = [
  ["worker.min.js", "tesseract.js", "dist/worker.min.js"],
  ["tesseract-core-simd-lstm.wasm.js", "tesseract.js-core", "tesseract-core-simd-lstm.wasm.js"],
  ["lang/rus.traineddata.gz", "@tesseract.js-data/rus", "4.0.0_best_int/rus.traineddata.gz"],
  ["lang/eng.traineddata.gz", "@tesseract.js-data/eng", "4.0.0_best_int/eng.traineddata.gz"],
];

// Поиск пакета — при каждом вызове: Node ищет его package.json от места этого файла.
const locatorFor = (pkg, inner) => () => join(dirname(nodeRequire.resolve(`${pkg}/package.json`)), inner);

export const OCR_FILES = Object.freeze(
  OCR_SOURCES.reduce((files, [name, pkg, inner]) => ({ ...files, [name]: locatorFor(pkg, inner) }), {}),
);

function isLocatable(locate) {
  try {
    locate();
    return true;
  } catch {
    return false;
  }
}

const everyPackageInstalled = () => Object.values(OCR_FILES).every(isLocatable);

const contentTypeOf = (name) =>
  TYPE_BY_SUFFIX.find(([suffix]) => name.endsWith(suffix))?.[1] ?? FALLBACK_TYPE;

// Имя файла из адреса запроса, уже без префикса /ocr (его срезает Connect).
function requestedName(url) {
  const withoutQuery = (url || "/").replace(/\?.*$/s, "");
  const decoded = decodeURIComponent(withoutQuery);
  let start = 0;
  while (decoded[start] === "/") start += 1;
  return decoded.slice(start);
}

function respondWithFile(response, name, locate) {
  response.statusCode = 200;
  const headers = [
    ["Content-Type", contentTypeOf(name)],
    ["Cache-Control", CACHE_CONTROL],
  ];
  headers.forEach(([header, value]) => response.setHeader(header, value));
  response.end(readFileSync(locate()));
}

function createMiddleware(files) {
  return function ocrMiddleware(request, response, next) {
    const name = requestedName(request.url);
    // прямое обращение по ключу: унаследованные свойства объекта тоже «находятся»
    const locate = files[name];
    if (locate) {
      respondWithFile(response, name, locate);
    } else {
      next();
    }
  };
}

function* bundledAssets() {
  for (const [name, locate] of Object.entries(OCR_FILES)) {
    yield { type: "asset", fileName: `ocr/${name}`, source: readFileSync(locate()) };
  }
}

// Пока tesseract.js не установлен, его подключение заменяется пустым модулем.
function moduleHooks(installed) {
  return {
    resolveId(source) {
      if (installed || source !== "tesseract.js") return null;
      return MISSING_ID;
    },
    load(id) {
      if (id !== MISSING_ID) return null;
      return MISSING_SOURCE;
    },
  };
}

function assetHooks(installed) {
  return {
    configureServer(server) {
      if (installed) server.middlewares.use(ROUTE, createMiddleware(OCR_FILES));
    },
    generateBundle() {
      if (!installed) return;
      for (const asset of bundledAssets()) this.emitFile(asset);
    },
  };
}

export function astralOcrAssets() {
  const installed = everyPackageInstalled();
  return Object.assign({ name: "astral-ocr-assets" }, moduleHooks(installed), assetHooks(installed));
}
