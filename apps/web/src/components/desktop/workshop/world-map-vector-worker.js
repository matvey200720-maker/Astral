// Фоновый поток векторной подложки большой карты. Геометрия приезжает один раз
// (сообщение geometry) и живёт под ключом; дальше на каждое задание (render)
// едут палитра и кусок атласа, а обратно — готовый PNG.
import {
  VECTOR_GEOMETRY_KEEP,
  canvasBlob as encodePng,
  paintVectorCanvas,
} from "./world-map-vector-render.js";

// Полка геометрий: порядок вставки задаёт, кого вытеснять первым.
class Shelf {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = new Map();
  }

  put(key, geometry) {
    this.reinsert(key, geometry);
    const surplus = Math.max(0, this.items.size - this.capacity);
    [...this.items.keys()].slice(0, surplus).forEach((oldKey) => this.items.delete(oldKey));
  }

  // Повторная отправка того же ключа освежает его: запись уходит в конец очереди.
  reinsert(key, geometry) {
    this.items.delete(key);
    this.items.set(key, geometry);
  }

  take(key) {
    return this.items.get(key);
  }
}

const shelf = new Shelf(VECTOR_GEOMETRY_KEEP);

const lackOfGeometry = () => {
  throw new Error("Геометрия карты в поток не приехала.");
};

// Аргументы рисования из задания: источник, кусок, размер, море, настройки процессора.
const paintArguments = (job, geometry) => [
  { geometry, atlas: job.atlas, base: job.base, pass: job.pass },
  job.rect,
  job.width,
  job.height,
  job.sea,
  { cpu: Boolean(job.cpu) },
];

const drawJob = async (job) => {
  const geometry = shelf.take(job.key) || lackOfGeometry();
  const canvas = paintVectorCanvas(...paintArguments(job, geometry));
  return canvas === null ? null : encodePng(canvas);
};

const answerRender = async ({ id, job }) => {
  await drawJob(job)
    .then((blob) => self.postMessage({ id, blob }))
    .catch((error) => self.postMessage({ id, error: error?.message || String(error) }));
};

// Тип сообщения сравнивается как есть (без приведения): ["render"] — не "render".
const ROUTES = [
  ["geometry", async ({ key, geometry }) => shelf.put(key, geometry)],
  ["render", answerRender],
];

self.onmessage = async (event) => {
  const message = event.data || {};
  const route = ROUTES.find(([type]) => type === message.type);
  if (route) return route[1](message);
  return self.postMessage({
    id: message.id,
    error: `Неизвестное задание потока подложки: ${message.type}`,
  });
};
