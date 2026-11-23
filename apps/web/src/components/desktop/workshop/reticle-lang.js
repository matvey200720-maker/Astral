// Сообщения редактора прицела на шести языках окна.

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];
const NBSP = "\u00a0";

// Строки по порядку LANGUAGES -> объект «код языка -> строка».
// Поиск по языку идёт как по обычному объекту: имя встроенного свойства
// («toString», «__proto__») вместо языка отдаёт встроенное значение, как у эталона.
const byLanguage = (row) =>
  Object.fromEntries(LANGUAGES.map((code, i) => [code, row[i]]));

// Шаблоны сообщений. {0} — аргумент как есть; {0|раз|раза} — слово по числу
// аргумента: вторая форма для остатка 2–4 (кроме 12–14), иначе первая.
const TEMPLATES = Object.fromEntries(
  Object.entries({
    atCrosshair: [
      "у прицела {0}",
      "у прицілу {0}",
      "on crosshair {0}",
      "bei Fadenkreuz {0}",
      "przy celowniku {0}",
      "sur le réticule {0}",
    ],
    removeCrosshair: [
      "Убрать: {0}",
      "Прибрати: {0}",
      "Remove: {0}",
      "Entfernen: {0}",
      "Usuń: {0}",
      `Retirer${NBSP}: {0}`,
    ],
    showMoreStyles: [
      "Показать ещё {0}",
      "Показати ще {0}",
      "Show {0} more",
      "{0} weitere anzeigen",
      "Pokaż jeszcze {0}",
      "Afficher {0} de plus",
    ],
    digitsMinThickness: [
      "С цифрами внутри полоска не тоньше {0} пт",
      "З цифрами всередині смужка не тонша за {0} пт",
      "With digits inside, the bar is no thinner than {0} pt",
      "Mit Ziffern darin ist die Leiste mindestens {0} Pt. dick",
      "Z cyframi w środku pasek nie jest cieńszy niż {0} pkt",
      "Avec des chiffres à l'intérieur, la barre ne fait pas moins de {0} pt",
    ],
    pixelsAt1080: [
      "{0} px на 1080p",
      "{0} px на 1080p",
      "{0} px at 1080p",
      "{0} px bei 1080p",
      "{0} px przy 1080p",
      "{0} px à 1080p",
    ],
    stageZoomClause: [
      ", приближенные в {0} {0|раз|раза}",
      ", збільшені у {0} {0|разів|рази}",
      ", magnified {0}×",
      ", {0}-fach vergrößert",
      ", powiększone {0}-krotnie",
      ", agrandies {0} fois",
    ],
    stageFocusTail: [
      ". Метка того, на кого навелись, приближена в {0} {0|раз|раза}.",
      ". Мітка того, на кого навелися, збільшена у {0} {0|разів|рази}.",
      ". The tag of the player you are aiming at is magnified {0}×.",
      ". Die Markierung des anvisierten Spielers ist {0}-fach vergrößert.",
      ". Znacznik namierzonego gracza jest powiększony {0}-krotnie.",
      ". Le repère du joueur visé est agrandi {0} fois.",
    ],
  }).map(([id, row]) => [id, byLanguage(row)]),
);

// Название линии креста: в таблице ru хранит одно слово стороны, остальные — готовые фразы.
// Для ru перед словом ставится «Линия», для неизвестного языка остаётся одно слово
// (повтор поведения эталона).
const ARM_NAMES = Object.fromEntries(
  Object.entries({
    armTop: [
      "сверху",
      "Лінія зверху",
      "Top line",
      "Linie oben",
      "Linia u góry",
      "Ligne du haut",
    ],
    armRight: [
      "справа",
      "Лінія справа",
      "Right line",
      "Linie rechts",
      "Linia z prawej",
      "Ligne de droite",
    ],
    armBottom: [
      "снизу",
      "Лінія знизу",
      "Bottom line",
      "Linie unten",
      "Linia na dole",
      "Ligne du bas",
    ],
    armLeft: [
      "слева",
      "Лінія зліва",
      "Left line",
      "Linie links",
      "Linia z lewej",
      "Ligne de gauche",
    ],
  }).map(([key, row]) => [key, byLanguage(row)]),
);

// Слово состояния: [линия поставлена, линия убрана].
const ARM_STATES = byLanguage([
  ["поставлена", "убрана"],
  ["поставлена", "прибрана"],
  ["added", "removed"],
  ["gesetzt", "entfernt"],
  ["ustawiona", "usunięta"],
  ["placée", "retirée"],
]);

const isFew = (value) => {
  const n = Number(value);
  return [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100);
};

const fill = (template, args) =>
  template.replace(
    /\{(\d)(?:\|([^|}]*)\|([^}]*))?\}/g,
    (_, index, many, few) =>
      many === undefined ? `${args[index]}` : isFew(args[index]) ? few : many,
  );

const render = (id, language, args) => {
  const forms = TEMPLATES[id];
  const template = forms[language] ?? forms.ru;
  return typeof template === "string" ? fill(template, args) : template;
};

export const lowerFor = (language, text) =>
  language === "de" ? String(text) : String(text).toLowerCase();

export const armPatchLabel = (language, key, placed) => {
  const names = ARM_NAMES[key];
  const name =
    language === "ru" ? `Линия ${names.ru}` : (names[language] ?? names.ru);
  const states = ARM_STATES[language] ?? ARM_STATES.ru;
  return `${name}: ${states[placed ? 0 : 1]}`;
};

export const atCrosshair = (language, number) =>
  render("atCrosshair", language, [number]);

export const removeCrosshair = (language, title) =>
  render("removeCrosshair", language, [title]);

export const showMoreStyles = (language, count) =>
  render("showMoreStyles", language, [count]);

export const digitsMinThickness = (language, size) =>
  render("digitsMinThickness", language, [size]);

export const pixelsAt1080 = (language, px) =>
  render("pixelsAt1080", language, [px]);

export const stageZoomClause = (language, zoom) =>
  render("stageZoomClause", language, [zoom]);

export const stageFocusTail = (language, focus, zoom) =>
  focus ? render("stageFocusTail", language, [zoom]) : ".";
