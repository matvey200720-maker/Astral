/*
 * Поток разбора разметки выделения (`selection-markup-load.js`, ТЗ 26.10.2026, раздел D: «парсинг файла — в потоке»).
 * Снятие сжатия и построение таблиц поиска (`decodeSelmapParts`) идут здесь; плоские таблицы уходят окну без копии
 * (`SelectionMap.fromParts` в окне ничего не пересчитывает).
 */

import { unzlibSync } from "fflate";
import { decodeSelmapParts, transferList, unpackSelmapFile } from "@modovik/climb-contract/selection/selmap";

self.onmessage = (event) => {
  const { id, buffer } = event.data;
  try {
    const parts = decodeSelmapParts(unpackSelmapFile(new Uint8Array(buffer), { deflate: unzlibSync }));
    self.postMessage({ id, parts }, transferList(parts));
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
