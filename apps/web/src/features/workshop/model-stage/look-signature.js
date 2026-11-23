/*
 * Отпечаток облика материала: строка, по которой кадр сверяет, что сменилось после правки (`orbit-stage.js`, `settleLooks`).
 *
 * Своим обходом, а не `JSON.stringify`: тот зовёт `toJSON` раньше заменителя, а `Texture.toJSON` кодирует саму картинку. Атлас эмблем 4096 × 2048 уходил в
 * `toDataURL` на каждый материал, и окно стояло 5–13 с через 280 мс после любой правки, пока в работе есть эмблема; плитка узора и градиента — массивом
 * чисел (профиль 31.10.2026). Текстура здесь — её `uuid`, цвет — код, матрица — числа; функции не считаются.
 */
export function lookSignature(value) {
  if (value === null || value === undefined || typeof value === "function") return "";
  if (typeof value !== "object") return String(value);
  if (value.isTexture) return `t${value.uuid}`;
  if (value.isColor) return `c${value.getHexString()}`;
  if (value.isMatrix4) return value.elements.join();
  if (Array.isArray(value)) return `[${value.map(lookSignature).join()}]`;
  let out = "{";
  for (const key of Object.keys(value)) out += `${key}:${lookSignature(value[key])};`;
  return `${out}}`;
}
