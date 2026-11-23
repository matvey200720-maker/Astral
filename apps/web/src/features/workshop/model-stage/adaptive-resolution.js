/*
 * Разрешение кадра по ходу движения (18.10.2026, задача 10Б: «в зале арены очень лагает»).
 *
 * Тяжёлую сцену (зал Majestic — сотни тысяч треугольников, на встроенной видеокарте это 30 мс на кадр) камера
 * в полёте и при протяжке рисует рывками. Пока камера движется, рисовать можно и мельче: глаз в движении
 * чёткости не требует, а когда камера встала, кадр сразу перерисовывается в полное разрешение. Чистая
 * арифметика, без three: кадр (`orbit-stage.js`) отдаёт сюда время между кадрами, берёт множитель разрешения.
 *
 *   const control = createAdaptiveResolution({ base: 1.25 });
 *   control.frame(dtMs)      // кадр в движении; вернёт новый множитель, если он сменился, иначе null
 *   control.settle()         // камера встала: вернёт базовый множитель, если мельче, иначе null
 *   control.reset(base)      // окно сменило размер: новый базовый множитель
 *
 * Сжатие — на 15 % за шаг, если кадры дольше `slowMs` держатся `slowFrames` подряд (сглаженно); возврат —
 * на 10 % за шаг, если короче `fastMs` держатся `fastFrames` подряд. Ниже `floor` базового не опускаемся:
 * мельче половины картинка уже читается плохо, а помогает всё меньше.
 */

export const ADAPTIVE_SLOW_MS = 22;
export const ADAPTIVE_FAST_MS = 14;
export const ADAPTIVE_FLOOR = 0.5;

export function createAdaptiveResolution({ base = 1, slowMs = ADAPTIVE_SLOW_MS, fastMs = ADAPTIVE_FAST_MS, slowFrames = 6, fastFrames = 40, floor = ADAPTIVE_FLOOR, shrink = 0.85, grow = 1.1 } = {}) {
  let top = base;
  let ratio = base;
  let smooth = 0;
  let slow = 0;
  let fast = 0;
  const clearCounters = () => {
    slow = 0;
    fast = 0;
  };
  return {
    get ratio() {
      return ratio;
    },
    get base() {
      return top;
    },
    reset(next) {
      top = next;
      ratio = next;
      smooth = 0;
      clearCounters();
    },
    frame(dt) {
      /* Простой между движениями и первый кадр после остановки — не мера скорости. */
      if (!(dt > 0) || dt > 250) return null;
      smooth = smooth ? smooth * 0.7 + dt * 0.3 : dt;
      if (smooth > slowMs) {
        slow += 1;
        fast = 0;
      } else if (smooth < fastMs) {
        fast += 1;
        slow = 0;
      } else clearCounters();
      if (slow >= slowFrames && ratio > top * floor) {
        ratio = Math.max(top * floor, Math.round(ratio * shrink * 100) / 100);
        smooth = 0;
        clearCounters();
        return ratio;
      }
      if (fast >= fastFrames && ratio < top) {
        ratio = Math.min(top, Math.round(ratio * grow * 100) / 100);
        smooth = 0;
        clearCounters();
        return ratio;
      }
      return null;
    },
    settle() {
      smooth = 0;
      clearCounters();
      if (ratio >= top) return null;
      ratio = top;
      return ratio;
    },
  };
}
