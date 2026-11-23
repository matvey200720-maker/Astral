/*
 * Признак бороды у вещей проектов ПО ДАННЫМ (часть B задачи «причёски, бороды и усы в мастерской», 15.11.2026): по названию бороды среди целей баз не находятся, поэтому признак берётся из разбора моделей `berd`
 * по шейдеру волос и высоте сетки (`registry/beards-<проект>.tsv`: проект, пак, коллекция, пол, номер вещи, вид).
 *
 * Сгенерировано `scripts/build-beard-flags.mjs` — руками не править. Ключ — `<пол>|<коллекция>|<номер>`, коллекция — папка вещи без префикса персонажа (`mp_m_gta5rp_skins2`), значение — `beard` (борода),
 * `moustache` (усы) или `none` (разбор сказал «не борода» — перекрывает совпадение по названию). Таблиц нет — пусто: группа «Бороды и усы» в окне цели строится только по названию.
 */
export const BEARD_FLAGS = Object.freeze({
  gta5rp: Object.freeze({
    "male|mp_m_gta5rp_skins2|12": "beard",
    "male|mp_m_gta5rp_skins2|13": "beard",
    "male|mp_m_gta5rp_skins2|14": "beard",
    "male|mp_m_gta5rp_skins2|15": "moustache",
    "male|mp_m_gta5rp_skins2|16": "beard",
    "male|mp_m_gta5rp_skins2|17": "moustache",
    "male|mp_m_gta5rp_skins2|18": "beard",
    "male|mp_m_gta5rp_skins2|19": "beard",
  }),
  majestic: Object.freeze({}),
  rmrp: Object.freeze({}),
});
