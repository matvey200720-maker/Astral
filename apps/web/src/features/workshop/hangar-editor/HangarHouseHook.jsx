/*
 * Место раздела «Дом» на вкладке «Внутри» (мастерская ангара — «Отделка → Внутри → Дом», владелец 23.11.2026: «просто назови дом, и чтобы он красился, у него цвет просто»). Сам раздел
 * (`HangarHouseSection.jsx`) грузится по требованию: стартовый кусок окна его не несёт. Нет листа дома в описи (`hangarHouseSurfaces`) — нет органа, и кусок не грузится.
 */
import { Suspense, lazy } from "react";
import { hangarHouseSurfaces } from "@modovik/climb-contract/recolor/hangar-house";

const Section = lazy(() => import("./HangarHouseSection.jsx"));

export default function HangarHouseHook(props) {
  if (!hangarHouseSurfaces().length) return null;
  return (
    <Suspense fallback={null}>
      <Section {...props} />
    </Suspense>
  );
}
