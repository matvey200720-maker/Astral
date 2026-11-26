/*
 * HUD и серверы (26.11.2026): «прежние настройки остались в игре» — замена прежней версии, чьи записи новая не переписала,
 * а снять её мешает глубокая стопка (`features/library/retire-previous.js`, `LEFTOVERS_KEPT_MESSAGE`); и что меняет
 * «Не затухает» у прицела (`reticle/ReticleInspector.jsx`). Русская строка → [uk, en, de, pl]; французский —
 * `fr/zone-hud-majestic-2611.js`.
 */
export const zoneHudMajestic2611 = {
  "Часть настроек прежней версии осталась в игре: она лежит под многими модами. Снимите все записи этой работы в «Загрузках» и нажмите «Применить» ещё раз.":
    [
      "Частина налаштувань попередньої версії залишилася в грі: вона лежить під багатьма модами. Зніміть усі записи цієї роботи в «Завантаженнях» і натисніть «Застосувати» ще раз.",
      "Some settings from the previous version are still in the game: it sits under many mods. Remove every entry of this work in Downloads, then press “Apply” again.",
      "Ein Teil der Einstellungen der vorherigen Version ist noch im Spiel: Sie liegt unter vielen Mods. Entfernen Sie unter „Downloads“ alle Einträge dieser Arbeit und drücken Sie erneut „Anwenden“.",
      "Część ustawień poprzedniej wersji została w grze: leży ona pod wieloma modami. Usuń w „Pobranych” wszystkie wpisy tej pracy i naciśnij „Zastosuj” jeszcze raz.",
    ],
  /* Прицел, «Видимость»: что «Не затухает» меняет в игре, а что нет (`ReticleInspector.jsx`). */
  "Отменяет только затухание прицела игры. Если сервер прячет его или рисует свой, настройка не поможет.":
    [
      "Скасовує лише згасання прицілу гри. Якщо сервер ховає його чи малює свій, це не допоможе.",
      "Only stops the game’s crosshair from dimming. If the server hides it or draws its own, this won’t help.",
      "Stoppt nur das Abdunkeln des Spiel-Fadenkreuzes. Blendet der Server es aus oder zeigt ein eigenes, hilft das nicht.",
      "Wyłącza tylko przygasanie celownika gry. Gdy serwer go ukrywa lub rysuje własny, to nie pomoże.",
    ],
};
