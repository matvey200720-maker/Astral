/*
 * «Интерьеры Majestic RP» — коробка кадра без отдалённых вещей (ТЗ 29.10.2026-e, п. 3).
 *
 * Коробка сцены (`asset.bounds`) ведёт свет зала, дальность камеры и границы полёта. В паках бывают вещи, поставленные далеко от помещения: у Majestic
 * Garage 2-6 две бочки стоят в 187 м от гаража, коробка вытянулась на двести метров, свет встал за пределами помещения — и зал рисовался чёрным (то же у
 * HW Addon 2 и 3 и у двух сборок Rancho). Вещи при этом на месте и рисуются; решает коробка кадра, а не сцена.
 *
 * Здесь коробка считается по частям сцены (вещь — часть, у неё своя коробка): центры частей, медианный центр, и части дальше `max(60 м, 4 × медианное
 * расстояние)` от него в коробку не входят. Длинный интерьер (туннель в сотни метров) не страдает: у него и медианное расстояние велико. Мало частей —
 * коробка прежняя.
 */

const AXES = [0, 1, 2];
const MIN_PARTS = 8;
const FLOOR_METRES = 60;
const SPREAD = 4;

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

/** Коробка кадра `{ min, max }`: у сцены без дальних вещей — её собственная (`asset.bounds`, тот же объект). */
export function roomBounds(asset) {
  const whole = asset?.bounds;
  const parts = (asset?.parts || []).filter((part) => part?.bounds?.min && part.bounds?.max);
  if (!whole || parts.length < MIN_PARTS) return whole;
  const centres = parts.map((part) => AXES.map((axis) => (part.bounds.min[axis] + part.bounds.max[axis]) / 2));
  const middle = AXES.map((axis) => median(centres.map((centre) => centre[axis])));
  const distances = centres.map((centre) => Math.hypot(centre[0] - middle[0], centre[1] - middle[1], centre[2] - middle[2]));
  const limit = Math.max(FLOOR_METRES, SPREAD * median(distances));
  const kept = parts.filter((_part, at) => distances[at] <= limit);
  if (kept.length === parts.length || !kept.length) return whole;
  return {
    min: AXES.map((axis) => Math.min(...kept.map((part) => part.bounds.min[axis]))),
    max: AXES.map((axis) => Math.max(...kept.map((part) => part.bounds.max[axis]))),
  };
}
