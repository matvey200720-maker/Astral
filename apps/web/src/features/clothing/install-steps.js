import { tr } from "../../locales/ui.js";

/*
 * Слова шагов окна «Сделать заменёнку» — путь «Витрина» (15.11.2026): «Сделать заменёнку · шаг 1 из 2», «Дальше», «К вещам». У мода с одной раскраской шаг один, и номера в подписи нет.
 * Шесть языков окна: ru, uk, en, de, pl, fr; «шаг N из M» — функцией по языку, остальные слова — через `tr()` (`locales/ui-text/zone-port-card-1511.js`).
 */

const CODES = ["ru", "uk", "en", "de", "pl", "fr"];

const STEP = {
  ru: (step, total) => `шаг ${step} из ${total}`,
  uk: (step, total) => `крок ${step} з ${total}`,
  en: (step, total) => `step ${step} of ${total}`,
  de: (step, total) => `Schritt ${step} von ${total}`,
  pl: (step, total) => `krok ${step} z ${total}`,
  fr: (step, total) => `étape ${step} sur ${total}`,
};

/* Кнопка шага: в общем словаре у «Дальше» английское «Farther» (карта, «дальше от камеры») — для шага мастера нужно «Next». */
const NEXT = { ru: "Дальше", uk: "Далі", en: "Next", de: "Weiter", pl: "Dalej", fr: "Suivant" };

const codeOf = (language) => {
  const code = String(language ?? "ru")
    .slice(0, 2)
    .toLowerCase();
  return CODES.includes(code) ? code : "en";
};

/** Слова окна по языку: `kicker(шаг, всего)`, `next`, `back`. */
export function installStepWords(language) {
  const code = codeOf(language);
  return {
    kicker: (step, total) =>
      total > 1
        ? `${tr("Сделать заменёнку")} · ${STEP[code](step, total)}`
        : tr("Сделать заменёнку"),
    next: NEXT[code],
    back: tr("К вещам"),
  };
}
