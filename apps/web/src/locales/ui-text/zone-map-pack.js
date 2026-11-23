/*
 * Зона: map, «Карта из мода» на слоях (12.10). Словарь строк интерфейса:
 * русская строка → [uk, en, de, pl].
 *
 * Наборы, на которые режется карта мода (`pack-layers/categories.js`), ход
 * нарезки в строке статуса (`usePackLayers.js`), «Проверить подписи»
 * (`MapDoubtful.jsx`). Ключи с метками `{count}`, `{summary}` — фразы с
 * подстановкой (`mapText`); `{0}` — шаблоны имён наборов для перевода
 * разметки («Территории · линии»).
 */

const base = {
  /* Наборы слоёв карты мода. */
  "Гетто и капты": ["Гето й капти", "Ghettos and capts", "Ghettos und Capts", "Getta i capty"],
  "Точки гетто": ["Точки гето", "Ghetto points", "Ghetto-Punkte", "Punkty getta"],
  "Точки каптов": ["Точки каптів", "Capt points", "Capt-Punkte", "Punkty captów"],
  "Точки площадок": ["Точки майданчиків", "Site points", "Platzpunkte", "Punkty placów"],
  "Точки с номерами": ["Точки з номерами", "Numbered points", "Nummerierte Punkte", "Punkty z numerami"],
  "Грузовики": ["Вантажівки", "Trucks", "Lastwagen", "Ciężarówki"],
  "Чемоданы": ["Валізи", "Suitcases", "Koffer", "Walizki"],
  "Джипы": ["Джипи", "Jeeps", "Jeeps", "Jeepy"],
  "Баллончики": ["Балончики", "Spray cans", "Sprühdosen", "Puszki z farbą"],
  "Красные и золотые зоны": ["Червоні й золоті зони", "Red and gold zones", "Rote und goldene Zonen", "Czerwone i złote strefy"],
  "Территории": ["Території", "Territories", "Gebiete", "Terytoria"],
  "Зоны госструктур": ["Зони держструктур", "Government zones", "Behördenzonen", "Strefy służb państwowych"],
  "Промзоны": ["Промзони", "Industrial zones", "Industriegebiete", "Strefy przemysłowe"],
  "Зоны бизнесов": ["Зони бізнесів", "Business zones", "Geschäftszonen", "Strefy biznesów"],
  "Жилые зоны": ["Житлові зони", "Residential zones", "Wohngebiete", "Strefy mieszkalne"],
  "Контуры кварталов": ["Контури кварталів", "Block outlines", "Blockumrisse", "Kontury kwartałów"],
  /* Части имён наборов по отдельности: перевод разметки собирает подпись
     кнопки («Раскрыть «Территории · линии»») из переведённых кусков. */
  "линии": ["лінії", "lines", "Linien", "linie"],
  "заливка": ["заливка", "fill", "Füllung", "wypełnienie"],
  "{0} · линии": ["{0} · лінії", "{0} · lines", "{0} · Linien", "{0} · linie"],
  "{0} · заливка": ["{0} · заливка", "{0} · fill", "{0} · Füllung", "{0} · wypełnienie"],
  /* Имена объектов карты мода: «Зона 12», «Значок 3». */
  "Зона {0}": ["Зона {0}", "Zone {0}", "Zone {0}", "Strefa {0}"],
  "Точка {0}": ["Точка {0}", "Point {0}", "Punkt {0}", "Punkt {0}"],
  "Значок {0}": ["Значок {0}", "Icon {0}", "Symbol {0}", "Ikona {0}"],
  "Линия {0}": ["Лінія {0}", "Line {0}", "Linie {0}", "Linia {0}"],
  "Заливка {0}": ["Заливка {0}", "Fill {0}", "Füllung {0}", "Wypełnienie {0}"],

  /* Колонка «Карта»: проверка подписей и повторная нарезка. */
  "Проверить подписи": ["Перевірити підписи", "Check labels", "Beschriftungen prüfen", "Sprawdź podpisy"],
  "{count} — прочитаны с карты мода неуверенно или кусками. Щелчок — к подписи на карте, текст правится справа": [
    "{count} — прочитано з карти моду невпевнено або шматками. Клік — до підпису на карті, текст виправляється праворуч",
    "{count} read from the mod map with low confidence or in pieces. Click to jump to the label on the map; edit the text on the right",
    "{count} — von der Mod-Karte unsicher oder in Stücken gelesen. Klick springt zur Beschriftung auf der Karte, der Text wird rechts bearbeitet",
    "{count} — odczytane z mapy modyfikacji niepewnie lub kawałkami. Kliknięcie — do podpisu na mapie, tekst poprawia się po prawej",
  ],
  "Показать все {count}": ["Показати всі {count}", "Show all {count}", "Alle {count} anzeigen", "Pokaż wszystkie {count}"],
  "Всё проверено": ["Усе перевірено", "All checked", "Alles geprüft", "Wszystko sprawdzone"],
  "Подписи карты мода проверены": ["Підписи карти моду перевірено", "Mod map labels checked", "Beschriftungen der Mod-Karte geprüft", "Podpisy mapy modyfikacji sprawdzone"],
  "Разрезать на слои": ["Розрізати на шари", "Split into layers", "In Ebenen zerlegen", "Podziel na warstwy"],
  "Подписи, точки, зоны и значки — отдельными объектами": [
    "Підписи, точки, зони й значки — окремими об'єктами",
    "Labels, points, zones and icons as separate objects",
    "Beschriftungen, Punkte, Zonen und Symbole als einzelne Objekte",
    "Podpisy, punkty, strefy i ikony jako osobne obiekty",
  ],

  /* Ход нарезки в строке статуса. */
  "Карта мода не разрезалась на слои: {reason}": [
    "Карта моду не розрізалася на шари: {reason}",
    "The mod map wasn't split into layers: {reason}",
    "Die Mod-Karte wurde nicht in Ebenen zerlegt: {reason}",
    "Mapa modyfikacji nie podzieliła się na warstwy: {reason}",
  ],
  "Карта мода разрезана на слои: {summary} — всё правится": [
    "Карту моду розрізано на шари: {summary} — усе можна редагувати",
    "The mod map is split into layers: {summary}, all editable",
    "Die Mod-Karte ist in Ebenen zerlegt: {summary} — alles bearbeitbar",
    "Mapa modyfikacji podzielona na warstwy: {summary} — wszystko można edytować",
  ],
  "Карта мода разрезана на слои: {summary} — всё правится. Подписи не прочлись и стоят значками": [
    "Карту моду розрізано на шари: {summary} — усе можна редагувати. Підписи не прочиталися й стоять значками",
    "The mod map is split into layers: {summary}, all editable. The labels couldn't be read and stay as icons",
    "Die Mod-Karte ist in Ebenen zerlegt: {summary} — alles bearbeitbar. Die Beschriftungen ließen sich nicht lesen und bleiben Symbole",
    "Mapa modyfikacji podzielona na warstwy: {summary} — wszystko można edytować. Podpisów nie udało się odczytać i zostały ikonami",
  ],
  "Режем карту мода на слои: читаем подписи — {share} %": [
    "Розрізаємо карту моду на шари: читаємо підписи — {share} %",
    "Splitting the mod map into layers: reading labels — {share} %",
    "Mod-Karte wird in Ebenen zerlegt: Beschriftungen werden gelesen — {share} %",
    "Dzielimy mapę modyfikacji na warstwy: czytamy podpisy — {share} %",
  ],
  "Режем карту мода на слои…": ["Розрізаємо карту моду на шари…", "Splitting the mod map into layers…", "Mod-Karte wird in Ebenen zerlegt…", "Dzielimy mapę modyfikacji na warstwy…"],
  "Карта мода — на слои: подписи, точки, значки, зоны": [
    "Карта моду — на шари: підписи, точки, значки, зони",
    "Mod map into layers: labels, points, icons, zones",
    "Mod-Karte in Ebenen: Beschriftungen, Punkte, Symbole, Zonen",
    "Mapa modyfikacji na warstwy: podpisy, punkty, ikony, strefy",
  ],
  "Карта мода — на слои": ["Карта моду — на шари", "Mod map into layers", "Mod-Karte in Ebenen", "Mapa modyfikacji na warstwy"],
  "точка": ["точка", "point", "Punkt", "punkt"],
  "точек": ["точок", "points", "Punkte", "punktów"],
  "значок": ["значок", "icon", "Symbol", "ikona"],
  "значка": ["значки", "icons", "Symbole", "ikony"],
  "значков": ["значків", "icons", "Symbole", "ikon"],
  "зона и линия": ["зона й лінія", "zone or line", "Zone oder Linie", "strefa lub linia"],
  "зоны и линии": ["зони й лінії", "zones and lines", "Zonen und Linien", "strefy i linie"],
  "зон и линий": ["зон і ліній", "zones and lines", "Zonen und Linien", "stref i linii"],
};

/*
 * Составные имена наборов («Территории · линии», «Прочее · заливка»): колонка
 * «Слои» переводит имя набора целиком (`tr`), и шаблона ей мало — имена
 * собираются здесь из переведённых частей.
 */
const ZONE_SETS = ["Площадки", "Зоны мероприятий", "Красные и золотые зоны", "Территории", "Зоны госструктур", "Промзоны", "Зоны бизнесов", "Жилые зоны", "Контуры кварталов", "Круги госов и крафта", "Прочее"];
const KINDS = { "{0} · линии": "линии", "{0} · заливка": "заливка" };

const own = (key, known) => base[key] || known[key];
function composed(known) {
  const out = {};
  const put = (template, part) => {
    const words = own(template, known);
    const inner = own(part, known);
    if (!words || !inner) return;
    out[template.replace("{0}", part)] = words.map((word, at) => word.replace("{0}", inner[at]));
  };
  for (const template of Object.keys(KINDS)) for (const set of ZONE_SETS) put(template, set);
  return out;
}

export const zoneMapPack = { ...base };
/** Имена наборов, собранные из частей; `known` — остальной словарь (части из него). */
export const zoneMapPackComposed = (known) => composed(known);
