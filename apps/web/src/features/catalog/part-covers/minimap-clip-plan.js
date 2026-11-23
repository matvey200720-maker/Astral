/*
 * План петли мини-карты с играющими полосами (28.10.2026) — чистые вычисления без окна и кодировщика: длина петли, какие полосы играют и куда
 * кадр клипа ложится на обложке. Рисует и кодирует `minimap-clip.js`; здесь то, что проверяется тестом.
 */

/**
 * Кадр ролика (3 : 2, как обложка части) и потолок длины петли — 28 секунд (договор карточки: `media.video` до 30 с и 8 МиБ). Заливка из
 * видео или GIF (редактор мини-карты) играет по 488 кадров и больше — коротким потолком петля прыгала бы на шве.
 */
export const MINIMAP_CLIP = Object.freeze({ width: 960, height: 640, maxSeconds: 28, bitrate: 900_000 });
const FPS_MIN = 12;
const FPS_MAX = 60;

/** Частота ролика — частота фильма автора (самая низкая из полос), но не вне 12…60 к/с. */
export const clipFps = (values) => {
  const lowest = Math.min(...values);
  return Math.max(FPS_MIN, Math.min(FPS_MAX, Number.isFinite(lowest) && lowest > 0 ? Math.round(lowest) : 30));
};

const gcd = (left, right) => (right ? gcd(right, left % right) : left);

/** Длина петли в кадрах фильма: наименьшее общее кратное длин клипов, но не больше `cap` (тогда — самая длинная). */
export function loopLength(counts, cap) {
  const lengths = counts.map((count) => Math.max(1, Math.round(Number(count) || 1)));
  const common = lengths.reduce((total, count) => (total * count) / gcd(total, count), 1);
  return common <= cap ? common : Math.min(cap, Math.max(...lengths));
}

/**
 * Играющие полосы обложки: у полосы клип (`bar.animation`), она не повёрнута и на ней есть длина (доля HP или брони больше нуля).
 * `state` — `look.state` (`{ health, armor }`, 0…100).
 */
export function playingBars(look) {
  const share = (side) => Math.max(0, Math.min(100, Number(look?.state?.[side]) || 0)) / 100;
  return (look?.bars || [])
    .filter((bar) => bar.animation?.frames > 1 && !bar.rotate && share(bar.side) > 0)
    .map((bar) => ({ ...bar, share: share(bar.side) }));
}

/**
 * Куда ложится клип полосы на обложке: `rect` — рамка полосы целиком на холсте (пиксели), `box` — рамка клипа на первом кадре,
 * `whole` — по всем кадрам (то, что за рамку выступает, не обрезается), `share` — доля длины. Ответ — прямоугольник клипа в тех же
 * пикселях: игра сжимает клип вдоль полосы по числу, а не обрезает.
 */
export function barDrawRect({ rect, box, whole, share }) {
  const width = box.x1 - box.x0 || 1;
  const height = box.y1 - box.y0 || 1;
  const sx = rect.width / width;
  const sy = rect.height / height;
  return {
    x: rect.x + (whole.x0 - box.x0) * sx * share,
    y: rect.y + (whole.y0 - box.y0) * sy,
    width: (whole.x1 - whole.x0) * sx * share,
    height: (whole.y1 - whole.y0) * sy,
  };
}
