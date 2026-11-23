/* locale-self-contained: все шесть языков (ru, uk, en, de, pl, fr) написаны в этом файле, словарь `ui-text` ему не нужен. */
import { tr } from "../../locales/ui.js";

// Ячейки каждой строки TEXT идут в этом порядке языков.
const CODES = ["ru", "uk", "en", "de", "pl", "fr"];

const PART_GLUE = " · ";
const NAME_GLUE = ", ";

const TEXT = {
  title: [
    "Работы мастерской",
    "Роботи майстерні",
    "Workshop works",
    "Werkstatt-Arbeiten",
    "Prace warsztatu",
    "Créations de l'Atelier",
  ],
  note: [
    "«Установить» поставит и работы мастерской. Те, которым нужен свой редактор, ставьте из «Моих работ».",
    "Ці роботи вже в «Моїх роботах»: відкрийте потрібну в майстерні й застосуйте.",
    "Install also applies the workshop works. Works that need their editor are applied from My works.",
    "Diese Arbeiten liegen schon in „Meine Arbeiten“: in der Werkstatt öffnen und anwenden.",
    "Te prace są już w „Moich pracach”: otwórz wybraną w warsztacie i zastosuj.",
    "Ces créations sont déjà dans «\u00a0Mes créations\u00a0»\u00a0: ouvrez celle qui vous intéresse dans l'Atelier et appliquez-la.",
  ],
  remove: [
    "Снять работы",
    "Зняти роботи",
    "Remove works",
    "Arbeiten entfernen",
    "Zdejmij prace",
    "Retirer les créations",
  ],
  tooLarge: [
    "Код слишком большой для сборки — похоже, вставлен не код, а лишнее. Скопируйте код целиком через «Скопировать код».",
    "Код завеликий для збірки — схоже, вставлено зайве. Скопіюйте код повністю через «Скопіювати код».",
    "The code is too large for a build — most likely something extra was pasted. Copy the whole code with “Copy code”.",
    "Der Code ist für eine Sammlung zu groß – vermutlich wurde etwas Überflüssiges eingefügt. Kopiere den ganzen Code mit „Code kopieren“.",
    "Kod jest za duży na zestaw — pewnie wklejono coś zbędnego. Skopiuj cały kod przez „Kopiuj kod”.",
    "Le code est trop volumineux pour un build — il semble qu'autre chose que le code ait été collé. Copiez le code en entier avec «\u00a0Copier le code\u00a0».",
  ],
  notStored: [
    "Работы сборки не поместились в хранилище окна — сборка сохранена без них, место освободит удаление старых сборок.",
    "Роботи збірки не вмістилися у сховище вікна — збірку збережено без них; місце звільнить видалення старих збірок.",
    "The build's works did not fit in the window's storage — the build is saved without them; deleting old builds frees space.",
    "Die Arbeiten der Sammlung passten nicht in den Speicher des Fensters – sie wurde ohne sie gespeichert; alte Sammlungen zu löschen schafft Platz.",
    "Prace zestawu nie zmieściły się w pamięci okna — zestaw zapisano bez nich; miejsce zwolni usunięcie starych zestawów.",
    "Les créations du build n'ont pas tenu dans le stockage de la fenêtre — le build a été enregistré sans elles\u00a0; supprimer d'anciens builds libérera de la place.",
  ],
  imported: [
    "В «Мои работы» добавлено: ",
    "Додано до «Моїх робіт»: ",
    "Added to My works: ",
    "Zu „Meine Arbeiten“ hinzugefügt: ",
    "Dodano do „Moich prac”: ",
    "Ajoutées à «\u00a0Mes créations\u00a0»\u00a0: ",
  ],
  skipped: [
    "Уже были в «Моих работах»: ",
    "Уже були в «Моїх роботах»: ",
    "Already in My works: ",
    "Schon in „Meine Arbeiten“: ",
    "Już w „Moich pracach”: ",
    "Déjà dans «\u00a0Mes créations\u00a0»\u00a0: ",
  ],
  unreadable: [
    "Не удалось прочитать: ",
    "Не вдалося прочитати: ",
    "Could not read: ",
    "Nicht lesbar: ",
    "Nie udało się odczytać: ",
    "Lecture impossible\u00a0: ",
  ],
  droppedLead: [
    "Не вошло по размеру: ",
    "Не ввійшло за розміром: ",
    "Left out for size: ",
    "Wegen der Größe nicht aufgenommen: ",
    "Nie weszło przez rozmiar: ",
    "Non incluses à cause de la taille\u00a0: ",
  ],
  droppedTail: [
    " — слишком тяжёлые работы",
    " — надто важкі роботи",
    " — works that are too heavy",
    " – zu schwere Arbeiten",
    " — zbyt ciężkie prace",
    " — créations trop lourdes",
  ],
  saveLead: [" И ещё ", " І ще ", " Plus ", " Dazu ", " Oraz ", " Et "],

  // Подписи частей сводки установки и снятия (двоеточие и пробел внутри).
  queued: [
    "Работы мастерской в очереди: ",
    "Роботи майстерні в черзі: ",
    "Workshop works queued: ",
    "Werkstatt-Arbeiten in der Warteschlange: ",
    "Prace warsztatu w kolejce: ",
    "Créations de l'Atelier en file d'attente\u00a0: ",
  ],
  already: [
    "уже стоят: ",
    "уже встановлені: ",
    "already in the game: ",
    "schon installiert: ",
    "już zainstalowane: ",
    "déjà installées\u00a0: ",
  ],
  fromMine: [
    "из «Моих работ»: ",
    "з «Моїх робіт»: ",
    "from My works: ",
    "aus „Meine Arbeiten“: ",
    "z „Moich prac”: ",
    "depuis «\u00a0Mes créations\u00a0»\u00a0: ",
  ],
  failed: [
    "не удалось: ",
    "не вдалося: ",
    "failed: ",
    "fehlgeschlagen: ",
    "nie udało się: ",
    "échec\u00a0: ",
  ],
  removed: [
    "Работы сняты: ",
    "Роботи знято: ",
    "Works removed: ",
    "Arbeiten entfernt: ",
    "Prace zdjęte: ",
    "Créations retirées\u00a0: ",
  ],
  notInstalled: [
    "не стояли: ",
    "не були встановлені: ",
    "were not installed: ",
    "nicht installiert: ",
    "nie były zainstalowane: ",
    "n'étaient pas installées\u00a0: ",
  ],
  otherVersion: [
    "стоит другая версия: ",
    "встановлено іншу версію: ",
    "another version is installed: ",
    "andere Version installiert: ",
    "zainstalowana inna wersja: ",
    "une autre version est installée\u00a0: ",
  ],
  ownEditor: [
    "снимаются в своём редакторе: ",
    "знімаються у своєму редакторі: ",
    "removed from their own editor: ",
    "werden im eigenen Editor entfernt: ",
    "zdejmowane we własnym edytorze: ",
    "retirées dans leur propre éditeur\u00a0: ",
  ],
  stuck: [
    "отдельно не снять (архив игры пересобирали поверх): ",
    "окремо не зняти (архів гри перебудували поверх): ",
    "cannot be removed on their own (the game archive was rebuilt over them): ",
    "einzeln nicht entfernbar (das Spielarchiv wurde darüber neu gebaut): ",
    "nie da się zdjąć osobno (archiwum gry przebudowano): ",
    "impossibles à retirer séparément (l'archive du jeu a été reconstruite par-dessus)\u00a0: ",
  ],
  stuckTail: [
    " — верните GTA V без модов: Настройки → Обслуживание",
    " — поверніть GTA V без модів: Налаштування → GTA V",
    " — restore GTA V without mods: Settings → Maintenance",
    " — GTA V ohne Mods wiederherstellen: Einstellungen → GTA V",
    " — przywróć GTA V bez modów: Ustawienia → GTA V",
    " — rétablissez GTA V sans mods\u00a0: Paramètres → Maintenance",
  ],
};

// Русское слово: форма выбирается первым подошедшим правилом, перевод берётся только у неё.
const RU_FORMS = [
  [(n) => n % 10 === 1 && n % 100 !== 11, () => tr("работа")],
  [
    (n) => n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14),
    () => tr("работы"),
  ],
];

function ruWord(n) {
  const form = RU_FORMS.find(([fits]) => fits(n));
  return form ? form[1]() : tr("работ");
}

// Слово при числе в строке «N работ».
const WORD_FOR = {
  ru: ruWord,
  uk: () => "робіт",
  en: (n) => (n === 1 ? "work" : "works"),
  de: (n) => (n === 1 ? "Arbeit" : "Arbeiten"),
  pl: () => "prac",
  fr: (n) => (n === 0 || n === 1 ? "création" : "créations"),
};

// Всё, что идёт после числа во фразе про работы, уже стоящие в игре.
const SAVE_BODY = {
  ru: (n) =>
    ` стоящих в игре ${n === 1 ? tr("работа") : tr("работ")} мастерской` +
    " — со своими названиями и обложками.",
  uk: () => " робіт майстерні, що стоять у грі.",
  en: (n) =>
    ` workshop ${n === 1 ? "work" : "works"} that are in the game, with their names and covers.`,
  de: () => " Werkstatt-Arbeiten, die im Spiel liegen.",
  pl: () => " prac warsztatu będących w grze.",
  fr: (n) =>
    ` ${n === 1 ? "création de l'Atelier présente" : "créations de l'Atelier présentes"}` +
    " dans le jeu.",
};

// Фраза со списком: пустой список даёт пустую строку.
const listed = (lead, show) => (names) => (names.length ? lead + show(names) : "");
// Фраза с числом: ложное число даёт пустую строку.
const counted = (build) => (count) => (count ? build(count) : "");

const howMany = (items) => items.length;
const plain = (items) => items.join(NAME_GLUE);
// Параметр зовётся names: по нему читается текст ошибки на списке не того типа.
const commaList = (names) => names.join(NAME_GLUE);
const namesOf = (items) => items.map((item) => item.name).join(NAME_GLUE);

// Сводка из частей [поле, подпись, как показать список, поле необязательно]; пустые части
// пропускаются.
function summarize(result, rows) {
  return rows
    .flatMap(([field, label, show, optional]) => {
      const list = optional ? (result[field] ?? []) : result[field];
      return list.length ? [label + show(list)] : [];
    })
    .join(PART_GLUE);
}

function composeSet(index, code) {
  const say = (key) => TEXT[key][index];
  const wordFor = WORD_FOR[code];
  const saveBody = SAVE_BODY[code];
  const stuckShow = (items) => namesOf(items) + say("stuckTail");

  const installRows = [
    ["queued", say("queued"), howMany],
    ["already", say("already"), howMany],
    ["unsupported", say("fromMine"), namesOf],
    ["failed", say("failed"), namesOf],
  ];
  const removeRows = [
    ["removed", say("removed"), howMany],
    ["notInstalled", say("notInstalled"), howMany],
    ["otherVersion", say("otherVersion"), plain],
    ["unsupported", say("ownEditor"), namesOf, true],
    ["stuck", say("stuck"), stuckShow, true],
    ["failed", say("failed"), namesOf],
  ];

  return {
    works: (count) => `${count} ${wordFor(count)}`,
    worksTitle: say("title"),
    worksNote: say("note"),
    saveWorks: counted((count) => say("saveLead") + count + saveBody(count)),
    importedWorks: listed(say("imported"), howMany),
    skippedWorks: listed(say("skipped"), howMany),
    failedWorks: listed(say("unreadable"), commaList),
    removeWorks: say("remove"),
    codeTooLarge: say("tooLarge"),
    droppedWorks: counted((count) => say("droppedLead") + count + say("droppedTail")),
    notStored: say("notStored"),
    installSummary: (result) => summarize(result, installRows),
    removeSummary: (result) => summarize(result, removeRows),
  };
}

const SETS = new Map(CODES.map((code, index) => [code, composeSet(index, code)]));

export function buildWorksCopyFor(language) {
  return SETS.get(language) ?? SETS.get("en");
}
