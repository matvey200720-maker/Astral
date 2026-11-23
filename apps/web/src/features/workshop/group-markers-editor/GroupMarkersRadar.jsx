/*
 * Кадр накладок радара (доделка 21, 19.10.2026): накладка — не метка в мире, а значок, который игра ставит поверх
 * метки бизнеса на мини-карте и карте паузы, поэтому её показывает не улица с «62 м», а мини-карта — тот же кадр
 * радара, что у редактора «Большая карта» (`RadarFrame`, общий с 19.10 — этап В задачи 28), с блипом бизнеса и накладкой
 * поверх куска карты.
 *
 * Что здесь из игры, а что нарисовано: накладка — рисунок листа значков из вашей игры (`minimap.ytd`) или ваша правка;
 * карта радара и блип бизнеса нарисованы Astral для примера — подпись кадра говорит об этом. Положение накладки на
 * значке примерное: игра ставит её программой Scaleform, и точного места файлы не называют. Гифка играет кадрами по
 * своим задержкам, как в игре.
 *
 * Кадр — вся мини-карта 191×136 точек (`MINIMAP_SCENE`), радар 179×115 в точке (6, 8) (`MINIMAP_RADAR`): блип и
 * накладка ставятся в долях сцены, поэтому кадр держит вид при любой ширине окна.
 */

import { useEffect, useRef } from "react";
import { DEFAULT_ATLAS } from "@modovik/vector-map";
import { MINIMAP_RADAR, MINIMAP_SCENE } from "@modovik/minimap-contract";
import RadarFrame from "../../../components/desktop/workshop/world-map/RadarFrame.jsx";
import { RADAR_PLACES } from "../../../components/desktop/workshop/world-map/MapRadarFrame.jsx";
import BlipArt from "../../../components/desktop/workshop/blips/BlipArt.jsx";
import { workshopFallbackMediaBySlot } from "../../../workshop-visuals.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Где на радаре стоит блип: в долях радара — правее и выше середины, где радар виден лучше всего. */
const BLIP_AT = Object.freeze({ x: 0.64, y: 0.36 });
/* Сторона блипа в точках сцены (кружок человека у «Мини-карты» — 13) и размер накладки по нему: точка листа значков → точка сцены. */
const BLIP_SIDE = 14;
const OVERLAY_UNIT = BLIP_SIDE / 16;
/* Накладка садится на значок с уходом к верхнему правому углу: видно и её, и значок под ней. */
const OVERLAY_SHIFT = 0.32;
/* Блип бизнеса — светлая плашка с силуэтом магазина: нарисована окном (листа блипа из игры в поставке нет). */
const BLIP_STYLE = Object.freeze({ shape: "square", glyph: "store", color: "#f0f0f0", outline: 4, outlineColor: "#000000", opacity: 100 });

/* Карта под радаром — та же картинка большой карты, что у кадра редактора «Большая карта», и то же место — город. */
const MAP_IMAGE = workshopFallbackMediaBySlot["large-map"]?.[0] || "";
const MAP_PLACE = RADAR_PLACES[0];

const percentOf = (value, whole) => `${((value / whole) * 100).toFixed(3)}%`;

/** Накладка: кадры гифки сменяются по задержкам; один кадр — просто стоит. */
function RadarOverlay({ canvases, delays, style }) {
  const ref = useRef(null);
  useEffect(() => {
    const target = ref.current;
    const first = canvases[0];
    if (!target || !first) return undefined;
    const context = target.getContext?.("2d");
    if (!context) return undefined;
    target.width = first.width;
    target.height = first.height;
    let index = 0;
    let timer = 0;
    const draw = () => {
      context.clearRect(0, 0, target.width, target.height);
      context.drawImage(canvases[index], 0, 0, target.width, target.height);
    };
    const step = () => {
      draw();
      if (canvases.length < 2) return;
      timer = window.setTimeout(() => {
        index = (index + 1) % canvases.length;
        step();
      }, Math.max(20, delays[index] || 100));
    };
    step();
    return () => window.clearTimeout(timer);
  }, [canvases, delays]);
  return <canvas ref={ref} className="group-markers-radar-overlay" style={style} aria-hidden="true" />;
}

/**
 * @param {object} props
 * @param {HTMLCanvasElement[]} props.canvases Кадры накладки (один — неподвижная).
 * @param {number[]} props.delays Задержки кадров, мс.
 * @param {{width: number, height: number}|null} props.box Габарит штатной накладки (точки листа значков).
 * @param {boolean} props.hidden Накладка убрана: на блипе её нет.
 */
export default function GroupMarkersRadar({ canvases = [], delays = [], box = null, hidden = false }) {
  useTr();
  const centre = {
    x: MINIMAP_RADAR.x + MINIMAP_RADAR.width * BLIP_AT.x,
    y: MINIMAP_RADAR.y + MINIMAP_RADAR.height * BLIP_AT.y,
  };
  const overlayWidth = (box?.width || 16) * OVERLAY_UNIT;
  const overlayHeight = (box?.height || 16) * OVERLAY_UNIT;
  const at = (x, y) => ({ left: percentOf(x, MINIMAP_SCENE.width), top: percentOf(y, MINIMAP_SCENE.height) });
  return (
    <div className="group-markers-radar-frame">
      <div className="group-markers-radar" role="img" aria-label={tr("Мини-карта GTA V: значок бизнеса и накладка радара на нём")}>
        <RadarFrame image={MAP_IMAGE} atlas={DEFAULT_ATLAS} place={MAP_PLACE} player={false}>
          <span className="group-markers-radar-blip" style={{ ...at(centre.x, centre.y), width: percentOf(BLIP_SIDE, MINIMAP_SCENE.width) }}>
            <BlipArt style={BLIP_STYLE} size={24} />
          </span>
          {!hidden && canvases.length > 0 && (
            <RadarOverlay
              canvases={canvases}
              delays={delays}
              style={{
                ...at(centre.x + BLIP_SIDE * OVERLAY_SHIFT, centre.y - BLIP_SIDE * OVERLAY_SHIFT),
                width: percentOf(overlayWidth, MINIMAP_SCENE.width),
                height: percentOf(overlayHeight, MINIMAP_SCENE.height),
              }}
            />
          )}
        </RadarFrame>
      </div>
    </div>
  );
}
