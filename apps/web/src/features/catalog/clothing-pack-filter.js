/*
 * Фильтр «Проект» раздела «Одежда» каталога: Все / GTA 5 RP / Nova RP / Majestic (слово владельца 14.11.2026: «чтобы можно было выбрать шмотки с GTA 5 РП, с новой РП или же с Majestic»).
 *
 * Тот же орган, что у фильтра пола, — вторая группа под чертой в меню порядка «Новые ▾». Обычный отбор: стартовое значение «Все», с полом и видом вещи сочетается, ни с чем не связан,
 * помнится в памяти раздела (`catalog:pack`, до закрытия окна). Работы авторов (не из паков проектов) видны при «Все»; отдельного пункта для них нет.
 *
 * Признак проекта — слаг карточки, одна функция `projectOfCard` (`packages/clothing/card-project.js`). Пункт проекта виден, только когда в каталоге есть хотя бы одна его карточка: «Majestic»
 * появится сам, когда выйдут его карточки. Имена проектов — имена собственные, не переводятся.
 *
 * Не путать с выбором «на каком сервере я играю» (`catalog-projects.js`, видимость по серверу): другое поле, другая память, другие слова.
 */

import {
  CARD_PROJECTS,
  cardProject,
  projectOfCard,
} from "@modovik/clothing/card-project";
import { clothingOf } from "../clothing/clothing-catalog.js";
import { ALL_PROJECTS, listedForProject } from "./catalog-projects.js";

/** Раздел каталога, где есть фильтр проекта. */
export const PACK_FILTERED = "clothing";

/** Какие проекты представлены в каталоге одеждой (их id, в порядке `CARD_PROJECTS`): по ним строятся пункты меню. */
export function packsPresent(mods = [], project = ALL_PROJECTS) {
  const found = new Set();
  for (const mod of mods) {
    const id = projectOfCard(mod);
    /* Только те, что подходят выбранному проекту (глобус): при Majestic пункта «GTA 5 RP» нет, и второй фильтр не может противоречить первому (пустая выдача). */
    if (id && clothingOf(mod) && listedForProject(mod, project)) found.add(id);
  }
  return CARD_PROJECTS.filter((project) => found.has(project.id)).map(
    (project) => project.id,
  );
}

/** Выбранное значение, если оно ещё есть в каталоге; иначе — `""` («Все»): запомненный проект без карточек тупика не делает. */
export const packChoiceOf = (shown, present) =>
  present.includes(shown) ? shown : "";

/** Фильтр проекта раздела `category` для выдачи: id проекта или пусто (нет такого фильтра у раздела, «Все», проекта нет в каталоге). */
export const packFilterOf = (category, shown, present) =>
  category === PACK_FILTERED ? packChoiceOf(shown, present) : "";

/** Группа «Проект» для меню порядка или `null`, пока в каталоге нет ни одной карточки проекта (тогда группы нет вовсе). `words` — слова каталога на языке окна, `heading` — «Проект» на языке окна. */
export function packGroupOf(words, heading, shown, present) {
  if (!present.length) return null;
  return {
    heading,
    field: "pack",
    value: packChoiceOf(shown, present),
    items: [
      ["", words.genderAll],
      ...present.map((id) => [id, cardProject(id).name]),
    ],
  };
}
