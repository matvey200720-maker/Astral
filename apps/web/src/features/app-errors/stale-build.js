/*
 * Окно пережило свою сборку (11.10.2026, задача 5).
 *
 * Собранное окно подгружает тяжёлые страницы и редакторы кусками по имени с
 * отпечатком (`ArenaStudio-<хеш>.js`). Пересобрали интерфейс, пока окно
 * открыто, — старых кусков на диске уже нет, и «Арена», «Завод», «Интерьеры»
 * открывались «Эта страница не открылась». Повторить отрисовку бесполезно:
 * `React.lazy` помнит отказ и бросает его снова. Помогает только
 * перезагрузка окна — оно возьмёт новый `index.html` и новые куски. Работы и
 * черновики живут в хранилищах окна, перезагрузка их не трогает.
 *
 * Перезагрузка — не чаще раза в полминуты: если кусок пропал по другой
 * причине, окно не уйдёт в бесконечный круг, а покажет обычную заглушку.
 */

const RELOAD_KEY = "astral.stale-build.reload.v1";
export const STALE_BUILD_RELOAD_GAP_MS = 30_000;

const CHUNK_FAILURE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading (?:CSS )?chunk \S+ failed/i;

/** Отказ подгрузки куска сборки, а не ошибка в коде страницы. */
export function isStaleBuildError(error) {
  if (!error) return false;
  const text = `${error.name || ""}: ${error.message ?? error}`;
  return CHUNK_FAILURE.test(text);
}

/** Перезагружает окно, если недавно этого уже не делали; true — ушло. */
export function reloadForFreshBuild(target = window) {
  const now = Date.now();
  let last = 0;
  try {
    last = Number(target.sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    /* Хранилище бывает закрыто — тогда без защиты от круга не перезагружаем. */
    return false;
  }
  if (now - last < STALE_BUILD_RELOAD_GAP_MS) return false;
  try {
    target.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  target.location.reload();
  return true;
}

/**
 * Vite сообщает об отказе подгрузки событием `vite:preloadError` ещё до того,
 * как отказ дойдёт до страницы. Ставится один раз; возвращает снятие.
 */
export function installStaleBuildRecovery(target = window) {
  const onPreloadError = (event) => {
    if (isStaleBuildError(event?.payload)) reloadForFreshBuild(target);
  };
  target.addEventListener("vite:preloadError", onPreloadError);
  return () => target.removeEventListener("vite:preloadError", onPreloadError);
}
