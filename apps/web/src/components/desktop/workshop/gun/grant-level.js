/*
 * Уровни выдачи ссылки на пакет вещи каталога (23.11.2026, «сумки не встают»): очередь под пределом сервера стоит в Desktop (`apps/desktop/src/grant-pacer.js`), окно только называет, насколько
 * вещь нужна прямо сейчас:
 *   — `choice` (ВЫБОР): надетое на других слотах — первым и всегда, ждёт слота; всё, что не называет уровень (установка, пачки, арена, интерьеры, оружие, скины), — тоже ВЫБОР;
 *   — `frame`: вещь в кадре — тот же ВЫБОР, но выбрали другую вещь — ждущая прежняя отменяется (отправитель — окно, `GRANT_CANCELLED`);
 *   — `press` (НАЖАТИЕ): прогрев по нажатию кнопки мыши на плитке — вторым, ждёт слота;
 *   — `background` (ФОН): прогрев по наведению и съёмка плиток без обложки — слота нет прямо сейчас, значит, не делается (`GRANT_SKIPPED`), без ошибки и без записи «не встало».
 */
export const GRANT = Object.freeze({ frame: "frame", choice: "choice", press: "press", background: "background" });

/** Ждущая вещь в кадре отменена (человек выбрал другую): метка `GRANT_CANCELLED` в тексте; окно молчит — кадр этой вещи уже не нужен. */
export const isGrantCancelled = (error) => error?.code === "GRANT_CANCELLED" || /GRANT_CANCELLED/.test(String(error?.message || ""));

/** Фон не получил слот: через мост Electron остаётся только текст, в нём метка `GRANT_SKIPPED`. */
export const isGrantSkipped = (error) => error?.code === "GRANT_SKIPPED" || /GRANT_SKIPPED/.test(String(error?.message || ""));

/** Статус ответа сервера из ошибки: поле `status` или «HTTP 429» в тексте (через мост Electron свойства ошибки теряются, текст остаётся). */
export function grantStatusOf(error) {
  if (Number.isInteger(error?.status)) return error.status;
  const found = /HTTP (\d{3})/.exec(String(error?.message || ""));
  return found ? Number(found[1]) : null;
}

/** Сервер ответил пределом: 429 или слова предела. */
export const isRateLimited = (error) => grantStatusOf(error) === 429 || /rate exceeded/i.test(String(error?.message || ""));
