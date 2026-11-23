/*
 * Свои надписи и картинки на мини-карте (задача 1 ТЗ 17.10.2026, владелец:
 * «писать текст на миникарте и добавлять свои гифки/картинки, которые просто
 * будут отображаться там»).
 *
 * Элемент стоит на карте так же, как полосы и цифры: центр — доли радара
 * 179×115, размер — единицы редактора (360 на ширину радара). В игру он
 * уходит фигурой в контейнере мини-карты (`minimap-gfx-compiler.js`) и едет
 * вместе с картой: дальше её кадра игра ничего не рисует.
 *
 * Надпись пишет шрифт HUD, который фильм мини-карты уже подключает (обычный
 * `$Font2` или узкий `$Font2_cond`), — чужих шрифтов в фильм не приносим.
 *
 * Картинка — растр в самом фильме; GIF — лист кадров (сетка `columns`
 * столбцов, кадры слева направо и сверху вниз) и задержка каждого кадра.
 * Пределы держат фильм мини-карты маленьким: его растры игра держит в памяти
 * всё время, пока виден радар, и мегабайты здесь — это память игры, а не
 * диск.
 */

export const MINIMAP_OVERLAY_LIMITS = Object.freeze({
  items: 8,
  textLength: 40,
  textSize: Object.freeze([8, 48]),
  /* Ширина картинки в единицах редактора (360 — во всю ширину радара). */
  imageWidth: Object.freeze([12, 360]),
  frames: 48,
  /* Сторона кадра в точках растра. */
  frameSide: Object.freeze([4, 512]),
  /* Точек на лист одной картинки и на все картинки вместе: 512×512 и вдвое. */
  sheetPixels: 262_144,
  totalPixels: 524_288,
  /* Задержка кадра GIF и длина круга. */
  delayMs: Object.freeze([20, 5000]),
  loopSeconds: 10,
  opacity: Object.freeze([10, 100]),
});

/** Кадров в секунду у фильма мини-карты (заголовок SWF, Steam Legacy). */
export const MINIMAP_OVERLAY_FPS = 30;
export const MINIMAP_OVERLAY_KINDS = Object.freeze(["text", "image"]);
export const MINIMAP_OVERLAY_FONTS = Object.freeze(["regular", "cond"]);

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
};
const rounded = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const hex = (value, fallback) =>
  /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;

/*
 * Текст надписи: печатные знаки одной строкой. Тильда и угловые скобки у
 * текста игры — разметка (`~r~`, `<font>`), их в надпись не пускаем.
 */
export function cleanOverlayText(value) {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f~<>]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, MINIMAP_OVERLAY_LIMITS.textLength);
}

function normalizeImage(input) {
  const source = input && typeof input === "object" ? input : null;
  if (!source || !String(source.assetId || "")) return null;
  const L = MINIMAP_OVERLAY_LIMITS;
  const frameWidth = Math.round(clamp(source.frameWidth, L.frameSide[0], L.frameSide[1], 64));
  const frameHeight = Math.round(clamp(source.frameHeight, L.frameSide[0], L.frameSide[1], 64));
  const frames = Math.round(clamp(source.frames, 1, L.frames, 1));
  const columns = Math.round(clamp(source.columns, 1, frames, 1));
  const delays = Array.from({ length: frames }, (_, index) =>
    Math.round(clamp(source.delays?.[index], L.delayMs[0], L.delayMs[1], 100)),
  );
  return {
    assetId: String(source.assetId).slice(0, 160),
    name: String(source.name || "").slice(0, 80),
    frameWidth,
    frameHeight,
    frames,
    columns,
    delays: frames > 1 ? delays : [],
  };
}

/** Один элемент; `null` — неполный (картинка без файла, пустая надпись). */
export function normalizeMinimapOverlay(input, index = 0) {
  const source = input && typeof input === "object" ? input : {};
  const kind = MINIMAP_OVERLAY_KINDS.includes(source.kind) ? source.kind : null;
  if (!kind) return null;
  const id = /^[a-z0-9_-]{1,24}$/i.test(String(source.id || "")) ? String(source.id) : `o${index + 1}`;
  const base = {
    id,
    kind,
    visible: source.visible !== false,
    x: rounded(clamp(source.x, -0.5, 1.5, 0.5)),
    y: rounded(clamp(source.y, -0.5, 1.5, 0.5)),
    opacity: Math.round(clamp(source.opacity, MINIMAP_OVERLAY_LIMITS.opacity[0], MINIMAP_OVERLAY_LIMITS.opacity[1], 100)),
  };
  if (kind === "text") {
    const text = cleanOverlayText(source.text);
    return {
      ...base,
      text,
      size: Math.round(clamp(source.size, MINIMAP_OVERLAY_LIMITS.textSize[0], MINIMAP_OVERLAY_LIMITS.textSize[1], 16)),
      color: hex(source.color, "#ffffff"),
      font: MINIMAP_OVERLAY_FONTS.includes(source.font) ? source.font : "regular",
    };
  }
  const image = normalizeImage(source.image);
  if (!image) return null;
  return {
    ...base,
    width: Math.round(clamp(source.width, MINIMAP_OVERLAY_LIMITS.imageWidth[0], MINIMAP_OVERLAY_LIMITS.imageWidth[1], 60)),
    image,
  };
}

/** Надписи и картинки проекта: не больше восьми, без повторов номеров. */
export function normalizeMinimapOverlays(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const result = [];
  for (const [index, item] of list.entries()) {
    if (result.length >= MINIMAP_OVERLAY_LIMITS.items) break;
    const overlay = normalizeMinimapOverlay(item, index);
    if (!overlay) continue;
    let { id } = overlay;
    for (let suffix = 2; seen.has(id); suffix += 1) id = `${overlay.id.slice(0, 20)}-${suffix}`;
    seen.add(id);
    result.push({ ...overlay, id });
  }
  return result;
}

/** Точек на листе картинки (без полей) — на неё и смотрит предел. */
export const minimapOverlaySheetPixels = (image) =>
  image ? image.frameWidth * image.frameHeight * image.frames : 0;

/** Сколько точек займут все картинки — растры фильма вместе. */
export function minimapOverlayPixels(overlays) {
  return normalizeMinimapOverlays(overlays)
    .filter((item) => item.kind === "image" && item.visible)
    .reduce((sum, item) => sum + minimapOverlaySheetPixels(item.image), 0);
}

/*
 * Ширина надписи в кеглях: средний знак шрифта HUD — чуть больше половины
 * кегля (Chalet London: 0,56; узкий — 0,46), и по половине кегля полей.
 */
const TEXT_ADVANCE = Object.freeze({ regular: 0.6, cond: 0.5 });

/**
 * Коробка элемента в долях радара: центр и размер. Надпись — по числу
 * знаков и кеглю, картинка — по ширине и пропорции кадра.
 */
export function minimapOverlayBox(overlay, { radarWidth = 179, radarHeight = 115, editorUnits = 360 } = {}) {
  const toPoints = (units) => (Number(units) * radarWidth) / editorUnits;
  if (overlay.kind === "text") {
    const size = toPoints(overlay.size);
    const width = size * (Math.max(1, overlay.text.length) * (TEXT_ADVANCE[overlay.font] || 0.6) + 1);
    const height = size * 1.3;
    return { x: overlay.x, y: overlay.y, width: width / radarWidth, height: height / radarHeight };
  }
  const width = toPoints(overlay.width);
  const height = (width * overlay.image.frameHeight) / overlay.image.frameWidth;
  return { x: overlay.x, y: overlay.y, width: width / radarWidth, height: height / radarHeight };
}

/**
 * Кадры GIF по кадрам фильма (30 в секунду): номер кадра листа на каждом
 * кадре фильма. Задержка округляется до кадра фильма (не меньше одного),
 * круг длиннее десяти секунд сжимается целиком — темп кадров сохраняется.
 */
export function minimapOverlayTimeline(image) {
  if (!image || image.frames <= 1) return [0];
  const step = 1000 / MINIMAP_OVERLAY_FPS;
  let counts = image.delays.map((delay) => Math.max(1, Math.round(delay / step)));
  const total = counts.reduce((sum, count) => sum + count, 0);
  const limit = MINIMAP_OVERLAY_LIMITS.loopSeconds * MINIMAP_OVERLAY_FPS;
  if (total > limit) counts = counts.map((count) => Math.max(1, Math.floor((count * limit) / total)));
  return counts.flatMap((count, frame) => Array.from({ length: count }, () => frame));
}

/** Клетка кадра `frame` на листе: левый верхний угол в точках растра. */
export function minimapOverlayCell(image, frame) {
  return {
    x: (frame % image.columns) * image.frameWidth,
    y: Math.floor(frame / image.columns) * image.frameHeight,
  };
}
