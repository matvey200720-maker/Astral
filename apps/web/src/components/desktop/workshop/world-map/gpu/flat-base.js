import { waterColorAt, vectorBaseStyle } from "@modovik/vector-map";

// Слой стиля, который прячет роль геометрии; у остальных ролей слой одноимённый.
const LAYER_OF_ROLE = {
  blocks: "buildings",
  paths: "roads",
  freeway: "roads",
  roads: "roads",
  rail: "roads",
};

// Эффекты, которые GPU-заливка не умеет: любой из них оставляет кусок растру.
const UNSUPPORTED_EFFECTS = [
  (style) => style.waterSmooth > 0,
  (style) => style.outlineWidth > 0,
  (style) => style.glow > 0,
  (style) => style.casing > 0,
  (style) => Boolean(style.freewayCasing),
  (style) => style.biomes > 0,
  (style) => style.relief > 0,
];

export function flatBaseStyle(base, scale) {
  const plainEnough = Boolean(base) && !base.reliefOn && scale >= 1;
  if (!plainEnough) return null;

  const style = vectorBaseStyle(base);
  return UNSUPPORTED_EFFECTS.some((hasEffect) => hasEffect(style)) ? null : style;
}

export function roleColour(style, role, depth) {
  // layer: строка у известных ролей; у имён из прототипа объекта это тоже истина (так и задумано)
  const layer = LAYER_OF_ROLE[role];
  if (style.hidden.has(layer ?? role)) return null;
  if (role === "water") return waterColorAt(style, depth);
  if (role === "land") return style.land;
  return layer ? (style[role] ?? null) : null;
}
