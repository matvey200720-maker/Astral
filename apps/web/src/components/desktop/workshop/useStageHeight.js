import { useState, useRef, useEffect } from "react";
import { tr } from "../../../locales/ui.js";

// Ключ остался от таймциклов, но окно предпросмотра общее у всех студий.
const STORE_KEY = "astral.timecycle.stage-height";
export const MIN_STAGE_VH = 26;
export const MAX_STAGE_VH = 84;
// Стрелка вниз растягивает кадр, вверх сжимает; Home возвращает исходную пропорцию.
const KEY_STEPS = new Map([
  ["ArrowDown", 3],
  ["ArrowUp", -3],
  ["Home", null],
]);

const clampVh = (value) => Math.max(MIN_STAGE_VH, Math.min(MAX_STAGE_VH, value));

// Указатель мог успеть отпуститься, хранилище может быть закрыто (нет window, приватный режим):
// редактор продолжает работать.
const quietly = (action) => {
  try {
    return action();
  } catch {
    /* ошибку проглатываем */
  }
};

const readStored = () => {
  const parsed = quietly(() => parseFloat(window.localStorage.getItem(STORE_KEY)));
  if (!Number.isFinite(parsed)) return null;
  return clampVh(parsed);
};

// Доля кадра в высоте окна, % (измеряется заново при каждом нажатии).
const shareOf = (frame, span) => 100 * (frame.getBoundingClientRect().height / span);

// Обработчики ручки создаются один раз (ссылки неизменны), перетаскивание живёт в замыкании.
function makeHandlers(frameRef, setHeightVh) {
  let drag = null; // [pointerId, clientY, высота окна, доля кадра] на момент нажатия
  const onPointerEnd = (e) => {
    if (!drag || drag[0] !== e.pointerId) return;
    drag = null;
    quietly(() => e.currentTarget.releasePointerCapture(e.pointerId));
  };
  return {
    onPointerDown(e) {
      const frame = frameRef.current;
      if (frame && e.button === 0) {
        e.preventDefault();
        const span = window.innerHeight || 1;
        drag = [e.pointerId, e.clientY, span, shareOf(frame, span)];
        quietly(() => e.currentTarget.setPointerCapture(e.pointerId));
      }
    },
    onPointerMove(e) {
      if (!drag || drag[0] !== e.pointerId) return;
      const [, startY, span, base] = drag;
      setHeightVh(clampVh(base + 100 * ((e.clientY - startY) / span)));
    },
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onDoubleClick: () => setHeightVh(null),
    onKeyDown(e) {
      const frame = frameRef.current;
      const step = KEY_STEPS.get(e.key);
      if (frame && step !== undefined) {
        e.preventDefault();
        setHeightVh(step === null ? null : clampVh(shareOf(frame, window.innerHeight || 1) + step));
      }
    },
  };
}

export default function useStageHeight() {
  const [heightVh, setHeightVh] = useState(readStored);
  const frameRef = useRef(null);
  const [handlers] = useState(() => makeHandlers(frameRef, setHeightVh));

  // Нет высоты (Home, двойной щелчок) — стираем и запомненное значение (delta 07.11.2026).
  useEffect(() => {
    quietly(() => {
      const store = window.localStorage;
      return heightVh === null ? store.removeItem(STORE_KEY) : store.setItem(STORE_KEY, String(heightVh));
    });
  }, [heightVh]);

  const style = heightVh === null ? undefined : { "--sky-stage-height": `${heightVh}vh` };
  const handleProps = {
    ...handlers,
    role: "separator",
    tabIndex: 0,
    "aria-label": tr("Высота предпросмотра"),
    "aria-orientation": "horizontal",
    "aria-valuemin": MIN_STAGE_VH,
    "aria-valuemax": MAX_STAGE_VH,
    "aria-valuenow": Math.round(heightVh) || undefined,
    title: tr("Потяните, чтобы изменить высоту. Двойной щелчок — вернуть как было"),
  };
  return { frameRef, heightVh, style, handleProps };
}
