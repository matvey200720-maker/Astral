/*
 * Слова «на GTA 5 RP это не видно» (21.11.2026): режим RP включился сам, контейнерный маршрут отказал, работа поставилась прежним пакетом `astral_*`,
 * которого клиент RAGE MP не подключает. Показываются строкой в ряду установки (`features/workshop/install-queue/tasks/rp-update-notes.js`, `rpFallbackNote`) по структурному
 * признаку из главного процесса (`apps/desktop/src/rp-fallback.js`): окно переводит причину, кодов в слова не попадает. Русская строка → [uk, en, de, pl]; французский — `fr/zone-rp-fallback-2111.js`.
 * Сроков не обещаем.
 */
export const zoneRpFallback2111 = {
  "Этот готовый вариант пока не помещается в файл игры.": [
    "Цей готовий варіант поки що не вміщується у файл гри.",
    "This ready-made option does not fit into the game file yet.",
    "Diese fertige Variante passt noch nicht in die Spieldatei.",
    "Ten gotowy wariant na razie nie mieści się w pliku gry.",
  ],
  "Общий цвет, яркость или износ касаются всего сразу, и на GTA 5 RP такая правка пока не помещается.": [
    "Спільний колір, яскравість чи зношеність стосуються всього одразу, і на GTA 5 RP таке редагування поки що не вміщується.",
    "A shared colour, brightness or wear affects everything at once, and on GTA 5 RP such an edit does not fit yet.",
    "Eine gemeinsame Farbe, Helligkeit oder Abnutzung betrifft alles auf einmal, und auf GTA 5 RP passt eine solche Änderung noch nicht hinein.",
    "Wspólny kolor, jasność lub zużycie dotyczą wszystkiego naraz, a na GTA 5 RP taka zmiana na razie się nie mieści.",
  ],
  "В этой работе есть части, которые на GTA 5 RP пока не ставятся.": [
    "У цій роботі є частини, які на GTA 5 RP поки що не встановлюються.",
    "This work has parts that cannot be installed on GTA 5 RP yet.",
    "Diese Arbeit enthält Teile, die sich auf GTA 5 RP noch nicht installieren lassen.",
    "W tej pracy są części, które na GTA 5 RP na razie się nie instalują.",
  ],
  /* Одна строка на отказ режима и на запасной путь (22.11.2026): места и кнопки подставляются из словаря окна (`{0}` Мастерская, `{1}` Дороги, `{2}` Растительность, `{3}` Ещё, `{4}` Снять из игры), поэтому здесь они не переведены своими словами. */
  "Дороги или растительность Astral уже установлены прежним способом, поэтому на GTA 5 RP их не видно. Чтобы они там появились, снимите их: {0} → {1} или {2} → «{3}» → «{4}», затем примените заново.": [
    "Дороги або рослинність Astral уже встановлені попереднім способом, тому на GTA 5 RP їх не видно. Щоб вони там з’явилися, зніміть їх: {0} → {1} або {2} → «{3}» → «{4}», потім застосуйте заново.",
    "Astral roads or vegetation are already installed the old way, so they are not visible on GTA 5 RP. To get them there, remove them: {0} → {1} or {2} → “{3}” → “{4}”, then apply again.",
    "Astral-Straßen oder -Vegetation sind schon auf die alte Weise installiert, deshalb sind sie auf GTA 5 RP nicht zu sehen. Damit sie dort erscheinen, entferne sie: {0} → {1} oder {2} → „{3}“ → „{4}“, und wende sie dann erneut an.",
    "Drogi lub roślinność Astral są już zainstalowane starym sposobem, więc na GTA 5 RP ich nie widać. Aby pojawiły się tam, usuń je: {0} → {1} lub {2} → „{3}” → „{4}”, a potem zastosuj ponownie.",
  ],
  "Эти места перекрывают файлы игры, которые на GTA 5 RP пока не ставятся.": [
    "Ці місця перекривають файли гри, які на GTA 5 RP поки що не встановлюються.",
    "These places override game files that cannot be installed on GTA 5 RP yet.",
    "Diese Orte überschreiben Spieldateien, die sich auf GTA 5 RP noch nicht installieren lassen.",
    "Te miejsca nadpisują pliki gry, które na GTA 5 RP na razie się nie instalują.",
  ],
  "Эту работу пока нельзя поставить для GTA 5 RP.": [
    "Цю роботу поки що не можна встановити для GTA 5 RP.",
    "This work cannot be installed for GTA 5 RP yet.",
    "Diese Arbeit lässt sich noch nicht für GTA 5 RP installieren.",
    "Tej pracy na razie nie można zainstalować dla GTA 5 RP.",
  ],
  "Установлено прежним способом: в сюжетной игре работа есть, на GTA 5 RP её не видно.": [
    "Встановлено попереднім способом: у сюжетній грі робота є, на GTA 5 RP її не видно.",
    "Installed the old way: the work is in the story game, but it is not visible on GTA 5 RP.",
    "Auf die alte Weise installiert: Die Arbeit ist im Story-Modus vorhanden, auf GTA 5 RP aber nicht sichtbar.",
    "Zainstalowano starym sposobem: praca jest w grze fabularnej, ale na GTA 5 RP jej nie widać.",
  ],
};
