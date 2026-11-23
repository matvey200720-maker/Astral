import { labelRunOf, labelUnsupportedReason } from "./label-runs.js";
import { perfCount } from "../../../../../perf-count.js";

// Куда уходит подпись: "gpu" (её строка попадает в runs) или "svg" (остаётся в слое).
const routeLabel = (item, runs) => {
  const reason = labelUnsupportedReason(item);
  const run = reason ? null : labelRunOf(item, 1);
  if (run) {
    runs.push(run);
    perfCount("map.labels.run");
    return "gpu";
  }
  if (reason) perfCount(`map.labels.svg.${reason}`);
  return "svg";
};

// Слой без ушедших подписей остаётся тем же объектом: MemoLayer сравнивает по ссылке.
const staysOnSvg = (runs) => (item) => routeLabel(item, runs) === "svg";

function splitLayer(layer, runs) {
  const staying = layer.items.filter(staysOnSvg(runs));
  if (staying.length !== layer.items.length) return { ...layer, items: staying };
  return layer;
}

function splitScene(layers) {
  const runs = [];
  const mapped = layers.map((layer) => splitLayer(layer, runs));
  return { layers: mapped, runs };
}

const untouched = (layers) => ({ layers, runs: [] });

export const labelsForScene = (layers, { enabled }) =>
  enabled ? splitScene(layers) : untouched(layers);
