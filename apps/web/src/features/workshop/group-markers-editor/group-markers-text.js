/*
 * Строки «Групповых меток», что зависят от числа и падежа, — функцией по языку окна
 * (как `features/reshade/reshade-copy.js`): «3 метки из 12», «1 marker of 12».
 */

import { EDITOR_GROUP_MARKERS } from "./group-markers-project.js";

function slavic(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const COUNTS = Object.freeze({
  ru: (count, total) => `${count} ${slavic(count, "метка", "метки", "меток")} из ${total}`,
  uk: (count, total) => `${count} ${slavic(count, "мітка", "мітки", "міток")} з ${total}`,
  en: (count, total) => `${count} ${count === 1 ? "marker" : "markers"} of ${total}`,
  de: (count, total) => `${count} ${count === 1 ? "Markierung" : "Markierungen"} von ${total}`,
  pl: (count, total) => `${count} ${count === 1 ? "znacznik" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "znaczniki" : "znaczników"} z ${total}`,
  fr: (count, total) => `${count} ${count === 0 || count === 1 ? "marqueur" : "marqueurs"} sur ${total}`,
});

const AS_IN_GAME = Object.freeze({ ru: "как в игре", uk: "як у грі", en: "as in the game", de: "wie im Spiel", pl: "jak w grze", fr: "comme dans le jeu" });
/* У fr в конце неразрывный пробел: `inGameLine` ставит после подписи «: », а по-французски двоеточию нужен неразрывный пробел перед ним. */
const IN_GAME = Object.freeze({ ru: "В игре", uk: "У грі", en: "In the game", de: "Im Spiel", pl: "W grze", fr: "Dans le jeu\u00a0" });
const INSTALLED = Object.freeze({
  ru: (summary) => `Групповые метки установлены: ${summary}. Перезапустите игру.`,
  uk: (summary) => `Групові мітки встановлено: ${summary}. Перезапустіть гру.`,
  en: (summary) => `Group markers installed: ${summary}. Restart the game.`,
  de: (summary) => `Gruppenmarkierungen installiert: ${summary}. Starte das Spiel neu.`,
  pl: (summary) => `Znaczniki grupowe zainstalowane: ${summary}. Uruchom grę ponownie.`,
  fr: (summary) => `Marqueurs de groupe installés\u00a0: ${summary}. Redémarrez le jeu.`,
});

const GIF_PLAYS = Object.freeze({
  ru: (count) => `Гифка: ${count} ${slavic(count, "кадр", "кадра", "кадров")} — в игре играет.`,
  uk: (count) => `Гіфка: ${count} ${slavic(count, "кадр", "кадри", "кадрів")} — у грі грає.`,
  en: (count) => `GIF: ${count} ${count === 1 ? "frame" : "frames"} — it plays in the game.`,
  de: (count) => `GIF: ${count} ${count === 1 ? "Bild" : "Bilder"} — im Spiel wird sie abgespielt.`,
  pl: (count) => `Gif: ${count} ${count === 1 ? "klatka" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "klatki" : "klatek"} — w grze jest odtwarzany.`,
  fr: (count) => `GIF\u00a0: ${count} ${count === 0 || count === 1 ? "image" : "images"} — lecture dans le jeu.`,
});

const pick = (table, language) => table[language] || table.ru;

/** «3 метки из 12» на языке окна; без правок — «как в игре». */
export function markCountText(language, count) {
  return count ? pick(COUNTS, language)(count, EDITOR_GROUP_MARKERS.length) : pick(AS_IN_GAME, language);
}

/** «В игре: 3 метки из 12.» — строка состояния кадра. */
export function inGameLine(language, count) {
  return `${pick(IN_GAME, language)}: ${markCountText(language, count)}.`;
}

/** «Гифка: 12 кадров — в игре играет.» — у накладки радара, чьи кадры прочитаны. */
export const gifPlaysText = (language, count) => pick(GIF_PLAYS, language)(count);

/** Строка о том, что поставлено. */
export const installedText = (language, count) => pick(INSTALLED, language)(markCountText(language, count));
