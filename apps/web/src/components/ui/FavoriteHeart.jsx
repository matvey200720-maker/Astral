import { useEffect, useRef, useState } from "react";
import { motionEnabled } from "../../motion-preference.js";
import { Heart } from "./icons.jsx";

/*
 * Сердечко избранного — один знак на каталог (ТЗ 29.10.2026, п. c): кнопка «Избранное» в шапке, сердце на карточке, на странице
 * мода и в видах вкладки. Включено — красное и залитое, выключено — контур. Красный — токен `--astral-heart`.
 *
 * Ход щелчка — «биение»: когда сердце включают (а не когда карточка просто нарисована уже с ним), знак на миг сжимается и
 * раздувается, а заливка проявляется (`favorite-heart.css`). Знак не меняет свой размер и рамку кнопки не трогает: двигается
 * только он сам, раскладка стоит. Выключение — без биения, просто гаснет заливка.
 *
 * Движение — решение продукта: при выключенных анимациях (настройка или системная просьба) биения нет, и класс не ставится.
 * Читается `motionEnabled()`, а не подписка `useMotionEnabled()`: решение нужно в момент щелчка, а в сетке сотни сердец, и
 * подписывать каждое на смену настройки незачем.
 *
 * `compact` — знак на карточке в 16 px (`.ui-media-card-like svg`). Тот же рисунок набора, расчерченный на сетке 16 × 16, а не 24 × 24 и
 * сжатый в 16 px: сетка и размер совпадают, и у знака нет собственного преобразования (`viewBox` → окно), которое браузер вынужден было
 * заводить на каждую карточку отдельным узлом свойств отрисовки и отдельным куском при сборке слоёв (стенд 30.10.2026, ×4, 3000 модов,
 * пять пар «до/после» подряд: кадров дольше 20 мс из 89 — 8–11 → 3–9, занятость главного потока −6,5 %, сборка слоёв −14 %, отрисовка −13 %). Контур,
 * цвета, начертания и ход щелчка те же (снимки карточки до/после — разница в краевых пикселях сердца, не больше 2 из 255; в кадрах биения
 * на 1× — до 12 пикселей края); что рисунок совпадает со знаком набора, держит тест (`favorite-heart.test.jsx`).
 */
export const COMPACT_HEART_PATH =
  "M8 4.5 A3 3 0 0 0 5 2.5 A3 3 0 0 0 2 5.5 A3 3 0 0 0 3 7.5 L8 13.5 L13 7.5 A3 3 0 0 0 14 5.5 A3 3 0 0 0 11 2.5 A3 3 0 0 0 8 4.5 Z";

function CompactHeart({ weight }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill={weight === "fill" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="astral-glyph"
      data-weight={weight}
    >
      <path d={COMPACT_HEART_PATH} />
    </svg>
  );
}

export default function FavoriteHeart({ on, compact = false }) {
  const [beating, setBeating] = useState(false);
  const wasOn = useRef(on);
  useEffect(() => {
    if (on && !wasOn.current && motionEnabled()) setBeating(true);
    wasOn.current = on;
  }, [on]);
  const weight = on ? "fill" : "regular";
  return (
    <span
      className={`ui-heart${on ? " is-on" : ""}${beating ? " is-beat" : ""}`}
      aria-hidden="true"
      onAnimationEnd={() => setBeating(false)}
    >
      {compact ? <CompactHeart weight={weight} /> : <Heart weight={weight} />}
    </span>
  );
}
