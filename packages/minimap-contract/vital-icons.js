/*
 * Значки HP и брони как шкалы (задача владельца 10.11.2026: «кружок анимированный, который будет убавляться от количества хп, и ещё таких вариков»).
 *
 * Один договор на окно и компилятор, как `fills.js`: те же фигуры рисует предпросмотр (по `vitalIconShapes`) и собирает в `minimap.gfx` компилятор. Значок — спрайт из
 * кадров: на каждый уровень свой кадр с готовой фигурой («заполнено на столько»), игра при каждом `SET_PLAYER_HEALTH` / `SET_PLAYER_ARMOUR` присылает запас в процентах
 * (0…100, `this.currentHealthValue`), а дописка в этих методах ставит кадр `gotoAndStop(1 + уровень)`. Рисовать дугу кодом на каждое число не нужно: фигуры
 * готовы заранее, кадр один раз в сборку, а в игре — одна команда на изменение. Цвет — не в фигуре (она белая), а в преобразовании цвета места: тот же спрайт
 * ставится три раза (обычный, средний и малый запас), и виден тот, чей порог сейчас, — как у анимированной заливки полос (`tierFillCode`).
 *
 * Система координат фигур — единичный квадрат значка, центр в нуле: x вправо, y вниз, от −0,5 до 0,5. Фигура — список контуров (замкнутые ломаные
 * `[x, y]`); контуры одной фигуры заливаются по чётности (пересечение вырезает дыру: целое кольцо — внешний и внутренний контуры).
 */

/** Сколько шагов у вида и как круглится запас: `ceil` — любой запас выше нуля показывает хотя бы первый шаг (десять делений гаснут по одному). */
const style = (id, label, steps, extra = {}) => Object.freeze({ id, label, steps, numberInside: false, ...extra });

export const MINIMAP_VITAL_STYLES = Object.freeze([
  style("ring", "Кольцо", 60, { numberInside: true, note: "убывает по часовой стрелке от верха" }),
  style("segments", "Кольцо из сегментов", 10, { numberInside: true, note: "десять делений, гаснут по одному" }),
  /* Число внутри сердца и щита выключено (владелец через ведущую, 22.11.2026, стенд hpwide15: в игре числа внутри контура не видны). Число у этого вида стоит рядом, как у капсулы;
     расчёт места внутри контура (`vitalFillNumberSpot`, `vitalFillNumberFit`) остаётся в договоре, но включается только этим флагом. */
  style("fill", "Сердце и щит", 40, { note: "наливается снизу вверх: сердце — HP, щит — броня" }),
  style("capsule", "Капсула", 40, { note: "вертикальная пилюля с уровнем" }),
  style("dots", "Точки", 10, { note: "ряд из десяти точек" }),
  style("arc", "Дуга", 60, { note: "полукруг-шкала, как спидометр" }),
]);

const STYLES = new Map(MINIMAP_VITAL_STYLES.map((item) => [item.id, item]));

/** Вид значка по id; `null` — не шкала (свой значок-картинка, как раньше). */
export const minimapVitalStyle = (id) => STYLES.get(id) ?? null;

/** Свой вид значка: картинка или пресет редактора — прежний путь, байт в байт. */
export const MINIMAP_VITAL_STYLE_IMAGE = "image";

export const MINIMAP_VITAL_STYLE_IDS = Object.freeze([MINIMAP_VITAL_STYLE_IMAGE, ...MINIMAP_VITAL_STYLES.map((item) => item.id)]);

/** Толщина кольца и дуги в долях значка. */
export const MINIMAP_VITAL_THICKNESS = Object.freeze({ min: 0.08, max: 0.3, default: 0.16 });

/** Частота мигания при малом запасе: кадров фильма на одну вспышку (30 кадров в секунду). */
export const MINIMAP_VITAL_BLINK_FRAMES = 12;

/** Число кадров спрайта: кадр 1 — пусто, кадр 1 + n — «заполнено на n шагов из шагов вида». */
export const minimapVitalFrameCount = (styleId) => 1 + (minimapVitalStyle(styleId)?.steps ?? 0);

/** Номер кадра (с единицы) для запаса в процентах: то же считает код в `minimap.gfx` (`Math.ceil(запас · шагов / 100)`, не больше шагов). */
export function minimapVitalFrame(styleId, percent) {
  const found = minimapVitalStyle(styleId);
  if (!found) throw new Error(`Вид значка «${styleId}» не шкала.`);
  const value = Number(percent);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return 1 + Math.min(found.steps, Math.ceil((value * found.steps) / 100 - 1e-9));
}

const TAU = Math.PI * 2;
const round = (value) => Math.round(value * 10000) / 10000;
const point = (x, y) => [round(x), round(y)];

/** Угол в радианах: 0 — вправо, по часовой (ось y вниз); верх — −π/2. */
const onCircle = (radius, angle, centre = [0, 0]) => point(centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle));

/** Дуга-кольцо от `from` на `span` радиан по часовой: один контур (внешняя дуга вперёд, внутренняя назад). Шаг 7,5°: на значке до 48 пт отклонение хорды от дуги — сотые доли точки экрана. */
function annulusSector(outer, inner, from, span, step = TAU / 48) {
  const parts = Math.max(1, Math.ceil(span / step));
  const points = [];
  for (let at = 0; at <= parts; at += 1) points.push(onCircle(outer, from + (span * at) / parts));
  for (let at = parts; at >= 0; at -= 1) points.push(onCircle(inner, from + (span * at) / parts));
  return points;
}

/** Целое кольцо — два контура (внешний и внутренний, по чётности внутри дыра). */
function fullRing(outer, inner, step = TAU / 48) {
  const parts = Math.ceil(TAU / step);
  const rim = (radius) => Array.from({ length: parts }, (_, at) => onCircle(radius, -Math.PI / 2 + (TAU * at) / parts));
  return [rim(outer), rim(inner).reverse()];
}

/** Круг как контур. */
const disc = (radius, centre, parts = 20) => Array.from({ length: parts }, (_, at) => onCircle(radius, (TAU * at) / parts, centre));

/** Обрезка контура полуплоскостью `y ≥ cut` (Сазерленд — Ходжман по одной стороне; годится и для невыпуклых контуров). */
function clipBelow(contour, cut) {
  const out = [];
  for (let at = 0; at < contour.length; at += 1) {
    const here = contour[at];
    const next = contour[(at + 1) % contour.length];
    const hereIn = here[1] >= cut;
    const nextIn = next[1] >= cut;
    if (hereIn) out.push(here);
    if (hereIn !== nextIn) {
      const along = (cut - here[1]) / (next[1] - here[1]);
      out.push(point(here[0] + (next[0] - here[0]) * along, cut));
    }
  }
  return out.length >= 3 ? out : [];
}

/** Сердце: параметрическая кривая, вписана в квадрат 0,9 × 0,84. */
function heartContour() {
  const raw = Array.from({ length: 64 }, (_, at) => {
    const t = (TAU * at) / 64;
    return [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
  });
  const xs = raw.map(([x]) => x);
  const ys = raw.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = 0.9 / (maxX - minX);
  return raw.map(([x, y]) => point((x - (minX + maxX) / 2) * scale, (y - (minY + maxY) / 2) * scale));
}

/** Щит: плоский верх с плечами и острый низ, сглажен квадратичными кривыми. */
function shieldContour() {
  const curve = (from, control, to, parts = 8) =>
    Array.from({ length: parts }, (_, at) => {
      const t = at / parts;
      return point((1 - t) ** 2 * from[0] + 2 * (1 - t) * t * control[0] + t ** 2 * to[0], (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * control[1] + t ** 2 * to[1]);
    });
  return [
    ...curve([-0.4, -0.46], [0, -0.54], [0.4, -0.46]),
    ...curve([0.4, -0.46], [0.46, 0.12], [0, 0.5]),
    ...curve([0, 0.5], [-0.46, 0.12], [-0.4, -0.46]),
  ];
}

/** Вертикальная пилюля: ширина 0,34, высота 1, полукруглые концы. */
function capsuleContour() {
  const radius = 0.17;
  const top = Array.from({ length: 11 }, (_, at) => onCircle(radius, Math.PI + (Math.PI * at) / 10, [0, -0.5 + radius]));
  const bottom = Array.from({ length: 11 }, (_, at) => onCircle(radius, (Math.PI * at) / 10, [0, 0.5 - radius]));
  return [...top, ...bottom];
}

const bounds = (contour) => {
  const ys = contour.map(([, y]) => y);
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
};

/** Наливка снизу вверх: контур, обрезанный по уровню `level` (0…1) от дна до верха. */
function risingFrames(contour, steps) {
  const { top, bottom } = bounds(contour);
  return Array.from({ length: steps + 1 }, (_, level) => {
    if (level === 0) return [];
    const cut = bottom - ((bottom - top) * level) / steps;
    const piece = level === steps ? contour : clipBelow(contour, cut);
    return piece.length ? [piece] : [];
  });
}

/**
 * Фигуры вида: `{ steps, track, frames }`. `frames[n]` — контуры «заполнено на n шагов» (n от 0 до `steps`, `frames[0]` пуст), `track` — подложка (пустая шкала).
 * `kind` — `health` или `armour`: у «сердца и щита» это разные фигуры.
 * @param {string} styleId
 * @param {{ kind?: "health" | "armour", thickness?: number }} [options]
 */
export function vitalIconShapes(styleId, { kind = "health", thickness = MINIMAP_VITAL_THICKNESS.default } = {}) {
  const found = minimapVitalStyle(styleId);
  if (!found) throw new Error(`Вид значка «${styleId}» не шкала.`);
  const { steps } = found;
  const width = Math.min(MINIMAP_VITAL_THICKNESS.max, Math.max(MINIMAP_VITAL_THICKNESS.min, Number(thickness) || MINIMAP_VITAL_THICKNESS.default));
  const outer = 0.5;
  const inner = outer - width;

  if (styleId === "ring") {
    return {
      steps,
      track: fullRing(outer, inner),
      frames: Array.from({ length: steps + 1 }, (_, level) => {
        if (level === 0) return [];
        if (level === steps) return fullRing(outer, inner);
        return [annulusSector(outer, inner, -Math.PI / 2, (TAU * level) / steps)];
      }),
    };
  }

  if (styleId === "segments") {
    const gap = TAU / steps / 5;
    const segment = (at) => annulusSector(outer, inner, -Math.PI / 2 + (TAU * at) / steps + gap / 2, TAU / steps - gap, TAU / 96);
    const all = Array.from({ length: steps }, (_, at) => segment(at));
    return { steps, track: all, frames: Array.from({ length: steps + 1 }, (_, level) => all.slice(0, level)) };
  }

  if (styleId === "dots") {
    const radius = 0.062;
    const centres = Array.from({ length: steps }, (_, at) => [-0.5 + radius + (at * (1 - 2 * radius)) / (steps - 1), 0]);
    const all = centres.map((centre) => disc(radius, centre, 14));
    return { steps, track: all, frames: Array.from({ length: steps + 1 }, (_, level) => all.slice(0, level)) };
  }

  if (styleId === "arc") {
    /* Полукруг-шкала: слева направо через верх (спидометр), внешний радиус во всю ширину, центр дуги опущен, чтобы дуга заняла квадрат. */
    const centre = [0, 0.25];
    const radius = 0.5;
    const sector = (span) => {
      const parts = Math.max(1, Math.ceil(span / (Math.PI / 36)));
      const points = [];
      for (let at = 0; at <= parts; at += 1) points.push(onCircle(radius, Math.PI + (span * at) / parts, centre));
      for (let at = parts; at >= 0; at -= 1) points.push(onCircle(radius - width, Math.PI + (span * at) / parts, centre));
      return points;
    };
    return { steps, track: [sector(Math.PI)], frames: Array.from({ length: steps + 1 }, (_, level) => (level === 0 ? [] : [sector((Math.PI * level) / steps)])) };
  }

  if (styleId === "fill") {
    const contour = kind === "armour" ? shieldContour() : heartContour();
    return { steps, track: [contour], frames: risingFrames(contour, steps) };
  }

  const contour = capsuleContour();
  return { steps, track: [contour], frames: risingFrames(contour, steps) };
}

/* ---------------------------------------------------------------------------------------------------------------------------------------- */
/* Число внутри «сердца и щита»                                                                                                               */
/* ---------------------------------------------------------------------------------------------------------------------------------------- */

/**
 * Знак числа в долях кегля: ширина одного знака и высота цифр (замер в окне: три знака — 1,72 кегля, цифры — 0,72). Мерка «100» — самое широкое число запаса. Одни и те же числа
 * у отверстия кольца (`vitalNumberFit` окна) и у «сердца и щита» (`vitalFillNumberFit`).
 */
export const VITAL_NUMBER_DIGIT = Object.freeze({ width: 0.573, height: 0.72 });

/**
 * Прямоугольник внутри контура «сердца» и «щита» (вид `fill`), куда ложится число: центр и половины сторон в долях значка (центр значка в нуле, x вправо, y вниз — как у
 * `vitalIconShapes`). У сердца и щита нет круглого отверстия, поэтому число меряют по этому прямоугольнику, а не по кругу. Подобран по контурам и проверяется тестом (углы
 * и середины сторон внутри контура с запасом); плашка вокруг блока (`vital-plate.js`) встаёт по нему же.
 */
export const VITAL_ICON_SAFE_RECT = Object.freeze({
  heart: Object.freeze({ cx: 0, cy: -0.035, hw: 0.215, hh: 0.154 }),
  shield: Object.freeze({ cx: 0, cy: -0.2, hw: 0.32, hh: 0.228 }),
});

/** Сторона значка вида `fill`: `armour` — щит, всё остальное (`health`) — сердце, как у `vitalIconShapes`. */
const fillRect = (kind) => (kind === "armour" ? VITAL_ICON_SAFE_RECT.shield : VITAL_ICON_SAFE_RECT.heart);

/** Безопасный прямоугольник числа внутри значка вида `fill`: `{ cx, cy, hw, hh }` в долях значка. */
export const vitalFillNumberRect = (kind) => ({ ...fillRect(kind) });

/**
 * Куда ставить центр числа внутри значка вида `fill`: сдвиг от центра значка в долях его стороны (`x` вправо, `y` вниз; у сердца и щита число стоит выше середины, где
 * они шире всего).
 * @param {"health" | "armour"} kind
 */
export function vitalFillNumberSpot(kind) {
  const { cx, cy } = fillRect(kind);
  return { x: cx, y: cy };
}

/**
 * Наибольший целый кегль, при котором число из `digits` знаков помещается в безопасный прямоугольник значка вида `fill` со стороной `iconSize` (любые единицы, кегль выйдет в
 * тех же): по ширине и по высоте, берётся меньшее. Предела кегля окна здесь нет — его держит вызывающий.
 * @param {"health" | "armour"} kind
 * @param {number} iconSize
 * @param {number} [digits]
 */
export function vitalFillNumberFit(kind, iconSize, digits = 3) {
  const { hw, hh } = fillRect(kind);
  const size = Number(iconSize);
  if (!(size > 0)) return 0;
  const byWidth = (2 * hw * size) / (Math.max(1, digits) * VITAL_NUMBER_DIGIT.width);
  const byHeight = (2 * hh * size) / VITAL_NUMBER_DIGIT.height;
  return Math.max(0, Math.floor(Math.min(byWidth, byHeight) + 1e-9));
}

/** Наименьшая сторона значка вида `fill`, в которой число из `digits` знаков кеглем `numberSize` ещё помещается (обратное к `vitalFillNumberFit`). */
export function vitalFillIconSizeForNumber(kind, numberSize, digits = 3) {
  const { hw, hh } = fillRect(kind);
  const font = Number(numberSize);
  if (!(font > 0)) return 0;
  const byWidth = (Math.max(1, digits) * VITAL_NUMBER_DIGIT.width * font) / (2 * hw);
  const byHeight = (VITAL_NUMBER_DIGIT.height * font) / (2 * hh);
  return Math.ceil(Math.max(byWidth, byHeight) - 1e-9);
}

/**
 * Три цвета шкалы и пороги: обычный (цвет значка), средний и малый запас. Пороги и цвета — те же, что у анимированной заливки полос (`healthMid…`, `lowHealthThreshold`,
 * `armorMid…`, `armorLow…`). У HP малый запас — «не выше порога» (как у игры), у брони — «ниже порога»; средний — «ниже порога» у обоих.
 * @param {object} effects `normalizeMinimapLayout().effects`
 * @param {"health" | "armour"} side
 */
export function minimapVitalColours(effects, side) {
  if (side === "health")
    return { normal: effects.healthIconColor, mid: effects.healthMidColor, low: effects.lowHealthColor, midBelow: effects.healthMidThreshold, lowAt: effects.lowHealthThreshold, lowInclusive: true };
  return { normal: effects.armorIconColor, mid: effects.armorMidColor, low: effects.armorLowColor, midBelow: effects.armorMidThreshold, lowAt: effects.armorLowThreshold, lowInclusive: false };
}

/** Какой ступени принадлежит запас: `"low"`, `"mid"` или `"normal"`. Без «цвета по уровню» всегда `"normal"`. */
export function minimapVitalTier(effects, side, percent) {
  if (!effects.vitalLevelColours) return "normal";
  const colours = minimapVitalColours(effects, side);
  const value = Number(percent);
  const low = colours.lowInclusive ? value <= colours.lowAt : value < colours.lowAt;
  if (low) return "low";
  return value < colours.midBelow ? "mid" : "normal";
}

/** Цвет шкалы при запасе `percent` (предпросмотр окна; в игре то же делают три места спрайта и их прозрачность). */
export const minimapVitalColour = (effects, side, percent) => minimapVitalColours(effects, side)[minimapVitalTier(effects, side, percent)];

/** Мигает ли шкала сейчас: включено мигание и запас на малой ступени. */
export const minimapVitalBlinks = (effects, side, percent) => effects.vitalBlinkLow === true && minimapVitalTier({ ...effects, vitalLevelColours: true }, side, percent) === "low";

/**
 * Заготовка «двойное кольцо» (10.11.2026): значки брони и HP — два кольца с общим центром, броня снаружи, HP внутри. Это раскладка двух обычных колец, новой фигуры нет:
 * внутреннее кольцо — тот же вид «ring», уменьшенный так, чтобы он встал в отверстие внешнего с зазором `gap` (доля внешнего значка). Размер каждого значка в игре —
 * меньшая сторона его прямоугольника, поэтому для любого кадра радара кольца остаются круглыми и соосными.
 * Возвращает `{ effects, widgets, innerScale }`: `effects` и `widgets` кладутся поверх раскладки как есть (положение и размер внешнего значка — `x`, `y` центр, `width`, `height`;
 * числа остаются как были). `thickness` — толщина обеих колец в долях своего значка.
 * @param {{ x?: number, y?: number, width?: number, height?: number, thickness?: number, gap?: number }} [box]
 */
export function vitalDoubleRingPreset({ x = 0.5, y = 0.95, width = 0.12, height = 0.12, thickness = MINIMAP_VITAL_THICKNESS.default, gap = 0.04 } = {}) {
  const wide = Math.min(MINIMAP_VITAL_THICKNESS.max, Math.max(MINIMAP_VITAL_THICKNESS.min, Number(thickness) || MINIMAP_VITAL_THICKNESS.default));
  const spare = Math.min(0.1, Math.max(0.01, Number(gap) || 0.04));
  /* Внешнее кольцо занимает радиус от 0,5 − толщина до 0,5, внутреннее начинается через зазор: его внешний радиус 0,5 · k равен 0,5 − толщина − зазор. */
  const innerScale = Math.max(0.2, 1 - 2 * wide - 2 * spare);
  const round = (value) => Math.round(value * 1e6) / 1e6;
  return {
    effects: { healthIconStyle: "ring", armorIconStyle: "ring", vitalThickness: wide },
    widgets: {
      armorIcon: { x: round(x), y: round(y), width: round(width), height: round(height), visible: true },
      healthIcon: { x: round(x), y: round(y), width: round(width * innerScale), height: round(height * innerScale), visible: true },
    },
    innerScale: round(innerScale),
  };
}
