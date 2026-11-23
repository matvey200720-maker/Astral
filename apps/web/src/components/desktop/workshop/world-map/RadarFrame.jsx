import { useEffect, useRef, useState } from "react";
import { atlasSize, worldToMap } from "@modovik/vector-map";
import ChoiceRadioGroup from "../../../ui/ChoiceRadioGroup.jsx";
import "./radar-frame.css";

/*
 * Кадр мини-карты — общий для редакторов (этап В задачи 28 ТЗ 19.10.2026).
 *
 * Мини-карта в углу экрана игры — рамка 191×136 (сцена minimap.gfx) с куском карты. Её показывают два редактора:
 * «Большая карта» (кусок вашей карты и поверх него зоны, надписи и значки треугольниками, `MapRadarFrame.jsx`) и
 * «Групповые метки» (накладка на блипе бизнеса, `GroupMarkersRadar.jsx`). Кадр у обоих один: канва с куском картинки
 * карты и фигурами поверх, рамка нужной пропорции, точка игрока и свои вещи поверх канвы (`children`, положение — в долях
 * кадра, ставит вызывающий).
 *
 * Постановка, не кадр из игры: подпись под кадром говорит об этом (`caption`) — что в кадре настоящее и что нарисовано,
 * решает хозяин кадра.
 */

export const RADAR_FRAME_ASPECT = 136 / 191;
const FRAME_WIDTH = 480;

function paintFrame(canvas, image, atlas, place, shapes) {
  const height = Math.round(FRAME_WIDTH * RADAR_FRAME_ASPECT);
  canvas.width = FRAME_WIDTH;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, FRAME_WIDTH, height);
  if (image) {
    const size = atlasSize(atlas);
    const centre = worldToMap({ x: place.x, y: place.y }, atlas);
    const wide = place.metres / size.width;
    const tall = (place.metres * RADAR_FRAME_ASPECT) / size.height;
    const sx = (centre.u - wide / 2) * image.naturalWidth;
    const sy = (centre.v - tall / 2) * image.naturalHeight;
    context.drawImage(image, sx, sy, wide * image.naturalWidth, tall * image.naturalHeight, 0, 0, FRAME_WIDTH, height);
  }
  for (const shape of shapes) {
    if (shape.triangleColours) {
      /* Сетка цвета (картинка): треугольники одного цвета (с точностью до пяти бит) — одной заливкой, иначе кадр считал бы их по одному. */
      const groups = new Map();
      const { points, triangleColours } = shape;
      for (let triangle = 0; triangle * 6 < points.length; triangle += 1) {
        const at = triangle * 4;
        const key = ((triangleColours[at] >> 3) << 15) | ((triangleColours[at + 1] >> 3) << 10) | ((triangleColours[at + 2] >> 3) << 5) | (triangleColours[at + 3] >> 3);
        let group = groups.get(key);
        if (!group) groups.set(key, (group = { path: new Path2D(), colour: [triangleColours[at], triangleColours[at + 1], triangleColours[at + 2], triangleColours[at + 3]] }));
        const p = triangle * 6;
        group.path.moveTo(points[p], points[p + 1]);
        group.path.lineTo(points[p + 2], points[p + 3]);
        group.path.lineTo(points[p + 4], points[p + 5]);
        group.path.closePath();
      }
      for (const { path, colour } of groups.values()) {
        context.fillStyle = `rgba(${colour[0]},${colour[1]},${colour[2]},${(colour[3] / 255).toFixed(3)})`;
        context.fill(path);
      }
      continue;
    }
    const [r, g, b, a] = shape.rgba;
    context.fillStyle = `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
    context.beginPath();
    const { points } = shape;
    for (let at = 0; at + 5 < points.length; at += 6) {
      context.moveTo(points[at], points[at + 1]);
      context.lineTo(points[at + 2], points[at + 3]);
      context.lineTo(points[at + 4], points[at + 5]);
      context.closePath();
    }
    context.fill();
  }
}

/** Картинка по адресу; `null`, пока не пришла или адреса нет. */
function useFrameImage(href) {
  const [picture, setPicture] = useState(null);
  useEffect(() => {
    if (!href) {
      setPicture(null);
      return undefined;
    }
    let alive = true;
    const next = new Image();
    next.onload = () => alive && setPicture(next);
    next.onerror = () => alive && setPicture(null);
    next.src = href;
    return () => {
      alive = false;
    };
  }, [href]);
  return picture;
}

/**
 * Кадр мини-карты.
 *
 * @param {object} props
 * @param {string|null} props.image картинка карты одним файлом (подложка редактора)
 * @param {object} props.atlas раскладка атласа картинки
 * @param {{ x: number, y: number, metres: number }} props.place центр кадра в мировых метрах и ширина кадра в метрах
 * @param {{ points: Float32Array, rgba: number[], triangleColours?: Uint8Array }[]} [props.shapes] фигуры поверх картинки,
 *   треугольники в пикселях кадра (`radarFrameShapes`)
 * @param {string} [props.canvasLabel] имя канвы для читалки экрана; пусто — канва декоративная
 * @param {{ id: string, name: string }[]} [props.places] места для проверки — выбор над кадром; без них выбора нет
 * @param {string} [props.placeId] выбранное место
 * @param {(id: string) => void} [props.onPlace]
 * @param {string} [props.placesLabel] имя выбора мест
 * @param {(name: string) => string} [props.placeTitle] подпись места (перевод)
 * @param {boolean} [props.player] точка игрока посередине
 * @param {import("react").ReactNode} [props.caption] подпись под кадром
 * @param {string} [props.className]
 * @param {import("react").ReactNode} [props.children] свои вещи поверх канвы: стоят в долях кадра, ставит вызывающий
 */
export default function RadarFrame({
  image = null,
  atlas,
  place,
  shapes = [],
  canvasLabel = "",
  places = null,
  placeId = "",
  onPlace = () => {},
  placesLabel = "",
  placeTitle = (name) => name,
  player = true,
  caption = null,
  className = "",
  children = null,
}) {
  const canvasRef = useRef(null);
  const picture = useFrameImage(image);
  useEffect(() => {
    if (canvasRef.current) paintFrame(canvasRef.current, picture, atlas, place, shapes);
  }, [picture, atlas, place, shapes]);
  return (
    <figure className={`wmc-radar-preview${className ? ` ${className}` : ""}`}>
      {places && (
        <ChoiceRadioGroup
          label={placesLabel}
          value={placeId}
          options={places.map((item) => ({ value: item.id, title: placeTitle(item.name) }))}
          onChange={onPlace}
          className="wmc-radar-places"
        />
      )}
      <div className="wmc-radar-screen">
        <canvas ref={canvasRef} className="wmc-radar-canvas" aria-label={canvasLabel || undefined} aria-hidden={canvasLabel ? undefined : "true"} />
        {player && <span className="wmc-radar-player" aria-hidden="true" />}
        {children}
      </div>
      {caption && <figcaption className="wmc-hint">{caption}</figcaption>}
    </figure>
  );
}
