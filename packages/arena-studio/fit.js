// Посадка загруженной модели в место арены: масштаб, сдвиг, поворот и замечания.

const FORMAT = Object.freeze({
  number: new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }),
  plural: new Intl.PluralRules("ru-RU"),
});

const AXES = ["x", "y", "z"];

// Размеры храним тройками, наружу отдаём объектами по осям.
const named = (triple) => Object.fromEntries(AXES.map((axis, at) => [axis, triple[at]]));

// Объект из строки имён ключей и списка значений в том же порядке.
const assemble = (keys, values) =>
  Object.fromEntries(keys.split(" ").map((key, at) => [key, values[at]]));

const makeSlot = (id, labels, nominal, max, triangles, instances) =>
  Object.freeze(
    assemble("id labels nominal max anchor triangles instances", [
      id,
      labels,
      Object.freeze(named(nominal)),
      Object.freeze(named(max)),
      "base",
      triangles,
      instances,
    ]),
  );

export const CHAIR_SLOT = makeSlot(
  "chair",
  { ru: "Кресло трибуны", en: "Stand seat" },
  [0.52, 0.92, 0.58],
  [0.7, 1.3, 0.78],
  3000,
  true,
);

export const STAR_SLOT = makeSlot(
  "star",
  { ru: "Центральная звезда", en: "Centre star" },
  [9.2, 0.06, 9.2],
  [11, 0.35, 11],
  8000,
  false,
);

export const MAX_MODEL_BYTES = 24 << 20;

const roundAt = (digits) => {
  const k = Number(`1e${digits}`);
  return (value) => Math.round(value * k) / k;
};
const to3 = roundAt(3);
const to5 = roundAt(5);

const HINTS = {
  en: (max, nominal, triangles) =>
    `Up to ${max} m (width×depth×height), stock size ${nominal} m. Origin at the base centre, Y up, metres, up to ${triangles} triangles.`,
  ru: (max, nominal, triangles) =>
    `До ${max} м (ширина×глубина×высота), штатный размер ${nominal} м. Начало координат — центр опоры, вверх — Y, единицы — метры, до ${triangles} треугольников.`,
};

export function slotHint(slot, locale = "ru") {
  const { nominal, max, triangles } = slot;
  const trio = ({ x, y, z }) => `${x}×${z}×${y}`;
  return HINTS[locale === "en" ? "en" : "ru"](trio(max), trio(nominal), triangles);
}

export function fitSummary(fit) {
  const sides = fit?.fitted;
  if (!sides) return "";
  const shown = ["x", "z", "y"].map((key) => FORMAT.number.format(sides[key]));
  return `${shown.join(" × ")} м`;
}

const [info, warn, fail] = ["info", "warn", "error"].map((level) => (code, text) => ({ level, code, text }));

const noMesh = () =>
  assemble("ok scale offset rotationX size fitted notes", [
    false,
    1,
    [0, 0, 0],
    0,
    null,
    null,
    [fail("empty", "В файле нет ни одного меша — арена ничего не покажет.")],
  ]);

// Размеры и середины ящика по осям; null, если габаритов нет.
function measure(bounds) {
  const { min, max } = bounds ?? {};
  if (!min || !max) return null;
  const corners = AXES.map((axis, at) => [Number(max[at]), Number(min[at])]);
  const sides = corners.map(([hi, lo]) => hi - lo);
  if (!sides.every((side) => Number.isFinite(side))) return null;
  if (sides.every((side) => side <= 0)) return null;
  return { sides, mids: corners.map(([hi, lo]) => (hi + lo) / 2) };
}

const lyingDown = ([x, y, z]) => z > y * 1.35 && z > x * 0.9;

// Поворот на ±90: какая середина идёт в глубину и откуда берётся «низ» ящика.
const TURNS = new Map([
  [-90, { depth: (mids) => -mids[1], floor: (bounds) => bounds.min[2] }],
  [90, { depth: (mids) => mids[1], floor: (bounds) => -bounds.max[2] }],
]);
const UPRIGHT = { depth: (mids) => mids[2], floor: (bounds) => bounds.min[1] };

function autoFactor(up, nominal, limit) {
  const fits = AXES.every((axis, at) => up[at] <= limit[axis]) && up[1] >= nominal.y * 0.6;
  if (fits) return 1;
  return Math.min(...AXES.map((axis, at) => nominal[axis] / Math.max(up[at], 1e-6)));
}

const RAZ = { one: "раз", many: "раз" };

// Слово о разе: проценты для малых множителей, иначе «в N раз/раза».
function timesWord(factor) {
  if (factor < 1.5) return `на ${Math.round((factor - 1) * 100)}%`;
  return `в ${FORMAT.number.format(factor)} ${RAZ[FORMAT.plural.select(factor)] ?? "раза"}`;
}

const scaleNote = (factor) => {
  if (!(Math.abs(factor - 1) > 0.005)) return null;
  return factor < 1
    ? info("scaled", `Модель была крупнее места и уменьшена ${timesWord(1 / factor)}.`)
    : info("scaled", `Модель была мельче места и увеличена ${timesWord(factor)}.`);
};

const AXIS_WORDS = { x: "ширине", y: "высоте", z: "глубине" };

const oversizeNote = (fitted, limit) => {
  const over = AXES.filter((axis) => fitted[axis] > limit[axis] + 0.001);
  const words = over.map((axis) => AXIS_WORDS[axis]).join(" и ");
  return over.length ? warn("oversize", `Даже после подгонки модель выходит за место по ${words}.`) : null;
};

// Границы отношения высоты к штатной: сантиметры, дюймы, «крошечная».
const UNIT_RULES = [
  [60, 140, "centimetres", "Похоже, модель сохранена в сантиметрах — экспортируй в метрах."],
  [20, 45, "inches", "Похоже, модель сохранена в дюймах — экспортируй в метрах."],
  [0, 0.02, "tiny", "Модель в сотни раз мельче места — проверь единицы экспорта."],
];

const unitNote = (ratio) => {
  const rule = UNIT_RULES.find(([above, below]) => ratio > above && ratio < below);
  return rule ? warn(rule[2], rule[3]) : null;
};

const triangleNote = (count, cap, instances) => {
  if (!(count && count > cap)) return null;
  const [shown, limitShown] = [count.toLocaleString("ru"), cap.toLocaleString("ru")];
  return warn(
    "triangles",
    instances
      ? `${shown} треугольников на одно кресло, а кресел в зале под четыре сотни. Предел — ${limitShown}.`
      : `${shown} треугольников — предел ${limitShown}.`,
  );
};

export function fitModel(bounds, slot = CHAIR_SLOT, options = {}) {
  const measured = measure(bounds);
  if (!measured) return noMesh();
  const { sides, mids } = measured;

  const asked = options.rotationX;
  const angle = asked === undefined ? (lyingDown(sides) ? -90 : 0) : Number(asked) || 0;
  const up = Math.abs(angle) === 90 ? [sides[0], sides[2], sides[1]] : [...sides];

  const { nominal, max: limit, triangles: cap, instances, id } = slot;
  const given = options.scale ? Number(options.scale) || 1 : undefined;
  const factor = given ?? autoFactor(up, nominal, limit);
  const fitted = named(up.map((side) => to3(side * factor)));

  const notes = [
    angle && asked === undefined
      ? info("z-up", "Модель пришла «вверх по Z», как принято в GTA — поставлена на ноги.")
      : null,
    scaleNote(factor),
    oversizeNote(fitted, limit),
    unitNote(up[1] / nominal.y),
    triangleNote(options.triangles, cap, instances),
  ].filter(Boolean);

  const { depth, floor } = TURNS.get(angle) ?? UPRIGHT;
  const offset = [-mids[0], -floor(bounds), -depth(mids)].map((shift) => to3(shift * factor));
  return assemble("ok scale offset rotationX size fitted slot notes", [
    true,
    to5(factor),
    offset,
    angle,
    named(sides.map((side) => to3(side))),
    fitted,
    id,
    notes,
  ]);
}
