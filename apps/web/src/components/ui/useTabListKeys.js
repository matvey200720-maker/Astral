import { useRef } from "react";

/*
 * Закладки ходят стрелками, а не табом по каждой.
 *
 * Так устроен любой набор закладок, и читалка экрана об этом объявляет: в
 * полосе один остановочный пункт (`tabindex="0"` у выбранной), внутри полосы
 * ходят стрелками. Пока этого не было, каждая полоса на восемь разделов
 * стоила восьми нажатий таба, чтобы её пройти, — а страница оптимизации
 * выписывала такой обработчик себе сама, мимо органа.
 *
 * Обработчик один на все полосы: сегментированный выбор с `role="tablist"` и
 * полосы, у которых свой вид, но та же суть, — например разделы настроек.
 * Полоса вешает `ref` и `onKeyDown` на контейнер, закладки внутри — обычные
 * `role="tab"` в том же порядке, что и `options`.
 */
export default function useTabListKeys({
  options,
  value,
  onChange,
  enabled = true,
  /* Столбик закладок (меню настроек) ходит вверх и вниз; группа плиток
     «одно из» (`both`) — во все четыре стороны, как радиокнопки. */
  orientation = "horizontal",
  /* Что внутри контейнера получает фокус: закладки или радиокнопки. */
  itemSelector = '[role="tab"]',
}) {
  const listRef = useRef(null);

  function onKeyDown(event) {
    if (!enabled) return;
    const index = options.findIndex((option) => option.value === value);
    if (index < 0) return;
    const vertical = orientation === "vertical";
    const both = orientation === "both";
    const steps = {
      [vertical ? "ArrowDown" : "ArrowRight"]: 1,
      [vertical ? "ArrowUp" : "ArrowLeft"]: -1,
      ...(both ? { ArrowDown: 1, ArrowUp: -1 } : {}),
      Home: -index,
      End: options.length - 1 - index,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (!option || option.disabled) return;
    onChange?.(option.value);
    listRef.current?.querySelectorAll(itemSelector)[next]?.focus();
  }

  return { listRef, onKeyDown };
}
