/*
 * «Студия» у дирижаблей (задача 6Б ТЗ 18.10.2026): надпись дирижабля, лого и
 * текстура модели рисуются в студии, а окно студии показывает кадр самого редактора
 * — тот же вид с этой картинкой на этом месте — на лету (кадр собирает лист из
 * картинки хранилища, ключ обновляется с холстом). Итог — «своя картинка» места
 * тем же путём, что и загруженный файл.
 */

import { finishView3d } from "../texture-studio/StudioLive.jsx";
import { tr } from "../../../locales/ui.js";

/* Живая картинка студии вместо картинки места: что за место — по ключу кнопки (`blimp`, `decal-<вид>`, `skin-<вид>`). */
function stand(project, id, image) {
  if (id === "blimp") return { ...project, blimp: { ...project.blimp, sign: "image", image } };
  const [slot, ...rest] = id.split("-");
  const kind = rest.join("-");
  const item = project.fleet?.[kind];
  if (!item || (slot !== "decal" && slot !== "skin")) return project;
  return { ...project, fleet: { ...project.fleet, [kind]: { ...item, [slot]: { ...item[slot], mode: "image", image } } } };
}

/** Вид дирижабля, что окно показывает для кнопки `id`. */
export const airshipKindOfSurface = (id) => (id === "blimp" ? "blimp" : String(id).replace(/^(?:decal|skin)-/, ""));

/** Холст кнопки `id`; `live` — кадр редактора (`useStudioLive`). */
export function airshipStudioSurface({ id, title, size, live = null }) {
  const surfaceId = `airships:${id}`;
  return {
    id: surfaceId,
    title,
    width: size.width,
    height: size.height,
    transparent: true,
    currentFit: "contain",
    placeLabel: "Поставить на дирижабль",
    view3d: finishView3d(live, {
      id: surfaceId,
      patch: (project, asset, box) => stand(project, id, { asset, name: "", width: box.width, height: box.height }),
      width: size.width,
      height: size.height,
      kind: "hangar-emblem",
      reloads: true,
      hint: { kind: airshipKindOfSurface(id) },
    }),
    /* Подпись окна — по месту, что правится. */
    label: `${tr("Дирижабль")} · ${title}`,
  };
}
