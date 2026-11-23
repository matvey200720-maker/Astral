import { useEffect, useRef } from "react";

/*
 * Боковые кнопки мыши (владелец, 02.11.2026: «назад» давало чёрный экран).
 * Браузерной истории у приложения нет: страницы — состояние оболочки, а сама
 * история вела на заставку окна. Поэтому «назад» и «вперёд» ходят по страницам,
 * где человек был, а действие браузера отменяется.
 */
const BACK_BUTTON = 3;
const FORWARD_BUTTON = 4;
const PLACES_KEPT = 50;

const samePlace = (a, b) =>
  a.page === b.page && a.group === b.group && (a.detailMod?.id || "") === (b.detailMod?.id || "");

/** Путь по страницам: новое место после шага назад обрывает путь вперёд, как в браузере. */
export function createPlaceHistory() {
  let places = [];
  let at = -1;
  return {
    note(place) {
      if (at >= 0 && samePlace(places[at], place)) {
        places[at] = place;
        return;
      }
      places = [...places.slice(0, at + 1), place].slice(-PLACES_KEPT);
      at = places.length - 1;
    },
    step(delta) {
      const next = at + delta;
      if (next < 0 || next >= places.length) return null;
      at = next;
      return places[at];
    },
  };
}

/**
 * Что делает кнопка: сначала закрывается открытое поверх страницы, окно с вопросом
 * ждёт ответа, редактор уходит своей кнопкой «назад» (она знает про черновик),
 * и только потом — шаг по пути.
 */
export function mouseNavigationStep(delta, { closeOverlay, modalOpen, leaveEditor, history, go }) {
  if (delta < 0 && closeOverlay()) return;
  if (modalOpen()) return;
  if (delta < 0 && leaveEditor()) return;
  const place = history.step(delta);
  if (place) go(place);
}

const modalOnScreen = () => Boolean(document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]'));

/* Спрятанная страница держит свой редактор в документе (`KeptPage`): нужен тот, что на экране. */
function clickEditorBack() {
  const back = [...document.querySelectorAll("[data-editor-back]")].find((button) => button.offsetParent !== null);
  if (!back || back.disabled) return false;
  back.click();
  return true;
}

export function useMouseNavigation({ place, closeOverlay, go }) {
  const historyRef = useRef(null);
  historyRef.current ??= createPlaceHistory();
  const latest = useRef(null);
  latest.current = { closeOverlay, go };

  useEffect(() => {
    historyRef.current.note(place);
    // Место — три поля, сам объект собирается на каждую отрисовку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.page, place.group, place.detailMod?.id]);

  useEffect(() => {
    const onButton = (event) => {
      if (event.button !== BACK_BUTTON && event.button !== FORWARD_BUTTON) return;
      /* На отпускании Chromium сам уходит по истории окна: этого действия быть не должно. */
      event.preventDefault();
      event.stopPropagation();
      if (event.type !== "mouseup") return;
      mouseNavigationStep(event.button === BACK_BUTTON ? -1 : 1, {
        closeOverlay: () => latest.current.closeOverlay(),
        modalOpen: modalOnScreen,
        leaveEditor: clickEditorBack,
        history: historyRef.current,
        go: (next) => latest.current.go(next),
      });
    };
    window.addEventListener("mousedown", onButton, true);
    window.addEventListener("mouseup", onButton, true);
    return () => {
      window.removeEventListener("mousedown", onButton, true);
      window.removeEventListener("mouseup", onButton, true);
    };
  }, []);
}
