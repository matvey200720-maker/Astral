import { useUiLanguage } from "../../../locales/ui.js";

// Порядок языков в строках каталога: ru, uk, en, de, pl, fr.
const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

// Каталог: ключ -> шаблоны по порядку языков.
// {N} — N-й аргумент как есть, {N|lower} — N-й аргумент в нижнем регистре.
// Во французских шаблонах \u00a0 — неразрывный пробел перед двоеточием и внутри « ».
const CATALOG = {
  lowHealthHint: [
    "Малое HP — когда здоровья {0} и меньше, как в игре: полоса краснеет этим цветом и мигает.",
    "Мале HP — коли здоров’я {0} і менше, як у грі: смуга червоніє цим кольором і мигає.",
    "Low HP is when health is {0} or less, as in the game: the bar turns this colour and blinks.",
    "Wenig HP heißt: {0} Gesundheit oder weniger, wie im Spiel — die Leiste färbt sich in dieser Farbe und blinkt.",
    "Małe HP to zdrowie {0} i mniej, jak w grze: pasek zmienia się na ten kolor i miga.",
    "Peu de HP\u00a0: quand la santé est à {0} ou moins, comme dans le jeu, la barre prend cette couleur et clignote.",
  ],
  widgetMoved: [
    "Перемещён элемент «{0}»",
    "Переміщено елемент «{0}»",
    "Moved element “{0}”",
    "Element „{0}“ verschoben",
    "Przesunięto element „{0}”",
    "Élément «\u00a0{0}\u00a0» déplacé",
  ],
  widgetNudged: [
    "Элемент «{0}» сдвинут с клавиатуры",
    "Елемент «{0}» зсунуто з клавіатури",
    "Element “{0}” nudged with the keyboard",
    "Element „{0}“ mit der Tastatur verschoben",
    "Element „{0}” przesunięto klawiaturą",
    "Élément «\u00a0{0}\u00a0» déplacé au clavier",
  ],
  widgetPlaced: [
    "{0} — на карте",
    "{0} — на карті",
    "{0} — on the map",
    "{0} — auf der Karte",
    "{0} — na mapie",
    "{0} — sur la carte",
  ],
  widgetShown: [
    "Показан элемент «{0}»",
    "Показано елемент «{0}»",
    "Showed element “{0}”",
    "Element „{0}“ eingeblendet",
    "Pokazano element „{0}”",
    "Élément «\u00a0{0}\u00a0» affiché",
  ],
  widgetHidden: [
    "Скрыт элемент «{0}»",
    "Приховано елемент «{0}»",
    "Hid element “{0}”",
    "Element „{0}“ ausgeblendet",
    "Ukryto element „{0}”",
    "Élément «\u00a0{0}\u00a0» masqué",
  ],
  widgetLocked: [
    "Зафиксирован элемент «{0}»",
    "Зафіксовано елемент «{0}»",
    "Locked element “{0}”",
    "Element „{0}“ gesperrt",
    "Zablokowano element „{0}”",
    "Élément «\u00a0{0}\u00a0» verrouillé",
  ],
  widgetUnlocked: [
    "Разблокирован элемент «{0}»",
    "Розблоковано елемент «{0}»",
    "Unlocked element “{0}”",
    "Element „{0}“ entsperrt",
    "Odblokowano element „{0}”",
    "Élément «\u00a0{0}\u00a0» déverrouillé",
  ],
  iconSize: [
    "Изменён размер значка «{0}»",
    "Змінено розмір значка «{0}»",
    "Changed the size of icon “{0}”",
    "Größe des Symbols „{0}“ geändert",
    "Zmieniono rozmiar ikony „{0}”",
    "Taille de l’icône «\u00a0{0}\u00a0» modifiée",
  ],
  widgetDrag: [
    "{0}, перетащить",
    "{0}, перетягнути",
    "{0}, drag",
    "{0}, ziehen",
    "{0}, przeciągnij",
    "{0}, faire glisser",
  ],
  zoomStep: [
    "Дальность {0|lower}: {1}",
    "Дальність огляду, {0|lower}: {1}",
    "View range, {0|lower}: {1}",
    "Sichtweite ({0}): {1}",
    "Zasięg widzenia, {0|lower}: {1}",
    "Portée de vue, {0|lower}\u00a0: {1}",
  ],
  outlineOn: [
    "Обводка {0|lower}: включена",
    "Обвідка {0|lower}: увімкнено",
    "Outline, {0|lower}: on",
    "Umriss {0}: an",
    "Obrys, {0|lower}: włączony",
    "Contour, {0|lower}\u00a0: activé",
  ],
  outlineOff: [
    "Обводка {0|lower}: выключена",
    "Обвідка {0|lower}: вимкнено",
    "Outline, {0|lower}: off",
    "Umriss {0}: aus",
    "Obrys, {0|lower}: wyłączony",
    "Contour, {0|lower}\u00a0: désactivé",
  ],
  kilobytes: ["{0} КБ", "{0} КБ", "{0} KB", "{0} KB", "{0} KB", "{0} Ko"],
  // Сводка ролика: кадры, частота, секунды, ширина × высота
  videoInfo: [
    "{0} кадров · {1} кадров/с · {2} с · {3}×{4}",
    "{0} кадрів · {1} кадрів/с · {2} с · {3}×{4}",
    "{0} frames · {1} fps · {2} s · {3}×{4}",
    "{0} Bilder · {1} Bilder/s · {2} s · {3}×{4}",
    "{0} klatek · {1} kl./s · {2} s · {3}×{4}",
    "{0} images · {1} i/s · {2} s · {3}×{4}",
  ],
  // Хвост сводки, когда есть заметки о сжатии (шестой аргумент)
  videoNotes: [
    ". Сжато: {5}.",
    ". Стиснено: {5}.",
    ". Compressed: {5}.",
    ". Komprimiert: {5}.",
    ". Skompresowano: {5}.",
    ". Compressé\u00a0: {5}.",
  ],
  noteFps: [
    "{0} кадров/с вместо 30",
    "{0} кадрів/с замість 30",
    "{0} fps instead of 30",
    "{0} Bilder/s statt 30",
    "{0} kl./s zamiast 30",
    "{0} i/s au lieu de 30",
  ],
  noteSeconds: [
    "первые {0} с",
    "перші {0} с",
    "first {0} s",
    "die ersten {0} s",
    "pierwsze {0} s",
    "les {0} premières secondes",
  ],
  noteWidth: [
    "{0} точек в длину",
    "{0} точок у довжину",
    "{0} px long",
    "{0} Punkte Länge",
    "{0} punktów długości",
    "{0} px de longueur",
  ],
  noteLevels: [
    "{0} оттенков на канал",
    "{0} відтінків на канал",
    "{0} shades per channel",
    "{0} Stufen pro Kanal",
    "{0} odcieni na kanał",
    "{0} nuances par canal",
  ],
  pauseMap: [
    "Карта паузы: маршрут к метке «{0}»",
    "Карта паузи: маршрут до мітки «{0}»",
    "Pause map: route to the marker “{0}”",
    "Pausenkarte: Route zur Markierung „{0}“",
    "Mapa pauzy: trasa do znacznika „{0}”",
    "Carte de pause\u00a0: itinéraire vers le repère «\u00a0{0}\u00a0»",
  ],
  routeShorter: [
    "{0}, короче на {1}",
    "{0}, коротше на {1}",
    "{0}, {1} shorter",
    "{0}, {1} kürzer",
    "{0}, krótsza o {1}",
    "{0}, plus court de {1}",
  ],
  kilometreUnit: ["км", "км", "km", "km", "km", "km"],
  metreUnit: ["м", "м", "m", "m", "m", "m"],
  decimal: [",", ",", ".", ",", ",", ","],
  lineStyleStep: [
    "Линия маршрута: {0|lower}",
    "Лінія маршруту: {0|lower}",
    "Route line: {0|lower}",
    "Routenlinie: {0}",
    "Linia trasy: {0|lower}",
    "Ligne d’itinéraire\u00a0: {0|lower}",
  ],
};

// Виды линии маршрута: id -> пары [название, пояснение] по порядку языков.
const LINE_STYLES = {
  solid: [
    ["Сплошная", "Как в игре"],
    ["Суцільна", "Як у грі"],
    ["Solid", "As in the game"],
    ["Durchgezogen", "Wie im Spiel"],
    ["Ciągła", "Jak w grze"],
    ["Continue", "Comme dans le jeu"],
  ],
  dashed: [
    ["Пунктир", "Короткие штрихи"],
    ["Пунктир", "Короткі штрихи"],
    ["Dashed", "Short dashes"],
    ["Gestrichelt", "Kurze Striche"],
    ["Przerywana", "Krótkie kreski"],
    ["Tirets", "Tirets courts"],
  ],
  broken: [
    ["Разрывчатая", "Длинные отрезки, короткие разрывы"],
    ["Переривчаста", "Довгі відрізки, короткі розриви"],
    ["Long dashes", "Long segments, short gaps"],
    ["Unterbrochen", "Lange Abschnitte, kurze Lücken"],
    ["Z długimi kreskami", "Długie odcinki, krótkie przerwy"],
    ["Tirets longs", "Segments longs, coupures courtes"],
  ],
  dotted: [
    ["Точки", "Круглые точки"],
    ["Крапки", "Круглі крапки"],
    ["Dots", "Round dots"],
    ["Punkte", "Runde Punkte"],
    ["Kropki", "Okrągłe kropki"],
    ["Points", "Points ronds"],
  ],
  dashdot: [
    ["Штрих-пунктир", "Штрих, точка, штрих"],
    ["Штрих-пунктир", "Штрих, крапка, штрих"],
    ["Dash-dot", "Dash, dot, dash"],
    ["Strich-Punkt", "Strich, Punkt, Strich"],
    ["Kreska-kropka", "Kreska, kropka, kreska"],
    ["Tiret-point", "Tiret, point, tiret"],
  ],
};

const PLACEHOLDER = /\{(\d)(\|lower)?\}/g;

// Подставляет аргументы как шаблонная строка: без экранирования и повторного разбора.
function fill(template, args) {
  return template.replace(PLACEHOLDER, (_, index, lower) =>
    lower ? String(args[index]).toLowerCase() : args[index],
  );
}

// Набор сообщений одного языка (lang — позиция языка в LANGUAGES).
function buildCopy(lang) {
  const text = Object.fromEntries(
    Object.entries(CATALOG).map(([key, row]) => [key, row[lang]]),
  );
  const videoInfoWithNotes = text.videoInfo + text.videoNotes;

  return {
    lowHealthHint: (health) => fill(text.lowHealthHint, [health]),
    widgetMoved: (label) => fill(text.widgetMoved, [label]),
    widgetNudged: (label) => fill(text.widgetNudged, [label]),
    widgetPlaced: (label) => fill(text.widgetPlaced, [label]),
    widgetShown: (label, shown) =>
      fill(shown ? text.widgetShown : text.widgetHidden, [label]),
    widgetLocked: (label, locked) =>
      fill(locked ? text.widgetLocked : text.widgetUnlocked, [label]),
    iconSize: (label) => fill(text.iconSize, [label]),
    widgetDrag: (label) => fill(text.widgetDrag, [label]),
    zoomStep: (state, factor) => fill(text.zoomStep, [state, factor]),
    outlineSide: (side, on) =>
      fill(on ? text.outlineOn : text.outlineOff, [side]),
    kilobytes: (kilobytes) => fill(text.kilobytes, [kilobytes]),
    videoInfo: ({ frames, fps, seconds, width, height, notes }) =>
      fill(notes ? videoInfoWithNotes : text.videoInfo, [
        frames,
        fps,
        seconds,
        width,
        height,
        notes,
      ]),
    noteFps: (fps) => fill(text.noteFps, [fps]),
    noteSeconds: (seconds) => fill(text.noteSeconds, [seconds]),
    noteWidth: (width) => fill(text.noteWidth, [width]),
    noteLevels: (levels) => fill(text.noteLevels, [levels]),
    pauseMap: (place) => fill(text.pauseMap, [place]),
    // Без разницы возвращается длина маршрута как есть, без приведения к строке
    routeShorter: (km, diff) =>
      diff ? fill(text.routeShorter, [km, diff]) : km,
    kilometreUnit: text.kilometreUnit,
    metreUnit: text.metreUnit,
    decimal: text.decimal,
    lineStyleStep: (style) => fill(text.lineStyleStep, [style]),
    lineStyles: Object.fromEntries(
      Object.entries(LINE_STYLES).map(([id, byLanguage]) => {
        const [label, note] = byLanguage[lang];
        return [id, { label, note }];
      }),
    ),
  };
}

const COPIES = Object.fromEntries(
  LANGUAGES.map((code, lang) => [code, buildCopy(lang)]),
);

// Язык ищется как ключ обычного объекта; незнакомый даёт английский набор.
export function minimapCopyFor(language) {
  return COPIES[language] ?? COPIES.en;
}

export function useMinimapCopy() {
  return minimapCopyFor(useUiLanguage());
}

// «7,1 км» -> запись расстояния на языке набора: единица и десятичный разделитель.
export function localKilometres(copy, text) {
  const unit = ` ${copy.kilometreUnit}`;
  return String(text).replace(/ км$/, unit).replace(",", copy.decimal);
}
