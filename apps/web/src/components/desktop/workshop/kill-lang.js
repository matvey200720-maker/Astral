import {
  KILL_MARKER_ICONS,
  KILL_MARKER_MOTIONS,
  resolveChannelValue,
  resolveKillEffectFields,
} from "@modovik/kill-effects";
import { tr } from "../../../locales/ui.js";

const LANGUAGES = "ru uk en de pl fr".split(" ");

// Тексты хранятся блоками через пустую строку. Первая строка блока — заголовок,
// дальше по строке на язык: «код язык-пробел текст».
// В сообщениях {N} вставляет N-й аргумент, {слово:N} — форму слова по N-му.
const MESSAGE_TEXT = `
ms 0
ru мс
uk мс
en ms
de ms
pl ms
fr ms

s 0
ru с
uk с
en s
de s
pl s
fr s

gifLoaded 2
ru Гифка «{0}» загружена: {1} {frame:1}
uk Гіфку «{0}» завантажено: {1} {frame:1}
en GIF “{0}” loaded: {1} {frame:1}
de GIF „{0}“ geladen: {1} {frame:1}
pl GIF „{0}” wczytany: {1} {frame:1}
fr GIF «\u00a0{0}\u00a0» chargé\u00a0: {1} {frame:1}

imageLoaded 1
ru Картинка «{0}» загружена
uk Картинку «{0}» завантажено
en Image “{0}” loaded
de Bild „{0}“ geladen
pl Obraz „{0}” wczytany
fr Image «\u00a0{0}\u00a0» chargée

templateLoaded 1
ru Шаблон «{0}» загружен
uk Шаблон «{0}» завантажено
en Template “{0}” loaded
de Vorlage „{0}“ geladen
pl Szablon „{0}” wczytany
fr Gabarit «\u00a0{0}\u00a0» chargé

openedFromGame 1
ru Открыт килл-эффект из вашей GTA V: {0} {parameter:0}
uk Відкрито кілл-ефект із вашої GTA V: {0} {parameter:0}
en Opened the kill effect from your GTA V: {0} {parameter:0}
de Kill-Effekt aus Ihrer GTA V geöffnet: {0} {parameter:0}
pl Otwarto efekt zabójstwa z twojej GTA V: {0} {parameter:0}
fr Effet de kill de votre GTA V ouvert\u00a0: {0} {parameter:0}

durationPart 1
ru , длительность {0}
uk , тривалість {0}
en , duration {0}
de , Dauer {0}
pl , czas trwania {0}
fr , durée {0}

markerPart 1
ru , знак на килле — {0} {frame:0}
uk , знак на кіллі — {0} {frame:0}
en , kill marker — {0} {frame:0}
de , Killmarkierung — {0} {frame:0}
pl , znak zabójstwa — {0} {frame:0}
fr , marqueur de kill — {0} {frame:0}

installed 2
ru Килл-эффект установлен: {0} {parameter:0}{1}
uk Кілл-ефект встановлено: {0} {parameter:0}{1}
en Kill effect installed: {0} {parameter:0}{1}
de Kill-Effekt installiert: {0} {parameter:0}{1}
pl Efekt zabójstwa zainstalowany: {0} {parameter:0}{1}
fr Effet de kill installé\u00a0: {0} {parameter:0}{1}

projectLoaded 1
ru Проект «{0}» загружен
uk Проєкт «{0}» завантажено
en Project “{0}” loaded
de Projekt „{0}“ geladen
pl Projekt „{0}” wczytany
fr Projet «\u00a0{0}\u00a0» chargé

inGame 2
ru В вашей GTA V: {0} {parameter:0}, {1}
uk У вашій GTA V: {0} {parameter:0}, {1}
en In your GTA V: {0} {parameter:0}, {1}
de In Ihrer GTA V: {0} {parameter:0}, {1}
pl W twojej GTA V: {0} {parameter:0}, {1}
fr Dans votre GTA V\u00a0: {0} {parameter:0}, {1}

toggle 1
ru Включить: {0}
uk Увімкнути: {0}
en Turn on: {0}
de Einschalten: {0}
pl Włącz: {0}
fr Activer\u00a0: {0}

gifHint 1
ru Гифка, {0} {frame:0} — уедет в игру теми же кадрами
uk Гіфка, {0} {frame:0} — піде в гру тими самими кадрами
en GIF, {0} {frame:0} — goes into the game with the same frames
de GIF, {0} {frame:0} — kommt mit denselben Bildern ins Spiel
pl GIF, {0} {frame:0} — trafi do gry tymi samymi klatkami
fr GIF, {0} {frame:0} — arrivera dans le jeu avec les mêmes images

noFlash 0
ru без вспышки
uk без спалаху
en no flash
de kein Blitz
pl bez błysku
fr sans flash

tint 1
ru оттенок {0}
uk відтінок {0}
en tint {0}
de Farbton {0}
pl odcień {0}
fr teinte {0}

saturation 1
ru насыщенность {0} %
uk насиченість {0} %
en saturation {0} %
de Sättigung {0} %
pl nasycenie {0} %
fr saturation {0}\u00a0%

gradient 0
ru экранный градиент
uk градієнт по екрану
en screen gradient
de Bildschirmverlauf
pl gradient ekranu
fr dégradé d’écran

fog 0
ru туман
uk туман
en fog
de Nebel
pl mgła
fr brouillard

intensity 1
ru интенсивность {0} %
uk інтенсивність {0} %
en intensity {0} %
de Intensität {0} %
pl intensywność {0} %
fr intensité {0}\u00a0%

markerTag 1
ru знак: {0}
uk знак: {0}
en marker: {0}
de Markierung: {0}
pl znak: {0}
fr marqueur\u00a0: {0}

emoji 1
ru эмодзи {0}
uk емодзі {0}
en emoji {0}
de Emoji {0}
pl emoji {0}
fr emoji {0}

text 1
ru надпись «{0}»
uk напис «{0}»
en text “{0}”
de Schriftzug „{0}“
pl napis „{0}”
fr inscription «\u00a0{0}\u00a0»

imageNone 0
ru своя картинка (не выбрана)
uk своя картинка (не вибрана)
en own picture (not chosen)
de eigenes Bild (nicht gewählt)
pl własny obraz (nie wybrano)
fr image personnalisée (non choisie)

gif 2
ru своя гифка «{0}», {1} {frame:1}
uk своя гіфка «{0}», {1} {frame:1}
en own GIF “{0}”, {1} {frame:1}
de eigenes GIF „{0}“, {1} {frame:1}
pl własny GIF „{0}”, {1} {frame:1}
fr GIF personnalisé «\u00a0{0}\u00a0», {1} {frame:1}

image 1
ru своя картинка «{0}»
uk своя картинка «{0}»
en own picture “{0}”
de eigenes Bild „{0}“
pl własny obraz „{0}”
fr image personnalisée «\u00a0{0}\u00a0»

icon 1
ru значок «{0}»
uk значок «{0}»
en icon “{0}”
de Symbol „{0}“
pl ikona „{0}”
fr icône «\u00a0{0}\u00a0»
`;

// Формы слов, склоняемых по числу, через «/»; у русского форма одна.
const NOUN_TEXT = `
frame
ru кадр.
uk кадр/кадри/кадрів
en frame/frames
de Bild/Bilder
pl klatka/klatki/klatek
fr image/images

parameter
ru параметров
uk параметр/параметри/параметрів
en parameter/parameters
de Parameter/Parameter
pl parametr/parametry/parametrów
fr paramètre/paramètres
`;

function parseBlocks(source) {
  return source
    .trim()
    .split("\n\n")
    .map((block) => {
      const [head, ...rows] = block.split("\n");
      const texts = {};
      for (const row of rows) texts[row.slice(0, 2)] = row.slice(3);
      return { head: head.split(" "), texts };
    });
}

const MESSAGES = parseBlocks(MESSAGE_TEXT).map(
  ({ head: [key, params], texts }) => ({
    key,
    params: Number(params),
    texts,
  }),
);

const NOUNS = {};
for (const { head, texts } of parseBlocks(NOUN_TEXT)) {
  NOUNS[head[0]] = Object.fromEntries(
    LANGUAGES.map((language) => [language, texts[language].split("/")]),
  );
}

// Выбиральщик формы слова по числу. Номер формы берётся из таблицы по категории
// Intl.PluralRules, а категория вне таблицы даёт последнюю форму. Число берётся
// по модулю, а всё, что числом не стало, считается нулём.
function formPicker(language, formOf) {
  const rules = new Intl.PluralRules(language);
  return (forms, value) =>
    forms[
      formOf[rules.select(Math.abs(Number(value)) || 0)] ?? forms.length - 1
    ];
}

const SLAVIC_FORMS = { one: 0, few: 1 };
const PAIR_FORMS = { one: 0 };

// Русский не склоняется: форма всегда первая.
const PICK_FORM = {
  ru: (forms) => forms[0],
  uk: formPicker("uk", SLAVIC_FORMS),
  en: formPicker("en", PAIR_FORMS),
  de: formPicker("de", PAIR_FORMS),
  pl: formPicker("pl", SLAVIC_FORMS),
  fr: formPicker("fr", PAIR_FORMS),
};

const PLACEHOLDER = /\{(?:([a-z]+):)?(\d)\}/g;

// Подстановщик для языка: значения вставляются своим обычным строковым видом.
function fillerFor(language) {
  const pick = PICK_FORM[language];
  return (template, args) =>
    template.replace(PLACEHOLDER, (_, noun, argIndex) => {
      const value = args[argIndex];
      return noun ? pick(NOUNS[noun][language], value) : `${value}`;
    });
}

// Имя и число параметров функции задаёт место объявления в литерале.
function createMessage(key, params, fill, template) {
  return params === 2
    ? { [key]: (first, second) => fill(template, [first, second]) }[key]
    : { [key]: (value) => fill(template, [value]) }[key];
}

function buildCopy(language) {
  const fill = fillerFor(language);
  const copy = {};
  for (const { key, params, texts } of MESSAGES) {
    const text = texts[language];
    copy[key] = params === 0 ? text : createMessage(key, params, fill, text);
  }
  return copy;
}

const COPIES = Object.fromEntries(
  LANGUAGES.map((language) => [language, buildCopy(language)]),
);

// Русская подпись записи списка с этим id; записи нет или подпись пуста — сам id.
function labelOf(list, id) {
  for (let at = 0; at < list.length; at += 1) {
    if (list[at].id === id) return list[at].label || id;
  }
  return id;
}

// Метод набора читается раньше вызова tr (с пустым набором tr не звали бы),
// а вызывается после: Reflect.apply сохраняет этот порядок.
function iconLine(copy, source) {
  return Reflect.apply(copy.icon, copy, [
    tr(labelOf(KILL_MARKER_ICONS, source.icon)),
  ]);
}

function imageLine(copy, source) {
  if (!source.asset) return copy.imageNone;
  if (source.animated) return copy.gif(source.name, source.frames);
  return copy.image(source.name);
}

// Строка о картинке знака по виду источника; любой другой вид — значок.
const SOURCE_LINES = new Map([
  ["emoji", (copy, source) => copy.emoji(source.emoji)],
  ["text", (copy, source) => copy.text(source.text)],
  ["image", imageLine],
]);

// Части описания эффекта после длительности: когда показывать и что сказать.
const EXTRA_PARTS = [
  {
    shown: ({ tint }) => tint?.amount > 0,
    say: ({ copy, tint }) => copy.tint(tint.color),
  },
  {
    shown: ({ saturation }) => saturation && saturation.value !== 100,
    say: ({ copy, saturation }) =>
      copy.saturation(Math.round(saturation.value)),
  },
  {
    shown: ({ gradient }) => gradient,
    say: ({ copy }) => copy.gradient,
  },
  {
    shown: ({ fog }) => fog,
    say: ({ copy }) => copy.fog,
  },
  {
    shown: ({ project }) => project.intensity !== 100,
    say: ({ copy, project }) => copy.intensity(project.intensity),
  },
];

// Набор берётся обычным обращением по ключу, без проверки собственности:
// встроенные имена вроде toString находят унаследованное, а нет ключа — русский.
export function killCopyFor(language) {
  const copy = COPIES[language];
  return copy ?? COPIES.ru;
}

export function describeKillMarkerSourceFor(copy, source) {
  return (SOURCE_LINES.get(source.kind) ?? iconLine)(copy, source);
}

export function describeKillMarkerFor(copy, marker) {
  const active = marker?.enabled;
  if (!active) return "";
  // Подпись движения переводится раньше описания картинки: так идут вызовы tr.
  const motion =
    marker.motion === "still"
      ? null
      : tr(labelOf(KILL_MARKER_MOTIONS, marker.motion)).toLowerCase();
  const picture = `${describeKillMarkerSourceFor(copy, marker.source)}`;
  const timing = `${marker.duration} ${copy.ms}`;
  return [picture, motion, timing].filter((piece) => piece !== null).join(", ");
}

// Последняя часть описания эффекта: пометка о знаке, если знак описан.
function markerNote(copy, marker) {
  const text = describeKillMarkerFor(copy, marker);
  return text ? [copy.markerTag(text)] : [];
}

export function describeKillEffectFor(copy, project) {
  const [tint, saturation, gradient, fog] = [
    "tint",
    "saturation",
    "gradient",
    "fog",
  ].map((id) => resolveChannelValue(project, id));
  const duration = `${project.duration} ${copy.ms}`;

  const view = { copy, project, tint, saturation, gradient, fog };
  const extras = EXTRA_PARTS.filter((part) => part.shown(view)).map((part) =>
    part.say(view),
  );

  const lead =
    resolveKillEffectFields(project).length === 0 ? copy.noFlash : duration;
  return [lead, ...extras, ...markerNote(copy, project.marker)].join(" · ");
}
