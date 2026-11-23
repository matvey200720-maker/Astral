/*
 * Пол вещи в «Моделях» мастерской одежды (ТЗ владельца 29.10.2026, «скин одежды на женского персонажа», п. 1).
 *
 * Вещь игры в «Моделях» — категория и число: «Верх №12». Число одно на всю окно, работы мастерской помнят вещь по нему
 * (`game:tshirts-12`), поэтому женская вещь получает не другую категорию и не другое поле, а свой диапазон чисел:
 * женская вещь №12 — это 10012. Мужские числа не двигаются (до 1999: база, вещи других архивов, дополнения), так что
 * прежние работы открываются теми же вещами. Диапазон знают оба конца: Desktop выдаёт и читает вещи, окно показывает
 * номер и подбирает цели «На что поставить».
 */

/** С какого числа начинаются женские вещи. Выше самого большого мужского (`MAX_VARIANT` Desktop — 1999). */
export const FEMALE_VARIANT = 10000;
/** Женские числа занимают тот же размах, что мужские. */
export const GENDER_VARIANT_SPAN = 2000;

const FEMALE_FOLDER = "mp_f_freemode_01";
const MALE_FOLDER = "mp_m_freemode_01";

/** Пол вещи по её числу в «Моделях». */
export const variantGender = (variant) => (Number.isInteger(variant) && variant >= FEMALE_VARIANT ? "female" : "male");

/** Число вещи в её собственной нумерации игры: у женской — без смещения. */
export const localVariant = (variant) => (variantGender(variant) === "female" ? variant - FEMALE_VARIANT : variant);

/** Число вещи в «Моделях» по числу в игре и полу. */
export const withGender = (variant, gender) => (gender === "female" ? variant + FEMALE_VARIANT : variant);

/** Число годится как вещь «Моделей»: целое, не отрицательное, в пределах диапазона своего пола. */
export const validVariant = (variant) =>
  Number.isInteger(variant) &&
  variant >= 0 &&
  (variant < GENDER_VARIANT_SPAN || (variant >= FEMALE_VARIANT && variant < FEMALE_VARIANT + GENDER_VARIANT_SPAN));

/**
 * Папка женского персонажа по папке мужского. Три вида имён: основная (`mp_m_freemode_01`), аксессуары
 * (`mp_m_freemode_01_p`) и дополнения (`mp_m_freemode_01_male_freemode_mplts` → `mp_f_freemode_01_female_freemode_mplts`,
 * `mp_m_freemode_01_mp_m_2023_01` → `mp_f_freemode_01_mp_f_2023_01`). Мужская папка без женской пары остаётся как была.
 */
export function folderOfGender(folder, gender) {
  const text = String(folder || "");
  if (gender === "female")
    return text
      .replace(/(^|\/)mp_m_freemode_01/i, `$1${FEMALE_FOLDER}`)
      .replace(/_male_freemode_/i, "_female_freemode_")
      .replace(/_mp_m_/i, "_mp_f_")
      .replace(/_male_xmas$/i, "_female_xmas");
  return text
    .replace(/(^|\/)mp_f_freemode_01/i, `$1${MALE_FOLDER}`)
    .replace(/_female_freemode_/i, "_male_freemode_")
    .replace(/_mp_f_/i, "_mp_m_")
    .replace(/_female_xmas$/i, "_male_xmas");
}

/** Пол по имени папки персонажа: `mp_f_…` — женский, `mp_m_…` — мужской, иначе `null`. */
export function folderGender(folder) {
  const match = /(?:^|\/)mp_([mf])_freemode_01/i.exec(String(folder || ""));
  return match ? (match[1].toLowerCase() === "f" ? "female" : "male") : null;
}
