import { useLayoutEffect } from "react";

/*
 * Страница открытой сборки, страница создания и «ReShade · DLSS 5» встают в том же окне прокрутки и идут от края до края.
 *
 * Прокрутка: список мог быть пролистан, а страница должна начинаться с верха (раньше сборка открывалась окном поверх списка и прокрутку не трогала).
 *
 * Края: поля вокруг страницы лежат у контейнера окна (`.desktop-content`). Правило `:has(> .builds-page)` на нём браузер перепроверял бы на каждую правку
 * в окне (`has-invalidation.test.jsx`), поэтому страница сама ставит контейнеру класс на время своей жизни, а лист по нему убирает поля.
 *
 * `wide` — страница шире обычной полосы окна (1580 px): кадр во всю ширину окна и на большом экране, а не полосой с чёрными краями (макет «Кино», DLSS 5).
 */
const FRAME_CLASS = "has-bleed-page";
const WIDE_CLASS = "is-bleed-wide";

export function usePageFrame(
  scroller = ".desktop-main",
  frame = ".desktop-content",
  wide = false,
) {
  useLayoutEffect(() => {
    const main = document.querySelector(scroller);
    if (main && main.scrollTop !== 0) main.scrollTop = 0;
    const box = document.querySelector(frame);
    box?.classList.add(FRAME_CLASS);
    if (wide) box?.classList.add(WIDE_CLASS);
    return () => {
      box?.classList.remove(FRAME_CLASS);
      box?.classList.remove(WIDE_CLASS);
    };
  }, [scroller, frame, wide]);
}
