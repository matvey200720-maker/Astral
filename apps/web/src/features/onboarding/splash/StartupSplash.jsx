/*
 * Заставка запуска окна «Контур» и экран пробуждения после сна (15.11.2026): то, что входит в стартовый кусок окна.
 *
 * Слой стоит рядом с оболочкой (`pages/DesktopAppPage.jsx`), а не внутри неё: после запуска он остаётся накладкой поверх
 * следующего экрана на время ухода и только потом снимается, так что ничего не прыгает. Сам слой (`StartupSplashView.jsx`) и
 * холст едут отдельными кусками, чтобы не раздувать запуск; первый кадр — знак и ореол — стоит в `index.html` (`#boot-splash`)
 * и виден раньше любых скриптов. Не доехал слой — окно не ждёт красоты: он снимается, как только запуск закончен.
 */

import { Suspense, lazy, useEffect, useSyncExternalStore } from "react";
import { startupFlow as flow } from "./startup-flow.js";

function Bare() {
  useEffect(() => {
    const timer = window.setInterval(
      () => flow.isReady() && flow.finish(),
      100,
    );
    return () => window.clearInterval(timer);
  }, []);
  return null;
}

const load = () =>
  import("./StartupSplashView.jsx").catch(() => ({ default: Bare }));
const View = lazy(load);
// Грузить начинаем сразу, не дожидаясь первого кадра: пока словарь и память сна читаются, кусок успевает приехать.
if (flow.enabled) void load();

/** Слой заставки: стоит, пока запуск или пробуждение не закончились; в песочнице — только с `?qa-splash` (`startup-flow.js`). */
export default function StartupSplash() {
  const gone = useSyncExternalStore(flow.subscribe, flow.isGone, flow.isGone);
  useEffect(() => {
    if (gone) document.getElementById("boot-splash")?.remove();
  }, [gone]);
  return gone ? null : (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  );
}
