/*
 * «Студия» у значка строки расписания (задача 6Б ТЗ 18.10.2026): своя картинка
 * строки — квадрат с прозрачным фоном (PNG встаёт в квадрат значка); студия
 * рисует её на прозрачном холсте, а окно студии показывает табло на месте с
 * этим значком на лету. Итог — «своя картинка» строки тем же путём, что и
 * загруженный файл.
 */

import { SCHEDULE_ICON_IMAGE } from "@modovik/climb-contract/recolor/schedule";
import { finishView3d } from "../texture-studio/StudioLive.jsx";
import { tr } from "../../../locales/ui.js";

/** Холст значка — квадрат: таким он встаёт в плашку строки. */
export const SCHEDULE_STUDIO_SIDE = 512;

/** `index` — номер строки, `live` — кадр редактора (`useStudioLive`). */
export function scheduleIconSurface({ index, live = null }) {
  const size = { width: SCHEDULE_STUDIO_SIDE, height: SCHEDULE_STUDIO_SIDE };
  const id = `schedule:row:${index}`;
  return {
    id,
    slug: `schedule-row-${index + 1}`,
    title: `${tr("Расписание")} · ${tr("значок строки")} ${index + 1}`,
    ...size,
    transparent: true,
    baseColour: "#202226",
    placeLabel: "Поставить значок",
    view3d: finishView3d(live, {
      id,
      patch: (project, asset, box) => ({
        ...project,
        rows: project.rows.map((row, at) => (at === index ? { ...row, icon: SCHEDULE_ICON_IMAGE, image: { asset, name: "", width: box.width, height: box.height } } : row)),
      }),
      ...size,
      kind: "hangar-emblem",
      reloads: true,
    }),
  };
}
