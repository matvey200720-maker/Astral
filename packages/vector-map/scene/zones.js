import { zoneLabelFit, MIN_LABEL_SHRINK, withTone } from "./labels.js";
import { fontFamilyOf, ownLabelWeight, luminance, mixTone, tintLabel } from "./text-style.js";
import { boundsOf } from "./strokes.js";
import { zoneDash } from "../shapes.js";
import { round, alpha, smoothPath, project, withOwnOutline } from "./geometry.js";
import { LABEL_LINE_STEP } from "../label-fit.js";
import { ZONE_TEMPLATE_MAP } from "../catalog.js";
import { ZONE_SET_MAP } from "../label-sets.js";

const FALLBACK_SET = "own";
const INK = "#04060a";
const LOOK_FIELDS = ["fillMode", "fillOpacity", "strokeWidth", "strokeAlign", "glow"];
const LIGHT_BELOW = 0.5;
const BUSY_FROM = 40;
const BUSY_OUTLINE = 60;

const groupOf = (record) => record.group || FALLBACK_SET;
const isNil = (value) => value === null || value === undefined;
const isUnset = (value) => isNil(value) || value === "";
const isGameSet = (id) => id !== "none" && Boolean(ZONE_TEMPLATE_MAP[id]);
const pickZone = (row) => row.zone;
const blurOf = (strongest, shrink) => round((strongest / 12) * shrink);
const sceneOf = (fills = [], glows = [], glowBlur = 0, shapes = [], labels = []) => ({
  fills,
  glows,
  glowBlur,
  shapes,
  labels,
});

// ---------- порядок наборов и зон ----------

export const zoneGroupOrder = (zones) => {
  const seen = new Set([...(zones?.items || [])].map(groupOf));
  const wanted = zones?.groupOrder || [];
  const named = wanted.filter(seen.has, seen);
  const lanes = { own: [], game: [] };
  for (const id of seen) if (!named.includes(id)) lanes[isGameSet(id) ? "game" : "own"].push(id);
  return lanes.own.reverse().concat(named, lanes.game.reverse());
};

export const polygonAreaOf = (points) => {
  const total = points.length;
  if (!(total > 0)) return 0;
  let sum = 0;
  let at = 0;
  do {
    const prior = points[at === 0 ? total - 1 : at - 1];
    const here = points[at];
    sum += prior.x * here.y - here.x * prior.y;
    at += 1;
  } while (at < total);
  return Math.abs(sum) / 2;
};

const farToNear = (a, b) => {
  let gap = a.depth - b.depth;
  if (gap) return gap;
  gap = b.area - a.area;
  return gap || a.at - b.at;
};

// Строка очереди рисования: сама зона, место в списке, площадь (только у наборов игры) и глубина набора.
const rankerFor = (depth) => (zone, at) => ({
  zone,
  at,
  area: ZONE_TEMPLATE_MAP[zone.group] ? polygonAreaOf(zone.points) : 0,
  depth: depth.get(groupOf(zone)) ?? 0,
});

export const zonesBackToFront = (zones) => {
  const order = zoneGroupOrder(zones);
  const depth = new Map(order.map((id, slot) => [id, order.length - slot]));
  return zones.items.map(rankerFor(depth)).sort(farToNear).map(pickZone);
};

// Запись попадает в «показанные», когда выполнены все условия по порядку; значение набора читается в каждом из них.
const SHOWN_RULES = [(entry) => entry.enabled, (entry) => entry.group, (entry, hidden) => !hidden.has(entry.group)];

const qualifies = (entry, hidden) => SHOWN_RULES.every((rule) => rule(entry, hidden));

export const shownLabelSets = (markers) => {
  if (!markers.enabled) return new Set();
  const listed = markers.hiddenGroups;
  const hidden = new Set(listed ? listed : []);
  const shown = new Set();
  for (const entry of markers.items) {
    if (qualifies(entry, hidden)) shown.add(entry.group);
  }
  return shown;
};

export const zoneLookOf = (zones, key) => {
  const table = zones.groupStyles;
  const mine = (table && table[key]) || {};
  return LOOK_FIELDS.reduce((look, field) => {
    const own = mine[field];
    const base = zones[field];
    look[field] = isUnset(own) ? base : own;
    return look;
  }, {});
};

// ---------- признаки контура ----------

// Поле points читается заново на каждом шаге: число и порядок чтений входят в наружное поведение.
const axisEdges = (zone) => {
  const count = zone.points.length;
  let straight = 0;
  for (let at = 0; at < count; at += 1) {
    const here = zone.points[at];
    const peer = zone.points[at + 1 === count ? 0 : at + 1];
    if (here.x !== peer.x && here.y !== peer.y) continue;
    straight += 1;
  }
  return straight;
};

// Условия «рукотворного» контура проверяются по порядку и останавливаются на первом невыполненном.
const HAND_RULES = [
  (zone) => (zone.shape || "free") === "free",
  (zone) => "mod-" !== String(zone.group || "").slice(0, 4),
  (zone, straight) => {
    const count = zone.points.length;
    return count > 4 && count <= 24 && straight < count / 2;
  },
];

const isHandDrawn = (zone) => {
  const straight = axisEdges(zone);
  return HAND_RULES.every((rule) => rule(zone, straight));
};

// ---------- предметы ----------

const pathItem = (prefix, frame) => ({ kind: "path", id: prefix.concat(frame.id), bounds: frame.bounds, d: frame.d });

const haloItem = (frame, opacity) => {
  const item = pathItem("halo-", frame);
  item.fill = null;
  item.stroke = INK;
  item.strokeWidth = round(frame.width * 2.2);
  item.strokeOpacity = round(opacity * 0.6);
  item.lineJoin = "round";
  return item;
};

const glowItem = (frame) => {
  const { glow } = frame.look;
  const item = pathItem("zone-glow-", frame);
  item.stroke = frame.ink;
  item.strokeWidth = round(frame.width * (1 + glow / 22));
  item.opacity = round((glow / 100) * 0.32);
  item.lineJoin = "round";
  return item;
};

const recolorItem = (frame, density) => {
  const item = pathItem("zone-fill-", frame);
  item.fill = frame.paint;
  item.fillOpacity = density;
  item.blend = "color";
  return item;
};

const bodyItem = (frame, recolor, opacities) => {
  const { width } = frame;
  const item = pathItem("zone-", frame);
  item.fill = frame.filled && !recolor ? frame.paint : null;
  item.fillOpacity = opacities.fill;
  item.stroke = width > 0 ? frame.ink : null;
  item.strokeWidth = frame.clip ? width * 2 : width;
  item.strokeOpacity = opacities.stroke;
  item.lineJoin = "round";
  return item;
};

// Мировая точка подписи: первая вершина зоны, сдвинутая на labelOffset (по одной оси за раз, как читаются поля).
const pushedAlong = (zone, axis) => zone.points[0][axis] + zone.labelOffset[axis];

const pushedPoint = (zone) => ({ x: pushedAlong(zone, "x"), y: pushedAlong(zone, "y") });

const handShift = (offset) => offset.x || offset.y;

const meanPoint = (points) =>
  points.reduce(
    (sum, point) => {
      sum.x += point.x / points.length;
      sum.y += point.y / points.length;
      return sum;
    },
    { x: 0, y: 0 },
  );

// Гарнитура, насыщенность и заданный размер подписи: чтения идут в порядке font, weight, scale.
const captionFace = (style, zones, base) => {
  const fontId = (style && style.font) || zones.font;
  return {
    family: fontFamilyOf(fontId),
    weight: ownLabelWeight(style, fontId, fontId === "heavy"),
    wanted: round(base * (((style && style.scale) ?? 100) / 100)),
  };
};

const captionText = (style, zone) => (style && style.caps ? zone.name.toLocaleUpperCase("ru") : zone.name);

// Размер с учётом раскладки: не больше заданного и не меньше доли от него.
const fittedSize = (wanted, fit) => round(Math.max(Math.min(fit.size, wanted), wanted * MIN_LABEL_SHRINK));

const drift = (middle, moved, home) => round(middle + (moved - home));

const captionFill = (style, zones, zone, busy, light) => {
  const chosen = style && style.color;
  if (chosen) return chosen;
  if (!zones.labelTint) return zones.labelColor;
  if (busy) return mixTone(zone.color, 255, 0.86, "#ffffff");
  return tintLabel(zone.color, light);
};

const captionStroke = (zones, zone, busy) => {
  if (zones.labelOutline > 0) return INK;
  if (busy) return mixTone(zone.color, 0, 0.8, INK);
  return null;
};

const toneBase = (auto, zones, zone) => {
  if (!auto) return null;
  return zones.labelTint ? zone.color : zones.labelColor;
};

// Всё, что известно о зоне, пока её предметы собираются.
class Frame {
  constructor(zone, look) {
    this.zone = zone;
    this.look = look;
    this.ring = null;
    this.width = 0;
    this.dash = null;
    this.d = "";
    this.bounds = null;
    this.clip = false;
    this.haloed = false;
    this.filled = false;
    this.paint = null;
    this.id = null;
    this.ink = null;
  }
}

class ZonePass {
  constructor(setup) {
    Object.assign(this, setup);
    const listed = setup.zones.hiddenGroups;
    this.hidden = new Set(listed ? listed : []);
    this.looks = new Map();
    this.shownSets = null;
    this.fills = [];
    this.glows = [];
    this.shapes = [];
    this.labels = [];
    this.glowBlur = 0;
    this.labelBase = 0;
  }

  lookFor(id) {
    if (!this.looks.has(id)) this.looks.set(id, zoneLookOf(this.zones, id));
    return this.looks.get(id);
  }

  // Самое сильное свечение среди включённых зон не спрятанных наборов (рисуются они или нет, неважно).
  survey() {
    const { zones, shrink } = this;
    let strongest = 0;
    for (const zone of zones.items) {
      if (!zone.enabled || this.hidden.has(groupOf(zone))) continue;
      strongest = Math.max(strongest, this.lookFor(groupOf(zone)).glow);
    }
    this.glowBlur = blurOf(strongest, shrink);
    this.labelBase = round(zones.labelSize * shrink);
  }

  assemble() {
    this.survey();
    for (const zone of zonesBackToFront(this.zones)) {
      const frame = this.admit(zone);
      if (frame === null) continue;
      this.trace(frame);
      this.curve(frame);
      this.classify(frame);
      this.emit(frame);
      if (this.zones.labels) this.caption(frame);
    }
    return sceneOf(this.fills, this.glows, this.glowBlur, this.shapes, this.labels);
  }

  admit(zone) {
    if (!zone.enabled) return null;
    const count = zone.points.length;
    if (count < (zone.open ? 2 : 3)) return null;
    if (this.hidden.has(groupOf(zone))) return null;
    return new Frame(zone, this.lookFor(groupOf(zone)));
  }

  // Спроецированный контур, своя толщина границы и пунктир.
  trace(frame) {
    const { zone, look } = frame;
    const common = round(look.strokeWidth * this.shrink);
    frame.ring = project(this.projector, zone.points);
    const { width: given } = zone;
    frame.width = isNil(given) ? common : round(given * this.shrink);
    frame.dash = zoneDash(zone.line, frame.width);
  }

  curve(frame) {
    const { zone, ring } = frame;
    const tension = isHandDrawn(zone) ? 0.35 : 0;
    const closed = !zone.open;
    frame.d = smoothPath(ring, closed, closed ? tension : 0);
    frame.bounds = boundsOf(ring);
  }

  classify(frame) {
    const { zone, look } = frame;
    frame.clip = look.strokeAlign === "inside" && !zone.halo && !zone.open;
    frame.haloed = zone.halo && frame.width > 0;
    frame.filled = zone.open ? false : zone.fill !== false && look.fillOpacity > 0;
    frame.paint = zone.fillColor || zone.color;
    frame.id = zone.id;
    frame.ink = zone.color;
  }

  emit(frame) {
    const { look } = frame;
    const opacities = { stroke: alpha(this.zones.strokeOpacity), fill: alpha(look.fillOpacity) };
    const recolor = look.fillMode === "recolor";
    if (frame.haloed) this.shapes.push(haloItem(frame, opacities.stroke));
    if (look.glow > 0 && frame.width > 0) this.glows.push(glowItem(frame));
    if (recolor && frame.filled) this.fills.push(recolorItem(frame, opacities.fill));
    const body = bodyItem(frame, recolor, opacities);
    if (frame.clip) body.clip = true;
    if (frame.dash !== null) {
      body.dash = frame.dash;
      body.lineCap = frame.zone.line === "dotted" ? "round" : "butt";
    }
    this.shapes.push(body);
  }

  // Подпись закрыта, если набор зон уступает показанному набору подписей точек.
  yielded(zone) {
    const entry = ZONE_SET_MAP[zone.group];
    const names = entry ? entry.captionSet : undefined;
    if (!names) return false;
    this.shownSets ??= shownLabelSets(this.config.markers);
    for (const name of [].concat(names)) if (this.shownSets.has(name)) return true;
    return false;
  }

  // Раскладка по фигуре; для подписи, сдвинутой человеком, и для открытой линии раскладки нет.
  layout(frame, face, text, spacing) {
    const { zone, look } = frame;
    const manual = zone.open || handShift(zone.labelOffset);
    const field = zone.width ?? look.strokeWidth;
    const inset = frame.clip ? field : field / 2;
    if (manual) return null;
    const { family, weight, wanted } = face;
    return zoneLabelFit(zone.id, frame.ring, text, family, weight, this.textAdvance, inset, wanted, spacing);
  }

  caption(frame) {
    const { zone, look, ring } = frame;
    const { zones, projector } = this;
    if (!zone.label || this.yielded(zone)) return;
    const style = zones.groupStyles?.[groupOf(zone)] || null;
    const moved = projector.point(pushedPoint(zone));
    const home = projector.point(zone.points[0]);
    const face = captionFace(style, zones, this.labelBase);
    const text = captionText(style, zone);
    const spacing = ((style && style.spacing) || 0) / 100;
    const fit = this.layout(frame, face, text, spacing);
    const size = fit ? fittedSize(face.wanted, fit) : face.wanted;
    const middle = fit ? { x: round(fit.x), y: round(fit.y) } : meanPoint(ring);
    const x = fit ? middle.x : drift(middle.x, moved.x, home.x);
    const y = fit ? middle.y : drift(middle.y, moved.y, home.y);
    const light = luminance(zones.labelColor) < LIGHT_BELOW;
    const busy = frame.filled && look.fillMode === "recolor" && look.fillOpacity >= BUSY_FROM && !light;
    const outline = zones.labelOutline > 0 ? zones.labelOutline : busy ? BUSY_OUTLINE : 0;
    const item = { kind: "text", id: `zone-label-${zone.id}` };
    const auto = zones.labelAuto && !(style && style.color);
    item.x = x;
    item.y = y;
    item.value = text;
    item.size = size;
    if (spacing) item.letterSpacing = round(size * spacing);
    if (fit && fit.angle) {
      item.rotation = round((fit.angle * 180) / Math.PI);
      item.origin = { x, y };
    }
    if (fit && fit.lines) {
      item.lines = fit.lines;
      item.lineStep = round(size * LABEL_LINE_STEP);
    }
    item.fill = captionFill(style, zones, zone, busy, light);
    item.family = face.family;
    item.weight = face.weight;
    item.anchor = "middle";
    item.baseline = "middle";
    item.stroke = captionStroke(zones, zone, busy);
    item.strokeWidth = round((size * outline) / 900);
    this.labels.push(withOwnOutline(withTone(item, toneBase(auto, zones, zone), this.tones), style));
  }
}

export const zoneItems = (config, projector, ...extras) => {
  const [shrink = 1, tones = null, textAdvance = null] = extras;
  const zones = config.zones;
  if (!zones.enabled) return sceneOf();
  return new ZonePass({ config, zones, projector, shrink, tones, textAdvance }).assemble();
};
