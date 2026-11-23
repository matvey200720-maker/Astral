// Числа, пороги и таблицы инструментов сцены большой карты. Только данные,
// записанные компактно: имена и значения рядом, таблицы собираются небольшими помощниками.

// «имя имя имя» + [значения] → замороженный объект
const zip = (names, values) =>
  Object.freeze(Object.fromEntries(names.split(" ").map((name, at) => [name, values[at]])));

// {слой: "инструмент инструмент"} → {инструмент: слой}
const invert = (groups) =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(groups).flatMap(([layer, tools]) => tools.split(" ").map((tool) => [tool, layer])),
    ),
  );

const toolSet = (names) => new Set(names.split(" "));

// время (мс и доли)
export const [
  QUIET_MS,
  GLIDE_TAU_MS,
  FLOOR_PERIOD_MS,
  DOUBLE_PRESS_MS,
  FLIGHT_ARRIVE_SHARE,
  FLIGHT_SKIP_SPAN,
  FRAME_MS,
] = [90, 65, 90, 350, 0.72, 0.05, 1000 / 60];

// камера
export const [
  CANVAS_MARGIN,
  MAX_STRETCH,
  ZOOM_STEP,
  CLICK_SLOP,
  FALLBACK_WIDTH,
  MIN_SPAN,
  NOTICEABLE_SHARE,
] = [0.25, 1.7, 1.25, 4, 800, 40, 0.25];

export const ZOOM_LIMITS = zip("min max", [1, 28]);
export const KEY_PAN = zip("plain fast", [80, 240]);
export const FOCUS_FIELD = zip("show hidden frame", [3, 1.4, 1.1]);

// подписи у порога читаемости: насколько сцена может отстать и на сколько сдвигается переменная
export const FLOOR_LAG = zip("rest gesture", [0.03, 0.015]);
export const FLOOR_DRIFT = zip("rest gesture", [0.0005, 0.02]);

// допуски и размеры в точках экрана
export const POINTS = zip(
  "hit close handle handleGap edgeFactor labelReach meshReach majesticReach brushStep shapeClick shapePull strokeMin",
  [9, 13, 10, 22, 1.4, 0.5, 0.5, 0.6, 0.75, 140, 24, 3],
);

// какой слой берёт курсор у инструмента (нет в таблице: все слои)
export const HIT_LAYERS = invert({
  all: "select layers",
  zones: "zones areas",
  markers: "markers labels",
  emblems: "text images schedule",
  none: "majestic eraser brush game templates",
});

export const ZONE_HANDLE_TOOLS = toolSet("select layers zones areas");
export const LABEL_TOOLS = toolSet("select labels areas layers");
export const HOVER_TOOLS = LABEL_TOOLS;

// слои, у которых объекты входят и уходят с анимацией
export const ANIMATED_LAYERS = Object.freeze(
  "zone-fills zones zone-labels markers label-mesh marker-labels emblems".split(" "),
);

export const MOTION = zip("freshMs freshMax appearMs vanishMs animMax waveMs waveStep", [
  760, 12, 640, 320, 1600, 280, 16,
]);

export const HANDLE_CURSORS = Object.freeze({
  ...Object.fromEntries([0, 1, 2, 3].map((corner) => [`corner-${corner}`, corner % 2 ? "nesw" : "nwse"])),
  rotate: "rotate",
});

export const SPACE_TARGET_SKIP = ["input", "textarea", "select", "button", "[role='button']"].join(", ");
