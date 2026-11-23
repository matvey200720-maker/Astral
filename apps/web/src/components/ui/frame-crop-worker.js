import { measurePixels, sampleSize } from "./frame-crop-pixels.js";

self.onmessage = async ({ data }) => {
  let bmp, result = null;
  const { id, src } = data ?? {};
  const able = typeof createImageBitmap === "function" && typeof OffscreenCanvas === "function";
  try {
    const reply = able && (await fetch(src, { mode: "cors", credentials: "same-origin" }));
    bmp = reply.ok && (await createImageBitmap(await reply.blob()));
    const { aspect, width, height } =
      bmp?.width && bmp.height ? sampleSize(bmp.width, bmp.height) : {};
    const pen =
      width && new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
    pen?.drawImage(bmp, 0, 0, width, height);
    const shot = pen?.getImageData(0, 0, width, height);
    if (shot) result = measurePixels(shot.data, width, height, aspect);
  } catch {
    // сбой на любом шаге оставляет результат null
  }
  // catch глотает все ошибки, поэтому закрытие битмапа выполняется в любом исходе
  if (bmp) bmp.close();
  self.postMessage(able ? { id, result } : { id, failed: true });
};
