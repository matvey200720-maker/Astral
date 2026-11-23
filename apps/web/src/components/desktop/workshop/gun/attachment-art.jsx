// Значок места обвеса на схеме ствола: рисунки хранятся строками таблицы,
// а элементы собираются один раз при загрузке модуля.

export function SlotGlyph({ kind, className = "" }) {
  const drawing = ART[kind] ?? ART.other;
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      {drawing}
    </svg>
  );
}

function drawShape([look, Tag, ...values], at) {
  const geometry = Object.fromEntries(GEOMETRY[Tag].map((name, i) => [name, values[i]]));
  return <Tag key={at} {...geometry} {...LOOKS[look]} />;
}

function drawAll(shapes) {
  return <>{shapes.map(drawShape)}</>;
}

// Какие атрибуты у фигуры и в каком порядке идут числа в строке таблицы.
const GEOMETRY = {
  circle: ["cx", "cy", "r"],
  rect: ["x", "y", "width", "height", "rx"],
  path: ["d"],
};

const STROKE = {
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const LOOKS = {
  line: { fill: "none", ...STROKE },
  body: { fill: "currentColor", ...STROKE, fillOpacity: 0.14 },
  dot: { fill: "currentColor" },
  spots: { fill: "currentColor", fillOpacity: 0.55 },
};

// Строка: [вид отрисовки, тег, ...значения геометрии].
const SHAPES = {
  scope: [
    ["line", "circle", 12, 12, 7],
    ["line", "path", "M12 3v4M12 17v4M3 12h4M17 12h4"],
    ["dot", "circle", 12, 12, 1.2],
  ],
  supp: [
    ["body", "rect", 3, 8.5, 18, 7, 3.5],
    ["line", "path", "M8 8.5v7M12 8.5v7M16 8.5v7"],
  ],
  muzzle: [
    ["body", "path", "M3 10.5h6v3H3z"],
    ["body", "rect", 9, 7.5, 10, 9, 2],
    ["line", "path", "M12 7.5v3M15.5 7.5v3M12 13.5v3M15.5 13.5v3M19 12h2"],
  ],
  barrel: [
    ["body", "path", "M3 10.5h15v3H3z"],
    ["body", "rect", 18, 9, 3, 6, 1],
  ],
  flash: [
    ["body", "rect", 3, 9, 9, 6, 1.5],
    ["body", "path", "M12 8.5l3-2v11l-3-2z"],
    ["line", "path", "M17.5 8l3-2M18 12h3.5M17.5 16l3 2"],
  ],
  grip: [
    ["line", "path", "M3 6.5h18"],
    ["body", "path", "M9 6.5h6l-.8 12.5a1.5 1.5 0 0 1-1.5 1.4h-1.4a1.5 1.5 0 0 1-1.5-1.4z"],
    ["line", "path", "M10.2 11h3.6M10.4 14.5h3.2"],
  ],
  clip: [
    ["body", "path", "M8 3h7l1.5 9.5L19 20h-7l-2.6-7.6z"],
    ["line", "path", "M9.6 7.5h6M10.2 11.5h6.4"],
  ],
  camo: [
    ["line", "rect", 3.5, 3.5, 17, 17, 3],
    [
      "spots",
      "path",
      "M6 9c2-2.5 4.5-1 5 .5S9 13 7 12.5 4.8 10.5 6 9zM13 14.5c1.5-1.8 4.5-1.3 5 .7s-2.6 2.8-4.2 2.2-1.6-1.8-.8-2.9zM14 5.5c1.6-.4 3.4.8 2.6 2.4s-3.2 1.3-3.6.1.1-2.3 1-2.5z",
    ],
  ],
  cover: [
    ["body", "path", "M3 13.5h18v3H3z"],
    ["line", "path", "M5 13.5v-3h2v3M9.5 13.5v-3h2v3M14 13.5v-3h2v3M18.5 13.5v-3h1.5"],
  ],
  other: [
    ["line", "circle", 12, 12, 8],
    ["line", "path", "M12 8.5v7M8.5 12h7"],
  ],
};

// Обычный объект, а не Map: имена из прототипа («constructor», «__proto__»)
// находятся и ведут себя так же, как у прежнего значка.
const ART = Object.fromEntries(Object.entries(SHAPES).map(([name, shapes]) => [name, drawAll(shapes)]));
