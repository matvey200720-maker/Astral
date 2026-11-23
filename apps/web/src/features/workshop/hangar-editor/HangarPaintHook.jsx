/*
 * Место раздела «Цвет конструкций и труб» в панели «Конструкции и свет» (мастерская ангара — цвета, часть Б). Нулевой коммит: раздел не готов — крючок ничего не рисует; когда часть Б готова, она
 * включает `HANGAR_PAINT_SECTION_READY` в этом файле. Сам раздел (`HangarPaintSection.jsx`) грузится по требованию: стартовый кусок окна у потолка.
 */
import { Suspense, lazy } from "react";
import { hangarPaintAvailable } from "@modovik/climb-contract/recolor/hangar-paint";

export const HANGAR_PAINT_SECTION_READY = true;
const Section = lazy(() => import("./HangarPaintSection.jsx"));

export default function HangarPaintHook(props) {
  /* Нет листа в описи — нет органа, и кусок раздела не грузится. */
  if (!HANGAR_PAINT_SECTION_READY || !(hangarPaintAvailable("structure") || hangarPaintAvailable("pipes"))) return null;
  return (
    <Suspense fallback={null}>
      <Section {...props} />
    </Suspense>
  );
}
