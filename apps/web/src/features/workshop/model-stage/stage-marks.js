/*
 * Метки загрузки сцены для замера (15.11.2026, шаг 2 плана входа): `window.__astralStageMarks` — массив `[performance.now(), имя, …подробности]`. Нет массива — вызов ничего не стоит
 * (одно чтение свойства). Массив заводит стенд до загрузки страницы, а без стенда — опыт `marks` (`stage-exp.js`). Метки ничего не меняют в кадре.
 *
 * Имена: `setScene>` / `setScene<` (сцена построена), `look>` / `look<` (облик; подробность — число материалов, `diff` или `all`), `ahead` (сколько листов просили заранее),
 * `flush` (пачка листов отдана облику), `finish` (итог листов), `warm` / `warmDone` (заказ и конец прогрева программ), `draw>` / `draw<` (отрисовка: `first` — первая сцены, `final` — после итога,
 * `stream` — под заставкой по мере прихода листов, `other`; в конце — какие программы кадр создал сам), `covered`, `up` (заливка листа порцией).
 */
export const stageMarksOn = () => Array.isArray(globalThis.__astralStageMarks);

export function stageMark(name, ...detail) {
  const log = globalThis.__astralStageMarks;
  if (Array.isArray(log)) log.push([performance.now(), name, ...detail]);
}

/** Завести журнал, если стенд его не завёл (опыт `marks`). */
export function enableStageMarks() {
  if (!stageMarksOn()) globalThis.__astralStageMarks = [];
}

/** Короткое имя программы three: начало её ключа (вид шейдера) — по нему видно, что кадр собрал сам. */
export const programLabel = (program) => String(program?.cacheKey || program?.name || "?").slice(0, 80);
