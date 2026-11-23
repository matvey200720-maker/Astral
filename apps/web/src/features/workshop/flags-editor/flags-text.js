/*
 * Слова редактора «Флаги» — отдельно от компонентов: их берут кадр, колонка
 * правок, шаблоны и обложка.
 */

import {
  FLAG_KIND_IDS,
  FLAG_KINDS,
  FLAG_TOTAL,
  flagCountry,
  flagIsOwn,
  flagKind,
  flagLookIsStock,
  flagLookOf,
} from "@modovik/climb-contract/recolor/flags";
import { tr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { FLAG_WORDS, KIND_WORDS, countedIn } from "../counted-words.js";

/* Цель правки — все флаги карты или вид флага игры. */
export const ALL_FLAGS = "all";
export const FLAG_TARGETS = Object.freeze([ALL_FLAGS, ...FLAG_KIND_IDS]);


export const FLAG_SWATCHES = Object.freeze(["#ffffff", "#f4f2ec", "#121317", "#6b7078", "#0039a6", "#d52b1e", "#ffd700", "#27ae60"]);

/** «3 флага», «2 вида» — на языке окна, по его правилу числа (`counted-words.js`). */
export const flagsText = (count) => countedIn(count, FLAG_WORDS);
export const kindsText = (count) => countedIn(count, KIND_WORDS);
/* «100 %» — с неразрывным пробелом: число и знак не расходятся по строкам (`design-qa.md`, п. 18). */
export const percentText = (value) => `${Math.round(value)}\u00a0%`;
/* Сдвиг картинки: «по центру», «−40 % влево». */
export const offsetText = (value, [less, more]) => (value === 0 ? tr("по центру") : `${Math.abs(value)}\u00a0% ${value < 0 ? less : more}`);

/** Подпись цели: «Все флаги» или вид («США»). */
export const targetLabel = (target) => (target === ALL_FLAGS ? tr("Все флаги") : flagKind(target)?.label || tr("Флаг"));

/** Что сейчас на флаге — коротко: «Россия», «своя картинка», «как в игре, тусклее». */
export function lookText(look) {
  if (look.mode === "country") return flagCountry(look.country)?.label || tr("флаг страны");
  if (look.mode === "image" && look.image.asset) return tr("своя картинка");
  if (flagLookIsStock(look)) return tr("как в игре");
  const parts = [];
  if (look.brightness !== 100) parts.push(look.brightness < 100 ? tr("тусклее") : tr("ярче"));
  if (look.saturation !== 100) parts.push(look.saturation < 100 ? tr("бледнее") : tr("сочнее"));
  return trFill("как в игре, {0}", parts.join(", "));
}

/** Состояние вида: «свой: Россия» или «как у всех: как в игре». */
export function kindStateText(project, id) {
  const look = flagLookOf(project, id);
  /* «как у всех: как в игре» читалось ошибкой: своё — что именно, не своё — «как в игре» или «как у всех». */
  if (flagIsOwn(project, id)) return lookText(look);
  return flagLookIsStock(look) ? tr("как в игре") : tr("как у всех");
}

/** Модели вида по-человечески: «большой, малый, флаг яхты, флагшток». */
export function kindModelsText(kind) {
  const names = kind.files.map((file) => {
    if (/_s\.yft$/.test(file.file)) return tr("малый");
    if (/usboat/.test(file.file)) return tr("флаг яхты");
    if (/flagpole/.test(file.file)) return tr("флагшток с полотнищем");
    if (file.file === "prop_flag_s.yft") return tr("малый без вида");
    return tr("большой");
  });
  return [...new Set(names)].join(", ");
}

/** Пункты меню «Какой флаг в кадре»: все флаги и виды с числом на карте. */
export function targetMenuOptions(project) {
  return [
    { value: ALL_FLAGS, label: tr("Все флаги"), description: trFill("{0} на карте · {1}", flagsText(FLAG_TOTAL), lookText(project.all)) },
    { separator: true },
    { heading: tr("Флаги игры") },
    ...FLAG_KINDS.map((kind) => ({
      value: kind.id,
      label: kind.label,
      description: trFill("на карте: {0} · {1}", kind.count, kindStateText(project, kind.id)),
    })),
  ];
}

/** Соседняя цель стрелками над кадром (по кругу). */
export function siblingTarget(target, step) {
  const at = Math.max(0, FLAG_TARGETS.indexOf(target));
  return FLAG_TARGETS[(at + step + FLAG_TARGETS.length) % FLAG_TARGETS.length];
}

/* Вид, что показывает кадр у «Всех флагов»: флаги США — их на карте больше всех. */
export const frameKindOf = (target) => flagKind(target) || FLAG_KINDS[0];
