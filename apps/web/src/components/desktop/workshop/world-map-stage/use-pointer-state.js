// Состояние указателя: режим перетаскивания лежит в ссылке, в состоянии - только то, что меняет
// разметку (идёт ли перетаскивание, рамка, растяжка, линия зоны, мазок, след, курсор ручек).
import { useReducer, useMemo, useRef } from "react";

const BLANK = {
  dragging: false,
  marquee: null,
  stretch: null,
  aim: null,
  wet: null,
  trail: null,
  cursor: null,
};
const FIELDS = Object.keys(BLANK);

// Правка поверх состояния; те же значения - то же состояние (перерисовки нет)
export const applyPatch = (state, patch) =>
  Object.keys(patch).every((name) => Object.is(state[name], patch[name]))
    ? state
    : { ...state, ...patch };

const setterName = (field) => `set${field[0].toUpperCase()}${field.slice(1)}`;

export function usePointerState() {
  const [shown, patch] = useReducer(applyPatch, BLANK);
  // setDragging, setMarquee, setStretch, setAim, setWet, setTrail, setCursor - стабильные
  const setters = useMemo(
    () => Object.fromEntries(FIELDS.map((f) => [setterName(f), (value) => patch({ [f]: value })])),
    [],
  );
  const dragRef = useRef(null);
  const pressRef = useRef({ key: "", at: 0 });
  // узлы, которые рисуем руками: кольцо, след ластика, живые мазки
  const nodes = useRef({ ring: null, trail: null, wet: [] });

  return { dragRef, pressRef, nodes, ...shown, ...setters };
}

// Захват указателя холстом; не вышло - сообщаем, не бросая
export function grabPointer(target, pointerId) {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    return false;
  }
  return true;
}

export function releasePointer(target, pointerId) {
  try {
    const holds =
      typeof target.hasPointerCapture === "function" ? target.hasPointerCapture(pointerId) : true;
    if (holds) target.releasePointerCapture?.(pointerId);
  } catch {
    // указатель уже ушёл - отпускать нечего
  }
}
