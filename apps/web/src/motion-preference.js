import { useSyncExternalStore } from "react";

/*
 * Один ответ на вопрос «двигаться ли».
 *
 * До этого файла ответов было пять, и каждый свой: пять мест звали
 * `matchMedia("(prefers-reduced-motion: reduce)")` прямо в обработчике, ни одно
 * не подписывалось на смену запроса, а Electron этот запрос ещё и глушил
 * ключом `force-prefers-no-reduced-motion` — так что все пять всегда отвечали
 * «двигаться», сколько бы человек ни выключал анимации в Windows.
 *
 * Ответ теперь один и лежит там же, где его читает CSS: в атрибуте
 * `data-motion` на <html>. Выбор в такой форме потому, что атрибут ставится до
 * первого кадра (public/theme-bootstrap.js) и виден любому компоненту без
 * пропа — иначе выключатель пришлось бы протаскивать в каждую карусель и
 * каждый цикл кадров через полдесятка слоёв.
 *
 * Значения настройки три, а положений у тумблера два: `system` — это не
 * третье положение, а состояние «человек ещё не решал».
 *
 * Решение владельца 14.10.2026: анимации включены, пока человек сам не
 * выключил их в «Настройках». Windows больше не решает: у игроков эффекты
 * анимации в системе часто выключены ради скорости, и Astral стоял мёртвым —
 * карточки не въезжали, орбиты не крутились, вспышка мини-карты пропадала.
 * Electron снова не передаёт окну системный `prefers-reduced-motion`
 * (`force-prefers-no-reduced-motion` в apps/desktop/src/main.js), а здесь
 * «не решал» значит «включены» — и в браузере, и в окне.
 */

export const MOTION_STORAGE_KEY = "modovik-motion";

/** Человек ещё не решал — анимации включены (Windows не спрашиваем). */
export const MOTION_SYSTEM = "system";
export const MOTION_ON = "on";
export const MOTION_OFF = "off";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function normalizeMotionChoice(value) {
  return [MOTION_SYSTEM, MOTION_ON, MOTION_OFF].includes(value)
    ? value
    : MOTION_SYSTEM;
}

export function readMotionChoice() {
  try {
    return normalizeMotionChoice(localStorage.getItem(MOTION_STORAGE_KEY));
  } catch {
    /* Приватный режим и заблокированное хранилище не повод падать на старте. */
    return MOTION_SYSTEM;
  }
}

export function systemPrefersReducedMotion() {
  return Boolean(window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches);
}

/** Решение по выбору: выключает только «off» человека; система не решает. */
export function motionEnabledFor(choice) {
  return normalizeMotionChoice(choice) !== MOTION_OFF;
}

/**
 * Текущее решение, как его видит DOM. Читать надо именно атрибут, а не
 * localStorage: между ними стоит выбор «как в системе», и только атрибут знает,
 * чем он сейчас разрешился.
 */
export function motionEnabled() {
  if (typeof document === "undefined") return true;
  return document.documentElement.dataset.motion !== MOTION_OFF;
}

/** Ставит атрибут по выбору. Возвращает отписку (подписываться больше не на что). */
export function applyMotionChoice(choice) {
  document.documentElement.dataset.motion = motionEnabledFor(choice)
    ? "full"
    : MOTION_OFF;
  return () => {};
}

/*
 * Подписка на само решение, а не на его источник: атрибут меняют и настройка,
 * и системный запрос, и оба приходят сюда одной дорогой.
 */
function subscribeMotionEnabled(listener) {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-motion"],
  });
  return () => observer.disconnect();
}

/** Тот же ответ для React-дерева: компонент перерисуется, когда решение сменится. */
export function useMotionEnabled() {
  return useSyncExternalStore(
    subscribeMotionEnabled,
    motionEnabled,
    () => true,
  );
}
