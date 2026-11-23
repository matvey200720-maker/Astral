// Мини-карта из minimap.gfx чужого мода: проект для редактора и вид полос для обложки.
import {
  TAG,
  TWIPS,
  displayList,
  importedNames,
  multiply,
  readBitmap,
  readEditText,
  readGfx,
  readPlacement,
  readShape,
  readSprite,
} from "@modovik/gfx";
import {
  DEFAULT_MINIMAP_EFFECTS,
  MINIMAP_ARMOUR_RUNTIME_SCALE,
  MINIMAP_EDITOR_UNITS,
  MINIMAP_GAME_COLORS,
  MINIMAP_NUMBER_SIZE_LIMITS,
  MINIMAP_RADAR,
} from "@modovik/minimap-contract";
import {
  applyMinimapVitalsLayout,
  createDefaultMinimapLayout,
  normalizeMinimapLayout,
} from "../../../components/desktop/workshop/minimap-layout.js";
import { tr } from "../../../locales/ui.js";
import { readMinimapScript } from "./minimap-script.js";

export const MINIMAP_LOOK_VERSION = 1;
export const MINIMAP_LOOK_STATE = Object.freeze({ health: 75, armor: 0 });
export const EDITOR_VITALS = Object.freeze({
  health: MINIMAP_GAME_COLORS.health,
  armor: MINIMAP_GAME_COLORS.armor,
  track: "#111723",
});

// Слова о потерях: русские литералы, дальше они идут в список потерь правила импорта.
const SAY = {
  noCode:
    "цвет полос HP и брони: код мода его не задаёт, и что покажет игра, не проверить — в редакторе цвета игры",
  palette: "цвет полос — как нарисовал автор: палитра HUD игры (зелёный и синий) его не красит",
  pictureHealth: "картинка в полосе HP — в редакторе ровный цвет её среднего тона",
  pictureArmour: "картинка в полосе брони — в редакторе ровный цвет её среднего тона",
  ownUnder:
    "лента под радаром и подложка bar_bg автора — в редакторе под полосами одна своя подложка",
  otherUnder:
    "лента под радаром или подложка bar_bg у автора другого тона — в редакторе как в игре",
  ability: "полосы способности и воздуха в цветах автора — в редакторе их нет",
  flash: (colour) => `цвет вспышки урона ${colour} — в редакторе как в игре`,
  font: (who, face) =>
    `цифры ${who} написаны шрифтом «${face}», которого нет среди шрифтов игры, ` +
    "— игра их не нарисует, и на обложке их нет",
};

const tagCodes = (names) => new Set(names.split(" ").map((key) => TAG[key]));
const SHAPE_CODES = tagCodes("DEFINE_SHAPE DEFINE_SHAPE2 DEFINE_SHAPE3 DEFINE_SHAPE4");
const PLACE_CODES = tagCodes("PLACE_OBJECT PLACE_OBJECT2 PLACE_OBJECT3");
const GAME_FONTS = new Set(
  "$Font2 $Font2_cond $Font2_cond_NOT_GAMERNAME $Font2_cond_MPTimer $FixedWidthNumbers $gtaCash $Font5".split(
    " ",
  ),
);

const FLAT = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
const EVERY_FRAME = "all";
const RGB = [0, 1, 2];
// Штатные тона из файла игры; сравнение с ними идёт с допуском в единицу.
const STOCK = { trough: [204, 204, 204, 127], band: [0, 0, 0, 127], under: [0, 0, 0, 51] };
const STOCK_HEIGHT = 2520;
const STOCK_WIDTH = 5037;
const STOCK_GAP = 1820;
const FLASH_FIELD_PAD = 2;
const DIGIT_MIDLINE = 0.45;
const LAYOUT_BY_EDGE = {
  top: ["top-row", "top-stack"],
  bottom: ["bottom-row", "bottom-stack"],
  left: ["left-split", "left-vertical"],
  right: ["right-split", "right-vertical"],
};
// Край по условию «левее середины радара» или «выше середины»: ложь, истина.
const TURNED_EDGES = ["right", "left"];
const PLAIN_EDGES = ["bottom", "top"];
// Поля ответа, по которым видно, что автор менял вид полос против игры.
const AUTHOR_PROBES =
  "healthColor armorColor barOpacity trackMode lowHealthColor lowHealthThreshold damageColorMode".split(
    " ",
  );
const COLOR_SLOTS = [
  ["health", "healthColor"],
  ["armor", "armorColor"],
  ["track", "trackColor"],
];
// Полоса за полосой: куда смотреть в контейнере, чем красить и как растягивать.
const STRIPES = [
  {
    side: "health",
    bar: "healthBar",
    trough: "healthTrough",
    tone: "hp",
    troughTone: "trough",
    barPull: () => 1,
    troughPull: () => undefined,
  },
  {
    side: "armor",
    bar: "armourBar",
    trough: "armourTrough",
    tone: "arm",
    troughTone: "armTrough",
    barPull: (rig) => rig.stretch,
    troughPull: (rig) => rig.stretch,
  },
];
// Поля цифр: свои имена, имя из кода мода и слово для потерь.
const SIDES = [
  { side: "health", own: "healthNum", coded: "health", who: "HP" },
  { side: "armor", own: "armourNum", coded: "armour", who: "брони" },
];

/* ---------- числа, цвета, матрицы ---------- */

const squeeze = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snap = (v) => Math.round(v * 1000) / 1000 + 0;
const byteHex = (v) => squeeze(Math.round(v), 0, 255).toString(16).padStart(2, "0");
const hexOf = (rgb) => `#${RGB.map((i) => byteHex(rgb[i])).join("")}`;

const tint = (rgba, cx) =>
  rgba.map((v, i) => squeeze(v * (cx?.mult?.[i] ?? 1) + (cx?.add?.[i] ?? 0), 0, 255));
// Закраска кодом: цвет прибавляется к фигуре, из суммы вычитается белый.
const dye = (rgba, rgb) =>
  RGB.map((i) => squeeze(rgba[i] + rgb[i] - 255, 0, 255)).concat(rgba[3]);
// Первые span каналов преобразование цвета не трогает.
const untouched = (cx, span) =>
  [0, 1, 2, 3]
    .slice(0, span)
    .every((i) => (cx?.mult?.[i] ?? 1) === 1 && (cx?.add?.[i] ?? 0) === 0);
const nearTo = (rgba, want) => want.every((w, i) => Math.abs(rgba[i] - w) <= 1);
const faint = (rgba, want) => !rgba || !(rgba[3] > 0) || nearTo(rgba, want);
const seen = (rgba) => Boolean(rgba) && rgba[3] > 0;

const inPoints = (m) => {
  const full = { ...FLAT, ...m };
  return { ...full, tx: full.tx / TWIPS, ty: full.ty / TWIPS };
};
// Длина вектора (a, b) становится len, поворот остаётся.
const lengthened = (m, len) => {
  const now = Math.hypot(m.a, m.b);
  return now ? { ...m, a: (m.a / now) * len, b: (m.b / now) * len } : { ...m, a: len, b: 0 };
};

const said = (rules) => rules.filter(([on]) => on).map(([, text]) => text);
const keep = (pairs) => Object.fromEntries(pairs.filter(([, v]) => v !== undefined));
const firstHit = (list, probe) => {
  for (const item of list) {
    const got = probe(item);
    if (got) return got;
  }
  return null;
};
const lazily = (make) => {
  let cell = null;
  return () => {
    cell = cell ?? { value: make() };
    return cell.value;
  };
};

/* ---------- рамки: четвёрки [x0, y0, x1, y1] ---------- */

const PICK = [Math.min, Math.min, Math.max, Math.max];
const merge = (a, b) => a.map((v, i) => PICK[i](v, b[i]));
const hull = (boxes) => {
  const list = boxes.filter(Boolean);
  return list.length ? list.reduce(merge) : null;
};
const mapPoint = (m, x, y) => [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty];
const warp = ([x0, y0, x1, y1], m) =>
  hull(
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(([x, y]) => {
      const [px, py] = mapPoint(m, x, y);
      return [px, py, px, py];
    }),
  );
// Границы и рёбра фигуры в файле лежат в твипах; вид считается в точках сцены.
const toPoints = (twips) => twips / TWIPS;
const boundsBox = (b) => [b.xmin, b.ymin, b.xmax, b.ymax].map(toPoints);
const asCorners = (box) =>
  Object.fromEntries(["x0", "y0", "x1", "y1"].map((key, i) => [key, snap(box[i])]));

// Прямоугольник на сцене: центр, размеры вдоль осей матрицы и угол.
const stageRect = ([x0, y0, x1, y1], m) => {
  const [x, y] = mapPoint(m, (x0 + x1) / 2, (y0 + y1) / 2);
  const raw = {
    x,
    y,
    width: Math.hypot(m.a, m.b) * (x1 - x0),
    height: Math.hypot(m.c, m.d) * (y1 - y0),
    rotate: (Math.atan2(m.b, m.a) * 180) / Math.PI,
  };
  return Object.fromEntries(Object.entries(raw).map(([key, v]) => [key, snap(v)]));
};

// Прямоугольник без цвета или с нулевой альфой на сцене не рисуется.
const dressed = (rect, rgba) =>
  rect && rgba && rgba[3] > 0 ? { ...rect, rgba: rgba.map((v) => Math.round(v)) } : null;

const isDrawn = (e) => Boolean(e.characterId) && !e.clipDepth && e.visible !== false;

/* ---------- чтение фильма ---------- */

function openAtlas(gfx) {
  const defs = gfx.definitions;
  const bytes = gfx.bytes;
  // Ключ — число или набор чисел; в таблице он хранится строкой.
  const once = (make) => {
    const shelf = new Map();
    return (key) => {
      const slot = String(key);
      if (!shelf.has(slot)) shelf.set(slot, make(key));
      return shelf.get(slot);
    };
  };
  const isShape = (tag) => Boolean(tag) && SHAPE_CODES.has(tag.code);
  const shapeOf = (tag) => {
    try {
      return readShape(bytes, tag);
    } catch {
      return null;
    }
  };
  const bitmapOf = (id) => {
    try {
      const tag = defs.get(id);
      return tag ? readBitmap(bytes, tag) : null;
    } catch {
      return null;
    }
  };

  // Нет определения — нет и спрайта; читается только то, что в файле есть.
  const spriteOf = once((id) => (defs.has(id) ? readSprite(gfx, id) : null));
  // Список отображения одного кадра читается много раз: полосы, рамки, проверка игры.
  const shownAt = once(([id, frame]) => displayList(gfx, id, frame));

  const places = once((id) => {
    const sprite = spriteOf(id);
    const tags = sprite ? sprite.tags.filter((t) => PLACE_CODES.has(t.code)) : [];
    return tags.flatMap((tag) => {
      try {
        const { name, characterId, matrix, cxform } = readPlacement(bytes, tag);
        return [{ name, characterId, matrix: { ...FLAT, ...matrix }, cxform: cxform ?? null }];
      } catch {
        return [];
      }
    });
  });
  const named = (parent, name) => places(parent).find((p) => p.name === name && p.characterId);
  const anon = (parent) => places(parent).find((p) => !p.name && p.characterId);
  const somewhere = (name) => firstHit([...defs.keys()], (id) => named(id, name));

  // Средний тон растра, взвешенный по непрозрачности.
  const pictureTone = (bitmapId) => {
    const bmp = bitmapOf(bitmapId);
    if (!bmp) return { rgba: [255, 255, 255, 255], picture: true };
    const px = bmp.rgba;
    const weighted = [0, 0, 0, 0];
    for (let at = 0; at + 3 < px.length; at += 4) {
      RGB.forEach((i) => {
        weighted[i] += px[at + i] * px[at + 3];
      });
      weighted[3] += px[at + 3];
    }
    const total = weighted[3];
    const shares = RGB.map((i) => weighted[i] / total);
    const mean = total ? [...shares, total / (px.length / 4)] : [0, 0, 0, 0];
    return { rgba: mean.map((v) => Math.round(v)), picture: true };
  };

  const shapeTone = (tag) => {
    const fill = (shapeOf(tag)?.fills ?? []).find(Boolean);
    if (fill?.type === "solid") return { rgba: [...fill.color], picture: false };
    if (fill?.type === "bitmap") return pictureTone(fill.bitmapId);
    return { rgba: [255, 255, 255, 255], picture: false };
  };

  // Внутренний вид символа: цвет и признак «рисунок».
  const toneOf = (id, depth = 0) => {
    const white = { rgba: [255, 255, 255, 255], picture: false };
    if (depth > 8 || !defs.has(id)) return white;
    // Спрайт читается первым, ещё до поиска размещений: порча в нём уходит наружу.
    if (spriteOf(id)) {
      const lead = places(id).find((p) => p.characterId);
      if (!lead) return { rgba: [0, 0, 0, 0], picture: false };
      const under = toneOf(lead.characterId, depth + 1);
      return { rgba: tint(under.rgba, lead.cxform), picture: under.picture };
    }
    const tag = defs.get(id);
    return isShape(tag) ? shapeTone(tag) : white;
  };

  // Клип «как покажет игра»: красится кодом, потом ложится преобразование контейнера.
  const toneClip = (parent, name, rgb, outer) => {
    const spot = named(parent, name);
    if (!spot) return null;
    const under = toneOf(spot.characterId);
    const lit = rgb && !under.picture ? dye(under.rgba, rgb) : tint(under.rgba, spot.cxform);
    return { rgba: tint(lit, outer), inner: under.rgba, picture: under.picture };
  };

  const measure = (id, frame, depth) => {
    if (depth > 8) return null;
    const tag = defs.get(id);
    if (isShape(tag)) {
      const bounds = shapeOf(tag)?.bounds;
      return bounds ? boundsBox(bounds) : null;
    }
    const sprite = spriteOf(id);
    if (!sprite) return null;
    const every = frame === EVERY_FRAME;
    const frames = every ? [...Array(sprite.frameCount).keys()] : [frame];
    const parts = frames
      .flatMap((f) => shownAt([id, f]))
      .filter(isDrawn)
      .map((e) => {
        const inner = boxOf(e.characterId, every ? EVERY_FRAME : 0, depth + 1);
        return inner && warp(inner, inPoints(e.matrix));
      });
    return hull(parts);
  };
  const boxes = once(([id, frame, depth]) => measure(id, frame, depth));
  const boxOf = (id, frame, depth = 0) => boxes([id, frame, depth]);

  // Замкнутые контуры заливки фигуры (по одному ряду рёбер); без контуров — рамка фигуры.
  const outlines = (id) => {
    const tag = defs.get(id);
    if (!isShape(tag)) return [boxOf(id, 0)].filter(Boolean);
    const shape = shapeOf(tag);
    if (!shape) return [];
    const runs = (shape.edges ?? [])
      .filter((e) => e.fill0 || e.fill1)
      .reduce((acc, e) => {
        const [lowX, highX] = [Math.min(e.x0, e.x1), Math.max(e.x0, e.x1)];
        const [lowY, highY] = [Math.min(e.y0, e.y1), Math.max(e.y0, e.y1)];
        return acc.set(e.run, hull([acc.get(e.run), [lowX, lowY, highX, highY]]));
      }, new Map());
    return runs.size ? [...runs.values()].map((box) => box.map(toPoints)) : [boundsBox(shape.bounds)];
  };

  // Играет ли клип сам: кадры различаются или внутри играет вложенный клип.
  const motion = (id, depth = 0) => {
    const sprite = spriteOf(id);
    if (!sprite || depth > 4) return null;
    const reel = Array.from({ length: sprite.frameCount }, (_, f) => shownAt([id, f]));
    const stamp = (list) =>
      JSON.stringify(
        list.map((e) => [e.depth, e.characterId, e.matrix, e.cxform]).concat(
          list.map((e) => [e.ratio, e.visible, e.clipDepth]),
        ),
      );
    const head = reel.length ? stamp(reel[0]) : "";
    const selfPlays = sprite.frameCount > 1 && reel.some((list) => stamp(list) !== head);
    const kids = new Set(reel.flat().map((e) => e.characterId).filter(Boolean));
    const inner = [...kids].map((kid) => motion(kid, depth + 1)?.frames ?? 0);
    const frames = Math.max(selfPlays ? sprite.frameCount : 0, ...inner);
    return frames > 0 ? { frames } : null;
  };

  return {
    spriteOf,
    tagOf: (id) => defs.get(id),
    places,
    named,
    anon,
    somewhere,
    toneOf,
    toneClip,
    boxOf,
    outlines,
    motion,
  };
}

// Контейнер полос: экспорт малого варианта, а без него — первый спрайт с healthArmourMC.
const locateHub = (atlas, gfx) => {
  const exported = gfx.exports.get("HEALTH_ARMOUR_ABILITY_SMALL");
  const pool = exported === undefined ? [...gfx.definitions.keys()] : [exported];
  return firstHit(pool, (id) => {
    const placed = atlas.named(id, "healthArmourMC");
    return placed ? { id, placed } : null;
  });
};

const layoutOf = (atlas, hub) => {
  const m = hub.placed.matrix;
  const inside = atlas.places(hub.placed.characterId);
  const hb = inside.find((p) => p.name === "healthBar");
  const ab = inside.find((p) => p.name === "armourBar");
  const [dx, dy] = ab
    ? [Math.abs(ab.matrix.tx - (hb?.matrix.tx ?? 0)), Math.abs(ab.matrix.ty - (hb?.matrix.ty ?? 0))]
    : [STOCK_GAP, 0];
  const turned = m.b !== 0 || m.c !== 0;
  const edge = turned
    ? TURNED_EDGES[Number(m.tx < STOCK_WIDTH / 2)]
    : PLAIN_EDGES[Number(m.ty < STOCK_HEIGHT / 2)];
  return {
    layout: LAYOUT_BY_EDGE[edge][Number(dy > dx)],
    thickness: snap(squeeze(Math.hypot(m.c, m.d), 0.5, 3)),
  };
};

/* ---------- поля текста ---------- */

// Цвет и кегль поля DefineEditText прямо из байт тега.
const rawText = (bytes, tag) => {
  const rectEnd = tag.start + 2 + Math.ceil((5 + 4 * (bytes[tag.start + 2] >> 3)) / 8);
  const [flags, flags2] = [bytes[rectEnd], bytes[rectEnd + 1]];
  const hasFont = Boolean(flags & 0x01);
  let at = rectEnd + 2 + (hasFont ? 2 : 0);
  if (flags2 & 0x80) {
    const stop = bytes.indexOf(0, at);
    at = Math.min(stop < 0 ? tag.end : stop, tag.end) + 1;
  }
  const size = hasFont ? (bytes[at] | (bytes[at + 1] << 8)) / TWIPS : null;
  at += hasFont ? 2 : 0;
  const painted = (flags & 0x04) !== 0 && tag.end - at >= 4;
  return { size, color: painted ? hexOf(bytes.subarray(at, at + 3)) : "#ffffff" };
};

const flatScale = (m) => Math.hypot(m.a, m.b) || 1;

// Цвет и кегль поля с учётом масштаба размещения; обёртка из спрайтов — до трёх уровней.
const fieldStyle = (atlas, bytes, spot, level = 0) => {
  const factor = flatScale(spot.matrix);
  const tag = atlas.tagOf(spot.characterId);
  if (tag?.code === TAG.DEFINE_EDIT_TEXT) {
    const { size, color } = rawText(bytes, tag);
    return { color, size: size === null ? null : size * factor };
  }
  const kids = level < 3 && atlas.spriteOf(spot.characterId) ? atlas.places(spot.characterId) : [];
  const got = firstHit(kids, (kid) => {
    if (!kid.characterId) return null;
    const style = fieldStyle(atlas, bytes, kid, level + 1);
    return style.size === null ? null : style;
  });
  return got ? { color: got.color, size: got.size * factor } : { color: "#ffffff", size: null };
};

// Текстовое поле под размещением: прямо или внутри спрайта-обёртки.
const textUnder = (atlas, spot, base, level = 0) => {
  const m = multiply(base, inPoints(spot.matrix));
  const tag = atlas.tagOf(spot.characterId);
  if (tag?.code === TAG.DEFINE_EDIT_TEXT) return { tag, m, cx: spot.cxform };
  if (level >= 3 || !atlas.spriteOf(spot.characterId)) return null;
  const kids = atlas.places(spot.characterId).filter((p) => p.characterId);
  return firstHit(kids, (kid) => textUnder(atlas, kid, m, level + 1));
};

const readNumbers = (rig, look) => {
  const { atlas, gfx, hub, script } = rig;
  const styles = SIDES.map(({ own, coded }) => {
    const alias = script?.digits?.[coded];
    const spot = atlas.named(hub.id, own) || (alias ? atlas.somewhere(alias) : null);
    return spot ? fieldStyle(atlas, gfx.bytes, spot) : null;
  });
  if (!styles.some(Boolean) || (look && look.digits.length === 0)) return null;
  const sizes = styles.filter((s) => s && s.size !== null).map((s) => s.size);
  const [lo, hi] = MINIMAP_NUMBER_SIZE_LIMITS;
  const inEditor = (pt) =>
    Math.round(squeeze((pt * MINIMAP_EDITOR_UNITS) / MINIMAP_RADAR.width, lo, hi));
  return {
    health: styles[0]?.color ?? null,
    armor: styles[1]?.color ?? null,
    size: sizes.length ? inEditor(Math.max(...sizes)) : null,
  };
};

/* ---------- вид полос ---------- */

// Клип в контейнере полос на сцене; xscale заменяет длину по оси.
const stripeOf = (rig, name, rgba, xscale) => {
  const { atlas, barsId, frame } = rig;
  const spot = atlas.named(barsId, name);
  const box = spot && rgba ? atlas.boxOf(spot.characterId, 0) : null;
  if (!box) return null;
  const own = inPoints(spot.matrix);
  const placed = multiply(frame, xscale === undefined ? own : lengthened(own, xscale));
  const rect = dressed(stageRect(box, placed), rgba);
  return rect && { rect, id: spot.characterId, box };
};

// Играющая полоса получает описание петли.
const withMotion = (rig, { rect, id, box }) => {
  const { atlas, gfx } = rig;
  const moving = atlas.motion(id);
  if (!moving) return rect;
  const rate = typeof gfx.frameRate === "number" && gfx.frameRate ? gfx.frameRate : 30;
  return {
    ...rect,
    animation: {
      characterId: id,
      frames: moving.frames,
      own: atlas.spriteOf(id)?.frameCount || 1,
      fps: rate,
      box: asCorners(box),
      whole: asCorners(atlas.boxOf(id, EVERY_FRAME) ?? box),
    },
  };
};

const barOf = (rig, row) => {
  const got = stripeOf(rig, row.bar, rig[row.tone]?.rgba, row.barPull(rig));
  return got ? { side: row.side, ...withMotion(rig, got) } : null;
};

const troughOf = (rig, row) =>
  stripeOf(rig, row.trough, rig[row.troughTone]?.rgba, row.troughPull(rig))?.rect ?? null;

// Лента под радаром — безымянная фигура самого контейнера.
const ribbonOf = ({ atlas, hub }) => {
  const spot = atlas.anon(hub.id);
  const box = spot && atlas.boxOf(spot.characterId, 0);
  if (!box) return null;
  const rgba = tint(atlas.toneOf(spot.characterId).rgba, spot.cxform);
  return dressed(stageRect(box, inPoints(spot.matrix)), rgba);
};

// Подложки bar_bg: по слою на каждый замкнутый контур кадра (в сети — второго).
const underlaysOf = ({ atlas, gfx, hub }) => {
  const bg = atlas.named(hub.id, "bar_bg");
  if (!bg) return [];
  const sprite = atlas.spriteOf(bg.characterId);
  if (!sprite) return [];
  const frame = Math.max(0, Math.min(1, sprite.frameCount - 1));
  const kids = displayList(gfx, bg.characterId, frame).filter(isDrawn);
  if (!kids.length) return [];
  const rgba = tint(tint(atlas.toneOf(kids[0].characterId).rgba, kids[0].cxform), bg.cxform);
  const at = inPoints(bg.matrix);
  return kids.flatMap((kid) =>
    atlas
      .outlines(kid.characterId)
      .map((box) => dressed(stageRect(box, multiply(at, inPoints(kid.matrix))), rgba)),
  );
};

// Где стоит поле цифр: свои имена, потом названное кодом; родители — контейнер, полосы, глубиномер.
const fieldSpot = (rig, { own, coded }) => {
  const { atlas, gfx, hub, script, barsId, frame } = rig;
  const gaugeId = gfx.exports.get("depth_bar");
  const parents = [
    { id: hub.id, m: FLAT },
    { id: barsId, m: frame },
  ];
  if (gaugeId !== undefined && script?.gauge) {
    parents.push({ id: gaugeId, m: { ...FLAT, tx: script.gauge.x, ty: script.gauge.y } });
  }
  const names = [own, script?.digits?.[coded]].filter(Boolean);
  const pairs = names.flatMap((name) => parents.map((parent) => ({ name, parent })));
  return firstHit(pairs, ({ name, parent }) => {
    const spot = atlas.named(parent.id, name);
    return spot && { spot, base: parent.m };
  });
};

// Цифры одной стороны: { digit } для обложки, { word } для потерь или пусто.
const digitOf = (rig, row) => {
  const found = fieldSpot(rig, row);
  const text = found && textUnder(rig.atlas, found.spot, found.base);
  if (!text) return {};
  const info = readEditText(rig.gfx.bytes, text.tag);
  const m = text.m;
  if (!info.size || Math.abs(m.b) > 0.01 || Math.abs(m.c) > 0.01) return {};
  const face = rig.faces().get(info.fontId) || info.fontClass || "";
  if (!GAME_FONTS.has(face)) return { word: SAY.font(row.who, face || "?") };
  const size = info.size * Math.hypot(m.c, m.d);
  const top = m.d * info.bounds.ymin + m.ty + FLASH_FIELD_PAD * Math.abs(m.d);
  return {
    digit: {
      side: row.side,
      x0: snap(m.a * info.bounds.xmin + m.tx),
      x1: snap(m.a * info.bounds.xmax + m.tx),
      y: snap(top + size * DIGIT_MIDLINE),
      size: snap(size),
      align: info.align,
      color: hexOf(tint(info.color, text.cx)),
      font: face,
    },
  };
};

function buildLook(rig) {
  const bars = STRIPES.map((row) => barOf(rig, row)).filter(Boolean);
  if (!bars.length) return null;
  const layers = [
    ribbonOf(rig),
    ...underlaysOf(rig),
    ...STRIPES.map((row) => troughOf(rig, row)),
  ].filter(Boolean);
  const texts = SIDES.map((row) => digitOf(rig, row));
  const northId = rig.gfx.exports.get("radar_north");
  return {
    look: {
      version: MINIMAP_LOOK_VERSION,
      state: { ...MINIMAP_LOOK_STATE },
      layers,
      bars,
      digits: texts.map((t) => t.digit).filter(Boolean),
      north: northId === undefined || displayList(rig.gfx, northId, 0).length > 0,
    },
    words: texts.map((t) => t.word).filter(Boolean),
  };
}

const lookFrom = (rig) => {
  try {
    return buildLook(rig);
  } catch {
    return null;
  }
};

/* ---------- этапы чтения цветов ---------- */

const stageBars = ({ hp, arm, script, author }) => {
  const top = Math.max(hp?.rgba[3] ?? 0, arm?.rgba[3] ?? 0);
  return {
    fx: keep([
      ["healthColor", hp ? hexOf(hp.rgba) : undefined],
      ["armorColor", arm ? hexOf(arm.rgba) : undefined],
      ["barOpacity", hp || arm ? Math.max(10, Math.round((top / 255) * 100)) : undefined],
    ]),
    words: said([
      [author && Boolean(script?.health?.hud || script?.armour?.hud), SAY.palette],
      [hp?.picture, SAY.pictureHealth],
      [arm?.picture, SAY.pictureArmour],
    ]),
  };
};

const stageTrack = ({ atlas, hub, barsId, outer, trough }) => {
  const custom = Boolean(trough) && !(nearTo(trough.inner, STOCK.trough) && untouched(outer, 4));
  let rgba = trough?.rgba;
  // Безымянная подложка редактора читается только для нештатной дорожки с нулевой альфой.
  if (custom && rgba[3] === 0) {
    const veil = atlas.anon(barsId);
    if (veil) rgba = tint(tint(atlas.toneOf(veil.characterId).rgba, veil.cxform), outer);
  }
  const band = atlas.anon(hub.id);
  const bandRgba = band ? tint(atlas.toneOf(band.characterId).rgba, band.cxform) : null;
  const bgRgba = atlas.toneClip(hub.id, "bar_bg", undefined, outer)?.rgba;
  const stock = faint(bandRgba, STOCK.band) && faint(bgRgba, STOCK.under);
  const own = custom && (seen(bandRgba) || seen(bgRgba));
  return {
    fx: custom
      ? {
          trackMode: "custom",
          trackColor: hexOf(rgba),
          trackOpacity: Math.round((rgba[3] / 255) * 100),
        }
      : {},
    words: said([
      [own, SAY.ownUnder],
      [!own && !stock, SAY.otherUnder],
    ]),
  };
};

const stageLow = ({ atlas, barsId, outer, script, hp }) => {
  if (!script) return { fx: {}, words: [] };
  const red = script.low !== "colourHealth" ? script.red?.rgb : null;
  const clip = red ? atlas.toneClip(barsId, "healthBar", red, outer) : null;
  const pick = script.low === "colourHealth" ? hp : clip;
  const limit = script.threshold;
  return {
    fx: keep([
      ["lowHealthColor", pick ? hexOf(pick.rgba) : undefined],
      ["lowHealthThreshold", limit >= 1 && limit <= 99 ? Math.round(limit) : undefined],
    ]),
    words: [],
  };
};

const stageFlash = ({ atlas, hub, script }) => {
  const hit = atlas.named(hub.id, "healthHitMC");
  const kids = hit ? atlas.places(hit.characterId).filter((p) => p.characterId) : [];
  const addOf = (k) => k.cxform?.add ?? [0, 0, 0];
  const dark = (k) => RGB.every((i) => (k.cxform?.mult?.[i] ?? 1) === 0);
  const same = (k) => RGB.every((i) => addOf(k)[i] === addOf(kids[0])[i]);
  if (kids.length && kids.every(dark) && kids.every(same)) {
    return { fx: { damageColorMode: "custom", damageColor: hexOf(addOf(kids[0])) }, words: [] };
  }
  const spec = script?.damage;
  if (!spec?.hud || spec.hud === "HUD_COLOUR_DAMAGE") return { fx: {}, words: [] };
  return spec.rgb
    ? { fx: { damageColorMode: "custom", damageColor: hexOf(spec.rgb) }, words: [] }
    : { fx: {}, words: [SAY.flash(spec.hud)] };
};

const ABILITY_BARS = new Set(["abilityBar", "abilityTrough", "airBar", "airTrough"]);

const stageAbility = ({ atlas, hub, script }) => {
  const mine = atlas.places(hub.id).filter((p) => p.name === "abilityMC" || p.name === "airMC");
  const tinted = (cx) => !untouched(cx, 3);
  const byKids = (p) =>
    Boolean(p.characterId) &&
    atlas.places(p.characterId).some((k) => ABILITY_BARS.has(k.name) && tinted(k.cxform));
  const hued = Boolean(script?.ability) && script.ability.hud !== "HUD_COLOUR_YELLOW";
  const lost = mine.some((p) => tinted(p.cxform) || byKids(p)) || hued;
  return { fx: {}, words: said([[lost, SAY.ability]]) };
};

const STAGES = [stageBars, stageTrack, stageLow, stageFlash, stageAbility];

const isAuthored = (fx) =>
  AUTHOR_PROBES.some((key) => fx[key] !== undefined && fx[key] !== DEFAULT_MINIMAP_EFFECTS[key]);

/* ---------- сборка ответа ---------- */

const emptyReport = () => ({
  layout: "bottom-row",
  thickness: 1,
  colors: { ...EDITOR_VITALS },
  effects: {},
  numbers: null,
  lost: [],
  detected: { layout: false, colors: false, numbers: false },
});

// Всё, что нужно этапам: фильм, контейнер и код мода.
const openRig = (gfx, author) => {
  const atlas = openAtlas(gfx);
  const hub = locateHub(atlas, gfx);
  if (!hub) return null;
  const script = readMinimapScript(gfx);
  const barsId = hub.placed.characterId;
  const outer = hub.placed.cxform;
  return {
    gfx,
    atlas,
    hub,
    script,
    author,
    barsId,
    outer,
    paintFor: (spec) => (author && spec?.hud ? undefined : spec?.rgb),
    frame: inPoints(hub.placed.matrix),
    stretch: script?.armourScale || MINIMAP_ARMOUR_RUNTIME_SCALE,
    faces: lazily(() => importedNames(gfx)),
  };
};

// Тоны четырёх клипов считаются вне построения вида, и порча спрайта идёт наружу.
// Порядок чтения: полоса HP, полоса брони, дорожка HP, дорожка брони.
const withTones = (rig) => {
  const { atlas, barsId, outer, script, paintFor } = rig;
  const clipFor = (name, spec) => atlas.toneClip(barsId, name, paintFor(spec), outer);
  const hp = clipFor("healthBar", script?.health);
  const arm = clipFor("armourBar", script?.armour);
  const trough = clipFor("healthTrough", script?.health);
  const armTrough = clipFor("armourTrough", script?.armour);
  return { ...rig, hp, arm, trough, armTrough };
};

// Цвета, потери и вид: код мода не задал цвет — только слово об этом.
const readBody = (bare) => {
  const { script } = bare;
  if (script && !(script.health?.rgb && script.armour?.rgb)) {
    return { fx: {}, lost: [SAY.noCode], look: null };
  }
  const rig = withTones(bare);
  const parts = STAGES.map((stage) => stage(rig));
  const built = lookFrom(rig);
  return {
    fx: Object.assign({}, ...parts.map((p) => p.fx)),
    lost: [...parts.flatMap((p) => p.words), ...(built ? built.words : [])],
    look: built ? built.look : null,
  };
};

/* ---------- публичные функции ---------- */

export const animationOf = (gfx, id, depth = 0) => openAtlas(gfx).motion(id, depth);

export function inspectMinimapGfx(bytes, options = {}) {
  const author = options.palette === "author";
  const rig = openRig(readGfx(bytes), author);
  if (!rig) return emptyReport();
  const { fx, lost, look } = readBody(rig);
  const numbers = readNumbers(rig, look);
  return {
    ...layoutOf(rig.atlas, rig.hub),
    colors: Object.fromEntries(
      COLOR_SLOTS.map(([slot, key]) => [slot, fx[key] || EDITOR_VITALS[slot]]),
    ),
    effects: fx,
    numbers,
    lost,
    look,
    detected: { layout: true, colors: isAuthored(fx), numbers: Boolean(numbers) },
  };
}

const NUMBER_WIDGETS = [
  ["healthNumber", "health"],
  ["armorNumber", "armor"],
];

const numberEffects = (nums) =>
  nums
    ? {
        healthNumberColor: nums.health || "#ffffff",
        armorNumberColor: nums.armor || DEFAULT_MINIMAP_EFFECTS.armorNumberColor,
        ...(nums.size == null ? {} : { numberSize: nums.size }),
      }
    : {};

// Виджеты цифр включаются только там, где в файле нашёлся цвет цифры.
const showDigits = (draft, nums) => {
  if (!nums) return draft;
  const widgets = NUMBER_WIDGETS.reduce(
    (acc, [widget, side]) =>
      nums[side] == null ? acc : { ...acc, [widget]: { ...acc[widget], visible: true } },
    draft.layout.widgets,
  );
  return { ...draft, layout: { ...draft.layout, widgets } };
};

export function minimapProjectFromGfx(bytes, opts = {}) {
  const name = opts.name;
  const inspected = inspectMinimapGfx(bytes, { palette: opts.palette });
  const base = createDefaultMinimapLayout();
  const effects = Object.assign(
    {},
    base.effects,
    { barThickness: Math.round(8 * inspected.thickness) },
    inspected.effects,
    numberEffects(inspected.numbers),
  );
  const fresh = normalizeMinimapLayout({ ...base, effects });
  // Для bottom-row остаётся штатное место игры под радаром, а не пресет редактора.
  const moved =
    inspected.detected.layout && inspected.layout !== "bottom-row"
      ? { ...fresh, layout: applyMinimapVitalsLayout(fresh, inspected.layout) }
      : fresh;
  return {
    inspected,
    look: inspected.look,
    project: {
      name: name || tr("Мини-карта"),
      enabledModules: ["minimap"],
      modules: { minimap: normalizeMinimapLayout(showDigits(moved, inspected.numbers)) },
    },
  };
}
