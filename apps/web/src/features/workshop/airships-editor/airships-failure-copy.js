/*
 * Отказы установки «Дирижаблей» на шести языках окна (ru, uk, en, de, pl, fr).
 *
 * Сообщение собиралось из русского родительного падежа («Картинка ${whose} пропала…», whose = «лого дракона»,
 * «текстуры кита»): на других языках окно показывало русское предложение целиком. Это функция словаря по языку (как
 * `features/reshade/reshade-copy.js`): русский текст прежний слово в слово, у остальных языков предложение целиком, а чья
 * картинка — в начале: название вида из словаря и «лого» или «текстура» («Небесный кит · logo: …»), чтобы не склонять
 * названия видов на пяти языках.
 *
 * Причины: `font` — файл своего шрифта надписи пропал, `text` — надпись не нарисовалась, `picture` — картинка пропала из хранилища окна.
 */

import { airshipKind } from "@modovik/climb-contract/recolor/airships";
import { currentUiLanguage, ownUiText, tr } from "../../../locales/ui.js";

/* Неразрывный пробел: во французском стоит перед «:» и внутри кавычек. */
const NBSP = String.fromCharCode(0xa0);

/** Чья картинка или надпись: дирижабль, лого вида или своя текстура вида. */
export const BLIMP_SUBJECT = Object.freeze({ thing: "blimp", kind: "blimp" });
export const logoSubject = (kind) => Object.freeze({ thing: "logo", kind });
export const textureSubject = (kind) => Object.freeze({ thing: "texture", kind });

/* ---- русский: прежний текст ---- */

const GENITIVE = Object.freeze({
  dragon: "дракона",
  phoenix: "феникса",
  balloon: "воздушного шара",
  lantern: "фонарика",
  ufo: "НЛО",
  whale: "кита",
  jellyfish: "медузы",
  banner: "самолёта с баннером",
  eastern_dragon: "восточного дракона",
  griffin: "грифона",
});
const RU_THING = Object.freeze({ logo: "лого", texture: "текстуры" });

function ruWhose({ thing, kind }) {
  if (thing === "blimp") return "дирижабля";
  return `${RU_THING[thing]} ${GENITIVE[kind] || airshipKind(kind)?.label || kind}`;
}

const RU = Object.freeze({
  font: (subject) => `Файл своего шрифта надписи ${ruWhose(subject)} пропал из хранилища окна — загрузите его ещё раз.`,
  text: (subject) => `Надпись ${ruWhose(subject)} не нарисовалась — откройте «Дирижабли» и нажмите «Применить» ещё раз.`,
  picture: (subject) => `Картинка ${ruWhose(subject)} пропала из хранилища окна — загрузите её ещё раз.`,
});

/* ---- остальные языки: «Название · лого: предложение» ---- */

const QUOTE_MARKS = Object.freeze({
  uk: ["«", "»"],
  en: ["“", "”"],
  de: ["„", "“"],
  pl: ["„", "”"],
  fr: [`«${NBSP}`, `${NBSP}»`],
});

/* Что стоит перед двоеточием: во французском — неразрывный пробел. */
const COLON = Object.freeze({ uk: ":", en: ":", de: ":", pl: ":", fr: `${NBSP}:` });

const THINGS = Object.freeze({
  uk: { logo: "лого", texture: "текстура" },
  en: { logo: "logo", texture: "texture" },
  de: { logo: "Logo", texture: "Textur" },
  pl: { logo: "logo", texture: "tekstura" },
  fr: { logo: "logo", texture: "texture" },
});

/* Предложения без названия. `button` — название кнопки словаря в кавычках языка. */
const BODY = Object.freeze({
  uk: {
    font: () => "файл власного шрифту напису зник зі сховища вікна — завантажте його ще раз.",
    text: (button) => `напис не намалювався — відкрийте ${button("Дирижабли")} та натисніть ${button("Применить")} ще раз.`,
    picture: () => "картинка зникла зі сховища вікна — завантажте її ще раз.",
  },
  en: {
    font: () => "the custom font file of the text has disappeared from the window's storage — upload it again.",
    text: (button) => `the text was not drawn — open ${button("Дирижабли")} and press ${button("Применить")} again.`,
    picture: () => "the picture has disappeared from the window's storage — upload it again.",
  },
  de: {
    font: () => "Die Datei der eigenen Schrift des Textes ist aus dem Speicher des Fensters verschwunden — laden Sie sie erneut hoch.",
    text: (button) => `Der Text wurde nicht gezeichnet — öffnen Sie ${button("Дирижабли")} und klicken Sie erneut auf ${button("Применить")}.`,
    picture: () => "Das Bild ist aus dem Speicher des Fensters verschwunden — laden Sie es erneut hoch.",
  },
  pl: {
    font: () => "plik własnej czcionki napisu zniknął z pamięci okna — wczytaj go ponownie.",
    text: (button) => `napis nie został narysowany — otwórz ${button("Дирижабли")} i kliknij ${button("Применить")} ponownie.`,
    picture: () => "obraz zniknął z pamięci okna — wczytaj go ponownie.",
  },
  fr: {
    font: () => "le fichier de la police personnalisée du texte a disparu du stockage de la fenêtre — importez-le de nouveau.",
    text: (button) => `le texte n'a pas été dessiné — ouvrez ${button("Дирижабли")} et cliquez de nouveau sur ${button("Применить")}.`,
    picture: () => "l'image a disparu du stockage de la fenêtre — importez-la de nouveau.",
  },
});

function whoseName(language, { thing, kind }) {
  const label = tr(airshipKind(kind)?.label || kind);
  return thing === "blimp" ? label : `${label} · ${THINGS[language][thing]}`;
}

/**
 * Сообщение отказа установки на языке окна. `reason` — `font`, `text` или `picture`; `subject` — чья надпись или картинка
 * (по умолчанию дирижабля).
 */
export function airshipFailure(reason, subject = BLIMP_SUBJECT) {
  const language = currentUiLanguage();
  if (!Object.hasOwn(BODY, language)) return ownUiText(RU[reason](subject));
  const [open, close] = QUOTE_MARKS[language];
  const button = (word) => `${open}${tr(word)}${close}`;
  return ownUiText(`${whoseName(language, subject)}${COLON[language]} ${BODY[language][reason](button)}`);
}
