import { useLayoutEffect } from "react";

/*
 * Редактор «в окно» сам говорит странице, что стоит на ней (13.10.2026).
 *
 * Высоту окна страница и мастерская получают от правил `styles/editor-shell.css`
 * — они читали оболочку через `:has(.ui-editor-shell[data-fit="window"])` на
 * `.desktop-content`. `:has()` с потомком на таком корне заставляет браузер
 * перепроверять правило при любой правке DOM внутри редактора: метка наведения
 * на карте, подсказка, выделение — каждое это пересчёт стилей ~1900 элементов
 * (замер 13.10, тяжёлая карта, 60 движений мыши: 138 мс против 59 мс без
 * правил; на каждый редактор мастерской — небо, звук, килл-эффект, карту).
 *
 * Теперь оболочка ставит два атрибута, а правила читают их:
 *
 *  • `data-editor-host="window"` — на родителе оболочки (то, что раньше
 *    значило `:has(> .ui-editor-shell[data-fit="window"])`: мастерская или
 *    обёртка раздела между страницей и оболочкой);
 *  • `data-editor-page="window"` — на `.desktop-content` вокруг (то, что
 *    значило `.desktop-content:has(.ui-editor-shell[data-fit="window"])`).
 *
 * Ставятся в `useLayoutEffect`, до первого кадра: редактор не мигает прежней
 * раскладкой. Снимаются, когда оболочка уходит или перестаёт быть «в окно».
 * Счётчик на элементе — потому что скелет редактора (`EditorSkeleton`) и сам
 * редактор встают в одно и то же место, и один не должен снять атрибут, на
 * который ещё опирается другой.
 */

export const EDITOR_HOST_ATTRIBUTE = "data-editor-host";
export const EDITOR_PAGE_ATTRIBUTE = "data-editor-page";

const holds = new WeakMap();

function hold(element, name) {
  const counts = holds.get(element) || new Map();
  holds.set(element, counts);
  counts.set(name, (counts.get(name) || 0) + 1);
  element.setAttribute(name, "window");
}

function release(element, name) {
  const counts = holds.get(element);
  const left = (counts?.get(name) || 1) - 1;
  if (left > 0) {
    counts.set(name, left);
    return;
  }
  counts?.delete(name);
  element.removeAttribute(name);
}

/**
 * @param {{ current: HTMLElement | null }} ref оболочка редактора
 * @param {string} fit эффективное «во что помещается» (`window` или `page`)
 */
export default function useEditorFitHost(ref, fit) {
  useLayoutEffect(() => {
    const shell = ref.current;
    if (!shell || fit !== "window") return undefined;
    const host = shell.parentElement;
    const page = shell.closest(".desktop-content");
    if (host) hold(host, EDITOR_HOST_ATTRIBUTE);
    if (page) hold(page, EDITOR_PAGE_ATTRIBUTE);
    return () => {
      if (host) release(host, EDITOR_HOST_ATTRIBUTE);
      if (page) release(page, EDITOR_PAGE_ATTRIBUTE);
    };
  }, [ref, fit]);
}
