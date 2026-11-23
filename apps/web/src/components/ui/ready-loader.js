/*
 * Загрузчик куска для `React.lazy`, который отдаёт уже загруженный модуль
 * готовым (скорость 12.10).
 *
 * `React.lazy(() => import(...))` получает новое обещание при первом показе,
 * даже если кусок давно в памяти (его подтянуло наведение на плитку или
 * прошлый заход): React сначала рисует запасной каркас, а содержимое после
 * каркаса придерживает ещё ~300 мс. Здесь загрузка одна на кусок, и как только
 * модуль на месте, `React.lazy` получает объект с синхронным `then` —
 * компонент встаёт в той же отрисовке, без каркаса (тот же приём, что у
 * страниц, `lazy-page.jsx`).
 *
 * Возвращает функцию загрузки: её же можно звать заранее (`load()`), у ответа
 * есть `then` и `catch`.
 */
export function readyLoader(load) {
  let module = null;
  let pending = null;
  return () => {
    if (module)
      return {
        then: (resolve) => Promise.resolve(resolve ? resolve(module) : module),
        catch: () => Promise.resolve(module),
      };
    pending ??= load().then(
      (loaded) => {
        module = loaded;
        return loaded;
      },
      (error) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };
}
