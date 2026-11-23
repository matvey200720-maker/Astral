/*
 * Пустой кадр просмотрщика (22.11.2026, пустой предпросмотр одежды в Astral 1.0.0: «полоска прошла, модели нет, тёмная панель с крестиком»). Файл модели прочитался и сетки в нём
 * есть, а на холсте — ничего: все материалы прозрачны (текстура не разобралась), камера встала в пустоту, шейдеры не собрались. Просмотрщик считал такой кадр «готово». Здесь — проверка
 * того, что видит человек: в только что нарисованном кадре есть хоть один непрозрачный пиксель.
 *
 * Кадр читается целиком один раз и только на втором кадре (и ещё раз на четвёртом, если второй был пуст) — дальше проверка снимается. Холста без `readPixels` (тесты без WebGL,
 * потерянный контекст) проверка не касается: ответ `null` — «проверить нельзя», а не «пусто».
 */

/** Есть ли в только что нарисованном кадре хоть один пиксель с альфой. `null` — прочесть кадр нельзя. */
export function frameHasPixels(renderer) {
  try {
    const gl = renderer?.getContext?.();
    if (!gl || typeof gl.readPixels !== "function") return null;
    const width = Number(gl.drawingBufferWidth);
    const height = Number(gl.drawingBufferHeight);
    if (!(width > 0 && height > 0) || width * height > 16_000_000) return null;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    for (let at = 3; at < pixels.length; at += 4) if (pixels[at] !== 0) return true;
    return false;
  } catch {
    return null;
  }
}
