// Проигрывание программы выстрела: какие голоса звучат, когда и как.
// Память узлов (история случайного выбора, прошлый запуск обёртки)
// живёт только внутри одного вызова shotVoices.

export const SHOT_VOICES_VERSION = 1;
export const ECHO_DELAY = 0.35;
export const NO_LPF = 23900;

const DEFAULT_INTERVAL = 0.5;
const MIN_INTERVAL = 0.01;
const MIN_STEP_MS = 1;
const STOP_SLACK = 1e-9;
const MAX_SHOTS = 1000;
const UNIT_RANGE = [0, 1];

// ---------- кривые ----------

const clampUnit = (x) => Math.min(1, Math.max(0, x));
const straight = (t, falling) => (falling ? 1 - t : t);

function polyline(curve, t, falling) {
  const { points } = curve;
  if (!points?.length) return straight(t, falling);
  const range = curve.input ?? UNIT_RANGE;
  const x = range[0] + t * (range[1] - range[0]);
  const first = points[0];
  if (x <= first[0]) return first[1];
  for (let i = 1; i < points.length; i += 1) {
    const right = points[i];
    if (right[0] >= x) {
      const left = points[i - 1];
      if (right[0] === left[0]) return right[1];
      return left[1] + ((x - left[0]) * (right[1] - left[1])) / (right[0] - left[0]);
    }
  }
  return points[points.length - 1][1];
}

// бит 2 во flip — убывающая половина
const equalPower = (curve, t) => ((curve.flip & 2) ? Math.cos((t * Math.PI) / 2) : Math.sin((t * Math.PI) / 2));

const fadingExp = (curve, t) => (curve.scale ? Math.exp(-curve.scale * t) : 1);

const CURVE_SHAPES = new Map([
  [2, polyline],
  [4, polyline],
  [5, equalPower],
  [8, fadingExp],
]);

export function curveValue(curve, x, falling = false) {
  const t = clampUnit(x);
  const shape = curve ? CURVE_SHAPES.get(curve.type) : undefined;
  return shape ? shape(curve, t, falling) : straight(t, falling);
}

// ---------- огибающая ----------

function fadeStart(envelope, stop) {
  const holdEnd = envelope.hold >= 0 ? envelope.attack + envelope.decay + envelope.hold : Infinity;
  return Math.min(holdEnd, stop);
}

// Уровень до затухания; кривые берутся только в той фазе, где нужны.
function levelAt(envelope, m) {
  const { attack, decay, sustain } = envelope;
  if (m < attack) return curveValue(envelope.curves.attack, m / attack);
  if (m < attack + decay) {
    return sustain + (1 - sustain) * curveValue(envelope.curves.decay, (m - attack) / decay, true);
  }
  return sustain;
}

export function envelopeValue(envelope, time, stop = Infinity) {
  const from = fadeStart(envelope, stop);
  if (time < from) return levelAt(envelope, time);
  const level = levelAt(envelope, from);
  const { release } = envelope;
  if (release < 0) return level;
  if (time >= from + release) return 0;
  return level * curveValue(envelope.curves.release, (time - from) / release, true);
}

export function envelopeEnd(envelope, stop = Infinity) {
  if (envelope.release < 0) return Infinity;
  return fadeStart(envelope, stop) + envelope.release;
}

export function gainOf(centibels) {
  return 10 ** (centibels / 2000);
}

// ---------- обход дерева ----------

// Прямой обход без повторов; follow(node) отдаёт детей, в которых идти дальше.
function* walk(nodes, root, follow) {
  const seen = new Set();
  const pending = [root];
  while (pending.length > 0) {
    const name = pending.pop();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const node = nodes[name];
    if (!node) continue;
    yield node;
    pending.push(...[...follow(node)].reverse());
  }
}

const BURST_PASSAGE = new Set(["wrapper", "variables", "if", "math", "transform", "envelope"]);
const NOWHERE = [];

// Переменные (без разброса и флагов) у каждой ветви свои, как при проигрывании:
// блок соседней ветви задержку этой не меняет.
export function burstOf(nodes, root) {
  if (!root) return null;
  const seen = new Set();
  const pending = [{ name: root, vars: new Map() }];
  while (pending.length > 0) {
    const { name, vars } = pending.pop();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const node = nodes[name];
    if (!node) continue;
    if (node.kind === "retrigger") {
      const named = node.delayVariable && vars.has(node.delayVariable);
      const delay = named ? vars.get(node.delayVariable) * 1000 : node.delay;
      return delay ? { delay } : null;
    }
    if (!BURST_PASSAGE.has(node.kind)) continue;
    let inner = vars;
    if (node.kind === "variables") {
      inner = new Map(vars);
      for (const item of node.variables) inner.set(item.name, item.value);
    }
    for (const child of [...node.children].reverse()) pending.push({ name: child, vars: inner });
  }
  return null;
}

function loopCountNames(nodes, root) {
  const names = new Set();
  for (const node of walk(nodes, root, (n) => n.children ?? NOWHERE)) {
    if (node.kind === "retrigger" && node.loopCountVariable) names.add(node.loopCountVariable);
  }
  return names;
}

// ---------- заголовок узла ----------

const eitherSet = (h, step) => h[step.value] || h[step.spread];
const valueGiven = (h, step) => h[step.value] !== undefined;

// Порядок строк — порядок вызовов random.
const HEADER_STEPS = [
  { value: "preDelay", spread: "preDelayVariance", active: eitherSet, apply: (b, v) => ({ time: b.time + Math.max(0, v) / 1000 }) },
  { value: "volume", spread: "volumeVariance", active: eitherSet, apply: (b, v) => ({ gain: b.gain + v }) },
  { value: "pitch", spread: "pitchVariance", active: eitherSet, apply: (b, v) => ({ pitch: b.pitch + v }) },
  { value: "startOffset", spread: "startOffsetVariance", active: eitherSet, apply: (b, v) => ({ offset: b.offset + Math.max(0, v) / 1000 }) },
  { value: "lpfCutoff", spread: "lpfCutoffVariance", active: valueGiven, apply: (b, v) => ({ lpf: Math.max(0, Math.min(b.lpf, v)) }) },
  { value: "hpfCutoff", spread: "hpfCutoffVariance", active: valueGiven, apply: (b, v) => ({ hpf: Math.max(0, b.hpf, v) }) },
];

// ---------- виды узлов ----------

const COMPARISONS = new Map([
  [0, (a, b) => a < b],
  [1, (a, b) => a <= b],
  [2, (a, b) => a > b],
  [3, (a, b) => a >= b],
  [4, (a, b) => a === b],
  [5, (a, b) => a !== b],
]);

const TRANSFORM_TARGETS = new Map([
  [0, (acc, value) => { acc.gain += value * 100; }],
  [1, (acc, value) => { acc.pitch += value; }],
  [7, (acc, value, out) => { if (out.variable) acc.vars.set(out.variable, value); }],
]);

const PLAYERS = new Map([
  ["simple", (show, node, b) => show.sound(node, b)],
  ["multitrack", (show, node, b) => {
    for (const child of node.children) show.play(child, b);
  }],
  ["random", (show, node, b, name) => show.choose(node, b, name)],
  ["envelope", (show, node, b) => show.shape(node, b)],
  ["wrapper", (show, node, b, name) => show.guard(node, b, name)],
  ["retrigger", (show, node, b) => show.burst(node, b)],
  ["variables", (show, node, b) => {
    const vars = new Map(b.vars);
    for (const item of node.variables) {
      const value = show.vary(item.value, item.variance);
      if ((item.flags & 1) && vars.has(item.name)) continue;
      vars.set(item.name, value);
    }
    show.play(node.children[0], { ...b, vars });
  }],
  ["if", (show, node, b) => {
    const left = b.vars.get(node.variable) ?? 0;
    const right = node.rhs ? b.vars.get(node.rhs) ?? 0 : node.value;
    const holds = COMPARISONS.get(node.op)?.(left, right) ?? false;
    show.play(node.children[holds ? 0 : 1], b);
  }],
  ["transform", (show, node, b) => show.transform(node, b)],
  ["math", (show, node, b) => show.play(node.children[0], b)],
]);

class Performance {
  constructor({ nodes, categories, curves, random, openEnded }) {
    this.nodes = nodes;
    this.categories = categories;
    this.curves = curves;
    this.random = random;
    this.openEnded = openEnded;
    this.voices = [];
    this.skipped = [];
    this.history = new Map();
    this.lastRun = new Map();
  }

  vary(value, spread) {
    const base = value ?? 0;
    return spread ? base + (this.random() * 2 - 1) * spread : base;
  }

  stopOf(b) {
    return this.openEnded ? Infinity : b.stop;
  }

  play(name, from) {
    if (!name) return;
    const node = this.nodes[name];
    if (!node) return;
    // Узел уже на пути от корня — петля в дереве: обрывается здесь, а не переполнением стека.
    if (from.path.includes(name)) {
      this.skipped.push({ node: name, kind: node.kind, field: from.field, start: from.time, loop: true });
      return;
    }
    const b = this.enter(name, node, from);
    const player = PLAYERS.get(node.kind);
    if (player) player(this, node, b, name);
    else this.skipped.push({ node: name, kind: node.kind, field: b.field, start: b.time });
  }

  enter(name, node, from) {
    const h = node.h || {};
    const b = { ...from, path: [...from.path, name] };
    for (const step of HEADER_STEPS) {
      if (step.active(h, step)) Object.assign(b, step.apply(b, this.vary(h[step.value], h[step.spread])));
    }
    if (h.pan !== undefined) b.pan = h.pan;
    if (h.category) b.category = h.category;
    const fades = [];
    if (h.attackTime > 0) fades.push({ kind: "in", at: b.time, length: h.attackTime / 1000 });
    const stop = this.stopOf(b);
    if (h.releaseTime > 0 && Number.isFinite(stop)) fades.push({ kind: "out", at: stop, length: h.releaseTime / 1000 });
    if (fades.length > 0) b.fades = [...b.fades, ...fades];
    return b;
  }

  categoryGain(category) {
    if (!category || !this.categories) return 0;
    return this.categories[category] ?? 0;
  }

  sound(node, b) {
    this.voices.push({
      wave: `${node.container}:${node.wave}`,
      field: b.field,
      shot: b.shot,
      part: b.part,
      origin: b.origin,
      path: [...b.path],
      start: b.time,
      offset: b.offset,
      pitch: b.pitch,
      gain: b.gain + this.categoryGain(b.category),
      lpf: b.lpf,
      hpf: b.hpf,
      pan: b.pan,
      stop: this.stopOf(b),
      fades: [...b.fades],
      envelopes: [...b.envelopes],
    });
  }

  choose(node, b, name) {
    const { children, weights } = node;
    let pool = [];
    for (let i = 0; i < children.length; i += 1) {
      if (children[i] && (weights[i] ?? 0) > 0) pool.push(i);
    }
    if (!this.history.has(name)) this.history.set(name, []);
    const memory = this.history.get(name);
    if (pool.length > (node.history || 0)) pool = pool.filter((i) => !memory.includes(i));
    const total = pool.reduce((sum, i) => sum + weights[i], 0);
    if (total === 0) return;
    let rest = this.random() * total;
    // не нашёлся (случай 1, NaN) — последний
    let pick = pool[pool.length - 1];
    for (const i of pool) {
      rest -= weights[i];
      if (rest < 0) {
        pick = i;
        break;
      }
    }
    if (node.history) {
      memory.unshift(pick);
      memory.splice(node.history);
    }
    this.play(children[pick], b);
  }

  lasting(value, spread) {
    return value < 0 ? -1 : Math.max(0, this.vary(value, spread)) / 1000;
  }

  curve(name) {
    return this.curves?.[name] ?? null;
  }

  shape(node, b) {
    const at = b.time;
    const envelope = {
      at,
      stop: this.stopOf(b) - at,
      attack: Math.max(0, this.vary(node.attack, node.attackVariance)) / 1000,
      decay: Math.max(0, this.vary(node.decay, node.decayVariance)) / 1000,
      sustain: clampUnit(this.vary(node.sustain, node.sustainVariance) / 100),
      hold: this.lasting(node.hold, node.holdVariance),
      release: this.lasting(node.release, node.releaseVariance),
      curves: {
        attack: this.curve(node.curves[0]),
        decay: this.curve(node.curves[1]),
        release: this.curve(node.curves[2]),
      },
    };
    let next = b;
    if (node.mode === 0) {
      next = { ...b, envelopes: [...b.envelopes, envelope] };
    } else if (node.mode === 1) {
      const [low, high] = node.range;
      next = { ...b, pitch: b.pitch + 100 * (low + envelope.sustain * (high - low)) };
    }
    this.play(node.children[0], next);
  }

  guard(node, b, name) {
    const last = this.lastRun.get(name);
    if (node.minRepeat > 0 && last !== undefined && b.time - last < node.minRepeat / 1000) return;
    this.lastRun.set(name, b.time);
    this.play(node.children[0], b);
  }

  burst(node, b) {
    const { vars } = b;
    const delay = node.delayVariable && vars.has(node.delayVariable) ? vars.get(node.delayVariable) * 1000 : node.delay;
    const repeats = node.loopCountVariable && vars.has(node.loopCountVariable)
      ? Math.round(vars.get(node.loopCountVariable))
      : node.loopCount;
    const bounded = Number.isFinite(b.stop);
    // без числа повторов очередь идёт до остановки, а без остановки — один раз
    let count = 1;
    if (repeats >= 0) count = repeats + 1;
    else if (bounded) count = Infinity;
    // самая внешняя очередь ветви ставит части и момент нажатия
    const outer = !b.inBurst;
    const shotStop = this.openEnded ? Infinity : b.stop;
    let t = b.time;
    for (let k = 0; k < count && (!bounded || t < b.stop - STOP_SLACK); k += 1) {
      const step = Math.max(MIN_STEP_MS, this.vary(delay, node.delayVariance)) / 1000;
      const marks = outer ? { part: k === 0 ? "first" : "shot", origin: t - b.shift } : {};
      this.play(node.children[k === 0 ? 0 : 1], { ...b, ...marks, time: t, shot: b.shot + k, stop: shotStop, inBurst: true });
      t += step;
    }
    const tailAt = bounded ? b.stop : t;
    const marks = outer ? { part: "tail", origin: tailAt - b.shift } : {};
    this.play(node.children[2], { ...b, ...marks, time: tailAt, stop: Infinity, fades: [], inBurst: true });
  }

  transform(node, b) {
    const acc = { gain: b.gain, pitch: b.pitch, vars: new Map(b.vars) };
    for (const tr of node.transforms) {
      const from = tr.inputRange[0];
      const to = tr.inputRange[1];
      // вход читается из переменных на входе в узел
      const raw = b.vars.has(tr.input) ? b.vars.get(tr.input) : from;
      const x = Math.min(Math.max(raw, from), to);
      const share = from === to ? 0 : (x - from) / (to - from);
      for (const out of tr.outputs) {
        const shaped = out.points.length > 0 ? curveValue({ type: 4, input: [from, to], points: out.points }, share) : share;
        const value = out.range[0] + shaped * (out.range[1] - out.range[0]);
        TRANSFORM_TARGETS.get(out.destination)?.(acc, value, out);
      }
    }
    this.play(node.children[0], { ...b, ...acc });
  }
}

// ---------- выстрел ----------

function fieldPlan({ burstField, suppressed, report, echo, roots }) {
  const plan = [];
  if (burstField) {
    plan.push({ field: burstField, shift: 0 });
    if (!suppressed) plan.push({ field: "FireSound", shift: 0 });
  } else {
    plan.push({ field: suppressed && roots.SuppressedFireSound ? "SuppressedFireSound" : "FireSound", shift: 0 });
  }
  if (report && !suppressed) plan.push({ field: "ReportSound", shift: 0 });
  if (echo) plan.push({ field: suppressed ? "SuppressedEchoSound" : "EchoSound", shift: ECHO_DELAY });
  return plan;
}

function opening(field, shot, time, shift, stop, vars) {
  return {
    field,
    shot,
    part: shot === 0 ? "first" : "shot",
    origin: time - shift,
    shift,
    path: [],
    time,
    offset: 0,
    pitch: 0,
    gain: 0,
    lpf: NO_LPF,
    hpf: 0,
    pan: null,
    category: null,
    stop,
    fades: [],
    envelopes: [],
    vars,
    inBurst: false,
  };
}

// Пули: целая часть вниз, от одной до MAX_SHOTS. Не число — одна, как 0 и null;
// бесконечность — потолок, а не расписание до нехватки памяти.
function bulletCount(shots) {
  const whole = Math.floor(shots);
  return Number.isNaN(whole) ? 1 : Math.min(MAX_SHOTS, Math.max(1, whole));
}

export function shotVoices(program, options = {}) {
  const {
    shots = 1,
    interval,
    suppressed = false,
    report = true,
    echo = true,
    random = Math.random,
    openEnded = false,
  } = options;
  const { roots, nodes, categories, curves, auto } = Object(program);
  const rootOf = roots || {};
  const table = nodes || {};
  const count = bulletCount(shots);

  const autoField = suppressed ? "SuppressedFireSound" : "AutoSound";
  const autoBurst = auto ? burstOf(table, rootOf[autoField]) : null;
  const pace = autoBurst ? autoBurst.delay / 1000 : Math.max(MIN_INTERVAL, Number(interval) || DEFAULT_INTERVAL);

  const show = new Performance({ nodes: table, categories, curves, random, openEnded });
  const plan = fieldPlan({ burstField: autoBurst && autoField, suppressed, report, echo, roots: rootOf });
  for (const { field, shift } of plan) {
    const root = rootOf[field];
    if (!root) continue;
    if (burstOf(table, root)) {
      // одна очередь на все пули; переменным повторов заранее дано «пули − 1»
      const vars = new Map([...loopCountNames(table, root)].map((name) => [name, count - 1]));
      show.play(root, opening(field, 0, shift, shift, shift + count * pace, vars));
    } else {
      for (let n = 0; n < count; n += 1) {
        show.play(root, opening(field, n, shift + n * pace, shift, Infinity, new Map()));
      }
    }
  }

  const length = show.voices.reduce((most, voice) => Math.max(most, voice.start), 0);
  return { voices: show.voices, skipped: show.skipped, interval: pace, length };
}
