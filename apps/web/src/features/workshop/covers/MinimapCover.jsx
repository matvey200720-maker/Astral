import { useMemo } from "react";
import MinimapPreview, {
  MINIMAP_COVER_DEMO,
  useMinimapAssetUrls,
} from "../../../components/desktop/workshop/MinimapPreview.jsx";
import { createDefaultMinimapLayout } from "../../../components/desktop/workshop/minimap-layout.js";
import { readStudioProject } from "./cover-data.js";

/* Стандартная обложка — вид самой GTA: полосы под радаром её цветами. Он же
   заводской вид новой мини-карты. */
const stockMinimap = () => createDefaultMinimapLayout();

/*
 * Обложка мини-карты.
 *
 * Плитка рисовала снимок слота — один и тот же увеличенный кусок карты у
 * любой мини-карты. Человек открывал библиотеку и не видел, какая у него
 * стоит: где полосы, какого цвета HP, с цифрами или без. Обложка — сама
 * мини-карта тем же рисунком, которым её показывает редактор: радар, полосы
 * на своих местах, цвета и значки. HP целиком, броня наполовину, чтобы были
 * видны и заливка, и дорожка.
 *
 * Без проекта рисуется вид «как в игре» — тот, что стоит в GTA до любых
 * правок: это обложка плитки редактора, пока человек ничего не ставил.
 *
 * Обложка части редукса (25.10.2026) рисует полосы, цифры и букву N из самого
 * `minimap.gfx` автора (`project.minimapLook`, `MinimapAuthored.jsx`), а не
 * из полей редактора: место, цвет и число — как в игре, без демо-значений.
 */
export default function MinimapCover({
  projectId = "",
  state = null,
  /* Радар мода под полосами (обложка каталога, `minimap-radar-field.js`). */
  radarSrc = "",
}) {
  const project = useMemo(
    () => readStudioProject(projectId, state),
    [projectId, state],
  );
  const config = useMemo(
    () => project?.modules?.minimap || stockMinimap(),
    [project],
  );
  const [assetUrls] = useMinimapAssetUrls(project, config);
  /* Вид полос из `minimap.gfx` мода: разбор кладёт его в снимок рядом с
     проектом. У такой обложки не демо-значения, а состояние, в каком стоит
     кадр автора (`MINIMAP_LOOK_STATE`: HP 75, брони нет). */
  const look = project?.minimapLook?.version === 1 ? project.minimapLook : null;
  const demo = useMemo(
    () => (look ? { ...MINIMAP_COVER_DEMO, ...look.state } : MINIMAP_COVER_DEMO),
    [look],
  );
  return (
    <MinimapPreview
      config={config}
      demo={demo}
      look={look}
      compact
      still
      assetUrls={assetUrls}
      radarSrc={radarSrc}
    />
  );
}
