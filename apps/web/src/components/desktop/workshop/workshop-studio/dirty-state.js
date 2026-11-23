import { useEffect, useRef, useState } from "react";

// События, которыми человек берётся за работу: первое из них закрывает окно открытия.
const CLOSING_EVENTS = Object.freeze(["pointerdown", "keydown", "click", "input", "change"]);

// Запустить действие через ms; вернуть отмену.
const after = (ms, action) => {
  const timer = globalThis.setTimeout(action, ms);
  return () => globalThis.clearTimeout(timer);
};

// Слушать события окна (на фазе перехвата); вернуть отписку.
function listenAll(types, listener) {
  types.forEach((type) => globalThis.addEventListener(type, listener, true));
  return () => types.forEach((type) => globalThis.removeEventListener(type, listener, true));
}

// Значение, которое догоняет живое через delay мс после последней правки.
export function useSettled(value, delay = 250) {
  const [shown, setShown] = useState(value);
  const behind = shown !== value;

  useEffect(
    () => (behind ? after(delay, () => setShown(value)) : undefined),
    [behind, value, delay],
  );

  return shown;
}

// Окно открытия: объект-затвор, который закрывает событие человека или таймер.
function useOpeningWindow(ms) {
  const [gate] = useState(() => {
    const state = {
      open: true,
      close: () => {
        state.open = false;
      },
    };
    return state;
  });
  useEffect(() => {
    const stops = [listenAll(CLOSING_EVENTS, gate.close), after(ms, gate.close)];
    return () => stops.forEach((stop) => stop());
  }, [ms, gate]);
  return gate;
}

// Переписать «сохранённое» текущим проектом и его строкой.
function overwriteSaved(projectBox, fingerprintBox, fingerprintOf, project) {
  projectBox.current = project;
  fingerprintBox.current = fingerprintOf(project);
}

// Пока окно открыто, смена проекта (а также ящиков и функции отпечатка)
// переписывает «сохранённое»: первые записи органа не считаются правкой человека.
export function useOpeningWrites(project, options) {
  const { savedProject, savedFingerprint, fingerprintOf, windowMs = 2000 } = options;
  const gate = useOpeningWindow(windowMs);
  const lastInputs = useRef(null);

  useEffect(() => {
    const inputs = [project, savedProject, savedFingerprint, fingerprintOf];
    const earlier = lastInputs.current;
    lastInputs.current = inputs;
    const moved = earlier !== null && inputs.some((item, at) => !Object.is(item, earlier[at]));
    if (moved && gate.open) {
      overwriteSaved(savedProject, savedFingerprint, fingerprintOf, project);
    }
  }, [project, savedProject, savedFingerprint, fingerprintOf, gate]);
}

// Дёшево: по ссылкам. Строка нужна, только когда проект уже отстоял протяжку
// (совпал с отложенным), иначе он грязный сразу.
export const projectIsDirty = ({
  project,
  savedProject,
  deferredProject,
  savedFingerprint,
  fingerprintOf,
}) =>
  project === savedProject
    ? false
    : project !== deferredProject || savedFingerprint !== fingerprintOf(deferredProject);

// Честно, по строке: правка на месте тоже видна, ссылки не читаются.
export const projectIsDirtyHonest = ({ project, savedFingerprint, fingerprintOf }) =>
  fingerprintOf(project) !== savedFingerprint;
