/*
 * Килл-эффект на матовой стене.
 *
 * Один проход на всех: большой кадр редактора, плитки шаблонов и обложка
 * раздела в мастерской и библиотеке рисуют эффект этим кодом. Карточка,
 * нарисованная своим проходом, показывала бы не тот эффект, который человек
 * увидит в кадре, и выбор шаблона снова стал бы выбором вслепую.
 *
 * Сцена — матовая стена Astral, та же плашка, что под обложками мастерской
 * (владелец, 25.09.2026). Кирпичная кладка с кровью уводила взгляд с эффекта
 * на декорацию: человек разглядывал стену и лужу, а не вспышку, ради которой
 * пришёл. На ровной стене видно ровно то, что меняет эффект.
 *
 * У стены нет цвета, и сдвиг цвета игры по ней сам не виден. Поэтому то, во
 * что эффект уводит кадр, показано каймой вспышки (`frame.flash`): цвет
 * эффекта полупрозрачно ложится по краям экрана и едва заметно — на середину.
 * Не свечением: свет складывался бы со стеной и читался как лампа за кадром,
 * а не как экран, который на миг окрасился.
 *
 * Остальное ложится в порядке postfx игры: экспозиция и свечение — на стене;
 * кайма, рамка, полосы градиента и туман — слоем эффекта; размытие, линза и
 * хроматика — над этим слоем; плёнка — последней. Совпадение с игрой не
 * пиксельное и не может им быть: там шейдер по кадру, здесь холст по стене.
 * Предпросмотр показывает, какого цвета вспышка, где она ложится, насколько
 * она плотная и сколько держится.
 */

import {
  hexLuminance,
  hexToCss,
  hexToRgb,
  killEffectEnvelope,
  gameGradientStops,
  killEffectFrame,
} from "@modovik/kill-effects";

/**
 * Кадр на пике эффекта — середина его полки. Плитки шаблонов и обложка
 * показывают, каким эффект бывает, а не каким он начинается.
 */
export function killEffectPeakFrame(project) {
  const envelope = killEffectEnvelope(project);
  return killEffectFrame(project, envelope.attackMs + envelope.holdMs / 2);
}

/* Холсты рисовальщика живут по размеру кадра: стена не меняется ни на
   пиксель, а слой эффекта перерисовывается каждый кадр — новый холст на
   каждый кадр был бы новым буфером в видеопамяти шестьдесят раз в секунду.
   Размер кадра меняется при перетаскивании окна, и без потолка карта
   набирала бы по холсту на каждый промежуточный размер. */
const CACHE_LIMIT = 8;
const walls = new Map();
const layers = new Map();

function remember(cache, key, create) {
  const cached = cache.get(key);
  if (cached) return cached;
  if (cache.size >= CACHE_LIMIT) cache.clear();
  const value = create();
  cache.set(key, value);
  return value;
}

function blankCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Матовая стена в пикселях устройства: чёрная основа и едва заметный свет
 * сверху — `radial-gradient(110% 80% at 50% 30%, …) #030303` у
 * `.workshop-cover` (`editor-covers.css`). Обложка раздела рисует ту же
 * стену, и плашка под ней с ней совпадает. До 17.10 была серой (#0c0c0c и
 * свет 7 %), владелец: «серые подложки на фотографиях».
 */
export function matteWall(width, height) {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  return remember(walls, `${w}x${h}`, () => {
    const canvas = blankCanvas(w, h);
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    context.fillStyle = "#030303";
    context.fillRect(0, 0, w, h);
    /* Свет — эллипс 110 % × 80 % кадра: круг растягивается по ширине. */
    const stretch = (1.1 * w) / (0.8 * h);
    context.save();
    context.translate(w / 2, h * 0.3);
    context.scale(stretch, 1);
    const light = context.createRadialGradient(0, 0, 0, 0, 0, 0.8 * h);
    light.addColorStop(0, "rgba(255, 255, 255, 0.035)");
    light.addColorStop(0.68, "rgba(255, 255, 255, 0)");
    context.fillStyle = light;
    context.fillRect(-w / stretch, -h, (2 * w) / stretch, 2 * h);
    context.restore();
    return canvas;
  });
}

/* Зерно рисуется один раз в тайл и дальше только повторяется: генерировать
   шум на каждый кадр — это тратить кадровое время на то, чего не видно. */
const grainTiles = new Map();

function noiseTile(size) {
  const cached = grainTiles.get(size);
  if (cached) return cached;
  const canvas = blankCanvas(96, 96);
  const context = canvas.getContext("2d");
  const image = context.createImageData(canvas.width, canvas.height);
  const step = Math.max(1, size);
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const value = 90 + Math.random() * 76;
      for (let dy = 0; dy < step && y + dy < canvas.height; dy += 1) {
        for (let dx = 0; dx < step && x + dx < canvas.width; dx += 1) {
          const index = ((y + dy) * canvas.width + (x + dx)) * 4;
          image.data[index] = value;
          image.data[index + 1] = value;
          image.data[index + 2] = value;
          image.data[index + 3] = 255;
        }
      }
    }
  }
  context.putImageData(image, 0, 0);
  grainTiles.set(size, canvas);
  return canvas;
}

/*
 * Кайма вспышки: цвет эффекта полосой вдоль краёв экрана и едва заметно —
 * по всему кадру.
 *
 * Полоса одной толщины со всех сторон, от доли короткой стороны кадра: овал
 * по пропорциям кадра делал боковые полосы втрое толще верхней, и на плитке
 * обложки кайма заливала почти всё. Внутрь она гаснет быстро — плотно
 * только у самого края, «чуть-чуть непрозрачно» (владелец, 25.09.2026). Углы,
 * где встречаются две стороны, плотнее — как у любой рамки экрана.
 */
const FLASH_DEPTH = 0.26;
const FLASH_WASH = 0.1;
const FLASH_PROFILE = Object.freeze([
  [0, 1],
  [0.2, 0.66],
  [0.45, 0.32],
  [0.7, 0.1],
  [1, 0],
]);

function drawFlash(context, width, height, flash) {
  const depth = Math.max(4, Math.min(width, height) * FLASH_DEPTH);
  context.fillStyle = hexToCss(flash.color, flash.alpha * FLASH_WASH);
  context.fillRect(0, 0, width, height);
  const band = (x0, y0, x1, y1) => {
    const fill = context.createLinearGradient(x0, y0, x1, y1);
    for (const [offset, share] of FLASH_PROFILE)
      fill.addColorStop(offset, hexToCss(flash.color, flash.alpha * share));
    return fill;
  };
  context.fillStyle = band(0, 0, 0, depth);
  context.fillRect(0, 0, width, depth);
  context.fillStyle = band(0, height, 0, height - depth);
  context.fillRect(0, height - depth, width, depth);
  context.fillStyle = band(0, 0, depth, 0);
  context.fillRect(0, 0, depth, height);
  context.fillStyle = band(width, 0, width - depth, 0);
  context.fillRect(width - depth, 0, depth, height);
}

/*
 * Рамка игры: цвет к краям, радиус и жёсткость — как в модификаторе. Рамка
 * идёт по форме экрана, а не кругом: игра меряет её в долях кадра, и круг на
 * широкой сцене давил только на боковые края.
 */
function drawVignette(context, width, height, vignette) {
  const stretch = width / height;
  /* В сжатых координатах кадр — квадрат со стороной `height`, и угол лежит
     на половине его диагонали. */
  const radius = Math.SQRT1_2 * height;
  context.save();
  context.translate(width / 2, height / 2);
  context.scale(stretch, 1);
  const gradient = context.createRadialGradient(
    0,
    0,
    radius * vignette.inner,
    0,
    0,
    radius * vignette.outer,
  );
  gradient.addColorStop(0, hexToCss(vignette.color, 0));
  gradient.addColorStop(
    Math.min(0.92, 0.55 + vignette.contrast * 0.4),
    hexToCss(vignette.color, vignette.alpha * 0.55),
  );
  gradient.addColorStop(1, hexToCss(vignette.color, vignette.alpha));
  context.fillStyle = gradient;
  context.fillRect(-height, -height, 2 * height, 2 * height);
  context.restore();
}

/*
 * Сколько полоса градиента закрывает стену. Игра умножает кадр на цвет
 * полосы, и белая полоса — это «как было»; на тёмной стене умножение само не
 * видно, поэтому полоса ложится плёнкой: тем плотнее, чем темнее и
 * насыщеннее её цвет.
 */
function bandCover(hex) {
  const { r, g, b } = hexToRgb(hex);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return Math.min(0.78, 0.66 * (1 - hexLuminance(hex)) + 0.3 * chroma);
}

/*
 * Полосы градиента плёнкой. Нейтральная полоса (белая) прозрачна, и цвет у
 * её границы берётся у ближайшей закрашенной: холст смешивает цвета границ
 * без учёта прозрачности, и тёмно-красный верх, уходящий в «прозрачный
 * белый», по дороге становился розовым.
 */
function drawGradient(context, width, height, gradient) {
  const stops = gradient.stops.map((stop) => ({
    ...stop,
    cover: bandCover(stop.color),
  }));
  const painted = stops.filter((stop) => stop.cover > 0.01);
  if (!painted.length) return;
  const fill = context.createLinearGradient(0, 0, 0, height);
  let previous = -1;
  stops.forEach((stop, index) => {
    const offset = Math.min(1, Math.max(previous + 0.0001, stop.offset));
    const colour =
      stop.cover > 0.01
        ? stop.color
        : stops
            .map((other, at) => ({ other, distance: Math.abs(at - index) }))
            .filter(({ other }) => other.cover > 0.01)
            .sort((a, b) => a.distance - b.distance)[0].other.color;
    fill.addColorStop(
      Math.min(1, Math.max(0, offset)),
      hexToCss(colour, stop.cover * gradient.alpha),
    );
    previous = offset;
  });
  context.fillStyle = fill;
  context.fillRect(0, 0, width, height);
}

/*
 * Полосы градиента на кадре игры — умножением, как у игры (стенд, 28.10.2026, килл-эффект Korolevskiy: «у автора эффект сверху экрана»). Игра множит
 * кадр на цвет полосы: белая — «как было», розовая сверху (1; 0,545; 0,545) убирает зелёное и синее у верха кадра и сходит на нет к границе середины.
 * Но множит она в линейном цвете, и спад идёт S-кривой, а не прямой: остановки с поправкой на то и другое — `gameGradientStops` (`@modovik/kill-effects`,
 * замер кадров игры в `game-gradient.js`). Плёнкой (`drawGradient`) это не повторить; она осталась для стены — на тёмной стене умножение не видно вовсе.
 * Сила эффекта (огибающая) смешивает цвет полосы с белым.
 */
function drawGradientMultiply(context, width, height, gradient) {
  const fill = context.createLinearGradient(0, 0, 0, height);
  for (const stop of gameGradientStops(gradient)) fill.addColorStop(stop.offset, stop.color);
  context.save();
  context.globalCompositeOperation = "multiply";
  context.fillStyle = fill;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function drawFog(context, width, height, fog) {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  const peak = Math.min(0.85, 0.34 + fog.falloff * 0.3);
  gradient.addColorStop(0, hexToCss(fog.color, fog.alpha * 0.5));
  gradient.addColorStop(peak, hexToCss(fog.color, fog.alpha));
  gradient.addColorStop(1, hexToCss(fog.color, fog.alpha * 0.2));
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

/**
 * Кадр эффекта.
 *
 * `width`/`height` — размер кадра в пикселях раскладки; контекст уже
 * масштабирован под плотность экрана (`setTransform(ratio, …)`), и стена со
 * слоем эффекта рисуются в пикселях устройства — по той же мерке.
 */
export function paintKillEffect({
  context,
  width,
  height,
  frame,
  elapsed = 0,
  grain = true,
  /* Своя сцена вместо стены (обложка каталога, 17.10): картинка, на которой
     видны чёрная виньетка, размытие и линза — на ровной тёмной стене эффект
     из одной виньетки и размытия выходил пустым кадром. */
  scene = null,
}) {
  context.clearRect(0, 0, width, height);
  const ratio = context.getTransform?.().a || 1;
  const deviceWidth = Math.max(2, Math.round(width * ratio));
  const deviceHeight = Math.max(2, Math.round(height * ratio));
  const wall = scene || matteWall(deviceWidth, deviceHeight);
  /* Размытие и линза игры ложатся на весь кадр. На стене их не видно, и она
     их не платит; на сцене — видно. */
  const lens =
    scene && frame.strength > 0 ? 1 + Math.abs(frame.distortion || 0) * 0.18 : 1;
  const soften =
    scene && frame.strength > 0
      ? (frame.blur || 0) + (frame.backgroundBlur || 0) * 0.5
      : 0;

  /* Экспозиция — свет самой стены. */
  context.save();
  /* Насыщенность — на сцене с цветом: у матовой стены цвета нет и снимать нечего. */
  const saturate =
    scene && frame.strength > 0 && Math.abs((frame.saturation ?? 1) - 1) > 0.01
      ? `saturate(${Math.max(0, frame.saturation).toFixed(3)})`
      : "";
  const filters = [
    (frame.brightness ?? 1) === 1
      ? ""
      : `brightness(${frame.brightness.toFixed(3)})`,
    saturate,
    soften > 0.05 ? `blur(${soften.toFixed(2)}px)` : "",
  ].filter(Boolean);
  context.filter = filters.length ? filters.join(" ") : "none";
  context.drawImage(
    wall,
    (width * (1 - lens)) / 2,
    (height * (1 - lens)) / 2,
    width * lens,
    height * lens,
  );
  context.restore();

  if (frame.bloom?.alpha > 0) {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = frame.bloom.alpha;
    context.filter = `blur(${(8 + frame.bloom.alpha * 18).toFixed(1)}px) brightness(${(1.1 + frame.bloom.threshold).toFixed(2)})`;
    context.drawImage(wall, 0, 0, width, height);
    context.restore();
  }

  if (!(frame.strength > 0)) return;

  /* Линза показана приближённо: настоящая бочка — деформация сетки в
     шейдере, здесь остаётся наезд кадра в ту же сторону. */
  const zoom = 1 + Math.abs(frame.distortion || 0) * 0.18;
  const blur = (frame.blur || 0) + (frame.backgroundBlur || 0) * 0.5;
  const optics = blur > 0.05 || zoom !== 1 || frame.chromatic > 0.2;

  /*
   * Без размытия, линзы и хроматики слой эффекта ложится прямо на стену.
   * Отдельный холст нужен, только чтобы оптика легла на кайму, рамку и
   * полосы разом; без неё он был лишним проходом во весь кадр — а наложение
   * «поверх» ассоциативно, и картинка выходит та же самая.
   */
  if (!optics) {
    if (frame.flash) drawFlash(context, width, height, frame.flash);
    if (frame.vignette) drawVignette(context, width, height, frame.vignette);
    if (frame.gradient) (scene ? drawGradientMultiply : drawGradient)(context, width, height, frame.gradient);
    if (frame.fog) drawFog(context, width, height, frame.fog);
  } else {
    /* Слой эффекта: кайма, рамка, полосы и туман — одним холстом, чтобы
       размытие, линза и хроматика легли на них разом, как на кадр игры. */
    const layer = remember(layers, `${deviceWidth}x${deviceHeight}`, () =>
      blankCanvas(deviceWidth, deviceHeight),
    );
    const paint = layer.getContext("2d");
    if (!paint) return;
    paint.setTransform(1, 0, 0, 1, 0, 0);
    paint.clearRect(0, 0, deviceWidth, deviceHeight);
    paint.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (frame.flash) drawFlash(paint, width, height, frame.flash);
    if (frame.vignette) drawVignette(paint, width, height, frame.vignette);
    if (frame.gradient && !scene) drawGradient(paint, width, height, frame.gradient);
    if (frame.fog) drawFog(paint, width, height, frame.fog);

    /* На кадре игры градиент — умножением прямо по кадру (оптика линзы к нему не относится: он стоит под ней). */
    if (frame.gradient && scene) drawGradientMultiply(context, width, height, frame.gradient);
    const x = (width * (1 - zoom)) / 2;
    const y = (height * (1 - zoom)) / 2;
    context.save();
    context.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
    context.drawImage(layer, x, y, width * zoom, height * zoom);
    if (frame.chromatic > 0.2) {
      context.globalCompositeOperation = "screen";
      context.globalAlpha = 0.3;
      context.drawImage(layer, x - frame.chromatic, y, width * zoom, height * zoom);
      context.drawImage(layer, x + frame.chromatic, y, width * zoom, height * zoom);
    }
    context.restore();
  }

  if (frame.scanlines) {
    const offset =
      (elapsed * frame.scanlines.speed * 0.06) % frame.scanlines.period;
    context.save();
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = frame.scanlines.alpha;
    context.fillStyle = "#000000";
    for (
      let line = -frame.scanlines.period + offset;
      line < height;
      line += frame.scanlines.period
    ) {
      context.fillRect(0, line, width, Math.max(1, frame.scanlines.period / 2));
    }
    context.restore();
  }

  if (grain && frame.grain) {
    const pattern = context.createPattern(
      noiseTile(frame.grain.size),
      "repeat",
    );
    context.save();
    context.globalCompositeOperation = "overlay";
    context.globalAlpha = frame.grain.alpha;
    context.fillStyle = pattern;
    context.translate(-((elapsed * 7) % 40), -((elapsed * 11) % 40));
    context.fillRect(0, 0, width + 80, height + 80);
    context.restore();
  }
}
