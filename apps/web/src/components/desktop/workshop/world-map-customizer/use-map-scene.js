// Сцены карты: игры (по ней теснота и цвета подписей), окна (зум, масштаб
// подписей) и итоговая для кадра (резкий кусок, остров, подписи без цвета).
import { useState, useEffect, useReducer, useRef, useMemo } from "react";
import { loadMajesticMarks, BASE_RASTER_TOKEN, buildMapScene, withBaseRasterHref, majesticMarksOn } from "@modovik/vector-map";
import { islandAtlasRect, islandExtent } from "@modovik/vector-map/island";
import { perfTimed } from "../../../../perf-count.js";
import { labelCrowding } from "../world-map-density.js";
import { islandColourReport, withIslandLayer } from "../world-map-island.js";
import { useLabelTonesState, pendingLabelIds } from "../world-map-label-tones.js";
import { useTextAdvance } from "../world-map-text-measure.js";
import { useIslandLayer } from "../useIslandLayer.js";
import { useIslandMap } from "../useIslandMap.js";
import useLabelMeshes from "../world-map/useLabelMeshes.js";
import { pull } from "./bindings.js";
import { snap } from "./frame-math.js";
import { ISLAND_DELAY_MS } from "./panel-data.js";

const NO_PAIRS = [];

// Пары цветов острова: пустой общий массив или прежние, если ничего не изменилось
function pairsReducer(prev, next) {
  if (next === NO_PAIRS) return next;
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

// Метки Majestic — отдельный кусок сборки: грузим, когда они нужны
function useMajesticReady(needed) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded || !needed) return undefined;
    let open = true;
    loadMajesticMarks().then(
      () => {
        if (open) setLoaded(true);
      },
      () => {},
    );
    return () => {
      open = false;
    };
  }, [needed, loaded]);
  return loaded;
}

// Пары цветов острова считаются через паузу после любой правки
function useIslandPairs(shown, link) {
  const [pairs, setPairs] = useReducer(pairsReducer, NO_PAIRS);
  const idle = shown.status !== "ready";
  useEffect(() => {
    if (idle) {
      setPairs(NO_PAIRS);
      return undefined;
    }
    const timer = setTimeout(() => {
      const report = islandColourReport({
        processor: link.processor,
        config: link.config,
        palette: shown.palette,
      });
      setPairs(report.pairs);
    }, ISLAND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [idle, shown.palette, link.processor, link.config, link.baseStamp]);
  return pairs;
}

// Резкий кусок: рамка приходит в долях сцены, примитив считается в единицах сцены
const DETAIL_AXES = { x: ["u", "width"], y: ["v", "height"], width: ["width", "width"], height: ["height", "height"] };

function detailItem(size, patch) {
  const spot = {};
  for (const [key, [share, axis]] of Object.entries(DETAIL_AXES)) {
    spot[key] = snap(patch.rect[share] * size[axis], 100);
  }
  return { kind: "image", id: "base-detail", href: patch.href, ...spot, preserveAspectRatio: "none" };
}

// Правки слоёв итоговой сцены. Правка — { ids, edit } или null, если сейчас её не нужно.
// Резкий кусок ложится поверх растра подложки, пока слой подложки ещё несёт именно этот растр.
function sharpPatch(parts) {
  const { scene } = parts;
  const { detail, baseRaster } = parts;
  if (!(baseRaster && detail && detail.href && detail.rect)) return null;
  const baseLayer = scene.layers.find(({ id }) => id === "base");
  if (baseLayer?.items[0]?.href !== baseRaster.href) return null;
  return {
    ids: ["base"],
    edit(layer) {
      const next = { ...layer };
      next.sharpen = false;
      next.items = layer.items.concat([detailItem(scene, detail)]);
      return next;
    },
  };
}

// Подписи, чей цвет ещё считается, на кадр не попадают
function waitingPatch(parts) {
  const { pending } = parts;
  if (pending.size === 0) return null;
  return {
    ids: ["marker-labels", "zone-labels"],
    edit(layer) {
      const next = { ...layer };
      next.items = layer.items.filter(({ id }) => !pending.has(id));
      return next;
    },
  };
}

// Итоговая сцена кадра: ключ раскладки, резкий кусок, остров, подписи без цвета
function composeStageScene(scene, layoutKey, extras) {
  const keyed = { ...scene, layoutZoom: layoutKey };
  const patches = [sharpPatch({ scene, ...extras }), waitingPatch(extras)].filter(Boolean);
  if (!patches.length && !extras.place) return keyed;

  const layers = [];
  for (const layer of scene.layers) {
    let shaped = layer;
    for (const patch of patches) {
      if (patch.ids.includes(layer.id)) shaped = patch.edit(shaped);
    }
    layers.push(shaped);
  }
  const composed = { ...keyed, layers };
  if (!extras.place) return composed;
  return withIslandLayer(composed, extras.place, extras.islandHref);
}

// Контекст карты меняется только от того, что меняет саму карту: поля по порядку
const MAP_CONTEXT = [].concat(
  ["atlas", "tiles", "landTiles"],
  ["assets", "baseImage", "template"],
  [["baseRaster", (p) => (p.hasRaster ? BASE_RASTER_TOKEN : null)]],
  [["baseProcessed", "hasRaster"]],
  ["vectorBase", "textAdvance", "majesticReady", "meshReady"],
);

// Контекст пересобирается, только когда изменилось одно из значений (сравнение по Object.is)
function useSteadyContext(values) {
  const kept = useRef(null);
  const same =
    kept.current !== null && Object.keys(values).every((key) => Object.is(kept.current.values[key], values[key]));
  if (!same) kept.current = { values, context: pull(values, MAP_CONTEXT) };
  return kept.current.context;
}

function useMapContext(input) {
  const { source, config } = input;
  const fromGame = ["game", "schematic"].includes(config.base.source);
  return useSteadyContext({
    atlas: source.atlas,
    tiles: source.tiles,
    landTiles: source.landTiles,
    assets: input.assetUrls,
    baseImage: source.ownPicture,
    template: source.template,
    hasRaster: Boolean(input.baseRaster),
    vectorBase: fromGame && Boolean(source.baseGeometry),
    textAdvance: input.textAdvance,
    majesticReady: input.majesticReady,
    meshReady: input.meshReady,
  });
}

// Сцена игры и теснота подписей на ней
function useGameScene(config, mapContext) {
  const pair = useMemo(() => {
    const scene = perfTimed("map.scene.game", () => buildMapScene(config, mapContext));
    return { scene, crowding: labelCrowding(scene) };
  }, [config, mapContext]);
  return [pair.scene, pair.crowding];
}

// Цвета подписей по фону: замер читает свежий адрес растра в момент замера
const pinTo = (box) => (target) => withBaseRasterHref(target, box.current.href);

function useLabelTones(gameScene, rasterBox) {
  const state = useLabelTonesState(
    gameScene,
    useMemo(() => pinTo(rasterBox), [rasterBox]),
  );
  const waiting = useMemo(() => {
    const ids = pendingLabelIds(gameScene, state);
    return ids;
  }, [state, gameScene]);
  return { tones: state.tones, waiting };
}

// Приближение сцене отдаётся как zoom, дотяжка резкости — как sharpenBase
function viewLook(view) {
  const preview = view.gamePreview;
  return {
    layoutZoom: preview ? undefined : view.sceneZoom,
    labelScale: preview ? 0 : view.windowScale,
    sharpenBase: view.sceneZoom >= 2,
  };
}

function windowSceneOf(config, context, look) {
  const extra = { zoom: look.layoutZoom, sharpenBase: look.sharpenBase, windowScale: look.labelScale || undefined };
  return perfTimed("map.scene.window", () =>
    buildMapScene(config, Object.assign({}, context, extra)),
  );
}

// Сцена окна: приближение, масштаб подписей, адрес растра
function useWindowScene(input) {
  const look = viewLook(input.view);
  const built = useMemo(
    () => windowSceneOf(input.config, input.sceneContext, look),
    // fontStamp: приехал шрифт проекта — сцену надо переложить; look читается по полям
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.fontStamp, look.labelScale, look.sharpenBase, look.layoutZoom, input.sceneContext, input.config],
  );
  const address = input.rasterAddress;
  const scene = useMemo(() => withBaseRasterHref(built, address), [built, address]);
  return { scene, layoutKey: `${look.layoutZoom || 0}|${look.labelScale}` };
}

// Место острова на атласе
const islandPlace = (atlas) => ({ rect: islandAtlasRect(atlas), extent: islandExtent(atlas) });

// Остров Кайо-Перико: сама карта острова, слой с его цветами и место на атласе
function useIslandKit(input) {
  const shown = useIslandMap(true, input.onLoadIsland);
  const pairs = useIslandPairs(shown, input.link);
  const ready = shown.status === "ready";
  const gfx = ready ? shown.gfx : null;
  const href = useIslandLayer(gfx, pairs);
  const place = useMemo(() => (ready ? islandPlace(input.atlas) : null), [ready, input.atlas]);
  return { shown, href, place };
}

export function useMapScene(input) {
  const { config, source, raster } = input;
  const rasterAddress = raster.baseRaster?.href ?? null;

  // Порядок вызовов задаёт порядок эффектов: замер текста, метки Majestic, подписи-меши
  const [textAdvance, majesticReady, meshReady] = [
    useTextAdvance(),
    useMajesticReady(input.tool === "majestic" || majesticMarksOn(config.majestic)),
    useLabelMeshes(config),
  ];
  const rasterBox = useRef({ href: rasterAddress });
  rasterBox.current.href = rasterAddress;

  const worldCtx = useMapContext({
    config,
    source,
    baseRaster: raster.baseRaster,
    assetUrls: input.assetUrls,
    textAdvance,
    majesticReady,
    meshReady,
  });
  const [gameScene, crowding] = useGameScene(config, worldCtx);
  const labels = useLabelTones(gameScene, rasterBox);
  const sceneContext = useMemo(
    () => Object.assign({}, worldCtx, { labelTones: labels.tones }),
    [worldCtx, labels.tones],
  );
  const windowKit = useWindowScene({
    config,
    sceneContext,
    view: input.view,
    fontStamp: input.fontStamp,
    rasterAddress,
  });
  const island = useIslandKit({
    onLoadIsland: input.onLoadIsland,
    atlas: source.atlas,
    link: { ...pull(source, ["processor", "baseStamp"]), config },
  });

  const { scene: windowScene, layoutKey } = windowKit;
  const stageScene = useMemo(
    () =>
      composeStageScene(windowScene, layoutKey, {
        detail: raster.detail,
        baseRaster: raster.baseRaster,
        pending: labels.waiting,
        place: island.place,
        islandHref: island.href,
      }),
    [windowScene, layoutKey, raster.detail, raster.baseRaster, labels.waiting, island.place, island.href],
  );

  return {
    gameScene,
    sceneContext,
    scene: windowScene,
    stageScene,
    crowding,
    textAdvance,
    majesticReady,
    labelsWaiting: labels.waiting.size > 0,
    island: island.shown,
  };
}
