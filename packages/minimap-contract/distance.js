/*
 * Слова расстояния (задача 1 ТЗ 17.10.2026, владелец: «добавить возможность
 * редактировать км и м»; набросок — «Вместо км: Hunters, вместо м: hnt»).
 *
 * Цифры считает игра, меняется только слово после них. Слово живёт в
 * таблицах текста игры (`global.gxt2` каждого языка): на экране статистики
 * (`UNIT_KILO`, `UNIT_METERS` — их подставляет сам exe), в гонках и заданиях
 * GTA Online, в испытаниях. Мини-карта и маршрут GPS расстояния не пишут
 * вовсе (проверено по minimap.gfx и текстам игры 17.10.2026), а HUD
 * РП-сервера рисует свой текст — там слово не сменится.
 */

export const MINIMAP_DISTANCE_WORD_LENGTH = 16;
/*
 * Языки игры: у каждого своя таблица текста (`<язык>_rel.rpf/global.gxt2`).
 * Язык Steam хранит у себя, а не у игры, поэтому заплатка ложится во все
 * тринадцать. Список — и в сборке заплаток, и в проверке цели файлов пакета
 * мини-карты (`minimap-gfx-compiler.js`).
 */
export const MINIMAP_DISTANCE_LANGUAGES = Object.freeze([
  "american",
  "chinese",
  "chinesesimp",
  "french",
  "german",
  "italian",
  "japanese",
  "korean",
  "mexican",
  "polish",
  "portuguese",
  "russian",
  "spanish",
]);

export const DEFAULT_MINIMAP_DISTANCE = Object.freeze({ enabled: false, km: "", m: "" });

/*
 * Слово: печатные знаки одной строкой. Тильда — разметка текста игры
 * (`~1~`, `~r~`), «µ» игра рисует неразрывным пробелом, угловые скобки — теги:
 * их в слово не пускаем.
 */
export function cleanDistanceWord(value, { trim = true } = {}) {
  const text = String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f~<>µ]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^ /, "");
  return (trim ? text.trim() : text).slice(0, MINIMAP_DISTANCE_WORD_LENGTH);
}

/* В проекте слово хранится как набрано (пробел в конце — человек печатает
   второе слово); в игру оно уходит без краевых пробелов. */
export function normalizeMinimapDistance(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    enabled: source.enabled === true,
    km: cleanDistanceWord(source.km, { trim: false }),
    m: cleanDistanceWord(source.m, { trim: false }),
  };
}

/** Меняет ли проект слова расстояния в игре. */
export function minimapDistanceActive(distance) {
  const value = normalizeMinimapDistance(distance);
  return value.enabled && Boolean(cleanDistanceWord(value.km) || cleanDistanceWord(value.m));
}

/*
 * Где игра пишет единицу расстояния — ярлыки `global.gxt2` (имена сняты со
 * строк GTA5.exe и скриптов игры). `whole` — строка целиком единица
 * («kilometers», « metri»); иначе единица — хвост после числа `~1~`
 * («~1~ km», «~1~.~1~ km», «~1~µm»). Ярлык, где у языка стоит не единица
 * (у FMMC_SEL_MET по-русски — «мин.»), в список не берётся.
 */
export const MINIMAP_DISTANCE_LABELS = Object.freeze({
  km: Object.freeze([
    Object.freeze({ label: "UNIT_KILO", whole: true }),
    Object.freeze({ label: "FM_ISC_DIST2KM", whole: false }),
    Object.freeze({ label: "FO_TWO_KM", whole: false }),
  ]),
  m: Object.freeze([
    Object.freeze({ label: "UNIT_METERS", whole: true }),
    Object.freeze({ label: "HUD_METNUM", whole: false }),
    Object.freeze({ label: "AMCH_M", whole: false }),
    Object.freeze({ label: "AMCH_M_LB", whole: true }),
    Object.freeze({ label: "AMCH_METRES", whole: true }),
    Object.freeze({ label: "AIRSTRIKE_6", whole: false }),
  ]),
});

/**
 * Строка игры со своим словом единицы или `null`, если строка устроена не
 * так, как ждёт ярлык (своя у языка или уже не единица). Пробел перед
 * единицей — тот же, что был («µ» — неразрывный); если его не было, а
 * слово — не одна буква, ставится обычный: «850hnt» не прочесть.
 */
export function replaceDistanceUnit(text, word, { whole = false } = {}) {
  const source = String(text ?? "");
  const value = cleanDistanceWord(word);
  if (!value) return null;
  if (whole) {
    const match = /^(\s?)([^\s~]+)$/u.exec(source);
    return match ? `${match[1]}${value}` : null;
  }
  const match = /^(.*~1~)([ µ]?)([^\s~µ0-9]+)$/u.exec(source);
  if (!match) return null;
  const gap = match[2] || ([...value].length > 1 ? " " : "");
  return `${match[1]}${gap}${value}`;
}

/** Пример строки для окна: «1.25 Hunters · 850 hnt» (свои слова или км/м языка). */
export function distanceSample(distance, { km = "km", m = "m", decimal = "." } = {}) {
  const value = normalizeMinimapDistance(distance);
  return `1${decimal}25 ${cleanDistanceWord(value.km) || km} · 850 ${cleanDistanceWord(value.m) || m}`;
}
