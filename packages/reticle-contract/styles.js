/*
 * Виды прицела — как виды трассеров: форма, которую выбирают глазами.
 *
 * Вид задаёт только форму — из каких частей прицел и какого они размера. Цвет,
 * обводка, прозрачность и видимость остаются за человеком: сменить крест на
 * кольцо не значит перекрасить прицел. Поэтому вид ставит все части разом —
 * и выключает те, которых в нём нет.
 *
 * Выбранный вид не хранится: он узнаётся по тому, какие части включены
 * (`ordinaryStyleOf`, `sniperStyleOf`). Поправил толщину — это всё ещё
 * «Крест с точкой»; выключил точку — уже «Крест». Своё сочетание частей не
 * совпадает ни с одним видом, и тогда плитки не подсвечены: хранимое «вид»
 * врало бы о том, что стоит на экране.
 */

const ARMS_ON = Object.freeze({
  armTop: true,
  armRight: true,
  armBottom: true,
  armLeft: true,
});

const ORDINARY_OFF = Object.freeze({
  linesEnabled: false,
  ...ARMS_ON,
  showCenterDot: false,
  ring: false,
  ringSegments: 1,
  bracketsEnabled: false,
  chevronEnabled: false,
  rotation: 0,
});

const style = (id, label, description, values) =>
  Object.freeze({ id, label, description, values: Object.freeze(values) });

/** Виды обычного прицела. Первые шесть — на экране сразу. */
export const ORDINARY_STYLES = Object.freeze([
  style("dot", "Точка", "Одна точка — ничего не закрывает цель.", {
    ...ORDINARY_OFF,
    showCenterDot: true,
    dotSize: 4,
    dotShape: "circle",
  }),
  style("cross", "Крест", "Четыре линии с зазором, как в CS.", {
    ...ORDINARY_OFF,
    linesEnabled: true,
    length: 8,
    thickness: 2,
    gap: 4,
  }),
  style(
    "cross-dot",
    "Крест с точкой",
    "Крест и точка в центре — классика шутеров.",
    {
      ...ORDINARY_OFF,
      linesEnabled: true,
      length: 8,
      thickness: 2,
      gap: 5,
      showCenterDot: true,
      dotSize: 2,
      dotShape: "circle",
    },
  ),
  style("t", "T-образный", "Без верхней линии: голова цели открыта.", {
    ...ORDINARY_OFF,
    linesEnabled: true,
    armTop: false,
    length: 8,
    thickness: 2,
    gap: 4,
    showCenterDot: true,
    dotSize: 2,
    dotShape: "circle",
  }),
  style("circle-dot", "Кольцо с точкой", "Как голографический прицел.", {
    ...ORDINARY_OFF,
    ring: true,
    circleSize: 22,
    ringThickness: 1.5,
    showCenterDot: true,
    dotSize: 2.5,
    dotShape: "circle",
  }),
  style("segments", "Сегменты", "Кольцо из четырёх дуг и точка.", {
    ...ORDINARY_OFF,
    ring: true,
    circleSize: 24,
    ringThickness: 2,
    ringSegments: 4,
    ringGap: 40,
    ringRotation: 45,
    showCenterDot: true,
    dotSize: 2,
    dotShape: "circle",
  }),
  style("plus", "Плюс", "Сплошной крест без зазора.", {
    ...ORDINARY_OFF,
    linesEnabled: true,
    length: 7,
    thickness: 2,
    gap: 0,
  }),
  style("circle-cross", "Кольцо и крест", "Короткие линии снаружи кольца.", {
    ...ORDINARY_OFF,
    ring: true,
    circleSize: 22,
    ringThickness: 1.5,
    linesEnabled: true,
    length: 6,
    thickness: 1.5,
    gap: 13,
  }),
  style("brackets", "Уголки", "Рамка из четырёх уголков вокруг точки.", {
    ...ORDINARY_OFF,
    bracketsEnabled: true,
    bracketSize: 9,
    bracketLength: 5,
    bracketThickness: 1.5,
    showCenterDot: true,
    dotSize: 2,
    dotShape: "circle",
  }),
  style("chevron", "Шеврон", "Галочка: её вершина — точка прицеливания.", {
    ...ORDINARY_OFF,
    chevronEnabled: true,
    chevronWidth: 8,
    chevronHeight: 6,
    chevronThickness: 2,
    chevronOffset: 0,
  }),
  style("x", "Косой крест", "Крест, повёрнутый на 45°.", {
    ...ORDINARY_OFF,
    linesEnabled: true,
    length: 8,
    thickness: 2,
    gap: 4,
    rotation: 45,
  }),
  style("diamond", "Ромб", "Контур ромба с точкой внутри.", {
    ...ORDINARY_OFF,
    bracketsEnabled: true,
    bracketSize: 7,
    bracketLength: 14,
    bracketThickness: 1.5,
    showCenterDot: true,
    dotSize: 2,
    dotShape: "circle",
    rotation: 45,
  }),
  style("square", "Квадрат", "Квадратная рамка с точкой.", {
    ...ORDINARY_OFF,
    bracketsEnabled: true,
    bracketSize: 8,
    bracketLength: 16,
    bracketThickness: 1.5,
    showCenterDot: true,
    dotSize: 2,
    dotShape: "square",
  }),
]);

const SNIPER_OFF = Object.freeze({
  linesEnabled: false,
  ...ARMS_ON,
  postsEnabled: false,
  divisions: 0,
  tickStyle: "line",
  dotSize: 0,
  showCircle: false,
  ringSegments: 1,
  chevronEnabled: false,
  holdoverEnabled: false,
  rotation: 0,
});

const FULL_CROSS = Object.freeze({
  linesEnabled: true,
  horizontalLength: 100,
  verticalLength: 100,
  thickness: 1.5,
  centerGap: 0,
});

/** Виды снайперского прицела. Первые шесть — на экране сразу. */
export const SNIPER_STYLES = Object.freeze([
  style("ticks", "Крест с рисками", "Отметки расстояния на линиях.", {
    ...SNIPER_OFF,
    linesEnabled: true,
    horizontalLength: 92,
    verticalLength: 92,
    thickness: 2,
    centerGap: 3,
    divisions: 8,
    tickSize: 7,
    tickStyle: "line",
    dotSize: 2,
  }),
  style(
    "duplex",
    "Дуплекс",
    "Толстые края и тонкий центр — охотничья классика.",
    {
      ...SNIPER_OFF,
      ...FULL_CROSS,
      postsEnabled: true,
      postThickness: 7,
      postStart: 40,
    },
  ),
  style("mil-dot", "Mil-dot", "Точки на линиях вместо рисок.", {
    ...SNIPER_OFF,
    ...FULL_CROSS,
    divisions: 5,
    tickSize: 4,
    tickStyle: "dot",
    postsEnabled: true,
    postThickness: 5,
    postStart: 55,
  }),
  style(
    "circle-dot",
    "Кольцо с точкой",
    "Кольцо в центре — быстро навестись.",
    {
      ...SNIPER_OFF,
      showCircle: true,
      circleSize: 60,
      ringThickness: 3,
      dotSize: 3,
    },
  ),
  style("tactical", "Тактический", "Кольцо и крест с разрывом.", {
    ...SNIPER_OFF,
    ...FULL_CROSS,
    centerGap: 40,
    showCircle: true,
    circleSize: 60,
    ringThickness: 2,
    dotSize: 2,
  }),
  style("t", "T-образный", "Без верхней линии: цель над центром открыта.", {
    ...SNIPER_OFF,
    linesEnabled: true,
    armTop: false,
    horizontalLength: 92,
    verticalLength: 92,
    thickness: 2,
    centerGap: 3,
    dotSize: 2,
  }),
  style("crosshair", "Тонкий крест", "Две линии через всю линзу.", {
    ...SNIPER_OFF,
    ...FULL_CROSS,
  }),
  style("german", "Немецкий", "Три толстых столбика, верх открыт.", {
    ...SNIPER_OFF,
    ...FULL_CROSS,
    armTop: false,
    postsEnabled: true,
    postThickness: 9,
    postStart: 30,
  }),
  style("dot", "Точка", "Только точка — линза чистая.", {
    ...SNIPER_OFF,
    dotSize: 5,
  }),
  style("chevron", "Шеврон", "Галочка и столбик снизу, как у ACOG.", {
    ...SNIPER_OFF,
    chevronEnabled: true,
    chevronWidth: 14,
    chevronHeight: 11,
    chevronThickness: 2.5,
    linesEnabled: true,
    armTop: false,
    armRight: false,
    armLeft: false,
    verticalLength: 60,
    thickness: 2,
    centerGap: 14,
  }),
  style("pso", "ПСО", "Шевроны и боковая шкала, как у СВД.", {
    ...SNIPER_OFF,
    chevronEnabled: true,
    chevronWidth: 8,
    chevronHeight: 6,
    chevronThickness: 2,
    holdoverEnabled: true,
    holdoverCount: 3,
    holdoverSpacing: 12,
    holdoverWidth: 5,
    holdoverGrowth: 0,
    holdoverShape: "chevron",
    linesEnabled: true,
    armTop: false,
    armBottom: false,
    horizontalLength: 30,
    thickness: 1.5,
    centerGap: 24,
    divisions: 4,
    tickSize: 6,
    tickStyle: "line",
  }),
  style("bdc", "Ёлочка", "Поправки на дальность под центром.", {
    ...SNIPER_OFF,
    ...FULL_CROSS,
    holdoverEnabled: true,
    holdoverCount: 6,
    holdoverSpacing: 16,
    holdoverWidth: 8,
    holdoverGrowth: 3,
    holdoverShape: "bar",
  }),
]);

/** Сколько видов стоит на экране до «Показать ещё» — как у трассеров. */
export const RETICLE_STYLES_SHOWN = 6;

const armsKey = (config) =>
  ["armTop", "armRight", "armBottom", "armLeft"]
    .map((key) => (config[key] === false ? 0 : 1))
    .join("");

const diagonal = (rotation) =>
  Math.abs(((((Number(rotation) || 0) % 90) + 90) % 90) - 45) < 1;

/* Из каких частей прицел — без размеров. По этому узнаётся вид. */
export function ordinarySignature(config) {
  const lines =
    config.linesEnabled !== false &&
    Number(config.length) > 0 &&
    Number(config.thickness) > 0;
  return [
    lines
      ? `L${armsKey(config)}${Number(config.gap) < Number(config.thickness) / 2 ? "0" : ""}`
      : "",
    config.showCenterDot !== false && Number(config.dotSize) > 0 ? "D" : "",
    config.ring && Number(config.circleSize) > 0
      ? Number(config.ringSegments) > 1
        ? "S"
        : "R"
      : "",
    config.bracketsEnabled
      ? Number(config.bracketLength) >= Number(config.bracketSize) * 2
        ? "F"
        : "B"
      : "",
    config.chevronEnabled ? "V" : "",
    diagonal(config.rotation) ? "x" : "",
  ].join("|");
}

export function sniperSignature(config) {
  const lines = config.linesEnabled !== false;
  const ticks = lines && Number(config.divisions) > 0;
  return [
    lines ? `L${armsKey(config)}` : "",
    lines && config.postsEnabled ? "P" : "",
    ticks ? (config.tickStyle === "dot" ? "o" : "t") : "",
    Number(config.dotSize) > 0 ? "D" : "",
    config.showCircle && Number(config.circleSize) > 0 ? "R" : "",
    config.chevronEnabled ? "V" : "",
    config.holdoverEnabled
      ? config.holdoverShape === "chevron"
        ? "hv"
        : "hb"
      : "",
    diagonal(config.rotation) ? "x" : "",
  ].join("|");
}

const matcher = (styles, signature) => {
  const index = new Map();
  for (const item of styles) {
    const key = signature(item.values);
    if (!index.has(key)) index.set(key, item.id);
  }
  return (config) => index.get(signature(config || {})) || "";
};

/** Вид, которому соответствует прицел, или пустая строка. */
export const ordinaryStyleOf = matcher(ORDINARY_STYLES, ordinarySignature);
export const sniperStyleOf = matcher(SNIPER_STYLES, sniperSignature);

/** Прицел в выбранном виде: форма вида, остальное — как было. */
export function withReticleStyle(config, item) {
  return item ? { ...config, ...item.values } : config;
}
