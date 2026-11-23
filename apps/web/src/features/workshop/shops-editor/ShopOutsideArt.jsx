/*
 * Схема места снаружи — плитки шаблонов «снаружи» (второй заход задачи 3):
 * площадка, навес на колоннах, киоск с вывеской и две колонки (у магазина —
 * фасад с вывеской и крыльцо) цветами облика.
 *
 * Это схема работы, а не кадр из игры (правило поставки): листов Rockstar в
 * ней нет, у узора — его основной цвет, у картинки — серый с её подкраской.
 */

import { surfaceSwatch } from "./ShopRoomArt.jsx";
import { fill } from "./shops-text.js";
import { tr } from "../../../locales/ui.js";

/* Средний цвет листов части места в игре (по площади) или запасной. */
function stockPart(place, part, fallback) {
  const sheets = (place?.sheets || []).filter((sheet) => sheet.part === part);
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

function shade(hex, factor) {
  const value = parseInt(String(hex).slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => Math.round(channel * factor));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Схема места: `look` — облик частей, `pumps` — облик колонок (у заправки),
 * `place` — место описи (средние цвета «Стандарта»), `gas` — станция или фасад.
 */
export default function ShopOutsideArt({ look, pumps = null, place = null, gas = true, label = null }) {
  const walls = surfaceSwatch(look?.parts?.walls, stockPart(place, "walls", "#c9c4b8"));
  const roof = surfaceSwatch(look?.parts?.roof, stockPart(place, "roof", "#e8e6e1"));
  const ground = surfaceSwatch(look?.parts?.ground, stockPart(place, "ground", "#6f6a64"));
  const signs = surfaceSwatch(look?.parts?.signs, stockPart(place, "signs", "#d8141c"));
  const body = surfaceSwatch(pumps?.parts?.body, "#c9c4b8");
  const display = surfaceSwatch(pumps?.parts?.display, "#2f80ed");
  return (
    <svg className="shops-room-art" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" role="img" aria-label={fill(tr("{0}: стены {1}, навес {2}, площадка {3}, вывески {4}"), label || tr("Схема места"), walls, roof, ground, signs)}>
      <polygon points="0,100 30,62 130,62 160,100" fill={ground} />
      {gas ? (
        <>
          {/* Киоск в глубине, навес над колонками. */}
          <rect x="96" y="38" width="44" height="26" fill={walls} />
          <rect x="96" y="34" width="44" height="6" fill={signs} />
          <rect x="14" y="20" width="84" height="8" fill={roof} />
          <rect x="14" y="27" width="84" height="3" fill={signs} />
          <rect x="24" y="30" width="4" height="44" fill={shade(walls, 0.8)} />
          <rect x="84" y="30" width="4" height="44" fill={shade(walls, 0.8)} />
          {[40, 62].map((x) => (
            <g key={x}>
              <rect x={x} y="56" width="10" height="20" rx="1" fill={body} />
              <rect x={x + 1.5} y="58" width="7" height="5" fill={display} />
            </g>
          ))}
        </>
      ) : (
        <>
          {/* Фасад магазина: стена, вывеска над входом, крыша. */}
          <rect x="20" y="14" width="120" height="6" fill={roof} />
          <rect x="22" y="20" width="116" height="44" fill={walls} />
          <rect x="44" y="24" width="72" height="10" rx="1" fill={signs} />
          <rect x="66" y="40" width="28" height="24" fill={shade(walls, 0.45)} />
          <rect x="30" y="40" width="26" height="16" fill={shade(walls, 0.62)} />
          <rect x="104" y="40" width="26" height="16" fill={shade(walls, 0.62)} />
        </>
      )}
    </svg>
  );
}
