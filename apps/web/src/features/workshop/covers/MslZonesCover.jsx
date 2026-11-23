import { useEffect, useMemo, useState } from "react";
import { MSL_ZONES_INVENTORY, createMslZonesProject, normalizeMslZonesProject } from "@modovik/climb-contract/recolor/msl-zones";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { mslZonesImage } from "../msl-zones-editor/msl-zones-art.js";
import { useCoverPending } from "./cover-bake-context.js";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка «МСЛ-зон» — линии района «Центр» сверху в облике работы, из той
 * же сцены описи, что кадр редактора: схема настоящих линий мода, а не
 * кадр из игры. Пока человек ничего не ставил — как в моде.
 */
/* Скорость 12.10: картинка плитки считается холстом и `toDataURL` (~20 мс) —
   при каждом входе в «Мастерскую» заново. Она зависит только от снимка
   работы (сцена описи одна), поэтому готовая берётся по нему. */
const IMAGE_LIMIT = 8;
const images = new Map();

function coverImage(asset, state, project) {
  const key = `${globalThis.devicePixelRatio || 1}|${typeof state === "string" ? state : ""}`;
  const ready = images.get(key);
  if (ready) return ready;
  const href = mslZonesImage(asset, "city", project, { width: 400, height: 170 });
  if (href) {
    images.set(key, href);
    while (images.size > IMAGE_LIMIT) images.delete(images.keys().next().value);
  }
  return href;
}

export default function MslZonesCover({ state = null }) {
  const project = useMemo(() => {
    const stored = parseCoverState(state);
    return stored ? normalizeMslZonesProject(stored) : createMslZonesProject();
  }, [state]);
  const [asset, setAsset] = useState(null);
  /* Сцена зон едет — печь обложек ждёт её. */
  const [settled, setSettled] = useState(false);
  useCoverPending(!settled);
  useEffect(() => {
    let cancelled = false;
    loadSceneAsset(MSL_ZONES_INVENTORY.scene.url)
      .then((loaded) => !cancelled && setAsset(loaded))
      .catch(() => {})
      .finally(() => !cancelled && setSettled(true));
    return () => {
      cancelled = true;
    };
  }, []);
  const href = useMemo(() => (asset ? coverImage(asset, state, project) : ""), [asset, state, project]);
  return <span className="workshop-cover-canvas">{href ? <img className="workshop-cover-zones" src={href} alt="" /> : null}</span>;
}
