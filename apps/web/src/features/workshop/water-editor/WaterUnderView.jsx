/*
 * Кадр «Под водой» (задача 2, задача 7 ТЗ 11.10.2026): постановочный вид из-под
 * воды у берега на глубине 6 м — дно сеткой уходит вдаль и тонет в тумане,
 * сверху — свет сквозь гладь, вокруг — подводная дымка. Цвет толщи и света,
 * на сколько видно (туман местного вида у берега — там ныряют чаще всего),
 * размытие, дрожание, шум, виньетка и дымка — те же числа, что уйдут в
 * подводные модификаторы и дымку игры (`underPreview` →
 * `waterUnderwaterModifier`, `waterUnderwaterReach`). Рисуется холстом окна;
 * подпись кадра говорит, что это не кадр из игры.
 */

import { useEffect, useRef } from "react";
import { underPreview } from "./water-text.js";

const WIDTH = 1280;
const HEIGHT = 720;
/* Дно — плоскость на 2 м ниже глаза; линии сетки через 2 м до 200 м. */
const EYE = 2;
const STEP = 2;
const FAR = 200;
const FOCAL = 520;
/* Пятна подводной дымки: место по кадру, размер — доли высоты кадра. */
const MIST = Object.freeze([
  [0.18, 0.55, 0.42],
  [0.46, 0.62, 0.5],
  [0.78, 0.5, 0.46],
  [0.3, 0.8, 0.38],
  [0.66, 0.84, 0.4],
  [0.9, 0.76, 0.34],
]);

const css = (rgb, alpha = 1) => `rgba(${rgb.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255)).join(", ")}, ${alpha})`;
const mix = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);

/*
 * Слой размытого дна: штрихи дна рисуются на нём без фильтра, а размытие — одним проходом при наложении на кадр.
 * Фильтр у каждого из ~130 штрихов — это ~130 проходов размытия по всему холсту: переключение на «Под водой» стоило
 * ~480 мс кадра (Mac) и 3 с на Windows с замедлением ×4; одним проходом — 8–18 мс, картинка та же (в среднем 0,1–0,5
 * уровня из 255, где линии сетки пересекаются).
 */
let seabedLayer = null;
function seabedLayerContext() {
  if (!seabedLayer && typeof document !== "undefined") {
    seabedLayer = document.createElement("canvas");
    seabedLayer.width = WIDTH;
    seabedLayer.height = HEIGHT;
  }
  const context = seabedLayer?.getContext("2d") || null;
  context?.clearRect(0, 0, WIDTH, HEIGHT);
  return context;
}

/* Сколько тумана на расстоянии `d` при видимости `metres` (10 % — на её краю). */
const fogAt = (d, metres) => 1 - Math.exp((-d * Math.log(10)) / Math.max(0.5, metres));

function draw(canvas, look) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const fog = look.fog.map((value) => Math.min(1, value * 2.4));
  const light = look.light.map((value) => Math.min(1, value * 1.1));
  /* Толща: сверху светлее (свет сквозь гладь), к горизонту — туман. */
  const horizon = HEIGHT * 0.42;
  const water = context.createLinearGradient(0, 0, 0, HEIGHT);
  water.addColorStop(0, css(mix(fog, light, 0.55)));
  water.addColorStop(horizon / HEIGHT, css(fog));
  water.addColorStop(1, css(fog.map((value) => value * 0.7)));
  context.filter = "none";
  context.fillStyle = water;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  /* Песок дна: вблизи — своим цветом в свете воды, вдаль тонет в тумане. */
  const sand = mix([0.78, 0.72, 0.58], light, 0.35);
  for (let y = Math.ceil(horizon) + 1; y < HEIGHT; y += 2) {
    const d = (FOCAL * EYE) / (y - horizon);
    context.fillStyle = css(mix(sand, fog, fogAt(d, look.metres)));
    context.fillRect(0, y, WIDTH, 2);
  }

  /* Дно: дальняя половина размывается мутью (размытие игры — дальше 5 м) — на своём слое, одним проходом. */
  const seabed = (from, to, blur) => {
    const layer = blur > 0.05 ? seabedLayerContext() : null;
    const paint = layer || context;
    paint.save();
    paint.filter = "none";
    for (let d = from; d <= to; d += STEP) {
      const y = horizon + (FOCAL * EYE) / d;
      if (y > HEIGHT + 20) continue;
      const amount = fogAt(d, look.metres);
      paint.strokeStyle = css(mix([0.25, 0.22, 0.18], fog, amount), 1 - amount * 0.92);
      paint.lineWidth = Math.max(0.6, 3.2 * (1 - d / FAR));
      paint.beginPath();
      paint.moveTo(0, y);
      paint.lineTo(WIDTH, y);
      paint.stroke();
    }
    for (let x = -60; x <= 60; x += STEP * 2) {
      paint.beginPath();
      let moved = false;
      for (let d = Math.max(1, from); d <= to; d += 1) {
        const y = horizon + (FOCAL * EYE) / d;
        const px = WIDTH / 2 + (FOCAL * x) / d;
        const amount = fogAt(d, look.metres);
        paint.strokeStyle = css(mix([0.25, 0.22, 0.18], fog, amount), 0.75 * (1 - amount * 0.92));
        if (!moved) {
          paint.moveTo(px, y);
          moved = true;
        } else paint.lineTo(px, y);
      }
      paint.lineWidth = 1;
      paint.stroke();
    }
    paint.restore();
    if (layer) {
      context.save();
      context.filter = `blur(${(blur * 3).toFixed(1)}px)`;
      context.drawImage(layer.canvas, 0, 0);
      context.restore();
    }
  };
  seabed(5, FAR, look.blur);
  seabed(1, 5, 0);

  /* Лучи света сквозь гладь — у чистой воды ярче. */
  const rays = context.createLinearGradient(0, 0, 0, horizon);
  rays.addColorStop(0, css(light, 0.22));
  rays.addColorStop(1, css(light, 0));
  context.fillStyle = rays;
  for (let index = 0; index < 7; index += 1) {
    const x = WIDTH * (0.12 + index * 0.13);
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + 40, 0);
    context.lineTo(x + 140, horizon);
    context.lineTo(x + 60, horizon);
    context.closePath();
    context.fill();
  }

  /* Подводная дымка: мягкие пятна в свете воды — у чистой воды почти нет. */
  if (look.mist > 0.01) {
    const veil = mix(fog, light, 0.6);
    for (const [x, y, size] of MIST) {
      const radius = HEIGHT * size;
      const spot = context.createRadialGradient(WIDTH * x, HEIGHT * y, 0, WIDTH * x, HEIGHT * y, radius);
      spot.addColorStop(0, css(veil, 0.16 * look.mist));
      spot.addColorStop(1, css(veil, 0));
      context.fillStyle = spot;
      context.fillRect(WIDTH * x - radius, HEIGHT * y - radius, radius * 2, radius * 2);
    }
  }

  /* Шум и виньетка — как у модификатора. */
  if (look.noise > 0.001) {
    const dots = Math.round(look.noise * 120000);
    context.fillStyle = "rgba(255, 255, 255, 0.08)";
    for (let index = 0; index < dots; index += 1) context.fillRect(Math.random() * WIDTH, Math.random() * HEIGHT, 1.5, 1.5);
  }
  if (look.vignette > 0.01) {
    const vignette = context.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.35, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.95);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, `rgba(0, 0, 0, ${Math.min(0.75, look.vignette * 0.7).toFixed(3)})`);
    context.fillStyle = vignette;
    context.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

export default function WaterUnderView({ project, label }) {
  const canvas = useRef(null);
  const look = underPreview(project);
  const key = JSON.stringify(look);
  useEffect(() => {
    if (canvas.current) draw(canvas.current, JSON.parse(key));
  }, [key]);
  return (
    <div className="model-stage-frame water-under">
      <canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={label}
        data-under-metres={Math.round(look.metres)}
        data-under-sea={Math.round(look.sea)}
        data-under-mist={look.mist}
      />
    </div>
  );
}
