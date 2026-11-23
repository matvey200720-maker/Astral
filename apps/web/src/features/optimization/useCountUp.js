import { useEffect, useRef, useState } from "react";
import { motionEnabled } from "../../motion-preference.js";

/*
 * Число, которое набегает до своего значения.
 *
 * Нужно ровно там, где до ответа стоял прочерк: экран секунду держал заглушку,
 * и подставленная в один кадр цифра читается как ещё один скачок вёрстки, а не
 * как «посчитали». Набег привязывает её к тому же движению, которым въезжает
 * остальная панель.
 *
 * Итоговое значение точное: последний кадр ставит `target`, а не результат
 * округления доли. Без движения набега нет вовсе — цифра сразу своя.
 */
export function useCountUp(value, duration = 520) {
  const target = Number.isFinite(value) ? value : 0;
  const [shown, setShown] = useState(target);
  /* Откуда считать в следующий раз: состояние отстаёт на кадр, и читать его
     внутри эффекта — значит стартовать от позапрошлого значения. */
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = target;
    if (from === target || !motionEnabled()) {
      setShown(target);
      return undefined;
    }
    const started = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const ratio = Math.min(1, (now - started) / duration);
      /* Замедление к концу: цифра приходит к своему значению, а не влетает. */
      const eased = 1 - (1 - ratio) ** 3;
      setShown(ratio < 1 ? Math.round(from + (target - from) * eased) : target);
      if (ratio < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [duration, target]);

  return shown;
}
