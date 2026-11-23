/*
 * Формы оболочек для кадра редактора.
 *
 * Файлы `/assets/workshop/wallbang/<id>.bin` сняты с моделей мода
 * (`scripts/prepare-wallbang-resources.mjs`): треугольники шейдера
 * подсветки, вершины сварены по положению, координаты — 16-битные доли
 * рамки, всё сжато zlib. Это те самые сетки, что встанут в игру, — кадр
 * показывает настоящую форму подсветки, а не похожую.
 *
 *   "AWB1" · u32 версия · u32 вершин · u32 индексов · f32×3 min · f32×3 max
 *   i16×3 × вершины (выровнено до 4 байт) · u16 × индексы
 *
 * Форма грузится один раз за жизнь окна: кадр, плитки, готовые наборы и
 * обложка берут её из одного кэша.
 */

import { unzlibSync } from "fflate";

const SHAPE_ROOT = "/assets/workshop/wallbang";
const MAGIC = "AWB1";
const HEADER = 40;

const cache = new Map();

/** Разбор файла формы. Бросает на чужом или обрезанном файле. */
export function decodeWallbangShape(input) {
  const packed = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bytes = unzlibSync(packed);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== MAGIC || view.getUint32(4, true) !== 1)
    throw new Error("Файл формы укрытия — не AWB1.");
  const vertexCount = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const min = [0, 1, 2].map((axis) => view.getFloat32(16 + axis * 4, true));
  const max = [0, 1, 2].map((axis) => view.getFloat32(28 + axis * 4, true));
  const vertexBytes = Math.ceil((vertexCount * 6) / 4) * 4;
  if (
    indexCount % 3 !== 0 ||
    HEADER + vertexBytes + indexCount * 2 > bytes.length
  )
    throw new Error("Файл формы укрытия обрезан.");
  const positions = new Float32Array(vertexCount * 3);
  for (let at = 0; at < vertexCount * 3; at += 1) {
    const axis = at % 3;
    const share = (view.getInt16(HEADER + at * 2, true) + 32768) / 65535;
    positions[at] = min[axis] + share * (max[axis] - min[axis]);
  }
  const indices = new Uint16Array(indexCount);
  for (let at = 0; at < indexCount; at += 1) {
    const index = view.getUint16(HEADER + vertexBytes + at * 2, true);
    if (index >= vertexCount) throw new Error("Индекс вершины вне формы.");
    indices[at] = index;
  }
  return { positions, indices, min, max, vertexCount, indexCount };
}

/** Форма укрытия по id (обещание из кэша окна). */
export function loadWallbangShape(id, { fetchImpl = globalThis.fetch } = {}) {
  if (!cache.has(id))
    cache.set(
      id,
      Promise.resolve()
        .then(() => fetchImpl(`${SHAPE_ROOT}/${id}.bin`))
        .then((response) => {
          if (!response.ok)
            throw new Error(
              `Форма укрытия «${id}» не загрузилась (${response.status}).`,
            );
          return response.arrayBuffer();
        })
        .then((buffer) => decodeWallbangShape(new Uint8Array(buffer)))
        .catch((error) => {
          /* Неудача не остаётся в кэше: следующая попытка — заново. */
          cache.delete(id);
          throw error;
        }),
    );
  return cache.get(id);
}

/** Несколько форм разом → `Map(id → форма)`; не загрузившиеся пропускаются. */
export async function loadWallbangShapes(ids, options) {
  const entries = await Promise.all(
    ids.map((id) =>
      loadWallbangShape(id, options).then(
        (shape) => [id, shape],
        () => null,
      ),
    ),
  );
  return new Map(entries.filter(Boolean));
}

/* Для тестов: кэш окна живёт весь сеанс, тестам нужен чистый. */
export function forgetWallbangShapes() {
  cache.clear();
}
