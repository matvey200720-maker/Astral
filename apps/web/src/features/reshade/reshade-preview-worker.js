/*
 * Фоновый поток превью пресетов ReShade (ТЗ 17.10, задача 8).
 *
 * Принимает задания `reshade-preview.js`: сначала кадр-основу (`base`), потом
 * пресеты по одному (`preset`) — и отвечает тем же номером. Кадр 1280×720
 * через шейдер на процессоре — сотни миллисекунд; в окне это была бы пауза на
 * каждый пресет.
 */

import { applyPresetToFrame } from "@modovik/optimizer/reshade-emulation.js";

let frame = null;

/* Кадр-основа по адресу (20.10.2026): поток качает и декодирует его сам — в
   окне декод 1280×720 и чтение с видеочипа стоили кадр в 96 мс при входе в
   ReShade (процессор ×4). Окно получает только размер. */
async function loadFrame(url) {
  if (typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function")
    throw new Error("В потоке нет OffscreenCanvas");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Кадр-основа не скачался: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !bitmap.width || !bitmap.height) throw new Error("Холст потока недоступен");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, data };
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (event) => {
  const { id, type, width, height, data, presetId, url } = event.data || {};
  try {
    if (type === "base-url") {
      frame = await loadFrame(url);
      self.postMessage({ id, result: { width: frame.width, height: frame.height } });
      return;
    }
    if (type === "base") {
      frame = { width, height, data: new Uint8ClampedArray(data) };
      self.postMessage({ id, result: true });
      return;
    }
    if (type === "preset") {
      if (!frame) throw new Error("Кадр-основа для превью ещё не передан");
      const result = applyPresetToFrame(frame.data, frame.width, frame.height, presetId);
      self.postMessage({ id, result: result.buffer }, [result.buffer]);
      return;
    }
    throw new Error(`Неизвестное задание потока превью: ${type}`);
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
