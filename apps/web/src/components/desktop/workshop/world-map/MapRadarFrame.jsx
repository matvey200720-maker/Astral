import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ATLAS, buildMapScene, buildRadarOverlay, radarPlan } from "@modovik/vector-map";
import { tr, useTr } from "../../../../locales/ui.js";
import RadarFrame, { RADAR_FRAME_ASPECT } from "./RadarFrame.jsx";
import useLabelMeshes from "./useLabelMeshes.js";
import { prepareRadarItems } from "../world-map-radar-render.js";

/*
 * Кадр мини-карты в редакторе большой карты (задача 28 ТЗ 19.10.2026).
 *
 * Показывает, что попадёт в угол экрана игры: кусок вашей карты в рамке радара
 * (191×136 — сцена minimap.gfx), а поверх — зоны и их границы теми самыми
 * треугольниками, которые Astral допишет в векторные плитки радара
 * (`radar-overlay.js`). Не рисунок «по мотивам»: это те же вершины, что уйдут в
 * файл для хоста, — поэтому видно и то, что на радар не попадёт (подписи,
 * значки, рисунок).
 *
 * Основа — подложка редактора одной картинкой: штатный вектор радара игра
 * красит в те же цвета, и у кадра с картой игрока они совпадают с точностью до
 * тона. Это постановка, не кадр из игры, и подпись под кадром так и говорит:
 * в игре радар поворачивается за камерой, на нём штатные значки и метки.
 */

/** Места для проверки: мировые X, Y центра кадра и сколько метров видно по ширине. */
export const RADAR_PLACES = Object.freeze([
  Object.freeze({ id: "city", name: "Город", x: 195, y: -935, metres: 700 }),
  Object.freeze({ id: "vinewood", name: "Вайнвуд", x: 330, y: 230, metres: 900 }),
  Object.freeze({ id: "sandy", name: "Сэнди-Шорс", x: 1860, y: 3690, metres: 900 }),
  Object.freeze({ id: "paleto", name: "Палето-Бэй", x: -150, y: 6420, metres: 900 }),
]);

/* Рамки фигур слоёв: считаются раз на набор слоёв, а не на каждый кадр. */
const PIECE_BOXES = new WeakMap();

function pieceBoxes(overlay) {
  let boxes = PIECE_BOXES.get(overlay);
  if (boxes) return boxes;
  const count = overlay.pieceIndexEnd.length;
  boxes = new Float32Array(count * 4);
  let vertexFrom = 0;
  for (let piece = 0; piece < count; piece += 1) {
    const vertexTo = overlay.pieceVertexEnd[piece];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let v = vertexFrom; v < vertexTo; v += 1) {
      x0 = Math.min(x0, overlay.x[v]);
      x1 = Math.max(x1, overlay.x[v]);
      y0 = Math.min(y0, overlay.y[v]);
      y1 = Math.max(y1, overlay.y[v]);
    }
    boxes.set([x0, y0, x1, y1], piece * 4);
    vertexFrom = vertexTo;
  }
  PIECE_BOXES.set(overlay, boxes);
  return boxes;
}

/**
 * Фигуры слоёв, которые видны в кадре, — в пикселях кадра.
 *
 * @param {object} overlay слои (`buildRadarOverlay`)
 * @param {{ x: number, y: number, metres: number }} place центр кадра в мировых координатах и ширина кадра в метрах
 * @param {{ width: number, height: number }} frame размер кадра в пикселях
 * @returns {{ points: Float32Array, z: number, rgba: number[] }[]} по фигуре — треугольники парами X, Y подряд (по три
 *   вершины), высота слоя и цвет RGBA; нижние слои — первыми, как рисует радар
 */
export function radarFrameShapes(overlay, place, frame) {
  if (!overlay?.triangleCount) return [];
  const scale = frame.width / place.metres;
  const halfWidth = place.metres / 2;
  const halfHeight = frame.height / scale / 2;
  const boxes = pieceBoxes(overlay);
  const shapes = [];
  let indexFrom = 0;
  for (let piece = 0; piece < overlay.pieceIndexEnd.length; piece += 1) {
    const indexTo = overlay.pieceIndexEnd[piece];
    const at = piece * 4;
    const seen =
      boxes[at] <= place.x + halfWidth &&
      boxes[at + 2] >= place.x - halfWidth &&
      boxes[at + 1] <= place.y + halfHeight &&
      boxes[at + 3] >= place.y - halfHeight;
    if (seen) {
      const points = new Float32Array((indexTo - indexFrom) * 2);
      for (let i = indexFrom; i < indexTo; i += 1) {
        const vertex = overlay.indices[i];
        points[(i - indexFrom) * 2] = (overlay.x[vertex] - place.x) * scale + frame.width / 2;
        points[(i - indexFrom) * 2 + 1] = (place.y - overlay.y[vertex]) * scale + frame.height / 2;
      }
      const first = overlay.indices[indexFrom];
      /* Картинка — сетка вершин с цветом: у такой фигуры цвет свой у каждого треугольника (среднее по вершинам). */
      let varied = false;
      for (let i = indexFrom + 1; i < indexTo && !varied; i += 1) {
        const vertex = overlay.indices[i];
        for (let channel = 0; channel < 4; channel += 1) if (overlay.rgba[vertex * 4 + channel] !== overlay.rgba[first * 4 + channel]) varied = true;
      }
      let triangleColours = null;
      if (varied) {
        triangleColours = new Uint8Array(((indexTo - indexFrom) / 3) * 4);
        for (let triangle = 0; triangle * 3 < indexTo - indexFrom; triangle += 1)
          for (let channel = 0; channel < 4; channel += 1) {
            let sum = 0;
            for (let corner = 0; corner < 3; corner += 1) sum += overlay.rgba[overlay.indices[indexFrom + triangle * 3 + corner] * 4 + channel];
            triangleColours[triangle * 4 + channel] = Math.round(sum / 3);
          }
      }
      shapes.push({
        points,
        z: overlay.z[first],
        rgba: [overlay.rgba[first * 4], overlay.rgba[first * 4 + 1], overlay.rgba[first * 4 + 2], overlay.rgba[first * 4 + 3]],
        ...(triangleColours ? { triangleColours } : null),
      });
    }
    indexFrom = indexTo;
  }
  /* Порядок рисования на радаре — высота: нижние первыми; при равной — порядок сцены. */
  return shapes.map((shape, at) => ({ shape, at })).sort((a, b) => a.shape.z - b.shape.z || a.at - b.at).map((item) => item.shape);
}

/** Окно мира, что видно в кадре (метры), с запасом на подпись у края. */
export function radarFrameView(place, margin = 40) {
  const halfWidth = place.metres / 2 + margin;
  const halfHeight = (place.metres * RADAR_FRAME_ASPECT) / 2 + margin;
  return { x0: place.x - halfWidth, y0: place.y - halfHeight, x1: place.x + halfWidth, y1: place.y + halfHeight };
}

/**
 * Слои проекта для кадра: те же функции, что у установки, — на сцене в размере экспорта. Подписи доноров считаются
 * только для окна кадра (`place`): весь набор — секунды работы, а кадр показывает кусок в километр.
 */
export function radarFrameOverlay(config, atlas, place = null, raster = null, scene = null) {
  return buildRadarOverlay(scene || buildMapScene(config, { atlas }), {
    tintAlpha: radarPlan(config).tint,
    markers: config.markers,
    ...(place ? { labels: { view: radarFrameView(place) } } : null),
    /* Свои надписи, значки и картинки (этап В): только те, что попали в окно кадра, — остальные не считаются. */
    ...(raster ? { items: { env: raster.env, textScale: radarPlan(config).textScale, ...(place ? { view: radarFrameView(place) } : null) } } : null),
  });
}

/**
 * Слои для кадра вместе с рисовальщиком окна: сцена строится раз, шрифты и картинки подгружаются до сборки. Рисовальщик
 * нужен, только если проект просит свои предметы на радаре (`radarPlan(config).items`).
 */
export async function radarFrameOverlayAsync(config, atlas, place = null) {
  const scene = buildMapScene(config, { atlas });
  const raster = radarPlan(config).items ? await prepareRadarItems(scene) : null;
  try {
    return radarFrameOverlay(config, atlas, place, raster, scene);
  } finally {
    for (const image of raster?.images.values() || []) image.close?.();
  }
}

const FRAME_WIDTH = 480;

/**
 * Кадр мини-карты: основа — картинка карты, поверх — зоны треугольниками.
 *
 * @param {object} props
 * @param {object} props.config проект карты
 * @param {string|null} props.image подложка редактора одной картинкой
 * @param {object|null} props.atlas раскладка атласа
 * @param {boolean} props.layers рисовать ли зоны (`radar.layers`)
 */
export function MapRadarFrame({ config, image = null, atlas = null, layers = true }) {
  useTr();
  const layout = atlas || DEFAULT_ATLAS;
  const [placeId, setPlaceId] = useState(RADAR_PLACES[0].id);
  const place = RADAR_PLACES.find((item) => item.id === placeId) || RADAR_PLACES[0];
  /* Наборы подписей донора подгружаются, пока стоят на карте; кадр пересобирается, как только набор приехал. */
  const meshVersion = useLabelMeshes(config);
  /*
   * Слои зависят только от зон, подписей, рисунка и раскладки — не от каждого движения ползунка. Считаются
   * с передышкой для кадров: большой набор подписей — секунда работы, и окно не должно вставать на ней.
   */
  const [overlay, setOverlay] = useState(null);
  useEffect(() => {
    if (!layers) {
      setOverlay(null);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      radarFrameOverlayAsync(config, layout, place).then(
        (next) => alive && setOverlay(next),
        () => alive && setOverlay(null),
      );
    }, 40);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, config.zones, config.markers, config.paint, config.emblems, config.radar?.tint, config.radar?.items, config.radar?.textScale, layout, meshVersion, place]);
  const shapes = useMemo(
    () => radarFrameShapes(overlay, place, { width: FRAME_WIDTH, height: Math.round(FRAME_WIDTH * RADAR_FRAME_ASPECT) }),
    [overlay, place],
  );
  return (
    <RadarFrame
      image={image}
      atlas={layout}
      place={place}
      shapes={shapes}
      canvasLabel={tr("Мини-карта в углу экрана")}
      places={RADAR_PLACES}
      placeId={place.id}
      onPlace={setPlaceId}
      placesLabel={tr("Где посмотреть мини-карту")}
      placeTitle={tr}
      caption={
        radarPlan(config).items
          ? tr("Кусок вашей карты в рамке мини-карты, а поверх — те самые треугольники зон, надписей, значков и картинок, которые Astral допишет в плитки радара. В игре заливка зон лежит под дорогами мини-карты, а границы, надписи и значки — над ними; мини-карта поворачивается за камерой, а штатные значки и метки остаются поверх.")
          : tr("Кусок вашей карты в рамке мини-карты, а поверх — те самые треугольники зон, которые Astral допишет в плитки радара. В игре заливка зон лежит под дорогами мини-карты, а границы — над ними; мини-карта поворачивается за камерой, а штатные значки и метки остаются поверх.")
      }
    />
  );
}
