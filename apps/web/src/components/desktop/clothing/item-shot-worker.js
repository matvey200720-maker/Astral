/*
 * Поток съёмщика плиток «Сделать заменёнку» (ТЗ 27.10.2026, замер в Desktop ×4): контекст WebGL, окружение, сборка шейдеров, чтение кадра и PNG —
 * здесь, на `OffscreenCanvas`, а не в окне. Ожидание ссылки шейдеров (`getUniforms`, ≈ 0,3 с на видеочипе) и чтение кадра держат поток, который их
 * вызвал: в окне это был кадр в 0,35–0,5 с при входе и по 60–200 мс на каждый снимок.
 *
 * Тот же `createClothingShooter`, что у карточек мастерской: съёмка одна и та же в потоке и без него (`item-shooter.js` берёт окно, когда потока нет).
 * Протокол: `{ id, op: "init", options }`, `{ id, op: "shoot", shot }`, `{ id, op: "dispose" }` → `{ id, ok }`, `{ id, bytes }` или `{ id, error }`.
 */

import { createClothingShooter } from "../../../features/clothing/clothing-shot.js";

let shooter = null;

self.onmessage = async (event) => {
  const { id, op, options, shot } = event.data || {};
  try {
    if (op === "init") {
      shooter ||= createClothingShooter(options);
      self.postMessage({ id, ok: true });
    } else if (op === "dispose") {
      shooter?.dispose();
      shooter = null;
      self.postMessage({ id, ok: true });
    } else if (op === "shoot") {
      if (!shooter) throw new Error("Съёмщик не создан.");
      const { bytes } = await shooter.shoot(shot);
      self.postMessage({ id, bytes }, [bytes.buffer]);
    }
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
