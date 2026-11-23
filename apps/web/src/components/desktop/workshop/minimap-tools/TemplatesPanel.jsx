import { useMemo } from "react";
import { MINIMAP_RADAR, MINIMAP_SCENE } from "@modovik/minimap-contract";
import { minimapGpsLine } from "@modovik/minimap-contract/gps-marker";
import ChoiceTile from "../../../ui/ChoiceTile.jsx";
import PresetShelf from "../../../ui/PresetShelf.jsx";
import MinimapPreview from "../MinimapPreview.jsx";
import { MINIMAP_TEMPLATES, applyMinimapTemplate, matchingMinimapTemplate } from "./minimap-templates.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * «Шаблоны» мини-карты (задача 1 ТЗ 11.10.2026, утро): готовые мини-карты
 * плитками с картинкой самой мини-карты — полосы, цвета, цифры, рамка, метка
 * GPS и линия маршрута. Облик считает `minimap-templates.js`.
 */

/* Путь от стрелки игрока к метке по радару — в точках сцены 191×136. */
const CENTRE = { x: MINIMAP_RADAR.x + MINIMAP_RADAR.width / 2, y: MINIMAP_RADAR.y + MINIMAP_RADAR.height / 2 };
const ROUTE = [
  [CENTRE.x, CENTRE.y],
  [CENTRE.x + 22, CENTRE.y],
  [CENTRE.x + 22, CENTRE.y - 28],
  [CENTRE.x + 58, CENTRE.y - 28],
];
/* Линия игры на радаре — около 3 точек сцены при ×1. */
const ROUTE_WIDTH = 3;

function TemplateArt({ config }) {
  const line = minimapGpsLine(config.gps);
  const { marker } = config.gps;
  const width = ROUTE_WIDTH * line.width;
  const [endX, endY] = ROUTE.at(-1);
  const markerSize = 9 * marker.size;
  return (
    <span className="mmc-template-art" style={{ position: "relative", display: "block", width: "100%", height: "100%" }}>
      <MinimapPreview config={config} compact still label="" />
      <svg
        viewBox={`0 0 ${MINIMAP_SCENE.width} ${MINIMAP_SCENE.height}`}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        aria-hidden="true"
      >
        <polyline
          points={ROUTE.map((point) => point.join(",")).join(" ")}
          fill="none"
          stroke={line.colour || marker.color}
          strokeOpacity={line.opacity}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={line.pattern ? line.pattern.map((value) => value * width).join(" ") : undefined}
        />
        <rect
          x={endX - markerSize / 2}
          y={endY - markerSize / 2}
          width={markerSize}
          height={markerSize}
          rx={markerSize / 4}
          fill={marker.color}
          fillOpacity={marker.opacity}
          stroke="#000000"
          strokeOpacity={marker.opacity}
          strokeWidth="1"
        />
      </svg>
    </span>
  );
}

export default function TemplatesPanel({ config, onTemplate }) {
  useTr();
  const looks = useMemo(
    () => MINIMAP_TEMPLATES.map((template) => ({ template, config: applyMinimapTemplate(config, template) })),
    [config],
  );
  const matching = useMemo(() => matchingMinimapTemplate(config), [config]);
  return (
    <>
      <PresetShelf
        title={tr("Готовые мини-карты")}
        label={tr("Готовые мини-карты")}
        count={MINIMAP_TEMPLATES.length}
        collapsible={false}
        gridClassName="mmc-structures"
      >
        {looks.map(({ template, config: look }) => (
          <ChoiceTile
            key={template.id}
            media={<TemplateArt config={look} />}
            title={template.label}
            description={template.note}
            selected={matching === template.id}
            data-template={template.id}
            onClick={() => onTemplate(template)}
          />
        ))}
      </PresetShelf>
      <p className="mmc-section-hint">
        {tr("Шаблон меняет облик целиком: где и каких цветов полосы HP и брони, цифры, рамку карты, метку GPS и линию маршрута. Место карты на экране, дальность обзора, свои значки HP и брони, урон и точность маршрута остаются вашими. Дальше любой инструмент правит шаблон.")}
      </p>
      <p className="mmc-section-hint">
        {tr("На плитках — схема на картинке-примере, а не кадр игры: в игре под полосами будет мини-карта самой GTA V.")}
      </p>
    </>
  );
}
