/*
 * Кадры свойств RMPTFX (ptxKeyframe).
 *
 * Свойство правила — это не число, а дорожка: строки `[время, x, y, z, w]`,
 * где время — доля жизни того, кому свойство принадлежит (частицы — у
 * поведений, эмиттера — у свойств эмиттера, эффекта — у свойств правила
 * эффекта). Между строками значение идёт по прямой, за краями держится
 * крайнее: так делает игра (второй компонент времени в файле — заранее
 * посчитанное `1/Δt` той же прямой, выгрузка его отбрасывает).
 *
 * Дорожка хранится одним `Float32Array` по пять чисел на кадр: движок
 * опрашивает сотни дорожек на кадр, и массив массивов здесь был бы лишней
 * работой сборщику мусора.
 */

export const KEY_STRIDE = 5;

/** Дорожка из строк выгрузки; пустая дорожка — `null`. */
export function compileTrack(rows) {
  if (!Array.isArray(rows)) return null;
  const valid = rows
    .filter((row) => Array.isArray(row) && row.length >= KEY_STRIDE)
    .map((row) => row.slice(0, KEY_STRIDE).map((value) => Number(value) || 0))
    .sort((left, right) => left[0] - right[0]);
  if (!valid.length) return null;
  const track = new Float32Array(valid.length * KEY_STRIDE);
  valid.forEach((row, index) => track.set(row, index * KEY_STRIDE));
  return track;
}

/**
 * Значение дорожки в момент `t` (0…1) — в `out` (4 числа).
 * Дорожки без кадров здесь не бывает: пустое свойство решает вызывающий,
 * у каждого свойства своё «по умолчанию».
 */
export function sampleTrack(track, t, out) {
  const last = track.length - KEY_STRIDE;
  if (last <= 0 || t <= track[0]) {
    out[0] = track[1];
    out[1] = track[2];
    out[2] = track[3];
    out[3] = track[4];
    return out;
  }
  if (t >= track[last]) {
    out[0] = track[last + 1];
    out[1] = track[last + 2];
    out[2] = track[last + 3];
    out[3] = track[last + 4];
    return out;
  }
  let next = KEY_STRIDE;
  while (next < last && track[next] < t) next += KEY_STRIDE;
  const previous = next - KEY_STRIDE;
  const span = track[next] - track[previous];
  const f = span > 0 ? (t - track[previous]) / span : 0;
  out[0] = track[previous + 1] + (track[next + 1] - track[previous + 1]) * f;
  out[1] = track[previous + 2] + (track[next + 2] - track[previous + 2]) * f;
  out[2] = track[previous + 3] + (track[next + 3] - track[previous + 3]) * f;
  out[3] = track[previous + 4] + (track[next + 4] - track[previous + 4]) * f;
  return out;
}

/*
 * Эволюции.
 *
 * Свойство может иметь «эволюционировавшие» дорожки: по дальности (LOD — от
 * `LodEvoDistanceMin` до `…Max` правила эффекта), по углу попадания, по
 * скорости и т. п. Значение эволюции 0…1 смешивает базовую дорожку с
 * эволюционировавшей: режим 1 — по прямой между ними (так устроены почти все
 * 7445 свойств ядра Legacy), режим 0 — прибавкой.
 */
export const EVOLUTION_BLEND = Object.freeze({ add: 0, blend: 1 });

const scratch = new Float32Array(4);

/**
 * Значение свойства с эволюциями: `base` — дорожка или `null`, `fallback` —
 * значение пустого свойства, `evolved` — `[{ evolution, mode, track }]`,
 * `evolutions` — значения эволюций по имени.
 */
export function sampleProperty(base, fallback, evolved, evolutions, t, out) {
  if (base) sampleTrack(base, t, out);
  else {
    out[0] = fallback[0];
    out[1] = fallback[1];
    out[2] = fallback[2];
    out[3] = fallback[3];
  }
  if (!evolved || !evolutions) return out;
  for (const item of evolved) {
    const amount = evolutions[item.evolution];
    if (!(amount > 0)) continue;
    const weight = amount > 1 ? 1 : amount;
    sampleTrack(item.track, t, scratch);
    if (item.mode === EVOLUTION_BLEND.add) {
      out[0] += scratch[0] * weight;
      out[1] += scratch[1] * weight;
      out[2] += scratch[2] * weight;
      out[3] += scratch[3] * weight;
    } else {
      out[0] += (scratch[0] - out[0]) * weight;
      out[1] += (scratch[1] - out[1]) * weight;
      out[2] += (scratch[2] - out[2]) * weight;
      out[3] += (scratch[3] - out[3]) * weight;
    }
  }
  return out;
}
