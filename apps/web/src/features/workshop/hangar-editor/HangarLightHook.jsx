/*
 * Место раздела «Свет ламп» в панели «Конструкции и свет» (мастерская ангара — цвета, часть А). Нулевой коммит: раздел не готов — крючок ничего не рисует; когда часть А готова, она включает
 * `HANGAR_LIGHT_SECTION_READY` в этом файле. Сам раздел (`HangarLightSection.jsx`) грузится по требованию: стартовый кусок окна у потолка.
 */
import { Suspense, lazy } from "react";

export const HANGAR_LIGHT_SECTION_READY = true;
const Section = lazy(() => import("./HangarLightSection.jsx"));

export default function HangarLightHook(props) {
  if (!HANGAR_LIGHT_SECTION_READY) return null;
  return (
    <Suspense fallback={null}>
      <Section {...props} />
    </Suspense>
  );
}
