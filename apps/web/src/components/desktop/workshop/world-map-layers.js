// Список слоёв «Большой карты»: проект превращается в плоские строки панели «Слои».
// Модуль чистый: ничего не пишет, не хранит между вызовами и не меняет проект.
import {
  MARKER_CATEGORY_MAP,
  isUserGroup,
  layerGroupOrder,
  mapGroups,
  mapGroupTitle,
} from "@modovik/vector-map";
import { tr } from "../../../locales/ui.js";
import { mapText, setTitle } from "./world-map/map-copy.js";

export const LAYER_SECTIONS = Object.freeze([
  Object.freeze({ id: "emblems", title: "Надписи и картинки" }),
  Object.freeze({ id: "markers", title: "Обозначения" }),
  Object.freeze({ id: "zones", title: "Зоны" }),
  Object.freeze({ id: "paint", title: "Рисунок" }),
]);

/** Набор обозначений крупнее этого делится на категории. */
export const SPLIT_FROM = 12;

const EMPTY_SET = new Set();
const EMPTY_PART = Object.freeze({ total: 0, shown: 0 });

const lower = (text) => text.toLocaleLowerCase("ru");
const plainName = (value) => String(value || "").trim();
const isEnabled = (item) => item.enabled !== false;

// ---------------------------------------------------------------------------
// Рамки объектов и кадра
// ---------------------------------------------------------------------------

function numericFrame(frame) {
  return {
    minX: Number(frame.minX),
    maxX: Number(frame.maxX),
    minY: Number(frame.minY),
    maxY: Number(frame.maxY),
  };
}

// Касание краем считается пересечением; с NaN любое сравнение ложно.
function touches(box, frame) {
  return (
    box.maxX >= frame.minX &&
    box.minX <= frame.maxX &&
    box.maxY >= frame.minY &&
    box.minY <= frame.maxY
  );
}

// Наименьшее и наибольшее значение, как Math.min/Math.max, но без спреда.
function extent(values) {
  let low = Infinity;
  let high = -Infinity;
  for (const raw of values) {
    const value = Number(raw);
    if (Number.isNaN(value)) return [NaN, NaN];
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return [low, high];
}

function pointsBox(points, pad) {
  const [minX, maxX] = extent(points.map((point) => point.x));
  const [minY, maxY] = extent(points.map((point) => point.y));
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}

function pointBox(item) {
  const x = Number(item.x);
  const y = Number(item.y);
  return { minX: x, maxX: x, minY: y, maxY: y };
}

function squareBox(item) {
  const half = (Number(item.width) || 0) / 2;
  const x = Number(item.x);
  const y = Number(item.y);
  return { minX: x - half, maxX: x + half, minY: y - half, maxY: y + half };
}

// ---------------------------------------------------------------------------
// Контекст одного расчёта: поиск, кадр, выделение, раскрытость
// ---------------------------------------------------------------------------

function makeContext(config, options) {
  const toggled = options.toggled || EMPTY_SET;
  const query = lower(String(options.query || "")).trim();
  const frame = options.frame ? numericFrame(options.frame) : null;
  const picked = options.picked;
  const chosen = picked && picked.length ? picked : options.selection ? [options.selection] : [];

  const selectedKeys = new Set();
  for (const target of chosen) selectedKeys.add(`${target.kind}:${target.id}`);
  const path = new Set();
  for (const target of chosen) {
    for (const key of layerPath(config, target)) path.add(key);
  }

  return {
    toggled,
    query,
    frame,
    filtering: query !== "" || frame !== null,
    path,
    isSelected: (kind, id) => selectedKeys.has(`${kind}:${id}`),
  };
}

// Поиск и кадр раскрывают всё; выделение побеждает закрытие человеком;
// ключ в toggled переворачивает умолчание.
function isOpen(ctx, key, byDefault) {
  const { toggled, path } = ctx;
  if (ctx.filtering || path.has(key)) return true;
  return toggled.has(key) ? !byDefault : byDefault;
}

function accepts(ctx, getTitle, getBox) {
  if (ctx.query && !lower(getTitle()).includes(ctx.query)) return false;
  return !ctx.frame || touches(getBox(), ctx.frame);
}

// ---------------------------------------------------------------------------
// Строки-объекты
// ---------------------------------------------------------------------------

function itemRow(ctx, kind, item, depth, view) {
  return {
    type: "item",
    key: `item:${kind}:${item.id}`,
    depth,
    target: { kind, id: item.id },
    title: view.title,
    visible: isEnabled(item),
    dim: view.dim || item.enabled === false,
    locked: Boolean(item.locked),
    inheritedLock: view.inheritedLock,
    selected: ctx.isSelected(kind, item.id),
    labelOn: view.labelOn,
    renamable: view.renamable,
    icon: view.icon,
    tint: view.tint,
  };
}

function titleOf(spec, entry) {
  if (entry.title === null) entry.title = spec.title(entry);
  return entry.title;
}

function categoryIcon(kind) {
  const glyph = MARKER_CATEGORY_MAP[kind]?.glyph;
  if (!glyph) return "glyph:dot";
  return glyph === "none" ? "label" : `glyph:${glyph}`;
}

const projectCategory = (section, kind) => section.categories?.[kind];

const zoneTitle = (item) => plainName(item.name) || tr("Зона");
const markerTitle = (item) => plainName(item.name) || tr("Точка");

function zoneRow(ctx, item, depth, scope) {
  return itemRow(ctx, "zone", item, depth, {
    title: zoneTitle(item),
    dim: scope.dim,
    inheritedLock: Boolean(scope.group.locked),
    labelOn: item.label !== false,
    renamable: true,
    icon: "zone",
    tint: item.color || null,
  });
}

function markerRow(ctx, item, depth, scope) {
  return itemRow(ctx, "marker", item, depth, {
    title: markerTitle(item),
    dim: scope.dim,
    inheritedLock: Boolean(scope.group.locked),
    labelOn: item.label !== false,
    renamable: true,
    icon: categoryIcon(item.category),
    tint: item.color || projectCategory(scope.section, item.category)?.color || null,
  });
}

// ---------------------------------------------------------------------------
// Надписи и мазки: плоский список от последнего к первому, свои группы
// ---------------------------------------------------------------------------

const FLAT = {
  emblems: {
    kind: "emblem",
    // kind читается первым и сразу: по нему же выбирается название
    describe: (item, index) => ({
      item,
      index,
      textual: item.kind === "text",
      title: null,
      hit: true,
    }),
    title: (entry) =>
      entry.textual
        ? String(entry.item.text || "")
            .replace(/\s*\n\s*/g, " ")
            .trim() || tr("Надпись")
        : mapText("Картинка {n}", { n: entry.index + 1 }),
    box: (entry) => squareBox(entry.item),
    row: (ctx, entry, depth, dim) => {
      const picture = entry.item.kind === "image";
      return itemRow(ctx, "emblem", entry.item, depth, {
        title: titleOf(FLAT.emblems, entry),
        dim,
        inheritedLock: false,
        labelOn: undefined,
        renamable: !picture,
        icon: picture ? "image" : "text",
        tint: picture ? null : entry.item.color || null,
      });
    },
    visible: (section, list) => list.some(isEnabled),
    sectionDim: () => false,
    openByDefault: () => true,
  },
  paint: {
    kind: "stroke",
    describe: (item, index) => ({ item, index, name: item.name, title: null, hit: true }),
    title: (entry) => plainName(entry.name) || mapText("Мазок {n}", { n: entry.index + 1 }),
    box: (entry) => pointsBox(entry.item.points, (entry.item.size || 0) / 2),
    row: (ctx, entry, depth, dim) =>
      itemRow(ctx, "stroke", entry.item, depth, {
        title: titleOf(FLAT.paint, entry),
        dim,
        inheritedLock: false,
        labelOn: undefined,
        renamable: true,
        icon: "stroke",
        tint: entry.item.color || null,
      }),
    visible: (section) => section.enabled !== false,
    sectionDim: (section) => section.enabled === false,
    // рисунок открыт сам, пока мазков не больше порога
    openByDefault: (list) => list.length <= SPLIT_FROM,
  },
};

function writeFlat(rows, ctx, id, section, slots) {
  const spec = FLAT[id];
  const dim = spec.sectionDim(section);
  for (const slot of slots) {
    if (!slot.members) {
      if (slot.hit) rows.push(spec.row(ctx, slot, 1, dim));
      continue;
    }
    const hits = slot.members.filter((entry) => entry.hit);
    if (hits.length === 0) continue;
    const key = `grp:${id}:${slot.group}`;
    const open = isOpen(ctx, key, false);
    rows.push({
      type: "group",
      key,
      depth: 1,
      icon: "group",
      user: true,
      section: id,
      group: slot.group,
      title: setTitle(mapGroupTitle(slot.group, section.groupTitles)),
      count: hits.length,
      of: ctx.filtering ? slot.members.length : null,
      open,
      visible: slot.members.some((entry) => isEnabled(entry.item)),
      locked: false,
      dim,
      ids: slot.members.map((entry) => entry.item.id),
      selected: slot.members.every((entry) => ctx.isSelected(spec.kind, entry.item.id)),
    });
    if (open) {
      for (const entry of hits) rows.push(spec.row(ctx, entry, 2, dim));
    }
  }
}

function flatPart(id, config, ctx) {
  const spec = FLAT[id];
  const section = config[id] || {};
  const list = section.items || [];
  if (!list.length) return EMPTY_PART;

  const entries = list.map(spec.describe);
  // порядок показа: одиночные записи и свои группы на месте верхнего члена
  const slots = [];
  const groups = new Map();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const group = entry.item.group;
    if (!isUserGroup(group)) {
      slots.push(entry);
      continue;
    }
    let set = groups.get(group);
    if (!set) {
      set = { group, members: [] };
      groups.set(group, set);
      slots.push(set);
    }
    set.members.push(entry);
  }

  let shown = entries.length;
  if (ctx.filtering) {
    shown = 0;
    for (const entry of entries) {
      entry.hit = accepts(
        ctx,
        () => titleOf(spec, entry),
        () => spec.box(entry),
      );
      if (entry.hit) shown += 1;
    }
  }

  return {
    total: entries.length,
    shown,
    visible: spec.visible(section, list),
    openByDefault: spec.openByDefault(list),
    write: (rows) => writeFlat(rows, ctx, id, section, slots),
  };
}

// ---------------------------------------------------------------------------
// Зоны и точки: наборы, у точек ещё категории
// ---------------------------------------------------------------------------

const SET_KINDS = {
  zones: {
    kind: "zone",
    title: zoneTitle,
    box: (item) => pointsBox(item.points, 0),
    row: zoneRow,
  },
  markers: {
    kind: "marker",
    title: markerTitle,
    box: pointBox,
    row: markerRow,
  },
};

// Набор делится на категории, когда точек больше порога и видов больше одного.
function splitsSet(items) {
  return items.length > SPLIT_FROM && new Set(items.map((item) => item.category)).size > 1;
}

const hitItems = (branch) =>
  branch.hit ? branch.items.filter((item, index) => branch.hit[index]) : branch.items;

function writeCategories(rows, ctx, branch, scope, depth) {
  const buckets = new Map();
  branch.items.forEach((item, index) => {
    let bucket = buckets.get(item.category);
    if (!bucket) {
      bucket = { kind: item.category, all: [], hit: [] };
      buckets.set(item.category, bucket);
    }
    bucket.all.push(item);
    if (!branch.hit || branch.hit[index]) bucket.hit.push(item);
  });

  for (const bucket of buckets.values()) {
    if (ctx.filtering && bucket.hit.length === 0) continue;
    const info = projectCategory(scope.section, bucket.kind);
    const key = `cat:markers:${scope.group.id}:${bucket.kind}`;
    const open = isOpen(ctx, key, false);
    rows.push({
      type: "category",
      key,
      depth,
      icon: categoryIcon(bucket.kind),
      tint: info?.color || null,
      section: "markers",
      group: scope.group.id,
      category: bucket.kind,
      title: tr(info?.title || MARKER_CATEGORY_MAP[bucket.kind]?.title || bucket.kind),
      count: bucket.hit.length,
      of: ctx.filtering ? bucket.all.length : null,
      open,
      visible: bucket.all.some(isEnabled),
      dim: scope.dim,
      ids: bucket.all.map((item) => item.id),
    });
    if (open) {
      for (const item of bucket.hit) rows.push(markerRow(ctx, item, depth + 1, scope));
    }
  }
}

function writeSets(rows, ctx, id, section, branches) {
  const spec = SET_KINDS[id];
  const sectionOff = section.enabled === false;
  for (const branch of branches) {
    if (ctx.filtering && branch.kept === 0) continue;
    const { group, items } = branch;
    const scope = { section, group, dim: sectionOff || group.visible === false };

    // свои значки без набора идут группами по виду прямо под разделом
    if (id === "markers" && group.id === "") {
      writeCategories(rows, ctx, branch, scope, 1);
      continue;
    }

    const user = isUserGroup(group.id);
    const key = `grp:${id}:${group.id}`;
    const open = isOpen(ctx, key, false);
    rows.push({
      type: "group",
      key,
      depth: 1,
      icon: user ? "group" : "set",
      user,
      section: id,
      group: group.id,
      title: setTitle(group.title),
      ids: items.map((item) => item.id),
      selected: items.every((item) => ctx.isSelected(spec.kind, item.id)),
      count: branch.kept,
      of: ctx.filtering ? items.length : null,
      open,
      visible: group.visible,
      locked: group.locked,
      labelOn: items.some((item) => item.label !== false),
      dim: sectionOff,
    });
    if (!open) continue;
    if (id === "markers" && splitsSet(items)) {
      writeCategories(rows, ctx, branch, scope, 2);
    } else {
      for (const item of hitItems(branch)) rows.push(spec.row(ctx, item, 2, scope));
    }
  }
}

function setsPart(id, config, ctx) {
  const spec = SET_KINDS[id];
  const section = config[id] || {};
  const list = section.items || [];
  if (!list.length) return EMPTY_PART;

  // члены наборов, от последнего к первому
  const members = new Map();
  for (let i = list.length - 1; i >= 0; i--) {
    const key = list[i].group || "";
    const bucket = members.get(key);
    if (bucket) bucket.push(list[i]);
    else members.set(key, [list[i]]);
  }

  // наборов, которых нет в порядке слоёв, идут первыми; сортируется копия
  const order = layerGroupOrder(id, section);
  const rank = (group) => order.indexOf(group.id === "" ? "own" : group.id);
  const sorted = mapGroups(config, id)
    .slice()
    .sort((a, b) => rank(a) - rank(b));

  let total = 0;
  let shown = 0;
  const branches = sorted.map((group) => {
    const items = members.get(group.id) || [];
    const hit = ctx.filtering
      ? items.map((item) =>
          accepts(
            ctx,
            () => spec.title(item),
            () => spec.box(item),
          ),
        )
      : null;
    const kept = hit ? hit.filter(Boolean).length : items.length;
    total += items.length;
    shown += kept;
    return { group, items, hit, kept };
  });

  return {
    total,
    shown,
    visible: section.enabled !== false,
    openByDefault: true,
    write: (rows) => writeSets(rows, ctx, id, section, branches),
  };
}

const COLLECT = {
  emblems: (config, ctx) => flatPart("emblems", config, ctx),
  markers: (config, ctx) => setsPart("markers", config, ctx),
  zones: (config, ctx) => setsPart("zones", config, ctx),
  paint: (config, ctx) => flatPart("paint", config, ctx),
};

// ---------------------------------------------------------------------------
// Публичные функции
// ---------------------------------------------------------------------------

export function buildLayerRows(config, options = {}) {
  const ctx = makeContext(config, options);
  const rows = [];
  let total = 0;
  let shown = 0;

  for (const section of LAYER_SECTIONS) {
    const part = COLLECT[section.id](config, ctx);
    total += part.total;
    shown += part.shown;
    if (part.shown === 0) continue;

    const key = `sec:${section.id}`;
    const open = isOpen(ctx, key, part.openByDefault);
    rows.push({
      type: "section",
      key,
      depth: 0,
      icon: section.id,
      section: section.id,
      title: tr(section.title),
      count: part.shown,
      of: ctx.filtering ? part.total : null,
      open,
      visible: part.visible,
      dim: false,
    });
    if (open) part.write(rows);
  }

  return { rows, total, shown };
}

const findItem = (config, id, itemId) => config[id]?.items.find((item) => item.id === itemId);

function flatPath(config, id, itemId) {
  const path = [`sec:${id}`];
  const item = findItem(config, id, itemId);
  if (item && isUserGroup(item.group)) path.push(`grp:${id}:${item.group}`);
  return path;
}

function zonePath(config, itemId) {
  const item = findItem(config, "zones", itemId);
  return item ? ["sec:zones", `grp:zones:${item.group || ""}`] : [];
}

function markerPath(config, itemId) {
  const item = findItem(config, "markers", itemId);
  if (!item) return [];
  const group = item.group || "";
  if (!group) return ["sec:markers", `cat:markers::${item.category}`];

  const path = ["sec:markers", `grp:markers:${group}`];
  const members = config.markers.items.filter((marker) => (marker.group || "") === group);
  if (splitsSet(members)) path.push(`cat:markers:${group}:${item.category}`);
  return path;
}

/** Ключи веток, которые надо раскрыть, чтобы показать объект. */
export function layerPath(config, target) {
  if (!target) return [];
  switch (target.kind) {
    case "emblem":
      return flatPath(config, "emblems", target.id);
    case "stroke":
      return flatPath(config, "paint", target.id);
    case "zone":
      return zonePath(config, target.id);
    case "marker":
      return markerPath(config, target.id);
    default:
      return [];
  }
}
