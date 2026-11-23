/*
 * Карта щитов в «Где стоят»: точки щитов на карте мира из вашей игры
 * (плитки большой карты установки — `loadMinimapField`, проекция атласа —
 * `@modovik/vector-map`). Найденные поиском — ярче, отмеченные в группу —
 * голубым, взятый щит — кольцом.
 * Щелчок по карте берёт ближайший щит; с клавиатуры щиты берут списком.
 *
 * Без игры под рукой (браузер, песочница) подложки нет — точки стоят на
 * тёмном поле, и подпись говорит об этом прямо.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { worldToMap } from "@modovik/vector-map";
import { BILLBOARD_SHIELD_IDS, billboard } from "@modovik/climb-contract/recolor/billboards";
import { fieldAligned } from "../../../components/desktop/workshop/blips/blips-scene.js";
import { loadMinimapField } from "../../../components/desktop/workshop/hud-preview/hud-map-field.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Холст карты в своих единицах: атлас 2 × 3 плитки — 1000 × 1500. */
const WIDTH = 1000;
const HEIGHT = 1500;
const PICK = 36;

const pointOf = (board) => {
  const { u, v } = worldToMap({ x: board.position[0], y: board.position[1] });
  return [u * WIDTH, v * HEIGHT];
};

export default function BillboardsMap({ found, picked = null, boardId, onSelect }) {
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
  /* Только щиты: полотна зданий — в «Баннерах на зданиях». */
  const points = useMemo(() => BILLBOARD_SHIELD_IDS.map((id) => ({ id, at: pointOf(billboard(id)) })), []);
  const shown = useMemo(() => new Set(found), [found]);
  const current = points.find((point) => point.id === boardId);

  function pick(event) {
    const svg = event.currentTarget;
    const box = svg.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = ((event.clientX - box.left) / box.width) * WIDTH;
    const y = ((event.clientY - box.top) / box.height) * HEIGHT;
    let best = null;
    for (const point of points) {
      if (!shown.has(point.id)) continue;
      const distance = Math.hypot(point.at[0] - x, point.at[1] - y);
      if (distance <= PICK && (!best || distance < best.distance)) best = { id: point.id, distance };
    }
    if (best) onSelect(best.id);
  }

  /* Откуда карта и что значат точки — подсказкой карты (`<title>`), не абзацем под ней (ТЗ 29.10.2026: происхождение — только в подсказке). */
  const legend = `${aligned ? tr("Карта — из вашей GTA V.") : field ? tr("Карта игры здесь не прочитана — точки щитов на тёмном поле.") : tr("Карта читается из вашей GTA V…")} ${
    picked?.size ? tr("Жёлтые — найденные, голубые — в группе, кольцо — щит в кадре.") : tr("Жёлтые — найденные, кольцо — щит в кадре.")
  }`;
  /* Размер и скругление — разметкой SVG, отступ — сеткой раздела: своих правил стилей у карты нет. */
  return (
    <>
      {/* Точки — не органы: щиты берут списком ниже, щелчок по карте — короткий путь мышью. */}
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" display="block" role="img" aria-label={`Карта щитов: найдено ${found.length}`} onClick={pick}>
        <title>{legend}</title>
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
          <circle
            key={point.id}
            cx={point.at[0]}
            cy={point.at[1]}
            r={shown.has(point.id) ? 9 : 5}
            fill={picked?.has(point.id) ? "#22d3ee" : shown.has(point.id) ? "#ffd166" : "#7c818c"}
            opacity={shown.has(point.id) ? 0.95 : 0.45}
          />
        ))}
        {current && <circle cx={current.at[0]} cy={current.at[1]} r="22" fill="none" stroke="#ffffff" strokeWidth="6" />}
      </svg>
    </>
  );
}
