/*
 * Случайность частиц.
 *
 * В RMPTFX у каждой дорожки-диапазона (мин…макс) свой номер случайной
 * величины (`RandomIndex`), а связи смещений частицы (`BiasLinks`) сводят
 * несколько дорожек на одну величину: частица, которой выпал крупный размер,
 * получает и тёмный цвет, если художник их связал. Повторить генератор
 * игры нельзя и незачем — важна структура: независимые величины независимы,
 * связанные совпадают (или противоположны при `InvertBiasLink`).
 *
 * Поэтому величина частицы — детерминированная функция (зерна частицы, номера
 * величины): одно и то же зерно даёт один и тот же выброс, что и нужно
 * сцене, которая повторяет попадание кругами.
 */

/** Хеш Дженкинса (joaat) — как CodeWalker `JenkHash.GenHash`: по строчным. */
export function joaat(text) {
  let hash = 0;
  const value = String(text || "").toLowerCase();
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash + value.charCodeAt(index)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  hash = (hash + (hash << 15)) >>> 0;
  return hash >>> 0;
}

/** Перемешивание 32 бит (splitmix-подобное): из двух целых — равномерное 0…1. */
export function unitHash(seed, index) {
  let x = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((index | 0) + 0x632be5ab, 0x85ebca77)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Зерно из строки и чисел — для эффекта, события, частицы. */
export function seedOf(...parts) {
  let seed = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let index = 0; index < text.length; index += 1) {
      seed ^= text.charCodeAt(index);
      seed = Math.imul(seed, 0x01000193) >>> 0;
    }
    seed ^= 0xff;
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  return seed >>> 0;
}

/** Последовательный генератор (mulberry32) — для раскладки внутри доменов. */
export function sequence(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
