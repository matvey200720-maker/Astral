/*
 * Круг настоящего мира вокруг места (ТЗ владельца 10.11.2026, часть 4): сцены маппинга, ангара, завода, мегамолла, You Tool
 * и летающего лого несут часть `surround` — землю, дороги, соседние дома и песок из файлов игры (`scripts/prepare-world-ring.mjs`);
 * в описании части записан круг `disc` (оси сцены, метры). Дальше круга — чёрный купол, полоса внутри него плавно темнеет — тем же
 * приёмом, что у «Баннеров на зданиях» (`edgeFade`, цвет уходит к краю в чёрный фон): точечный `dissolve` у края рябил (владелец, 10.11.2026).
 */

export const RING_PART = "surround";
/** Материал круга мира (группа `surround`): фон, а не предмет правки — под курсором и в подсветке его нет. */
export const isRingMaterial = (info) => info?.group === RING_PART;
/* Полоса растворения внутри круга, м. */
export const RING_FADE_WIDTH = 14;

/** Круг мира сцены (`{ centre: [x, y], radius }`) или `null`: сцена без кольца. */
export function ringDisc(asset) {
  const disc = asset?.parts?.find((part) => part?.id === RING_PART)?.disc;
  const [x, y] = Array.isArray(disc?.centre) ? disc.centre : [];
  return Number.isFinite(x) && Number.isFinite(y) && disc.radius > 0 ? { centre: [x, y], radius: disc.radius } : null;
}

/**
 * Рамка самого места (оси сцены): сцена без круга мира — её рамка; с кругом — объединение рамок остальных частей. Камера,
 * вход в редактор и границы для своих моделей берут её: круг мира вокруг места — фон, а не предмет правки.
 */
export function placeBounds(asset) {
  const own = (asset?.parts || []).filter((part) => part?.id !== RING_PART && part?.bounds?.min && part?.bounds?.max);
  if (!own.length || own.length === (asset?.parts || []).length) return asset?.bounds || null;
  const axes = [0, 1, 2];
  return {
    min: axes.map((axis) => Math.min(...own.map((part) => part.bounds.min[axis]))),
    max: axes.map((axis) => Math.max(...own.map((part) => part.bounds.max[axis]))),
  };
}

/**
 * Мягкий край кадра (`ModelStage.edgeFade`) по кругу мира сцены: плавное затемнение к чёрному у самого края. Нет кольца (сцена ещё
 * не загружена, или у места мира нет) — `fallback` (по умолчанию «без края», как было).
 */
export function ringEdgeFade(asset, fallback = false) {
  const disc = ringDisc(asset);
  if (!disc) return fallback;
  return { shape: "disc", centre: disc.centre, radius: disc.radius, width: Math.min(RING_FADE_WIDTH, disc.radius / 3) };
}

/**
 * Тот же край функцией сцены: `<ModelStage edgeFade={ringEdgeFor(fallback)} />`. Кадр сам зовёт её с загруженной сценой и ставит край до сборки материалов (`ModelStage.jsx: edgeOf`) —
 * редактору не нужно ждать `onScene` и отдавать круг следующим проходом, а программам сцены — собираться дважды. Функцию держать стабильной (`useMemo` или модуль).
 */
export const ringEdgeFor = (fallback = false) => (asset) => ringEdgeFade(asset, fallback);

/* Готовые функции для редакторов: один раз на модуль, значит стабильные. `ringEdgeOfSolid` — запасной край `true` (рамка и контур, пока сцены нет). */
export const ringEdgeOf = ringEdgeFor();
export const ringEdgeOfSolid = ringEdgeFor(true);
