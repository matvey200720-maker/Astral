import { boxGap, boxGrid, isDot, unionFind } from "./parts.js";

export const GLYPH_MAX = 260;

const CAP_PX = 44;
const HALF_PI = Math.PI / 2;
const radians = (deg) => (deg * Math.PI) / 180;

const LOOKALIKES = new Map([
  ["A", "А"],
  ["B", "В"],
  ["C", "С"],
  ["E", "Е"],
  ["H", "Н"],
  ["K", "К"],
  ["M", "М"],
  ["O", "О"],
  ["P", "Р"],
  ["T", "Т"],
  ["X", "Х"],
  ["Y", "У"],
  ["a", "а"],
  ["c", "с"],
  ["e", "е"],
  ["o", "о"],
  ["p", "р"],
  ["x", "х"],
  ["y", "у"],
]);
const EDGE_PUNCTUATION = new Set([",", ".", ";", ":", "'", "\"", "`", "‘", "’", "«", "»", "“", "”", "„", "_", "!", "?"]);
const REJECTED_SYMBOLS = new Set(["%", "#", "©", "®", "‹", "›", "<", ">", "{", "}", "[", "]", "\\", "^", "*", "@", "$", "&", "=", "+", "~", "|", "?", "!"]);

const LATIN_RANGE = "A-Za-z";
const CYRILLIC_RANGE = "А-Яа-яЁё";
const charClass = (...ranges) => new RegExp(`[${ranges.join("")}]`);
const LETTER = charClass(LATIN_RANGE, CYRILLIC_RANGE);
const LETTER_OR_DIGIT = charClass(LATIN_RANGE, CYRILLIC_RANGE, "0-9");
const WORD_END = charClass(LATIN_RANGE, CYRILLIC_RANGE, "0-9№");
const CYRILLIC = charClass(CYRILLIC_RANGE);
const ALL_LETTERS = new RegExp(LETTER.source, "g");
const ALL_LATIN = new RegExp(`[${LATIN_RANGE}]`, "g");
const ALL_CYRILLIC = new RegExp(CYRILLIC.source, "g");
const ALL_ALNUM = new RegExp(LETTER_OR_DIGIT.source, "g");

/* ---------- Мелкие помощники: числа, отрезки, пары ---------- */

const range = (n) => {
  const out = [];
  while (out.length < n) out.push(out.length);
  return out;
};
const sum = (xs) => xs.reduce((acc, x) => acc + x, 0);
const half = (x) => x * 0.5;

const median = (xs, share = 0.5) => {
  if (!xs.length) return 0;
  const order = xs.slice().sort((a, b) => a - b);
  return order.at(Math.min(order.length - 1, Math.floor(order.length * share)));
};

/** Угол строки приводится к полуинтервалу [-π/2; π/2). */
const wrapHalfTurn = (x) => {
  const turn = x % Math.PI;
  if (turn < -HALF_PI) return turn + Math.PI;
  return turn >= HALF_PI ? turn - Math.PI : turn;
};

/** Отрезки по осям рамки: верхний край читается первым, поэтому дыра в массиве падает на u1. */
const U = (o) => {
  const hi = o.u1;
  return [o.u0, hi];
};
const span = ([lo, hi]) => hi - lo;
const middle = ([lo, hi]) => half(lo + hi);
const shared = ([a0, a1], [b0, b1]) => Math.min(a1, b1) - Math.max(a0, b0);

const keepLow = (now, value) => (value < now ? value : now);
const keepHigh = (now, value) => (value > now ? value : now);
const lowest = (items, key) => Math.min(...items.map((item) => item[key]));
const highest = (items, key) => Math.max(...items.map((item) => item[key]));
const matchesOf = (text, pattern) => String(text).match(pattern) ?? [];

/** Пересечение и расстояние двух отрезков, заданных числами (без временных пар). */
const overlap = (lo1, hi1, lo2, hi2) => Math.min(hi1, hi2) - Math.max(lo1, lo2);
const distance1 = (lo1, hi1, lo2, hi2) => Math.max(0, lo1 - hi2, lo2 - hi1);

/** Вектор между центрами двух кусков и направление по нему. */
const centreGap = (from, to) => Math.hypot(to.cx - from.cx, to.cy - from.cy);
const bearing = (from, to) => {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  return Math.atan2(dy, dx);
};

/** Оси строки при угле и проекция точки на них: u вдоль строки, v поперёк. */
const axesOf = (angle) => ({ c: Math.cos(angle), s: Math.sin(angle) });
const alongOf = (axes, point) => point[0] * axes.c + point[1] * axes.s;
const acrossOf = (axes, point) => -point[0] * axes.s + point[1] * axes.c;

/* ---------- Кластеры: правила связи — таблица «условие → зазор» ---------- */

const ratioOk = (x, y, k) => Math.min(x, y) >= Math.max(x, y) / k;
const smallFirst = (a, b) => (a.long <= b.long ? [a, b] : [b, a]);

const dashShape = (dash, other) =>
  dash.long <= other.long && [dash.short * 1.8, other.long / 3.5].every((floor) => dash.long >= floor);

const dashAimed = (dash, other) => {
  const turn = Math.abs(bearing(dash, other) - dash.angle) % Math.PI;
  return Math.min(turn, Math.PI - turn) <= radians(35);
};

const LINK_RULES = [
  {
    kind: "peer",
    fits: ({ small, big }) => ratioOk(small.long, big.long, 2.4),
    reach: ({ small }) => small.long * 0.75,
  },
  {
    kind: "peer",
    fits: ({ small, big }) => ratioOk(big.short, small.long, 1.4) && big.long >= big.short * 1.8,
    reach: ({ a, b, small }) => Math.min(small.long, Math.max(a.short, b.short)) * 0.75,
  },
  {
    kind: "peer",
    fits: ({ small, big }) => dashShape(small, big) && dashAimed(small, big),
    reach: ({ small }) => small.long * 0.75,
  },
  {
    kind: "mark",
    fits: ({ small, big }) => small.long <= big.long * 0.35 && small.long >= big.long / 8,
    reach: ({ big }) => big.long * 0.25,
  },
];

function linkBetween(a, b) {
  const [small, big] = smallFirst(a, b);
  const duo = { a, b, small, big };
  const rule = LINK_RULES.find((candidate) => candidate.fits(duo));
  return rule && boxGap(a, b) <= rule.reach(duo) ? rule.kind : null;
}

const mayPair = (a, b) =>
  a.group === b.group || ratioOk(a.long, b.long, 1.5) || dashShape(a, b) || dashShape(b, a);

/** Связи между кусками одного цвета: соседи по сетке, прошедшие предварительный отбор, и вид связи. */
function* linksIn(list) {
  const grid = boxGrid(list, 40);
  for (const [i, a] of list.entries()) {
    const near = [];
    grid.near(a, a.long * 0.8 + 1, (j) => near.push(j));
    const rivals = near.filter((j) => j > i).filter((j) => Math.abs(a.group.height - list[j].group.height) <= 3);
    for (const j of rivals.filter((k) => mayPair(a, list[k]))) {
      const kind = linkBetween(a, list[j]);
      if (kind) yield { kind, i, j };
    }
  }
}

function clusterSameColor(list) {
  const links = [...linksIn(list)];
  const peersOf = (index) =>
    links
      .filter((link) => link.kind === "peer" && [link.i, link.j].includes(index))
      .map((link) => link.i + link.j - index);
  const joined = unionFind(list.length);
  links.forEach(({ kind, i, j }) => {
    if (kind === "peer") return joined.join(i, j);
    const [small, big] = list[i].long <= list[j].long ? [i, j] : [j, i];
    const farther = peersOf(small).some((p) => boxGap(list[p], list[big]) > list[big].long * 0.25);
    return farther ? undefined : joined.join(small, big);
  });
  return joined.groups().map((group) => group.map((i) => list[i]));
}

const inkKey = (part) => `${part.group.color}|${part.group.alpha}`;

export function clustersOf(parts) {
  const keyed = [];
  for (const part of parts) keyed.push([inkKey(part), part]);
  const colours = new Map();
  keyed.forEach(([key, part]) => {
    const bucket = colours.get(key) ?? [];
    bucket.push(part);
    colours.set(key, bucket);
  });
  return [...colours.values()].flatMap(clusterSameColor);
}

/* ---------- Единицы (буквы из нескольких кусков) при заданном угле ---------- */

function frameOf(part, axes) {
  const frame = { part, u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
  for (const point of part.points) {
    const u = alongOf(axes, point);
    const v = acrossOf(axes, point);
    frame.u0 = keepLow(frame.u0, u);
    frame.u1 = keepHigh(frame.u1, u);
    frame.v0 = keepLow(frame.v0, v);
    frame.v1 = keepHigh(frame.v1, v);
  }
  frame.vc = half(frame.v0 + frame.v1);
  return frame;
}

/** Склеиваются ли рамки двух кусков в одну букву: пересечение по ширине и одно из трёх правил по высоте. */
function sameLetter(a, b) {
  const topA = a.u1;
  const topB = b.u1;
  const widthA = topA - a.u0;
  const widthB = topB - b.u0;
  if (overlap(a.u0, topA, b.u0, topB) < Math.min(widthA, widthB) * 0.5) return false;
  const heightA = a.v1 - a.v0;
  const heightB = b.v1 - b.v0;
  const tall = Math.max(heightA, heightB);
  const short = Math.min(heightA, heightB);
  const gap = distance1(a.v0, a.v1, b.v0, b.v1);
  const lowIsA = heightA <= heightB;
  const slim = lowIsA ? widthA : widthB;
  const fat = lowIsA ? widthB : widthA;
  return (
    overlap(a.v0, a.v1, b.v0, b.v1) > short * 0.5 ||
    (gap <= tall * 0.4 && short <= tall * 0.35 && slim <= fat * 0.85) ||
    (gap <= tall * 0.03 && short < tall * 0.5)
  );
}

function unitOf(members) {
  const top = members.reduce((best, m) => (m.v1 - m.v0 > best.v1 - best.v0 ? m : best));
  const reach = (top.v1 - top.v0) * 0.08;
  const box = { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
  const core = { lo: Infinity, hi: -Infinity };
  for (const m of members) {
    box.u0 = Math.min(box.u0, m.u0);
    box.u1 = Math.max(box.u1, m.u1);
    box.v0 = Math.min(box.v0, m.v0);
    box.v1 = Math.max(box.v1, m.v1);
    if (m === top || distance1(m.v0, m.v1, top.v0, top.v1) <= reach) {
      core.lo = Math.min(core.lo, m.v0);
      core.hi = Math.max(core.hi, m.v1);
    }
  }
  const unit = {
    members,
    parts: members.map((m) => m.part),
    core: core.hi - core.lo,
    u0: box.u0,
    u1: box.u1,
    v0: box.v0,
    v1: box.v1,
  };
  unit.vc = half(unit.v0 + unit.v1);
  return unit;
}

function unitsAt(cluster, angle) {
  const axes = axesOf(angle);
  const frames = cluster.map((part) => frameOf(part, axes));
  const joined = unionFind(frames.length);
  let i = 0;
  while (i < frames.length) {
    let j = i + 1;
    while (j < frames.length) {
      if (sameLetter(frames[i], frames[j])) joined.join(i, j);
      j += 1;
    }
    i += 1;
  }
  return joined.groups().map((group) => unitOf(group.map((k) => frames[k])));
}

/* ---------- Строки: крупные единицы по высоте, мелкие — к ближайшей ---------- */

class Row {
  constructor(first) {
    this.units = [];
    Object.assign(this, { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity, vc: first.vc });
    this.push(first);
  }

  push(unit) {
    this.units.push(unit);
    this.u0 = Math.min(this.u0, unit.u0);
    this.u1 = Math.max(this.u1, unit.u1);
    this.v0 = Math.min(this.v0, unit.v0);
    this.v1 = Math.max(this.v1, unit.v1);
    return this;
  }

  recentre() {
    this.vc = sum(this.units.map((u) => u.vc)) / this.units.length;
  }

  /** Цена «приставить» единицу к строке: расстояние по u считается вдвое дороже. */
  costOf(unit) {
    return distance1(unit.u0, unit.u1, this.u0, this.u1) * 2 + distance1(unit.v0, unit.v1, this.v0, this.v1);
  }
}

function rowsOf(units) {
  const letter = median(units.map((u) => u.core), 0.6) || 1;
  const isBig = (unit) => unit.core >= letter * 0.32;
  const stacked = units.filter(isBig).sort((a, b) => b.vc - a.vc).reduce((rows, unit) => {
    const last = rows.at(-1);
    if (last && last.vc - unit.vc <= letter * 0.5) last.push(unit).recentre();
    else rows.push(new Row(unit));
    return rows;
  }, []);
  const rows = units.filter((unit) => !isBig(unit)).reduce((all, unit) => {
    const [row, cost] = all.reduce(
      ([hit, best], candidate) => {
        const cost = candidate.costOf(unit);
        return cost < best ? [candidate, cost] : [hit, best];
      },
      [null, Infinity],
    );
    if (row && cost <= letter) row.push(unit);
    else all.push(new Row(unit));
    return all;
  }, stacked);
  const score = sum(rows.map((row) => row.v1 - row.v0)) / letter;
  return { rows: rows.sort((a, b) => b.vc - a.vc), score };
}

const layoutAt = (cluster, angle) => rowsOf(unitsAt(cluster, angle));

/** Буква строки и её крупные единицы (не ниже доли буквы). */
const rowFacts = (row, share) => {
  const letter = median(row.units.map((u) => u.core), 0.6) || 1;
  return { letter, big: row.units.filter((u) => u.core >= letter * share) };
};

/* ---------- Угол строки ---------- */

/** Ближайший по центру кусок схожего кегля. */
function neighbour(cluster, part) {
  let found = null;
  let nearest = Infinity;
  cluster.forEach((other) => {
    if (other === part || !ratioOk(part.long, other.long, 2.4)) return;
    const distance = centreGap(part, other);
    if (distance < nearest) {
      nearest = distance;
      found = other;
    }
  });
  return found;
}

/** Горизонтальная ли подпись: крупные единицы каждой строки лежат на одной линии. */
function levelAtZero(cluster) {
  const facts = layoutAt(cluster, 0).rows.map((row) => rowFacts(row, 0.6));
  const flatCount = ({ big, letter }) => {
    const mid = median(big.map((u) => u.vc));
    return big.length > 1 && big.every((u) => Math.abs(u.vc - mid) <= letter * 0.2) ? big.length : 0;
  };
  const all = sum(facts.map(({ big }) => big.length));
  return all >= 2 && sum(facts.map(flatCount)) >= all * 0.9;
}

const leanOf = (angle, a) => {
  const turn = (angle - a) % HALF_PI;
  const offset = turn < 0 ? turn + HALF_PI : turn;
  return Math.min(offset, HALF_PI - offset);
};

/** Углы-кандидаты: ось, общий наклон соседей и главная ось середин букв. */
function angleCandidates(cluster) {
  const [sx, sy] = cluster.reduce(([x, y], part) => {
    const near = neighbour(cluster, part);
    if (!near) return [x, y];
    const twice = 2 * bearing(part, near);
    return [x + Math.cos(twice), y + Math.sin(twice)];
  }, [0, 0]);
  const found = new Set([0, HALF_PI - 1e-9]);
  if (sx !== 0 || sy !== 0) {
    const mean = wrapHalfTurn(half(Math.atan2(sy, sx)));
    [-6, -3, 0, 3, 6].forEach((d) => found.add(wrapHalfTurn(mean + radians(d))));
  }
  const centre = (key) => sum(cluster.map((p) => p[key])) / cluster.length;
  const [mx, my] = [centre("cx"), centre("cy")];
  const offsets = cluster.map((p) => [p.cx - mx, p.cy - my]);
  const xx = sum(offsets.map(([dx]) => dx ** 2));
  const xy = sum(offsets.map(([dx, dy]) => dx * dy));
  const yy = sum(offsets.map(([, dy]) => dy ** 2));
  found.add(wrapHalfTurn(half(Math.atan2(xy * 2, xx - yy))));
  return [...found];
}

export function clusterAngle(cluster) {
  if (cluster.length < 2 || levelAtZero(cluster)) return 0;

  const slanted = cluster.filter((p) => p.long >= p.short * 1.3 && p.short > 0);
  const lean = (a) =>
    slanted.length < 2 ? 0 : (median(slanted.map((p) => leanOf(p.angle, a))) / (Math.PI / 4)) * 3;
  const flatBonus = (a) => (Math.abs(a) < 1e-6 ? -0.05 : 0);
  const scoreOf = (a) => [layoutAt(cluster, a).score, lean(a), flatBonus(a)].reduce((acc, part) => acc + part);

  /** Шаг доводки в одну сторону: до восьми раз, пока оценка заметно падает. */
  const polish = (state, step) => {
    let best = state;
    range(8).some(() => {
      const angle = wrapHalfTurn(best[0] + radians(half(step)));
      const score = scoreOf(angle);
      const stop = score >= best[1] - 1e-6;
      if (!stop) best = [angle, score];
      return stop;
    });
    return best;
  };
  const first = angleCandidates(cluster)
    .map((a) => [a, scoreOf(a)])
    .reduce((best, entry) => (entry[1] < best[1] ? entry : best));
  const [winner] = Math.abs(first[0]) > 1e-6 ? [1, -1].reduce(polish, first) : first;
  return Math.abs(winner) < radians(1.2) ? 0 : winner;
}

/* ---------- Строки подписи (отрезки) ---------- */

function segmentOf(items, row) {
  return {
    items,
    parts: items.flatMap((u) => u.parts),
    u0: lowest(items, "u0"),
    u1: highest(items, "u1"),
    v0: lowest(items, "v0"),
    v1: highest(items, "v1"),
    letter: median(items.map((u) => u.core), 0.6),
    row,
  };
}

const swing = (a, b) => Math.max(a, b) / Math.max(0.01, Math.min(a, b));

/** Строка режется на отрезки там, где зазор больше буквы или резко меняется кегль. */
function cutRow(units, row) {
  const ordered = [...units].sort((a, b) => a.u0 - b.u0);
  const letter = median(ordered.map((u) => u.core), 0.6);
  const end = ordered.reduce(
    (state, unit) => {
      const big = unit.core >= letter * 0.45;
      const own = state.cores.length ? median(state.cores) : unit.core;
      const jumped = big && state.cores.length > 0 && swing(unit.core, own) > 1.35;
      const fresh = big && state.items.length > 0 && (unit.u0 - state.reach > letter * 1.3 || jumped);
      const base = fresh
        ? { ...state, done: [...state.done, segmentOf(state.items, row)], items: [], cores: [] }
        : state;
      return {
        done: base.done,
        items: [...base.items, unit],
        cores: big ? [...base.cores, unit.core] : base.cores,
        reach: big ? Math.max(base.reach, unit.u1) : base.reach,
      };
    },
    { done: [], items: [], cores: [], reach: -Infinity },
  );
  return end.items.length ? [...end.done, segmentOf(end.items, row)] : end.done;
}

export function linesOf(cluster, angle) {
  return layoutAt(cluster, angle).rows.flatMap((row, index) => cutRow(row.units, index));
}

/* ---------- Черновики подписей ---------- */

/** Ровные крупные единицы отрезка: середина считается один раз, концы обрезаются, остаются не меньше трёх. */
function steadyRun(big, letter) {
  const mid = median(big.map((u) => u.vc));
  const steady = (unit) => Math.abs(unit.vc - mid) <= letter * 0.3;
  let [lo, hi] = [0, big.length];
  while (lo < hi && !steady(big[lo])) lo += 1;
  while (hi > lo && !steady(big[hi - 1])) hi -= 1;
  const rest = big.slice(lo, hi);
  return rest.length < 3 || !rest.every(steady) ? [] : rest;
}

/** Куски единиц отрезка, середины которых лежат в поле ±0.8 буквы от крайних ровных единиц (границы включены). */
function fieldParts(segment, rest) {
  const [from, to] = [rest[0].u0 - segment.letter * 0.8, rest.at(-1).u1 + segment.letter * 0.8];
  return segment.items
    .filter((unit) => middle([unit.u0, unit.u1]) >= from && middle([unit.u0, unit.u1]) <= to)
    .flatMap((unit) => unit.parts);
}

/** Правило «ровных строк» на отрезках одного угла: всего крупных единиц, ровных и собранные куски по порядку сбора. */
function levelOf(segments) {
  const runs = segments.map((segment) => {
    const big = segment.items.filter((unit) => unit.core >= segment.letter * 0.6);
    return { segment, big, rest: big.length < 3 ? [] : steadyRun(big, segment.letter) };
  });
  return {
    total: sum(runs.map(({ big }) => big.length)),
    even: sum(runs.map(({ rest }) => rest.length)),
    parts: runs.filter(({ rest }) => rest.length).flatMap(({ segment, rest }) => fieldParts(segment, rest)),
  };
}

/** Если в кластере слиты подписи под разными углами — делит его на собранные куски лучшего местного угла и остаток. */
function splitMixed(cluster, segments, depth) {
  const own = levelOf(segments);
  if (own.even >= own.total * 0.85) return null;
  const votes = cluster.reduce((tally, part) => {
    const near = neighbour(cluster, part);
    if (!near) return tally;
    const degrees = Math.round((wrapHalfTurn(bearing(part, near)) * 90) / Math.PI) * 2;
    return tally.set(degrees, (tally.get(degrees) ?? 0) + 1);
  }, new Map());
  const best = [...votes]
    .filter(([, count]) => count >= 2)
    .map(([degrees]) => levelOf(linesOf(cluster, wrapHalfTurn((degrees * Math.PI) / 180))))
    .reduce((top, found) => (!top || found.even > top.even ? found : top), null);
  if (!best || best.even < own.even + 3) return null;
  const taken = new Set(best.parts);
  const pieces = [best.parts, cluster.filter((part) => !taken.has(part))];
  return pieces.flatMap(clustersOf).flatMap((piece) => draftsOf(piece, depth + 1));
}

/** Границы между словами строки: зазор не меньше 0.6 буквы, и в соседней строке по обе стороны стоят разные отрезки. */
function* spaceCuts(segment, segments) {
  const tolerance = segment.letter * 0.2;
  const around = segments.filter((other) => {
    if (Math.abs(other.row - segment.row) !== 1) return false;
    const [upper, lower] = other.row < segment.row ? [other, segment] : [segment, other];
    return upper.v0 - lower.v1 <= Math.max(segment.letter, other.letter) * 0.95;
  });
  let reach = segment.items[0].u1;
  for (const [at, unit] of segment.items.entries()) {
    if (!at) continue;
    const gap = unit.u0 - reach;
    reach = Math.max(reach, unit.u1);
    if (gap < segment.letter * 0.6) continue;
    const cut = unit.u0 - gap / 2;
    const left = around.filter((o) => o.u1 <= cut + tolerance && o.u1 > segment.u0);
    const right = around.filter((o) => o.u0 >= cut - tolerance && o.u0 < segment.u1);
    if (left.some((l) => right.some((r) => r !== l && r.row === l.row))) yield at;
  }
}

function cutAtSpaces(segments) {
  return segments.flatMap((segment) => {
    const cuts = [...spaceCuts(segment, segments)];
    if (!cuts.length) return [segment];
    const edges = [0, ...cuts, undefined];
    return edges.slice(0, -1).map((from, k) => segmentOf(segment.items.slice(from, edges[k + 1]), segment.row));
  });
}

/** Строка встаёт под последнюю строку черновика, если кегль, зазор и положение подходят. */
const stacksUnder = (last, segment) => {
  const [ul, us] = [U(last), U(segment)];
  const bigger = Math.max(last.letter, segment.letter);
  const checks = [
    last.row !== segment.row,
    !(bigger / Math.min(last.letter, segment.letter) > 1.3),
    !(last.v0 - segment.v1 > bigger * 0.95),
    Math.abs(middle(ul) - middle(us)) <= Math.max(span(ul), span(us)) * 0.35 ||
      shared(ul, us) >= Math.min(span(ul), span(us)) * 0.6,
  ];
  return checks.every(Boolean);
};

/** Черновик, под последней строкой которого лучше всего встаёт отрезок (наибольшее перекрытие по u). */
function bestHost(drafts, segment) {
  const hosts = drafts.filter((draft) => stacksUnder(draft.lines.at(-1), segment));
  const overlapOf = (draft) => shared(U(draft.lines.at(-1)), U(segment));
  return hosts.reduce((best, draft) => (best && overlapOf(best) >= overlapOf(draft) ? best : draft), null);
}

function stackDrafts(segments, angle) {
  return segments.reduce((drafts, segment) => {
    const host = bestHost(drafts, segment);
    if (host) host.lines = [...host.lines, segment];
    return host ? drafts : [...drafts, { angle, lines: [segment] }];
  }, []);
}

function draftsOf(cluster, depth) {
  const angle = clusterAngle(cluster);
  const segments = linesOf(cluster, angle);
  const split = depth < 3 && cluster.length >= 6 ? splitMixed(cluster, segments, depth) : null;
  return split ?? stackDrafts(cutAtSpaces(segments), angle);
}

export function labelDrafts(parts) {
  const letters = parts.filter((part) => part.long <= GLYPH_MAX && part.area > 0.2 && !isDot(part));
  return clustersOf(letters).flatMap((cluster) => draftsOf(cluster, 0));
}

/* ---------- Растр строки для OCR ---------- */

/** Невязка точки (sx, sy) с ребром (qx, qy)–(rx, ry): знаковая площадь, из неё берутся веса. */
const edgeValue = (qx, qy, rx, ry, sx, sy) => (qx - sx) * (ry - sy) - (rx - sx) * (qy - sy);

/** Рёбра текущего треугольника: по семь чисел на ребро — ay, ax, нижний y, верхний y, наклон dx/dy, левый и правый x. */
const edgePlan = new Float64Array(21);
const PLAN_STRIDE = 7;

/** Записывает ребро (ax, ay)–(bx, by) в ячейку slot плана; горизонтальное помечается наклоном NaN. */
function planEdge(slot, ax, ay, bx, by) {
  const at = slot * PLAN_STRIDE;
  edgePlan[at] = ay;
  edgePlan[at + 1] = ax;
  edgePlan[at + 2] = ay < by ? ay : by;
  edgePlan[at + 3] = ay < by ? by : ay;
  edgePlan[at + 4] = ay === by ? NaN : (bx - ax) / (by - ay);
  edgePlan[at + 5] = ax < bx ? ax : bx;
  edgePlan[at + 6] = ax < bx ? bx : ax;
}

/**
 * Зарисовывает треугольник нулями (чернила). Для каждой строки растра границы берутся по рёбрам плана,
 * а клетки в пределах запаса в один пиксель проверяются точно: центр клетки с допуском внутри по барицентрическим весам.
 */
function paintTriangle(canvas, x1, y1, x2, y2, x3, y3) {
  const area = edgeValue(x2, y2, x3, y3, x1, y1);
  if (Math.abs(area) < 1e-9) return;
  const { data, width } = canvas;
  const colLo = Math.max(0, Math.floor(Math.min(x1, x2, x3)));
  const colHi = Math.min(width - 1, Math.ceil(Math.max(x1, x2, x3)));
  const rowLo = Math.max(0, Math.floor(Math.min(y1, y2, y3)));
  const rowHi = Math.min(canvas.height - 1, Math.ceil(Math.max(y1, y2, y3)));
  planEdge(0, x1, y1, x2, y2);
  planEdge(1, x2, y2, x3, y3);
  planEdge(2, x3, y3, x1, y1);
  let y = rowLo;
  while (y <= rowHi) {
    const sy = y + 0.5;
    let left = Infinity;
    let right = -Infinity;
    for (let at = 0; at < edgePlan.length; at += PLAN_STRIDE) {
      if (!(sy >= edgePlan[at + 2] - 1e-3 && sy <= edgePlan[at + 3] + 1e-3)) continue;
      const slope = edgePlan[at + 4];
      if (slope !== slope) continue;
      const raw = edgePlan[at + 1] + (sy - edgePlan[at]) * slope;
      const hit = Math.min(edgePlan[at + 6], Math.max(edgePlan[at + 5], raw));
      if (hit < left) left = hit;
      if (hit > right) right = hit;
    }
    const base = y * width;
    let x = Math.max(colLo, Math.floor(left) - 1);
    const last = Math.min(colHi, Math.ceil(right) + 1);
    while (x <= last) {
      const sx = x + 0.5;
      const w1 = edgeValue(x2, y2, x3, y3, sx, sy) / area;
      const w2 = edgeValue(x3, y3, x1, y1, sx, sy) / area;
      if (Math.min(w1, w2, 1 - w1 - w2) >= -1e-6) data[base + x] = 0;
      x += 1;
    }
    y += 1;
  }
}

/** Метка клетки, стёртой эрозией (до окончательного решения: вернуть чернила или оставить фоном). */
const ERASED = 254;

/** Рабочие списки утончения; растр один за раз, вызовы не вложены, поэтому буферы живут между вызовами. */
const lists = { front: new Int32Array(0), next: new Int32Array(0), erased: new Int32Array(0) };

function listsFor(size) {
  if (lists.erased.length < size) {
    Object.assign(lists, { front: new Int32Array(size), next: new Int32Array(size), erased: new Int32Array(size) });
  }
  return lists;
}

/**
 * Утончает жирный шрифт на месте и возвращает тот же массив. Эрозия идёт фронтом: на первом шаге стираются
 * внутренние чернила, у которых есть сосед не из чернил; на следующих — только те, что касаются клеток, стёртых шагом раньше.
 * Область чернил, стёртая целиком (дефис, точка), возвращается: стёртые клетки, не связанные цепочкой стёртых
 * с уцелевшей клеткой или рамкой растра, снова становятся чернилами.
 */
function thinInk(data, width, height) {
  const { front, next, erased } = listsFor(data.length);
  let ink = 0;
  let frontLen = 0;
  let row = 1;
  while (row <= height - 2) {
    const end = row * width + width - 1;
    let at = row * width + 1;
    while (at < end) {
      if (data[at] === 0) {
        ink += 1;
        if (data[at - 1] !== 0 || data[at + 1] !== 0 || data[at - width] !== 0 || data[at + width] !== 0) {
          front[frontLen] = at;
          frontLen += 1;
        }
      }
      at += 1;
    }
    row += 1;
  }
  if (!frontLen) return data;
  const steps = Math.min(3, Math.floor((((ink * 2) / frontLen) - CAP_PX / 7) / 2));
  if (!(steps > 0)) return data;

  const ring = Int32Array.of(-1, 1, -width, width);
  let erasedLen = 0;
  let current = front;
  let spare = next;
  let currentLen = frontLen;
  let step = 1;
  while (step <= steps) {
    let spareLen = 0;
    if (step === 1) {
      for (let k = 0; k < currentLen; k += 1) {
        data[current[k]] = ERASED;
        erased[erasedLen] = current[k];
        erasedLen += 1;
      }
    } else {
      // следующий слой: чернила (не на рамке растра) рядом с клетками, стёртыми шагом раньше
      for (let k = 0; k < currentLen; k += 1) {
        const near = current[k];
        for (let side = 0; side < 4; side += 1) {
          const cell = near + ring[side];
          if (data[cell] !== 0) continue;
          const column = cell % width;
          if (cell < width || cell >= data.length - width || column === 0 || column === width - 1) continue;
          data[cell] = ERASED;
          spare[spareLen] = cell;
          spareLen += 1;
          erased[erasedLen] = cell;
          erasedLen += 1;
        }
      }
      [current, spare] = [spare, current];
      currentLen = spareLen;
    }
    step += 1;
  }

  // стёртые клетки, дотягивающиеся цепочкой стёртых до чернил или рамки, остаются фоном; остальные возвращаются
  const stack = spare;
  let stackLen = 0;
  for (let k = 0; k < erasedLen; k += 1) {
    const cell = erased[k];
    if (data[cell - 1] === 0 || data[cell + 1] === 0 || data[cell - width] === 0 || data[cell + width] === 0) {
      data[cell] = 255;
      stack[stackLen] = cell;
      stackLen += 1;
    }
  }
  while (stackLen > 0) {
    stackLen -= 1;
    const cell = stack[stackLen];
    for (let side = 0; side < 4; side += 1) {
      const near = cell + ring[side];
      if (data[near] === ERASED) {
        data[near] = 255;
        stack[stackLen] = near;
        stackLen += 1;
      }
    }
  }
  for (let k = 0; k < erasedLen; k += 1) {
    if (data[erased[k]] === ERASED) data[erased[k]] = 0;
  }
  return data;
}

/** Размеры растра и перевод в пиксели: масштаб по высоте прописной, поле 0.8 буквы, зеркало при перевороте. */
function rasterFrame(line, flip, squeeze) {
  const letter = line.letter;
  const pad = 0.8 * letter;
  const scaleY = CAP_PX / Math.max(letter, 0.3);
  const scaleX = scaleY * squeeze;
  const [originU, originV] = flip ? [-line.u1, -line.v0] : [line.u0, line.v1];
  const cells = (lo, hi, scale) => Math.max(8, Math.ceil((hi - lo + 2 * pad) * scale));
  return {
    scaleX,
    scaleY,
    dir: flip ? -1 : 1,
    left: originU - pad,
    top: originV + pad,
    width: cells(line.u0, line.u1, scaleX),
    height: cells(line.v0, line.v1, scaleY),
  };
}

export function lineRaster(line, angle, flip = false, squeeze = 1) {
  const view = rasterFrame(line, flip, squeeze);
  const { width, height, scaleX, scaleY, dir, left, top } = view;
  const canvas = { width, height, data: new Uint8Array(width * height).fill(255) };
  const { c, s } = axesOf(angle);
  for (const part of line.parts) {
    const points = part.points;
    let first = 0;
    while (first < points.length) {
      const [p, q, r] = [points[first], points[first + 1], points[first + 2]];
      paintTriangle(
        canvas,
        ((p[0] * c + p[1] * s) * dir - left) * scaleX,
        (top - (-p[0] * s + p[1] * c) * dir) * scaleY,
        ((q[0] * c + q[1] * s) * dir - left) * scaleX,
        (top - (-q[0] * s + q[1] * c) * dir) * scaleY,
        ((r[0] * c + r[1] * s) * dir - left) * scaleX,
        (top - (-r[0] * s + r[1] * c) * dir) * scaleY,
      );
      first += 3;
    }
  }
  return { width, height, data: thinInk(canvas.data, width, height) };
}

/* ---------- Текст: шаги чистки слова идут конвейером ---------- */

/** «буква - буква» с пробелами вокруг дефиса превращается в «буква-буква». */
const DASH_JOIN = new RegExp(`(?<=[${LATIN_RANGE}${CYRILLIC_RANGE}0-9])\\s*[-–—]\\s*(?=[${LATIN_RANGE}${CYRILLIC_RANGE}0-9№])`, "g");

const trimEdges = (word) => {
  const chars = [...word];
  const keep = (ch) => !EDGE_PUNCTUATION.has(ch);
  const first = chars.findIndex(keep);
  return first < 0 ? "" : chars.slice(first, chars.findLastIndex(keep) + 1).join("");
};

/** Типичные ошибки OCR: «\/» → «V», «bI» → «Ы». */
const repairGlyphs = (word) => word.replaceAll("\\/", "V").replace(/[bЬ][Il|1]/g, "Ы");

/** Знак номера в начале слова и «1», принятые за «|», «I», «l». */
const repairNumber = (word) =>
  word.replace(/^[NН][oо°º]?(?=[0-9|Il])/, "№").replace(/(?<=[№0-9])[|Il](?=[0-9]|$)/g, "1");

/** Пара «тТ», «аА» — одна прописная (жадно, слева направо). */
const mergeTwins = (word) =>
  Array.from(word)
    .reduce((out, ch) => {
      const prev = out.at(-1);
      const twin = prev?.open && ch !== prev.ch && LETTER.test(prev.ch) && ch.toUpperCase() === prev.ch.toUpperCase();
      if (twin) out[out.length - 1] = { ch: prev.ch.toUpperCase(), open: false };
      else out.push({ ch, open: true });
      return out;
    }, [])
    .map((cell) => cell.ch)
    .join("");

const unmaskLatin = (russian) => (word) => {
  const latin = matchesOf(word, ALL_LATIN);
  const swap = latin.length > 0 && latin.every((ch) => LOOKALIKES.has(ch)) && (CYRILLIC.test(word) || russian);
  return swap ? word.replace(ALL_LATIN, (ch) => LOOKALIKES.get(ch)) : word;
};

export function normalizeLabelText(text, { russian = true, caps = false } = {}) {
  const steps = [trimEdges, repairGlyphs, repairNumber, mergeTwins, unmaskLatin(russian), (word) => (caps ? word.toUpperCase() : word)];
  return (text ? String(text) : "")
    .replace(DASH_JOIN, "-")
    .split(/\s+/)
    .map((raw) => steps.reduce((word, step) => step(word), raw))
    .filter((word) => WORD_END.test(word))
    .join(" ")
    .replace(/(^|\s)[NН][oо°º]?\s+(?=[0-9])/g, "$1№");
}

export function looksLikeText(text) {
  const compact = String(text || "").replace(/\s+/g, "");
  return LETTER_OR_DIGIT.test(compact) && !/^[|Il_—–.,:;'`~^-]+$/.test(compact);
}

/* ---------- Распознавание: выбор чтения по кругам ---------- */

const NOTHING = Object.freeze({ words: [], text: "", mean: -1 });

const colorKey = (part) => `${part.group.color}|${part.group.alpha}`;
const isStick = (part) => part.tris.length <= 4 && part.fill >= 0.85;
const hasWords = (entry) => Boolean(entry.words?.length);

/** Какое из двух слов (русское, английское) брать: правила проверяются по порядку. */
function pickWord(mine, other, caps) {
  const verdicts = [
    () => caps && !/^[A-Z0-9-]+$/.test(other.text) && mine,
    () => {
      const latin = matchesOf(other.text, ALL_LATIN);
      const foreign = latin.filter((ch) => !LOOKALIKES.has(ch)).length;
      return foreign < latin.length / 3 && mine.conf >= 40 && CYRILLIC.test(mine.text) && mine;
    },
    () => (other.conf > mine.conf + 8 ? other : mine),
  ];
  return verdicts.map((verdict) => verdict()).find(Boolean) ?? mine;
}

/** Склейка русского и английского прогонов по словам. */
function mergeReadings(russian, english, caps) {
  if (!hasWords(english)) return russian;
  if (!hasWords(russian)) return english;
  if (russian.words.length !== english.words.length) return english.mean > russian.mean + 10 ? english : russian;
  const words = russian.words.map((mine, i) => pickWord(mine, english.words[i], caps));
  return {
    words,
    text: words.map((word) => word.text).join(" "),
    mean: sum(words.map((word) => word.conf)) / Math.max(1, words.length),
  };
}

const readingScore = (readings) =>
  sum(readings.map(({ text, mean }) => {
    const letters = matchesOf(text, ALL_ALNUM).length;
    return letters ? Math.max(mean, 0) * Math.min(letters, 3) : 0;
  }));

/** Слово без повтора одной буквы и без смеси кириллицы с непохожей латиницей. */
function saneWord(word) {
  const letters = matchesOf(word, ALL_LETTERS);
  const twins = letters.length >= 3 && new Set(letters.map((ch) => ch.toUpperCase())).size === 1;
  const stranger = letters.some((ch) => /[A-Za-z]/.test(ch) && !LOOKALIKES.has(ch));
  return !twins && !(stranger && CYRILLIC.test(word));
}

/** Правдоподобно ли чтение: в текстовой группе достаточно неотрицательной уверенности, иначе — порог 70 и проверки. */
function plausible(raw, mean, caps, textual) {
  const text = normalizeLabelText(raw, { caps: false });
  if (!looksLikeText(text) || [...text].some((ch) => REJECTED_SYMBOLS.has(ch))) return false;
  if (textual) return !(mean < 0);
  const letters = matchesOf(text, ALL_LETTERS);
  const capital = letters.filter((ch) => ch === ch.toUpperCase()).length;
  return !(mean < 70) && !(caps && capital / letters.length < 0.8) && text.split(" ").every(saneWord);
}

const ACCENTED = { "И": "Й", "и": "й", "Е": "Ё", "е": "ё" };

/** Единица помечена, если над основной буквой стоит мелкий кусок (краткая или точки). */
const crowned = (unit) =>
  unit.members.length > 1 &&
  unit.members.some((member) => {
    const ceiling = highest(unit.members.filter((m) => m !== member), "v1");
    return member.v1 - member.v0 < unit.core * 0.35 && member.v0 >= ceiling - unit.core * 0.1;
  });

function fixAccents(text, line) {
  const marked = line.items.map(crowned);
  if (!marked.some(Boolean)) return text;
  const sizeOf = (ch) => (/^[Ыы]$/.test(ch) ? 2 : LETTER_OR_DIGIT.test(ch) ? 1 : 0);
  const chars = [...text];
  const starts = chars.map((_, k) => sum(chars.slice(0, k).map(sizeOf)));
  if (sum(chars.map(sizeOf)) !== line.items.length) return text;
  return chars
    .map((ch, k) => (sizeOf(ch) === 1 && marked[starts[k]] && ACCENTED[ch] ? ACCENTED[ch] : ch))
    .join("");
}

const LONE_ONES = new Set(["Т", "T", "I", "l", "|", "J", "Г"]);

function fixLoneOne(text, line) {
  const [unit] = line.items;
  const thin = line.items.length === 1 && (unit.u1 - unit.u0) / unit.core < 0.55;
  return text.length === 1 && LONE_ONES.has(text) && thin ? "1" : text;
}

class TextRow {
  constructor(id, line, angle) {
    Object.assign(this, { id, line, angle });
    this.steep = Math.abs(angle) >= radians(60);
    this.readable = !line.parts.every(isStick);
  }

  job(flip, squeeze) {
    return { id: this.id, ...lineRaster(this.line, this.angle, flip, squeeze) };
  }
}

/* ---------- Сведение подписей ---------- */

const NUMBER_HEADS = new Set(["N", "Н", "М", "M"]);

/** Оттенок по HSV-формуле; «бесцветный» — тёмный или малонасыщенный. */
function tone(hex) {
  const value = parseInt(String(hex).slice(1), 16);
  const [r, g, b] = [value >> 16, value >> 8, value].map((n) => (n & 255) / 255);
  const max = Math.max(r, g, b);
  const spread = max - Math.min(r, g, b);
  const sector = max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
  return { plain: max < 0.25 || (max ? spread / max : 0) < 0.3, hue: ((spread ? sector : 0) * 60 + 360) % 360 };
}

function closeTone(small, large) {
  const [a, b] = [tone(small), tone(large)];
  const gap = Math.abs(a.hue - b.hue);
  return a.plain || (!b.plain && Math.min(gap, 360 - gap) <= 25);
}

/** Подписи правее головы в той же строке (в осях головы), по возрастанию u: мелкий знак, затем цифры. */
function numberChain(head, labels, gone) {
  const [c, s] = [Math.cos(head.box.angle), Math.sin(head.box.angle)];
  const along = (label) => label.x * c + label.y * s;
  const across = (label) => -label.x * s + label.y * c;
  const ahead = labels
    .filter((l) => l !== head && !gone.has(l) && along(l) > along(head) &&
      Math.abs(across(l) - across(head)) <= head.height * 0.5)
    .sort((a, b) => along(a) - along(b));
  const chain = [];
  let reach = head.box.u1;
  for (const label of ahead) {
    const digits = /^[0-9]{1,3}$/.test(label.text) && label.height >= head.height * 0.75;
    const mark = chain.length === 0 && label.height <= head.height * 0.66;
    if (label.box.u0 - reach > head.height * 1.2 || !(digits || mark)) break;
    chain.push({ label, digits });
    reach = label.box.u1;
  }
  return chain;
}

/** «N», «о», «11» → «№11»: головной знак собирает правее стоящие мелкий знак и цифры. */
function gatherNumbers(labels) {
  const gone = new Set();
  labels.filter((label) => NUMBER_HEADS.has(label.text)).forEach((head) => {
    if (gone.has(head)) return;
    const chain = numberChain(head, labels, gone);
    const numerals = chain.filter((link) => link.digits);
    if (!numerals.length) return;
    const [c, s] = [Math.cos(head.box.angle), Math.sin(head.box.angle)];
    const u1 = highest(chain.map((link) => link.label.box), "u1");
    const [uc, vc] = [half(head.box.u0 + u1), half(head.box.v0 + head.box.v1)];
    Object.assign(head, {
      text: `№${numerals.map((link) => link.label.text).join("")}`,
      x: uc * c - vc * s,
      y: uc * s + vc * c,
      width: u1 - head.box.u0,
      conf: Math.min(head.conf, ...chain.map((link) => link.label.conf)),
      parts: [...head.parts, ...chain.flatMap((link) => link.label.parts)],
    });
    head.box.u1 = u1;
    chain.forEach(({ label }) => gone.add(label));
  });
  return labels.filter((label) => !gone.has(label));
}

/** Рамка подписи в мировых осях и признаки, нужные при сведении: считаются один раз на подпись. */
function foldFacts(label) {
  const { u0, u1, v0, v1, angle } = label.box;
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const xs = corners.map(([u, v]) => u * c - v * s);
  const ys = corners.map(([u, v]) => u * s + v * c);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return {
    x0,
    x1,
    y0,
    y1,
    area: (x1 - x0) * (y1 - y0),
    size: label.text.replace(/\s/g, "").length,
    top: highest(label.parts, "groupIndex"),
  };
}

/** Мелкая подпись другого цвета, не похожего на цвет большей, — не отделка. */
function strayTiny(a, b, factsA, factsB) {
  const aBig = factsA.size >= factsB.size;
  const [big, bigFacts] = aBig ? [a, factsA] : [b, factsB];
  const [little, littleFacts] = aBig ? [b, factsB] : [a, factsA];
  return littleFacts.size <= 2 && littleFacts.size < bigFacts.size * 0.4 && !closeTone(little.color, big.color);
}

/** Дубли и отделка (тени, ореолы) сводятся к одной подписи; чужие куски уходят в parts и decor. */
function foldDuplicates(labels) {
  const facts = new Map(labels.map((label) => [label, foldFacts(label)]));
  const order = [...labels].sort((a, b) => {
    const [fa, fb] = [facts.get(a), facts.get(b)];
    return fb.top - fa.top || b.conf - a.conf || b.text.length - a.text.length;
  });
  const gone = new Set();
  const relation = (label, other) => {
    const [mine, theirs] = [facts.get(label), facts.get(other)];
    const w = Math.min(mine.x1, theirs.x1) - Math.max(mine.x0, theirs.x0);
    if (!(w > 0)) return null;
    const h = Math.min(mine.y1, theirs.y1) - Math.max(mine.y0, theirs.y0);
    if (!(h > 0)) return null;
    const sameColor = other.color === label.color;
    if (sameColor ? other.text !== label.text : strayTiny(label, other, mine, theirs)) return null;
    if (!(w * h >= Math.min(mine.area, theirs.area) * 0.35)) return null;
    return sameColor ? "double" : "decor";
  };
  order.forEach((label) => {
    if (gone.has(label)) return;
    labels.forEach((other) => {
      if (other === label || gone.has(other)) return;
      const verdict = relation(label, other);
      if (!verdict) return;
      gone.add(other);
      label.parts.push(...other.parts);
      if (verdict === "decor") label.decor = [...(label.decor ?? []), ...other.parts];
    });
  });
  return labels.filter((label) => !gone.has(label));
}

function labelOf(draft, flip, kept) {
  const lines = kept.map((entry) => entry.row.line);
  const parts = lines.flatMap((line) => line.parts);
  const [u0, u1] = [lowest(lines, "u0"), highest(lines, "u1")];
  const [v0, v1] = [lowest(lines, "v0"), highest(lines, "v1")];
  const [uc, vc] = [half(u0 + u1), half(v0 + v1)];
  const [c, s] = [Math.cos(draft.angle), Math.sin(draft.angle)];
  const areas = new Map();
  parts.forEach((part) => areas.set(part.group.color, (areas.get(part.group.color) ?? 0) + part.area));
  const [color] = [...areas].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [undefined, -Infinity]);
  const degrees = ((draft.angle + (flip ? Math.PI : 0)) * 180) / Math.PI;
  return {
    text: kept.map((entry) => entry.text).join("\n"),
    x: uc * c - vc * s,
    y: uc * s + vc * c,
    height: median(lines.map((line) => line.letter)),
    width: u1 - u0,
    angle: ((((degrees + 180) % 360) + 360) % 360) - 180,
    color,
    conf: Math.min(...kept.map((entry) => entry.conf)),
    box: { u0, u1, v0, v1, angle: draft.angle },
    parts,
  };
}

export async function extractLabels(parts, recognize, { onProgress, debug = null } = {}) {
  const sheets = labelDrafts(parts).map((draft, d) => ({
    draft,
    rows: draft.lines.map((line, l) => new TextRow(`t${d}-${l}`, line, draft.angle)),
  }));
  const readable = sheets.flatMap((sheet) => sheet.rows).filter((row) => row.readable);

  const meter = { done: 0, total: readable.length };
  const tick = () => onProgress?.({ stage: "text", done: meter.done, total: meter.total });
  const onJob = () => {
    meter.done += 1;
    tick();
  };
  const ask = async (rows, langs, flip, squeeze) =>
    rows.length ? recognize(rows.map((row) => row.job(flip, squeeze)), { langs, onJob }) : new Map();
  const answer = (map, row) => map.get(row.id) ?? NOTHING;

  tick();
  const russian = await ask(readable, "rus", false, 1);
  meter.done = readable.length;

  const sure = [...russian.values()].filter((entry) => entry.mean >= 80 && matchesOf(entry.text, ALL_CYRILLIC).length >= 3);
  const capital = sure.filter((entry) => entry.text === entry.text.toUpperCase());
  const caps = sure.length >= 5 && capital.length / sure.length >= 0.8;

  const doubtful = readable.filter((row) => row.steep || answer(russian, row).mean < 75);
  const steep = doubtful.filter((row) => row.steep);
  meter.total = readable.length + doubtful.length * 3 + steep.length;
  const rounds = [
    ["english", doubtful, "eng", false, 1],
    ["squeezed", doubtful, "rus", false, 0.7],
    ["upsideRussian", doubtful, "rus", true, 1],
    ["upsideEnglish", steep, "eng", true, 1],
  ];
  const heard = {};
  for (const [name, rows, langs, flip, squeeze] of rounds) heard[name] = await ask(rows, langs, flip, squeeze);
  meter.done = meter.total;
  tick();

  const census = new Map();
  readable.forEach((row) => {
    const key = colorKey(row.line.parts[0]);
    const entry = answer(russian, row);
    const seen = census.get(key) ?? { lines: 0, sure: 0 };
    census.set(key, {
      lines: seen.lines + 1,
      sure: seen.sure + Number(entry.mean >= 80 && plausible(entry.text, entry.mean, caps, false)),
    });
  });
  const isTextual = (row) => {
    const { lines, sure: confident } = census.get(colorKey(row.line.parts[0]));
    return confident >= 3 || confident >= lines / 3;
  };

  const labels = [];
  for (const { draft, rows } of sheets) {
    const readings = rows.map((row) => {
      if (!row.readable) return { forward: NOTHING, backward: NOTHING };
      const merged = mergeReadings(answer(russian, row), answer(heard.english, row), caps);
      const quick = answer(heard.squeezed, row);
      return {
        forward: quick.mean > merged.mean + 5 ? quick : merged,
        backward: mergeReadings(answer(heard.upsideRussian, row), answer(heard.upsideEnglish, row), caps),
      };
    });
    const flip = readingScore(readings.map((r) => r.backward)) > readingScore(readings.map((r) => r.forward)) * 1.05;
    const side = flip ? "backward" : "forward";
    const pairs = rows.map((row, i) => ({ row, reading: readings[i][side] }));
    const ordered = flip ? pairs.reverse() : pairs;

    const kept = ordered
      .filter(({ row, reading }) => row.readable && plausible(reading.text, reading.mean, caps, isTextual(row)))
      .map(({ row, reading }) => {
        const text = normalizeLabelText(reading.text, { caps });
        return { row, text: flip ? text : fixLoneOne(fixAccents(text, row.line), row.line), conf: reading.mean };
      });
    debug?.push({
      lines: ordered.map(({ row }) => row.id + (flip ? "r" : "f")),
      texts: ordered.map(({ reading }) => reading.text),
      confs: ordered.map(({ reading }) => Math.round(reading.mean)),
      kept: kept.length,
      x: Math.round(ordered[0].row.line.parts[0].cx),
      y: Math.round(ordered[0].row.line.parts[0].cy),
    });
    if (kept.length) labels.push(labelOf(draft, flip, kept));
  }

  const finished = foldDuplicates(gatherNumbers(labels));
  const used = new Set(finished.flatMap((label) => label.parts));
  return { labels: finished, rest: parts.filter((part) => !used.has(part)), caps };
}
