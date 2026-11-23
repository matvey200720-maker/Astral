/*
 * «Студия» у логотипа на холме (задача 6Б ТЗ 18.10.2026): картинка рисуется на
 * прозрачном холсте в рекомендуемом размере (`vinewoodLogoPixels` — во всю ширину
 * надписи) и встаёт на холм вместо букв; окно студии показывает холм с логотипом
 * на лету. Итог — «свой логотип» работы тем же путём, что и загруженный файл.
 */

import { vinewoodLogoPixels } from "@modovik/climb-contract/recolor/vinewood";
import { finishView3d } from "../texture-studio/StudioLive.jsx";
import { tr } from "../../../locales/ui.js";

/** `live` — кадр редактора (`useStudioLive`): окно студии рисует холм с этим логотипом. */
export function vinewoodStudioSurface({ live = null } = {}) {
  const [width, height] = vinewoodLogoPixels().wide;
  const size = { width, height };
  return {
    id: "vinewood:logo",
    slug: "vinewood-logo",
    title: `${tr("Вайнвуд")} · ${tr("логотип")}`,
    ...size,
    transparent: true,
    baseColour: "#202226",
    placeLabel: "Поставить вместо букв",
    view3d: finishView3d(live, {
      id: "vinewood:logo",
      patch: (project, asset, box) => ({ ...project, mode: "logo", logo: { asset, name: "", width: box.width, height: box.height } }),
      ...size,
      kind: "hangar-emblem",
      reloads: true,
    }),
  };
}
