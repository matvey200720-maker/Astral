/*
 * Что в кадре игры можно переключить (`docs/fx-scenes.md`, §4): ракурс и расстояние до цели. Подписи — русские ключи словаря
 * (`locales/ui-text/zone-h2-fx-frame-2410.js`), переводит окно в месте отрисовки (`tr`). Какие из них есть в наборе, говорит `useFxScene().choices`.
 */

/** Ракурс трассера, попадания и килла: сбоку и от третьего лица (камера игры за спиной стрелка); «от лица жертвы» — только у попадания (камера за спиной того, в кого
 *  стреляют); «от первого лица» бывает только у экранных попаданий. */
export const FRAME_VIEW_OPTIONS = Object.freeze([
  { value: "side", label: "Сбоку" },
  { value: "third", label: "От третьего лица" },
  { value: "victim", label: "От лица жертвы" },
]);

/** Расстояние до цели у попадания: вблизи (≈3–4 м) и вдали (≈25–40 м). */
export const FRAME_DISTANCE_OPTIONS = Object.freeze([
  { value: "close", label: "Вблизи" },
  { value: "far", label: "Вдали" },
]);

/** Варианты из `options`, что есть в наборе (`available`), с переведёнными подписями; меньше двух — переключателя нет (`[]`). */
export function choiceOptions(options, available, translate) {
  const present = options.filter((item) => available.includes(item.value));
  return present.length > 1 ? present.map((item) => ({ ...item, label: translate(item.label) })) : [];
}
