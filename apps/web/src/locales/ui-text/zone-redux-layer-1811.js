/*
 * Установленный редукс на новом пути (dlc + слой): состояние и «Выключить / Включить / Освободить место»
 * (`features/catalog/redux-layer/`, волна `speed/redux-usable`, 18.11.2026). Русская строка → [uk, en, de, pl].
 * Французский — `fr/zone-redux-layer-1811.js`. «Выключить» и «Включить» уже есть в словаре (`zone-runs2.js`, `zone-h26-sound-mix.js`).
 */
export const zoneReduxLayer1811 = {
  "Редукс включён. Его файлы занимают {size}.": [
    "Редукс увімкнено. Його файли займають {size}.",
    "The redux is on. Its files take up {size}.",
    "Der Redux ist eingeschaltet. Seine Dateien belegen {size}.",
    "Redux jest włączony. Jego pliki zajmują {size}.",
  ],
  "Редукс выключен. Его файлы лежат в игре и занимают {size}.": [
    "Редукс вимкнено. Його файли лежать у грі й займають {size}.",
    "The redux is off. Its files stay in the game and take up {size}.",
    "Der Redux ist ausgeschaltet. Seine Dateien liegen im Spiel und belegen {size}.",
    "Redux jest wyłączony. Jego pliki leżą w grze i zajmują {size}.",
  ],
  "Выключаю…": ["Вимикаю…", "Turning off…", "Wird ausgeschaltet…", "Wyłączam…"],
  "Включаю…": ["Вмикаю…", "Turning on…", "Wird eingeschaltet…", "Włączam…"],
  "Освободить место": ["Звільнити місце", "Free up space", "Speicherplatz freigeben", "Zwolnij miejsce"],
  "Освобождаю место…": ["Звільняю місце…", "Freeing up space…", "Speicher wird freigegeben…", "Zwalniam miejsce…"],
  "Файлы редукса будут удалены из игры. Включить его снова можно только загрузкой заново.": [
    "Файли редуксу буде видалено з гри. Увімкнути його знову можна лише повторним завантаженням.",
    "The redux files will be removed from the game. You can turn it on again only by downloading it again.",
    "Die Redux-Dateien werden aus dem Spiel entfernt. Er lässt sich nur durch erneutes Herunterladen wieder einschalten.",
    "Pliki reduxa zostaną usunięte z gry. Włączyć go ponownie można tylko przez ponowne pobranie.",
  ],
  /* Отказы (семейства `redux-*` в `utils/installFailure.js`): что случилось и что делать. */
  "Файл игры изменился вне Astral, и редукс нельзя переключить": [
    "Файл гри змінився поза Astral, і редукс не можна переключити",
    "A game file was changed outside Astral, so the redux cannot be switched",
    "Eine Spieldatei wurde außerhalb von Astral geändert, daher lässt sich der Redux nicht umschalten",
    "Plik gry został zmieniony poza Astral, więc reduxa nie można przełączyć",
  ],
  "Откройте Настройки → Игра и нажмите «{restore}» — Astral вернёт слой редукса. Игра не тронута.": [
    "Відкрийте Налаштування → Гра й натисніть «{restore}» — Astral поверне шар редуксу. Гру не чіпано.",
    "Open Settings → Game and press “{restore}” — Astral will bring the redux layer back. The game is untouched.",
    "Öffnen Sie Einstellungen → Spiel und drücken Sie „{restore}“ — Astral stellt die Redux-Ebene wieder her. Das Spiel bleibt unberührt.",
    "Otwórz Ustawienia → Gra i naciśnij „{restore}” — Astral przywróci warstwę reduxa. Gra nie została ruszona.",
  ],
  "Файлы редукса пропали или повреждены": [
    "Файли редуксу зникли або пошкоджені",
    "The redux files are missing or damaged",
    "Die Redux-Dateien fehlen oder sind beschädigt",
    "Pliki reduxa zniknęły lub są uszkodzone",
  ],
  "Откройте Настройки → Игра и нажмите «{restore}» — Astral уберёт повреждённое, и редукс можно будет поставить заново.": [
    "Відкрийте Налаштування → Гра й натисніть «{restore}» — Astral прибере пошкоджене, і редукс можна буде встановити заново.",
    "Open Settings → Game and press “{restore}” — Astral will remove what is damaged, and you can install the redux again.",
    "Öffnen Sie Einstellungen → Spiel und drücken Sie „{restore}“ — Astral entfernt das Beschädigte, und Sie können den Redux neu installieren.",
    "Otwórz Ustawienia → Gra i naciśnij „{restore}” — Astral usunie uszkodzone pliki i będzie można zainstalować reduxa ponownie.",
  ],
  "Этот редукс нельзя выключить или снять: поверх него лежит другой": [
    "Цей редукс не можна вимкнути чи зняти: поверх нього лежить інший",
    "This redux cannot be turned off or removed: another one sits on top of it",
    "Dieser Redux lässt sich nicht ausschalten oder entfernen: Ein anderer liegt darüber",
    "Tego reduxa nie można wyłączyć ani usunąć: leży na nim inny",
  ],
  "Сначала выключите или снимите редукс, который поставлен позже, потом этот. Игра не тронута.": [
    "Спершу вимкніть або зніміть редукс, який встановлено пізніше, потім цей. Гру не чіпано.",
    "First turn off or remove the redux that was installed later, then this one. The game is untouched.",
    "Schalten Sie zuerst den später installierten Redux aus oder entfernen Sie ihn, dann diesen. Das Spiel bleibt unberührt.",
    "Najpierw wyłącz lub usuń reduxa zainstalowanego później, potem ten. Gra nie została ruszona.",
  ],
  "Astral не смог переключить редукс": [
    "Astral не зміг переключити редукс",
    "Astral could not switch the redux",
    "Astral konnte den Redux nicht umschalten",
    "Astral nie zdołał przełączyć reduxa",
  ],
  "Игра не тронута. Закройте игру и лаунчеры и повторите. Если снова не вышло, откройте Настройки → Игра и нажмите «{restore}».": [
    "Гру не чіпано. Закрийте гру й лаунчери та повторіть. Якщо знову не вийшло, відкрийте Налаштування → Гра й натисніть «{restore}».",
    "The game is untouched. Close the game and the launchers and try again. If it fails again, open Settings → Game and press “{restore}”.",
    "Das Spiel bleibt unberührt. Schließen Sie das Spiel und die Launcher und versuchen Sie es erneut. Klappt es wieder nicht, öffnen Sie Einstellungen → Spiel und drücken Sie „{restore}“.",
    "Gra nie została ruszona. Zamknij grę i launchery i spróbuj ponownie. Jeśli znowu się nie uda, otwórz Ustawienia → Gra i naciśnij „{restore}”.",
  ],
};
