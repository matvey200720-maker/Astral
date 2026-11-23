import { useStageLoop } from "./stage-loop.js";
import { ASTRAL_TRACER_SHAPE, tracerShape } from "@modovik/tracer-contract";
import { context2d, layerBitmap, previewRatio, tracerHeadColour } from "./effects-preview.js";
import { useLayoutEffect, useRef } from "react";

// Нарисованное стрельбище для редактора трассеров: ночь, горизонт, три мишени,
// пуля с той же текстурой следа, что уйдёт в игру. Нужно, когда кадра игры нет:
// «пуля обязана лететь при любой погоде» (PhotoRange.jsx, редактор трассеров).
// Подписи «нарисованный» на слое нет: решение владельца 25.10.2026 (CLAUDE.md, «Что показывать нельзя»).
// Кадры по требованию и предел 60 в секунду: стоящая сцена и экран 144 Гц грели ноутбук
// (замер npm run perf, 25.09.2026; docs/3D.md, правило 4), поэтому свой цикл не заводим.

const TAU = Math.PI * 2;
const IDENTITY = [1, 0, 0, 1, 0, 0];
const scaledBy = (k) => [k, 0, 0, k, 0, 0];

// Полёт: единицы — секунды и ширины слоя.
const RANGE = Object.freeze({
  rate: 3.2, // выстрелов в секунду
  speed: 1.35, // ширин слоя в секунду
  lookback: 4, // сколько последних выстрелов просматривается
  vanish: 1.1, // путь, после которого пуля исчезает
  fadeOver: 1.05, // путь, на котором след гаснет совсем
  flashSec: 0.08,
  hitSec: 0.12,
  driftSeed: 97,
  driftFrac: 0.12,
});
// Следы и попадания.
const LOOK = Object.freeze({
  thickMin: 3,
  thickFrac: 0.12,
  thickCurve: 0.7,
  glowBase: 0.4,
  glowGain: 0.35,
  capFrac: 0.42,
  capBase: 0.2,
  capGain: 0.8,
  capCurve: 0.8,
  wide: 3.2,
  halfWide: 1.6,
  hitFrac: 0.07,
});
// Ночь: доли высоты и ширины слоя.
const NIGHT = Object.freeze({
  horizon: 0.72,
  haze: 0.3,
  tall: 0.34,
  aspect: 0.42,
  head: 0.42,
  stripeAt: 0.62,
  stripeSize: 0.06,
  tint: 0.1,
  tintStep: 0.1,
});
const GUN = Object.freeze({
  x: 0.08,
  y: 0.55,
  barrel: 0.028,
  bodyBack: 0.13,
  bodyLength: 0.15,
  mountBack: 0.11,
  mountLength: 0.05,
  mountDrop: 1.6,
  flare: 0.11,
});
const TARGETS = [
  [0.5, 0.72], // x в долях ширины, масштаб
  [0.71, 0.56],
  [0.88, 0.44],
];
const SKY = [
  [0, "#05070d"],
  [0.62, "#0a0f1a"],
  [1, "#05070b"],
];
const HAZE = [
  [0, "rgba(56, 78, 112, 0)"],
  [1, "rgba(56, 78, 112, 0.22)"],
];

// Наибольшие значения шкалы следа берём из контракта; запасные цифры — те, что в описании.
const peakOf = (range, fallback) => {
  const top = Array.isArray(range) ? range[range.length - 1] : range?.max;
  return typeof top === "number" ? top : fallback;
};
const WIDTH_PEAK = peakOf(ASTRAL_TRACER_SHAPE?.width, 0.3);
const LENGTH_PEAK = peakOf(ASTRAL_TRACER_SHAPE?.length, 6);

// Размер слоя в кадре: не число читается как 0, как у layerBitmap.
const dim = (value) => +value || 0;
const atLeast = (floor, value) => Math.max(floor, value);

// Повторяемое «случайное»: зависит только от номера выстрела.
const NOISE_SEED = [12.9898, 43758.5453];
const fractOf = (x) => x - Math.floor(x);
const noise = (n) => {
  const [freq, gain] = NOISE_SEED;
  return fractOf(Math.sin(n * freq) * gain);
};

// Часы времени сцены: на паузе стоят, простой вычитается, чтобы очередь не
// выплюнула разом все пропущенные выстрелы при снятии паузы.
class SceneDial {
  constructor() {
    this.zero = undefined;
    this.seen = false;
    this.lost = 0;
    this.parked = null;
  }

  read(now, paused) {
    if (!this.seen) Object.assign(this, { seen: true, zero: now });
    if (paused) {
      this.parked ??= { at: now };
      return this.parked.at - this.zero - this.lost;
    }
    if (this.parked) {
      this.lost += now - this.parked.at;
      this.parked = null;
    }
    return now - this.zero - this.lost;
  }
}

export function frozenClock() {
  const dial = new SceneDial();
  return (now, paused) => dial.read(now, paused);
}

// Имена в списке операций, которые присваиваются свойству контекста, а не вызываются как метод.
const SETTERS = new Set(["fillStyle", "strokeStyle", "lineWidth", "globalAlpha", "globalCompositeOperation"]);

// Кадр собирается списком операций «метод или свойство, аргументы» и проигрывается на контексте.
function play(g, script) {
  for (const [name, ...args] of script) {
    if (SETTERS.has(name)) g[name] = args[0];
    else g[name](...args);
  }
}

const ramp = (gradient, stops) => {
  stops.forEach(([at, colour]) => gradient.addColorStop(at, colour));
  return gradient;
};
const paintRect = (fill, x, y, w, h) => [
  ["fillStyle", fill],
  ["fillRect", x, y, w, h],
];
const stampDisc = (at, r) => [["beginPath"], ["arc", ...at, r, 0, TAU], ["fill"]];
const glowing = (inner) => [["save"], ["globalCompositeOperation", "lighter"], ...inner, ["restore"]];
// Круг со свечением: вспышка дула и попадание.
const halo = (g, at, r, stops) => {
  const spec = [...at, 0, ...at, r];
  return glowing([["fillStyle", ramp(g.createRadialGradient(...spec), stops)], ...stampDisc(at, r)]);
};

// Неподвижный фон: строится один раз на размер.
function nightScript(g, { w, h, ratio }) {
  const line = h * NIGHT.horizon;
  const band = h * NIGHT.haze;
  const vertical = (from, to, stops) => {
    const axis = [0, from, 0, to];
    return ramp(g.createLinearGradient(...axis), stops);
  };
  const silhouette = ([fx, scale]) => {
    const tall = h * NIGHT.tall * scale;
    const wide = tall * NIGHT.aspect;
    const centre = w * fx;
    const left = centre - wide / 2;
    return [
      ...paintRect(`rgba(148, 163, 184, ${NIGHT.tint + scale * NIGHT.tintStep})`, left, line - tall, wide, tall),
      ...stampDisc([centre, line - tall], wide * NIGHT.head),
      ...paintRect("rgba(9, 12, 18, 0.55)", left, line - tall * NIGHT.stripeAt, wide, tall * NIGHT.stripeSize),
    ];
  };
  return [
    ["setTransform", ...scaledBy(ratio)],
    ...paintRect(vertical(0, h, SKY), 0, 0, w, h),
    ...paintRect(vertical(line - band, line, HAZE), 0, line - band, w, band),
    ...paintRect("#0d1119", 0, line, w, h - line),
    ["strokeStyle", "rgba(148, 163, 184, 0.16)"],
    ["lineWidth", 1],
    ["beginPath"],
    ["moveTo", 0, line + 0.5],
    ["lineTo", w, line + 0.5],
    ["stroke"],
    ...TARGETS.flatMap(silhouette),
  ];
}

// Запасной холст с фоном; null, если у него нет контекста (тогда фон не строится
// и не запоминается, а холст компонента просто очищается).
function nightKeeper() {
  const kept = { canvas: null, key: null };
  return (layer) => {
    const [w, h] = [dim(layer?.width), dim(layer?.height)];
    const bitmap = layerBitmap(layer);
    const key = [w, h, bitmap.ratio].join("|");
    if (key === kept.key) return kept.canvas;
    kept.key = null;
    kept.canvas ??= document.createElement("canvas");
    Object.assign(kept.canvas, { width: bitmap.width, height: bitmap.height });
    const g = context2d(kept.canvas);
    if (!g) return null;
    play(g, nightScript(g, { w, h, ratio: bitmap.ratio }));
    kept.key = key;
    return kept.canvas;
  };
}

// Выстрелы в воздухе от самого нового к старому: номер, возраст, пройденный путь и голова пули.
// Заодно возраст самого свежего выстрела: по нему гаснет вспышка дула.
function flightsAt({ ms, w, h }) {
  const ts = ms / 1000;
  const muzzle = [GUN.x * w, GUN.y * h];
  const speed = RANGE.speed * w; // пикселей в секунду
  const newest = Math.floor(ts * RANGE.rate);
  const air = Array.from({ length: RANGE.lookback }, (_, back) => newest - back)
    .filter((n) => n >= 0)
    .map((n) => {
      const age = ts - n / RANGE.rate;
      const run = age * speed;
      // Дрейф нарастает с путём: в конце полёта по ширине слоя проявлен целиком.
      const drift = (noise(n + RANGE.driftSeed) - 0.5) * h * RANGE.driftFrac;
      return { n, age, run, x: muzzle[0] + run, y: muzzle[1] + drift * (run / w) };
    })
    .filter((shot) => !(shot.run > RANGE.vanish * w));
  return { air, freshAge: ts - newest / RANGE.rate };
}

const trailOps = (texture, shot, k) => {
  const fade = atLeast(0, 1 - shot.run / (RANGE.fadeOver * k.w));
  const reach = Math.min(k.cap, shot.run);
  const [cx, cy] = k.muzzle;
  const { thick } = k;
  return [
    ["save"],
    ["translate", shot.x, shot.y],
    ["rotate", Math.PI / 2 + Math.atan2(shot.y - cy, shot.x - cx)],
    ["globalAlpha", fade * LOOK.glowGain * (LOOK.glowBase + k.glow)],
    ["drawImage", texture, -LOOK.halfWide * thick, 0, LOOK.wide * thick, reach],
    ["globalAlpha", fade],
    ["drawImage", texture, thick * -0.5, 0, thick, reach],
    ["restore"],
  ];
};

const hitOps = (g, shot, k, colour) => {
  const tx = k.w * TARGETS[shot.n % TARGETS.length][0];
  const past = shot.x - tx;
  const span = RANGE.hitSec * (RANGE.speed * k.w);
  if (past < 0 || past > span) return [];
  const radius = LOOK.hitFrac * k.h * (1 - past / span);
  if (!(radius > 0)) return [];
  return halo(g, [tx, shot.y], radius, [
    [0, `${colour}dd`],
    [1, "rgba(0,0,0,0)"],
  ]);
};

const gunOps = (g, k, strength, core) => {
  const [gx, gy] = k.muzzle;
  const barrel = GUN.barrel * k.h;
  const flare = [
    [0, `${core}ee`],
    [0.4, `${core}55`],
    [1, "rgba(0,0,0,0)"],
  ];
  return [
    ...paintRect("rgba(120, 133, 155, 0.5)", gx - GUN.bodyBack * k.h, gy - barrel / 2, GUN.bodyLength * k.h, barrel),
    ...paintRect("rgba(90, 102, 122, 0.55)", gx - GUN.mountBack * k.h, gy + barrel / 2, GUN.mountLength * k.h, barrel * GUN.mountDrop),
    ...(strength > 0 ? halo(g, k.muzzle, GUN.flare * k.h * strength, flare) : []),
  ];
};

function frameOf({ snap, canvas, g }) {
  const night = nightKeeper();
  const whole = () => [canvas.width, canvas.height];
  return (ms) => {
    const { geometry, tracer, chance, texture } = snap.current;
    const [w, h] = [dim(geometry.layer?.width), dim(geometry.layer?.height)];
    const backdrop = night(geometry.layer);
    play(g, [
      ["setTransform", ...IDENTITY],
      backdrop ? ["drawImage", backdrop, 0, 0, ...whole()] : ["clearRect", 0, 0, ...whole()],
      ["setTransform", ...scaledBy(previewRatio())],
    ]);

    // След разбирается до смены режима наложения: на следе null кадр падает раньше неё.
    const shape = tracerShape(tracer);
    const { glow, coreColour } = tracer;
    const colour = tracerHeadColour(tracer);
    const { air, freshAge } = flightsAt({ ms, w, h });
    const k = {
      w,
      h,
      glow,
      muzzle: [GUN.x * w, GUN.y * h],
      thick: atLeast(LOOK.thickMin, LOOK.thickFrac * h * (shape.width / WIDTH_PEAK) ** LOOK.thickCurve),
      cap: LOOK.capFrac * w * (LOOK.capBase + LOOK.capGain * (shape.length / LENGTH_PEAK) ** LOOK.capCurve),
    };
    // След виден у номера, чьё «случайное» меньше большего из 0,02 и шанса.
    const shows = (n) => chance > 0 && atLeast(0.02, chance) > noise(n);
    const trails = texture ? air.filter((s) => shows(s.n)).flatMap((s) => trailOps(texture, s, k)) : [];
    // Попадания рисуются и у невидимых выстрелов, и без текстуры (шанс 0 их не гасит).
    const hits = air.flatMap((s) => hitOps(g, s, k, colour));
    play(g, [
      ["globalCompositeOperation", "lighter"],
      ...trails,
      ...hits,
      ["globalAlpha", 1],
      ["globalCompositeOperation", "source-over"],
      ...gunOps(g, k, 1 - freshAge / RANGE.flashSec, coreColour),
    ]);
    return 0;
  };
}

// Фабрика настроек для useStageLoop: нет холста или контекста — цикла нет.
// Часы свои: на паузе время стоит, и перерисованный кадр выходит ровно тем же.
const settingsFor = (g, canvas, snap) =>
  g ? { clock: frozenClock(), frame: frameOf({ snap, canvas, g }), maxFps: 60 } : null;
const bootRange = (snap) => (canvas) => settingsFor(context2d(canvas), canvas, snap);

// Кадр читает свойства из последней отрисовки, а не из замыкания: цикл не перезапускается.
function useLatest(value) {
  const box = useRef(value);
  useLayoutEffect(() => {
    box.current = value;
  });
  return box;
}

function TracerRange(props) {
  const { geometry, tracer, chance = 1, texture } = props;
  const snap = useLatest({ geometry, tracer, chance, texture });
  const surface = useRef(null);
  // Размер слоя берём из разметки окна, а не из своего наблюдателя: два наблюдателя за одной
  // коробкой дали бы лишний круг перерисовок. Присвоение width/height стирает холст, поэтому
  // сначала разметка, потом просьба о кадре (её делает useStageLoop).
  const { width, height } = layerBitmap(geometry.layer);
  const attrs = { className: "fx-range-canvas", width, height, role: "presentation" };
  useStageLoop(surface, bootRange(snap), []);
  return <canvas ref={surface} {...attrs} />;
}

export default TracerRange;
