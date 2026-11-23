/*
 * Слова ступени «пересобираем пакет поверх работы» (22.11.2026). Главный процесс присылает в снимке операции `dependent`: `set` — что пересобирается
 * (vegetation / textures / roads / arenas), `base` — после чего (roads, removal, textures и другие работы), `stage` — build (файлы пакета, доля честная)
 * или write (запись в архив игры, чисел нет). Растительность поверх дорог на сильном ПК — 14 минут из 23: человек должен знать, что идёт, и не закрывать окно.
 *
 * Возвращает русские ключи словаря — переводит тот, кто рисует (`trIn`). Модуль лежит рядом с ленивой строкой очереди, в главный кусок окна не входит.
 */

const LABELS = Object.freeze({
  vegetation: Object.freeze({
    roads: "Пересобираем растительность поверх дорог",
    removal: "Пересобираем растительность без снятых работ",
    other: "Пересобираем растительность поверх новой работы",
  }),
  textures: Object.freeze({
    removal: "Пересобираем ступень текстур без снятых работ",
    other: "Пересобираем ступень текстур поверх новой работы",
  }),
  roads: Object.freeze({
    removal: "Пересобираем дороги без снятых работ",
    other: "Пересобираем дороги поверх новой работы",
  }),
  arenas: Object.freeze({
    other: "Пересобираем арену поверх мода",
  }),
});

/** Честное ожидание: что это долго и что делать человеку. */
export const DEPENDENT_WAIT = "Это может занять 20 минут и больше. Не закрывайте Astral";

const STAGE_LINES = Object.freeze({
  build: "Сначала собираем файлы пакета",
  write: "Записываем пакет в архив игры",
});

/** Подпись ступени — русский ключ словаря; незнакомый набор называется общими словами. */
export function dependentLabel(dependent) {
  const own = LABELS[dependent?.set];
  if (!own) return "Пересобираем пакеты поверх новой работы";
  return own[dependent.base === "removal" ? "removal" : dependent.base === "roads" ? "roads" : "other"] || own.other || own.removal;
}

/** Что идёт внутри ступени — русский ключ словаря. */
export const dependentStageLine = (dependent) => STAGE_LINES[dependent?.stage === "write" ? "write" : "build"];

/* Ступень приходит из главного процесса как есть (`dependent` в снимке операции): всё, что с ней делает окно, — здесь, а не в очереди (запас главного куска окна). */

/** Доля ступени, если она честная (только сборка файлов пакета), иначе `null` — бегущая полоса. */
export const dependentFraction = (dependent) =>
  dependent?.stage !== "write" && Number.isFinite(dependent?.fraction) ? Math.min(1, Math.max(0, dependent.fraction)) : null;
