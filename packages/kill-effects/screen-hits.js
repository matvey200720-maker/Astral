/*
 * Эффекты попадания на экране (задача 3 ТЗ 04.10.2026): красные следы по
 * краю экрана, когда попадают по самому игроку.
 *
 * КАК ЭТО УСТРОЕНО В ИГРЕ (разобрано по файлам Steam Legacy владельца)
 *
 *   • Числа — ключи `misc.DamageOverlay.*` в `common/data/visualsettings.dat`
 *     (update.rpf), отдельно для вида от третьего лица и от первого
 *     (`misc.DamageOverlay.FP.*`): нарастание, удержание и спад в мс, два
 *     цвета и две прозрачности («Bottom» и «Top»), длина следа, ширина у
 *     основания и у кончика.
 *   • Картинка — текстура `dmg_overlay_fade` в `x64/textures/graphics.ytd`
 *     (update.rpf перекрывает x64a.rpf): серая капля 256×256 DXT1, 7 mip.
 *   • Шейдер `PS_DamageOverlay` (postfx.fxc, разобран d3dcompiler'ом) — четыре
 *     инструкции: `цвет = текстура.r × цвет вершины`, и альфа так же. Значит,
 *     картинка игре — только форма и яркость; цвет у следа один (свой у низа
 *     и у верха), цвета самой картинки в игру не доходят.
 *
 * Сколько раз эффект появляется, решает игра: след — на каждое попадание по
 * игроку, файлами это не меняется. «Количество» здесь — сколько пятен,
 * капель или царапин в одном следе (у своей картинки — сколько её копий).
 *
 * Модуль чистый: им одинаково пользуются кадр окна (та же маска, что уйдёт
 * в игру), установщик в главном процессе и тесты.
 */

export const SCREEN_HITS_SCHEMA = 1;
export const SCREEN_HITS_TEXTURE = "dmg_overlay_fade";
export const SCREEN_HITS_SETTINGS_ENTRY = "common/data/visualsettings.dat";
export const SCREEN_HITS_SETTINGS_TARGET = `update:/${SCREEN_HITS_SETTINGS_ENTRY}`;
export const SCREEN_HITS_GRAPHICS_ENTRY = "x64/textures/graphics.ytd";
export const SCREEN_HITS_GRAPHICS_TARGET = `update:/${SCREEN_HITS_GRAPHICS_ENTRY}`;
/* Капля Rockstar — в основном архиве игры: «Как в игре» берёт её оттуда. */
export const SCREEN_HITS_STOCK_ARCHIVE = "x64a.rpf";
export const SCREEN_HITS_STOCK_ENTRY = "textures/graphics.ytd";
/* Сторона маски — как у текстуры игры. */
export const SCREEN_HITS_EDGE = 256;

/* Штатные числа Rockstar (visualsettings.dat Steam Legacy 1.0.3586). */
export const SCREEN_HITS_STOCK = Object.freeze({
  third: Object.freeze({
    RampUpDuration: 75,
    HoldDuration: 400,
    RampDownDuration: 200,
    ColorBottom: Object.freeze([0.8, 0.15, 0.15]),
    ColorTop: Object.freeze([0.6, 0.08, 0.08]),
    GlobalAlphaBottom: 0.2,
    GlobalAlphaTop: 0.4,
    SpriteLength: 0.3,
    SpriteBaseWidth: 0.2,
    SpriteTipWidth: 0.1,
  }),
  first: Object.freeze({
    RampUpDuration: 75,
    HoldDuration: 400,
    RampDownDuration: 200,
    ColorBottom: Object.freeze([0.8, 0.15, 0.15]),
    ColorTop: Object.freeze([0.6, 0.08, 0.08]),
    GlobalAlphaBottom: 0.2,
    GlobalAlphaTop: 0.45,
    SpriteLength: 0.4,
    SpriteBaseWidth: 0.27,
    SpriteTipWidth: 0.1,
  }),
});

const VIEW_PREFIX = Object.freeze({ third: "misc.DamageOverlay.", first: "misc.DamageOverlay.FP." });

/* Непрозрачность в процентах — это прозрачность верха следа: у Rockstar 40 %. */
export const SCREEN_HITS_STOCK_OPACITY = 40;
/* По умолчанию — прозрачнее игры («чтобы не лезли в глаза», ТЗ). */
export const SCREEN_HITS_DEFAULT_OPACITY = 25;

export const SCREEN_HITS_LIMITS = Object.freeze({
  count: Object.freeze([1, 8]),
  opacity: Object.freeze([0, 100]),
  size: Object.freeze([50, 200]),
  spread: Object.freeze([50, 200]),
  appear: Object.freeze([0, 1000]),
  hold: Object.freeze([50, 3000]),
  fade: Object.freeze([50, 3000]),
});

/* Картинки следа: «Как в игре», готовые маски Astral и своя. */
export const SCREEN_HITS_SHAPES = Object.freeze(["game", "soft", "splash", "drops", "scratches", "cracks", "haze", "own"]);
export const SCREEN_HITS_SHAPE_LABELS = Object.freeze({
  game: "Как в игре",
  soft: "Мягкий край",
  splash: "Брызги",
  drops: "Капли",
  scratches: "Царапины",
  cracks: "Трещины",
  haze: "Дымка",
  own: "Своя картинка",
});
/* Что считает «Количество» у каждой картинки. */
export const SCREEN_HITS_COUNT_LABELS = Object.freeze({
  splash: "брызги вокруг пятна",
  drops: "капли",
  scratches: "царапины",
  cracks: "трещины",
  haze: "клубы дымки",
  own: "копии картинки",
});
export const screenHitsCounted = (shape) => Object.hasOwn(SCREEN_HITS_COUNT_LABELS, shape);

const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const HEX = /^#[0-9a-f]{6}$/i;
const hex = (value, fallback) => (HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback);
const ASSET = /^[0-9a-f]{64}$/;

/* Свой цвет — эффект общего поля мастерской: один цвет или два (низ и верх экрана). */
const COLOUR_MODES = Object.freeze(["solid", "gradient"]);

function normalizeLook(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    mode: COLOUR_MODES.includes(source.mode) ? source.mode : "solid",
    colour: hex(source.colour, "#d4202a"),
    colour2: hex(source.colour2, "#7a0c12"),
    direction: "height",
    width: 1,
    shift: 0,
  };
}

/** Новая работа: капля игры, прозрачнее штатной. */
export function createScreenHitsProject() {
  return normalizeScreenHitsProject({ opacity: SCREEN_HITS_DEFAULT_OPACITY });
}

export function normalizeScreenHitsProject(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const own = source.own && typeof source.own === "object" ? source.own : {};
  const asset = ASSET.test(String(own.asset || "")) ? String(own.asset) : "";
  let shape = SCREEN_HITS_SHAPES.includes(source.shape) ? source.shape : "game";
  if (shape === "own" && !asset) shape = "game";
  const number = (key, fallback) => Math.round(clamp(finite(source[key], fallback), SCREEN_HITS_LIMITS[key]));
  return {
    schema: SCREEN_HITS_SCHEMA,
    name: String(source.name || "").trim().slice(0, 80),
    shape,
    count: number("count", 4),
    own: { asset, name: asset ? String(own.name || "картинка").slice(0, 80) : "", invert: own.invert === true },
    tint: source.tint === true,
    look: normalizeLook(source.look),
    opacity: number("opacity", SCREEN_HITS_STOCK_OPACITY),
    size: number("size", 100),
    spread: number("spread", 100),
    appear: number("appear", SCREEN_HITS_STOCK.third.RampUpDuration),
    hold: number("hold", SCREEN_HITS_STOCK.third.HoldDuration),
    fade: number("fade", SCREEN_HITS_STOCK.third.RampDownDuration),
    /* «Убрать совсем» (ТЗ 17.10.2026, вечер): следа на экране нет, остальное
       хранится и вернётся. Поле есть только у включённого — без смены схемы
       вид прежних работ прежний. */
    ...(source.off === true ? { off: true } : {}),
  };
}

export function parseScreenHitsProject(text) {
  try {
    return normalizeScreenHitsProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createScreenHitsProject();
  }
}

export const serializeScreenHitsProject = (project) => JSON.stringify(normalizeScreenHitsProject(project));

/** Всё как у Rockstar — ставить нечего. */
export function screenHitsIsVanilla(input) {
  const project = normalizeScreenHitsProject(input);
  const stock = SCREEN_HITS_STOCK.third;
  return (
    project.off !== true &&
    project.shape === "game" &&
    !project.tint &&
    project.opacity === SCREEN_HITS_STOCK_OPACITY &&
    project.size === 100 &&
    project.spread === 100 &&
    project.appear === stock.RampUpDuration &&
    project.hold === stock.HoldDuration &&
    project.fade === stock.RampDownDuration
  );
}

/** Отпечаток того, что уйдёт в игру: имя работы и выключенные органы — не в счёт. */
export function screenHitsSignature(input) {
  const project = normalizeScreenHitsProject(input);
  /* Убрано совсем — в игру уходит одно: прозрачность ноль; остальное не в счёт. */
  if (project.off === true) return JSON.stringify({ off: true });
  return JSON.stringify({
    shape: project.shape,
    count: screenHitsCounted(project.shape) ? project.count : 0,
    own: project.shape === "own" ? { asset: project.own.asset, invert: project.own.invert } : null,
    look: project.tint ? { mode: project.look.mode, colour: project.look.colour, colour2: project.look.mode === "gradient" ? project.look.colour2 : "" } : null,
    opacity: project.opacity,
    size: project.size,
    spread: project.spread,
    appear: project.appear,
    hold: project.hold,
    fade: project.fade,
  });
}

/* ------------------------------------------------------- числа для игры */

const rgbOf = (value) => [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);

/**
 * Числа следа для одного вида (`third` или `first`). Цвета — доли канала,
 * как в файле; «один цвет» — тот же низ и верх.
 */
export function screenHitsValues(input, view = "third") {
  const project = normalizeScreenHitsProject(input);
  const stock = SCREEN_HITS_STOCK[view] || SCREEN_HITS_STOCK.third;
  /* «Убрать совсем»: числа игры, но прозрачность — ноль: следа нет ни от
     третьего лица, ни от первого. */
  if (project.off === true)
    return {
      ...Object.fromEntries(Object.entries(stock).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])),
      GlobalAlphaBottom: 0,
      GlobalAlphaTop: 0,
    };
  const alpha = project.opacity / SCREEN_HITS_STOCK_OPACITY;
  const size = project.size / 100;
  const spread = project.spread / 100;
  const bottom = project.tint ? rgbOf(project.look.colour) : [...stock.ColorBottom];
  const top = project.tint ? (project.look.mode === "gradient" ? rgbOf(project.look.colour2) : bottom) : [...stock.ColorTop];
  return {
    RampUpDuration: project.appear,
    HoldDuration: project.hold,
    RampDownDuration: project.fade,
    ColorBottom: bottom,
    ColorTop: top,
    GlobalAlphaBottom: clamp01(stock.GlobalAlphaBottom * alpha),
    GlobalAlphaTop: clamp01(stock.GlobalAlphaTop * alpha),
    SpriteLength: Math.min(0.95, stock.SpriteLength * size),
    SpriteBaseWidth: Math.min(1.2, stock.SpriteBaseWidth * size * spread),
    SpriteTipWidth: Math.min(1.2, stock.SpriteTipWidth * size * spread),
  };
}

/* Число как в файле Rockstar: длительности целыми, доли — минимум два знака. */
function written(value, integer) {
  if (integer) return String(Math.round(value));
  const text = String(Number(value.toFixed(3)));
  const [whole, fraction = ""] = text.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

const INTEGER_KEYS = new Set(["RampUpDuration", "HoldDuration", "RampDownDuration"]);
const CHANNELS = Object.freeze(["red", "green", "blue"]);

/** Ключи и значения строками, в порядке файла: сначала третье лицо, потом FP. */
export function screenHitsSettings(project) {
  const rows = [];
  for (const view of ["third", "first"]) {
    const values = screenHitsValues(project, view);
    for (const [name, value] of Object.entries(values)) {
      if (Array.isArray(value)) {
        value.forEach((channel, index) => rows.push([`${VIEW_PREFIX[view]}${name}.${CHANNELS[index]}`, written(channel, false)]));
      } else rows.push([`${VIEW_PREFIX[view]}${name}`, written(value, INTEGER_KEYS.has(name))]);
    }
  }
  return rows;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Свои ключи в `visualsettings.dat` игрока: значение меняется на месте,
 * отступы, комментарии и всё чужое (редукс, оптимизация, килл-эффект)
 * остаются как были. Ключа нет — дописывается своим блоком в конце.
 */
export function compileScreenHitsSettings(text, project) {
  if (typeof text !== "string" || !text) throw new Error("В игре нет visualsettings.dat — следу некуда встать.");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let result = text;
  const changed = [];
  const added = [];
  for (const [key, value] of screenHitsSettings(project)) {
    const pattern = new RegExp(`^([ \\t]*${escapeRegExp(key)}[ \\t]+)([^\\s#]+)`, "gm");
    let found = false;
    result = result.replace(pattern, (match, head, previous) => {
      found = true;
      if (previous !== value) changed.push(key);
      return `${head}${value}`;
    });
    if (!found) added.push([key, value]);
  }
  if (added.length) {
    const block = ["", "# Astral: эффекты попадания на экране", ...added.map(([key, value]) => `${key}\t${value}`), ""].join(newline);
    result = `${result.replace(/\s*$/, "")}${newline}${block}`;
  }
  return { text: result, changed, added: added.map(([key]) => key) };
}

/** Что из ключей стоит у игрока сейчас: `{ key: число | null }`. */
export function readScreenHitsSettings(text) {
  const values = {};
  for (const [key] of screenHitsSettings(createScreenHitsProject())) {
    const match = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]+([^\\s#]+)`, "m").exec(String(text || ""));
    const number = match ? Number.parseFloat(match[1]) : Number.NaN;
    values[key] = Number.isFinite(number) ? number : null;
  }
  return values;
}

/* ------------------------------------------------------------- маски */

const EDGE = SCREEN_HITS_EDGE;
const BORDER = 3;
const TAU = Math.PI * 2;

/* Детерминированный случай: одна и та же маска у кадра, установщика и тестов. */
function random32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (from, to, value) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const coverage = (distance, soft) => (distance <= -soft ? 1 : distance >= soft ? 0 : 0.5 - distance / (2 * soft));

function put(field, x, y, value) {
  const at = y * EDGE + x;
  if (value > field[at]) field[at] = value;
}

/* Отрезок `[centre - pad, centre + pad]` в пикселях листа. */
const span = (centre, pad) => [Math.max(0, Math.floor(centre - pad)), Math.min(EDGE - 1, Math.ceil(centre + pad))];

function disc(field, cx, cy, radius, soft = 1.4, strength = 1) {
  const [x0, x1] = span(cx, radius + soft + 1);
  const [y0, y1] = span(cy, radius + soft + 1);
  for (let y = y0; y <= y1; y += 1)
    for (let x = x0; x <= x1; x += 1) put(field, x, y, coverage(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius, soft) * strength);
}

/* Отрезок со скруглёнными концами и радиусом от `ra` к `rb`. */
function capsule(field, ax, ay, bx, by, ra, rb, soft = 1.2, strength = 1) {
  const pad = Math.max(ra, rb) + soft + 1;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad));
  const x1 = Math.min(EDGE - 1, Math.ceil(Math.max(ax, bx) + pad));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - pad));
  const y1 = Math.min(EDGE - 1, Math.ceil(Math.max(ay, by) + pad));
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy || 1e-6;
  for (let y = y0; y <= y1; y += 1)
    for (let x = x0; x <= x1; x += 1) {
      const px = x + 0.5 - ax;
      const py = y + 0.5 - ay;
      const t = clamp01((px * dx + py * dy) / length2);
      const radius = ra + (rb - ra) * t;
      put(field, x, y, coverage(Math.hypot(px - dx * t, py - dy * t) - radius, soft) * strength);
    }
}

/* Пятно с рваным краем: радиус гуляет по углу тремя гармониками. */
function splat(field, cx, cy, radius, random, soft = 1.6) {
  const phase = [random() * TAU, random() * TAU, random() * TAU];
  const edge = (angle) => radius * (1 + 0.1 * Math.sin(3 * angle + phase[0]) + 0.06 * Math.sin(7 * angle + phase[1]) + 0.035 * Math.sin(12 * angle + phase[2]));
  const [x0, x1] = span(cx, radius * 1.35 + soft + 1);
  const [y0, y1] = span(cy, radius * 1.35 + soft + 1);
  for (let y = y0; y <= y1; y += 1)
    for (let x = x0; x <= x1; x += 1) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      put(field, x, y, coverage(Math.hypot(px, py) - edge(Math.atan2(py, px)), soft));
    }
}

const inside = (value) => Math.min(EDGE - BORDER - 6, Math.max(BORDER + 6, value));

/*
 * Готовые маски. Как у капли игры, яркий конец — внизу листа, к верху след
 * гаснет: так их рисует и кадр, и игра.
 */
const SHAPES = Object.freeze({
  soft(field) {
    for (let y = 0; y < EDGE; y += 1)
      for (let x = 0; x < EDGE; x += 1) {
        const u = (x + 0.5) / EDGE - 0.5;
        const v = (y + 0.5) / EDGE;
        put(field, x, y, Math.exp(-((u / 0.27) ** 2) - ((v - 0.86) / 0.3) ** 2));
      }
  },
  splash(field, random, count) {
    const cx = 128 + (random() - 0.5) * 16;
    const cy = 196;
    splat(field, cx, cy, 30, random);
    const drops = 2 + count * 2;
    for (let index = 0; index < drops; index += 1) {
      const angle = -Math.PI / 2 + (random() - 0.5) * 2.3;
      const distance = 38 + random() * 78;
      const radius = Math.max(2.2, (3.5 + random() * 7) * (1.15 - distance / 160));
      const x = inside(cx + Math.cos(angle) * distance);
      const y = inside(cy + Math.sin(angle) * distance);
      /* У ближних брызг — хвост к пятну, как у настоящей капли на лету. */
      if (distance < 80 && random() < 0.6)
        capsule(field, cx + Math.cos(angle) * 24, cy + Math.sin(angle) * 24, x, y, Math.max(1.6, radius * 0.7), Math.max(1.4, radius * 0.45), 1.2, 0.9);
      disc(field, x, y, radius);
    }
  },
  drops(field, random, count) {
    const scale = 1.15 - count * 0.05;
    for (let index = 0; index < count; index += 1) {
      const x = inside(40 + ((index + 0.5) * 176) / count + (random() - 0.5) * 18);
      const y = 130 + random() * 95;
      const radius = (9 + random() * 9) * scale;
      const length = radius * (3 + random() * 2.4);
      capsule(field, x, y, x + (random() - 0.5) * 6, y - length, radius * 0.78, Math.max(1.2, radius * 0.1));
      disc(field, x, y, radius);
    }
  },
  scratches(field, random, count) {
    const spacing = Math.min(28, 150 / count);
    const thickness = Math.min(1, 0.45 + 2.2 / count);
    const centre = 128 + (random() - 0.5) * 20;
    const slant = (random() - 0.5) * 0.5;
    for (let index = 0; index < count; index += 1) {
      const start = centre + (index - (count - 1) / 2) * spacing;
      const top = 48 + random() * 44;
      const bend = (random() - 0.5) * 22;
      const steps = 16;
      let previous = null;
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const y = 232 + (top - 232) * t;
        const x = inside(start + slant * (232 - y) + bend * 4 * t * (1 - t));
        const width = (1.6 + 5.2 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * thickness;
        if (previous) capsule(field, previous.x, previous.y, x, y, previous.width, width, 1.1);
        previous = { x, y, width };
      }
    }
  },
  cracks(field, random, count) {
    const ox = 128 + (random() - 0.5) * 30;
    const oy = 236;
    disc(field, ox, oy, 6);
    const rays = count + 2;
    const grow = (x, y, angle, width, steps, branch) => {
      for (let step = 0; step < steps; step += 1) {
        const length = 16 + random() * 11;
        const next = angle + (random() - 0.5) * 0.5;
        const nx = x + Math.cos(next) * length;
        const ny = y + Math.sin(next) * length;
        if (nx < BORDER + 2 || nx > EDGE - BORDER - 2 || ny < BORDER + 2 || ny > EDGE - BORDER - 2) return;
        capsule(field, x, y, nx, ny, width, width * 0.9, 1.0);
        if (branch && step > 1 && random() < 0.35)
          grow(nx, ny, next + (random() < 0.5 ? -1 : 1) * (0.45 + random() * 0.4), width * 0.7, 3 + Math.floor(random() * 3), false);
        x = nx;
        y = ny;
        angle = next;
        width *= 0.9;
      }
    };
    for (let index = 0; index < rays; index += 1) {
      const angle = -Math.PI + 0.6 + ((index + 0.5) * (Math.PI - 1.2)) / rays + (random() - 0.5) * 0.2;
      grow(ox, oy, angle, 2.3, 7 + Math.floor(random() * 4), true);
    }
  },
  haze(field, random, count) {
    const puffs = 3 + count * 2;
    for (let index = 0; index < puffs; index += 1) {
      const cx = 34 + random() * 188;
      const cy = 112 + random() * 124;
      const radius = 22 + random() * 40;
      const strength = 0.5 + random() * 0.5;
      const [x0, x1] = span(cx, radius * 2);
      const [y0, y1] = span(cy, radius * 2);
      for (let y = y0; y <= y1; y += 1)
        for (let x = x0; x <= x1; x += 1) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
          const at = y * EDGE + x;
          field[at] = Math.min(1, field[at] + Math.exp(-2 * d * d) * strength * 0.6);
        }
    }
    /* Рябь, чтобы дымка не читалась ровными кругами. */
    const lattice = Array.from({ length: 17 * 17 }, () => random());
    for (let y = 0; y < EDGE; y += 1)
      for (let x = 0; x < EDGE; x += 1) {
        const gx = x / 16;
        const gy = y / 16;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = gx - ix;
        const fy = gy - iy;
        const at = (cx, cy) => lattice[Math.min(16, cy) * 17 + Math.min(16, cx)];
        const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
        const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
        field[y * EDGE + x] *= 0.55 + 0.45 * (top + (bottom - top) * fy);
      }
  },
});

/* Сколько след гаснет к верху листа: мягким — до нуля, рисунку — до половины. */
const TOP_FADE = Object.freeze({ soft: 0, haze: 0, splash: 0.45, drops: 0.5, scratches: 0.5, cracks: 0.55 });
const SEEDS = Object.freeze({ soft: 11, splash: 23, drops: 37, scratches: 41, cracks: 53, haze: 67, own: 79 });

function finish(field, floor) {
  for (let y = 0; y < EDGE; y += 1) {
    const fade = floor === null ? 1 : floor + (1 - floor) * smoothstep(0.06, 0.75, (y + 0.5) / EDGE);
    for (let x = 0; x < EDGE; x += 1) {
      const edge = x < BORDER || y < BORDER || x >= EDGE - BORDER || y >= EDGE - BORDER;
      const at = y * EDGE + x;
      field[at] = edge ? 0 : clamp01(field[at] * fade);
    }
  }
  return field;
}

/*
 * Своя картинка → маска. `picture` — `{ width: 256, height: 256, rgba }`,
 * картинка вписана в квадрат на прозрачном фоне (окно и установщик готовят
 * её одинаково). С прозрачностью — форма по альфе и рисунок яркостью;
 * без неё (фото) — яркость. «Наоборот» — тёмное видно, светлое нет.
 */
function pictureSource(picture, invert) {
  const { rgba } = picture;
  const pixels = EDGE * EDGE;
  let transparent = 0;
  let peak = 0;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    if (rgba[offset + 3] < 250) transparent += 1;
    if (rgba[offset + 3] > 16) peak = Math.max(peak, 0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1] + 0.0722 * rgba[offset + 2]);
  }
  const alphaShape = transparent > pixels / 20;
  const source = new Float32Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    const luminance = (0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1] + 0.0722 * rgba[offset + 2]) / 255;
    const alpha = rgba[offset + 3] / 255;
    if (alphaShape) {
      const shade = peak > 0 ? clamp01((luminance * 255) / peak) : 1;
      source[index] = alpha * (0.35 + 0.65 * (invert ? 1 - shade : shade));
    } else source[index] = invert ? 1 - luminance : luminance;
  }
  return source;
}

function sample(source, u, v) {
  const x = u * EDGE - 0.5;
  const y = v * EDGE - 0.5;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const at = (cx, cy) => (cx < 0 || cy < 0 || cx >= EDGE || cy >= EDGE ? 0 : source[cy * EDGE + cx]);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
  const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
  return top + (bottom - top) * fy;
}

function ownMask(picture, { count, invert }) {
  if (!picture?.rgba || picture.width !== EDGE || picture.height !== EDGE || picture.rgba.length !== EDGE * EDGE * 4) return null;
  const source = pictureSource(picture, invert);
  const field = new Float32Array(EDGE * EDGE);
  const random = random32(SEEDS.own + count * 7919);
  const copies = [];
  if (count === 1) copies.push({ cx: 128, cy: 128, scale: 0.94 });
  else {
    const scale = Math.min(0.8, Math.max(0.3, 1.25 / Math.sqrt(count)));
    const half = (scale * EDGE) / 2 + BORDER + 2;
    for (let index = 0; index < count; index += 1)
      copies.push({
        cx: half + random() * (EDGE - 2 * half),
        cy: half + random() * (EDGE - 2 * half),
        scale: scale * (1 - index * 0.04),
      });
  }
  for (const copy of copies) {
    const extent = (copy.scale * EDGE) / 2;
    const [x0, x1] = span(copy.cx, extent);
    const [y0, y1] = span(copy.cy, extent);
    for (let y = y0; y <= y1; y += 1)
      for (let x = x0; x <= x1; x += 1) {
        const u = 0.5 + (x + 0.5 - copy.cx) / (copy.scale * EDGE);
        const v = 0.5 + (y + 0.5 - copy.cy) / (copy.scale * EDGE);
        if (u < 0 || v < 0 || u > 1 || v > 1) continue;
        put(field, x, y, sample(source, u, v));
      }
  }
  return finish(field, null);
}

/**
 * Маска следа 256×256 (доли 0…1) — или `null`: «Как в игре» (капля
 * Rockstar) и своя картинка, которой нет под рукой.
 */
export function screenHitsMask(input, picture = null) {
  const project = normalizeScreenHitsProject(input);
  /* Убрано совсем — своей капли в игре не нужно: ставится прозрачность ноль. */
  if (project.off === true || project.shape === "game") return null;
  if (project.shape === "own") return ownMask(picture, { count: project.count, invert: project.own.invert });
  const field = new Float32Array(EDGE * EDGE);
  SHAPES[project.shape](field, random32(SEEDS[project.shape] + project.count * 7919), project.count);
  return finish(field, TOP_FADE[project.shape]);
}

/** Маска → RGBA серым (альфа 255): так лежит капля игры, шейдер читает красный канал. */
export function screenHitsMaskRgba(mask) {
  const rgba = new Uint8ClampedArray(EDGE * EDGE * 4);
  for (let index = 0; index < EDGE * EDGE; index += 1) {
    const value = Math.round(clamp01(mask[index]) * 255);
    rgba[index * 4] = value;
    rgba[index * 4 + 1] = value;
    rgba[index * 4 + 2] = value;
    rgba[index * 4 + 3] = 255;
  }
  return rgba;
}

/* ----------------------------------------------------- готовые виды */

export const SCREEN_HITS_PRESETS = Object.freeze([
  { id: "vanilla", label: "Как в игре", description: "Капля Rockstar, её цвет и прозрачность", values: { shape: "game", tint: false, opacity: 40, size: 100, spread: 100, appear: 75, hold: 400, fade: 200 } },
  { id: "quiet", label: "Тише", description: "Капля игры, но прозрачнее — не лезет в глаза", values: { shape: "game", tint: false, opacity: 25, size: 100, spread: 100, appear: 75, hold: 400, fade: 200 } },
  { id: "splash", label: "Брызги", description: "Пятно крови и брызги к центру экрана", values: { shape: "splash", count: 4, tint: true, look: { mode: "solid", colour: "#b3121b" }, opacity: 30, size: 110, spread: 110, appear: 60, hold: 450, fade: 350 } },
  { id: "drops", label: "Капли", description: "Несколько стекающих капель", values: { shape: "drops", count: 4, tint: true, look: { mode: "solid", colour: "#8f0d14" }, opacity: 30, size: 110, spread: 120, appear: 60, hold: 500, fade: 450 } },
  { id: "scratches", label: "Царапины", description: "Три следа когтей", values: { shape: "scratches", count: 3, tint: true, look: { mode: "solid", colour: "#d01f2a" }, opacity: 28, size: 120, spread: 90, appear: 40, hold: 350, fade: 300 } },
  { id: "cracks", label: "Трещины", description: "Белые трещины, как на стекле", values: { shape: "cracks", count: 5, tint: true, look: { mode: "solid", colour: "#e8eef5" }, opacity: 22, size: 120, spread: 120, appear: 30, hold: 450, fade: 400 } },
  { id: "haze", label: "Дымка", description: "Мягкая красная дымка без чёткой формы", values: { shape: "haze", count: 3, tint: true, look: { mode: "solid", colour: "#c4161c" }, opacity: 22, size: 130, spread: 130, appear: 120, hold: 400, fade: 600 } },
  { id: "soft", label: "Мягкий край", description: "Ровное свечение у края экрана", values: { shape: "soft", tint: true, look: { mode: "solid", colour: "#ff3b3b" }, opacity: 25, size: 100, spread: 120, appear: 75, hold: 400, fade: 300 } },
  { id: "neon", label: "Неон", description: "Царапины двумя цветами: бирюза внизу, розовый вверху", values: { shape: "scratches", count: 2, tint: true, look: { mode: "gradient", colour: "#00e5ff", colour2: "#ff2bd6" }, opacity: 35, size: 110, spread: 90, appear: 40, hold: 400, fade: 300 } },
  { id: "off", label: "Без эффекта", description: "Следа на экране нет совсем", values: { shape: "game", tint: false, opacity: 0, size: 100, spread: 100, appear: 75, hold: 400, fade: 200 } },
]);

/** Готовый вид поверх работы: имя и своя картинка остаются. */
export function applyScreenHitsPreset(input, id) {
  const project = normalizeScreenHitsProject(input);
  const preset = SCREEN_HITS_PRESETS.find((item) => item.id === id);
  if (!preset) return project;
  /* Готовый вид — след, а не «убрать»: выключатель он снимает. */
  const { off: _off, ...kept } = project;
  return normalizeScreenHitsProject({ ...kept, count: 4, ...preset.values, own: project.own, name: project.name });
}

export function matchingScreenHitsPreset(input) {
  const signature = screenHitsSignature(input);
  return SCREEN_HITS_PRESETS.find((preset) => screenHitsSignature(applyScreenHitsPreset(input, preset.id)) === signature)?.id || "";
}

const seconds = (ms) => `${String(Math.round(ms / 10) / 100).replace(".", ",")} с`;

/** Одной строкой — для строки состояния и отчёта установки. */
export function describeScreenHits(input) {
  const project = normalizeScreenHitsProject(input);
  if (screenHitsIsVanilla(project)) return "Как в игре";
  if (project.off === true || project.opacity === 0) return "Без следа на экране";
  const parts = [SCREEN_HITS_SHAPE_LABELS[project.shape]];
  if (screenHitsCounted(project.shape)) parts.push(`${SCREEN_HITS_COUNT_LABELS[project.shape]}: ${project.count}`);
  parts.push(`${project.opacity} %`, `${seconds(project.hold)} на экране`);
  return parts.join(" · ");
}
