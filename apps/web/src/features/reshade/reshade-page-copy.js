/*
 * Тексты страницы «ReShade» на шести языках окна (ru, uk, en, de, pl, fr) — ТЗ 23.10.2026, п. G: одна страница вместо двух
 * вкладок («ReShade» и «DLSS 5»). Названия пресетов и числа нейросети остаются там, где были: `reshade-presets-copy.js`
 * (пресеты, превью) и `reshade-copy.js` (кадры DLSS 5, видеокарта, числа нейросети).
 *
 * Страница говорит «во все найденные проекты» и не перечисляет их по именам: ReShade идёт на все проекты. Имя проекта
 * встречается только там, где без него не объяснить причину (лаунчер Majestic не найден, в нём выключена поддержка модов).
 * Строки с числами и условиями — функции: порядок слов у языков разный.
 */

const RU = {
  description:
    "Эффекты для картинки GTA V и нейросеть DLSS 5. Astral ставит всё сам во все найденные проекты — скачивать ничего не нужно.",
  pillInstalled: "ReShade установлен",
  pillPreset: (name) => `Пресет «${name}»`,
  pillDlss: "DLSS 5",
  stateOff: "Не установлен",
  galleryAria: "Кадры из игры",
  thumbsAria: "Выбрать кадр",
  howAria: "Как с ним играть",
  howTitle: "Как с ним играть",
  howSteps: (key) => [
    "Нажмите «Установить» справа: Astral сам положит ReShade во все найденные проекты.",
    "Выберите готовый пресет ниже — или оставьте картинку как есть и настройте эффекты в меню игры.",
    `Запустите игру и нажмите ${key}: откроется меню ReShade.`,
    "Не понравилось — «Без пресета» вернёт картинку как в игре, «Удалить» уберёт ReShade совсем.",
  ],
  keysTitle: "Клавиши в игре",
  keys: (key) => [
    [key, "меню ReShade"],
    ["Page Down / Page Up", "следующий и прошлый пресет"],
    ["F10", "эффекты вкл. и выкл."],
    [
      "Print Screen",
      "скриншот с эффектами, папка «Изображения\\GTA V ReShade»",
    ],
  ],
  presetsNote:
    "Выберите пресет — Astral сам поставит ReShade, если его ещё нет.",
  panelAria: "Состав и настройка",
  panelTitle: "Состав",
  installed: "Установлен",
  notInstalled: "Не установлен",
  reshadePartAria: "Установка ReShade",
  reshadeOffHint: "Ставится один раз во все найденные проекты.",
  reshadeAllHint: "Стоит во всех найденных проектах.",
  reshadeSkipHint: (reasons) => `Стоит не везде: ${reasons}.`,
  reshadeRemoveHint: "«Удалить» снимает всё: и пресет, и DLSS 5.",
  install: "Установить",
  installing: "Ставим…",
  remove: "Удалить",
  removing: "Удаляем…",
  keyTitle: "Клавиша меню",
  keyHint: "Открывает меню ReShade в игре.",
  keyChange: "Изменить",
  keyPress: "Нажмите клавишу…",
  keyCancel: "Отмена",
  keyBusy: "Записываем…",
  keyLater: "Запишется при установке.",
  keyAria: (key) => `Клавиша меню ReShade: ${key}. Изменить`,
  keyReserved: (what) =>
    `Эта клавиша занята ReShade: ${what}. Выберите другую.`,
  keyReservedWhat: {
    PageUp: "прошлый пресет",
    PageDown: "следующий пресет",
    F10: "эффекты вкл. и выкл.",
    PrintScreen: "скриншот",
  },
  keyRejected:
    "Эту клавишу лучше не отдавать меню: она нужна игре. Подойдут Insert, Delete, Home, End, Pause, F1–F12 (кроме F10) и цифровой блок.",
  keyNote:
    "В ReShade.ini меняется только эта клавиша, остальные настройки остаются. Игру перед этим закройте.",
  dlssName: "DLSS 5",
  dlssHint:
    "Нейросеть NVIDIA перерисовывает каждый кадр: свет, тени и материалы ближе к фото.",
  driverOld: (driver) =>
    `Драйвер NVIDIA ${driver} старый — если DLSS 5 в игре не включится, обновите драйвер (GeForce Experience или nvidia.com).`,
  pcTitle: "Ваш ПК",
  factsTitle: "Что нужно знать про DLSS 5",
  buildText:
    "Неофициальная сборка: ReShade 6.7.3 с аддоном RenoDX DLSS и библиотекой nvngx_dlssnr.dll.",
  skip: {
    majestic: "лаунчер Majestic не найден",
    game: "GTA V не найдена",
    asi: "в корне игры нет загрузчика ASI (его ставят OpenIV и ScriptHookV)",
  },
  supportOff:
    "В лаунчере Majestic выключена «Поддержка графических модификаций», поэтому он не грузит моды. Закройте лаунчер, удалите ReShade и установите снова.",
  missingFiles: (count) =>
    `Стоит, но ${count} файл(ов) пропало — лаунчер проекта мог их убрать. Удалите ReShade и установите снова.`,
  foreignReshade:
    "Рядом уже лежит чужой ReShade — при установке его файлы уедут в копию и вернутся при удалении.",
  notes:
    "Ни один пресет не делает ночь светлее и не убирает туман — так требуют правила проектов. Где техадмины советуют чистую игру, ReShade ставят на свой страх и риск.",
  editionNote:
    "Найдена GTA V Enhanced. ReShade и DLSS 5 ставятся в проекты на GTA V Legacy; в Enhanced их не проверяли, а DLSS там встроен в меню графики игры.",
  onlyApp: "ReShade и DLSS 5 ставит только Astral Desktop.",
  packLine: ({ reshade, neural }) =>
    `Всё нужное — в составе Astral: ReShade ${reshade}, нейросеть DLSS 5 ${neural}. Скачивать ничего не нужно.`,
  installedNotice: ({ skipped, support, key }) =>
    `ReShade установлен.${skipped ? ` Пропущено: ${skipped}.` : ""}${support ? ` ${support}` : ""} Запустите игру и нажмите ${key} — откроется меню ReShade.`,
  presetNotice: ({ preset, skipped, support, key }) =>
    `Пресет «${preset}» применён.${skipped ? ` Пропущено: ${skipped}.` : ""}${support ? ` ${support}` : ""} Запустите игру: Page Down и Page Up листают пресеты, ${key} открывает меню ReShade.`,
  dlssNotice: ({ skipped, support, key }) =>
    `DLSS 5 установлен.${skipped ? ` Пропущено: ${skipped}.` : ""}${support ? ` ${support}` : ""} Запустите игру — меню ReShade открывается клавишей ${key}.`,
  removedNotice: "ReShade удалён: файлы, что стояли до него, возвращены.",
  nothingNotice: "ReShade нигде не стоял.",
  dlssRemovedNotice: "DLSS 5 удалён, ReShade остался.",
  keySavedNotice: (key) =>
    `Клавиша меню — ${key}. Записано в ReShade, заработает при следующем запуске игры.`,
  keyLaterNotice: (key) =>
    `Клавиша меню — ${key}. Запишется при установке ReShade.`,
};

const UK = {
  description:
    "Ефекти для картинки GTA V і нейромережа DLSS 5. Astral ставить усе сам у всі знайдені проєкти — завантажувати нічого не потрібно.",
  pillInstalled: "ReShade встановлено",
  pillPreset: (name) => `Пресет «${name}»`,
  pillDlss: "DLSS 5",
  stateOff: "Не встановлено",
  galleryAria: "Кадри з гри",
  thumbsAria: "Обрати кадр",
  howAria: "Як із ним грати",
  howTitle: "Як із ним грати",
  howSteps: (key) => [
    "Натисніть «Встановити» праворуч: Astral сам покладе ReShade в усі знайдені проєкти.",
    "Оберіть готовий пресет нижче — або залиште картинку як є й налаштуйте ефекти в меню гри.",
    `Запустіть гру й натисніть ${key}: відкриється меню ReShade.`,
    "Не сподобалось — «Без пресета» поверне картинку як у грі, «Видалити» прибере ReShade зовсім.",
  ],
  keysTitle: "Клавіші в грі",
  keys: (key) => [
    [key, "меню ReShade"],
    ["Page Down / Page Up", "наступний і попередній пресет"],
    ["F10", "ефекти увімк. і вимк."],
    ["Print Screen", "скриншот з ефектами, тека «Зображення\\GTA V ReShade»"],
  ],
  presetsNote:
    "Оберіть пресет — Astral сам встановить ReShade, якщо його ще немає.",
  panelAria: "Склад і налаштування",
  panelTitle: "Склад",
  installed: "Встановлено",
  notInstalled: "Не встановлено",
  reshadePartAria: "Встановлення ReShade",
  reshadeOffHint: "Ставиться один раз у всі знайдені проєкти.",
  reshadeAllHint: "Стоїть у всіх знайдених проєктах.",
  reshadeSkipHint: (reasons) => `Стоїть не скрізь: ${reasons}.`,
  reshadeRemoveHint: "«Видалити» знімає все: і пресет, і DLSS 5.",
  install: "Встановити",
  installing: "Ставимо…",
  remove: "Видалити",
  removing: "Видаляємо…",
  keyTitle: "Клавіша меню",
  keyHint: "Відкриває меню ReShade у грі.",
  keyChange: "Змінити",
  keyPress: "Натисніть клавішу…",
  keyCancel: "Скасувати",
  keyBusy: "Записуємо…",
  keyLater: "Запишеться під час встановлення.",
  keyAria: (key) => `Клавіша меню ReShade: ${key}. Змінити`,
  keyReserved: (what) => `Ця клавіша зайнята ReShade: ${what}. Оберіть іншу.`,
  keyReservedWhat: {
    PageUp: "попередній пресет",
    PageDown: "наступний пресет",
    F10: "ефекти увімк. і вимк.",
    PrintScreen: "скриншот",
  },
  keyRejected:
    "Цю клавішу краще не віддавати меню: вона потрібна грі. Підійдуть Insert, Delete, Home, End, Pause, F1–F12 (крім F10) і цифровий блок.",
  keyNote:
    "У ReShade.ini змінюється лише ця клавіша, решта налаштувань лишається. Гру перед цим закрийте.",
  dlssName: "DLSS 5",
  dlssHint:
    "Нейромережа NVIDIA перемальовує кожен кадр: світло, тіні й матеріали ближчі до фото.",
  driverOld: (driver) =>
    `Драйвер NVIDIA ${driver} застарілий — якщо DLSS 5 у грі не ввімкнеться, оновіть драйвер (GeForce Experience або nvidia.com).`,
  pcTitle: "Ваш ПК",
  factsTitle: "Що потрібно знати про DLSS 5",
  buildText:
    "Неофіційна збірка: ReShade 6.7.3 з аддоном RenoDX DLSS і бібліотекою nvngx_dlssnr.dll.",
  skip: {
    majestic: "лаунчер Majestic не знайдено",
    game: "GTA V не знайдено",
    asi: "у корені гри немає завантажувача ASI (його ставлять OpenIV і ScriptHookV)",
  },
  supportOff:
    "У лаунчері Majestic вимкнено «Підтримку графічних модифікацій», тому він не завантажує моди. Закрийте лаунчер, видаліть ReShade і встановіть знову.",
  missingFiles: (count) =>
    `Стоїть, але ${count} файл(ів) зникло — лаунчер проєкту міг їх прибрати. Видаліть ReShade і встановіть знову.`,
  foreignReshade:
    "Поруч уже лежить чужий ReShade — під час встановлення його файли поїдуть у копію й повернуться після видалення.",
  notes:
    "Жоден пресет не робить ніч світлішою і не прибирає туман — цього вимагають правила проєктів. Де техадміни радять чисту гру, ReShade ставлять на свій страх і ризик.",
  editionNote:
    "Знайдено GTA V Enhanced. ReShade і DLSS 5 ставляться в проєкти на GTA V Legacy; в Enhanced їх не перевіряли, а DLSS там вбудований у меню графіки гри.",
  onlyApp: "ReShade і DLSS 5 встановлює лише Astral Desktop.",
  packLine: ({ reshade, neural }) =>
    `Усе потрібне — у складі Astral: ReShade ${reshade}, нейромережа DLSS 5 ${neural}. Завантажувати нічого не потрібно.`,
  installedNotice: ({ skipped, support, key }) =>
    `ReShade встановлено.${skipped ? ` Пропущено: ${skipped}.` : ""}${support ? ` ${support}` : ""} Запустіть гру й натисніть ${key} — відкриється меню ReShade.`,
  presetNotice: ({ preset, skipped, support, key }) =>
    `Пресет «${preset}» застосовано.${skipped ? ` Пропущено: ${skipped}.` : ""}${support ? ` ${support}` : ""} Запустіть гру: Page Down і Page Up гортають пресети, ${key} відкриває меню ReShade.`,
  dlssNotice: ({ skipped, support, key }) =>
    `DLSS 5 встановлено.${skipped ? ` Пропущено: ${skipped}.` : ""}${support ? ` ${support}` : ""} Запустіть гру — меню ReShade відкривається клавішею ${key}.`,
  removedNotice: "ReShade видалено: файли, що стояли до нього, повернуто.",
  nothingNotice: "ReShade ніде не стояв.",
  dlssRemovedNotice: "DLSS 5 видалено, ReShade залишився.",
  keySavedNotice: (key) =>
    `Клавіша меню — ${key}. Записано в ReShade, запрацює під час наступного запуску гри.`,
  keyLaterNotice: (key) =>
    `Клавіша меню — ${key}. Запишеться під час встановлення ReShade.`,
};

const EN = {
  description:
    "Picture effects for GTA V and the DLSS 5 neural network. Astral installs everything for you, into every project it finds — nothing to download.",
  pillInstalled: "ReShade installed",
  pillPreset: (name) => `Preset “${name}”`,
  pillDlss: "DLSS 5",
  stateOff: "Not installed",
  galleryAria: "Frames from the game",
  thumbsAria: "Pick a frame",
  howAria: "How to play with it",
  howTitle: "How to play with it",
  howSteps: (key) => [
    "Press “Install” on the right: Astral puts ReShade into every project it finds.",
    "Pick a ready-made preset below — or leave the picture as it is and set up the effects in the in-game menu.",
    `Start the game and press ${key}: the ReShade menu opens.`,
    "Don't like it? “No preset” brings back the game's own picture, “Remove” takes ReShade out completely.",
  ],
  keysTitle: "Keys in the game",
  keys: (key) => [
    [key, "ReShade menu"],
    ["Page Down / Page Up", "next and previous preset"],
    ["F10", "effects on and off"],
    [
      "Print Screen",
      "screenshot with effects, folder “Pictures\\GTA V ReShade”",
    ],
  ],
  presetsNote:
    "Pick a preset — Astral installs ReShade itself if it isn't there yet.",
  panelAria: "Contents and settings",
  panelTitle: "Contents",
  installed: "Installed",
  notInstalled: "Not installed",
  reshadePartAria: "ReShade installation",
  reshadeOffHint: "Installed once, into every project it finds.",
  reshadeAllHint: "Installed in every project it found.",
  reshadeSkipHint: (reasons) => `Not installed everywhere: ${reasons}.`,
  reshadeRemoveHint:
    "“Remove” takes out everything: the preset and DLSS 5 too.",
  install: "Install",
  installing: "Installing…",
  remove: "Remove",
  removing: "Removing…",
  keyTitle: "Menu key",
  keyHint: "Opens the ReShade menu in the game.",
  keyChange: "Change",
  keyPress: "Press a key…",
  keyCancel: "Cancel",
  keyBusy: "Saving…",
  keyLater: "Will be saved when ReShade is installed.",
  keyAria: (key) => `ReShade menu key: ${key}. Change`,
  keyReserved: (what) =>
    `ReShade already uses this key: ${what}. Pick another one.`,
  keyReservedWhat: {
    PageUp: "previous preset",
    PageDown: "next preset",
    F10: "effects on and off",
    PrintScreen: "screenshot",
  },
  keyRejected:
    "Better not give this key to the menu: the game needs it. Insert, Delete, Home, End, Pause, F1–F12 (except F10) and the numeric keypad will do.",
  keyNote:
    "Only this key changes in ReShade.ini, all other settings stay. Close the game first.",
  dlssName: "DLSS 5",
  dlssHint:
    "NVIDIA's neural network redraws every frame: light, shadows and materials get closer to a photo.",
  driverOld: (driver) =>
    `NVIDIA driver ${driver} is old — if DLSS 5 doesn't turn on in the game, update the driver (GeForce Experience or nvidia.com).`,
  pcTitle: "Your PC",
  factsTitle: "What to know about DLSS 5",
  buildText:
    "Unofficial build: ReShade 6.7.3 with the RenoDX DLSS add-on and the nvngx_dlssnr.dll library.",
  skip: {
    majestic: "the Majestic launcher was not found",
    game: "GTA V was not found",
    asi: "there is no ASI loader in the game folder (OpenIV and ScriptHookV install one)",
  },
  supportOff:
    "“Support for graphics modifications” is off in the Majestic launcher, so it does not load mods. Close the launcher, remove ReShade and install it again.",
  missingFiles: (count) =>
    `Installed, but ${count} file(s) went missing — the project's launcher may have removed them. Remove ReShade and install it again.`,
  foreignReshade:
    "Someone else's ReShade is already there — on install its files are backed up and come back when you remove ReShade.",
  notes:
    "No preset makes the night lighter or removes the fog — the projects' rules require that. Where tech admins recommend a clean game, ReShade is at your own risk.",
  editionNote:
    "GTA V Enhanced was found. ReShade and DLSS 5 are installed into projects on GTA V Legacy; they have not been tested on Enhanced, where DLSS is built into the game's graphics menu.",
  onlyApp: "Only Astral Desktop installs ReShade and DLSS 5.",
  packLine: ({ reshade, neural }) =>
    `Everything needed comes with Astral: ReShade ${reshade}, DLSS 5 neural network ${neural}. Nothing to download.`,
  installedNotice: ({ skipped, support, key }) =>
    `ReShade installed.${skipped ? ` Skipped: ${skipped}.` : ""}${support ? ` ${support}` : ""} Start the game and press ${key} — the ReShade menu opens.`,
  presetNotice: ({ preset, skipped, support, key }) =>
    `Preset “${preset}” applied.${skipped ? ` Skipped: ${skipped}.` : ""}${support ? ` ${support}` : ""} Start the game: Page Down and Page Up flip through presets, ${key} opens the ReShade menu.`,
  dlssNotice: ({ skipped, support, key }) =>
    `DLSS 5 installed.${skipped ? ` Skipped: ${skipped}.` : ""}${support ? ` ${support}` : ""} Start the game — the ReShade menu opens with ${key}.`,
  removedNotice:
    "ReShade removed: the files that were there before it are back.",
  nothingNotice: "ReShade was not installed anywhere.",
  dlssRemovedNotice: "DLSS 5 removed, ReShade stays.",
  keySavedNotice: (key) =>
    `Menu key is ${key}. Saved into ReShade, it works from the next game start.`,
  keyLaterNotice: (key) =>
    `Menu key is ${key}. It will be saved when ReShade is installed.`,
};

const DE = {
  description:
    "Bildeffekte für GTA V und das neuronale Netz DLSS 5. Astral installiert alles selbst, in alle gefundenen Projekte – nichts zum Herunterladen.",
  pillInstalled: "ReShade installiert",
  pillPreset: (name) => `Preset „${name}“`,
  pillDlss: "DLSS 5",
  stateOff: "Nicht installiert",
  galleryAria: "Bilder aus dem Spiel",
  thumbsAria: "Bild auswählen",
  howAria: "So spielt man damit",
  howTitle: "So spielt man damit",
  howSteps: (key) => [
    "Klicken Sie rechts auf „Installieren“: Astral legt ReShade selbst in alle gefundenen Projekte.",
    "Wählen Sie unten ein fertiges Preset – oder lassen Sie das Bild, wie es ist, und stellen Sie die Effekte im Spielmenü ein.",
    `Starten Sie das Spiel und drücken Sie ${key}: Das ReShade-Menü öffnet sich.`,
    "Gefällt es nicht? „Ohne Preset“ bringt das Originalbild zurück, „Entfernen“ nimmt ReShade ganz heraus.",
  ],
  keysTitle: "Tasten im Spiel",
  keys: (key) => [
    [key, "ReShade-Menü"],
    ["Page Down / Page Up", "nächstes und vorheriges Preset"],
    ["F10", "Effekte an und aus"],
    ["Print Screen", "Screenshot mit Effekten, Ordner „Bilder\\GTA V ReShade“"],
  ],
  presetsNote:
    "Wählen Sie ein Preset – Astral installiert ReShade selbst, falls es noch fehlt.",
  panelAria: "Bestandteile und Einstellungen",
  panelTitle: "Bestandteile",
  installed: "Installiert",
  notInstalled: "Nicht installiert",
  reshadePartAria: "ReShade-Installation",
  reshadeOffHint: "Wird einmal in alle gefundenen Projekte installiert.",
  reshadeAllHint: "Steht in allen gefundenen Projekten.",
  reshadeSkipHint: (reasons) => `Nicht überall installiert: ${reasons}.`,
  reshadeRemoveHint: "„Entfernen“ nimmt alles heraus: Preset und DLSS 5.",
  install: "Installieren",
  installing: "Wird installiert…",
  remove: "Entfernen",
  removing: "Wird entfernt…",
  keyTitle: "Menütaste",
  keyHint: "Öffnet das ReShade-Menü im Spiel.",
  keyChange: "Ändern",
  keyPress: "Taste drücken…",
  keyCancel: "Abbrechen",
  keyBusy: "Wird gespeichert…",
  keyLater: "Wird bei der Installation gespeichert.",
  keyAria: (key) => `ReShade-Menütaste: ${key}. Ändern`,
  keyReserved: (what) =>
    `Diese Taste belegt ReShade bereits: ${what}. Wählen Sie eine andere.`,
  keyReservedWhat: {
    PageUp: "vorheriges Preset",
    PageDown: "nächstes Preset",
    F10: "Effekte an und aus",
    PrintScreen: "Screenshot",
  },
  keyRejected:
    "Diese Taste sollte nicht ans Menü gehen: Das Spiel braucht sie. Geeignet sind Insert, Delete, Home, End, Pause, F1–F12 (außer F10) und der Ziffernblock.",
  keyNote:
    "In der ReShade.ini ändert sich nur diese Taste, alle anderen Einstellungen bleiben. Schließen Sie vorher das Spiel.",
  dlssName: "DLSS 5",
  dlssHint:
    "Das neuronale Netz von NVIDIA zeichnet jedes Bild neu: Licht, Schatten und Materialien wirken fotorealistischer.",
  driverOld: (driver) =>
    `NVIDIA-Treiber ${driver} ist veraltet – schaltet sich DLSS 5 im Spiel nicht ein, aktualisieren Sie den Treiber (GeForce Experience oder nvidia.com).`,
  pcTitle: "Ihr PC",
  factsTitle: "Was man über DLSS 5 wissen sollte",
  buildText:
    "Inoffizieller Build: ReShade 6.7.3 mit dem RenoDX-DLSS-Addon und der Bibliothek nvngx_dlssnr.dll.",
  skip: {
    majestic: "Majestic-Launcher nicht gefunden",
    game: "GTA V nicht gefunden",
    asi: "im Spielordner fehlt ein ASI-Loader (OpenIV und ScriptHookV installieren ihn)",
  },
  supportOff:
    "Im Majestic-Launcher ist die „Unterstützung für Grafikmodifikationen“ aus, deshalb lädt er keine Mods. Launcher schließen, ReShade entfernen und neu installieren.",
  missingFiles: (count) =>
    `Installiert, aber ${count} Datei(en) fehlen – der Projekt-Launcher hat sie wohl entfernt. Entfernen Sie ReShade und installieren Sie es neu.`,
  foreignReshade:
    "Dort liegt schon ein fremdes ReShade – bei der Installation wandern seine Dateien in eine Kopie und kommen beim Entfernen zurück.",
  notes:
    "Kein Preset macht die Nacht heller oder entfernt den Nebel – das verlangen die Regeln der Projekte. Wo die Tech-Admins ein sauberes Spiel empfehlen, installieren Sie ReShade auf eigene Gefahr.",
  editionNote:
    "GTA V Enhanced wurde gefunden. ReShade und DLSS 5 werden in Projekte auf GTA V Legacy installiert; auf Enhanced wurden sie nicht getestet, dort ist DLSS ins Grafikmenü des Spiels eingebaut.",
  onlyApp: "ReShade und DLSS 5 installiert nur Astral Desktop.",
  packLine: ({ reshade, neural }) =>
    `Alles Nötige gehört zu Astral: ReShade ${reshade}, neuronales Netz DLSS 5 ${neural}. Nichts herunterzuladen.`,
  installedNotice: ({ skipped, support, key }) =>
    `ReShade installiert.${skipped ? ` Übersprungen: ${skipped}.` : ""}${support ? ` ${support}` : ""} Starten Sie das Spiel und drücken Sie ${key} – das ReShade-Menü öffnet sich.`,
  presetNotice: ({ preset, skipped, support, key }) =>
    `Preset „${preset}“ angewendet.${skipped ? ` Übersprungen: ${skipped}.` : ""}${support ? ` ${support}` : ""} Starten Sie das Spiel: Mit Page Down und Page Up wechseln Sie die Presets, ${key} öffnet das ReShade-Menü.`,
  dlssNotice: ({ skipped, support, key }) =>
    `DLSS 5 installiert.${skipped ? ` Übersprungen: ${skipped}.` : ""}${support ? ` ${support}` : ""} Starten Sie das Spiel – das ReShade-Menü öffnet sich mit ${key}.`,
  removedNotice:
    "ReShade entfernt: Dateien, die vorher dort lagen, sind zurück.",
  nothingNotice: "ReShade war nirgends installiert.",
  dlssRemovedNotice: "DLSS 5 entfernt, ReShade bleibt.",
  keySavedNotice: (key) =>
    `Menütaste: ${key}. In ReShade gespeichert, gilt ab dem nächsten Spielstart.`,
  keyLaterNotice: (key) =>
    `Menütaste: ${key}. Wird bei der Installation von ReShade gespeichert.`,
};

const PL = {
  description:
    "Efekty obrazu dla GTA V i sieć neuronowa DLSS 5. Astral instaluje wszystko sam, we wszystkich znalezionych projektach — nic nie trzeba pobierać.",
  pillInstalled: "ReShade zainstalowany",
  pillPreset: (name) => `Preset „${name}”`,
  pillDlss: "DLSS 5",
  stateOff: "Nie zainstalowano",
  galleryAria: "Klatki z gry",
  thumbsAria: "Wybierz klatkę",
  howAria: "Jak z tego korzystać w grze",
  howTitle: "Jak z tego korzystać w grze",
  howSteps: (key) => [
    "Kliknij „Zainstaluj” po prawej: Astral sam wrzuci ReShade do wszystkich znalezionych projektów.",
    "Wybierz gotowy preset poniżej — albo zostaw obraz bez zmian i ustaw efekty w menu gry.",
    `Uruchom grę i naciśnij ${key}: otworzy się menu ReShade.`,
    "Nie podoba się? „Bez presetu” przywróci obraz z gry, „Usuń” całkiem usunie ReShade.",
  ],
  keysTitle: "Klawisze w grze",
  keys: (key) => [
    [key, "menu ReShade"],
    ["Page Down / Page Up", "następny i poprzedni preset"],
    ["F10", "efekty wł. i wył."],
    ["Print Screen", "zrzut ekranu z efektami, folder „Obrazy\\GTA V ReShade”"],
  ],
  presetsNote:
    "Wybierz preset — Astral sam zainstaluje ReShade, jeśli jeszcze go nie ma.",
  panelAria: "Skład i ustawienia",
  panelTitle: "Skład",
  installed: "Zainstalowano",
  notInstalled: "Nie zainstalowano",
  reshadePartAria: "Instalacja ReShade",
  reshadeOffHint: "Instaluje się raz, we wszystkich znalezionych projektach.",
  reshadeAllHint: "Stoi we wszystkich znalezionych projektach.",
  reshadeSkipHint: (reasons) => `Nie wszędzie: ${reasons}.`,
  reshadeRemoveHint: "„Usuń” zdejmuje wszystko: i preset, i DLSS 5.",
  install: "Zainstaluj",
  installing: "Instalujemy…",
  remove: "Usuń",
  removing: "Usuwamy…",
  keyTitle: "Klawisz menu",
  keyHint: "Otwiera menu ReShade w grze.",
  keyChange: "Zmień",
  keyPress: "Naciśnij klawisz…",
  keyCancel: "Anuluj",
  keyBusy: "Zapisujemy…",
  keyLater: "Zapisze się przy instalacji.",
  keyAria: (key) => `Klawisz menu ReShade: ${key}. Zmień`,
  keyReserved: (what) =>
    `Ten klawisz zajmuje już ReShade: ${what}. Wybierz inny.`,
  keyReservedWhat: {
    PageUp: "poprzedni preset",
    PageDown: "następny preset",
    F10: "efekty wł. i wył.",
    PrintScreen: "zrzut ekranu",
  },
  keyRejected:
    "Lepiej nie oddawać tego klawisza menu: potrzebuje go gra. Nadadzą się Insert, Delete, Home, End, Pause, F1–F12 (poza F10) i blok numeryczny.",
  keyNote:
    "W ReShade.ini zmienia się tylko ten klawisz, pozostałe ustawienia zostają. Wcześniej zamknij grę.",
  dlssName: "DLSS 5",
  dlssHint:
    "Sieć neuronowa NVIDIA przerysowuje każdą klatkę: światło, cienie i materiały są bliższe zdjęciu.",
  driverOld: (driver) =>
    `Sterownik NVIDIA ${driver} jest stary — jeśli DLSS 5 nie włączy się w grze, zaktualizuj sterownik (GeForce Experience lub nvidia.com).`,
  pcTitle: "Twój komputer",
  factsTitle: "Co warto wiedzieć o DLSS 5",
  buildText:
    "Nieoficjalna wersja: ReShade 6.7.3 z dodatkiem RenoDX DLSS i biblioteką nvngx_dlssnr.dll.",
  skip: {
    majestic: "nie znaleziono launchera Majestic",
    game: "nie znaleziono GTA V",
    asi: "w folderze gry brak loadera ASI (instalują go OpenIV i ScriptHookV)",
  },
  supportOff:
    "W launcherze Majestic wyłączona jest „Obsługa modów graficznych”, dlatego nie wczytuje on modów. Zamknij launcher, usuń ReShade i zainstaluj go ponownie.",
  missingFiles: (count) =>
    `Stoi, ale zniknęło plików: ${count} — launcher projektu mógł je usunąć. Usuń ReShade i zainstaluj ponownie.`,
  foreignReshade:
    "Obok leży już cudzy ReShade — przy instalacji jego pliki trafią do kopii i wrócą po usunięciu.",
  notes:
    "Żaden preset nie rozjaśnia nocy ani nie usuwa mgły — tego wymagają zasady projektów. Tam, gdzie administratorzy techniczni zalecają czystą grę, ReShade instalujesz na własne ryzyko.",
  editionNote:
    "Znaleziono GTA V Enhanced. ReShade i DLSS 5 instalują się w projektach na GTA V Legacy; na Enhanced nie były testowane, a DLSS jest tam wbudowany w menu grafiki gry.",
  onlyApp: "ReShade i DLSS 5 instaluje tylko Astral Desktop.",
  packLine: ({ reshade, neural }) =>
    `Wszystko, co potrzebne, jest w Astral: ReShade ${reshade}, sieć neuronowa DLSS 5 ${neural}. Nic nie trzeba pobierać.`,
  installedNotice: ({ skipped, support, key }) =>
    `ReShade zainstalowany.${skipped ? ` Pominięto: ${skipped}.` : ""}${support ? ` ${support}` : ""} Uruchom grę i naciśnij ${key} — otworzy się menu ReShade.`,
  presetNotice: ({ preset, skipped, support, key }) =>
    `Preset „${preset}” zastosowany.${skipped ? ` Pominięto: ${skipped}.` : ""}${support ? ` ${support}` : ""} Uruchom grę: Page Down i Page Up przełączają presety, ${key} otwiera menu ReShade.`,
  dlssNotice: ({ skipped, support, key }) =>
    `DLSS 5 zainstalowany.${skipped ? ` Pominięto: ${skipped}.` : ""}${support ? ` ${support}` : ""} Uruchom grę — menu ReShade otwiera się klawiszem ${key}.`,
  removedNotice: "ReShade usunięty: pliki, które były wcześniej, wróciły.",
  nothingNotice: "ReShade nigdzie nie był zainstalowany.",
  dlssRemovedNotice: "DLSS 5 usunięty, ReShade został.",
  keySavedNotice: (key) =>
    `Klawisz menu: ${key}. Zapisano w ReShade, zadziała od następnego uruchomienia gry.`,
  keyLaterNotice: (key) =>
    `Klawisz menu: ${key}. Zapisze się przy instalacji ReShade.`,
};

const FR = {
  description:
    "Effets d'image pour GTA V et réseau de neurones DLSS 5. Astral installe tout lui-même dans tous les projets détectés — rien à télécharger.",
  pillInstalled: "ReShade installé",
  pillPreset: (name) => `Preset «\u00a0${name}\u00a0»`,
  pillDlss: "DLSS 5",
  stateOff: "Non installé",
  galleryAria: "Images du jeu",
  thumbsAria: "Choisir une image",
  howAria: "Comment jouer avec",
  howTitle: "Comment jouer avec",
  howSteps: (key) => [
    "Cliquez sur «\u00a0Installer\u00a0» à droite\u00a0: Astral place lui-même ReShade dans tous les projets détectés.",
    "Choisissez un preset prêt à l'emploi ci-dessous — ou gardez l'image telle quelle et réglez les effets dans le menu du jeu.",
    `Lancez le jeu et appuyez sur ${key}\u00a0: le menu ReShade s'ouvre.`,
    "Pas convaincu\u00a0? «\u00a0Sans preset\u00a0» rétablit l'image d'origine du jeu, «\u00a0Supprimer\u00a0» retire complètement ReShade.",
  ],
  keysTitle: "Touches en jeu",
  keys: (key) => [
    [key, "menu ReShade"],
    ["Page Down / Page Up", "preset suivant et précédent"],
    ["F10", "activer / désactiver les effets"],
    [
      "Print Screen",
      "capture avec effets, dossier «\u00a0Images\\GTA V ReShade\u00a0»",
    ],
  ],
  presetsNote:
    "Choisissez un preset — Astral installe lui-même ReShade s'il n'est pas encore là.",
  panelAria: "Composition et réglages",
  panelTitle: "Composition",
  installed: "Installé",
  notInstalled: "Non installé",
  reshadePartAria: "Installation de ReShade",
  reshadeOffHint: "S'installe une seule fois, dans tous les projets détectés.",
  reshadeAllHint: "Installé dans tous les projets détectés.",
  reshadeSkipHint: (reasons) => `Pas installé partout\u00a0: ${reasons}.`,
  reshadeRemoveHint:
    "«\u00a0Supprimer\u00a0» retire tout\u00a0: le preset comme DLSS 5.",
  install: "Installer",
  installing: "Installation…",
  remove: "Supprimer",
  removing: "Suppression…",
  keyTitle: "Touche du menu",
  keyHint: "Ouvre le menu ReShade en jeu.",
  keyChange: "Modifier",
  keyPress: "Appuyez sur une touche…",
  keyCancel: "Annuler",
  keyBusy: "Enregistrement…",
  keyLater: "Sera enregistrée à l'installation.",
  keyAria: (key) => `Touche du menu ReShade\u00a0: ${key}. Modifier`,
  keyReserved: (what) =>
    `Cette touche est déjà utilisée par ReShade\u00a0: ${what}. Choisissez-en une autre.`,
  keyReservedWhat: {
    PageUp: "preset précédent",
    PageDown: "preset suivant",
    F10: "activer / désactiver les effets",
    PrintScreen: "capture d'écran",
  },
  keyRejected:
    "Mieux vaut ne pas donner cette touche au menu\u00a0: le jeu en a besoin. Conviennent Insert, Delete, Home, End, Pause, F1–F12 (sauf F10) et le pavé numérique.",
  keyNote:
    "Dans ReShade.ini, seule cette touche change, les autres réglages restent. Fermez d'abord le jeu.",
  dlssName: "DLSS 5",
  dlssHint:
    "Le réseau de neurones NVIDIA redessine chaque image\u00a0: lumière, ombres et matériaux se rapprochent d'une photo.",
  driverOld: (driver) =>
    `Le pilote NVIDIA ${driver} est ancien — si DLSS 5 ne s'active pas dans le jeu, mettez le pilote à jour (GeForce Experience ou nvidia.com).`,
  pcTitle: "Votre PC",
  factsTitle: "Ce qu'il faut savoir sur DLSS 5",
  buildText:
    "Build non officiel\u00a0: ReShade 6.7.3 avec l'add-on RenoDX DLSS et la bibliothèque nvngx_dlssnr.dll.",
  skip: {
    majestic: "launcher Majestic introuvable",
    game: "GTA V introuvable",
    asi: "pas de chargeur ASI à la racine du jeu (OpenIV et ScriptHookV l'installent)",
  },
  supportOff:
    "Dans le launcher Majestic, «\u00a0Prise en charge des modifications graphiques\u00a0» est désactivée, il ne charge donc pas les mods. Fermez le launcher, supprimez ReShade et réinstallez-le.",
  missingFiles: (count) =>
    `Installé, mais ${count} fichier(s) manquent — le launcher du projet a pu les supprimer. Supprimez ReShade et réinstallez-le.`,
  foreignReshade:
    "Un ReShade tiers est déjà présent — à l'installation, ses fichiers partent dans une copie et reviennent à la suppression.",
  notes:
    "Aucun preset n'éclaircit la nuit ni ne retire le brouillard — les règles des projets l'exigent. Là où les admins techniques conseillent un jeu propre, ReShade s'installe à vos risques et périls.",
  editionNote:
    "GTA V Enhanced détecté. ReShade et DLSS 5 s'installent dans les projets sur GTA V Legacy\u00a0; sur Enhanced, ils n'ont pas été testés, et DLSS y est intégré au menu graphique du jeu.",
  onlyApp: "ReShade et DLSS 5 ne sont installés que par Astral Desktop.",
  packLine: ({ reshade, neural }) =>
    `Tout le nécessaire est inclus dans Astral\u00a0: ReShade ${reshade}, réseau de neurones DLSS 5 ${neural}. Rien à télécharger.`,
  installedNotice: ({ skipped, support, key }) =>
    `ReShade installé.${skipped ? ` Ignoré\u00a0: ${skipped}.` : ""}${support ? ` ${support}` : ""} Lancez le jeu et appuyez sur ${key} — le menu ReShade s'ouvre.`,
  presetNotice: ({ preset, skipped, support, key }) =>
    `Preset «\u00a0${preset}\u00a0» appliqué.${skipped ? ` Ignoré\u00a0: ${skipped}.` : ""}${support ? ` ${support}` : ""} Lancez le jeu\u00a0: Page Down et Page Up font défiler les presets, ${key} ouvre le menu ReShade.`,
  dlssNotice: ({ skipped, support, key }) =>
    `DLSS 5 installé.${skipped ? ` Ignoré\u00a0: ${skipped}.` : ""}${support ? ` ${support}` : ""} Lancez le jeu — le menu ReShade s'ouvre avec ${key}.`,
  removedNotice:
    "ReShade supprimé\u00a0: les fichiers qui étaient là avant sont rétablis.",
  nothingNotice: "ReShade n'était installé nulle part.",
  dlssRemovedNotice: "DLSS 5 supprimé, ReShade reste.",
  keySavedNotice: (key) =>
    `Touche du menu\u00a0: ${key}. Enregistrée dans ReShade, elle fonctionnera au prochain lancement du jeu.`,
  keyLaterNotice: (key) =>
    `Touche du menu\u00a0: ${key}. Sera enregistrée à l'installation de ReShade.`,
};

const COPY = { ru: RU, uk: UK, en: EN, de: DE, pl: PL, fr: FR };

export function reshadePageCopyFor(language) {
  return COPY[language] || RU;
}
