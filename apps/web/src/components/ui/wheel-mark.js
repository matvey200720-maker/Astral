/*
 * Метка «колесо над этим элементом — масштаб сцены» (правило аудита `scroll`, владелец 16.11.2026: «везде, чтобы колесиком листалось»).
 *
 * Холст сцены слушает колесо без `passive` и гасит его: колесо там — приближение или поворот, а не прокрутка страницы. Правило просит у
 * такого элемента явную метку `data-wheel="zoom"`; `useSceneWheel` ставит её сам, сцены с собственным слушателем — этим помощником.
 * Метку уже поставил кто-то другой (`step`, `strip`) — не перетираем. Возвращает снятие метки.
 */
export function markWheel(element, kind = "zoom") {
  if (!element?.dataset || element.dataset.wheel !== undefined) return () => {};
  element.dataset.wheel = kind;
  return () => {
    if (element.dataset.wheel === kind) delete element.dataset.wheel;
  };
}
