const ENGINE_ROOT = "/ocr/";
const PNG = "image/png";
const WORD_LEVEL = "5";
const MAX_THREADS = 4;

// Свой объект параметров на каждый поток.
const engineOptions = () => ({
  workerPath: `${ENGINE_ROOT}worker.min.js`,
  corePath: `${ENGINE_ROOT}tesseract-core-simd-lstm.wasm.js`,
  langPath: `${ENGINE_ROOT}lang`,
  gzip: true,
});

// Строки TSV уровня «слово»: двенадцать ячеек и непустой текст в последней.
function* wordRows(tsv) {
  for (const line of String(tsv || "").split("\n")) {
    const cells = line.split("\t");
    if (cells.length >= 12 && cells[0] === WORD_LEVEL && cells[11].trim() !== "") yield cells;
  }
}

function meanConf(words) {
  if (words.length === 0) return -1;
  let sum = 0;
  for (const { conf } of words) sum += conf;
  return sum / words.length;
}

export function wordsFromTsv(tsv) {
  const wordOf = (cells) => ({ text: cells[11], conf: Number(cells[10]) });
  const words = Array.from(wordRows(tsv), wordOf);
  return {
    words,
    text: Array.from(words, (word) => word.text).join(" "),
    mean: meanConf(words),
  };
}

// Ядер без одного, но от одного до четырёх потоков.
const threadCount = () => {
  const hardware = globalThis.navigator?.hardwareConcurrency;
  const spare = (Number(hardware) || 2) - 1;
  return Math.floor(Math.min(Math.max(spare, 1), MAX_THREADS));
};

function pickApi(engine) {
  const usable = Boolean(engine) && Boolean(engine.default || engine.createWorker);
  if (!usable) throw new Error("OCR нет в этой сборке: tesseract.js не установлен.");
  return engine.default || engine;
}

async function bootThread(createWorker, langs) {
  const worker = await createWorker(langs.split("+"), 1, engineOptions());
  await worker.setParameters({ tessedit_pageseg_mode: "7" });
  return worker;
}

// Набор потоков одного языка за одним планировщиком.
async function openPool(load, langs) {
  const { createScheduler, createWorker } = pickApi(await load());
  const scheduler = createScheduler();
  const starting = [...Array(threadCount()).keys()].map(() => bootThread(createWorker, langs));
  const threads = await Promise.all(starting);
  for (const worker of threads) scheduler.addWorker(worker);
  return scheduler;
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== "function") {
    const sheet = document.createElement("canvas");
    sheet.width = width;
    sheet.height = height;
    return sheet;
  }
  return new OffscreenCanvas(width, height);
}

// Серый растр (0 — буква) в каналы RGB; запись в Uint8ClampedArray сама срезает значения.
function paintGrey(rgba, pixels, data) {
  rgba.fill(255);
  for (let at = 0; at < pixels; at++) {
    const o = at * 4;
    rgba[o] = rgba[o + 1] = rgba[o + 2] = data[at];
  }
}

function encodePng(canvas) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: PNG });
  return new Promise((resolve) => canvas.toBlob(resolve, PNG));
}

async function rasterToPng({ width, height, data }) {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  paintGrey(image.data, width * height, data);
  context.putImageData(image, 0, 0);
  return encodePng(canvas);
}

async function readJob(scheduler, job) {
  const png = await rasterToPng(job);
  const { data } = await scheduler.addJob("recognize", png, {}, { text: false, tsv: true });
  const tsv = typeof data?.tsv === "string" ? data.tsv : "";
  return [job.id, wordsFromTsv(tsv)];
}

// Пулы по языкам; отказ загрузки тоже запоминается до закрытия.
class PoolBook {
  constructor(load) {
    this.load = load;
    this.pools = new Map();
  }

  open(langs) {
    if (!this.pools.has(langs)) this.pools.set(langs, openPool(this.load, langs));
    return this.pools.get(langs);
  }

  async closeAll() {
    const closing = [];
    for (const pool of this.pools.values()) {
      closing.push(pool.then((scheduler) => scheduler.terminate()));
    }
    this.pools.clear();
    await Promise.allSettled(closing);
  }
}

export const createPackOcr = ({ load = () => import("tesseract.js") } = {}) => {
  const book = new PoolBook(load);
  return {
    async recognize(jobs, { langs = "rus", onJob = null } = {}) {
      if (!jobs.length) return new Map();
      const scheduler = await book.open(langs);
      const found = new Map();
      const reads = jobs.map((job) =>
        readJob(scheduler, job).then(([id, words]) => {
          found.set(id, words);
          if (onJob !== null) onJob();
        }),
      );
      await Promise.all(reads);
      return found;
    },
    terminate: () => book.closeAll(),
  };
};
