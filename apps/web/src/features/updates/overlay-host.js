// Слой для карточек без затемнения (угол окна): слой оверлея оболочки, а пока оболочки нет
// (заставка, вход) - её корень. Цвета и «стекло» определены внутри .desktop-app, поэтому
// узлы вне него хук не берёт, кроме самого слоя. В отличие от Dialog, в конце body не берёт.
import { useLayoutEffect, useState } from "react";

export function useOverlayHost() {
  const holder = useState(null);
  const setNode = holder[1];

  useLayoutEffect(() => {
    const Watcher = globalThis.MutationObserver;
    const shell = document.querySelector(SHELL);
    const refresh = () => setNode(locate());
    refresh();
    // Слой появляется позже первой отрисовки прямым ребёнком корня: достаточно следить за ними.
    // Нет корня при монтировании - наблюдения нет вовсе, позже появившееся не замечаем
    const spy = shell && Watcher ? new Watcher(refresh) : null;
    spy?.observe(shell, { ...{ childList: true } });
    return spy ? () => spy.disconnect() : undefined;
  }, [setNode]);

  return holder[0];
}

const SHELL = ".desktop-app";

function locate() {
  return document.querySelector("[data-desktop-overlay-host]") ?? document.querySelector(SHELL);
}
