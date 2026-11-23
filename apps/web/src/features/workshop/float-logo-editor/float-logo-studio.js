/*
 * «Студия» у летающего лого (задача 6Б ТЗ 18.10.2026): картинка лого рисуется в
 * студии на прозрачном холсте — по контуру её непрозрачных пикселей игра ставит
 * объёмную фигуру, и окно студии показывает эту фигуру над городом на лету.
 * Итог встаёт «своей картинкой» лого — тем же путём, что и загруженный файл.
 */

import { finishView3d } from "../texture-studio/StudioLive.jsx";
import { tr } from "../../../locales/ui.js";

/** Холст лого: квадрат 1024 — фигура вытягивается по контуру, размер ей задаёт сама работа (`size`). */
export const FLOAT_LOGO_STUDIO_SIDE = 1024;

/** `live` — кадр редактора (`useStudioLive`): окно студии рисует лого над площадью с этой картинкой. */
export function floatLogoStudioSurface({ live = null } = {}) {
  const size = { width: FLOAT_LOGO_STUDIO_SIDE, height: FLOAT_LOGO_STUDIO_SIDE };
  return {
    id: "floatlogo:image",
    slug: "float-logo",
    title: `${tr("Летающее лого")} · ${tr("картинка")}`,
    ...size,
    /* Прозрачный холст: фигуру задаёт контур нарисованного, а не прямоугольник. */
    transparent: true,
    baseColour: "#202226",
    placeLabel: "Поставить на лого",
    view3d: finishView3d(live, {
      id: "floatlogo:image",
      patch: (project, asset, box) => ({ ...project, mode: "image", image: { asset, name: "", width: box.width, height: box.height } }),
      ...size,
      kind: "hangar-emblem",
      reloads: true,
    }),
  };
}
