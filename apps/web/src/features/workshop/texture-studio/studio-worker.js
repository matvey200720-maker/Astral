/*
 * Рабочий поток студии текстур (ТЗ 18.10.2026, Session 1, задача 6): палочка,
 * «убрать фон», фильтры и коррекции — вне главного потока. Буферы идут
 * передачей (без копии); ответ несёт тот же `id`, что и запрос.
 */

import { runHeavyOp } from "./heavy-ops.js";

self.onmessage = (event) => {
  const { id, op, request } = event.data || {};
  try {
    const { transfer = [], ...answer } = runHeavyOp(op, request);
    self.postMessage({ id, ok: true, answer }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
