import { createElement as h } from "react";
import "./light-contour.css";

/*
 * «Контур и свет» — общий примитив ожидания в Astral (дизайн 15.11.2026, макеты r8/loaders).
 *
 * Язык один: тонкий контур того, что приедет → светлый проход по контуру → настоящее проявляется на том же месте. Здесь куски, из которых
 * экраны собирают своё ожидание; сам экран решает, что где стоит и когда проявляется.
 *
 *   <LightSweep />        светлая полоса идёт по месту слева направо (или сверху вниз, `vertical`) — «свет по контуру»;
 *   <LightRing />         поворотный круг на полу сцены: тонкий эллипс, по нему идёт искра;
 *   <LightFinder />       видоискатель: четыре уголка и перекрестие — «читаю кадр»;
 *   <LightFloor />        мягкая тень-эллипс под вещью;
 *   <LightPlate>…</…>     серое место с проходом света — для карточки, у которой ещё нет ни рисунка, ни контура.
 *
 * ПРАВИЛА (docs/3D.md, PORT.md п. 6): движение — только `transform` и `opacity`, без масок и размытия внутри анимации; проходов конечное число
 * (свето-полоса — двенадцать, круг — двадцать оборотов): простой экрана — ноль, а ожидание конечно и само снимает компонент, когда ждать нечего;
 * при «меньше движения» (`prefers-reduced-motion`, `data-motion="off"`) те же рисунки стоят без движения, а проявление идёт прозрачностью.
 * Окно в фоне анимации не держит: браузер ставит их на паузу сам, своих таймеров здесь нет.
 */

const joined = (...names) => names.filter(Boolean).join(" ");

/** Светлая полоса, которая идёт по месту. `period` — секунды одного прохода, `delay` — на сколько позже соседа (волна). */
export function LightSweep({
  vertical = false,
  period = 2.4,
  delay = 0,
  strong = false,
  className = "",
}) {
  const style = {
    "--light-period": `${period}s`,
    "--light-delay": `${delay}s`,
  };
  return h(
    "span",
    {
      className: joined(
        "light-sweep",
        vertical && "is-vertical",
        strong && "is-strong",
        className,
      ),
      style,
      "aria-hidden": "true",
    },
    h("i"),
  );
}

/** Поворотный круг на полу: эллипс в перспективе, по нему идёт искра. */
export function LightRing({ className = "" }) {
  return h(
    "span",
    { className: joined("light-ring", className), "aria-hidden": "true" },
    h("span", { className: "light-ring-line" }),
    h("span", { className: "light-ring-line is-inner" }),
    h("span", { className: "light-ring-spin" }, h("i")),
  );
}

/** Видоискатель: четыре уголка и перекрестие в центре. */
export function LightFinder({ className = "" }) {
  return h(
    "span",
    { className: joined("light-finder", className), "aria-hidden": "true" },
    h("i"),
    h("i"),
    h("i"),
    h("i"),
    h("b"),
  );
}

/** Мягкая тень-эллипс под вещью. */
export function LightFloor({ className = "" }) {
  return h("span", {
    className: joined("light-floor", className),
    "aria-hidden": "true",
  });
}

/** Серое место с проходом света: плита ожидания там, где потом встанет рисунок. Размер и форму задаёт тот, кто её ставит. */
export function LightPlate({ delay = 0, className = "", children }) {
  return h(
    "span",
    {
      className: joined("light-plate", className),
      "aria-hidden": children ? undefined : "true",
    },
    h(LightSweep, { delay }),
    children,
  );
}
