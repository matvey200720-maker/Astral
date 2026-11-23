/*
 * Развёрнутый радар («большая карта»): где встают элементы мини-карты.
 *
 * Одна арифметика на компилятор (`minimap-gfx-compiler.js`, `frameFor("big")`) и на просмотр «большая карта» в
 * редакторе. Устройство взято из minimap.gfx Steam Legacy (`resolveMinimapModel`, проверяется тестом на файле игры):
 *
 *  • сцена та же 191×136 точек; игра показывает её в `bigmap` крупнее в 2,43 раза и во всех направлениях одинаково
 *    (`bigmap` 0,364 × 0,4604 против `minimap` 0,15 × 0,1889 в frontend.xml);
 *  • радар в контейнере большой карты — 115×120 точек в (38, 8), а не 179×115 в (6, 8), как у малой;
 *  • матрица `healthArmourMC` большой карты — d = 0,418 (≈ 1/2,43): штатная толщина полос остаётся на экране прежней,
 *    длина штатных полос растёт вместе с радаром (a = 0,654).
 *
 * Правило раскладки (по долям радара, как всегда): длина полосы — доля ширины большого радара, толщина — малая,
 * умноженная на `scale` (на экране та же); центр — по доле радара, но **прижатый к ближнему краю**: элемент, что стоит
 * у верхнего (левого) края, остаётся у него же, у нижнего (правого) — у нижнего (правого). Часть элемента **за краем**
 * радара — вынос полос «сверху вплотную» — берётся в точках малой сцены и умножается на `scale`, как толщина, а не
 * на размер радара: радар большой карты по высоте крупнее малого в 2,5 раза на экране, и вынос по его доле уводил
 * полосы вверх, оставляя между ними и картой промежуток (10.11.2026, снимок 12 владельца). Штатные полосы под радаром
 * ложатся туда же, где у Rockstar стоят штатные.
 *
 * Значки и числа (11.11.2026, замечание ведущей по кадрам Х26 «число выше центра кольца, кольцо на полосе»):
 *
 *  • Размер. Значок и число — не полосы: на экране у них тот же размер, что в малом радаре, поэтому в сцене они меньше
 *    в `scale` раз **по обеим осям** (`kind: "mark"`). Раньше длина по x считалась как у полосы (доля ширины большого
 *    радара, 0,642 вместо 0,418), и значок у левого и правого края вставал на 0,11 своего размера не там, где нужно.
 *  • Соседи. Элементы группы HP, что в малой сцене лежат вплотную (зазор не больше `MINIMAP_BIG_NEAR` точек: число
 *    внутри кольца, кольцо в кольце, кольцо над полосой, число рядом со значком), держатся вместе: их общий **якорь** —
 *    самый дальний к краю радара из них — встаёт по правилу выше, а остальные значки и числа — на тех же расстояниях
 *    от него в точках малой сцены × `scale` (как размеры). Поэтому число, стоявшее в центре кольца, стоит в центре и в
 *    большом радаре, что не перекрывалось — не перекрывается, значок над полосой остаётся над полосой с зазором
 *    «малый зазор × scale». Полосы всегда встают по правилу выше сами, соседей у них нет — полосы без значков и чисел
 *    ложатся ровно так, как раньше. Полоса участвует в связи только по поперечной оси (горизонтальная — по высоте,
 *    вертикальная — по ширине): вдоль длины полосы её растягивает доля радара, а не `scale`.
 */

import { MINIMAP_RADAR, MINIMAP_VITAL_GROUP, minimapWidgetHalfExtent } from "./index.js";

/** Штатная геометрия развёрнутого радара, точки сцены (разобрано с minimap.gfx Steam Legacy). */
export const MINIMAP_BIG_STOCK = Object.freeze({
  radar: Object.freeze({ x: 38, y: 8, width: 115, height: 120 }),
  /** `d` матрицы `healthArmourMC` большого радара. */
  scale: 0.4179229736328125,
  /** `a` той же матрицы: во столько штатные полосы короче в сцене, чем в малой. */
  scaleX: 0.6536102294921875,
  /** Верх штатных полос под радаром: малая сцена и большая. */
  smallBarsTop: 126,
  barsTop: 125.75,
});

/**
 * Зазор в точках малой сцены, до которого два элемента группы HP считаются «вплотную» и ложатся в большом радаре
 * вместе. Штатный зазор между полосами и подписью — 2 точки; значок над полосой в раскладках стоит с зазором 1–2 точки.
 * Меньше 5,2 нельзя: значок с низом выше штатных полос меньше чем на 5,2 точки (по правилу края он вставал бы на полосу:
 * низ большого радара на 2,25 точки ниже верха штатных полос Rockstar, а внутри радара доли растягиваются в 1,043 раза).
 */
export const MINIMAP_BIG_NEAR = 6;

/** Малый радар по контракту — те же точки, что у редактора. */
const SMALL_RADAR = Object.freeze({ x: MINIMAP_RADAR.x, y: MINIMAP_RADAR.y, width: MINIMAP_RADAR.width, height: MINIMAP_RADAR.height });

/** Какого вида элемент: значок и число (`mark`) уменьшаются в `scale` раз по обеим осям, остальное — полоса. */
export const minimapBigKind = (key) => (/(Icon|Number)$/.test(String(key)) ? "mark" : "bar");

/**
 * Центр элемента на большом радаре и его размеры в единицах `geometry` (компилятор — твипы, просмотр — точки):
 * `{ x, y, length, thickness, halfX, halfY }`.
 *
 * `geometry`: `small` и `big` — радары `{ x, y, width, height }`, `scale` — `d` большой матрицы, `smallBarsTop` и
 * `barsTop` — верх штатных полос под радаром в малой и большой сцене.
 *
 * `kind`: `"bar"` (по умолчанию) — длина по доле большого радара, толщина малая × `scale`; `"mark"` — значок или число:
 * размер малый × `scale` по обеим осям, поворота нет. `sides` — сторона, к краю которой прижат элемент по каждой оси
 * (`{ x?: "low" | "high", y?: "low" | "high" }`); по умолчанию — ближняя к его центру. Её задаёт связь соседей: все
 * они встают по якорю с одной стороны.
 */
export function minimapBigPlace(widget, geometry, { thicknessScale = 1, kind = "bar", sides = null } = {}) {
  const { small, big, scale, smallBarsTop, barsTop } = geometry;
  const mark = kind === "mark";
  const across = mark ? 1 : thicknessScale;
  const half = minimapWidgetHalfExtent(mark ? { ...widget, rotation: 0 } : widget, across);
  const length = mark ? widget.width * small.width * scale : widget.width * big.width;
  const thickness = widget.height * small.height * across * scale;
  const radians = mark ? 0 : ((widget.rotation || 0) * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const halfX = (length * cosine + thickness * sine) / 2;
  const halfY = (length * sine + thickness * cosine) / 2;
  const along = (value, halfSmall, halfBig, origin, size, smallSize, side) => {
    const lowEdge = value - halfSmall;
    const highEdge = value + halfSmall;
    if ((side || (value < 0.5 ? "low" : "high")) === "low") {
      const edge = lowEdge < 0 ? lowEdge * smallSize * scale : lowEdge * size;
      return origin + edge + halfBig;
    }
    const edge = highEdge > 1 ? size + (highEdge - 1) * smallSize * scale : highEdge * size;
    return origin + edge - halfBig;
  };
  const x = along(widget.x, half.x, halfX, big.x, big.width, small.width, sides?.x);
  const under = widget.y - half.y >= 1;
  const y = under
    ? barsTop + (small.y + widget.y * small.height - smallBarsTop) * scale
    : along(widget.y, half.y, halfY, big.y, big.height, small.height, sides?.y);
  return { x, y, length, thickness, halfX, halfY };
}

/** Геометрия штатного файла в точках — для просмотра, которому разбирать minimap.gfx незачем. */
export const MINIMAP_BIG_GEOMETRY = Object.freeze({
  small: SMALL_RADAR,
  big: MINIMAP_BIG_STOCK.radar,
  scale: MINIMAP_BIG_STOCK.scale,
  smallBarsTop: MINIMAP_BIG_STOCK.smallBarsTop,
  barsTop: MINIMAP_BIG_STOCK.barsTop,
});

/* ---------------------------------------------------------------------------------------------------------------------------------------- */
/* Места всех элементов сразу: соседи держатся вместе                                                                                          */
/* ---------------------------------------------------------------------------------------------------------------------------------------- */

/** Оси, по которым элемент связывается с соседями: значок и число — по обеим, полоса — только поперёк (под углом — ни по одной). */
function linkAxes(item) {
  if (item.kind === "mark") return ["x", "y"];
  const radians = ((item.widget.rotation || 0) * Math.PI) / 180;
  if (Math.abs(Math.sin(radians)) < 0.01) return ["y"];
  if (Math.abs(Math.cos(radians)) < 0.01) return ["x"];
  return [];
}

/**
 * Места всех видимых элементов на большом радаре: каждому — `{ x, y, length, thickness, halfX, halfY }`, как у `minimapBigPlace`.
 * Полосы встают по своему правилу, значки и числа — по своему размеру и вместе с теми, кто лежит рядом (см. заголовок файла).
 *
 * `widgets` — `layout.widgets` проекта (после `normalizeMinimapLayout`: значок — квадрат, число — коробка по кеглю); невидимые
 * пропускаются. `thicknessScale` — «толщина полос» / 8, относится только к полосам.
 *
 * `custom` — места, которые человек поставил на большой карте сам (`layout.bigPlaces`: `{ <элемент>: { x, y } }`, центр в долях большого радара): они
 * главнее правила, остальные элементы идут по нему, как «Большая» наследует малую (владелец, 16.11.2026).
 */
export function minimapBigPlaces(widgets, geometry, { thicknessScale = 1, custom = null } = {}) {
  const { small, scale } = geometry;
  const places = {};
  const items = [];
  for (const [key, widget] of Object.entries(widgets || {})) {
    if (!widget || widget.visible === false) continue;
    const kind = minimapBigKind(key);
    places[key] = minimapBigPlace(widget, geometry, { thicknessScale, kind });
    if (!MINIMAP_VITAL_GROUP.includes(key)) continue;
    const half = minimapWidgetHalfExtent(kind === "mark" ? { ...widget, rotation: 0 } : widget, kind === "mark" ? 1 : thicknessScale);
    const item = {
      key,
      kind,
      widget,
      centre: { x: small.x + widget.x * small.width, y: small.y + widget.y * small.height },
      half: { x: half.x * small.width, y: half.y * small.height },
    };
    item.axes = linkAxes(item);
    items.push(item);
  }
  /* Единица измерения — как у радара: точки у просмотра, твипы у компилятора. */
  const near = MINIMAP_BIG_NEAR * (small.width / MINIMAP_RADAR.width);
  const gap = (a, b, axis) => Math.max(0, Math.max(a.centre[axis] - a.half[axis], b.centre[axis] - b.half[axis]) - Math.min(a.centre[axis] + a.half[axis], b.centre[axis] + b.half[axis]));
  for (const axis of ["x", "y"]) {
    const members = items.filter((item) => item.axes.includes(axis));
    /* Связные группы: два элемента рядом, если вплотную по обеим осям. */
    const parent = members.map((_, at) => at);
    const root = (at) => {
      while (parent[at] !== at) at = parent[at] = parent[parent[at]];
      return at;
    };
    for (let a = 0; a < members.length; a += 1)
      for (let b = a + 1; b < members.length; b += 1)
        if (gap(members[a], members[b], "x") <= near && gap(members[a], members[b], "y") <= near) parent[root(b)] = root(a);
    const groups = new Map();
    members.forEach((item, at) => groups.set(root(at), [...(groups.get(root(at)) || []), item]));
    const origin = small[axis];
    const size = axis === "x" ? small.width : small.height;
    for (const group of groups.values()) {
      if (group.length < 2 || !group.some((item) => item.kind === "mark")) continue;
      const low = Math.min(...group.map((item) => item.centre[axis] - item.half[axis]));
      const high = Math.max(...group.map((item) => item.centre[axis] + item.half[axis]));
      const side = (low + high) / 2 - origin < size / 2 ? "low" : "high";
      /* Якорь — самый дальний к краю; при равенстве полоса: её место известно по штатным правилам. */
      const outward = (item) => (side === "low" ? -(item.centre[axis] - item.half[axis]) : item.centre[axis] + item.half[axis]);
      const anchor = group.reduce((best, item) => {
        const gain = outward(item) - outward(best);
        return gain > 1e-9 || (Math.abs(gain) <= 1e-9 && item.kind === "bar" && best.kind !== "bar") ? item : best;
      });
      const anchorAt =
        anchor.kind === "bar"
          ? places[anchor.key][axis]
          : minimapBigPlace(anchor.widget, geometry, { kind: "mark", sides: { [axis]: side } })[axis];
      for (const item of group) {
        if (item.kind !== "mark") continue;
        places[item.key] = { ...places[item.key], [axis]: item === anchor ? anchorAt : anchorAt + (item.centre[axis] - anchor.centre[axis]) * scale };
      }
    }
  }
  const { big } = geometry;
  for (const [key, own] of Object.entries(custom || {})) {
    if (!places[key] || !own) continue;
    places[key] = { ...places[key], x: big.x + own.x * big.width, y: big.y + own.y * big.height };
  }
  return places;
}

/**
 * Раскладка для просмотра «большая карта»: на каждый элемент — прямоугольник на сцене (точки, центр и размеры до
 * поворота) и в долях большого радара (`fx`, `fy` — центр, `fw`, `fh` — размеры до поворота), угол поворота. Радар
 * на сцене — `MINIMAP_BIG_STOCK.radar`; на экране сцена крупнее малой в 2,43 раза, поэтому для рисования достаточно
 * масштаба «точка сцены → пиксель», один на обе оси.
 *
 * `widgets` — `layout.widgets` проекта (после `normalizeMinimapLayout`); невидимые элементы пропускаются.
 */
export function minimapBigLayout(widgets, { thicknessScale = 1, custom = null } = {}) {
  const radar = MINIMAP_BIG_STOCK.radar;
  const items = {};
  const places = minimapBigPlaces(widgets, MINIMAP_BIG_GEOMETRY, { thicknessScale, custom });
  for (const [key, widget] of Object.entries(widgets || {})) {
    const place = places[key];
    if (!place) continue;
    items[key] = {
      x: place.x,
      y: place.y,
      width: place.length,
      height: place.thickness,
      rotation: widget.rotation || 0,
      fx: (place.x - radar.x) / radar.width,
      fy: (place.y - radar.y) / radar.height,
      fw: place.length / radar.width,
      fh: place.thickness / radar.height,
    };
  }
  return { radar: { ...radar }, scale: MINIMAP_BIG_STOCK.scale, widgets: items };
}
