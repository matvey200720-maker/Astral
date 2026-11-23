import { useEffect, useState } from "react";

/*
 * Значение, которое перестало меняться.
 *
 * Ползунок присылает десятки правок в секунду, и всё, что считается от
 * правки, считается столько же раз. Для главного кадра это и нужно — человек
 * смотрит на него, пока тянет. А вторичное — миниатюры вариантов, сводки,
 * обложки — никто не разглядывает посреди движения руки: пересчитывать его
 * на каждом шаге значит отдавать под него кадры, которые нужны ползунку.
 *
 * Хук отдаёт значение, когда оно простояло `delay` миллисекунд. Первое
 * значение приходит сразу: окно не открывается с пустыми миниатюрами.
 */
export default function useSettledValue(value, delay = 160) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return undefined;
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, settled, delay]);
  return settled;
}
