import packCategoryFile from "../pack-categories.json" with { type: "json" };
import overlayFile from "../pack-overlays.json" with { type: "json" };
import zoneFile from "../pack-zones.json" with { type: "json" };
import rulesFile from "./category-rules.json" with { type: "json" };
import { PACK_GLYPHS } from "../pack-overlays.js";
import { packMasks, pathMask, sameSilhouette } from "./silhouettes.js";
import { darkTint } from "./parts.js";

const CATEGORY_TITLES = Object.freeze(Object.fromEntries([
  ["places", "Места"],
  ["roads", "Дороги и мосты"],
  ["gov", "Госструктуры"],
  ["work", "Работы"],
  ["business", "Бизнесы"],
  ["homes", "Дома"],
  ["events", "ВЗП и ВЗХ"],
  ["climb", "Залазы"],
  ["misc", "Прочее"],
]));

const CRIME_TITLES = Object.freeze(Object.fromEntries([
  ["gta5rp", "Гетто GTA 5 RP"],
  ["majestic", "Капты Majestic"],
  ["", "Гетто и капты"],
]));

const PACK_KEYS = Object.freeze(Object.fromEntries([
  ["redux-ghetto-points", "ghetto"],
  ["gucci-ghetto-points", "ghetto"],
  ["redux-site-points", "sites"],
  ["redux-trucks", "truck-box"],
  ["gucci-trucks", "truck"],
  ["redux-cases", "case-x"],
  ["gucci-vzh-jeeps", "jeep"],
  ["redux-sites", "sites"],
  ["redux-events", "events"],
  ["redux-gta5rp-zones", "redgold"],
  ["mcl-territories", "crime"],
]));

const POINT_TITLES = Object.freeze(Object.fromEntries([
  ["ghetto", "Точки гетто"],
  ["capt", "Точки каптов"],
  ["sites", "Точки площадок"],
  ["numbered", "Точки с номерами"],
  ["dots", "Точки"],
]));

const ICON_TITLES = Object.freeze(Object.fromEntries([
  ["truck-box", "Грузовики"],
  ["truck", "Грузовики"],
  ["case-x", "Чемоданы"],
  ["jeep", "Джипы"],
  ["spray", "Баллончики"],
  ["", "Значки"],
]));

const ZONE_TITLES = Object.freeze(Object.fromEntries([
  ["sites", "Площадки"],
  ["events", "Зоны мероприятий"],
  ["redgold", "Красные и золотые зоны"],
  ["crime", "Территории"],
  ["gov", "Зоны госструктур"],
  ["work", "Промзоны"],
  ["business", "Зоны бизнесов"],
  ["homes", "Жилые зоны"],
  ["quarters", "Контуры кварталов"],
  ["circles", "Круги госов и крафта"],
  ["other", "Прочее"],
]));

const ZONE_TEMPLATES = Object.freeze(Object.fromEntries([
  ["rings", "{0}"],
  ["lines", "{0} · линии"],
  ["areas", "{0} · заливка"],
]));

const HUE_LIMITS = [15, 40, 70, 160, 200, 250, 290, 345, 360];
const HUE_IDS = ["red", "orange", "yellow", "green", "cyan", "blue", "violet", "pink", "red"];
const HUE_TITLES = ["красные", "оранжевые", "жёлтые", "зелёные", "голубые", "синие", "фиолетовые", "розовые", "красные"];
const HUE_BOUNDS = Object.freeze(HUE_LIMITS.map((limit, k) => [limit, HUE_IDS[k], HUE_TITLES[k]]));

const MERGED_KINDS = Object.freeze(Object.fromEntries([
  ["city", ["gov", "business", "homes"]],
  ["places", ["places", "roads"]],
  ["climb", ["climb", "misc"]],
]));

const YI_SWAP = Object.freeze(Object.fromEntries([
  ["Ь", "Ы"],
  ["Ы", "Ь"],
  ["ь", "ы"],
  ["ы", "ь"],
]));

const ZONE_TO_LABEL = Object.freeze(Object.fromEntries([
  ["sites", "events"],
  ["events", "events"],
  ["redgold", "crime"],
  ["crime", "crime"],
  ["gov", "gov"],
  ["work", "work"],
  ["business", "business"],
  ["homes", "homes"],
]));

const NEARBY_RADIUS = 300;

const REFERENCE_LABEL_REACH = 120;

/* ---------- Мелкие помощники ---------- */

/** Ленивый кэш: значение строится при первом обращении и дальше не меняется. */
const once = (build) => {
  const cell = [];
  return () => (cell.length ? cell[0] : (cell[0] = build()));
};

const range = (n) => {
  const out = [];
  while (out.length < n) out.push(out.length);
  return out;
};

/** Счётчики по ключам в порядке первого появления. */
const tally = (keys) => keys.reduce((counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1), new Map());

/** Запись с наибольшим счётом; при равенстве остаётся первая. */
const leader = (counts) => [...counts].reduce((best, entry) => (!best || entry[1] > best[1] ? entry : best), null);

const sumOf = (xs) => xs.reduce((acc, x) => acc + x, 0);

/** Расстояние между двумя объектами с полями x и y. */
const planar = (a, b) => {
  const [dx, dy] = [a.x - b.x, a.y - b.y];
  return Math.hypot(dx, dy);
};

/* ---------- Правила по тексту ---------- */

const WORD_CLASS = "[\\p{L}\\p{N}_]";
const WORD_EDGE = `(?:(?<=${WORD_CLASS})(?!${WORD_CLASS})|(?<!${WORD_CLASS})(?=${WORD_CLASS}))`;
const SUBSTITUTIONS = [["\\b", WORD_EDGE], ["\\w", WORD_CLASS]];

/** Шаблон из JSON → выражение: \b и \w понимают кириллицу, флаг только u. */
const compileTemplate = (template) =>
  new RegExp(SUBSTITUTIONS.reduce((text, [from, to]) => text.replaceAll(from, to), template), "u");

const RULES = rulesFile.rules.map(([category, template]) => [category, compileTemplate(template)]);
const SLANG = Object.fromEntries(["gta5rp", "majestic"].map((name) => [name, compileTemplate(rulesFile.slang[name])]));

const GTA5RP_TITLE = /GTA\s*5\s*RP|ГТА\s*5\s*РП/i;
const MAJESTIC_TITLE = /MAJESTIC|МАДЖЕСТИК|МАЖЕСТИК|GNEV|ГНЕВ/i;

const COLOR_MEANINGS = [
  [(text) => text.includes("КРАЙМ"), "crime"],
  [(text) => /(^|[^А-ЯЁ])ГОС/.test(text), "gov"],
  [(text) => text.includes("АРЕНД"), "business"],
  [(text) => text.includes("КАПТ"), "crime"],
  [(text) => text.includes("ГЕТТО"), "crime"],
  [(text) => /ВЗ[ПХ]/.test(text), "events"],
];

const KEY_SET = "0-9A-ZА-Я";
const NOT_KEY = new RegExp(`[^${KEY_SET}]`, "g");
const KEY_BREAKS = new RegExp(`[^${KEY_SET}]+`);
const KEY_LETTER = /[A-ZА-Я]/;
const upperRu = (text) => `${text}`.toLocaleUpperCase("ru").replaceAll("Ё", "Е");
const labelKey = (text) => upperRu(text).replaceAll("№", "").replace(NOT_KEY, "");
const flatText = (text) => upperRu(`${text}`.replaceAll("\n", " "));
const wordsOf = (text) => upperRu(text).split(KEY_BREAKS).filter(Boolean);
const hasLetter = (word) => KEY_LETTER.test(word);
const WORD_RUN = /[0-9A-Za-zА-Яа-яЁё]+/g;

/* ---------- Геометрия: точки — пары [x, y] ---------- */

const minus = ([ax, ay], [bx, by]) => [ax - bx, ay - by];
const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** Луч вправо: нечётное число пересекаемых рёбер — внутри. */
function contains(ring, [x, y]) {
  const crossing = ([xi, yi], [xj, yj]) => {
    const straddles = (yi > y) !== (yj > y);
    const edgeX = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    return straddles && x < edgeX;
  };
  const hits = ring.filter((vertex, i) => crossing(vertex, ring[(i + ring.length - 1) % ring.length]));
  return hits.length % 2 === 1;
}

/** Расстояние от точки до замкнутого контура — наименьшее по звеньям. */
function distanceToRing(point, ring) {
  const segments = ring.map((start, i) => [start, ring[(i + 1) % ring.length]]);
  return segments.reduce((nearest, [a, b]) => {
    const d = minus(b, a);
    const rel = minus(point, a);
    const length2 = d[0] * d[0] + d[1] * d[1];
    const t = length2 ? clamp01((rel[0] * d[0] + rel[1] * d[1]) / length2) : 0;
    return Math.min(nearest, Math.hypot(rel[0] - t * d[0], rel[1] - t * d[1]));
  }, Infinity);
}

/** Рамка по точкам; точки читаются через for…of, чтобы не итерируемый вход падал с понятным текстом. */
function boundsOf(points) {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of points) {
    Object.assign(box, {
      x0: Math.min(box.x0, x),
      y0: Math.min(box.y0, y),
      x1: Math.max(box.x1, x),
      y1: Math.max(box.y1, y),
    });
  }
  return box;
}

const sideOf = (box, axis) => box[`${axis}1`] - box[`${axis}0`];
const areaOf = (box) => Math.max(1, sideOf(box, "x") * sideOf(box, "y"));
const overlapAlong = (a, b, axis) => Math.min(a[`${axis}1`], b[`${axis}1`]) - Math.max(a[`${axis}0`], b[`${axis}0`]);

/* ---------- Справочные данные паков (строятся один раз) ---------- */

const referenceLabels = once(() => {
  const entries = packCategoryFile.categories.flatMap(({ id, items }) => {
    const kind = id.replace(/^(?:majestic|gta5rp)-/, "");
    const category = kind.startsWith("crime") ? "crime" : kind;
    return items.map(([text, x, y]) => [labelKey(text), { x, y, category }]);
  });
  return entries.reduce((byKey, [key, entry]) => byKey.set(key, [...(byKey.get(key) ?? []), entry]), new Map());
});

const referenceMarkers = once(() =>
  overlayFile.markerSets
    .filter((set) => PACK_KEYS[set.id])
    .flatMap((set) => {
      const numbered = set.itemFormat.startsWith("[номер");
      return set.items.map((item) => {
        const body = numbered ? item.slice(1) : item;
        return { key: PACK_KEYS[set.id], x: body[0], y: body[1], size: body[2], dot: set.glyph === "dot", glyph: set.glyph };
      });
    }),
);

const ringOfCircle = ([cx, cy, r]) =>
  range(48).map((k) => [cx + r * Math.cos((k * Math.PI) / 24), cy + r * Math.sin((k * Math.PI) / 24)]);

const referenceZones = once(() => {
  const fromSets = overlayFile.zoneSets
    .filter((set) => PACK_KEYS[set.id])
    .flatMap((set) => set.zones.filter((zone) => zone.points.length >= 3).map((zone) => ({ key: PACK_KEYS[set.id], points: zone.points })));
  const circles = zoneFile.majesticCircles.map((circle) => ({ key: "circles", points: ringOfCircle(circle) }));
  return [...fromSets, ...circles].map((ref) => ({ ...ref, box: boundsOf(ref.points) }));
});

const vocabulary = once(() => {
  const words = new Set(
    packCategoryFile.categories.flatMap(({ items }) => items.flatMap(([text]) => wordsOf(text).filter(hasLetter))),
  );
  // Начала и концы слов: «обрывок» — то, что короче слова словаря и стоит у него с краю.
  const edges = new Set(
    [...words].flatMap((word) => range(word.length - 3).flatMap((k) => [word.slice(0, k + 3), word.slice(word.length - k - 3)])),
  );
  return { words, edges };
});

const iconSilhouettes = once(() =>
  packMasks(Object.fromEntries(
    Object.entries(PACK_GLYPHS).filter(([name]) => name !== "pack-dot").map(([name, path]) => [name.replace(/^pack-/, ""), path]),
  )),
);

/* ---------- Подписи ---------- */

export const labelCategory = (text) => {
  const flat = flatText(text);
  return rulesFile.override[labelKey(text)] || RULES.find(([, pattern]) => pattern.test(flat))?.[0] || "misc";
};

export function vocabularyFix(text) {
  const { words } = vocabulary();
  let doubtful = false;
  const variantsOf = (word) =>
    [...word]
      .map((ch, at) => (YI_SWAP[ch] ? word.slice(0, at) + YI_SWAP[ch] + word.slice(at + 1) : null))
      .filter((variant) => variant && words.has(upperRu(variant)));
  const fix = (word) => {
    const variants = variantsOf(word);
    if (words.has(upperRu(word)) && variants.length) doubtful = true;
    if (!variants.length || words.has(upperRu(word))) return word;
    return variants.length === 1 ? variants[0] : word;
  };
  return { text: `${text}`.replace(WORD_RUN, fix), doubtful };
}

/** Слово не из словаря: одиночная русская буква (кроме предлогов), либо край длинного слова. */
function isFragment(word, count, { words, edges }) {
  if (words.has(word) || !hasLetter(word)) return false;
  if (word.length === 1) return count > 1 && /[А-Я]/.test(word) && !"ВСКИУОАЯ".includes(word);
  return edges.has(word);
}

export function looksBroken(text) {
  const raw = `${text}`;
  const vocab = vocabulary();
  const words = wordsOf(raw);
  const checks = [
    () => raw.split(/\s+/).some((chunk) => /[A-Za-z]/.test(chunk) && /[А-Яа-яЁё]/.test(chunk)),
    () => words.length === 1 && /^[A-ZА-Я]$/.test(words[0]) && !vocab.words.has(words[0]),
    () => vocabularyFix(raw).doubtful,
    () => words.some((word) => isFragment(word, words.length, vocab)),
  ];
  return checks.some((check) => check());
}

export function serverOf(title, labels = []) {
  if (GTA5RP_TITLE.test(title)) return "gta5rp";
  if (MAJESTIC_TITLE.test(title)) return "majestic";
  const flats = [...labels].map((label) => flatText(label.text));
  const score = (name) => flats.filter((flat) => SLANG[name].test(flat)).length;
  const [gta5rp, majestic] = [score("gta5rp"), score("majestic")];
  if (Math.max(gta5rp, majestic) < 2 || gta5rp === majestic) return "";
  return gta5rp > majestic ? "gta5rp" : "majestic";
}

export function labelTitle(category, server = "") {
  return category === "crime"
    ? CRIME_TITLES[server] || CRIME_TITLES[""]
    : CATEGORY_TITLES[category] || CATEGORY_TITLES.misc;
}

const CHANNEL_SECTORS = [
  (r, g, b, spread) => ((g - b) / spread) % 6,
  (r, g, b, spread) => (b - r) / spread + 2,
  (r, g, b, spread) => (r - g) / spread + 4,
];

export function hueOf(hex) {
  const value = Number.parseInt(`${hex}`.slice(1), 16);
  const channels = [16, 8, 0].map((shift) => ((value >> shift) & 255) / 255);
  const max = Math.max(...channels);
  const spread = max - Math.min(...channels);
  if ((max ? spread / max : 0) < 0.25 || max < 0.2) return null;
  const sector = CHANNEL_SECTORS[channels.indexOf(max)](...channels, spread);
  const degrees = (sector * 60 + 360) % 360;
  const row = HUE_BOUNDS.find(([limit]) => degrees < limit) ?? HUE_BOUNDS[0];
  return { id: row[1], title: row[2] };
}

/* ---------- Справочные подписи, маркеры и зоны ---------- */

/** Категория подписи по справочнику паков: ближайшая запись с тем же ключом в пределах 120. */
function referenceLabel(label) {
  const entries = referenceLabels().get(labelKey(label.text)) ?? [];
  const [found] = entries
    .map((entry) => [entry, planar(entry, label)])
    .filter(([, distance]) => distance <= REFERENCE_LABEL_REACH)
    .reduce((best, pair) => (best && best[1] <= pair[1] ? best : pair), null) ?? [];
  if (!found) return null;
  const merged = MERGED_KINDS[found.category];
  const byText = merged ? labelCategory(label.text) : null;
  return merged ? (merged.includes(byText) ? byText : merged[0]) : found.category;
}

function referenceMarker(x, y, size, dot) {
  const spot = { x, y };
  const reachOf = (marker) => Math.max(12, 0.6 * Math.max(size, marker.size));
  const near = referenceMarkers()
    .filter((marker) => marker.dot === dot)
    .map((marker) => [marker, planar(marker, spot)])
    .filter(([marker, distance]) => distance <= reachOf(marker));
  return near.reduce((best, pair) => (best && best[1] <= pair[1] ? best : pair), null)?.[0] ?? null;
}

/** Имя набора паков, на который зона лежит рамкой и контуром. */
const sampleStride = (points) => Math.max(1, Math.floor(points.length / 24));

const referenceZone = (zone) => {
  const points = zone.points;
  const box = boundsOf(points);
  const own = areaOf(box);
  const reach = Math.max(15, 3 * (zone.width || 0));
  const sampled = points.filter((_, i) => i % sampleStride(points) === 0);
  const verdicts = referenceZones().flatMap((ref) => {
    const [w, h] = ["x", "y"].map((axis) => overlapAlong(box, ref.box, axis));
    if (w < -20 || h < -20) return [];
    const common = Math.max(0, w) * Math.max(0, h);
    if (!zone.open && common / (own + areaOf(ref.box) - common) < 0.5) return [];
    const mean = sumOf(sampled.map((point) => distanceToRing(point, ref.points))) / sampled.length;
    return mean <= reach ? [[ref, mean]] : [];
  });
  return verdicts.reduce((best, pair) => (best && best[1] <= pair[1] ? best : pair), null)?.[0].key ?? null;
};

/* ---------- Сцена: подписи, зоны, точки и значки одного ответа ---------- */

const styleKey = (zone) => `${zone.color}|${zone.line}`;

/** Вид зоны (цвет и начертание) → категория: по справочнику, по голосам подписей, тёмный тон, «территории». */
function zoneStyleKinds(zones, labels, cats, known) {
  const styles = new Map();
  zones.forEach((zone, i) => {
    const key = styleKey(zone);
    const style = styles.get(key) ?? { color: zone.color, named: [], voted: [], closed: 0 };
    styles.set(key, style);
    if (known[i]) style.named.push(known[i]);
    if (zone.open) return;
    style.closed += 1;
    labels.forEach((label, j) => {
      if (ZONE_TITLES[cats[j]] && contains(zone.points, [label.x, label.y])) style.voted.push(cats[j]);
    });
  });
  for (const style of styles.values()) {
    const byReference = leader(tally(style.named));
    const byVotes = leader(tally(style.voted));
    const decisive = byVotes && byVotes[1] >= style.voted.length / 3 && (byVotes[1] >= 2 || style.voted.length <= 2);
    style.category = [byReference?.[0], !byReference && decisive && byVotes[0], darkTint(style.color) && "quarters"]
      .filter(Boolean).at(-1) ?? null;
  }
  const loose = [...styles.values()].filter((s) => !s.category && s.closed >= 2 && hueOf(s.color));
  if (new Set(loose.map((s) => hueOf(s.color).id)).size >= 4) loose.forEach((style) => { style.category = "crime"; });
  return new Map([...styles].map(([key, style]) => [key, style.category]));
}

/** Смысл цвета по текстам группы: признак принимается, если подписей хватает и больше, чем у прежнего. */
const meaningByTexts = (texts) =>
  COLOR_MEANINGS.reduce((best, [test, category]) => {
    const hits = texts.filter(test).length;
    return hits >= 2 && hits >= texts.length * 0.3 && hits > best.hits ? { category, hits } : best;
  }, { category: null, hits: 0 }).category;

class Scene {
  constructor(layers, title) {
    const labels = layers?.labels || [];
    const points = layers?.points || [];
    const zones = layers?.zones || [];
    this.server = serverOf(title, labels);
    this.cats = labels.map((label) => referenceLabel(label) || labelCategory(label.text));
    const known = zones.map((zone) => referenceZone(zone));
    const kinds = zoneStyleKinds(zones, labels, this.cats, known);
    this.layers = { labels, points, zones };
    this.shapes = zones.map((zone, i) => ({
      zone,
      key: darkTint(zone.color) ? "quarters" : known[i] || kinds.get(styleKey(zone)) || null,
    }));
    this.venues = this.shapes.filter(({ zone, key }) => !zone.open && (key === "sites" || key === "events"));
    this.markVenues();
    this.recolor();
  }

  inVenue([x, y]) {
    return this.venues.some(({ zone }) => contains(zone.points, [x, y]));
  }

  /** Подписи внутри площадок и зон мероприятий — всегда «ВЗП и ВЗХ». */
  markVenues() {
    this.layers.labels.forEach((label, j) => {
      if (this.inVenue([label.x, label.y])) this.cats[j] = "events";
    });
  }

  /** Цветные подписи: смысл читается по текстам группы, а если их мало — по зонам того же оттенка. */
  recolor() {
    const { labels } = this.layers;
    const byHue = labels.reduce((groups, label, j) => {
      const hue = hueOf(label.color);
      return hue ? groups.set(hue.id, [...(groups.get(hue.id) ?? []), j]) : groups;
    }, new Map());
    const closed = this.shapes.filter(({ zone }) => !zone.open);
    for (const [hueId, members] of byHue) {
      const texts = members.map((j) => String(labels[j].text).toLocaleUpperCase("ru"));
      const own = closed.filter(({ zone, key }) => ZONE_TO_LABEL[key] && hueOf(zone.color)?.id === hueId);
      const zoneVotes = members.flatMap((j) => {
        const shape = own.find(({ zone }) => contains(zone.points, [labels[j].x, labels[j].y]));
        return shape ? [ZONE_TO_LABEL[shape.key]] : [];
      });
      const best = leader(tally(zoneVotes));
      const byZones = best && best[1] >= Math.max(1, members.length / 2) ? best[0] : null;
      const meaning = meaningByTexts(texts) ?? byZones;
      if (meaning) members.forEach((j) => { this.cats[j] = meaning; });
    }
  }

  describeLabels() {
    return this.layers.labels.map((label, j) => ({ key: this.cats[j], title: labelTitle(this.cats[j], this.server) }));
  }

  /** Ключ точки, заданный справочником или площадкой (или null — решает ряд). */
  fixedKey(point) {
    const marker = referenceMarker(point.x, point.y, 2 * point.radius, true);
    if (marker) return marker.key;
    return !point.number && this.inVenue([point.x, point.y]) ? "sites" : null;
  }

  describePoints() {
    const { points, labels } = this.layers;
    const fixed = points.map((point) => this.fixedKey(point));
    const rowOf = (point) => `${point.number ? "numbered" : "dots"}|${point.color}`;
    const rows = new Map();
    points.forEach((point, i) => {
      if (fixed[i]) return;
      const row = rows.get(rowOf(point)) ?? { numbered: Boolean(point.number), near: 0, crime: 0, events: 0 };
      const around = labels.flatMap((label, j) => (planar(label, point) > NEARBY_RADIUS ? [] : [this.cats[j]]));
      row.near += around.length;
      row.crime += around.filter((cat) => cat === "crime").length;
      row.events += around.filter((cat) => cat === "events").length;
      rows.set(rowOf(point), row);
    });
    const kindOfRow = ({ numbered, near, crime, events }) => {
      if (numbered && crime >= 3 && crime >= events && crime >= near * 0.15) return this.server === "majestic" ? "capt" : "ghetto";
      return numbered ? "numbered" : "dots";
    };
    return points.map((point, i) => {
      const key = fixed[i] || kindOfRow(rows.get(rowOf(point)));
      return { key, title: POINT_TITLES[key] };
    });
  }

  describeZones() {
    return this.shapes.map(({ zone, key }) => {
      const kind = zone.fill ? "areas" : zone.open ? "lines" : "rings";
      const category = key || "other";
      return { kind, key: category, title: ZONE_TEMPLATES[kind].replace("{0}", ZONE_TITLES[category]) };
    });
  }
}

/** Типы значков по путям из glyphs: форма всех слоёв, а если не узнана — форма самого длинного пути. */
function glyphKinds(glyphs) {
  return new Map(Object.entries(glyphs || {}).map(([id, glyph]) => {
    const paths = glyph.layers.map((layer) => layer.path);
    const longest = paths.reduce((best, path) => (path.length > best.length ? path : best), "");
    const silhouettes = iconSilhouettes();
    const kind = [paths, [longest]].map((set) => sameSilhouette(pathMask(set), silhouettes)).find(Boolean) || "";
    return [id, kind];
  }));
}

function iconAnswer(icon, kinds) {
  const kind = referenceMarker(icon.x, icon.y, icon.size, false)?.glyph || kinds.get(icon.glyph) || "";
  const key = kind === "truck" ? "truck-box" : kind;
  return kind
    ? { key, title: ICON_TITLES[key] || ICON_TITLES[""], category: `pack-${kind}` }
    : { key: "", title: ICON_TITLES[""] };
}

export function packCategories(layers, { title = "" } = {}) {
  const scene = new Scene(layers, title);
  const labels = scene.describeLabels();
  const points = scene.describePoints();
  const zones = scene.describeZones();
  const kinds = glyphKinds(layers?.glyphs);
  const icons = (layers?.icons || []).map((icon) => iconAnswer(icon, kinds));
  return { server: scene.server, labels, points, zones, icons };
}
