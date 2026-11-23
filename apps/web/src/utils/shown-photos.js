/*
 * Какие картинки в этом окне уже показывали (31.10.2026, «чтобы быстро грузились фотки»).
 *
 * Картинка, которую окно уже загрузило, лежит в кэше браузера (а за ним — на диске API): холодного запроса за ней не будет. Это нужно сетке на рывке (`virtual-fling.js`):
 * карточкам с такими картинками незачем ждать конца рывка.
 *
 * Адреса берутся из записей Resource Timing (`PerformanceObserver`), а не от карточек — так не важно, какая карточка и чем (фоном, `<img>`, замером) их показывала. Записи
 * ненадёжны сами по себе: буфер страницы на 250 записей переполняется скриптами и стилями раньше, чем откроется каталог, а картинка из памяти новой записи не даёт. Поэтому
 * наблюдатель включается с первой карточки с облачной обложкой (`cover-thumb.js`), а не с каталога: запись приходит ему в момент загрузки, даже когда в буфер уже не помещается.
 */

/* Потолок — каталог в несколько тысяч обложек; сверх него забываются самые старые (в кэше браузера их могло уже не быть — карточка подождёт, как холодная). */
const SHOWN_LIMIT = 6000;
const shown = new Set();
let watching = false;

const absolute = (url) => {
  try {
    return new URL(url, globalThis.location?.href).href;
  } catch {
    return "";
  }
};

/** Запомнить адрес как показанный (в тестах — вместо записи о загрузке). */
export function rememberShownPhoto(url) {
  const name = absolute(url);
  if (!name) return;
  shown.delete(name);
  shown.add(name);
  if (shown.size > SHOWN_LIMIT) shown.delete(shown.values().next().value);
}

/** Была ли картинка `url` (относительный или полный адрес) показана в этом окне. */
export function isPhotoShown(url) {
  if (!url || !shown.size) return false;
  const name = absolute(url);
  return Boolean(name) && shown.has(name);
}

/** Следить за загрузкой картинок окна (уже загруженные тоже, `buffered`). Один раз на окно; без `PerformanceObserver` — ничего. */
export function watchShownPhotos() {
  if (watching || typeof PerformanceObserver !== "function") return;
  watching = true;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.initiatorType !== "img" && entry.initiatorType !== "css") continue;
        if (entry.responseStatus >= 400) continue;
        rememberShownPhoto(entry.name);
      }
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {
    watching = false;
  }
}
