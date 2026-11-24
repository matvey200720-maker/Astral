import { useEffect, useRef } from "react";
import * as look from "./look.js";
import { drawStream, drawWater, startBackdropCanvas } from "./backdrop-canvas.js";

/*
 * Фон за окнами (выбор — «Внешний вид»): «Свет» — «Сияние», «Волны» — «Живая вода», «Линии» — «Поток» (владелец, 23.11.2026, замечание по 1.0.3:
 * «волны — настоящие, не фигуры, что ездят влево-вправо; свет и линии красивее и с анимацией»). «Сияние» — три мягких пятна, их движение считает
 * композитор (`look.css`, ступенями); «Живая вода» и «Поток» — один холст 2D (`backdrop-canvas.js`): форма кривых меняется непрерывно.
 * Второго WebGL-контекста фон не заводит.
 */

/** Холст с рисунком; `still` — миниатюра: один кадр, цикл не заводится. Цвет рисунка — акцент пользователя. */
function CanvasArt({ draw, still }) {
  const ref = useRef(null);
  const { accent } = look.useLook();
  const rgb = look.accentOf(accent).rgb;
  useEffect(() => startBackdropCanvas(ref.current, draw, rgb, still), [draw, rgb, still]);
  return <canvas aria-hidden="true" className="astral-canvas" ref={ref} />;
}

// Любой другой фон (none, space, мусор) рисунка не имеет.
const DRAWERS = new Map([
  ["waves", (still) => <CanvasArt draw={drawWater} still={still} />],
  ["lines", (still) => <CanvasArt draw={drawStream} still={still} />],
  [
    "light",
    () => (
      <>
        <i className="astral-glow is-1" />
        <i className="astral-glow is-2" />
        <i className="astral-glow is-3" />
      </>
    ),
  ],
]);

export const BackdropArt = ({ backdrop, mini = false }) => {
  const draw = DRAWERS.get(backdrop);
  if (!draw) return null;
  return <span className={`astral-backdrop-art is-${backdrop}${mini ? " is-mini" : ""}`}>{draw(mini)}</span>;
};

// space убран 23.10.2026 (сцена «Живой космос»); look.js его не пропускает, ветка про запас
/* `scoped` — фон внутри окна, а не на всё приложение: окно настроек закрывает страницу под собой плотной подложкой, и общий фон
   за ним не виден (замечание 1.0.3: «в настройках всё чёрное, фон не меняется»), поэтому оно рисует тот же фон у себя. */
export default function AppBackdrop({ scoped = false }) {
  const { backdrop } = look.useLook();
  if (backdrop === "none" || backdrop === "space") return null;
  return (
    <div aria-hidden="true" className={scoped ? "astral-backdrop is-scoped" : "astral-backdrop"}>
      <BackdropArt backdrop={backdrop} />
    </div>
  );
}
