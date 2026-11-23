// Перелёт камеры большой карты: «плавное и экономное приближение и сдвиг»
// (ван Вейк, Нёйс, 2003). Точка пути: центр кадра и его ширина в единицах сцены.

// Постоянные пути: ρ, ρ² и ρ⁴ — произведениями, не степенями.
const K = (() => {
  const rho = 1.42;
  const rhoSq = rho * rho;
  return Object.freeze({ rho, rhoSq, rho4: rhoSq * rhoSq });
})();
// Ниже этого квадрата расстояния центры считаются совпавшими.
const SAME_SPOT = 1e-12;

// Гиперболические функции — своими формулами, один Math.exp на вызов.
const withExp = (x, scale, combine) => combine(Math.exp(scale * x));
const cosh = (x) => withExp(x, 1, (grow) => (grow + 1 / grow) / 2);
const sinh = (x) => withExp(x, 1, (grow) => (grow - 1 / grow) / 2);
const tanh = (x) => withExp(x, 2, (grow) => (grow - 1) / (grow + 1));

// asinh-подобный логарифм: ln(√(b² + 1) − b).
const arcLog = (b) => Math.log(Math.sqrt(b * b + 1) - b);

// Путь, когда центр стоит на месте: меняется только ширина.
const zoomOnly = ([ux0, uy0], [dx, dy], [w0, w1]) => {
  const length = Math.log(w1 / w0) / K.rho;
  const at = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(K.rho * t * length)];
  return { length, at };
};

// Общий путь: камера отъезжает, летит и ложится в цель.
const swoop = ([ux0, uy0], [dx, dy], [w0, w1], gap) => {
  const distance = Math.sqrt(gap);
  const squaresGap = w1 * w1 - w0 * w0;
  const [b0, b1] = [
    [w0, 1],
    [w1, -1],
  ].map(([w, sign]) => (squaresGap + sign * K.rho4 * gap) / (2 * w * K.rhoSq * distance));
  const [r0, r1] = [b0, b1].map(arcLog);
  const length = (r1 - r0) / K.rho;
  const reach = w0 / (K.rhoSq * distance);

  const at = (t) => {
    const phase = K.rho * (t * length) + r0;
    const u = reach * (cosh(r0) * tanh(phase) - sinh(r0));
    return [ux0 + u * dx, uy0 + u * dy, (w0 * cosh(r0)) / cosh(phase)];
  };
  return { length, at };
};

const zoomPath = (from, to) => {
  const [[ux0, uy0, w0], [ux1, uy1, w1]] = [from, to];
  const offset = [ux1 - ux0, uy1 - uy0];
  const gap = offset.reduce((sum, side) => sum + side * side, 0);
  const walk = gap < SAME_SPOT ? zoomOnly : swoop;
  const { length, at } = walk([ux0, uy0], offset, [w0, w1], gap);
  return Object.assign(at, { span: Math.abs(length) });
};

const flightDuration = (path) => Math.max(420, Math.min(1500, path.span * 700));

const ACCELERATE = (t) => 4 * t * t * t;
const DECELERATE = (t) => 1 - (-2 * t + 2) ** 3 / 2;

const easeInOut = (t) => (t < 0.5 ? ACCELERATE : DECELERATE)(t);

export { easeInOut, flightDuration, zoomPath };
