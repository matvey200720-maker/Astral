import { reduxDetailSlotIdsFor } from "../../workshop-redux-subcategories.js";
import { SOUND_HIT_SLOTS } from "../workshop/sound-kit-record.js";

/*
 * Звук на полке библиотеки — не одной карточкой «Звуки», а тем, что стоит
 * в игре, по отдельности: звуки оружия, звук попадания в голову, звук
 * попадания в тело (и музыка, сирены, окружение, если стоят они).
 *
 * В мастерской звук — одна плитка: из неё открывается студия со всеми
 * разделами. Библиотека отвечает на другой вопрос — что сейчас в игре и что
 * из этого убрать, — и одна карточка на всё прятала бы, что именно стоит:
 * человек, поставивший только хедшот, видел бы «Звуки» и не знал, уйдёт ли
 * с ними звук тела.
 *
 * Карточек головы и тела нет в каталоге: это части одной работы студии, а не
 * разделы модов. Поэтому их слоты живут здесь, а не в таксономии каталога.
 */

const HIT_SLOT_COPY = Object.freeze({
  head: {
    title: {
      ru: "Звук попадания в голову", uk: "Звук влучання в голову",
      en: "Headshot sound",
      de: "Kopftreffer-Sound",
      pl: "Dźwięk trafienia w głowę",
      fr: "Son d’impact à la tête",
    },
    description: {
      ru: "Звучит при каждом попадании в голову", uk: "Звучить при кожному влученні в голову",
      en: "Plays on every headshot",
      de: "Ertönt bei jedem Kopftreffer",
      pl: "Odtwarzany przy każdym trafieniu w głowę",
      fr: "Joué à chaque impact à la tête",
    },
  },
  body: {
    title: {
      ru: "Звук попадания в тело", uk: "Звук влучання в тіло",
      en: "Body hit sound",
      de: "Körpertreffer-Sound",
      pl: "Dźwięk trafienia w ciało",
      fr: "Son d’impact sur le corps",
    },
    description: {
      ru: "Звучит при попадании в туловище, руки и ноги", uk: "Звучить при влученні в тулуб, руки й ноги",
      en: "Plays on hits to the torso, arms and legs",
      de: "Ertönt bei Treffern in Rumpf, Arme und Beine",
      pl: "Odtwarzany przy trafieniach w tułów, ręce i nogi",
      fr: "Joué lors des impacts sur le torse, les bras et les jambes",
    },
  },
});

export const LIBRARY_SOUND_HIT_SLOTS = Object.freeze(
  Object.entries(SOUND_HIT_SLOTS).map(([part, id]) =>
    Object.freeze({ id, ...HIT_SLOT_COPY[part] }),
  ),
);

/**
 * Корни полки библиотеки: плитка «Звуки» раскладывается на свои карточки.
 *
 * @param {object[]} roots корневые плитки графики
 * @param {object[]} slots все плитки графики — среди них детальные
 *   («Звуки оружия», «Спецсигналы», «Музыка при загрузке»…)
 */
export function libraryRootSlots(roots, slots) {
  const known = new Map([
    ...slots.map((slot) => [slot.id, slot]),
    ...LIBRARY_SOUND_HIT_SLOTS.map((slot) => [slot.id, slot]),
  ]);
  return roots.flatMap((slot) =>
    slot.id === "sounds"
      ? reduxDetailSlotIdsFor("sounds")
          .map((id) => known.get(id))
          .filter(Boolean)
      : [slot],
  );
}
