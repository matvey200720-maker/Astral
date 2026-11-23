import { clamp01, hexToRgb, isHexColor, rgbToHex } from "./color.js";

// Перекраска готовых векторных карт по «элементам» пака: таблицы элементов по шаблонам и расчёт цвета каждой группы геометрии.

export const PACK_COLOR_GROUPS = Object.freeze(
  [
    ["water", "Вода"],
    ["land", "Суша"],
    ["city", "Город"],
    ["roads", "Дороги"],
  ].map(([id, title]) => Object.freeze({ id, title })),
);

// Допустимые оттенки записаны через пробел.
const hexes = (text) => text.split(" ");

// Строки: id, группа, подпись, полоса (или две полосы), опорный цвет, необязательные поля.
const ELEMENT_ROWS = {
  "akio-atlas-vector": [
    ["water", "water", "Вода", "water", "#94c6f7", { gradient: true }],
    ["fields", "land", "Поля и луга", "land", "#a5c263", { colors: hexes("#a5c263") }],
    ["forest", "land", "Леса и холмы", "land", "#94ae5a", { gradient: true, colors: hexes("#94ae5a #849e52") }],
    ["beach", "land", "Пляжи и песок", "land", "#dece73", { colors: hexes("#dece73") }],
    ["desert", "land", "Пустыня", "land", "#bdaa63", { colors: hexes("#bdaa63") }],
    ["cityland", "land", "Городская земля", "land", "#bfbfbf", { colors: hexes("#bfbfbf") }],
    ["districts", "city", "Городские кварталы", "blocks", "#a5aaa5", { colors: hexes("#a5aaa5") }],
    ["houses", "city", "Постройки", "blocks", "#7b8a73", { gradient: true, colors: hexes("#7b8a73 #7b655a") }],
    ["roads", "roads", "Дороги", "roads", "#ffffff", { colors: hexes("#ffffff") }],
    ["freeway", "roads", "Магистрали", "roads", "#fff7c5", { colors: hexes("#fff7c5") }],
    ["dirt", "roads", "Грунтовки", "roads", "#a97b52", { colors: hexes("#a97b52") }],
    ["rail", "roads", "Железная дорога", "roads", "#010101", { colors: hexes("#010101") }],
    ["golf", "land", "Гольф", "roads", "#7ba65a", { colors: hexes("#7ba65a"), follows: "fields" }],
    ["plazas", "city", "Площади и стоянки", "roads", "#a5aaa5", { colors: hexes("#a5aaa5"), follows: "districts" }],
    ["lots", "city", "Площадки", "blocks", "#ffffff", { colors: hexes("#ffffff"), follows: "districts" }],
    ["trails", "roads", "Тропы", "roads", "#65595a", { gradient: true, colors: hexes("#65595a #7b655a #7b8a73 #949494"), follows: "roads" }],
  ],
  "akio-bw-vector": [
    ["water", "water", "Вода", "water", "#3c3c3c", { gradient: true }],
    ["coast", "land", "Побережье и городская земля", "land", "#3a3a3a", { colors: hexes("#3a3a3a") }],
    ["fields", "land", "Поля и луга", "land", "#636363", { gradient: true, colors: hexes("#636363 #626262") }],
    ["forest", "land", "Леса и холмы", "land", "#737373", { gradient: true, colors: hexes("#737373 #848484") }],
    ["desert", "land", "Пустыня", "land", "#5a5a5a", { gradient: true, colors: hexes("#5a5a5a #525252") }],
    ["houses", "city", "Постройки", "blocks", "#525252", { colors: hexes("#525252") }],
    ["roads", "roads", "Дороги", "roads", "#000000", { colors: hexes("#000000") }],
    ["freeway", "roads", "Магистрали", "roads", "#ffffff", { colors: hexes("#ffffff") }],
    ["golf", "land", "Гольф", "roads", "#7b7b7b", { colors: hexes("#7b7b7b"), follows: "fields" }],
    ["plazas", "city", "Площади и стоянки", "roads", "#525252", { colors: hexes("#525252"), follows: "houses" }],
    ["trails", "roads", "Тропы", "roads", "#949494", { colors: hexes("#949494"), follows: "roads" }],
  ],
  "iskra-majestic": [
    ["water", "water", "Вода", "water", "#2d2d2d", { gradient: true }],
    ["land", "land", "Суша", "land", "#1e1e1e", { colors: hexes("#1e1e1e") }],
    ["forest", "land", "Леса и горы", "land", "#161616", { colors: hexes("#161616") }],
    ["houses", "city", "Постройки", "blocks", "#252525", { colors: hexes("#252525") }],
    ["roads", "roads", "Дороги", "roads", "#383838", { colors: hexes("#383838") }],
    ["freeway", "roads", "Магистрали", "roads", "#444444", { colors: hexes("#444444") }],
    ["plazas", "city", "Площади и стоянки", "roads", "#2f2f2f", { gradient: true, colors: hexes("#2f2f2f #252525"), follows: "houses" }],
    ["trails", "roads", "Тропы и пути", "roads", "#282828", { gradient: true, colors: hexes("#282828 #222222 #2c2c2c #323232"), follows: "roads" }],
  ],
  "mod-pack": [
    ["water", "water", "Вода", "water", "#3c4a50", { gradient: true, auto: true }],
    ["land", "land", "Суша", "land", "#3a3d38", { gradient: true, auto: true }],
    ["houses", "city", "Кварталы и постройки", "blocks", "#4a4a4a", { gradient: true, auto: true }],
    ["roads", "roads", "Дороги", "roads", "#8a8a8a", { gradient: true, auto: true }],
  ],
  "bigmap-coal": [
    ["water", "water", "Вода", "water", "#2b2b2b", { gradient: true }],
    ["land", "land", "Суша", "land", "#0a0a0a", { colors: hexes("#0a0a0a") }],
    ["houses", "city", "Кварталы", "blocks", "#1a1a1a", { colors: hexes("#1a1a1a") }],
    ["roads", "roads", "Дороги", "roads", "#000000", { colors: hexes("#000000") }],
    ["rail", "roads", "Железная дорога", "roads", "#262626", { colors: hexes("#262626") }],
    ["base", "city", "Военная база и тюрьма", ["land", "blocks"], "#000000", { colors: hexes("#000000"), follows: "land" }],
    ["plazas", "city", "Площади и стоянки", "roads", "#1a1a1a", { colors: hexes("#1a1a1a"), follows: "houses" }],
  ],
};

// Ключи собираются в том порядке, как в таблице: gradient и colors первыми, дальше id, follows, group, label, band/bands, rep, auto.
const buildElement = ([id, group, label, band, rep, extra = {}]) =>
  Object.freeze({
    gradient: extra.gradient ?? false,
    colors: extra.colors ?? null,
    id,
    ...(extra.follows && { follows: extra.follows }),
    group,
    label,
    [Array.isArray(band) ? "bands" : "band"]: band,
    rep,
    ...(extra.auto && { auto: true }),
  });

const TEMPLATE_IDS = Object.keys(ELEMENT_ROWS);

export const PACK_ELEMENTS = Object.freeze(
  TEMPLATE_IDS.reduce((table, id) => ({ ...table, [id]: Object.freeze(ELEMENT_ROWS[id].map(buildElement)) }), {}),
);

// Полосы высот: полоса, чья верхняя граница ещё не достигнута; выше всех — дороги.
const BAND_EDGES = [
  ["water", -1],
  ["land", 5.5],
  ["blocks", 11.5],
];

export const packBand = (height) => (BAND_EDGES.find(([, edge]) => height < edge) ?? ["roads"])[0];

export const packElements = (templateId) => (TEMPLATE_IDS.includes(templateId) ? PACK_ELEMENTS[templateId] : []);

/* --- оттенки --- */

const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722];
const SHADE_EPSILON = 0.004;
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

const lightness = (hex) => {
  const [red, green, blue] = hexToRgb(hex).map((byte, i) => byte * LUMA_WEIGHTS[i]);
  return (red + green + blue) / 255;
};

// Смесь цели с краем шкалы в доле share.
const blendToward = (target, edge, share) =>
  rgbToHex(Array.from(hexToRgb(target), (channel, i) => (edge[i] - channel) * share + channel));

// Правило отвечает, к какому краю и в какой доле сдвигать цель при разнице светлоты gap (опорная светлота — base).
const AROUND_RULE = (gap, base) =>
  gap > 0
    ? [WHITE, clamp01(gap / Math.max(1 - base, 0.05))]
    : [BLACK, clamp01(-gap / Math.max(base, 0.05))];
const BY_RULE = (gap) => [gap > 0 ? WHITE : BLACK, Math.min(Math.abs(gap), 0.12)];

const shaded = (target, rep, member, rule) => {
  const base = lightness(rep);
  const gap = lightness(member) - base;
  if (Math.abs(gap) < SHADE_EPSILON) return rgbToHex(hexToRgb(target));
  const [edge, share] = rule(gap, base);
  return blendToward(target, edge, share);
};

export const shadeAround = (target, rep, member) => shaded(target, rep, member, AROUND_RULE);
export const shadeBy = (target, rep, member) => shaded(target, rep, member, BY_RULE);

/* --- цели и поиск элемента --- */

export const packElementTargets = (elements, palette) => {
  // Пары строятся через map: пустой элемент бросает здесь, а дыра в массиве ломает конструктор Map.
  const entries = elements.map((item) => [item.id, item]);
  const byId = new Map(entries);
  const targets = new Map(
    elements.flatMap((item) => {
      const color = palette?.[item.id];
      return isHexColor(color) ? [[item.id, color]] : [];
    }),
  );
  // Один проход по порядку таблицы: цвет соседа должен быть уже известен.
  const inherited = (item) => {
    if (!item.follows || targets.has(item.id)) return null;
    const parent = byId.get(item.follows);
    return parent && targets.has(parent.id) ? shadeBy(targets.get(parent.id), parent.rep, item.rep) : null;
  };
  elements.forEach((item) => {
    const color = inherited(item);
    if (color) targets.set(item.id, color);
  });
  return targets;
};

const inBand = (item, band) => (item.bands || [item.band]).includes(band);
const withinBand = (band) => (item) => inBand(item, band);
// «Свой» элемент: полоса совпала и список цветов не задан либо содержит цвет группы.
const claims = (band, color) => (item) => inBand(item, band) && (item.colors ? item.colors.includes(color) : true);

const squaredDistance = (a, b) => a.map((channel, i) => (channel - b[i]) ** 2).reduce((x, y) => x + y);

// Сначала «свой» элемент слева направо (дальше первого найденного список не читается), иначе отбор полосы по всему
// списку и ближайший по цвету; ложный итог — null. Пустые элементы и дыры бросают TypeError там, где до них дошли.
export const packElementOf = (elements, group) => {
  const band = packBand(group.height);
  const exact = elements.find(claims(band, group.color));
  if (exact) return { element: exact, own: true };

  const sameBand = elements.filter(withinBand(band));
  const wanted = hexToRgb(group.color);
  const closest = (sameBand.length ? sameBand : elements).reduce(
    (best, item) => {
      const distance = squaredDistance(hexToRgb(item.rep), wanted);
      return distance < best.distance ? { item, distance } : best;
    },
    { item: null, distance: Infinity },
  ).item;
  return closest ? { element: closest, own: false } : null;
};

/* --- итоговые правки цвета --- */

// Память по объекту: последний результат вместе с ключом, по которому он посчитан.
const resultMemory = new WeakMap();
const dominantMemory = new WeakMap();

const memoized = (store, owner, key, build) => {
  const hit = store.get(owner);
  if (hit && hit.key === key) return hit.value;
  const value = build();
  store.set(owner, { key, value });
  return value;
};

// Самый частый цвет каждой полосы: вес — длина positions, при равенстве побеждает первый по появлению.
const dominantColors = (geometry) =>
  memoized(dominantMemory, geometry, "once", () => {
    const tally = [...geometry.groups].reduce((seen, group) => {
      const band = packBand(group.height);
      const slot = `${band}|${group.color}`;
      const entry = seen.get(slot) ?? { band, color: group.color, weight: 0 };
      entry.weight += group.positions.length;
      return seen.set(slot, entry);
    }, new Map());
    return [...tally.values()].reduce((winners, entry) => {
      const leader = winners.get(entry.band);
      return entry.weight > (leader?.weight ?? -Infinity) ? winners.set(entry.band, entry) : winners;
    }, new Map());
  });

// Как красить группу: чужой оттенок сдвигается по светлоте, свой градиентный держит различие, свой простой берёт цель.
const keepTarget = (target) => target;

const shaderFor = (own, element) => {
  if (!own) return shadeBy;
  return element.gradient ? shadeAround : keepTarget;
};

const memoKey = (templateId, targets) =>
  [String(templateId), Array.from(targets, ([id, color]) => `${id}=${color}`).join(",")].join("|");

export const packColorOverrides = (geometry, base) => {
  const groups = geometry?.groups;
  const palette = base?.paletteMap;
  if (!groups || !palette) return null;
  const elements = packElements(base.source === "template" ? base.templateId : null);
  const targets = elements.length ? packElementTargets(elements, palette) : new Map();
  if (!targets.size) return null;

  return memoized(resultMemory, geometry, memoKey(base.templateId, targets), () => {
    const pairs = [...groups].flatMap((group) => {
      const { element, own } = packElementOf(elements, group);
      const target = targets.get(element.id);
      if (target === undefined) return [];
      const rep = element.auto ? dominantColors(geometry).get(packBand(group.height))?.color || element.rep : element.rep;
      return [[group, shaderFor(own, element)(target, rep, group.color)]];
    });
    return new Map(pairs);
  });
};
