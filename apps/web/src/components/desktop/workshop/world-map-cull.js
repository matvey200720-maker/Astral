/*
 * Отсечение сцены по кадру холста (13.10.2026, «большая карта ужасно лагает,
 * когда много подписей и зон»).
 *
 * SVG окна — это холст, кадр с запасом за краем окна (`OVERSCAN` в
 * `WorldMapStage`). Всё, что лежит за краем холста, браузер всё равно
 * раскладывает, красит и растеризует: тысяча подписей и зон при приближении ×6
 * — это ~1400 узлов, из которых в холсте остаются два десятка. Каждая фиксация
 * кадра после колеса или перетаскивания платила за все: пересчёт стилей,
 * раскладка SVG-текста (`ShapeTextIncludingFirstLine`), краска.
 *
 * Здесь решается, какие примитивы сцены пересекают холст. Остальные в SVG не
 * попадают. Сама сцена не меняется: попадание курсора, рамки подписей и
 * экспорт читают её целиком — отсекается только то, что окно рисует.
 *
 * Рамка считается с запасом, а не впритык: промах в большую сторону стоит
 * лишнего узла, промах в меньшую — пропавшей на краю подписи. Поэтому
 * текст берётся с девятью десятыми кегля на знак (самые широкие буквы карты —
 * восемь десятых), обводка, размытие и свечение — полным вылетом. Примитив без
 * рамки (путь без `bounds`, незнакомый вид) остаётся в сцене всегда.
 */

const EXTENTS = new WeakMap();

/* Свечение (`drop-shadow`) и размытие уходят за рамку примерно на три радиуса. */
const SOFT_REACH = 3;

/* Знаки подписи: ширина каждого — с запасом сверх любой пропорции шрифта. */
const EM_PER_GLYPH = 0.9;

const reachOf = (item) =>
  Math.max(0, Number(item.blur) || 0) * SOFT_REACH +
  Math.max(0, Number(item.glow?.size) || 0) * SOFT_REACH;

/* Круг вокруг точки поворота, в который ложится рамка при любом повороте. */
function turned(box, item, fallback) {
  if (!item.rotation) return box;
  const origin = item.origin || fallback;
  const reach = Math.max(
    Math.hypot(box[0] - origin.x, box[1] - origin.y),
    Math.hypot(box[2] - origin.x, box[1] - origin.y),
    Math.hypot(box[0] - origin.x, box[3] - origin.y),
    Math.hypot(box[2] - origin.x, box[3] - origin.y),
  );
  return [
    origin.x - reach,
    origin.y - reach,
    origin.x + reach,
    origin.y + reach,
  ];
}

function textExtent(item) {
  const lines =
    item.lines?.length > 1 ? item.lines : [String(item.value ?? "")];
  const size = Number(item.size) || 12;
  let longest = 0;
  for (const line of lines) if (line.length > longest) longest = line.length;
  const spacing = Math.abs(Number(item.letterSpacing) || 0);
  const width =
    Math.max(
      Number(item.fitSpacing) || 0,
      Number(item.fitWidth) || 0,
      longest * (size * EM_PER_GLYPH + spacing),
    ) + size;
  const height =
    size * 1.3 +
    (lines.length - 1) * (Number(item.lineStep) || size * 1.12) +
    size;
  const left =
    item.anchor === "middle"
      ? item.x - width / 2
      : item.anchor === "end"
        ? item.x - width
        : item.x;
  /* Базовая линия — не всегда середина строки: высота берётся в обе стороны. */
  const box = [left, item.y - height, left + width, item.y + height];
  const pad = (Number(item.strokeWidth) || 0) + reachOf(item);
  return turned(
    [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad],
    item,
    { x: item.x, y: item.y },
  );
}

function computeExtent(item) {
  const reach = reachOf(item);
  switch (item.kind) {
    case "rect":
    case "image": {
      const pad = (item.stroke ? Number(item.strokeWidth) || 0 : 0) / 2 + reach;
      const box = [
        item.x - pad,
        item.y - pad,
        item.x + item.width + pad,
        item.y + item.height + pad,
      ];
      return turned(box, item, { x: item.x, y: item.y });
    }
    case "circle": {
      const spread =
        Math.max(0, Number(item.r) || 0) +
        (item.stroke ? Number(item.strokeWidth) || 0 : 0) / 2 +
        reach;
      return [
        item.x - spread,
        item.y - spread,
        item.x + spread,
        item.y + spread,
      ];
    }
    case "glyph": {
      const half =
        Math.max(
          item.size * 0.72,
          item.size / 2 + (item.stroke ? Number(item.strokeWidth) || 0 : 0),
        ) + reach;
      return [item.x - half, item.y - half, item.x + half, item.y + half];
    }
    case "path": {
      const bounds = item.bounds;
      if (!bounds) return null;
      /* Стык не круглый — угол остриём уходит дальше половины толщины. */
      const joined = item.lineJoin === "round" || !item.lineJoin ? 0.5 : 2;
      /* Рамка — по вершинам, а контур зоны сглажен кривыми (Catmull-Rom) и на
         резком повороте уходит за них — не дальше трети длиннейшей стороны. */
      const curved = typeof item.d === "string" && item.d.includes("C");
      const swing = curved ? 0.3 * Math.max(bounds.width, bounds.height) : 0;
      const pad =
        (item.stroke ? Number(item.strokeWidth) || 0 : 0) * joined +
        reach +
        swing;
      return [
        bounds.x - pad,
        bounds.y - pad,
        bounds.x + bounds.width + pad,
        bounds.y + bounds.height + pad,
      ];
    }
    case "text":
      return textExtent(item);
    default:
      return null;
  }
}

/**
 * Рамка примитива сцены — `[x0, y0, x1, y1]` в единицах сцены, с запасом на
 * обводку, размытие и свечение; `null` — рамки нет, примитив остаётся всегда.
 */
export function itemExtent(item) {
  let box = EXTENTS.get(item);
  if (box === undefined) {
    box = computeExtent(item);
    if (box && !box.every(Number.isFinite)) box = null;
    EXTENTS.set(item, box);
  }
  return box;
}

const sameItems = (left, right) =>
  left.length === right.length &&
  left.every((item, index) => item === right[index]);

/**
 * Слой только с тем, что пересекает `clip` (`{ x, y, width, height }`). Нечего
 * отсекать — тот же слой, а не копия. Слою с общим размытием (свечение зон)
 * кадр расширяется на вылет размытия.
 */
export function cullLayer(layer, clip) {
  const reach = Math.max(0, Number(layer.blur) || 0) * SOFT_REACH;
  const left = clip.x - reach;
  const top = clip.y - reach;
  const right = clip.x + clip.width + reach;
  const bottom = clip.y + clip.height + reach;
  const items = layer.items;
  let kept = null;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const box = itemExtent(item);
    const outside =
      box &&
      (box[2] < left || box[0] > right || box[3] < top || box[1] > bottom);
    if (outside) kept ||= items.slice(0, index);
    else kept?.push(item);
  }
  return kept ? { ...layer, items: kept } : layer;
}

/**
 * Сцена только с видимым в `clip`. Ничего не отсечено — та же сцена.
 */
export function cullScene(scene, clip) {
  let changed = false;
  const layers = scene.layers.map((layer) => {
    const next = cullLayer(layer, clip);
    if (next !== layer) changed = true;
    return next;
  });
  return changed ? { ...scene, layers } : scene;
}

/**
 * Отсекатель с памятью: слой, у которого набор видимого не изменился между
 * двумя кадрами, возвращается тем же объектом — `memo` слоя в `MapScene` не
 * перерисовывает его, а перерисовка слоя — это тысяча элементов.
 */
export function createSceneCuller() {
  const last = new Map();
  return (scene, clip) => {
    let changed = false;
    const layers = scene.layers.map((layer) => {
      const next = cullLayer(layer, clip);
      const before = last.get(layer.id);
      const reuse =
        before &&
        before.layer === layer &&
        sameItems(before.result.items, next.items);
      const result = reuse ? before.result : next;
      last.set(layer.id, { layer, result });
      if (result !== layer) changed = true;
      return result;
    });
    return changed ? { ...scene, layers } : scene;
  };
}
