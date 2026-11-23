/*
 * Как кадр редактора отдаёт снимок работы (31.10.2026).
 *
 * Снимок снимается с той же позиции и в тот же момент, что у стандартного предпросмотра (`works/cover-shots.js`), а не там, куда человек
 * увёл камеру и где сейчас кончилась очередь: килл-эффект между вспышками — это пустой тёмный кадр. Позу знает только сам кадр, поэтому он
 * записывается сюда, пока открыт:
 *
 *   shoot(kind) — снять самому, не показывая ничего человеку: поставить вид, нарисовать, забрать холст и вернуть вид за одну задачу
 *                 браузера (`ImageBitmap` или `null`). Окно не мигает, органы кадра на снимок не попадают, главный процесс не нужен.
 *   pose(kind)  — кадр из нескольких слоёв снимает окно целиком: встать в позу и отдать, как вернуться (`() => void`).
 *
 * Модуль без импортов: его читают и лёгкие `work-covers.js`, и кадры редакторов.
 */

const entries = [];

/** Записать кадр; ответ — снять запись. Открытый последним главнее: живое окно рядом с редактором не перехватывает снимок. */
export function registerFrameShot(entry) {
  entries.push(entry);
  return () => {
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
  };
}

export const frameShotEntry = () => entries[entries.length - 1] || null;

/** Холст → картинка в этой же задаче браузера: буфер WebGL ещё цел. Нет `createImageBitmap` (тесты) — снимка нет. */
export function grabCanvas(canvas) {
  if (!canvas || typeof createImageBitmap !== "function") return null;
  try {
    return createImageBitmap(canvas).catch(() => null);
  } catch {
    return null;
  }
}
