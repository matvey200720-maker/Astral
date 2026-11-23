import { GlyphDownload, GlyphDrives, GlyphLayers, GlyphMap, GlyphSpeaker } from "@astral/glyphs";

/*
 * Значок набора через спрайт (31.10.2026, холодный первый вход в каталог).
 *
 * Знак набора — `<svg>` с двумя-четырьмя фигурами внутри (`path`, `polygon`, `rect`), и у каждой фигуры свой узел со своим стилем: на карточке каталога таких
 * значков два (факт «скачано» и факт «вес»), и это 8 узлов из 23. При ×4 стиль стоит ~290 мкс на элемент, на кадре входа в каталог — около 25 карточек. Здесь тот же знак
 * отдаётся ссылкой на `<symbol>`: на карточке остаётся `<svg><use/></svg>`, два узла вместо четырёх, а фигуры лежат один раз в спрайте на документ.
 *
 * Рисунок не копируется: символ собирается из тех же функций набора (`GlyphDownload`…), что рисуют значок обычным путём, и вид тот же — холст 24 × 24, обводка 1,5,
 * скругления, цвет `currentColor`: свойства рисования наследует `<use>` от внешнего `<svg>`, как и дети обычного знака. Размер задаёт тот же лист (`1em`,
 * `.poster-fact svg { 14px }`). Сердечко на карточке сюда не вошло: оно и так `svg` с одним `path` (`FavoriteHeart`, 16 × 16), два узла в любом случае.
 */

const SYMBOLS = {
  download: GlyphDownload,
  drives: GlyphDrives,
  layers: GlyphLayers,
  map: GlyphMap,
  speaker: GlyphSpeaker,
};

const NAMESPACE = "http://www.w3.org/2000/svg";
const SPRITE_ID = "astral-sprite";
const symbolId = (name) => `astral-sprite-${name}`;

/* Свойство React-элемента → атрибут SVG (в фигурах набора имена обычные — `d`, `points`, `x`, `fill`; `strokeWidth`-подобные переводятся на всякий случай). */
const attributeName = (key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function shapeOf(element) {
  const node = document.createElementNS(NAMESPACE, element.type);
  for (const [key, value] of Object.entries(element.props)) {
    if (key === "children" || value === undefined || value === null) continue;
    node.setAttribute(attributeName(key), String(value));
  }
  return node;
}

/** Фигуры знака набора: дети `<Glyph>`, которого возвращает функция знака (чистая, без хуков). */
export function glyphShapes(name) {
  const glyph = SYMBOLS[name]?.({});
  const children = glyph?.props?.children;
  return (Array.isArray(children) ? children : [children]).filter(Boolean);
}

let sheet = null;

/** Спрайт — один скрытый `<svg>` в документе; заводится при первом знаке и пересоздаётся, если документ его потерял. */
function ensureSprite() {
  if (sheet?.isConnected) return;
  const root = document.createElementNS(NAMESPACE, "svg");
  root.setAttribute("id", SPRITE_ID);
  root.setAttribute("width", "0");
  root.setAttribute("height", "0");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  root.style.position = "absolute";
  for (const name of Object.keys(SYMBOLS)) {
    const symbol = document.createElementNS(NAMESPACE, "symbol");
    symbol.setAttribute("id", symbolId(name));
    symbol.setAttribute("viewBox", "0 0 24 24");
    for (const shape of glyphShapes(name)) symbol.append(shapeOf(shape));
    root.append(symbol);
  }
  document.body.append(root);
  sheet = root;
}

if (typeof document !== "undefined" && document.body) ensureSprite();

/** Знак набора ссылкой на спрайт: `<SpriteIcon name="download" />` рисуется как `<DownloadSimple />`. */
export default function SpriteIcon({ name, className = "" }) {
  ensureSprite();
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `astral-glyph ${className}` : "astral-glyph"}
    >
      <use href={`#${symbolId(name)}`} />
    </svg>
  );
}
