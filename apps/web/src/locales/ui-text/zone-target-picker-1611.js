/*
 * Окно «На что поставить?» (правки владельца 16.11.2026, `components/desktop/clothing/`, `components/desktop/catalog/ClothingInstallDialog.jsx`): виды вещи в строке под названием слева и в чипах.
 * Раньше «Бороды», «Ногти» и ещё пять слов стояли по-русски на любом языке (аудит `locale` в Electron на немецком). Сторож — `test/clothing-kind-labels-locale.test.js`.
 * Русская строка → [uk, en, de, pl]. Французский — `fr/zone-target-picker-1611.js`. Немецкий на «du».
 */
export const zoneTargetPicker1611 = {
  Причёски: ["Зачіски", "Hairstyles", "Frisuren", "Fryzury"],
  Бороды: ["Бороди", "Beards", "Bärte", "Brody"],
  Серьги: ["Сережки", "Earrings", "Ohrringe", "Kolczyki"],
  Ногти: ["Нігті", "Nails", "Nägel", "Paznokcie"],
  "Часы и браслеты": [
    "Годинники та браслети",
    "Watches and bracelets",
    "Uhren und Armbänder",
    "Zegarki i bransoletki",
  ],
  "Сумки и рюкзаки": [
    "Сумки та рюкзаки",
    "Bags and backpacks",
    "Taschen und Rucksäcke",
    "Torby i plecaki",
  ],
  Госодежда: [
    "Службовий одяг",
    "Government uniforms",
    "Behördenkleidung",
    "Odzież służbowa",
  ],
  Усы: ["Вуса", "Moustaches", "Schnurrbärte", "Wąsy"],
  "Подвид вещи": ["Підвид речі", "Item type", "Art des Teils", "Rodzaj rzeczy"],
  "Причёски и руки — части тела: чужая вещь на их место не ставится": [
    "Зачіски й руки — частини тіла: чужа річ на їх місце не ставиться",
    "Hairstyles and hands are body parts: another item can't replace them",
    "Frisuren und Hände sind Körperteile: ein fremdes Teil ersetzt sie nicht",
    "Fryzury i dłonie to części ciała: cudza rzecz ich nie zastąpi",
  ],
  "Борода игры": ["Борода гри", "Game beard", "Spielbart", "Broda z gry"],
  "Усы игры": ["Вуса гри", "Game moustache", "Spielschnurrbart", "Wąsy z gry"],
  "Штатная борода — рисунок на лице: модель ляжет плоским рисунком, цвет задаёт игра":
    [
      "Штатна борода — малюнок на обличчі: модель ляже пласким малюнком, колір задає гра",
      "A stock beard is a drawing on the face: the model will lie flat as a drawing, the game sets the colour",
      "Der Spielbart ist ein Bild im Gesicht: das Modell liegt als flaches Bild darauf, die Farbe bestimmt das Spiel",
      "Standardowa broda to rysunek na twarzy: model ułoży się płaskim rysunkiem, kolor ustala gra",
    ],
  "На этой вкладке нет вещей этого подвида: показаны все вещи раздела": [
    "На цій вкладці немає речей цього підвиду: показано всі речі розділу",
    "There are no items of this type on this tab: showing all items of the section",
    "Auf diesem Tab gibt es keine Teile dieser Art: alle Teile des Bereichs sind zu sehen",
    "Na tej karcie nie ma rzeczy tego rodzaju: pokazano wszystkie rzeczy działu",
  ],
  "Будет — плоский рисунок на лице": [
    "Буде — пласкій малюнок на обличчі",
    "Result: a flat drawing on the face",
    "Ergebnis: ein flaches Bild im Gesicht",
    "Efekt: płaski rysunek na twarzy",
  ],
  "Часть бороды ниже подбородка в рисунок не войдёт": [
    "Частина бороди нижче підборіддя в малюнок не ввійде",
    "The part of the beard below the chin will not fit into the drawing",
    "Der Teil des Bartes unter dem Kinn passt nicht ins Bild",
    "Część brody poniżej brody nie zmieści się w rysunku",
  ],
  "Считаю рисунок…": [
    "Рахую малюнок…",
    "Computing the drawing…",
    "Bild wird berechnet …",
    "Obliczam rysunek…",
  ],
  "Не получилось посчитать рисунок бороды": [
    "Не вдалося порахувати малюнок бороди",
    "Could not compute the beard drawing",
    "Das Bartbild konnte nicht berechnet werden",
    "Nie udało się obliczyć rysunku brody",
  ],
  "На этой вкладке таких вещей нет": [
    "На цій вкладці таких речей немає",
    "No such items on this tab",
    "Auf diesem Tab gibt es keine solchen Teile",
    "Na tej karcie nie ma takich rzeczy",
  ],
  "Это часть тела: у проекта для неё своих вещей нет": [
    "Це частина тіла: у проєкту для неї власних речей немає",
    "This is a body part: the project has no items of its own for it",
    "Das ist ein Körperteil: Das Projekt hat dafür keine eigenen Teile",
    "To część ciała: projekt nie ma dla niej własnych rzeczy",
  ],
  "Они есть на других вкладках:": [
    "Вони є на інших вкладках:",
    "They are on other tabs:",
    "Sie sind auf anderen Tabs:",
    "Są na innych kartach:",
  ],
  "Открыть вкладку {tab}": [
    "Відкрити вкладку {tab}",
    "Open the {tab} tab",
    "Tab {tab} öffnen",
    "Otwórz kartę {tab}",
  ],
};
