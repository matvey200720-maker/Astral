import { createContext, useContext, useEffect, useId } from "react";

/*
 * Связь обложки с печью (`cover-oven.jsx`, оптимизация 13.10.2026).
 *
 * Полка мастерской показывает обложки готовыми картинками, а рисует их печь —
 * один раз, в скрытом месте окна. Печи нужно знать, когда рисунок обложки
 * готов: холст нарисовался, 3D-снимок встал, лист игры доехал. Сама разметка
 * этого не говорит (рисование на холсте — не правка DOM), поэтому обложка
 * сообщает сама:
 *
 *   • `useCoverDrawn()` — «нарисовала», с элементом рисунка (холст или
 *     картинка): так говорят общий холст обложек (`useCoverCanvas`) и 3D-снимок
 *     (`SceneThumb`);
 *   • `useCoverPending(pending)` — «ещё не всё»: пока флаг стоит, печь не
 *     снимает кадр — лист, шрифт или снимок ещё едут;
 *   • `useCoverProvisional()` — «кадр временный»: нарисован без листов игры,
 *     которые ещё могут приехать. Печь такой кадр не запекает (запечённый кадр
 *     живёт трое суток и после подключения игры остался бы «урезанным») —
 *     обложка остаётся живой, пока не доедут листы.
 *
 * Вне печи (обложка живьём: тесты, браузер без холста) контекста нет, и оба
 * вызова — пустые.
 */
export const CoverBakeContext = createContext(null);

const NOTHING = () => {};

/** Функция «нарисовала» для печи или пустышка вне её. */
export function useCoverDrawn() {
  return useContext(CoverBakeContext)?.drawn || NOTHING;
}

/** Пока `pending` истинно, печь ждёт и кадр не снимает. */
export function useCoverPending(pending) {
  const oven = useContext(CoverBakeContext);
  const id = useId();
  const hold = Boolean(pending);
  useEffect(() => {
    if (!oven) return undefined;
    oven.hold(id, hold);
    return () => oven.hold(id, false);
  }, [oven, id, hold]);
}

/**
 * Функция «кадр временный» (`provisional(true)`) или «окончательный»
 * (`provisional(false)`) для печи; пустышка вне её.
 */
export function useCoverProvisional() {
  return useContext(CoverBakeContext)?.provisional || NOTHING;
}
