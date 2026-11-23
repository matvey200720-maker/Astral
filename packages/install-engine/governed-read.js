/*
 * Чтения JS под регулятором диска (20.11.2026, `disk-governor.js`).
 *
 * У движка чтение идёт под потолком, у больших хэшей — своей очередью с отдыхом (`sha256File`). Остальные чтения JS — проверка своих пакетов перед подменой (`dlc-archive-check.js`: читатель
 * rpf7 по смещениям), хэши точек отката — шли без всего: на `veg:mod` это 14,5 ГБ чтения и «диск в сотку» без единого ограничителя. Здесь они встают в ту же очередь диска с отдыхом
 * (`diskTurn`), но только пока регулятор включён и только для крупных чтений: заголовки и мелочь идут как шли (тысячи мелких чтений, каждое с отдыхом в миллисекунду, — это минуты).
 */

import { diskTurn } from "./disk-care.js";
import { diskGovernor } from "./disk-governor.js";

/** С какого размера чтение идёт через очередь диска. */
export const GOVERNED_MIN_READ_BYTES = 256 * 1024;

/**
 * Обёртка чтения для файла `place`: `wrap(work, bytes)` — `work` выполняется своей очередью диска с отдыхом, если регулятор включён и чтение крупное; иначе — прямо.
 * `isActive` подставляется в тестах.
 */
export function governedReadWrapper(
  place,
  { isActive = () => diskGovernor().isActive() } = {},
) {
  return (work, bytes = 0) => {
    if (!(bytes >= GOVERNED_MIN_READ_BYTES) || !isActive()) return work();
    return diskTurn(work, { measure: { kind: "read", bytes, place } });
  };
}
