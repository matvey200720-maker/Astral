/*
 * Постоянные нарезки по содержимому (`chunk-store.js` и его поток `chunk-hash-worker.js`).
 * Менять нельзя: новые куски обязаны совпасть с лежащими у людей с 10.10.2026.
 * Средний кусок ~1 МБ, от 256 КБ до 4 МБ.
 */
export const CUT_MIN = 256 * 1024;
export const CUT_MAX = 4 * 1024 * 1024;
export const CUT_MASK = (1 << 20) - 1;
/* С этого места куска скользящий хеш (32 бита, сдвиг на байт) к `CUT_MIN` уже тот же, что при счёте с начала. */
export const CUT_SKIP = CUT_MIN - 32;
export const CUT_GEAR = (() => {
  const table = new Uint32Array(256);
  let seed = 0x9e3779b9;
  for (let index = 0; index < 256; index += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    table[index] = seed >>> 0;
  }
  return table;
})();
