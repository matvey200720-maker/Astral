/*
 * DDS в чужой раскладке: размер, формат и число mip-уровней.
 *
 * Нужен дважды: заявка эффектов приводит текстуру автора к слоту (кадр листа
 * следа — на всю текстуру), а установщик ядра игрока приводит слой текстуры к
 * раскладке той же текстуры в ядре игрока (кровь редукса 1024×1024 на штатные
 * 512×512). Сжатие — в пуле тяжёлой работы.
 */
import { decodeDds, resample } from "@modovik/dds";
import { encodeDdsPooled } from "./dds-pool.js";

/**
 * Один кадр листа: клетка сетки верхнего уровня текстуры.
 */
function sheetFrame(level, { columns, rows, frame }) {
  const width = Math.floor(level.width / columns);
  const height = Math.floor(level.height / rows);
  if (!width || !height) {
    throw new RangeError(
      `Текстура ${level.width}×${level.height} меньше сетки ${columns}×${rows}.`,
    );
  }
  const left = (frame % columns) * width;
  const top = Math.floor(frame / columns) * height;
  const rgba = new level.rgba.constructor(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((top + y) * level.width + left) * 4;
    rgba.set(level.rgba.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, rgba };
}

/**
 * Текстура в раскладке слота: размер, формат и число mip-уровней.
 *
 * Совпадающая раскладка возвращается как есть — пересжатие без нужды только
 * портит картинку. Иначе верхний уровень пересчитывается под слот и
 * кодируется заново: слот ядра жёсткий, «на один mip меньше» — это отказ
 * патча, а не мелочь.
 *
 * `frame` — кадр листа, который слот рисует целиком: из листа в слот едет
 * только он, растянутый на всю текстуру.
 */
export async function fitDdsLayout(bytes, layout, { frame = null } = {}) {
  const decoded = decodeDds(bytes);
  if (
    !frame &&
    decoded.width === layout.width &&
    decoded.height === layout.height &&
    decoded.format === layout.format &&
    decoded.mipLevels === layout.mipLevels
  )
    return bytes;
  const top = frame ? sheetFrame(decoded.levels[0], frame) : decoded.levels[0];
  return encodeDdsPooled({
    width: layout.width,
    height: layout.height,
    format: layout.format,
    mipLevels: layout.mipLevels,
    rgba: resample(
      top.rgba,
      top.width,
      top.height,
      layout.width,
      layout.height,
    ),
  });
}

