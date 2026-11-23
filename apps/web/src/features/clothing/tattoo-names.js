/*
 * Как зовут тату на экране (17.11.2026, решение владельца: названия вещей игры — на языке окна). Тату салона называется так, как его называет сама GTA V на этом языке: Desktop читает строки всех языков игры (`titles`),
 * окно берёт строку по цепочке языка (`@modovik/clothing/game-names`; у украинского игры нет — английская). У тату без строки игры — слово вида, номер и коллекция на языке окна («Tattoo №7 · Bikers»). `title`
 * остаётся русским, как был: это запасное название для ответа без `titles` и ключ группировки. У грима и блэкворка имён в данных нет, имя собрано нами: оно идёт через словарь.
 */

import { facialTitle } from "@modovik/clothing/facial-overlays";
import { pickGameName } from "@modovik/clothing/game-names";
import { currentUiLanguage, tr } from "../../locales/ui.js";
import { shownShop } from "./item-title.js";

const KIND_WORDS = Object.freeze({ award: "Награда", tattoo: "Тату" });

/* `withShelf` — дописать коллекцию безымянному тату. Плитка и строка выбора коллекцию показывают отдельной строкой (`tattooSource`), и в имени она была бы второй раз. */
function gameTattooTitle(tattoo, withShelf) {
  const game = pickGameName(tattoo.titles, currentUiLanguage());
  if (game) return game;
  const word = KIND_WORDS[tattoo.kind];
  if (word && Number.isInteger(tattoo.number)) return `${tr(word)} №${tattoo.number}${withShelf && tattoo.collectionTitle ? ` · ${shownShop(tattoo.collectionTitle)}` : ""}`;
  return tattoo.title || "";
}

const titleOf = (tattoo, withShelf) => (tattoo?.facial ? facialTitle(tattoo.facial, tr) : tattoo?.blackwork ? tr(tattoo.title) : tattoo ? gameTattooTitle(tattoo, withShelf) : "");

/** Имя тату там, где коллекция стоит рядом отдельной строкой (плитки, строки выбора). */
export const tattooTitle = (tattoo) => titleOf(tattoo, false);

/** Имя тату там, где коллекции рядом нет («Автор положил её на …», «Снимется из игры», выбранное тату): безымянному дописана коллекция. */
export const tattooLongTitle = (tattoo) => titleOf(tattoo, true);

/** Откуда тату: коллекция игры; у грима — вид наложения. */
export const tattooSource = (tattoo) => (tattoo?.facial ? tr("Грим персонажа") : tattoo?.collectionTitle ? shownShop(tattoo.collectionTitle) : "");
