// Живой ввод кисти большой карты. Все настройки выводятся из одного числа
// «Сглаживание» (проценты): допуск подгонки кривых, фильтр дрожи «1€» и
// длина догона по отпусканию.

const MIDDLE = 0.5;
const EIGHTH_TURN = Math.PI / 4;
const DROP = "l0.01 0";
const AXES = Object.freeze(["x", "y"]);

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Процент -> доля 0…1. Приведение: Number(x) || 0, затем зажим в отрезок.
const smoothingShare = (percent) => {
  const raw = (Number(percent) || 0) / 100;
  if (raw <= 0) return 0;
  return raw >= 1 ? 1 : raw;
};

// Ползунок делится на две ветви: слабая рука (до середины) и «железная».
const FIT_BRANCHES = [
  { ends: MIDDLE, base: 0.6, rate: 2, origin: 0 },
  { ends: Infinity, base: 1.6, rate: 4.8, origin: MIDDLE },
];

const TUNING_BRANCHES = [
  { ends: MIDDLE, cutoff: [5, 0.16], beta: [0.12, 0.1], phase: (share) => share },
  {
    ends: Infinity,
    cutoff: [2, 0.015],
    beta: [0.038, 0.0005],
    phase: (share) => (share - MIDDLE) * 2,
  },
];

const branchFor = (branches, share) => branches.find(({ ends }) => share <= ends);

const strokeFitPixels = (smoothing = 50) => {
  const share = smoothingShare(smoothing);
  const { base, rate, origin } = branchFor(FIT_BRANCHES, share);
  return base + rate * (share - origin);
};

const smootherTuning = (smoothing = 50) => {
  const share = smoothingShare(smoothing);
  const { cutoff, beta, phase } = branchFor(TUNING_BRANCHES, share);
  const x = phase(share);
  const curve = ([scale, rate]) => scale * rate ** x;
  return { minCutoff: curve(cutoff), beta: curve(beta) };
};

const CATCH_UP = Object.freeze({ settle: 5, fps: 60, floor: 150, ceiling: 2400 });

const catchUpFrames = (smoothing = 50) => {
  const { minCutoff } = smootherTuning(smoothing);
  const seconds = CATCH_UP.settle / (2 * Math.PI * minCutoff);
  return clamp(Math.ceil(CATCH_UP.fps * seconds), CATCH_UP.floor, CATCH_UP.ceiling);
};

// Точка на луче из origin под углом angle на расстоянии length.
const along = (origin, angle, length) => ({
  x: origin.x + Math.cos(angle) * length,
  y: origin.y + Math.sin(angle) * length,
});

const snapStraightEnd = (start, end) => {
  const delta = { x: end.x - start.x, y: end.y - start.y };
  const length = Math.hypot(delta.x, delta.y);
  if (!length) return end;
  const steps = Math.round(Math.atan2(delta.y, delta.x) / EIGHTH_TURN);
  return along(start, steps * EIGHTH_TURN, length);
};

// Коэффициент экспоненциального сглаживания для частоты среза и шага времени.
const blendFactor = (cutoff, dt) => {
  const rate = 2 * Math.PI * cutoff * dt;
  return 1 / (1 + 1 / rate);
};

// След руки: сырая точка, сглаженная точка, скорости и время последнего шага.
class Track {
  constructor(fields) {
    Object.assign(this, fields);
  }

  static start(point, at) {
    return new Track({ raw: point, x: point.x, y: point.y, vx: 0, vy: 0, at });
  }

  // Один шаг фильтра: скорость по сырым точкам, доля по скорости, сдвиг к новой точке.
  follow(point, time, { minCutoff, beta }) {
    const dt = clamp((time - this.at) / 1000, 0.001, 0.1);
    const lift = blendFactor(1, dt);
    const [vx, vy] = AXES.map((axis) => {
      const speed = this[`v${axis}`];
      return speed + lift * ((point[axis] - this.raw[axis]) / dt - speed);
    });
    const gain = blendFactor(minCutoff + beta * Math.hypot(vx, vy), dt);
    const [x, y] = AXES.map((axis) => this[axis] + gain * (point[axis] - this[axis]));
    return new Track({ raw: point, x, y, vx, vy, at: time });
  }

  canFollow(time) {
    return Number.isFinite(time) && Number.isFinite(this.at);
  }
}

const copyOf = ({ x, y }) => ({ x, y });

const createPointerSmoother = (smoothing = 50) => {
  if (smoothingShare(smoothing) <= 0) return (point) => copyOf(point);
  const tuning = smootherTuning(smoothing);
  let track = null;

  return (point, time) => {
    track = track?.canFollow(time) ? track.follow(point, time, tuning) : Track.start(point, time);
    return copyOf(track);
  };
};

const coords = (...pair) => pair.map((value) => Math.round(value * 1000) / 1000).join(" ");
const halfway = (a, b) => coords((a.x + b.x) / 2, (a.y + b.y) / 2);

// Что дописывается в готовую часть: первая точка, вторая, все остальные.
const SEGMENT_BY_ORDER = [
  (_before, point) => `M${coords(point.x, point.y)}`,
  (before, point) => `L${halfway(before, point)}`,
  (before, point) => `Q${coords(before.x, before.y)} ${halfway(before, point)}`,
];

// Путь мазка строкой: готовая часть копится, заново строится только хвост.
const createLivePath = () => {
  const trail = { done: "", before: null, count: 0 };
  return {
    add: (point) => {
      const segment = SEGMENT_BY_ORDER[Math.min(trail.count, 2)](trail.before, point);
      trail.done += segment;
      const tail = trail.count === 0 ? DROP : `L${coords(point.x, point.y)}`;
      Object.assign(trail, { count: trail.count + 1, before: point });
      return trail.done + tail;
    },
  };
};

export {
  catchUpFrames,
  createLivePath,
  createPointerSmoother,
  smootherTuning,
  snapStraightEnd,
  strokeFitPixels,
};
