import { useId, useMemo } from "react";
import { createMajesticInteriors, normalizeMajesticInteriors } from "@modovik/climb-contract/recolor/majestic-interiors-project";
import { parseCoverState } from "./cover-data.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Обложка «Интерьеров Majestic RP» (Хелпер 7, 25.10.2026): схема угла зала казино цветами работы — стены, ковёр, потолок, золото
 * отделки и лампа подсветки. Это схема, а не кадр из игры: файлы казино лежат у игрока, и снимка в поставке нет — подпись
 * на самой обложке говорит об этом прямо (правило поставки: нарисованное называется нарисованным). Пока ничего не правили —
 * схема в цветах по умолчанию. Лёгкая нарочно: без описи казино и без сцены.
 */

/* Листы схемы и их цвета «как в игре». */
const SHEETS = Object.freeze({
  walls: ["fr_mj_casino_wall_wood", "#6b4a30"],
  floor: ["carpet_hall", "#6e1f2a"],
  ceiling: ["fr_casino_mj_roof", "#2b2530"],
  trim: ["gold_fr_mj_cas", "#b8923a"],
});
const GLOW_STOCK = "#f3dcc2";

/* Чуть темнее или светлее — боковые стены и тени. */
function shade(hex, factor) {
  const value = parseInt(String(hex).slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => Math.min(255, Math.round(channel * factor)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export default function MajesticInteriorsCover({ state = null }) {
  useTr();
  const gradient = useId();
  const casino = useMemo(() => {
    const stored = parseCoverState(state);
    return (stored ? normalizeMajesticInteriors(stored) : createMajesticInteriors()).casino;
  }, [state]);
  const colour = (role) => casino.coverings[SHEETS[role][0]]?.colour || SHEETS[role][1];
  const walls = colour("walls");
  const floor = colour("floor");
  const ceiling = colour("ceiling");
  const trim = colour("trim");
  const glow = casino.glow.mode === "off" ? "" : casino.glow.mode === "colour" ? casino.glow.colour : GLOW_STOCK;
  return (
    <span className="workshop-cover-canvas">
      <svg className="shops-room-art" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${tr("Схема зала")}: ${tr("стены")} ${walls}, ${tr("пол")} ${floor}, ${tr("потолок")} ${ceiling}`}>
        <defs>
          <radialGradient id={gradient}>
            <stop offset="0" stopColor={glow || "#000000"} stopOpacity={glow ? 0.95 : 0} />
            <stop offset="1" stopColor={glow || "#000000"} stopOpacity="0" />
          </radialGradient>
        </defs>
        <polygon points="0,0 160,0 120,18 40,18" fill={ceiling} />
        <polygon points="40,18 120,18 120,70 40,70" fill={walls} />
        <polygon points="0,0 40,18 40,70 0,100" fill={shade(walls, 0.78)} />
        <polygon points="160,0 120,18 120,70 160,100" fill={shade(walls, 0.88)} />
        <polygon points="0,100 40,70 120,70 160,100" fill={floor} />
        <polygon points="40,62 120,62 120,66 40,66" fill={trim} />
        <polygon points="40,18 120,18 120,21 40,21" fill={shade(trim, 0.85)} />
        {glow ? <ellipse cx="80" cy="30" rx="34" ry="14" fill={`url(#${gradient})`} /> : null}
        <ellipse cx="80" cy="19" rx="9" ry="2.4" fill={glow || shade(ceiling, 0.5)} />
      </svg>
    </span>
  );
}
