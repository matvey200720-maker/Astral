/*
 * Подписи раздела оптимизации на шести языках окна (ru, uk, en, de, pl, fr).
 *
 * Тексты карточек и их частей живут в `@modovik/optimizer` на русском и
 * английском и приходят оттуда как есть.
 */

const RU = {
  /* «Редактировать» у оптимизации редукса (`optimizer-focus.js`). */
  fromMod: "Так в «{name}»",
  fromModNote:
    "«{name}» меняет: {facts}. Те же правки — слоями Astral, они отмечены ниже: включите те, что нужны.",
  backTo: "Назад к «{name}»",
  cards: "Карточки оптимизации",
  before: "До",
  after: "После",
  compare: "Сравнить до и после",
  shotMissing: "Кадр из игры ещё не снят",
  shot: "Кадр «до/после»: {shot}",
  more: "Что входит",
  parts: "Что входит в «{title}»",
  partsHint:
    "Каждая часть включается и выключается отдельно и сразу уходит в игру. Закроете окно — выбор останется.",
  /* Окно «Что входит» в библиотеке — только показать (ТЗ 10.10). */
  partsHintLibrary:
    "Что из карточки стоит в игре. Менять — в мастерской («Оптимизация») или в настройках графики.",
  partsCount: "Включено {count} из {total}",
  done: "Готово",
  partShots: "Чей кадр показать",
  wholeCard: "Вся карточка",
  partsAllOn: "Включить всё",
  partsAllOff: "Выключить всё",
  enable: "Включить",
  disable: "Выключить",
  on: "В игре",
  off: "Выключено",
  partial: "Включено {count} из {total}",
  installing: "Идёт установка…",
  removing: "Снимаем из игры…",
  queued: "В очереди…",
  desktopOnly: "Ставится только в Astral Desktop",
  gameRunning:
    "GTA V запущена — закройте игру и переключите снова. В игре ничего не изменилось.",
  doneOn: "«{title}» в игре. Перезапустите игру, чтобы увидеть изменения.",
  doneOff: "«{title}» снято из игры.",
  failed: "«{title}»: {reason}",
  optional: "отдельно",
  optionalHint:
    "Переключатель карточки это не включает: меняет вид всей игры. Снимается вместе с карточкой.",
  settingsOnly: "только настройка",
  noFps: "на FPS не влияет",
  editor: "Оптимизация",
  title: "Мастерская оптимизации",
  back: "Назад в мастерскую",
  status: "В игре {count} из {total}",
  offAll: "Выключить всё",
  /* Честное время (задача 8): слои живут внутри update.rpf, и переключение —
     одна пересборка архива целиком, быстрее её не бывает. */
  hint: "Включите карточку — её состав уйдёт в игру за 5–15 секунд: игра читает его из update.rpf (2 ГБ), и архив пересобирается целиком. Выключите — снимется тем же путём",
  guide: [
    { keys: "Переключатель", text: "в игру или снять" },
    { keys: "Тянуть кадр", text: "до и после" },
    { keys: "Что входит", text: "части по отдельности" },
    { keys: ["Ctrl", "Z"], text: "отменить переключение" },
  ],
};

const EN = {
  /* «Редактировать» у оптимизации редукса (`optimizer-focus.js`). */
  fromMod: "As in “{name}”",
  fromModNote:
    "“{name}” changes: {facts}. The same changes are Astral layers, marked below: switch on the ones you want.",
  backTo: "Back to “{name}”",
  cards: "Optimization cards",
  before: "Before",
  after: "After",
  compare: "Compare before and after",
  shotMissing: "No in-game shot yet",
  shot: "Before/after shot: {shot}",
  more: "What is inside",
  parts: "What is inside “{title}”",
  partsHint:
    "Each part turns on and off on its own and goes into the game right away. Close the window — your choice stays.",
  /* Окно «Что входит» в библиотеке — только показать (ТЗ 10.10). */
  partsHintLibrary:
    "What from this card is in the game. Change it in the workshop (Optimization) or in graphics settings.",
  partsCount: "{count} of {total} on",
  done: "Done",
  partShots: "Which shot to show",
  wholeCard: "Whole card",
  partsAllOn: "Switch all on",
  partsAllOff: "Switch all off",
  enable: "Switch on",
  disable: "Switch off",
  on: "In the game",
  off: "Off",
  partial: "{count} of {total} on",
  installing: "Installing…",
  removing: "Removing from the game…",
  queued: "Queued…",
  desktopOnly: "Installs only in Astral Desktop",
  gameRunning:
    "GTA V is running — close the game and switch again. Nothing changed in the game.",
  doneOn: "“{title}” is in the game. Restart the game to see the changes.",
  doneOff: "“{title}” removed from the game.",
  failed: "“{title}”: {reason}",
  optional: "separate",
  optionalHint:
    "The card switch does not turn this on: it changes the look of the whole game. It is removed together with the card.",
  settingsOnly: "setting only",
  noFps: "no effect on FPS",
  editor: "Optimisation",
  title: "Optimisation workshop",
  back: "Back to the workshop",
  status: "{count} of {total} in the game",
  offAll: "Switch everything off",
  hint: "Switch a card on and its parts reach the game in 5–15 seconds: the game reads them from update.rpf (2 GB), which is rebuilt as a whole. Switch it off and they are removed the same way",
  guide: [
    { keys: "Switch", text: "into the game or remove" },
    { keys: "Drag the shot", text: "before and after" },
    { keys: "What is inside", text: "parts one by one" },
    { keys: ["Ctrl", "Z"], text: "undo a switch" },
  ],
};

const UK = {
  /* «Редактировать» у оптимизации редукса (`optimizer-focus.js`). */
  fromMod: "Так у «{name}»",
  fromModNote:
    "«{name}» змінює: {facts}. Ті самі правки — шари Astral, вони позначені нижче: увімкніть потрібні.",
  backTo: "Назад до «{name}»",
  cards: "Картки оптимізації",
  before: "До",
  after: "Після",
  compare: "Порівняти до і після",
  shotMissing: "Кадр із гри ще не знято",
  shot: "Кадр «до/після»: {shot}",
  more: "Що входить",
  parts: "Що входить до «{title}»",
  partsHint:
    "Кожна частина вмикається й вимикається окремо та одразу йде в гру. Закриєте вікно — вибір залишиться.",
  partsHintLibrary:
    "Що з картки стоїть у грі. Змінювати — в майстерні («Оптимізація») або в налаштуваннях графіки.",
  partsCount: "Увімкнено {count} із {total}",
  done: "Готово",
  partShots: "Чий кадр показати",
  wholeCard: "Уся картка",
  partsAllOn: "Увімкнути все",
  partsAllOff: "Вимкнути все",
  enable: "Увімкнути",
  disable: "Вимкнути",
  on: "У грі",
  off: "Вимкнено",
  partial: "Увімкнено {count} із {total}",
  installing: "Триває встановлення…",
  removing: "Знімаємо з гри…",
  queued: "У черзі…",
  desktopOnly: "Встановлюється лише в Astral Desktop",
  gameRunning:
    "GTA V запущена — закрийте гру й перемкніть знову. У грі нічого не змінилося.",
  doneOn: "«{title}» у грі. Перезапустіть гру, щоб побачити зміни.",
  doneOff: "«{title}» знято з гри.",
  failed: "«{title}»: {reason}",
  optional: "окремо",
  optionalHint:
    "Перемикач картки цього не вмикає: змінює вигляд усієї гри. Знімається разом із карткою.",
  settingsOnly: "лише налаштування",
  noFps: "на FPS не впливає",
  editor: "Оптимізація",
  title: "Майстерня оптимізації",
  back: "Назад до майстерні",
  status: "У грі {count} із {total}",
  offAll: "Вимкнути все",
  hint: "Увімкніть картку — її склад піде в гру за 5–15 секунд: гра читає його з update.rpf (2 ГБ), і архів перезбирається повністю. Вимкніть — зніметься тим самим шляхом",
  guide: [
    { keys: "Перемикач", text: "у гру або зняти" },
    { keys: "Тягти кадр", text: "до і після" },
    { keys: "Що входить", text: "частини окремо" },
    { keys: ["Ctrl", "Z"], text: "скасувати перемикання" },
  ],
};

const DE = {
  /* «Редактировать» у оптимизации редукса (`optimizer-focus.js`). */
  fromMod: "Wie in „{name}“",
  fromModNote:
    "„{name}“ ändert: {facts}. Dieselben Änderungen sind Astral-Ebenen, unten markiert: schalte die gewünschten ein.",
  backTo: "Zurück zu „{name}“",
  cards: "Optimierungskarten",
  before: "Vorher",
  after: "Nachher",
  compare: "Vorher und nachher vergleichen",
  shotMissing: "Aufnahme aus dem Spiel fehlt noch",
  shot: "Vorher/Nachher-Aufnahme: {shot}",
  more: "Was enthalten ist",
  parts: "Was in „{title}“ enthalten ist",
  partsHint:
    "Jeder Teil wird einzeln ein- und ausgeschaltet und geht sofort ins Spiel. Fenster schließen — die Auswahl bleibt.",
  partsHintLibrary:
    "Was von dieser Karte im Spiel ist. Ändern in der Werkstatt (Optimierung) oder in den Grafikeinstellungen.",
  partsCount: "{count} von {total} an",
  done: "Fertig",
  partShots: "Welche Aufnahme zeigen",
  wholeCard: "Ganze Karte",
  partsAllOn: "Alle einschalten",
  partsAllOff: "Alle ausschalten",
  enable: "Einschalten",
  disable: "Ausschalten",
  on: "Im Spiel",
  off: "Aus",
  partial: "{count} von {total} an",
  installing: "Wird installiert…",
  removing: "Wird aus dem Spiel entfernt…",
  queued: "In der Warteschlange…",
  desktopOnly: "Wird nur in Astral Desktop installiert",
  gameRunning:
    "GTA V läuft — schließen Sie das Spiel und schalten Sie erneut um. Im Spiel hat sich nichts geändert.",
  doneOn: "„{title}“ ist im Spiel. Starten Sie das Spiel neu, um die Änderungen zu sehen.",
  doneOff: "„{title}“ wurde aus dem Spiel entfernt.",
  failed: "„{title}“: {reason}",
  optional: "separat",
  optionalHint:
    "Der Kartenschalter aktiviert das nicht: Es ändert das Aussehen des ganzen Spiels. Wird zusammen mit der Karte entfernt.",
  settingsOnly: "nur Einstellung",
  noFps: "kein Einfluss auf die FPS",
  editor: "Optimierung",
  title: "Optimierungswerkstatt",
  back: "Zurück zur Werkstatt",
  status: "{count} von {total} im Spiel",
  offAll: "Alles ausschalten",
  hint: "Schalten Sie eine Karte ein — ihr Inhalt kommt in 5–15 Sekunden ins Spiel: Das Spiel liest ihn aus update.rpf (2 GB), das als Ganzes neu aufgebaut wird. Beim Ausschalten wird er auf demselben Weg entfernt",
  guide: [
    { keys: "Schalter", text: "ins Spiel oder entfernen" },
    { keys: "Aufnahme ziehen", text: "vorher und nachher" },
    { keys: "Was enthalten ist", text: "Teile einzeln" },
    { keys: ["Ctrl", "Z"], text: "Umschalten rückgängig machen" },
  ],
};

const PL = {
  /* «Редактировать» у оптимизации редукса (`optimizer-focus.js`). */
  fromMod: "Jak w „{name}”",
  fromModNote:
    "„{name}” zmienia: {facts}. Te same zmiany to warstwy Astral, zaznaczone niżej: włącz te, których chcesz.",
  backTo: "Wróć do „{name}”",
  cards: "Karty optymalizacji",
  before: "Przed",
  after: "Po",
  compare: "Porównaj przed i po",
  shotMissing: "Klatka z gry nie została jeszcze zrobiona",
  shot: "Klatka „przed/po”: {shot}",
  more: "Co zawiera",
  parts: "Co zawiera „{title}”",
  partsHint:
    "Każdą część włącza się i wyłącza osobno, od razu w grze. Zamknięcie okna nie zmienia wyboru.",
  partsHintLibrary:
    "Co z tej karty jest w grze. Zmienisz to w warsztacie (Optymalizacja) lub w ustawieniach grafiki.",
  partsCount: "Włączone {count} z {total}",
  done: "Gotowe",
  partShots: "Którą klatkę pokazać",
  wholeCard: "Cała karta",
  partsAllOn: "Włącz wszystko",
  partsAllOff: "Wyłącz wszystko",
  enable: "Włącz",
  disable: "Wyłącz",
  on: "W grze",
  off: "Wyłączone",
  partial: "Włączone {count} z {total}",
  installing: "Instalowanie…",
  removing: "Usuwanie z gry…",
  queued: "W kolejce…",
  desktopOnly: "Instaluje się tylko w Astral Desktop",
  gameRunning:
    "GTA V jest uruchomiona — zamknij grę i przełącz ponownie. W grze nic się nie zmieniło.",
  doneOn: "„{title}” jest w grze. Uruchom grę ponownie, aby zobaczyć zmiany.",
  doneOff: "„{title}” usunięto z gry.",
  failed: "„{title}”: {reason}",
  optional: "osobno",
  optionalHint:
    "Przełącznik karty tego nie włącza: zmienia wygląd całej gry. Usuwa się razem z kartą.",
  settingsOnly: "tylko ustawienie",
  noFps: "nie wpływa na FPS",
  editor: "Optymalizacja",
  title: "Warsztat optymalizacji",
  back: "Wróć do warsztatu",
  status: "W grze {count} z {total}",
  offAll: "Wyłącz wszystko",
  hint: "Włącz kartę — jej zawartość trafi do gry w 5–15 sekund: gra czyta ją z update.rpf (2 GB), a archiwum jest przebudowywane w całości. Wyłączenie usuwa ją tą samą drogą",
  guide: [
    { keys: "Przełącznik", text: "do gry lub usuń" },
    { keys: "Przeciągnij klatkę", text: "przed i po" },
    { keys: "Co zawiera", text: "części osobno" },
    { keys: ["Ctrl", "Z"], text: "cofnij przełączenie" },
  ],
};

const FR = {
  /* «Редактировать» у оптимизации редукса (`optimizer-focus.js`). */
  fromMod: "Comme dans «\u00a0{name}\u00a0»",
  fromModNote:
    "«\u00a0{name}\u00a0» modifie\u00a0: {facts}. Les mêmes modifications existent sous forme de calques Astral, repérés ci-dessous\u00a0: activez ceux dont vous avez besoin.",
  backTo: "Retour à «\u00a0{name}\u00a0»",
  cards: "Cartes d'optimisation",
  before: "Avant",
  after: "Après",
  compare: "Comparer avant et après",
  shotMissing: "La capture du jeu n'est pas encore faite",
  shot: "Capture «\u00a0avant/après\u00a0»\u00a0: {shot}",
  more: "Contenu",
  parts: "Contenu de «\u00a0{title}\u00a0»",
  partsHint:
    "Chaque partie s'active et se désactive séparément et passe aussitôt dans le jeu. Si vous fermez la fenêtre, votre choix est conservé.",
  partsHintLibrary:
    "Ce qui est actif dans le jeu pour cette carte. Pour modifier, passez par l'atelier («\u00a0Optimisation\u00a0») ou par les paramètres graphiques.",
  partsCount: "Actif\u00a0: {count} sur {total}",
  done: "Terminé",
  partShots: "Quelle capture afficher",
  wholeCard: "Carte entière",
  partsAllOn: "Tout activer",
  partsAllOff: "Tout désactiver",
  enable: "Activer",
  disable: "Désactiver",
  on: "Dans le jeu",
  off: "Désactivé",
  partial: "Actif\u00a0: {count} sur {total}",
  installing: "Installation en cours…",
  removing: "Retrait du jeu en cours…",
  queued: "En file d'attente…",
  desktopOnly: "S'installe uniquement dans Astral Desktop",
  gameRunning:
    "GTA V est lancé — fermez le jeu et basculez à nouveau. Rien n'a changé dans le jeu.",
  doneOn:
    "«\u00a0{title}\u00a0» est dans le jeu. Relancez le jeu pour voir les changements.",
  doneOff: "«\u00a0{title}\u00a0» a été retiré du jeu.",
  failed: "«\u00a0{title}\u00a0»\u00a0: {reason}",
  optional: "à part",
  optionalHint:
    "L'interrupteur de la carte ne l'active pas\u00a0: cela change l'aspect de tout le jeu. Se retire avec la carte.",
  settingsOnly: "réglage uniquement",
  noFps: "sans effet sur les FPS",
  editor: "Optimisation",
  title: "Atelier d'optimisation",
  back: "Retour à l'atelier",
  status: "Dans le jeu\u00a0: {count} sur {total}",
  offAll: "Tout désactiver",
  hint: "Activez une carte — son contenu arrive dans le jeu en 5–15 secondes\u00a0: le jeu le lit dans update.rpf (2 Go) et l'archive est reconstruite en entier. Désactivez-la — il est retiré de la même façon",
  guide: [
    { keys: "Interrupteur", text: "mettre dans le jeu ou retirer" },
    { keys: "Faire glisser la capture", text: "avant et après" },
    { keys: "Contenu", text: "parties séparément" },
    { keys: ["Ctrl", "Z"], text: "annuler le basculement" },
  ],
};

const BY_LOCALE = { ru: RU, uk: UK, en: EN, de: DE, pl: PL, fr: FR };

export function optimizerCopyFor(locale) {
  return BY_LOCALE[locale] || EN;
}

/** Подстановка `{name}` в подпись. */
export function fillCopy(template, values) {
  return Object.entries(values || {}).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    String(template || ""),
  );
}
