import { useState } from "react";

const idSet = (...ids) => new Set(ids);

export const BASE_LAYERS_IDS = idSet("sea", "base", "tint", "grid");

export const OVERLAY_LAYERS = idSet(
  "zone-fills",
  "zones",
  "markers",
  "label-mesh",
  "zone-labels",
  "marker-labels",
);

const isBaseLayer = (layer) => BASE_LAYERS_IDS.has(layer.id);
const isNotDetail = ({ id }) => id !== "base-detail";

// Слой base показывает карту целиком: резкого куска приближения в нём нет.
function withoutDetail(layer) {
  if (layer.id !== "base") return layer;
  return Object.assign({}, layer, { items: layer.items.filter(isNotDetail) });
}

// Хранит слои подложки вместе с их JSON: пока JSON тот же, отдаёт прежний массив.
class LayerKeeper {
  key = "";
  layers = [];

  read(scene) {
    const fresh = Array.from(scene.layers.filter(isBaseLayer), withoutDetail);
    const key = JSON.stringify(fresh);
    if (key === this.key) return this.layers;
    this.key = key;
    this.layers = fresh;
    return fresh;
  }
}

// Сцена приходит новым объектом на каждую отрисовку, поэтому сравнение идёт по содержимому.
export default function useBaseLayers(scene) {
  const [keeper] = useState(() => new LayerKeeper());
  return keeper.read(scene);
}
