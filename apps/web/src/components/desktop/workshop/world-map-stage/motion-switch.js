// «Без движения»: причины проверяются по порядку в момент вызова, а не один раз при загрузке.
const REASONS = [
  () => typeof document === "undefined",
  () => import.meta.env.MODE === "test" && !globalThis.__astralMapMotion,
  () => Boolean(document.querySelector(".desktop-app[data-motion='off']")),
  () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches),
];

export const motionOff = () => REASONS.some((reason) => reason());
