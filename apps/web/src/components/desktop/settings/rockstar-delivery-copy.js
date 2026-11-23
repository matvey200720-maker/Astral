/*
 * Строки раздела «Моды в копию из Rockstar Games Launcher» (задача 7) —
 * «Настройки › Игра». Каждый способ описан тремя строками: что делает,
 * сколько места, какие минусы — как просил владелец.
 */

const ru = {
  title: "Другой способ: вторая папка игры",
  intro:
    "Если режим вам не подходит: Astral собирает рядом вторую папку игры и ставит моды только в неё. Лаунчер Rockstar её не проверяет, поэтому моды не сбрасываются. Файлы оригинала при этом остаются нетронутыми.",
  copyTitle: "Вторая папка игры",
  copyIntro: (source) =>
    `Это вторая папка игры: её большие файлы — ссылки на оригинал (${source}). Лаунчер Rockstar её не проверяет, поэтому моды Astral ставятся сюда и не пропадают. Лаунчеры Majestic и RAGE (GTA 5 RP) Astral сам направляет на эту папку и возвращает прежний путь, когда папку удаляют; в остальных («Россия Онлайн») укажите путь один раз.`,
  copyPath: "Скопировать путь",
  copied: "Путь скопирован",
  methodsLabel: "Способ доставки модов",
  current: "Сейчас так",
  rows: { what: "Что делает", space: "Место", cons: "Минусы" },
  methods: {
    linked: {
      title: "Вторая папка игры",
      short: "Копия из ссылок на оригинал — моды только в ней",
      what: "Astral собирает рядом вторую папку GTA V из жёстких ссылок на файлы оригинала и ставит моды только в неё. Лаунчер Rockstar проверяет нетронутый оригинал, а лаунчер сервера запускает игру из второй папки.",
      space: (size) =>
        `Около ${size}: настоящей копией лежат только update.rpf и мелкие файлы, остальные ~100 ГБ — ссылки на те же данные. Только на том же диске, что и игра.`,
      cons: "Majestic и RAGE (GTA 5 RP) Astral направляет на эту папку сам, «Россия Онлайн» — один раз руками. Одиночную игру лаунчер Rockstar запускает из своей папки — там модов не будет. После обновления GTA вторую папку нужно обновить: кнопка появится сама. Не правьте её файлы в OpenIV — данные общие с оригиналом.",
      build: "Собрать вторую папку",
    },
    copy: {
      title: "Полная копия игры",
      short: "Отдельная копия всех файлов — для другого диска",
      what: "То же, что вторая папка, но все файлы — настоящие копии. Нужна, когда вторую папку из ссылок собрать нельзя: другой диск или файловая система без ссылок.",
      space: (size) => `Около ${size} и до получаса копирования.`,
      cons: "Много места. После обновления GTA копию нужно обновить. Majestic и RAGE Astral направит на копию сам, как и на вторую папку.",
      build: "Собрать полную копию",
    },
  },
  events: {
    missed:
      "Этот запуск прошёл без модов: игра открыла архив раньше Astral. Перезапустите игру или выберите «Вторую папку игры».",
    stale:
      "Rockstar обновил игру, а моды собраны на прежнюю версию. Нажмите «Вернуть» в «Библиотеке» — Astral соберёт их заново.",
    lost: "Лаунчер Rockstar вернул свой update.rpf во время запуска. Верните моды: «Библиотека» → «Вернуть».",
    busy: "Игра держит update.rpf — Astral подождёт, пока она закроется.",
    error: "Подмена не удалась",
    repaired:
      "Rockstar перекачал файл во время игры — моды из него слетели. Нажмите «Пересобрать».",
    "repair-in-progress":
      "Лаунчер Rockstar докачивает файлы — Astral подождёт.",
    recovered: "После сбоя Astral вернул чистые файлы игры.",
    rebuilt: "Готово: теперь «Вернуть» моды в «Библиотеке».",
  },
  errorAdvice:
    "Закройте игру, выключите режим и включите его снова. Повторится — выберите «Вторую папку игры».",
  copies: "Вторые папки этой игры",
  copyMain: "Сделать основной",
  copyIsMain: "Основная",
  copySync: "Обновить",
  copySyncing: "Обновляю…",
  copyDelete: "Удалить",
  copyDeleteConfirm: "Удалить папку",
  copyDeleteNote:
    "Удаляются только ссылки и копии второй папки — оригинал Rockstar не трогается. Моды, поставленные во вторую папку, уйдут вместе с ней.",
  copyCancel: "Отмена",
  copyOutdated: "Игра обновилась — нажмите «Обновить»",
  copyFresh: "Совпадает с оригиналом",
  chooseFolder: "Выбрать папку…",
  folder: (folder) => `Папка: ${folder}`,
  building: (done, total) => `Собираю: ${done} из ${total} файлов`,
  built:
    "Вторая папка собрана: моды Astral ставятся в неё, а Majestic и RAGE запускают игру из неё.",
  problems: {
    "other-volume":
      "Вторую папку из ссылок можно собрать только на том же диске, что и игра. Выберите папку на нём или соберите полную копию.",
    "no-space": "Не хватает места на диске.",
    "not-empty": "Папка не пуста — выберите пустую.",
    "same-folder": "Вторая папка не может лежать внутри игры.",
    "no-game": "В папке игры нет GTA5.exe.",
  },
  desktopOnly: "Способ меняется в приложении Astral.",
  modeOnNoCopy:
    "Режим включён — вторая папка не нужна. Чтобы собрать её, сначала выключите режим.",
  verified:
    "Проверено на копии Steam этого ПК: подмена архива при запуске и выходе, дозор игры, вторая папка, установка и снятие модов. На живой копии из Rockstar Games Launcher не проверялось — на ПК разработки её нет. Если в режиме Rockstar Games Launcher моды не встанут, выберите вторую папку игры.",
  otherTitle: "Почему не другие способы",
  other: [
    [
      "Папка mods и загрузчик OpenIV",
      "Только одиночная игра: серверы RP и BattlEye в GTA Online загрузчики не пускают, а RMRP запрещает этот способ прямо.",
    ],
    [
      "Офлайн-режим лаунчера",
      "Проверки файлов нет, но серверу RP нужна сеть — играть так нельзя.",
    ],
    [
      "No_GTAVLauncher и правка exe",
      "Сломано самим Rockstar с 2020 года и по сути — кряк.",
    ],
  ],
};

const uk = {
  title: "Інший спосіб: друга тека гри",
  intro:
    "Якщо режим вам не підходить: Astral збирає поруч другу теку гри й ставить моди лише в неї. Лаунчер Rockstar її не перевіряє, тому моди не скидаються. Файли оригіналу при цьому лишаються недоторканими.",
  copyTitle: "Друга тека гри",
  copyIntro: (source) =>
    `Це друга тека гри: її великі файли — посилання на оригінал (${source}). Лаунчер Rockstar її не перевіряє, тому моди Astral ставляться сюди й не зникають. Лаунчери Majestic і RAGE (GTA 5 RP) Astral сам спрямовує на цю теку й повертає попередній шлях, коли теку видаляють; в інших («Россия Онлайн») вкажіть шлях один раз.`,
  copyPath: "Скопіювати шлях",
  copied: "Шлях скопійовано",
  methodsLabel: "Спосіб доставки модів",
  current: "Зараз так",
  rows: { what: "Що робить", space: "Місце", cons: "Мінуси" },
  methods: {
    linked: {
      title: "Друга тека гри",
      short: "Копія з посилань на оригінал — моди тільки в ній",
      what: "Astral збирає поруч другу теку GTA V із жорстких посилань на файли оригіналу й ставить моди тільки в неї. Лаунчер Rockstar перевіряє незмінний оригінал, а лаунчер сервера запускає гру з другої теки.",
      space: (size) =>
        `Близько ${size}: справжньою копією лежать тільки update.rpf і дрібні файли, решта ~100 ГБ — посилання на ті самі дані. Тільки на тому ж диску, що й гра.`,
      cons: "Majestic і RAGE (GTA 5 RP) Astral спрямовує на цю теку сам, «Россия Онлайн» — один раз вручну. Одиночну гру лаунчер Rockstar запускає зі своєї теки — там модів не буде. Після оновлення GTA другу теку треба оновити: кнопка з'явиться сама. Не правте її файли в OpenIV — дані спільні з оригіналом.",
      build: "Зібрати другу теку",
    },
    copy: {
      title: "Повна копія гри",
      short: "Окрема копія всіх файлів — для іншого диска",
      what: "Те саме, що друга тека, але всі файли — справжні копії. Потрібна, коли другу теку з посилань зібрати не можна: інший диск або файлова система без посилань.",
      space: (size) => `Близько ${size} і до пів години копіювання.`,
      cons: "Багато місця. Після оновлення GTA копію треба оновити. Majestic і RAGE Astral спрямує на копію сам, як і на другу теку.",
      build: "Зібрати повну копію",
    },
  },
  events: {
    missed:
      "Цей запуск пройшов без модів: гра відкрила архів раніше за Astral. Перезапустіть гру або оберіть «Другу теку гри».",
    stale:
      "Rockstar оновив гру, а моди зібрано на попередню версію. Натисніть «Повернути» в «Бібліотеці» — Astral збере їх заново.",
    lost: "Лаунчер Rockstar повернув свій update.rpf під час запуску. Поверніть моди: «Бібліотека» → «Повернути».",
    busy: "Гра тримає update.rpf — Astral почекає, поки вона закриється.",
    error: "Підміна не вдалася",
    repaired:
      "Rockstar перекачав файл під час гри — моди з нього злетіли. Натисніть «Перезібрати».",
    "repair-in-progress": "Лаунчер Rockstar докачує файли — Astral почекає.",
    recovered: "Після збою Astral повернув чисті файли гри.",
    rebuilt: "Готово: тепер «Повернути» моди в «Бібліотеці».",
  },
  errorAdvice:
    "Закрийте гру, вимкніть режим і ввімкніть його знову. Повториться — оберіть «Другу теку гри».",
  copies: "Другі теки цієї гри",
  copyMain: "Зробити основною",
  copyIsMain: "Основна",
  copySync: "Оновити",
  copySyncing: "Оновлюю…",
  copyDelete: "Видалити",
  copyDeleteConfirm: "Видалити теку",
  copyDeleteNote:
    "Видаляються тільки посилання й копії другої теки — оригінал Rockstar не чіпається. Моди, поставлені в другу теку, підуть разом із нею.",
  copyCancel: "Скасувати",
  copyOutdated: "Гра оновилася — натисніть «Оновити»",
  copyFresh: "Збігається з оригіналом",
  chooseFolder: "Обрати теку…",
  folder: (folder) => `Тека: ${folder}`,
  building: (done, total) => `Збираю: ${done} з ${total} файлів`,
  built:
    "Другу теку зібрано: моди Astral ставляться в неї, а Majestic і RAGE запускають гру з неї.",
  problems: {
    "other-volume":
      "Другу теку з посилань можна зібрати тільки на тому ж диску, що й гра. Оберіть теку на ньому або зберіть повну копію.",
    "no-space": "Бракує місця на диску.",
    "not-empty": "Тека не порожня — оберіть порожню.",
    "same-folder": "Друга тека не може лежати всередині гри.",
    "no-game": "У теці гри немає GTA5.exe.",
  },
  desktopOnly: "Спосіб змінюється в застосунку Astral.",
  modeOnNoCopy:
    "Режим увімкнено — друга тека не потрібна. Щоб зібрати її, спочатку вимкніть режим.",
  verified:
    "Перевірено на копії Steam цього ПК: підміна архіву під час запуску й виходу, нагляд за грою, друга тека, встановлення й зняття модів. На живій копії з Rockstar Games Launcher не перевірялося — на ПК розробки її немає. Якщо в режимі Rockstar Games Launcher моди не стануть, оберіть другу теку гри.",
  otherTitle: "Чому не інші способи",
  other: [
    [
      "Тека mods і завантажувач OpenIV",
      "Тільки одиночна гра: сервери RP та BattlEye в GTA Online завантажувачі не пускають, а RMRP забороняє цей спосіб прямо.",
    ],
    [
      "Офлайн-режим лаунчера",
      "Перевірки файлів немає, але серверу RP потрібна мережа — грати так не можна.",
    ],
    [
      "No_GTAVLauncher і правка exe",
      "Зламано самим Rockstar із 2020 року, і по суті це кряк.",
    ],
  ],
};

const en = {
  title: "Another way: a second game folder",
  intro:
    "If the mode does not suit you: Astral builds a second game folder next to the game and installs mods only into it. Rockstar's launcher does not check it, so the mods are not wiped. The original files stay untouched.",
  copyTitle: "Second game folder",
  copyIntro: (source) =>
    `This is a second game folder: its large files are links to the original (${source}). Rockstar's launcher does not check it, so Astral's mods go here and stay. Astral points the Majestic and RAGE (GTA 5 RP) launchers at this folder by itself and restores their old path when the folder is removed; in others (Russia Online) set the path once.`,
  copyPath: "Copy path",
  copied: "Path copied",
  methodsLabel: "How mods are delivered",
  current: "Current",
  rows: { what: "What it does", space: "Disk space", cons: "Downsides" },
  methods: {
    linked: {
      title: "Second game folder",
      short: "A copy built from links to the original — mods only there",
      what: "Astral builds a second GTA V folder next to the game out of hard links to the original's files and installs mods only into it. Rockstar's launcher checks the untouched original, and the server launcher starts the game from the second folder.",
      space: (size) =>
        `About ${size}: only update.rpf and small files are real copies, the other ~100 GB are links to the same data. Same drive as the game only.`,
      cons: "Astral points Majestic and RAGE (GTA 5 RP) at this folder by itself; Russia Online needs it once by hand. Rockstar's launcher starts story mode from its own folder — no mods there. After a GTA update the second folder needs updating: the button appears by itself. Don't edit its files in OpenIV — the data is shared with the original.",
      build: "Build second folder",
    },
    copy: {
      title: "Full game copy",
      short: "A separate copy of every file — for another drive",
      what: "Same as the second folder, but every file is a real copy. Needed when a link folder can't be built: another drive or a file system without links.",
      space: (size) => `About ${size} and up to half an hour of copying.`,
      cons: "Lots of space. After a GTA update the copy needs updating. Like the second folder, Astral points Majestic and RAGE at the copy by itself.",
      build: "Build full copy",
    },
  },
  events: {
    missed:
      "This session ran without mods: the game opened the archive before Astral. Restart the game or pick the second game folder.",
    stale:
      "Rockstar updated the game, and the mods were built for the previous version. Press Restore in the Library — Astral rebuilds them.",
    lost: "Rockstar's launcher put its update.rpf back during start. Bring the mods back: Library → Restore.",
    busy: "The game holds update.rpf — Astral waits until it closes.",
    error: "The swap failed",
    repaired:
      "Rockstar re-downloaded a file during the game — the mods in it are gone. Press “Rebuild”.",
    "repair-in-progress":
      "The Rockstar launcher is still downloading files — Astral will wait.",
    recovered: "After a crash Astral restored the clean game files.",
    rebuilt: "Done: now “Restore” the mods in the Library.",
  },
  errorAdvice:
    "Close the game, turn the mode off and on again. If it happens again, choose “Second game folder”.",
  copies: "Second folders of this game",
  copyMain: "Make main",
  copyIsMain: "Main",
  copySync: "Update",
  copySyncing: "Updating…",
  copyDelete: "Delete",
  copyDeleteConfirm: "Delete folder",
  copyDeleteNote:
    "Only the second folder's links and copies are deleted — Rockstar's original is not touched. Mods installed into the second folder go with it.",
  copyCancel: "Cancel",
  copyOutdated: "The game was updated — press Update",
  copyFresh: "Matches the original",
  chooseFolder: "Choose folder…",
  folder: (folder) => `Folder: ${folder}`,
  building: (done, total) => `Building: ${done} of ${total} files`,
  built:
    "The second folder is ready: Astral mods go there, and Majestic and RAGE start the game from it.",
  problems: {
    "other-volume":
      "A link folder can only be built on the same drive as the game. Choose a folder there or build a full copy.",
    "no-space": "Not enough disk space.",
    "not-empty": "The folder is not empty — choose an empty one.",
    "same-folder": "The second folder can't be inside the game.",
    "no-game": "There is no GTA5.exe in the game folder.",
  },
  desktopOnly: "The method is changed in the Astral app.",
  modeOnNoCopy:
    "The mode is on — a second folder is not needed. To build one, turn the mode off first.",
  verified:
    "Tested on this PC's Steam copy: archive swap at start and exit, game watch, second folder, installing and removing mods. Not tested on a live Rockstar Games Launcher copy — the development PC doesn't have one. If the mods don't go in with the Rockstar Games Launcher mode, pick the second game folder.",
  otherTitle: "Why not other methods",
  other: [
    [
      "mods folder and OpenIV loader",
      "Story mode only: RP servers and BattlEye in GTA Online block loaders, and RMRP bans this method outright.",
    ],
    [
      "Launcher offline mode",
      "No file check, but an RP server needs the network — you can't play that way.",
    ],
    [
      "No_GTAVLauncher and exe patches",
      "Broken by Rockstar since 2020 and essentially a crack.",
    ],
  ],
};

const de = {
  title: "Anderer Weg: ein zweiter Spielordner",
  intro:
    "Falls der Modus nicht zu Ihnen passt: Astral baut neben dem Spiel einen zweiten Spielordner und installiert Mods nur dort. Der Rockstar-Launcher prüft ihn nicht, deshalb werden die Mods nicht zurückgesetzt. Die Originaldateien bleiben unberührt.",
  copyTitle: "Zweiter Spielordner",
  copyIntro: (source) =>
    `Das ist ein zweiter Spielordner: Seine großen Dateien sind Links auf das Original (${source}). Der Rockstar-Launcher prüft ihn nicht, daher landen Astrals Mods hier und bleiben. Die Launcher von Majestic und RAGE (GTA 5 RP) richtet Astral selbst auf diesen Ordner aus und stellt ihren alten Pfad wieder her, wenn der Ordner entfernt wird; in anderen (Russia Online) gib den Pfad einmal an.`,
  copyPath: "Pfad kopieren",
  copied: "Pfad kopiert",
  methodsLabel: "Wie Mods ins Spiel kommen",
  current: "Aktuell",
  rows: { what: "Was es tut", space: "Speicherplatz", cons: "Nachteile" },
  methods: {
    linked: {
      title: "Zweiter Spielordner",
      short: "Eine Kopie aus Links auf das Original — Mods nur dort",
      what: "Astral baut neben dem Spiel einen zweiten GTA-V-Ordner aus harten Links auf die Originaldateien und installiert Mods nur dort. Der Rockstar-Launcher prüft das unberührte Original, der Server-Launcher startet das Spiel aus dem zweiten Ordner.",
      space: (size) =>
        `Etwa ${size}: Nur update.rpf und kleine Dateien sind echte Kopien, die übrigen ~100 GB sind Links auf dieselben Daten. Nur auf demselben Laufwerk wie das Spiel.`,
      cons: "Majestic und RAGE (GTA 5 RP) richtet Astral selbst auf diesen Ordner aus; Russia Online braucht ihn einmal von Hand. Den Storymodus startet der Rockstar-Launcher aus seinem eigenen Ordner — dort gibt es keine Mods. Nach einem GTA-Update muss der zweite Ordner aktualisiert werden: Der Knopf erscheint von selbst. Bearbeite seine Dateien nicht in OpenIV — die Daten teilt er mit dem Original.",
      build: "Zweiten Ordner bauen",
    },
    copy: {
      title: "Vollständige Spielkopie",
      short: "Eine eigene Kopie aller Dateien — für ein anderes Laufwerk",
      what: "Wie der zweite Ordner, aber alle Dateien sind echte Kopien. Nötig, wenn sich kein Link-Ordner bauen lässt: anderes Laufwerk oder Dateisystem ohne Links.",
      space: (size) => `Etwa ${size} und bis zu einer halben Stunde Kopieren.`,
      cons: "Viel Platz. Nach einem GTA-Update muss die Kopie aktualisiert werden. Wie beim zweiten Ordner richtet Astral Majestic und RAGE selbst auf die Kopie aus.",
      build: "Vollständige Kopie bauen",
    },
  },
  events: {
    missed:
      "Diese Sitzung lief ohne Mods: Das Spiel hat das Archiv vor Astral geöffnet. Starte das Spiel neu oder wähle den zweiten Spielordner.",
    stale:
      "Rockstar hat das Spiel aktualisiert, die Mods sind für die alte Version gebaut. Drücke in der Bibliothek auf „Zurückholen“ — Astral baut sie neu.",
    lost: "Der Rockstar-Launcher hat beim Start seine update.rpf zurückgelegt. Hol die Mods zurück: Bibliothek → „Zurückholen“.",
    busy: "Das Spiel hält update.rpf — Astral wartet, bis es geschlossen ist.",
    error: "Der Tausch ist fehlgeschlagen",
    repaired:
      "Rockstar hat eine Datei im Spiel neu geladen — die Mods darin sind weg. „Neu aufbauen“ drücken.",
    "repair-in-progress":
      "Der Rockstar-Launcher lädt noch Dateien nach — Astral wartet.",
    recovered:
      "Nach einem Absturz hat Astral die sauberen Spieldateien zurückgesetzt.",
    rebuilt: "Fertig: jetzt die Mods in der Bibliothek „Wiederherstellen“.",
  },
  errorAdvice:
    "Schließen Sie das Spiel, schalten Sie den Modus aus und wieder ein. Passiert es erneut, wählen Sie „Zweiter Spielordner“.",
  copies: "Zweite Ordner dieses Spiels",
  copyMain: "Als Haupt setzen",
  copyIsMain: "Haupt",
  copySync: "Aktualisieren",
  copySyncing: "Aktualisiere…",
  copyDelete: "Löschen",
  copyDeleteConfirm: "Ordner löschen",
  copyDeleteNote:
    "Gelöscht werden nur Links und Kopien des zweiten Ordners — Rockstars Original bleibt unberührt. Mods im zweiten Ordner gehen mit ihm.",
  copyCancel: "Abbrechen",
  copyOutdated: "Das Spiel wurde aktualisiert — drücke „Aktualisieren“",
  copyFresh: "Stimmt mit dem Original überein",
  chooseFolder: "Ordner wählen…",
  folder: (folder) => `Ordner: ${folder}`,
  building: (done, total) => `Baue: ${done} von ${total} Dateien`,
  built:
    "Der zweite Ordner ist fertig: Astral-Mods landen dort, und Majestic und RAGE starten das Spiel von dort.",
  problems: {
    "other-volume":
      "Einen Link-Ordner gibt es nur auf demselben Laufwerk wie das Spiel. Wähle dort einen Ordner oder baue eine vollständige Kopie.",
    "no-space": "Nicht genug Speicherplatz.",
    "not-empty": "Der Ordner ist nicht leer — wähle einen leeren.",
    "same-folder": "Der zweite Ordner darf nicht im Spiel liegen.",
    "no-game": "Im Spielordner fehlt GTA5.exe.",
  },
  desktopOnly: "Die Methode wird in der Astral-App geändert.",
  modeOnNoCopy:
    "Der Modus ist eingeschaltet — ein zweiter Ordner wird nicht gebraucht. Um ihn anzulegen, schalten Sie zuerst den Modus aus.",
  verified:
    "Getestet auf der Steam-Kopie dieses PCs: Archivtausch bei Start und Ende, Spielüberwachung, zweiter Ordner, Installieren und Entfernen von Mods. Nicht getestet auf einer echten Kopie aus dem Rockstar Games Launcher — der Entwicklungs-PC hat keine. Kommen die Mods im Rockstar-Games-Launcher-Modus nicht ins Spiel, wählen Sie den zweiten Spielordner.",
  otherTitle: "Warum keine anderen Methoden",
  other: [
    [
      "mods-Ordner und OpenIV-Loader",
      "Nur Storymodus: RP-Server und BattlEye in GTA Online lassen Loader nicht zu, RMRP verbietet diese Methode ausdrücklich.",
    ],
    [
      "Offline-Modus des Launchers",
      "Keine Dateiprüfung, aber ein RP-Server braucht das Netz — so kann man nicht spielen.",
    ],
    [
      "No_GTAVLauncher und exe-Patches",
      "Seit 2020 von Rockstar selbst kaputt und im Grunde ein Crack.",
    ],
  ],
};

const pl = {
  title: "Inny sposób: drugi folder gry",
  intro:
    "Jeśli tryb Ci nie odpowiada: Astral buduje obok drugi folder gry i instaluje mody tylko w nim. Launcher Rockstar go nie sprawdza, więc mody nie są kasowane. Pliki oryginału pozostają nietknięte.",
  copyTitle: "Drugi folder gry",
  copyIntro: (source) =>
    `To drugi folder gry: jego duże pliki są dowiązaniami do oryginału (${source}). Launcher Rockstar go nie sprawdza, więc mody Astral trafiają tutaj i zostają. Launchery Majestic i RAGE (GTA 5 RP) Astral sam kieruje na ten folder i przywraca ich poprzednią ścieżkę, gdy folder zostanie usunięty; w innych (Russia Online) wskaż ścieżkę raz.`,
  copyPath: "Kopiuj ścieżkę",
  copied: "Ścieżka skopiowana",
  methodsLabel: "Sposób dostarczania modów",
  current: "Teraz tak",
  rows: { what: "Co robi", space: "Miejsce", cons: "Wady" },
  methods: {
    linked: {
      title: "Drugi folder gry",
      short: "Kopia z dowiązań do oryginału — mody tylko w niej",
      what: "Astral buduje obok drugi folder GTA V z twardych dowiązań do plików oryginału i instaluje mody tylko w nim. Launcher Rockstar sprawdza nietknięty oryginał, a launcher serwera uruchamia grę z drugiego folderu.",
      space: (size) =>
        `Około ${size}: prawdziwymi kopiami są tylko update.rpf i małe pliki, pozostałe ~100 GB to dowiązania do tych samych danych. Tylko na tym samym dysku co gra.`,
      cons: "Majestic i RAGE (GTA 5 RP) Astral kieruje na ten folder sam; Russia Online wymaga tego raz ręcznie. Tryb fabularny launcher Rockstar uruchamia z własnego folderu — tam modów nie będzie. Po aktualizacji GTA drugi folder trzeba odświeżyć: przycisk pojawi się sam. Nie edytuj jego plików w OpenIV — dane są wspólne z oryginałem.",
      build: "Zbuduj drugi folder",
    },
    copy: {
      title: "Pełna kopia gry",
      short: "Osobna kopia wszystkich plików — na inny dysk",
      what: "To samo co drugi folder, ale wszystkie pliki są prawdziwymi kopiami. Potrzebna, gdy folderu z dowiązań nie da się zbudować: inny dysk albo system plików bez dowiązań.",
      space: (size) => `Około ${size} i do pół godziny kopiowania.`,
      cons: "Dużo miejsca. Po aktualizacji GTA kopię trzeba odświeżyć. Jak przy drugim folderze, Astral sam kieruje Majestic i RAGE na kopię.",
      build: "Zbuduj pełną kopię",
    },
  },
  events: {
    missed:
      "Ta sesja przebiegła bez modów: gra otworzyła archiwum przed Astral. Uruchom grę ponownie lub wybierz drugi folder gry.",
    stale:
      "Rockstar zaktualizował grę, a mody zbudowano na poprzednią wersję. Naciśnij „Przywróć” w Bibliotece — Astral zbuduje je od nowa.",
    lost: "Launcher Rockstar przywrócił swój update.rpf podczas startu. Przywróć mody: Biblioteka → „Przywróć”.",
    busy: "Gra trzyma update.rpf — Astral poczeka, aż się zamknie.",
    error: "Podmiana się nie udała",
    repaired:
      "Rockstar pobrał plik ponownie w trakcie gry — mody z niego znikły. Naciśnij „Przebuduj”.",
    "repair-in-progress":
      "Launcher Rockstar jeszcze dociąga pliki — Astral poczeka.",
    recovered: "Po awarii Astral przywrócił czyste pliki gry.",
    rebuilt: "Gotowe: teraz „Przywróć” mody w Bibliotece.",
  },
  errorAdvice:
    "Zamknij grę, wyłącz tryb i włącz go ponownie. Jeśli się powtórzy, wybierz „Drugi folder gry”.",
  copies: "Drugie foldery tej gry",
  copyMain: "Ustaw jako główną",
  copyIsMain: "Główna",
  copySync: "Odśwież",
  copySyncing: "Odświeżam…",
  copyDelete: "Usuń",
  copyDeleteConfirm: "Usuń folder",
  copyDeleteNote:
    "Usuwane są tylko dowiązania i kopie drugiego folderu — oryginał Rockstar pozostaje nietknięty. Mody zainstalowane w drugim folderze odejdą razem z nim.",
  copyCancel: "Anuluj",
  copyOutdated: "Gra się zaktualizowała — naciśnij „Odśwież”",
  copyFresh: "Zgadza się z oryginałem",
  chooseFolder: "Wybierz folder…",
  folder: (folder) => `Folder: ${folder}`,
  building: (done, total) => `Buduję: ${done} z ${total} plików`,
  built:
    "Drugi folder gotowy: mody Astral trafiają tam, a Majestic i RAGE uruchamiają grę z niego.",
  problems: {
    "other-volume":
      "Folder z dowiązań można zbudować tylko na tym samym dysku co gra. Wybierz tam folder albo zbuduj pełną kopię.",
    "no-space": "Za mało miejsca na dysku.",
    "not-empty": "Folder nie jest pusty — wybierz pusty.",
    "same-folder": "Drugi folder nie może leżeć wewnątrz gry.",
    "no-game": "W folderze gry nie ma GTA5.exe.",
  },
  desktopOnly: "Metodę zmienia się w aplikacji Astral.",
  modeOnNoCopy:
    "Tryb jest włączony — drugi folder nie jest potrzebny. Aby go zbudować, najpierw wyłącz tryb.",
  verified:
    "Sprawdzone na kopii Steam tego komputera: podmiana archiwum przy starcie i wyjściu, nadzór nad grą, drugi folder, instalacja i usuwanie modów. Nie sprawdzano na prawdziwej kopii z Rockstar Games Launcher — komputer deweloperski jej nie ma. Jeśli w trybie Rockstar Games Launcher mody nie wejdą, wybierz drugi folder gry.",
  otherTitle: "Dlaczego nie inne metody",
  other: [
    [
      "Folder mods i loader OpenIV",
      "Tylko tryb fabularny: serwery RP i BattlEye w GTA Online blokują loadery, a RMRP wprost zakazuje tej metody.",
    ],
    [
      "Tryb offline launchera",
      "Brak sprawdzania plików, ale serwer RP potrzebuje sieci — tak grać się nie da.",
    ],
    [
      "No_GTAVLauncher i łatki exe",
      "Zepsute przez samego Rockstara od 2020 roku i w istocie to crack.",
    ],
  ],
};

const fr = {
  title: "Autre méthode\u00a0: un second dossier du jeu",
  intro:
    "Si le mode ne vous convient pas\u00a0: Astral construit à côté un second dossier du jeu et n'y installe les mods que là. Le launcher Rockstar ne le vérifie pas, donc les mods ne sont pas effacés. Les fichiers d'origine restent intacts.",
  copyTitle: "Second dossier du jeu",
  copyIntro: (source) =>
    `Il s'agit d'un second dossier du jeu\u00a0: ses gros fichiers sont des liens vers l'original (${source}). Le launcher Rockstar ne le vérifie pas, donc les mods Astral s'installent ici et restent. Astral oriente lui-même les launchers Majestic et RAGE (GTA 5 RP) vers ce dossier et rétablit leur ancien chemin quand le dossier est supprimé\u00a0; pour les autres (Russia Online), indiquez le chemin une seule fois.`,
  copyPath: "Copier le chemin",
  copied: "Chemin copié",
  methodsLabel: "Méthode de livraison des mods",
  current: "Actuelle",
  rows: { what: "Ce qu'elle fait", space: "Espace", cons: "Inconvénients" },
  methods: {
    linked: {
      title: "Second dossier du jeu",
      short:
        "Une copie faite de liens vers l'original — mods uniquement dedans",
      what: "Astral construit à côté un second dossier GTA V à partir de liens physiques vers les fichiers de l'original et n'y installe les mods que là. Le launcher Rockstar vérifie l'original intact, et le launcher du serveur lance le jeu depuis le second dossier.",
      space: (size) =>
        `Environ ${size}\u00a0: seuls update.rpf et les petits fichiers sont de vraies copies, les ~100 Go restants sont des liens vers les mêmes données. Uniquement sur le même disque que le jeu.`,
      cons: "Astral oriente lui-même Majestic et RAGE (GTA 5 RP) vers ce dossier\u00a0; pour Russia Online, c'est à faire une fois à la main. Le launcher Rockstar lance le mode Histoire depuis son propre dossier — il n'y aura pas de mods. Après une mise à jour de GTA, le second dossier doit être mis à jour\u00a0: le bouton apparaît tout seul. Ne modifiez pas ses fichiers dans OpenIV — les données sont partagées avec l'original.",
      build: "Construire le second dossier",
    },
    copy: {
      title: "Copie complète du jeu",
      short: "Une copie séparée de tous les fichiers — pour un autre disque",
      what: "Comme le second dossier, mais tous les fichiers sont de vraies copies. Utile quand un dossier de liens est impossible à construire\u00a0: autre disque ou système de fichiers sans liens.",
      space: (size) => `Environ ${size} et jusqu'à une demi-heure de copie.`,
      cons: "Beaucoup de place. Après une mise à jour de GTA, la copie doit être mise à jour. Astral oriente Majestic et RAGE vers la copie tout seul, comme pour le second dossier.",
      build: "Construire la copie complète",
    },
  },
  events: {
    missed:
      "Ce lancement s'est passé sans mods\u00a0: le jeu a ouvert l'archive avant Astral. Relancez le jeu ou choisissez «\u00a0Second dossier du jeu\u00a0».",
    stale:
      "Rockstar a mis le jeu à jour, et les mods sont construits pour la version précédente. Cliquez sur «\u00a0Restaurer\u00a0» dans la «\u00a0Bibliothèque\u00a0» — Astral les reconstruira.",
    lost: "Le launcher Rockstar a remis son update.rpf pendant le lancement. Récupérez vos mods\u00a0: «\u00a0Bibliothèque\u00a0» → «\u00a0Restaurer\u00a0».",
    busy: "Le jeu utilise update.rpf — Astral attendra sa fermeture.",
    error: "L'échange a échoué",
    repaired:
      "Rockstar a retéléchargé un fichier pendant la partie — les mods qu'il contenait sont perdus. Appuyez sur «\u00a0Reconstruire\u00a0».",
    "repair-in-progress":
      "Le launcher Rockstar télécharge encore des fichiers — Astral attend.",
    recovered:
      "Après un plantage, Astral a restauré les fichiers propres du jeu.",
    rebuilt:
      "Terminé\u00a0: «\u00a0Restaurer\u00a0» maintenant les mods dans la Bibliothèque.",
  },
  errorAdvice:
    "Fermez le jeu, désactivez le mode puis réactivez-le. Si cela se reproduit, choisissez «\u00a0Second dossier du jeu\u00a0».",
  copies: "Seconds dossiers de ce jeu",
  copyMain: "Définir comme principal",
  copyIsMain: "Principal",
  copySync: "Mettre à jour",
  copySyncing: "Mise à jour…",
  copyDelete: "Supprimer",
  copyDeleteConfirm: "Supprimer le dossier",
  copyDeleteNote:
    "Seuls les liens et copies du second dossier sont supprimés — l'original Rockstar n'est pas touché. Les mods installés dans le second dossier partent avec lui.",
  copyCancel: "Annuler",
  copyOutdated:
    "Le jeu a été mis à jour — cliquez sur «\u00a0Mettre à jour\u00a0»",
  copyFresh: "Identique à l'original",
  chooseFolder: "Choisir un dossier…",
  folder: (folder) => `Dossier\u00a0: ${folder}`,
  building: (done, total) =>
    `Construction\u00a0: ${done} sur ${total} fichiers`,
  built:
    "Second dossier prêt\u00a0: les mods Astral y sont installés, et Majestic et RAGE lancent le jeu depuis celui-ci.",
  problems: {
    "other-volume":
      "Un dossier de liens ne peut être construit que sur le même disque que le jeu. Choisissez-y un dossier ou construisez une copie complète.",
    "no-space": "Espace disque insuffisant.",
    "not-empty": "Le dossier n'est pas vide — choisissez-en un vide.",
    "same-folder":
      "Le second dossier ne peut pas se trouver à l'intérieur du jeu.",
    "no-game": "Il n'y a pas de GTA5.exe dans le dossier du jeu.",
  },
  desktopOnly: "La méthode se change dans l'application Astral.",
  modeOnNoCopy:
    "Le mode est activé — un second dossier est inutile. Pour en construire un, désactivez d'abord le mode.",
  verified:
    "Testé sur la copie Steam de ce PC\u00a0: échange d'archive au lancement et à la fermeture, surveillance du jeu, second dossier, installation et retrait des mods. Non testé sur une vraie copie du Rockstar Games Launcher — le PC de développement n'en a pas. Si, avec le mode Rockstar Games Launcher, les mods ne se mettent pas en place, choisissez le second dossier du jeu.",
  otherTitle: "Pourquoi pas les autres méthodes",
  other: [
    [
      "Dossier mods et loader OpenIV",
      "Mode Histoire uniquement\u00a0: les serveurs RP et BattlEye dans GTA Online bloquent les loaders, et RMRP interdit explicitement cette méthode.",
    ],
    [
      "Mode hors ligne du launcher",
      "Pas de vérification des fichiers, mais un serveur RP a besoin du réseau — impossible de jouer ainsi.",
    ],
    [
      "No_GTAVLauncher et modification de l'exe",
      "Cassé par Rockstar lui-même depuis 2020 et, au fond, un crack.",
    ],
  ],
};

export const rockstarDeliveryCopy = { ru, uk, en, de, pl, fr };

export const rockstarDeliveryCopyFor = (language) =>
  rockstarDeliveryCopy[language] || rockstarDeliveryCopy.en;
