/*
 * Предпросмотр «Шрифтов»: название шрифта его же буквами.
 *
 * Буквы своего шрифта рисуются теми же контурами, что уедут в игру:
 * `sourceGlyph` из `@modovik/gfx/fonts` — та же подгонка под высоту
 * заглавных шрифта игры, ширина, толщина, интервал, наклон и подъём, что у
 * установщика. Буква, которой в своём шрифте нет, остаётся буквой игры
 * (если шрифт игры прочитан из игры игрока); символа, которого нет в наборе
 * игры, игра не покажет — кадр тоже.
 *
 * Кадр — одно название по центру матовой плашки (владелец, 04.10.2026):
 * без постановочного экрана игры.
 */

import { GAME_FONT_TARGETS } from "@modovik/climb-contract/recolor/fonts";
import { fontLayout, gameCapHeight, sourceGlyph } from "@modovik/gfx/fonts";

function pathOf(contours) {
  const path = new Path2D();
  for (const contour of contours) {
    path.moveTo(contour.start.x, contour.start.y);
    for (const segment of contour.segments) {
      if ("cx" in segment) path.quadraticCurveTo(segment.cx, segment.cy, segment.x, segment.y);
      else path.lineTo(segment.x, segment.y);
    }
    path.closePath();
  }
  return path;
}

/*
 * Готовые буквы на всё окно: своя буква — по шрифту, кеглю, толщине и
 * подъёму (интервал прибавляется к ширине потом: от него контур не
 * меняется), буква игры — по записи шрифта. Ползунок интервала не
 * пересобирает ни одной буквы, а возврат к прежней толщине — из готового.
 */
const sourceCache = new WeakMap();
const gameCache = new WeakMap();
const CACHE_LIMIT = 6000;

function bucket(cache, owner) {
  let map = cache.get(owner);
  if (!map) {
    map = new Map();
    cache.set(owner, map);
  }
  if (map.size > CACHE_LIMIT) map.clear();
  return map;
}

function ownGlyph(source, code, layout) {
  const map = bucket(sourceCache, source);
  const key = `${code}|${layout.scale}|${layout.width}|${layout.skew}|${layout.bold}|${layout.dy}`;
  if (!map.has(key)) {
    const placed = sourceGlyph(source, code, { ...layout, spacing: 0 });
    map.set(key, placed ? { path: pathOf(placed.contours), advance: placed.advance } : null);
  }
  return map.get(key);
}

/* Мерки шрифта игры: из игры игрока, иначе опорные из контракта. */
function metricsOf(target, game) {
  if (!game) return target.metrics;
  return { nominal: game.nominal || 256, ascent: game.ascent, descent: game.descent, leading: game.leading, cap: gameCapHeight(game) };
}

/**
 * Набор глифов одного шрифта игры для кадра. `own` — свой шрифт (`source`)
 * с подгонкой `settings`; иначе — шрифт игры как есть. `game` — запись
 * шрифта игры из игры игрока или `null`.
 */
export function createGlyphSet({ target, source = null, game = null, settings = {}, own = false }) {
  const metrics = metricsOf(target, game);
  const useOwn = own && Boolean(source);
  const layout = useOwn ? fontLayout(source, { nominal: metrics.nominal, cap: metrics.cap, leading: metrics.leading }, settings) : null;
  const gameGlyphs = game ? new Map(game.glyphs.map((glyph) => [glyph.code, glyph])) : null;
  const gameKerning = game ? new Map(game.kerning.map((pair) => [pair.a * 65536 + pair.b, pair.advance])) : null;
  const cache = new Map();

  const gameGlyph = (code) => {
    const glyph = gameGlyphs?.get(code);
    if (!glyph) return null;
    const paths = bucket(gameCache, game);
    if (!paths.has(code)) paths.set(code, pathOf(glyph.contours));
    return { path: paths.get(code), advance: glyph.advance, own: false };
  };

  function glyph(code) {
    if (cache.has(code)) return cache.get(code);
    let result = null;
    /* Набор символов — игры: чего в нём нет, того игра не покажет. */
    const inGameSet = !gameGlyphs || gameGlyphs.has(code);
    if (inGameSet) {
      if (useOwn) {
        const placed = ownGlyph(source, code, layout);
        result = placed ? { path: placed.path, advance: placed.advance + layout.spacing, own: true } : gameGlyph(code);
      } else result = gameGlyph(code);
    }
    cache.set(code, result);
    return result;
  }

  function kerning(a, b) {
    if (useOwn) {
      const left = source.glyphOf(a);
      const right = source.glyphOf(b);
      return left && right ? Math.round(source.kerning(left, right) * layout.scale * layout.width) : 0;
    }
    return gameKerning?.get(a * 65536 + b) || 0;
  }

  return {
    id: target.id,
    own: useOwn,
    nominal: metrics.nominal,
    ascent: metrics.ascent,
    descent: metrics.descent,
    leading: useOwn ? layout.leading : metrics.leading,
    glyph,
    kerning,
  };
}

/* Буквы строки с позициями в единицах кегля: `[{ glyph, x }]` и ширина. */
function layoutLine(set, text) {
  const items = [];
  let pen = 0;
  let previous = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (previous) pen += set.kerning(previous, code);
    const glyph = set.glyph(code);
    if (glyph) {
      items.push({ glyph, x: pen });
      pen += glyph.advance;
    }
    previous = glyph ? code : 0;
  }
  return { items, width: pen };
}

/** Ширина строки в точках при кегле `size`. */
export function measureText(set, text, size) {
  return (layoutLine(set, text).width * size) / set.nominal;
}

/**
 * Строка текста набором `set`: `x, y` — начало и линия шрифта, `size` —
 * кегль в точках. `outline` и `shadow` рисует игра сама (по команде сервера
 * или скрипта), в шрифте их нет — кадр показывает их так же, как игра.
 */
export function drawText(context, set, text, x, y, size, { align = "left", fill = "#ffffff", outline = null, shadow = null, alpha = 1 } = {}) {
  const { items, width } = layoutLine(set, text);
  const scale = size / set.nominal;
  const left = align === "center" ? x - (width * scale) / 2 : align === "right" ? x - width * scale : x;
  context.save();
  context.globalAlpha *= alpha;
  const paint = (dx, dy, style, stroke) => {
    for (const item of items) {
      context.save();
      context.translate(left + dx + item.x * scale, y + dy);
      context.scale(scale, scale);
      if (stroke) {
        context.lineJoin = "round";
        context.lineWidth = (stroke * 2) / scale;
        context.strokeStyle = style;
        context.stroke(item.glyph.path);
      } else {
        context.fillStyle = style;
        context.fill(item.glyph.path, "evenodd");
      }
      context.restore();
    }
  };
  if (shadow) paint(shadow.x, shadow.y, shadow.colour, 0);
  if (outline) paint(0, 0, outline.colour, outline.width);
  paint(0, 0, fill, 0);
  context.restore();
  return width * scale;
}

/*
 * Название без своих контуров (шаблон Windows в браузере, где его читает
 * только Astral Desktop): шрифт окна тем же семейством, ширина, наклон и
 * интервал — преобразованием холста. Это приближение, подпись кадра его
 * называет.
 */
function drawSystemName(context, name, { family, weight = 400, settings = {}, x, y, maxWidth, maxHeight }) {
  const width = (settings.width ?? 100) / 100;
  const skew = Math.tan(((settings.slant ?? 0) * Math.PI) / 180);
  let size = maxHeight * ((settings.size ?? 100) / 100);
  context.save();
  context.font = `${weight} ${Math.round(size)}px ${family}`;
  const measured = context.measureText(name).width * width;
  if (measured > maxWidth) size *= maxWidth / measured;
  context.font = `${weight} ${Math.round(size)}px ${family}`;
  if ("letterSpacing" in context) context.letterSpacing = `${((settings.spacing ?? 0) * size) / 1000}px`;
  context.fillStyle = "#f4f1ea";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.translate(x, y - ((settings.baseline ?? 0) / 100) * size * 0.7);
  context.transform(width, 0, -skew, 1, 0, 0);
  context.fillText(name, 0, 0);
  context.restore();
}

/**
 * Название шрифта по центру кадра `width × height`: набором глифов `set`
 * (те же контуры, что уедут в игру) или, без него, шрифтом окна
 * (`fallback`: `{ family, weight, settings }`). Кегль — по рамке: название
 * занимает до 80 % ширины и до трети высоты.
 */
export function drawFontName(context, set, name, { width, height, fallback = null }) {
  const maxWidth = width * 0.8;
  const maxHeight = height * 0.34;
  const baseline = height * 0.5 + maxHeight * 0.32;
  if (!set) {
    if (fallback) drawSystemName(context, name, { ...fallback, x: width / 2, y: baseline, maxWidth, maxHeight });
    return;
  }
  /* Кегль: высота заглавных набора — треть кадра, но строка не шире 80 %. */
  let size = maxHeight * 1.25;
  const measured = measureText(set, name, size);
  if (measured > maxWidth) size *= maxWidth / measured;
  drawText(context, set, name, width / 2, baseline, size, { align: "center", fill: "#f4f1ea" });
}

/**
 * Образец шрифта (ТЗ владельца 27.10.2026: «большая «А» и маленькая «а» этим шрифтом»): две буквы одним кеглем — заглавная и строчная
 * видны рядом. Кириллица — если в наборе есть обе буквы, иначе латиница (у основного шрифта игры русских букв может не быть, а
 * образец без букв — пустая плитка).
 */
export function specimenText(set) {
  return set && set.glyph(0x410) && set.glyph(0x430) ? "Аа" : "Aa";
}

/**
 * Образец «Аа» по центру кадра `width × height`: набором глифов `set` (те же контуры, что уедут в игру) или, без него, шрифтом окна
 * (`fallback`: `{ family, weight, settings }`). Заглавная занимает половину высоты вписанного в кадр прямоугольника 8 : 5, а образец — не больше 80 % ширины.
 */
export function drawFontSpecimen(context, set, { width, height, fallback = null }) {
  const text = specimenText(set);
  /* Обложка — 8 : 5: от кадра выше или уже неё образец считается по вписанному прямоугольнику такой формы, иначе его срежет обрезка по краям. */
  const cap = Math.min(height, width / 1.6) * 0.5;
  if (!set) {
    if (fallback) drawSystemName(context, text, { ...fallback, x: width / 2, y: height * 0.5 + cap * 0.36, maxWidth: width * 0.8, maxHeight: cap });
    return;
  }
  /* Кегль: высота заглавных набора — `cap` (у шрифта игры она ≈ 0,8 кегля), но не шире 80 % кадра. */
  let size = cap * 1.25;
  const measured = measureText(set, text, size);
  if (measured > width * 0.8) size *= (width * 0.8) / measured;
  drawText(context, set, text, width / 2, height * 0.5 + (size * 0.8) / 2, size, { align: "center", fill: "#f4f1ea" });
}

/** Шрифт игры для кадра: `id` → запись цели контракта. */
export const PREVIEW_TARGETS = Object.freeze(Object.fromEntries(GAME_FONT_TARGETS.map((target) => [target.id, target])));
