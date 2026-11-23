// Подписи у порога читаемости: пока сцена не «поспела» за кадром, слою подписей даём
// data-live и --wm-ppu (точек экрана на единицу сцены). Пишем прямо в узел.
//   ports: svg(), snap() → { frame, scene, win }, hasFloor() → boolean
import { resolveFrame } from "../world-map-frame.js";
import { FLOOR_DRIFT, FLOOR_LAG, FLOOR_PERIOD_MS } from "./numbers.js";

const LAYER_SELECTOR = '[data-layer="marker-labels"]';
const VAR_NAME = "--wm-ppu";
const round4 = (value) => Math.round(value * 10000) / 10000;

export function createFloorSync(ports) {
  const mem = { shown: null, wroteAt: 0, timer: null, latest: 0 };

  const layerNode = () => ports.svg()?.querySelector(LAYER_SELECTOR) ?? null;

  const dropTimer = () => {
    if (mem.timer === null) return;
    clearTimeout(mem.timer);
    mem.timer = null;
  };

  const put = (layer, value) => {
    layer.style.setProperty(VAR_NAME, String(value));
    mem.shown = value;
    mem.wroteAt = performance.now();
  };

  const clear = (layer) => {
    dropTimer();
    const marked = layer.hasAttribute("data-live") || mem.shown !== null;
    mem.shown = null;
    if (!marked) return;
    layer.removeAttribute("data-live");
    layer.style.removeProperty(VAR_NAME);
    if (!layer.getAttribute("style")) layer.removeAttribute("style");
  };

  const publish = (layer, value, gesture) => {
    const drift = mem.shown === null ? Infinity : Math.abs(value / mem.shown - 1);
    mem.latest = value;
    if (!gesture) {
      dropTimer();
      if (drift >= FLOOR_DRIFT.rest) put(layer, value);
      return;
    }
    if (drift < FLOOR_DRIFT.gesture) return;
    const wait = FLOOR_PERIOD_MS - (performance.now() - mem.wroteAt);
    if (wait <= 0) {
      dropTimer();
      put(layer, value);
      return;
    }
    if (mem.timer !== null) return;
    mem.timer = setTimeout(() => {
      mem.timer = null;
      const node = layerNode();
      if (node) put(node, mem.latest);
    }, wait);
  };

  return {
    // `liveView` — живой кадр жеста; без него считаем по показанному кадру (покой)
    sync(liveView = null) {
      const layer = layerNode();
      if (!layer) return;
      if (!ports.hasFloor()) {
        clear(layer);
        return;
      }
      const { frame, scene, win } = ports.snap();
      const width = liveView ? resolveFrame(liveView, scene, win).width : frame.width;
      const dots = win.width / width;
      const gesture = Boolean(liveView);
      const lag = Math.abs(dots / scene.windowScale - 1);
      if (lag < (gesture ? FLOOR_LAG.gesture : FLOOR_LAG.rest)) {
        clear(layer);
        return;
      }
      layer.setAttribute("data-live", "");
      publish(layer, round4(dots), gesture);
    },
    dispose: dropTimer,
  };
}
