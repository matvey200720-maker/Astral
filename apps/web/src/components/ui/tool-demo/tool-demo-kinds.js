// Какой образец показать в карточке инструмента: сцена, действие и уточнения рисунка.
// Таблицы — обычные объекты, поиск идёт «как есть», в том числе по унаследованным
// ключам (constructor, toString…): это часть прежнего поведения, его чинят отдельно.

/* ---------- помощники для записи таблиц ---------- */

const words = (...parts) => parts.join(" ").split(" ");

const pairs = (...parts) => Object.fromEntries(words(...parts).map((pair) => pair.split("=")));

// { значение: "имя имя" } -> { имя: значение, ... }
const fan = (groups) =>
  Object.fromEntries(
    Object.entries(groups).flatMap(([value, names]) =>
      words(...[names].flat()).map((name) => [name, value]),
    ),
  );

const rect = (x, y, w, h) => ({ x, y, w, h });
const dot = (x, y) => ({ x, y });

/* ---------- виды действий и общие списки ---------- */

export const DEMO_KINDS = Object.freeze(
  words(
    "paint zone move marquee picker shape picture text emblem light model",
    "parts select pattern templates standard size effect tune draw eraser sound",
  ),
);

// Эти инструменты не перебиваются запасным действием редактора.
const UNIVERSAL = words("templates standard patterns models emblem text layers select items");

const NO_CARD = words("target-hp optimization");

// id инструмента -> действие (124 id)
const GENERAL = fan({
  paint: [
    "colour color look paint surfaces tone gradient fill walls floor ceiling facade",
    "outside inside sides asphalt dirt sidewalk markings ground foliage forest flowers",
    "sandy water sky exits seats shell body zones zone",
  ],
  picture: "screen screens posters signs image images picture board outBanners flag",
  emblem: "outLogos emblem logo logos stickers icons marker markers marks",
  text: "text word title name labels font family numbers mazeSign blimp",
  light: "light lights lamps glare flash sun moon rainbow",
  model: "models attachments decorations replace props place placement",
  parts: "structure layers objects remove visibility parts others",
  select: "items view select where places target",
  picker: "picker",
  pattern: "patterns",
  templates: "templates",
  standard: "standard",
  size: "size distance zoom flight spread position",
  effect: "particles tracers exhaust slipstream film vignette timing gravity motion speed",
  tune: "lines dot ring chevron outline opacity shape rows optics",
  draw: "brush draw",
  eraser: "eraser",
  sound: "mixer sources source",
});

// Действие незнакомого инструмента по сцене.
const SCENE_DEFAULT = fan({
  paint: "hall facade street sky field weapon outfit",
  tune: "hud",
  effect: "range",
  draw: "sheet",
  sound: "sound",
});

// Что красит краска, если редактор не сказал иначе (сравнение строгое).
const ID_TARGETS = new Map([
  ["floor", "floor"],
  ["ceiling", "ceiling"],
  ["sidewalk", "side"],
]);

/* ---------- сцены ---------- */

const VIEW_SCENES = new Map([
  ["inside", "hall"],
  ["outside", "facade"],
]);

// Сцена зависит от вида; любое другое значение вида даёт «иначе».
const byView = (otherwise) => (view) => VIEW_SCENES.get(view) ?? otherwise;

const SCENE_OF = {
  ...fan({
    hall: "projectinteriors majesticinteriors",
    facade: "factory climbs banners shops-outside shops megamall ashan youtool mapping schedule",
    street: "roads lamps billboards busstops atms wheel-smoke",
    sky: "airships floatlogo flags timecycle vinewood",
    field: "zones captzones mslzones water vegetation world-map",
    hud: "minimap reticle gps fonts group-markers screen-hits kill-effect",
    range: "wallbang",
    weapon: "gun",
    outfit: "clothing",
    sheet: "texture-studio",
    sound: "sound-kit sound-mix sound-studio",
  }),
  arena: byView("hall"),
  hangar: byView("facade"),
};

/* ---------- поправки редакторов ---------- */

// Дирижабли показывают вид из сцены, а пустой — обычный дирижабль.
const blankToBlimp = (scene) => scene || "blimp";

// Редактор с рисунком-образцом и общей целью краски.
const crafted = (variant, rest = {}) => ({ variant, target: "craft", ...rest });

const BILLBOARD_KINDS = pairs("billboards=picture signs=text");
const PLACE_SELECT = pairs("place=select");
const TONE_SIZE = pairs("tone=size");
const GEAR_KINDS = pairs("game=select model=select place=emblem");

// Якоря минимапа и GPS общие: те же вложенные объекты уходят наружу как есть.
const MAP_FOCUS = {
  spot: dot(25, 46),
  object: rect(8, 34, 34, 24),
  frame: rect(12, 38, 26, 16),
  zone: "M8 34H42V58H8Z",
};

const TWEAKS = {
  arena: { kinds: pairs("star=model"), targets: pairs("seats=box exits=sign") },
  hangar: { grounds: pairs("inside=hall structure=hall emblem=hall text=hall outside=facade") },
  factory: { targets: pairs("ground=ground containers=box") },
  megamall: { kinds: BILLBOARD_KINDS },
  youtool: { kinds: BILLBOARD_KINDS },
  climbs: crafted("mark"),
  shops: { kinds: PLACE_SELECT },
  "shops-outside": { kinds: PLACE_SELECT },
  projectinteriors: { kinds: pairs("interior=select sources=model") },
  majesticinteriors: { kinds: pairs("coverings=paint glow=light surfaces=paint packs=model") },
  banners: {
    kinds: pairs("banners=select"),
    focus: { frame: rect(98, 17, 14, 33), object: rect(98, 17, 14, 33), spot: dot(105, 33) },
  },
  schedule: crafted("board", { kinds: pairs("rows=text title=text colours=paint opacity=parts") }),
  lamps: { fallback: "light", kinds: pairs("pole=paint particles=effect") },
  roads: { targets: pairs("markings=lines") },
  busstops: { target: "box", kinds: pairs("opacity=parts"), focus: { spot: dot(114, 37) } },
  atms: crafted("atm"),
  billboards: {
    kinds: pairs("all=picture"),
    focus: { object: rect(14, 7, 34, 15), route: "M18 18C22 10 28 19 33 12C37 8 42 12 45 16" },
  },
  "wheel-smoke": crafted("smoke", { kinds: pairs("look=templates shape=size where=select") }),
  airships: crafted(blankToBlimp, { kinds: pairs("sky=select") }),
  flags: crafted("flag"),
  floatlogo: crafted("logo", { kinds: pairs("content=picture motion=move look=size") }),
  vinewood: crafted("letters"),
  timecycle: {
    variant: "clear",
    targets: pairs("clouds=clouds"),
    kinds: pairs("picture=paint rainbow=draw"),
    toolFocus: {
      rainbow: { route: "M24 50A56 34 0 0 1 136 50" },
    },
  },
  zones: {
    fallback: "zone",
  },
  captzones: {
    fallback: "zone",
  },
  mslzones: { fallback: "zone", kinds: pairs("distance=size") },
  water: {
    target: "sea",
  },
  vegetation: crafted("trees", { targets: pairs("grass=body") }),
  mapping: { kinds: pairs("look=paint decals=emblem") },
  minimap: {
    target: "map",
    targets: pairs("bars=bars"),
    focus: MAP_FOCUS,
    toolFocus: { damage: { spot: dot(24, 60) } },
    kinds: pairs(
      "bars=select icons=emblem damage=effect frame=zone gps=draw",
      "view=size text=picture arrow=move screen=move",
    ),
  },
  gps: {
    focus: MAP_FOCUS,
    kinds: pairs("marker=emblem server=draw accuracy=draw"),
  },
  reticle: {
    target: "cross",
    kinds: pairs("ammo=move"),
    toolFocus: { ammo: { object: rect(128, 6, 24, 5) } },
  },
  "kill-effect": { target: "screen", kinds: pairs("screen=paint distance=paint film=paint") },
  "screen-hits": {
    target: "screen",
    kinds: pairs("shape=picture time=light"),
    focus: { frame: rect(116, 8, 34, 22), spot: dot(133, 19) },
  },
  "sound-kit": { kinds: TONE_SIZE },
  "sound-mix": { kinds: TONE_SIZE },
  "sound-studio": { kinds: pairs("tone=size banks=select edit=size packs=templates") },
  gun: { kinds: GEAR_KINDS },
  clothing: { kinds: GEAR_KINDS, toolFocus: { layers: { object: rect(66, 30, 28, 16) } } },
  wallbang: crafted("cover", { kinds: pairs("look=paint cover=select covers=parts") }),
  "effects-tracer": crafted("tracer"),
  "effects-environment": crafted("fire", { kinds: pairs("family=select") }),
  "effects-impact": { kinds: pairs("layers=effect placement=effect") },
  "world-map": {
    own: words("eraser brush text markers zones images"),
    kinds: pairs(
      "select=select labels=text schedule=picture areas=zone",
      "majestic=emblem game=size layers=parts",
    ),
  },
  "texture-studio": {
    kinds: pairs(
      "move=move hand=move marquee=marquee lasso=marquee wand=marquee brush=draw stamp=draw",
      "heal=draw soften=draw eraser=eraser fill=paint tone=light picker=picker text=text",
      "shape=shape zoom=size",
    ),
  },
};

// Ключ редактора превращается в строку; находка может быть и унаследованной.
const tweaksOf = (editorKey) => TWEAKS[String(editorKey)];

/* ---------- правила выбора действия, от сильного к слабому ---------- */

// undefined — «правило молчит»; null — «карточки нет».
const KIND_RULES = [
  // название от самого инструмента сильнее всех правил редакторов
  ({ tool }) => (DEMO_KINDS.includes(tool.demo) ? tool.demo : undefined),
  // у большой карты кисть и ластик показывают свой образец в панели
  ({ rec, id }) => (rec?.own?.includes(id) ? null : undefined),
  ({ rec, id }) => rec?.kinds?.[id] || undefined,
  ({ rec, id }) => (UNIVERSAL.includes(id) ? undefined : rec?.fallback),
  ({ id }) => GENERAL[id],
  ({ ground }) => SCENE_DEFAULT[ground],
];

/* ---------- публичные функции ---------- */

export function demoFocus(toolId, editorKey = "") {
  const rec = tweaksOf(editorKey);
  const common = rec?.focus;
  const special = rec?.toolFocus?.[toolId];
  if (!common && !special) return null;
  return { ...common, ...special };
}

export function paintTarget(toolId, editorKey = "") {
  const rec = tweaksOf(editorKey);
  return rec?.targets?.[toolId] || rec?.target || ID_TARGETS.get(toolId) || "body";
}

export function demoVariant(editorKey = "", scene = "") {
  const variant = tweaksOf(editorKey)?.variant;
  if (typeof variant === "function") return variant(scene);
  return variant ?? String(scene || "");
}

export function demoKind(tool, ground, editorKey = "") {
  if (!tool || !ground || tool.demo === false) return null;
  const facts = { tool, ground, id: tool.id, rec: tweaksOf(editorKey) };
  for (const rule of KIND_RULES) {
    const verdict = rule(facts);
    if (verdict !== undefined) return verdict;
  }
  return "paint";
}

export function demoGround(editorKey = "", scene = "", toolId = "") {
  const key = String(editorKey);
  if (key === "" || NO_CARD.includes(key)) return null;
  if (key.startsWith("effects-")) return "range";
  const ownGround = tweaksOf(key)?.grounds?.[toolId];
  if (ownGround) return ownGround;
  const entry = SCENE_OF[key];
  if (entry === undefined) return "facade";
  return typeof entry === "string" ? entry : entry(scene);
}
