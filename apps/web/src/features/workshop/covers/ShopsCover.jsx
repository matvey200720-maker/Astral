import { useCallback, useMemo, useState } from "react";
import {
  changedShopInteriors,
  copyShopLook,
  createShopsProject,
  normalizeShopsProject,
  shopInterior,
  shopLookOf,
  shopLookIsStock,
} from "@modovik/climb-contract/recolor/shops";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import { loadSceneAsset } from "../model-stage/scene-asset.js";
import { stockSwatch, surfaceSwatch } from "../shops-editor/ShopRoomArt.jsx";
import { shopSceneSource } from "../shops-editor/shop-scene-source.js";
import { shopFrameLook, visibleParts } from "../shops-editor/shops-text.js";
import { parseCoverState } from "./cover-data.js";

/*
 * Обложка «Интерьеров» (задача 3 ТЗ 11.10.2026, утро: «просто покажи
 * магазин 24/7 и объедини их») — одна обложка на весь редактор: зал 24/7.
 *
 * В окне Astral — настоящий зал: сцену собирает Astral Desktop из игры
 * игрока (`shop-scene-source.js`, та же, что в кадре редактора), снимок —
 * общим невидимым кадром с глаза зала и из хранилища обложек. В браузере
 * без приложения сцены нет — тогда схема зала 24/7 (стеллажи, холодильники,
 * прилавок) цветами работы: листов Rockstar в поставке нет.
 *
 * Работа: облик 24/7, а если 24/7 как в игре, а изменено другое помещение,
 * — его поверхности на зале 24/7 (облик переносится, как кнопкой «на все
 * помещения раздела»: стены, пол, потолок, прилавок, полки, мебель и
 * убранные группы).
 */

export const SHOP_COVER_INTERIOR = "shop247";
/* Версия снимка: поменялась рамка или сборка сцены — старые снимки не находятся. */
const COVER_FRAME = 1;

/** Облик зала 24/7 на обложке. */
export function shopCoverLook(input) {
  const project = normalizeShopsProject(input);
  const own = project.interiors[SHOP_COVER_INTERIOR];
  if (!shopLookIsStock(own)) return own;
  const first = changedShopInteriors(project).find((id) => id !== SHOP_COVER_INTERIOR);
  return first ? shopLookOf(copyShopLook(project, first, [SHOP_COVER_INTERIOR]), SHOP_COVER_INTERIOR) : own;
}

/* Чуть темнее — для боковой стены, тени и рёбер. */
function shade(hex, factor) {
  const value = parseInt(String(hex).slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => Math.min(255, Math.round(channel * factor)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/*
 * Схема зала 24/7 — прямой взгляд от входа: потолок со светильниками,
 * холодильники у дальней стены, два ряда стеллажей, прилавок с кассой
 * справа. Цвета — облик работы (стандарт — средний цвет листов игры);
 * убранные группы на схеме тоже убраны.
 */
export function ShopStoreArt({ look, interior = null }) {
  const colour = (id, fallback) => surfaceSwatch(look?.surfaces?.[id], stockSwatch(interior, id, fallback));
  const walls = colour("walls", "#c9c4b8");
  const floor = colour("floor", "#8a8178");
  const ceiling = colour("ceiling", "#e8e6e1");
  const counter = colour("counter", "#a07850");
  const shelves = colour("shelves", "#d8d2c4");
  const hidden = new Set(look?.hidden || []);
  const goods = ["#d9534f", "#f0ad4e", "#5bc0de", "#5cb85c", "#f7f7f7"];
  return (
    <svg viewBox="0 0 160 100" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Интерьеры: зал 24/7 в облике работы: стены ${walls}, пол ${floor}`}>
      {/* Потолок, стены, пол — коридор с точкой схода в середине. */}
      <polygon points="0,0 160,0 112,30 48,30" fill={ceiling} />
      <polygon points="48,30 112,30 112,62 48,62" fill={walls} />
      <polygon points="0,0 48,30 48,62 0,100" fill={shade(walls, 0.8)} />
      <polygon points="160,0 112,30 112,62 160,100" fill={shade(walls, 0.9)} />
      <polygon points="0,100 48,62 112,62 160,100" fill={floor} />
      <g stroke={shade(floor, 0.78)} strokeWidth="0.5">
        <line x1="24" y1="81" x2="136" y2="81" />
        <line x1="38" y1="70" x2="122" y2="70" />
        <line x1="80" y1="62" x2="80" y2="100" />
        <line x1="64" y1="62" x2="40" y2="100" />
        <line x1="96" y1="62" x2="120" y2="100" />
      </g>
      {/* Светильники на потолке. */}
      {!hidden.has("lights") && (
        <g fill="#fffbe6" opacity="0.9">
          <polygon points="58,22 102,22 98,25 62,25" />
          <polygon points="40,10 120,10 113,15 47,15" />
        </g>
      )}
      {/* Холодильники у дальней стены: стёкла со светом. */}
      {!hidden.has("fridges") && (
        <g>
          <rect x="50" y="36" width="60" height="24" fill={shade(walls, 0.45)} />
          {[0, 1, 2, 3, 4].map((index) => (
            <rect key={index} x={51.5 + index * 11.8} y="37.5" width="10.2" height="21" fill="#bfe6f5" opacity="0.55" />
          ))}
        </g>
      )}
      {/* Два ряда стеллажей с товаром — боком к проходу посередине. */}
      {!hidden.has("shelves") &&
        [
          [14, 50],
          [100, 78],
        ].map(([near, far]) => (
          <g key={near}>
            <polygon points={`${near},92 ${near},68 ${far},49 ${far},64`} fill={shelves} />
            <polygon points={`${near},68 ${near + (near < far ? 4 : -4)},66 ${far + (near < far ? 1.5 : -1.5)},48.4 ${far},49`} fill={shade(shelves, 1.12)} />
            {[0.22, 0.5, 0.78].map((share) => {
              const nearY = 92 - share * 24;
              const farY = 64 - share * 15;
              return (
                <g key={share}>
                  <polygon points={`${near},${nearY} ${near},${nearY - 3.4} ${far},${farY - 1.7} ${far},${farY}`} fill={shade(shelves, 0.62)} />
                  {goods.map((tone, item) => {
                    const t = (item + 0.5) / goods.length;
                    const x = near + (far - near) * t;
                    const y = nearY + (farY - nearY) * t;
                    const size = 3.2 - t * 1.6;
                    return <rect key={tone} x={x - size / 2} y={y - size * 0.95} width={size * 0.8} height={size * 0.85} fill={tone} opacity="0.9" />;
                  })}
                </g>
              );
            })}
          </g>
        ))}
      {/* Прилавок и касса справа у входа. */}
      <polygon points="122,74 160,66 160,100 126,100" fill={counter} />
      <polygon points="122,74 160,66 160,62 120,70" fill={shade(counter, 1.15)} />
      <rect x="138" y="58" width="9" height="7" rx="1" fill="#2a2d33" />
      <rect x="139.5" y="59.2" width="6" height="3.6" fill="#7fd1ff" opacity="0.8" />
    </svg>
  );
}

export default function ShopsCover({ state = null }) {
  const { look, project } = useMemo(() => {
    const stored = parseCoverState(state);
    const normal = stored ? normalizeShopsProject(stored) : createShopsProject();
    const cover = shopCoverLook(normal);
    /* Работа обложки: зал 24/7 в её облике — для частей кадра (убранные вещи). */
    return { look: cover, project: { ...normal, interiors: { ...normal.interiors, [SHOP_COVER_INTERIOR]: cover } } };
  }, [state]);
  const interior = shopInterior(SHOP_COVER_INTERIOR);
  /* Снимок нарисован — схема под ним не нужна; снимка нет (браузер, игра не подключена) — схема. */
  const [drawn, setDrawn] = useState(false);
  const lookKey = useMemo(
    () => JSON.stringify([COVER_FRAME, look.surfaces, look.hidden, look.removed]),
    [look],
  );

  /* Сцена зала — от Astral Desktop и только когда снимка ещё нет: сборка — доли секунды, но в главном процессе. */
  const prepare = useCallback(async () => {
    const source = await shopSceneSource(SHOP_COVER_INTERIOR);
    if (!source?.url) return null;
    const asset = await loadSceneAsset(source.url).catch(() => null);
    if (!asset) return null;
    /* Изнутри — только цвет и блеск (ТЗ 12.10.2026): своих текстур отделки у помещений нет. */
    return {
      url: source.url,
      parts: visibleParts(asset, project, SHOP_COVER_INTERIOR),
      look: (index, info) => shopFrameLook(look, info),
    };
  }, [look, project]);
  const frame = useCallback(
    (asset) => ({
      bounds: asset.bounds,
      ground: false,
      inside: { ...(interior?.eye || { eye: [0, 0, 1.65], yaw: 0, pitch: 0 }), fov: 72 },
      lighting: "interior",
    }),
    [interior],
  );

  return (
    <>
      {!drawn && (
        <span className="workshop-cover-canvas">
          <ShopStoreArt look={look} interior={interior} />
        </span>
      )}
      <span className="workshop-cover-canvas">
        <SceneThumb sceneKey={`shops:${SHOP_COVER_INTERIOR}`} look={plainLook} lookKey={lookKey} frame={frame} prepare={prepare} onResult={setDrawn} />
      </span>
    </>
  );
}

const plainLook = (index, info) => ({ colour: info.colour });
