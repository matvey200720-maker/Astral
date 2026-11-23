import { useMemo } from "react";
import { createVinewoodProject, normalizeVinewoodProject } from "@modovik/climb-contract/recolor/vinewood";
import { useVinewoodLogo } from "../vinewood-editor/vinewood-art.js";
import { VinewoodArt } from "../vinewood-editor/VinewoodPresets.jsx";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка «Вайнвуд» — настоящий холм с надписью в облике работы: 3D-снимок
 * той же сцены, что в редакторе, со стороны города, на матовой плашке, как
 * у всех карточек полки. Своё слово — буквами, цветом и лесами на снимке;
 * свой логотип — картинкой из хранилища окна (05.10.2026, владелец:
 * «поставил свой логотип — на предпросмотре видна просто гора»). Пока
 * картинка читается, снимка нет — плашка не мигает голым склоном.
 * Пока человек ничего не ставил — VINEWOOD как в игре.
 */
export default function VinewoodCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeVinewoodProject(stored) : createVinewoodProject();
  }, [state]);
  const logo = useVinewoodLogo(project.mode === "logo" ? project.logo.asset : "", { max: 512 });
  return <span className="workshop-cover-canvas">{logo.status !== "loading" && <VinewoodArt project={project} logo={logo.pixels} />}</span>;
}
