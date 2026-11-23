/*
 * Доп. модели вещи проекта по данным разбора (ветка hair-beard-alternates, 15.11.2026): `hair_005_u_2.ydd`, `_3`… — игра подставляет их вместо основной модели при шапке, маске, куртке (`pedalternatevariations.meta`
 * проекта, `model-variants.js`). У вещи собственной коллекции проекта (`gta5rp_skins2…`) файлов в игре игрока нет, оглавление игры её доп. моделей не знает, поэтому имена берутся из таблиц разбора паков
 * склада (`project-alternates-data.js`, генератор `scripts/build-project-alternates.mjs`). Чистый JS: главный процесс (`normalizeReplaceTarget`) и тесты; в бандл окна не идёт.
 */

import { PROJECT_ALTERNATES } from "./project-alternates-data.js";

/** Коллекция вещи — папка без префикса персонажа: `mp_m_freemode_01_mp_m_gta5rp_skins2` → `mp_m_gta5rp_skins2`. */
const collectionOf = (folder) =>
  String(folder || "")
    .toLowerCase()
    .replace(/^mp_[mf]_freemode_01_/, "");

/** Ключ данных вещи: `<пол>|<коллекция>|<вид>|<номер>`; `null`, если не хватает полей. */
export function alternatesKeyOf(target) {
  const gender =
    target?.gender === "female"
      ? "female"
      : target?.gender === "male"
        ? "male"
        : null;
  const folder = String(target?.folder || "");
  const drawable = Number(target?.drawable);
  const component = String(target?.component || "").toLowerCase();
  if (!gender || !folder || !component || !Number.isInteger(drawable))
    return null;
  return `${gender}|${collectionOf(folder)}|${component}|${drawable}`;
}

/**
 * Имена доп. моделей вещи проекта (`["hair_005_u_2.ydd", "hair_005_u_3.ydd"]`, по возрастанию номера варианта) или `[]` — вещи в данных нет, пропс или цвет вещи. `table` — подмена в тестах (`{ проект: { ключ: [имена] } }`).
 * Данные ключуются коллекцией: штатная вещь игры (папка `mp_m_freemode_01` без коллекции) в них не бывает, её доп. модели знает оглавление игры.
 */
export function projectAlternatesOf(target, table = PROJECT_ALTERNATES) {
  if (
    !target ||
    target.prop ||
    target.colour ||
    Array.isArray(target.drawables)
  )
    return [];
  const key = alternatesKeyOf(target);
  if (!key) return [];
  /* Проект вещи известен — смотрим его таблицу; окно старого вида проекта не несёт — все таблицы (коллекции проектов не пересекаются). */
  const own =
    typeof target.server === "string" && table[target.server]
      ? [table[target.server]]
      : Object.values(table);
  for (const projectTable of own) {
    const names = projectTable[key];
    if (Array.isArray(names)) return [...names];
  }
  return [];
}
