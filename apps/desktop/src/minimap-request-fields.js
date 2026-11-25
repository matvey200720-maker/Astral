/*
 * Поля заявки мини-карты, которые печь несёт окну-съёмщику: `domain.minimap.state` (здоровье и броня кадра) и `domain.minimap.spot` (место радара на карте мира).
 * Одна строгая проверка на двоих — печь (`cover-stage.js`) и белый список хозяина окна (`part-shooter.js`): окно — чужой код, лишнего в запросе не бывает.
 * Негодное значение — `null`, и поля в запросе нет.
 */

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/** Здоровье и броня по шкале 0…100: число округляется и прижимается к краю, сторона без числа остаётся без значения; ничего пригодного — null. */
export function minimapStateOf(named) {
  if (!named || typeof named !== "object" || Array.isArray(named)) return null;
  const state = {};
  for (const side of ["health", "armor"]) {
    if (isNumber(named[side])) state[side] = Math.min(100, Math.max(0, Math.round(named[side])));
  }
  return Object.keys(state).length > 0 ? state : null;
}

/** Место радара `{ x, y, width }` (метры карты мира): три конечных числа и ширина больше нуля, лишних полей нет; иначе null. */
export function minimapSpotOf(named) {
  if (!named || typeof named !== "object" || Array.isArray(named)) return null;
  const { x, y, width } = named;
  return [x, y, width].every(isNumber) && width > 0 ? { x, y, width } : null;
}
