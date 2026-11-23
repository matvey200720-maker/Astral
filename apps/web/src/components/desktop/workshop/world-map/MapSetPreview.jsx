import { memo, useMemo } from "react";
import {
  MAP_TEMPLATE_CARD_RECT,
  applyLabelSet,
  applyOwnSet,
  applyZoneSet,
  buildMapScene,
  normalizeWorldMap,
} from "@modovik/vector-map";
import MapScene from "../MapScene.jsx";
import MapScenePicture from "./MapScenePicture.jsx";
import { OVERLAY_LAYERS } from "./useBaseLayers.js";
import useLabelMeshes from "./useLabelMeshes.js";
import { VIEWS, denseFrame, fitFrame } from "./set-frames.js";

/*
 * Образец набора на карте самого человека: подложка — та же, что в кадре (слои
 * сцены редактора), поверх — зоны или подписи набора его же оформлением.
 * Вынесено из `MapSetsCatalog.jsx` (18.10): образец нужен и карточке в колонке, и
 * окну «Подписи локаций» (`MapLabelsPicker.jsx`) — там он большой.
 */

/**
 * Набор поверх карты: чистой — то, что покажет его карточка (`clean`), или
 * самой карты человека — щелчок по карточке.
 */
export function sampleConfig(config, card, names, clean = true) {
  const empty = clean
    ? normalizeWorldMap({
        ...config,
        zones: { ...config.zones, enabled: true, hiddenGroups: [], items: [] },
        markers: { ...config.markers, enabled: true, hiddenGroups: [], items: [] },
      })
    : config;
  if (card.kind === "none") return empty;
  if (card.kind === "own") return applyOwnSet(empty, card.entry);
  if (card.kind === "label") return applyLabelSet(empty, card.id, { names });
  return applyZoneSet(empty, card.id);
}

/**
 * `ready` — приехали подписи наборов-карт: образец перерисовывается с ними.
 * `rect` — свой кадр в долях сцены (`{ u, v, width, height }`, у окна выбора —
 * «Вся карта», «Город», «Форт Занкудо»); без него — кадр карточки по её виду.
 * `whole` — кадр целиком, с полями по бокам (у карточек кадр заполняется, обрезая края).
 */
const SetPreview = memo(function SetPreview({ baseLayers, config, card, names, atlas, backdrop, ready, rect: own = null, whole = false, live = false }) {
  /* Набор-сетка (подписи донора треугольниками): его файл приезжает отдельно, образец перерисовывается с ним. */
  const meshVersion = useLabelMeshes(card.mesh?.id || "");
  const { scene, fit } = useMemo(() => {
    const sample = buildMapScene(sampleConfig(config, card, names), { atlas });
    const overlay = sample.layers.filter((layer) => OVERLAY_LAYERS.has(layer.id));
    return {
      scene: { ...sample, layers: [...baseLayers, ...overlay] },
      fit: own
        ? null
        : card.view === "fit"
          ? fitFrame(overlay, sample)
          : card.view === "dense"
            ? denseFrame(overlay.filter((layer) => layer.id === "marker-labels" || layer.id === "label-mesh"), sample)
            : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ready, meshVersion: подписи набора приехали
  }, [baseLayers, config, card, names, atlas, ready, own, meshVersion]);
  const rect = own || VIEWS[card.view] || MAP_TEMPLATE_CARD_RECT;
  const frame = fit || {
    x: rect.u * scene.width,
    y: rect.v * scene.height,
    width: rect.width * scene.width,
    height: rect.height * scene.height,
  };
  /* Карточка — картинкой (21.10, `MapScenePicture.jsx`): разметка сотен подписей в колонке стоила Windows
     раскладку окна на каждый щелчок. Большой образец окна выбора (`live`) — живой SVG. */
  if (!live) return <MapScenePicture scene={scene} frame={frame} backdrop={backdrop} fit={whole ? "meet" : "slice"} />;
  return (
    <MapScene
      scene={scene}
      frame={frame}
      backdrop={backdrop}
      viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
      preserveAspectRatio={whole ? "xMidYMid meet" : "xMidYMid slice"}
      aria-hidden="true"
      focusable="false"
    />
  );
});

export default SetPreview;
