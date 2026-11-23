/*
 * Схема помещения — плитки шаблонов и обложка «Интерьеров»: угол комнаты
 * (пол, две стены, потолок, стеллажи у дальней стены) цветами облика, блеск
 * пола — бликом и отражением стены в нём.
 *
 * Это схема работы, а не кадр из игры (правило поставки): листов Rockstar в
 * ней нет, у «Как в игре» — средний цвет листов поверхности.
 */

import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import { tr } from "../../../locales/ui.js";

/* Цвет поверхности на схеме: «Как в игре» — средний цвет её листов в игре. */
export function surfaceSwatch(surface, fallback) {
  if (!surface || surface.mode === "standard") return fallback;
  if (surface.mode === "colour" || surface.mode === "flat") return normalizeColourEffect(surface.look).colour;
  return fallback;
}

/* Средний цвет листов поверхности помещения в игре (по площади). */
export function stockSwatch(interior, surfaceId, fallback) {
  const sheets = interior?.surfaces?.[surfaceId] || [];
  if (!sheets.length) return fallback;
  let total = 0;
  const sum = [0, 0, 0];
  for (const sheet of sheets) {
    const value = parseInt(String(sheet.colour || fallback).slice(1), 16);
    const weight = Math.max(0.1, sheet.area || 1);
    sum[0] += ((value >> 16) & 255) * weight;
    sum[1] += ((value >> 8) & 255) * weight;
    sum[2] += (value & 255) * weight;
    total += weight;
  }
  return `#${sum.map((channel) => Math.round(channel / total).toString(16).padStart(2, "0")).join("")}`;
}

/* Чуть темнее или светлее — для боковой стены, тени и чистого листа. */
function shade(hex, factor) {
  const value = parseInt(String(hex).slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => Math.min(255, Math.round(channel * factor)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/* Чистая поверхность на схеме — чуть светлее, как и в игре (`shops-shine.js`, lift). */
const LIFT = Object.freeze({ game: 1, clean: 1.05, gloss: 1.08, mirror: 1.1 });
const swatchOf = (look, id, interior, fallback) => {
  const surface = look?.surfaces?.[id];
  return shade(surfaceSwatch(surface, stockSwatch(interior, id, fallback)), LIFT[surface?.shine] || 1);
};

/**
 * Схема угла комнаты: `look` — облик помещения, `interior` — опись помещения
 * (средние цвета «Как в игре»). `label` — имя для читалки экрана.
 */
export default function ShopRoomArt({ look, interior = null, label = "Схема помещения" }) {
  const walls = swatchOf(look, "walls", interior, "#c9c4b8");
  const floor = swatchOf(look, "floor", interior, "#8a8178");
  const ceiling = swatchOf(look, "ceiling", interior, "#e8e6e1");
  const shelvesSurface = look?.surfaces?.shelves?.mode === "colour" ? "shelves" : "counter";
  const shelves = look?.surfaces?.[shelvesSurface]?.mode === "colour" ? swatchOf(look, shelvesSurface, interior, "#d8d2c4") : shade(walls, 0.55);
  const shine = look?.surfaces?.floor?.shine || "game";
  const glossy = shine === "gloss" || shine === "mirror";
  const mirror = shine === "mirror";
  return (
    <svg className="shops-room-art" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${label}: ${tr("стены")} ${walls}, ${tr("пол")} ${floor}, ${tr("потолок")} ${ceiling}${glossy ? `, ${tr(mirror ? "пол зеркальный" : "пол глянцевый")}` : ""}`}>
      <polygon points="0,0 160,0 120,18 40,18" fill={ceiling} />
      <polygon points="40,18 120,18 120,70 40,70" fill={walls} />
      <polygon points="0,0 40,18 40,70 0,100" fill={shade(walls, 0.78)} />
      <polygon points="160,0 120,18 120,70 160,100" fill={shade(walls, 0.88)} />
      <polygon points="0,100 40,70 120,70 160,100" fill={floor} />
      {/* Зеркальный пол: дальняя стена и стеллажи отражаются в нём. */}
      {mirror && (
        <g opacity="0.32">
          <polygon points="40,70 120,70 132,79 28,79" fill={walls} />
          {[0, 1, 2].map((index) => (
            <rect key={index} x={52 + index * 22} y="70" width="14" height="7" rx="1" fill={shelves} />
          ))}
        </g>
      )}
      {/* Глянец: полоса блика по полу. */}
      {glossy && <polygon points="62,70 80,70 112,100 76,100" fill="#ffffff" opacity={mirror ? 0.3 : 0.2} />}
      {/* Вещи комнаты: стеллажи у дальней стены цветом полок (или прилавка). */}
      {[0, 1, 2].map((index) => (
        <rect key={index} x={52 + index * 22} y="44" width="14" height="24" rx="1" fill={shelves} opacity="0.9" />
      ))}
    </svg>
  );
}
