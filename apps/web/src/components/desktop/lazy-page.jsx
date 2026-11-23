import { Suspense, lazy, useEffect } from "react";
import PageLoading from "../ui/PageLoading.jsx";

/*
 * Страница отдельным куском: грузится, только когда её впервые покажут.
 *
 * Так живут разделы, которые владелец может убрать из рейки
 * (`navigation/hidden-pages.js`): скрытый раздел стартовому куску ни к чему,
 * а вернувшийся подгружается при первом открытии. Пока кусок едет, на месте
 * страницы строка «Загружаю…» (`ui/PageLoading.jsx`; прозрачная первые
 * 100 мс, чтобы быстрый кусок не мигал подписью), а не пустой экран.
 *
 * Кусок можно подтянуть заранее (`preload`). Тогда первый показ обходится
 * без заглушки: React.lazy получает от загрузчика уже исполненный thenable,
 * разрешает страницу в том же рендере и не показывает запасной кадр, за
 * которым React ещё и придерживает содержимое на 300 мс.
 */
export function lazyPage(load) {
  let loaded = null;
  let loading = null;
  const preload = () =>
    (loading ??= load().then((module) => {
      loaded = module;
      return module;
    }));
  const Page = lazy(() =>
    loaded ? { then: (resolve) => resolve(loaded) } : preload(),
  );
  function LazyPage(props) {
    return (
      <Suspense fallback={<PageLoading />}>
        <Page {...props} />
      </Suspense>
    );
  }
  LazyPage.preload = preload;
  return LazyPage;
}

/**
 * Страница из точки входа функции (`features/<имя>/index.js`) — тем же
 * отдельным куском: точка входа отдаёт страницу именованной, а не `default`.
 */
export function featurePage(load, name) {
  return lazyPage(() => load().then((module) => ({ default: module[name] })));
}

/**
 * Подтянуть куски страниц, когда окно освободится после старта.
 *
 * Один раз, а не по кругу: в покое окно не просыпается (attention.js), и
 * этот вызов — не исключение, он случается однажды, вскоре после первого
 * кадра. Стартовый кусок от этого не толстеет — страницы по-прежнему едут
 * отдельно, просто раньше, чем по ним щёлкнут. `pages` — постоянный массив
 * модуля, иначе эффект перезапускался бы на каждом рендере.
 *
 * `enabled: false` — не начинать (заставка запуска или пробуждения ещё на экране, 16.11.2026: под ней ничего не подтягивается и не исполняется);
 * когда флаг встаёт, отсчёт `startDelay` идёт с этого мига.
 */
export function usePreloadWhenIdle(
  pages,
  { startDelay = 0, enabled = true } = {},
) {
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer = 0;
    let idle = 0;
    let index = 0;
    const whenIdle = (task) => {
      if (typeof window.requestIdleCallback === "function")
        idle = window.requestIdleCallback(task, { timeout: 5000 });
      else timer = window.setTimeout(task, 2000);
    };
    /* По одному куску, а не все сразу (30.10.2026, старт окна): исполнение модуля — одна неделимая задача, а шесть разделов подряд — это шесть задач по 100–120 мс при ×4 впритык
       друг к другу, и в этот миг окно не отвечает. Следующий кусок — через `PRELOAD_GAP_MS` после того, как прежний доехал и исполнился, и снова в простое. */
    const step = () => {
      if (cancelled || index >= pages.length) return;
      const page = pages[index];
      index += 1;
      Promise.resolve(page.preload?.())
        .catch(() => {})
        .then(() => {
          if (cancelled || index >= pages.length) return;
          timer = window.setTimeout(() => whenIdle(step), PRELOAD_GAP_MS);
        });
    };
    /* `startDelay`: первый кусок не раньше, чем через столько мс после монтирования (холодный старт 31.10.2026: на первом простое Главная ещё собирается, и кусок мастерской
       на ~2 МБ с десятками модулей исполнялся поверх её отрисовки). */
    if (startDelay > 0)
      timer = window.setTimeout(() => whenIdle(step), startDelay);
    else whenIdle(step);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (typeof window.cancelIdleCallback === "function")
        window.cancelIdleCallback(idle);
    };
  }, [pages, startDelay, enabled]);
}

/* Пауза между кусками страниц, что подтягиваются в простое. */
const PRELOAD_GAP_MS = 1500;
