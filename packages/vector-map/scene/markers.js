import { labelHalfWidth, withTone } from "./labels.js";
import { READABLE_PX, FLOOR_REACH, fixedTier, capHeightOf, fontFamilyOf, ownLabelWeight } from "./text-style.js";
import { round, alpha, withOwnOutline } from "./geometry.js";
import { MARKER_CATEGORY_MAP, MARKER_TIER_ZOOM, markerTier } from "../catalog.js";
import { markerGlyph, markerGlyphHalo } from "../pack-overlays.js";
import { effectPaint } from "../effect-paint.js";
import { LABEL_LINE_STEP } from "../label-fit.js";
import { GLYPH_BOX } from "../glyphs.js";

const FALLBACK_SET = "own";

const groupOf = (record) => record.group || FALLBACK_SET;
const isNil = (value) => value === null || value === undefined;
const sceneOf = (shapes = [], labels = [], lifted = new Set()) => ({ shapes, labels, lifted });
const shareOf = (percent) => (percent ?? 100) / 100;

function pinTo(value, low, high) {
  if (high < low) return (high + low) / 2;
  const floored = Math.max(value, low);
  return Math.min(floored, high);
}

// Первая из самых длинных строк.
function longestLine(lines) {
  let best = lines[0];
  for (const line of lines) if (line.length > best.length) best = line;
  return best;
}

const depthTable = (order) => new Map(order.map((id, slot) => [id, order.length - slot]));

// Наборы точек: верхний первым; названные человеком идут после остальных (те — в обратном порядке записей).
export function markerGroupOrder(markers) {
  const seen = new Set([...(markers?.items || [])].map(groupOf));
  const wanted = markers?.groupOrder || [];
  const named = wanted.filter(seen.has, seen);
  const rest = [];
  for (const id of seen) if (!named.includes(id)) rest.push(id);
  return rest.reverse().concat(named);
}

// Самый глубокий ярус, видимый при приближении: число порогов, не больших приближения, минус один.
function deepestTier(zoom) {
  if (typeof zoom !== "number") return MARKER_TIER_ZOOM.length - 1;
  return MARKER_TIER_ZOOM.filter((from) => from <= zoom).length - 1;
}

function categoryOf(markers, item) {
  if (Object.hasOwn(markers.categories, item.category)) return markers.categories[item.category];
  return markers.categories.landmark;
}

function ownGlyphOf(markers, item) {
  if (!item.glyph) return null;
  return Object.hasOwn(markers.glyphs || {}, item.glyph) ? markers.glyphs[item.glyph] : null;
}

// Мировая точка подписи: координаты точки плюс сдвиг; тень добавляет свой сдвиг после сдвига подписи.
function labelWorld(item, cast) {
  const x = item.x + item.labelOffset.x;
  const px = cast ? x + cast.dx : x;
  const y = item.y + item.labelOffset.y;
  return { x: px, y: cast ? y + cast.dy : y };
}

// ---------- предметы ----------

function discItem(id, center, r) {
  const item = { kind: "circle", id };
  item.x = center.x;
  item.y = center.y;
  item.r = r;
  return item;
}

function glyphItem(id, path, center, size) {
  const item = { kind: "glyph", id };
  item.path = path;
  item.box = GLYPH_BOX;
  item.x = center.x;
  item.y = center.y;
  item.size = size;
  return item;
}

const cornerAt = (middle, half, pad) => round(middle - half - pad);

// Квадрат вокруг центра: левый верхний угол и сторона.
function boxAround(center, half, pad) {
  const span = round((half + pad) * 2);
  return { x: cornerAt(center.x, half, pad), y: cornerAt(center.y, half, pad), width: span, height: span };
}

function plateItem(id, center, half, pad, corner) {
  const box = boxAround(center, half, pad);
  const item = { kind: "rect", id };
  item.x = box.x;
  item.y = box.y;
  item.width = box.width;
  item.height = box.height;
  item.radius = round(corner + pad);
  return item;
}

function imageItem(spot, dotAlpha) {
  const { center, size } = spot;
  const item = { kind: "image", id: `marker-icon-${spot.item.id}` };
  item.href = spot.picture;
  item.x = round(center.x - size / 2);
  item.y = round(center.y - size / 2);
  item.width = size;
  item.height = size;
  item.fit = "contain";
  item.opacity = dotAlpha;
  return item;
}

// Свечение и обводка значка в трёх обличьях: контурный значок, кружок и плашка (картинка или значок на плашке).
const GLOW_FORMS = {
  glyph(spot, id, shine) {
    const item = glyphItem(id, spot.iconPath, spot.center, spot.size);
    item.fill = shine.paint;
    item.stroke = shine.paint;
    item.strokeWidth = shine.spread * 2;
    item.blur = shine.blur;
    item.opacity = shine.opacity;
    return item;
  },
  disc(spot, id, shine) {
    const item = discItem(id, spot.center, round(spot.radius + shine.spread));
    item.fill = shine.paint;
    item.blur = shine.blur;
    item.opacity = shine.opacity;
    return item;
  },
  plate(spot, id, shine) {
    const item = plateItem(id, spot.center, spot.half, shine.spread, spot.corner);
    item.fill = shine.paint;
    item.blur = shine.blur;
    item.opacity = shine.opacity;
    return item;
  },
};

const OUTLINE_FORMS = {
  glyph(spot, id, line) {
    const item = glyphItem(id, spot.iconPath, spot.center, spot.size);
    item.fill = line.paint;
    item.stroke = line.paint;
    item.strokeWidth = line.width * 2;
    item.opacity = line.opacity;
    return item;
  },
  disc(spot, id, line) {
    const item = discItem(id, spot.center, round(spot.radius + line.width / 2));
    item.stroke = line.paint;
    item.strokeWidth = line.width;
    item.opacity = line.opacity;
    return item;
  },
  plate(spot, id, line) {
    const item = plateItem(id, spot.center, spot.half, line.width / 2, spot.corner);
    item.fill = null;
    item.stroke = line.paint;
    item.strokeWidth = line.width;
    item.opacity = line.opacity;
    return item;
  },
};

// Что именно рисуется на месте точки: картинка, значок (с силуэтом и без) или кружок.
const ART_FORMS = {
  image(shapes, spot, markers, dotAlpha) {
    shapes.push(imageItem(spot, dotAlpha));
  },
  icon(shapes, spot, markers, dotAlpha) {
    const { item, center, size, plate } = spot;
    if (spot.haloPath) {
      const halo = glyphItem(`marker-halo-${item.id}`, spot.haloPath, center, size);
      halo.fill = "#05060a";
      halo.opacity = dotAlpha;
      shapes.push(halo);
    }
    const icon = glyphItem(`marker-icon-${item.id}`, spot.iconPath, center, size);
    icon.fill = plate ? "#ffffff" : spot.ink;
    icon.badge = plate ? { fill: spot.ink } : null;
    icon.opacity = dotAlpha;
    icon.glow = plate || spot.haloPath ? null : { color: markers.labelOutlineColor, size: round(size / 9) };
    shapes.push(icon);
  },
  dot(shapes, spot, markers, dotAlpha) {
    const dot = discItem(`marker-dot-${spot.item.id}`, spot.center, spot.radius);
    dot.fill = spot.ink;
    dot.opacity = dotAlpha;
    shapes.push(dot);
  },
};

// Текст одной точки (подпись или её тень): общие части лежат в Lettering, различаются положение и краска.
function captionItem(text, id, at, origin, paint) {
  const item = { kind: "text", id };
  item.x = at.x;
  item.y = at.y;
  item.value = text.value;
  if (text.lines !== null) {
    item.lines = text.lines;
    item.lineStep = text.lineStep;
  }
  if (text.turned) {
    item.rotation = text.rotation;
    item.origin = text.pinned ? origin : null;
  }
  if (text.fit !== null) item.fitSpacing = text.fit;
  if (text.pinned) {
    item.fixed = true;
    item.group = text.group;
  }
  item.size = text.size;
  if (text.floor) item.floor = text.floor;
  item.fill = paint.fill;
  item.family = text.family;
  item.weight = text.weight;
  item.rank = text.rank;
  item.letterSpacing = text.fit !== null ? 0 : text.gap;
  item.anchor = "middle";
  item.baseline = "middle";
  item.stroke = paint.stroke;
  item.strokeWidth = paint.width;
  return item;
}

const shownText = (item, caps) => (caps ? item.name.toLocaleUpperCase("ru") : item.name);

// ---------- цвета подписи ----------

// Цвет, выбранный человеком: цвет подписи, а если нет — цвет точки, а если нет — цвет набора.
function chosenColor(item, look) {
  const labelled = item.labelColor;
  if (labelled) return labelled;
  const tinted = item.color;
  if (tinted) return tinted;
  return look && look.color;
}

// «Цвет с карты пака»: закреплённая точка со своим цветом, когда цвет подписи не задан ни ею, ни набором.
function keepsHue(markers, item, look, pinned) {
  if (!markers.labelAuto || !pinned) return false;
  if (!item.color || item.labelColor) return false;
  return !(look && look.color);
}

function backdropColor(markers, item, category) {
  const plain = MARKER_CATEGORY_MAP[item.category]?.glyph === "none";
  const own = category.labelColor;
  if (own) return own;
  return plain ? category.color : markers.labelColor;
}

function outlineViewFor(item, look, ring) {
  if (ring) return null;
  if (isNil(item.labelOutline)) return look;
  const tone = item.labelOutlineColor || (look && look.outlineColor) || "";
  return { ...look, outline: item.labelOutline, outlineColor: tone };
}

// ---------- состояние ----------

// Всё, что известно о точке, пока строятся её предметы.
class Spot {
  constructor(item, category) {
    this.item = item;
    this.category = category;
    this.tier = 0;
    this.pinned = false;
    this.height = null;
    this.center = null;
    this.ink = null;
    this.scale = 0;
    this.reach = 1;
    this.own = null;
    this.iconPath = null;
    this.haloPath = null;
    this.picture = null;
    this.look = null;
    this.share = 1;
    this.size = 0;
    this.ownRadius = null;
    this.showImage = false;
    this.showIcon = false;
    this.showDot = false;
    this.radius = 0;
    this.plate = false;
    this.contour = false;
    this.base = 0;
    this.half = 0;
    this.corner = 0;
  }
}

// Подпись точки: размеры, строки и шрифт, общие для самой подписи и её тени.
class Lettering {
  constructor(pinned, tier) {
    this.pinned = pinned;
    this.tier = tier;
    this.boost = 1;
    this.size = 0;
    this.floor = 0;
    this.drop = 0;
    this.value = "";
    this.lines = null;
    this.lineStep = 0;
    this.gap = 0;
    this.half = 0;
    this.fit = null;
    this.turned = false;
    this.rotation = 0;
    this.group = "";
    this.family = "";
    this.weight = 0;
    this.rank = 0;
    this.cast = null;
    this.ring = null;
  }
}

class MarkerPass {
  constructor(setup) {
    Object.assign(this, setup);
    const listed = setup.markers.hiddenGroups;
    this.hidden = new Set(listed ? listed : []);
    this.shapes = [];
    this.labels = [];
    this.lifted = new Set();
  }

  // Точки в порядке рисования: сначала нижние наборы, внутри набора — порядок записей.
  lineup() {
    const { markers } = this;
    const depth = depthTable(markerGroupOrder(markers));
    return markers.items.map(rowOf, depth).sort(bySlot);
  }

  assemble() {
    for (const row of this.lineup()) {
      const spot = this.admit(row.item);
      if (spot === null) continue;
      this.locate(spot);
      if (this.markers.circleStyle !== "none" && (spot.item.circle || spot.category.showCircle)) {
        this.shapes.push(this.ringFor(spot));
      }
      this.chooseArt(spot);
      this.drawArt(spot);
      if (spot.item.label && spot.category.showLabel) this.caption(spot);
    }
    return sceneOf(this.shapes, this.labels, this.lifted);
  }

  admit(item) {
    if (!item.enabled || this.hidden.has(groupOf(item)) || item.mesh) return null;
    const height = item.textHeight;
    const pinned = !isNil(height);
    const tier = pinned ? fixedTier(height) : markerTier(item.category);
    if (tier > this.deepest) return null;
    const category = categoryOf(this.markers, item);
    if (!category || !category.enabled) return null;
    const spot = new Spot(item, category);
    spot.tier = tier;
    spot.pinned = pinned;
    spot.height = height;
    return spot;
  }

  locate(spot) {
    const { item, category } = spot;
    spot.center = this.projector.point(item);
    spot.ink = item.color || category.color;
    spot.scale = item.scale / 100;
    spot.reach = spot.pinned ? 1 : this.shrink;
  }

  // Круг вокруг точки. Радиус в метрах берётся у точки, а если он не задан — у раздела.
  ringFor(spot) {
    const { markers, projector } = this;
    const { item } = spot;
    const id = `marker-circle-${item.id}`;
    const ring = discItem(id, spot.center, projector.length(item.circleRadius || markers.circleRadius));
    ring.stroke = spot.ink;
    ring.strokeWidth = round(markers.circleWidth * spot.reach);
    ring.strokeOpacity = alpha(markers.circleOpacity);
    ring.dash = markers.circleStyle === "dashed" ? [10, 7] : null;
    return ring;
  }

  // Собственный значок, путь значка категории и силуэта, картинка, вид набора и размеры значка и кружка.
  chooseArt(spot) {
    const { item, category } = spot;
    const { markers, projector, assets } = this;
    spot.own = ownGlyphOf(markers, item);
    if (!spot.own && markers.icons && Object.hasOwn(MARKER_CATEGORY_MAP, item.category)) {
      spot.iconPath = markerGlyph(MARKER_CATEGORY_MAP[item.category].glyph);
      spot.haloPath = spot.iconPath ? markerGlyphHalo(MARKER_CATEGORY_MAP[item.category].glyph) : null;
    }
    spot.picture = markers.icons ? assets?.[item.iconAssetId] || assets?.[category.iconAssetId] : null;
    spot.look = markers.groupStyles?.[groupOf(item)] || null;
    spot.share = shareOf(spot.look && spot.look.dotScale);
    spot.size = isNil(item.iconMeters)
      ? round(markers.iconSize * spot.scale * spot.reach * spot.share)
      : round(projector.length(item.iconMeters) * spot.share);
    spot.ownRadius = isNil(item.dotRadius) ? null : round(projector.length(item.dotRadius) * spot.share);
  }

  drawArt(spot) {
    const { item, category } = spot;
    if (spot.own) {
      if (item.dot && spot.size > 0) this.ownLayers(spot);
      return;
    }
    if (!(item.dot && category.showDot)) return;
    const { markers } = this;
    spot.showImage = Boolean(spot.picture) && spot.size > 0;
    spot.showIcon = !spot.picture && Boolean(spot.iconPath) && spot.size > 0;
    spot.showDot = item.dot && !spot.showImage && !spot.showIcon && markers.dotSize > 0;
    if (spot.showDot) {
      spot.radius = spot.ownRadius ?? round((markers.dotSize * spot.scale * spot.reach * spot.share) / 2);
    }
    if (spot.showImage || spot.showIcon || spot.showDot) this.paintArt(spot);
  }

  ownLayers(spot) {
    const { item, center, size } = spot;
    const main = spot.own.main ?? 0;
    const base = alpha(this.markers.dotOpacity);
    spot.own.layers.forEach((layer, at) => {
      const shape = glyphItem(`marker-own-${item.id}-${at}`, layer.path, center, size);
      shape.fill = at === main && item.color ? item.color : layer.color;
      shape.opacity = base * layer.alpha;
      this.shapes.push(shape);
    });
  }

  // Эффекты (свечение, затем обводка), после них — сама картинка, значок или кружок.
  paintArt(spot) {
    const { item, category } = spot;
    const dotAlpha = alpha(this.markers.dotOpacity);
    const outlineFx = item.outline;
    const glowFx = item.glow;
    const outlined = outlineFx?.enabled ? outlineFx : null;
    const glowing = glowFx?.enabled && glowFx.strength > 0 ? glowFx : null;
    spot.plate = spot.showIcon && category.showBadge;
    if (outlined || glowing) this.shine(spot, outlined, glowing, dotAlpha);
    const form = spot.showImage ? "image" : spot.showIcon ? "icon" : "dot";
    ART_FORMS[form](this.shapes, spot, this.markers, dotAlpha);
  }

  shine(spot, outlined, glowing, dotAlpha) {
    const { item, size } = spot;
    spot.contour = spot.showIcon && !spot.plate;
    spot.base = spot.showDot ? spot.radius * 2 : size;
    spot.half = spot.showDot ? spot.radius : spot.plate ? size * 0.72 : size / 2;
    spot.corner = spot.plate ? size * 0.34 : spot.showImage ? size * 0.12 : 0;
    const form = spot.contour ? "glyph" : spot.showDot ? "disc" : "plate";
    if (glowing) {
      const power = glowing.strength / 100;
      const shine = {
        spread: round(spot.base * (0.1 + power * 0.32)),
        paint: effectPaint(glowing.effect, "#ffd23f"),
        blur: round(spot.base * (0.12 + power * 0.42)),
        opacity: round(dotAlpha * (0.45 + power * 0.55)),
      };
      this.shapes.push(GLOW_FORMS[form](spot, `marker-glow-${item.id}`, shine));
    }
    if (outlined) {
      const line = {
        width: Math.max(0.2, round((spot.base * outlined.width) / 100)),
        paint: effectPaint(outlined.effect, "#ffffff"),
        opacity: dotAlpha,
      };
      this.shapes.push(OUTLINE_FORMS[form](spot, `marker-outline-${item.id}`, line));
    }
  }

  // Основа оттенка: цвет-основа при автоцвете, цвет точки у «цвета с карты пака», иначе нет.
  tintFor(picked, backdrop, keepHue, item) {
    if (this.markers.labelAuto && !picked) return backdrop;
    if (keepHue) return item.color;
    return null;
  }

  // Обводка подписи: кольцо тени, а без него — обводка раздела, если она задана.
  strokeFor(ring) {
    if (ring) return ring;
    return this.markers.labelOutline > 0 ? this.markers.labelOutlineColor : null;
  }

  // Размер подписи до подъёма: закреплённая считается от высоты букв в метрах, остальные — от кегля раздела.
  naturalSize(spot, fontId) {
    const { item, category, look } = spot;
    const { markers, projector } = this;
    const pointShare = shareOf(item.labelScale);
    const lookShare = shareOf(look && look.scale);
    if (spot.pinned) return round(projector.length(spot.height / capHeightOf(fontId)) * lookShare * pointShare);
    const categoryShare = shareOf(category.labelScale);
    return round(markers.labelSize * spot.scale * this.shrink * categoryShare * lookShare * pointShare);
  }

  // Мелкие подписи поднимаются до порога читаемости; поднятые попадают в lifted.
  liftSize(spot, text, fontId) {
    const natural = this.naturalSize(spot, fontId);
    text.boost = this.readable > natural && natural > 0 ? this.readable / natural : 1;
    text.size = text.boost > 1 ? round(natural * text.boost) : natural;
    if (text.boost > 1) this.lifted.add(`marker-label-${spot.item.id}`);
    text.floor = natural > 0 && this.readable * FLOOR_REACH > natural ? natural : 0;
  }

  // Регистр по умолчанию: прописные у раздела, у районов верхнего яруса и у наборов с заглавными.
  upperByDefault(spot) {
    const { look, tier, pinned } = spot;
    if (this.markers.labelCase === "upper") return true;
    if (tier === 0 && !pinned) return true;
    return look && look.caps;
  }

  // Сдвиг подписи вниз: под значок или картинку, под кружок или никакого (закреплённые не сдвигаются).
  dropFor(spot, size) {
    if (spot.pinned) return 0;
    if (spot.showIcon || spot.showImage) return spot.size * 0.82;
    return spot.item.dot && spot.category.showDot ? size * 1.15 : 0;
  }

  // Слова подписи: регистр, строки, самая длинная строка, разрядка и половина её ширины.
  wording(spot, text) {
    const { item, category, look } = spot;
    const { markers } = this;
    const caps = isNil(item.caps) ? this.upperByDefault(spot) : item.caps;
    const lines = shownText(item, caps).split("\n");
    text.value = longestLine(lines);
    text.lines = lines.length > 1 ? lines : null;
    text.gap = round((text.size * ((look && look.spacing) || (category.spacing ?? markers.letterSpacing))) / 100);
    text.half = labelHalfWidth(text.value, text.size, text.gap);
  }

  // Место в сцене: закреплённая подпись стоит там, где её поставили, остальные прижимаются к границам.
  settle(point, text) {
    if (text.pinned) return point;
    const { projector } = this;
    return {
      x: round(pinTo(point.x, text.half, projector.width - text.half)),
      y: round(pinTo(point.y + text.drop, text.size, projector.height - text.size)),
    };
  }

  caption(spot) {
    const { item, category, look, tier, pinned } = spot;
    const { markers, projector } = this;
    const text = new Lettering(pinned, tier);
    const fontId = item.font || (look && look.font) || markers.font;
    this.liftSize(spot, text, fontId);
    const moved = projector.point(labelWorld(item));
    text.drop = this.dropFor(spot, text.size);
    this.wording(spot, text);
    text.fit = pinned && item.textWidth ? round(projector.length(item.textWidth) * text.boost) : null;

    const picked = chosenColor(item, look);
    const keepHue = keepsHue(markers, item, look, pinned);
    const backdrop = backdropColor(markers, item, category);
    const shade = item.shadow;
    text.cast = shade && (shade.dx || shade.dy) ? shade : null;
    text.ring = shade && !text.cast ? shade.color : null;

    const spin = item.rotation;
    text.turned = Boolean(spin);
    text.rotation = spin ? -spin : 0;
    text.lineStep = round(text.size * ((look && look.lineStep) || LABEL_LINE_STEP));
    text.group = groupOf(item);
    text.family = fontFamilyOf(fontId);
    text.weight = ownLabelWeight(item.weight ? { weight: item.weight } : look, fontId, category.weight === "black");
    text.rank = item.category === "region" ? -1 : tier;

    if (text.cast) {
      const echo = projector.point(labelWorld(item, text.cast));
      const shadowId = `marker-shadow-${item.id}`;
      const paint = { fill: text.cast.color, stroke: null, width: 0 };
      this.labels.push(captionItem(text, shadowId, this.settle(echo, text), echo, paint));
    }
    const { ring } = text;
    const paint = { fill: picked || backdrop, stroke: this.strokeFor(ring), width: 0 };
    paint.width = ring ? round(text.size * 0.22) : round((text.size * markers.labelOutline) / 900);
    const record = captionItem(text, `marker-label-${item.id}`, this.settle(moved, text), moved, paint);
    const tint = this.tintFor(picked, backdrop, keepHue, item);
    this.labels.push(withOwnOutline(withTone(record, tint, this.tones, keepHue), outlineViewFor(item, look, ring)));
  }
}

// Строка очереди: сама точка, место в списке и глубина набора (глубина берётся из Map, переданной как this).
function rowOf(item, at) {
  return { item, at, depth: this.get(groupOf(item)) ?? 0 };
}

const bySlot = (a, b) => (a.depth === b.depth ? a.at - b.at : a.depth - b.depth);

export function markerItems(config, projector, ...extras) {
  const [shrink = 1, assets = null, zoom = null, tones = null, windowScale = null] = extras;
  const markers = config.markers;
  if (!markers.enabled) return sceneOf();
  const readable = windowScale && markers.declutter ? READABLE_PX / windowScale : 0;
  const setup = { markers, projector, shrink, assets, tones, readable, deepest: deepestTier(zoom) };
  return new MarkerPass(setup).assemble();
}
