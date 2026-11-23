/*
 * Пиксельная работа над плиткой большой карты.
 *
 * Две операции, и обе тяжёлые: плитка карты паузы в 4096 точек — это
 * шестьдесят мегабайт пикселей, которые надо увеличить, перекрасить, покрыть
 * текстурой, а потом сжать в DDS с цепочкой уменьшенных копий. На шесть плиток
 * уходит полминуты, и в потоке окна это полминуты замершего интерфейса.
 * Поэтому функции здесь чистые — массивы на входе, массивы на выходе, ни
 * канвы, ни DOM — и одинаково работают и в фоновом потоке
 * (`world-map-tile-worker.js`), и прямо в окне, где потока нет.
 *
 * Сам конвейер живёт в пакете карты; здесь только его порядок для одной
 * плитки: увеличение → таблица цвета → текстура.
 */

import {
  MAP_TEXTURE_SIDE,
  applyColorMap,
  applyTextureLayer,
  encodeDds,
  generateMapTexture,
  upscaleMapPixels,
} from "@modovik/vector-map";

/** Готовая текстура крупнее этого не считается: дальше растёт только время. */
const TEXTURE_SIDE_LIMIT = 2048;

/**
 * Сторона готовой текстуры под размер карты.
 *
 * Текстура нужна такой, чтобы её точка приходилась примерно на точку карты:
 * мельче — рисунок мылится на увеличенных плитках, крупнее — уменьшается
 * обратно и только тратит время. `pixelsPerRepeat` — сколько точек карты
 * занимает один раппорт.
 */
export function textureSideFor(pixelsPerRepeat) {
  let side = MAP_TEXTURE_SIDE;
  while (side < TEXTURE_SIDE_LIMIT && side * Math.SQRT2 < pixelsPerRepeat)
    side *= 2;
  return side;
}

/** Текстура по описанию: готовая — по имени и стороне, своя — пикселями. */
function resolveTexture(texture) {
  if (!texture) return null;
  if (texture.data) return texture;
  return generateMapTexture(texture.id, texture.side || MAP_TEXTURE_SIDE);
}

/**
 * Обработанная подложка одной плитки.
 *
 * @param {object} job
 * @param {{data: Uint8ClampedArray, width: number, height: number}} job.pixels
 *   плитка игрока
 * @param {number} job.factor во сколько раз плитка растёт
 * @param {{side: number, data: Uint8Array}|null} job.colorMap таблица цвета
 * @param {object|null} job.texture описание текстуры (`resolveTexture`)
 * @param {{u:number,v:number,width:number,height:number}} job.region место
 *   плитки на атласе
 * @param {object} job.layer наложение текстуры (`applyTextureLayer`)
 */
export function processBaseTile(job) {
  const scaled = upscaleMapPixels(job.pixels, job.factor || 1);
  if (job.colorMap) applyColorMap(scaled.data, job.colorMap);
  const texture = resolveTexture(job.texture);
  if (texture)
    applyTextureLayer(
      scaled.data,
      scaled.width,
      scaled.height,
      job.region,
      texture,
      job.layer,
    );
  return scaled;
}

const toBase64 = (bytes) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};

/** Плитка, сжатая так, как её ждёт игра, — строкой base64 для главного процесса. */
export function encodeTile(job) {
  return toBase64(
    encodeDds(job.data, job.width, job.height, {
      format: job.format,
      mipmaps: job.mipmaps,
    }),
  );
}
