/*
 * Тишина движения (задача 6 ТЗ 10.10.2026).
 *
 * Выход из редактора — это рейка, которая возвращается (переход колонки
 * сетки `.desktop-app`, navigation-rail.css), и карточки полки, которые
 * встают волной (assembly-motion.css). Стенд `npm run perf` показал: посреди
 * этого перехода фоновая работа окна — снимок 3D-обложки (кадр WebGL,
 * 35–55 мс) — забирала кадры, и рейка ехала рывками.
 *
 * Здесь — один вопрос: «движется ли сейчас что-то большое?». Источник —
 * сами события страницы, без подписок оболочки: начался переход колонки
 * рейки или появление карточек — тишина отодвигается на время движения.
 * Тяжёлая фоновая работа спрашивает `motionQuiet()` и ждёт.
 */

/* Рейка едет 460 мс; запас — на первую волну карточек под ней. */
const RAIL_MS = 700;
/* Карточка встаёт за 380 мс; волна идёт с задержками, и каждая отодвигает. */
const CARD_MS = 420;

let quietAt = 0;

const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/** Отодвинуть тишину: что-то начало двигаться на `ms` миллисекунд. */
export function markMotion(ms) {
  quietAt = Math.max(quietAt, now() + Math.max(0, Number(ms) || 0));
}

/** Сколько ещё ждать тишины, мс (0 — тихо). */
export function motionLeft() {
  return Math.max(0, quietAt - now());
}

/** Дождаться, пока большое движение на странице доедет. */
export async function motionQuiet() {
  for (let wait = motionLeft(); wait > 0; wait = motionLeft())
    await new Promise((resolve) => setTimeout(resolve, wait + 16));
}

if (
  typeof document !== "undefined" &&
  typeof document.addEventListener === "function"
) {
  document.addEventListener(
    "transitionrun",
    (event) => {
      if (event.propertyName === "grid-template-columns") markMotion(RAIL_MS);
    },
    true,
  );
  document.addEventListener(
    "animationstart",
    (event) => {
      if (String(event.animationName || "").startsWith("assembly-card"))
        markMotion(CARD_MS);
    },
    true,
  );
}
