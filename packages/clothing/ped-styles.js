/*
 * Какого персонажа показывает мастерская одежды (ТЗ 29.10.2026-e): пол, причёска и лицо — из файлов самой игры игрока.
 *
 * Свободный персонаж GTA Online — `mp_m_freemode_01` и `mp_f_freemode_01`. У обоих одна и та же голова-основа (`head_000_r`), а лицо игра
 * получает смешиванием: к основе прибавляются поправки родителя — `micro_head_NNN_*.ydr` (смещения 1514 вершин головы). Без поправки у обоих
 * полов выходит одно и то же «мужское» лицо; с поправкой женского родителя лицо женское. Кожа лица — `head_diff_NNN_a_<тон>.ytd` того же родителя.
 *
 * Варианты — короткие подборки, а не вся игра: причёски, которые в игре читаются целиком (без «листьев» и повязок, которым нужна палитра
 * оттенков), и лица тех родителей, чей тон кожи близок к телу (`*_whi` у всех штатных частей тела). Первый вариант — по умолчанию. Номера
 * причёсок — номера `hair_NNN_u.ydd`, лиц — номера родителей. Подбор — по снимкам 29.10.2026 (`docs/WEAR-STUDIO.md`, «Персонаж»).
 *
 * Здесь только данные и счёт: Desktop по ним читает файлы (`clothing-character.js`), окно по ним листает варианты.
 */

export const GENDERS = Object.freeze(["male", "female"]);

/** Пол запроса: всё, что не `female`, — мужской. */
export const pedGender = (value) => (value === "female" ? "female" : "male");

/* Лицо: родитель, тон кожи на его текстуре, файл поправки. Поправка есть у каждого родителя; имя файла — как в игре. */
const face = (parent, tone, delta) => Object.freeze({ parent, tone, delta });

export const PED_STYLES = Object.freeze({
  male: Object.freeze({
    /* Коротко стриженный — первым; дальше «слегка зачёс», «на бок», «чёлка», «зачёс вверх», «до плеч», лысый. */
    hairs: Object.freeze([1, 7, 4, 11, 12, 2, 15, 0]),
    faces: Object.freeze([
      face(12, "whi", "micro_head_012_r_male_extra_head_whi.ydr"),
      face(4, "lat", "micro_head_004_r_male_latino_beauty.ydr"),
      face(6, "chi", "micro_head_006_r_male_chinese_beauty.ydr"),
      face(16, "lat", "micro_head_016_r_male_ng_head_lat.ydr"),
      face(18, "chi", "micro_head_018_r_male_ng_head_chi.ydr"),
      face(19, "pak", "micro_head_019_r_male_ng_head_pak.ydr"),
      face(13, "whi", "micro_head_013_r_male_ng_head_whi.ydr"),
      face(20, "ara", "micro_head_020_r_male_ng_head_ara.ydr"),
    ]),
  }),
  female: Object.freeze({
    /* Аккуратная с хвостиками — первой; дальше пучок, коса, каре с чёлкой, каре, длинные, короткая, лысая. */
    hairs: Object.freeze([3, 14, 6, 2, 7, 15, 1, 0]),
    faces: Object.freeze([
      face(33, "whi", "micro_head_033_r_female_ng_whi.ydr"),
      face(21, "whi", "micro_head_021_r_female_white_beauty.ydr"),
      face(34, "whi", "micro_head_034_r_female_ng_whi2.ydr"),
      face(25, "lat", "micro_head_025_r_female_latino_beauty.ydr"),
      face(27, "chi", "micro_head_027_r_female_chinese_beauty.ydr"),
      face(37, "lat", "micro_head_037_r_female_extra_head_fem_lat.ydr"),
      face(39, "chi", "micro_head_039_r_female_ng_chi.ydr"),
      face(29, "pak", "micro_head_029_r_female_indian_beauty.ydr"),
    ]),
  }),
});

/** Сколько вариантов причёски и лица у пола. */
export const styleCounts = (gender) => {
  const styles = PED_STYLES[pedGender(gender)];
  return { hairs: styles.hairs.length, faces: styles.faces.length };
};

/** Номер варианта запроса в пределах подборки: не число или вне подборки — первый (по умолчанию). */
export function clampStyle(value, count) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < count ? number : 0;
}

/** Выбор человека: `{ hair, face }` — номера вариантов подборки, приведённые к допустимым. */
export function pedChoice(gender, input = {}) {
  const counts = styleCounts(gender);
  return { hair: clampStyle(input.hair, counts.hairs), face: clampStyle(input.face, counts.faces) };
}

/** Следующий вариант по кругу: `step` = 1 или −1. */
export const cycleStyle = (current, count, step) => (((Number(current) || 0) + step) % count + count) % count;
