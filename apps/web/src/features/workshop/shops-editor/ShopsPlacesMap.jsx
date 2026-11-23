/*
 * Карта мест помещения (задача 5 ТЗ 11.10.2026, инструмент «Помещение»):
 * экземпляры помещения точками на карте мира из вашей игры (плитки большой
 * карты установки — `loadMinimapField`, проекция атласа —
 * `@modovik/vector-map`), как «Где стоят» у билбордов; взятое место —
 * кольцом. Щелчок по карте берёт ближайшее место; с клавиатуры места берут
 * списком. Те же точки — места снаружи (заправки, фасады, 17.10.2026): место
 * со своим обликом (`own`) — ярче.
 *
 * Без игры под рукой (браузер, песочница) подложки нет — точки стоят на
 * тёмном поле, и подсказка говорит об этом прямо.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { worldToMap } from "@modovik/vector-map";
import { fieldAligned } from "../../../components/desktop/workshop/blips/blips-scene.js";
import { loadMinimapField } from "../../../components/desktop/workshop/hud-preview/hud-map-field.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

/* Холст карты в своих единицах: атлас 2 × 3 плитки — 1000 × 1500. */
const WIDTH = 1000;
const HEIGHT = 1500;
const PICK = 48;

const pointOf = (place) => {
  const { u, v } = worldToMap({ x: place.position[0], y: place.position[1] });
  return [u * WIDTH, v * HEIGHT];
};

export default function ShopsPlacesMap({ places, placeId, own = [], onSelect, legend }) {
  useTr();
  const clip = useId().replace(/:/g, "");
  const [field, setField] = useState(null);
  useEffect(() => {
    let alive = true;
    let made = null;
    loadMinimapField({ tile: 256 })
      .then((loaded) => {
        if (!alive) {
          loaded?.revoke?.();
          return;
        }
        made = loaded;
        setField(loaded);
      })
      .catch(() => alive && setField({ source: "fallback" }));
    return () => {
      alive = false;
      made?.revoke?.();
    };
  }, []);
  const aligned = fieldAligned(field);
  const points = useMemo(() => places.map((place) => ({ id: place.id, at: pointOf(place) })), [places]);
  const current = points.find((point) => point.id === placeId);
  const marked = useMemo(() => new Set(own), [own]);

  function pick(event) {
    const svg = event.currentTarget;
    const box = svg.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = ((event.clientX - box.left) / box.width) * WIDTH;
    const y = ((event.clientY - box.top) / box.height) * HEIGHT;
    let best = null;
    for (const point of points) {
      const distance = Math.hypot(point.at[0] - x, point.at[1] - y);
      if (distance <= PICK && (!best || distance < best.distance)) best = { id: point.id, distance };
    }
    if (best) onSelect(best.id);
  }

  /* Размер и скругление — разметкой SVG, отступ — сеткой раздела: своих правил стилей у карты нет. */
  return (
    <>
      {/* Точки — не органы: места берут списком ниже, щелчок по карте — короткий путь мышью. */}
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" display="block" role="img" aria-label={trFill("Карта мест: {0}", places.length)} onClick={pick}>
        {/* Откуда карта, читается ли она и что значат точки — подсказкой при наведении, а не абзацем (слово владельца 29.10.2026). */}
        <title>
          {[aligned ? tr("Карта — из вашей GTA V.") : field ? tr("Карта игры здесь не прочитана — точки мест на тёмном поле.") : tr("Карта читается из вашей GTA V…"), legend].filter(Boolean).join(" ")}
        </title>
        <defs>
          <clipPath id={`${clip}-c`}>
            <rect width={WIDTH} height={HEIGHT} rx="36" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip}-c)`}>
          <rect width={WIDTH} height={HEIGHT} fill="#101114" />
          {aligned && <image href={field.url} width={WIDTH} height={HEIGHT} preserveAspectRatio="none" opacity="0.75" />}
        </g>
        {points.map((point) => (
          <circle key={point.id} cx={point.at[0]} cy={point.at[1]} r={marked.has(point.id) ? 14 : 10} fill={marked.has(point.id) ? "#ffd166" : "#9aa3b2"} opacity="0.95" />
        ))}
        {current && <circle cx={current.at[0]} cy={current.at[1]} r="26" fill="none" stroke="#ffffff" strokeWidth="6" />}
      </svg>
    </>
  );
}
