import { useEffect, useState } from "react";

const TUNING = Object.freeze({
  sample: 24,
  backdrop: [20, 20, 21],
  seeThroughShare: 0.12,
  whiteHeadstart: 1.3,
  cacheLimit: 400,
});

// Тон картинки (тёмная/светлая) решает, каким цветом писать подпись и красить плашки поверх неё.
export const DARK = "dark";
export const LIGHT = "light";

// Пока замера нет — START_TONES; замер не удался или адреса нет — FALLBACK_TONES.
const START_TONES = Object.freeze(
  Object.fromEntries([
    ["text", DARK],
    ["corner", DARK],
    ["transparent", false],
    ["measured", false],
  ]),
);
const FALLBACK_TONES = Object.freeze({ ...START_TONES, measured: true });

const CHANNEL_WEIGHTS = [0.2126, 0.7152, 0.0722];

const expand = (share) => ((share + 0.055) / 1.055) ** 2.4;

function toLinear(channel) {
  const share = channel / 255;
  return share > 0.04045 ? expand(share) : share / 12.92;
}

/** Относительная яркость WCAG; входы не проверяются и не отсекаются. */
export function luminanceOf(red, green, blue) {
  const [r, g, b] = [red, green, blue].map((channel, at) => CHANNEL_WEIGHTS[at] * toLinear(channel));
  return r + g + b;
}

const INK_FLOOR = luminanceOf(17, 17, 17) + 0.05;

/** Светлая картинка получает тёмный текст, только если он контрастнее белого с форой 1,3. */
export function toneOfLuminance(luminance) {
  const lifted = luminance + 0.05;
  const inkEdge = lifted / INK_FLOOR;
  const whiteEdge = (1.05 / lifted) * TUNING.whiteHeadstart;
  return inkEdge > whiteEdge ? LIGHT : DARK;
}

// Среднее по набору пикселей; пустое место — яркость 0.
function toneOfMean(values) {
  let total = 0;
  for (const value of values) total += value;
  return toneOfLuminance(values.length ? total / values.length : 0);
}

// Пиксель смешивается с тёмной подложкой окна по своей прозрачности.
function* pixelsOf(data, size) {
  let y = 0;
  while (y < size) {
    let x = 0;
    while (x < size) {
      const at = 4 * (y * size + x);
      const alpha = data[at + 3] / 255;
      const mixed = TUNING.backdrop.map((back, shift) => data[at + shift] * alpha + back * (1 - alpha));
      yield { x, y, alpha, luminance: luminanceOf(...mixed) };
      x += 1;
    }
    y += 1;
  }
}

// Какие пиксели идут в замер подписи (нижняя часть) и угловой плашки (правый верхний угол).
const REGIONS = [
  ["bottom", (x, y, size) => y >= size * 0.55],
  ["corner", (x, y, size) => y < size / 3 && x >= (size * 2) / 3],
];

export function tonesOfPixels(data, size = TUNING.sample) {
  const lumaByRegion = new Map(REGIONS.map(([name]) => [name, []]));
  let clearCount = 0;
  for (const { x, y, alpha, luminance } of pixelsOf(data, size)) {
    if (alpha < 0.5) clearCount += 1;
    for (const [name, covers] of REGIONS) {
      if (covers(x, y, size)) lumaByRegion.get(name).push(luminance);
    }
  }
  return {
    text: toneOfMean(lumaByRegion.get("bottom")),
    corner: toneOfMean(lumaByRegion.get("corner")),
    transparent: clearCount / (size * size) >= TUNING.seeThroughShare,
    measured: true,
  };
}

/* ---------- кэш и загрузка ---------- */

const [known, loading] = [new Map(), new Map()];

function remember(src, tones) {
  if (known.size >= TUNING.cacheLimit) {
    const [oldest] = known.keys();
    known.delete(oldest);
  }
  known.set(src, tones);
}

export const knownImageTones = (src) => (src ? known.get(src) || null : null);

export function forgetImageTones() {
  [known, loading].forEach((registry) => registry.clear());
}

export function primeImageTones(src, tones) {
  const merged = { ...FALLBACK_TONES, ...tones };
  merged.measured = true;
  remember(src, merged);
}

const WEB_PROTOCOL = /^https?:$/;

function isForeign(src) {
  try {
    const { protocol, origin } = new URL(src, window.location.href);
    return WEB_PROTOCOL.test(protocol) && origin !== window.location.origin;
  } catch {
    return false;
  }
}

const CONTEXT_OPTIONS = { willReadFrequently: true };

function sample(image) {
  const frame = [0, 0, TUNING.sample, TUNING.sample];
  try {
    const canvas = Object.assign(document.createElement("canvas"), {
      width: TUNING.sample,
      height: TUNING.sample,
    });
    const context = canvas.getContext("2d", CONTEXT_OPTIONS);
    if (!context) return FALLBACK_TONES;
    context.drawImage(image, ...frame);
    return tonesOfPixels(context.getImageData(...frame).data);
  } catch {
    return FALLBACK_TONES;
  }
}

function measure(src) {
  return new Promise((resolve) => {
    const image = Object.assign(new Image(), { decoding: "async" });
    if (isForeign(src)) image.crossOrigin = "anonymous";
    Object.assign(image, {
      onload: () => resolve(sample(image)),
      onerror: () => resolve(FALLBACK_TONES),
    });
    image.src = src;
  });
}

// Когда замер закончен: убрать из «идущих», запомнить, отдать тона.
const finishing = (src) => (tones) => {
  loading.delete(src);
  remember(src, tones);
  return tones;
};

function startMeasuring(src) {
  const job = measure(src).then(finishing(src));
  loading.set(src, job);
  return job;
}

export function imageTones(src) {
  const unmeasurable = !src || typeof window === "undefined";
  if (unmeasurable) return Promise.resolve(FALLBACK_TONES);
  const ready = known.get(src);
  return ready ? Promise.resolve(ready) : (loading.get(src) ?? startMeasuring(src));
}

const initialTonesOf = (src) => knownImageTones(src) ?? START_TONES;
const freshState = (src) => ({ src, tones: initialTonesOf(src) });

// Подписка на замер; возвращает отмену, после которой результат не публикуется.
function followTones(src, publish) {
  let alive = true;
  imageTones(src).then((tones) => alive && publish({ src, tones }));
  return () => {
    alive = false;
  };
}

export function useImageTones(src) {
  const [state, setState] = useState(() => freshState(src));

  useEffect(() => (src ? followTones(src, setState) : undefined), [src]);

  return state.src === src ? state.tones : initialTonesOf(src);
}
