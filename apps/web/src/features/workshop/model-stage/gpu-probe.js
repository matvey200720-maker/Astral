/*
 * Название видеочипа — в потоке, не на главном (опыт `gpu-probe`, 18.11.2026; `quality-profile.js: warmGpuLevel`).
 *
 * `detectGpuLevel` ради имени карты создаёт одноразовый контекст WebGL на главном потоке: в четырёх профилях V8 первого входа (отчёт 19, раздел 17) этот `getContext` стоит 429–438 мс
 * собственного времени, а следующий, контекст общего холста окна (`window-renderer.js`), — 6 мс. Цена — первый контекст окна (ожидание процесса видеокарты), а не второй контекст как таковой.
 * С опытом уровень берётся из запомненного с прошлого запуска, а имя проверяет этот поток: `OffscreenCanvas` в `gpu-probe-worker.js` создаёт свой контекст и отвечает названием.
 * Поток стартует при первом показе кадра (`ModelStage.jsx` → `warmGpuLevel`), то есть раньше, чем `claimWindowRenderer` создаст настоящий контекст на главном потоке: пока видеокарта просыпается,
 * главный поток занят отрисовкой React, а не ждёт. Сколько главный поток всё же простоит у настоящего контекста — решает замер в окне, а не код.
 *
 * Потока или `OffscreenCanvas` нет, поток упал или не ответил за `GPU_PROBE_TIMEOUT_MS` — ничего не меняется: остаётся запомненный уровень. Ответ — название, как оно приходит с главного потока
 * (`WEBGL_debug_renderer_info`), уровень по нему считает `gpuLevelOf` тем же правилом, что и синхронный путь.
 */

export const GPU_PROBE_TIMEOUT_MS = 10_000;

/**
 * Запускает поток и вызывает `onName(название)`, когда он ответил; `false` — потока нет (ничего не запущено). `makeThread` подставляет тест.
 */
export function startGpuNameProbe(onName, makeThread = null) {
  if (!makeThread && typeof Worker !== "function") return false;
  let thread;
  try {
    thread = makeThread ? makeThread() : new Worker(new URL("./gpu-probe-worker.js", import.meta.url), { type: "module" });
  } catch {
    return false;
  }
  let timer = 0;
  const finish = () => {
    clearTimeout(timer);
    try {
      thread.terminate?.();
    } catch {
      /* поток уже закрыт */
    }
  };
  thread.onmessage = ({ data }) => {
    finish();
    if (typeof data?.name === "string") onName(data.name);
  };
  thread.onerror = finish;
  timer = setTimeout(finish, GPU_PROBE_TIMEOUT_MS);
  try {
    thread.postMessage({ probe: true });
  } catch {
    finish();
    return false;
  }
  return true;
}
