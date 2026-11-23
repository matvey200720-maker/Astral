/*
 * Место раздела «Комната» в панели «Стены внутри» (мастерская ангара — цвета, часть В: пол, стены и потолок комнаты). Нулевой коммит: раздел не готов — крючок ничего не рисует; когда часть В готова,
 * она включает `HANGAR_ROOM_SECTION_READY` в этом файле. Сам раздел (`HangarRoomSection.jsx`) грузится по требованию: стартовый кусок окна у потолка.
 */
import { Suspense, lazy } from "react";
import { hangarRoomSurfaces } from "@modovik/climb-contract/recolor/hangar-room";

export const HANGAR_ROOM_SECTION_READY = true;
const Section = lazy(() => import("./HangarRoomSection.jsx"));

export default function HangarRoomHook(props) {
  /* Нет листа комнаты в описи — нет органа, и кусок раздела не грузится. */
  if (!HANGAR_ROOM_SECTION_READY || !hangarRoomSurfaces().length) return null;
  return (
    <Suspense fallback={null}>
      <Section {...props} />
    </Suspense>
  );
}
