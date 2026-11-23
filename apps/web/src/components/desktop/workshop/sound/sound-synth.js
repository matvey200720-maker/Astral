/*
 * Готовые звуки студии — синтез, а не чужие записи.
 *
 * Самые скачиваемые звуки попадания для RP-серверов — «колокольчик из SAMP»,
 * «хедшот из RUST», «дзынь из CS» — это вырезки из чужих игр, и класть их в
 * продукт нельзя. Здесь они собраны заново из того, из чего такие звуки
 * состоят: колокольчик — негармонические обертоны с долгим затуханием, дзынь
 * каски — металлический удар с короткими обертонами, хитмаркер — щелчок
 * узкой полосы шума. Похоже по назначению, своё по звучанию.
 *
 * Синтез детерминированный: шум — от зерна, без Math.random. Тот же рецепт
 * всегда даёт те же сэмплы — иначе один и тот же готовый звук, поставленный
 * дважды, считался бы двумя разными. По той же причине готовый рецепт не
 * переписывают: запись установки помнит его имя, а не сэмплы, и
 * «перенастроенный» колокольчик в игре остался бы прежним при метке «в
 * игре». Новый звук — новый рецепт.
 *
 * Выстрелы-фантазии (лазер, плазма, рельсотрон, 8-бит и остальные — по
 * мотивам того, как стреляют в аркадных и мультяшных шутерах) собраны так,
 * что узнаются по первой десятой доле секунды: у автомата игра играет от
 * выстрела ровно столько, и всё, что звучит позже, в очереди не услышат.
 */

import { seededNoise } from "./sound-fx.js";
import { tr } from "../../../../locales/ui.js";

const RATE = 48000;

/*
 * Шум. `hold` — сколько сэмплов держится одно значение: 1 — обычный шум,
 * больше — грубые ступени, как у звуковых чипов старых приставок.
 */
function noiseBuffer(context, seconds, seed, hold = 1) {
  const length = Math.max(1, Math.round(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const noise = seededNoise(seed);
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    if (index % hold === 0) value = noise();
    data[index] = value;
  }
  return buffer;
}

/* Огибающая: атака по прямой, дальше экспоненциальный спад к тишине. */
function envelope(param, { at = 0, peak = 1, attack = 0.002, decay = 0.2 }) {
  param.setValueAtTime(0.0001, at);
  param.linearRampToValueAtTime(peak, at + attack);
  param.setTargetAtTime(0.0001, at + attack, Math.max(0.001, decay / 4));
}

function tone(context, out, { freq, to = null, sweep = 0.1, wave = "sine", at = 0, peak = 0.5, attack = 0.002, decay = 0.3 }) {
  const osc = context.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + sweep);
  const gain = context.createGain();
  envelope(gain.gain, { at, peak, attack, decay });
  osc.connect(gain);
  gain.connect(out);
  osc.start(at);
  osc.stop(at + attack + decay * 1.6 + 0.05);
}

/*
 * Полоса шума. `to` и `sweep` — полоса едет по частоте (свист воды, взмах
 * хлыста); `hold` — ступенчатый шум старых приставок.
 */
function noise(context, out, { seed = 1, at = 0, peak = 0.4, attack = 0.001, decay = 0.1, filter = "bandpass", freq = 2000, to = null, sweep = 0.1, q = 1, seconds = 1, hold = 1 }) {
  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context, seconds, seed, hold);
  const band = context.createBiquadFilter();
  band.type = filter;
  band.frequency.value = freq;
  if (to) {
    band.frequency.setValueAtTime(freq, at);
    band.frequency.exponentialRampToValueAtTime(to, at + sweep);
  }
  band.Q.value = q;
  const gain = context.createGain();
  envelope(gain.gain, { at, peak, attack, decay });
  source.connect(band);
  band.connect(gain);
  gain.connect(out);
  source.start(at);
}

/* Колокол: обертоны не кратны основному — так звучит металл, а не струна. */
function bell(context, out, { base, at = 0, peak = 0.5, decay = 1.1, partials = [1, 2.76, 5.4, 8.93] }) {
  partials.forEach((ratio, index) =>
    tone(context, out, {
      freq: base * ratio,
      at,
      peak: peak / (1 + index * 0.9),
      decay: decay / (1 + index * 0.55),
      attack: 0.001,
    }),
  );
}

/*
 * Тон с дрожью: частоту качает второй генератор (`rate` раз в секунду на
 * `depth` герц) — луч из старых фильмов про пришельцев, пружина игрушки.
 */
function wobble(context, out, { freq, to = null, sweep = 0.2, wave = "sine", at = 0, peak = 0.4, attack = 0.002, decay = 0.3, rate = 20, depth = 60 }) {
  const osc = context.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + sweep);
  const lfo = context.createOscillator();
  lfo.frequency.value = rate;
  const depthGain = context.createGain();
  depthGain.gain.value = depth;
  lfo.connect(depthGain);
  depthGain.connect(osc.frequency);
  const gain = context.createGain();
  envelope(gain.gain, { at, peak, attack, decay });
  osc.connect(gain);
  gain.connect(out);
  const end = at + attack + decay * 1.6 + 0.05;
  osc.start(at);
  lfo.start(at);
  osc.stop(end);
  lfo.stop(end);
}

/*
 * Треск разряда: короткие вспышки узкого шума в «случайные», но всегда те
 * же моменты и на тех же частотах — от зерна.
 */
function crackle(context, out, { seed, at = 0, span = 0.2, count = 10, peak = 0.35, low = 1800, high = 6500, q = 6 }) {
  const random = seededNoise(seed);
  for (let index = 0; index < count; index += 1) {
    const when = at + ((random() + 1) / 2) * span;
    const freq = low + ((random() + 1) / 2) * (high - low);
    noise(context, out, {
      seed: seed + index + 1,
      at: when,
      peak: peak * (0.6 + 0.4 * ((random() + 1) / 2)),
      decay: 0.012,
      freq,
      q,
      seconds: 0.05,
    });
  }
}

/*
 * Рецепты. `seconds` — сколько длится звук; `section` — для чего он
 * задуман: попадание или выстрел.
 */
export const SYNTH_RECIPES = Object.freeze({
  bell: {
    seconds: 0.9,
    draw: (context, out) => {
      bell(context, out, { base: 1568, peak: 0.55, decay: 0.95 });
      noise(context, out, { seed: 11, peak: 0.12, decay: 0.012, freq: 6000, q: 0.7, seconds: 0.05 });
    },
  },
  "helmet-ding": {
    seconds: 0.45,
    draw: (context, out) => {
      bell(context, out, { base: 2350, peak: 0.45, decay: 0.32, partials: [1, 1.52, 2.33, 3.91] });
      noise(context, out, { seed: 21, peak: 0.35, decay: 0.01, freq: 4200, q: 1.4, seconds: 0.05 });
    },
  },
  headshot: {
    seconds: 0.55,
    draw: (context, out) => {
      tone(context, out, { freq: 150, to: 55, sweep: 0.12, peak: 0.7, decay: 0.16 });
      bell(context, out, { base: 1975, peak: 0.35, decay: 0.42, partials: [1, 2.02, 3.1] });
      noise(context, out, { seed: 31, peak: 0.3, decay: 0.02, freq: 3000, q: 0.9, seconds: 0.06 });
    },
  },
  hitmarker: {
    seconds: 0.12,
    draw: (context, out) => {
      noise(context, out, { seed: 41, peak: 0.6, decay: 0.022, freq: 3400, q: 3.5, seconds: 0.1 });
      tone(context, out, { freq: 1850, peak: 0.25, decay: 0.03, wave: "triangle" });
    },
  },
  glass: {
    seconds: 0.6,
    draw: (context, out) => {
      [3120, 4410, 5870, 7330].forEach((freq, index) =>
        tone(context, out, { freq, at: index * 0.004, peak: 0.22, decay: 0.28 - index * 0.04 }),
      );
      noise(context, out, { seed: 51, peak: 0.25, decay: 0.03, freq: 7000, q: 0.8, seconds: 0.08 });
    },
  },
  coin: {
    seconds: 0.35,
    draw: (context, out) => {
      tone(context, out, { freq: 988, peak: 0.28, decay: 0.07, wave: "square" });
      tone(context, out, { freq: 1319, at: 0.07, peak: 0.28, decay: 0.24, wave: "square" });
    },
  },
  sonar: {
    seconds: 0.9,
    draw: (context, out) => {
      tone(context, out, { freq: 1240, to: 1150, sweep: 0.8, peak: 0.5, decay: 0.75 });
      tone(context, out, { freq: 2480, peak: 0.08, decay: 0.3 });
    },
  },
  gong: {
    seconds: 0.9,
    draw: (context, out) => {
      bell(context, out, { base: 392, peak: 0.6, decay: 0.9, partials: [1, 1.48, 2.21, 2.92, 4.1] });
      noise(context, out, { seed: 61, peak: 0.2, decay: 0.03, filter: "lowpass", freq: 1800, seconds: 0.08 });
    },
  },
  click: {
    seconds: 0.08,
    draw: (context, out) => {
      tone(context, out, { freq: 1100, peak: 0.5, decay: 0.012, wave: "square" });
      noise(context, out, { seed: 71, peak: 0.3, decay: 0.008, freq: 5000, q: 1.2, seconds: 0.03 });
    },
  },
  thud: {
    seconds: 0.35,
    draw: (context, out) => {
      tone(context, out, { freq: 120, to: 48, sweep: 0.18, peak: 0.85, decay: 0.24 });
      noise(context, out, { seed: 81, peak: 0.35, decay: 0.05, filter: "lowpass", freq: 700, seconds: 0.1 });
    },
  },
  slap: {
    seconds: 0.25,
    draw: (context, out) => {
      noise(context, out, { seed: 91, peak: 0.7, decay: 0.05, freq: 1300, q: 0.9, seconds: 0.15 });
      tone(context, out, { freq: 190, to: 90, sweep: 0.06, peak: 0.45, decay: 0.08 });
    },
  },
  crunch: {
    seconds: 0.3,
    draw: (context, out) => {
      for (let index = 0; index < 7; index += 1)
        noise(context, out, {
          seed: 101 + index,
          at: index * 0.017,
          peak: 0.45 - index * 0.04,
          decay: 0.018,
          freq: 1600 + index * 380,
          q: 2.2,
          seconds: 0.05,
        });
      tone(context, out, { freq: 140, to: 70, sweep: 0.05, peak: 0.35, decay: 0.09 });
    },
  },
  pop: {
    seconds: 0.18,
    draw: (context, out) => {
      tone(context, out, { freq: 520, to: 180, sweep: 0.06, peak: 0.7, decay: 0.07 });
    },
  },
  knock: {
    seconds: 0.2,
    draw: (context, out) => {
      tone(context, out, { freq: 820, peak: 0.45, decay: 0.05, wave: "triangle" });
      tone(context, out, { freq: 1480, peak: 0.2, decay: 0.03 });
      noise(context, out, { seed: 121, peak: 0.25, decay: 0.01, freq: 2600, q: 2, seconds: 0.04 });
    },
  },
  "soft-tick": {
    seconds: 0.1,
    draw: (context, out) => {
      noise(context, out, { seed: 131, peak: 0.45, decay: 0.015, freq: 2200, q: 2.8, seconds: 0.06 });
    },
  },
  "deep-boom": {
    seconds: 0.6,
    draw: (context, out) => {
      tone(context, out, { freq: 90, to: 38, sweep: 0.35, peak: 0.9, decay: 0.45 });
      noise(context, out, { seed: 141, peak: 0.3, decay: 0.08, filter: "lowpass", freq: 500, seconds: 0.2 });
    },
  },
  blaster: {
    seconds: 0.45,
    draw: (context, out) => {
      tone(context, out, { freq: 1900, to: 180, sweep: 0.28, peak: 0.5, decay: 0.3, wave: "sawtooth" });
      tone(context, out, { freq: 3800, to: 360, sweep: 0.2, peak: 0.15, decay: 0.2, wave: "square" });
      noise(context, out, { seed: 151, peak: 0.25, decay: 0.05, freq: 2500, q: 0.6, seconds: 0.1 });
    },
  },
  retro: {
    seconds: 0.4,
    draw: (context, out) => {
      /* Шум 8-бит: грубые ступени вместо гладкого шума, как у старых приставок. */
      noise(context, out, { seed: 161, peak: 0.7, decay: 0.22, filter: "lowpass", freq: 2400, q: 0.5, seconds: 0.4 });
      tone(context, out, { freq: 220, to: 60, sweep: 0.2, peak: 0.5, decay: 0.2, wave: "square" });
    },
  },

  /* ── Выстрелы-фантазии ────────────────────────────────────────────── */

  /* Лазер: пила и синус падают с высоты за десятую долю секунды. */
  laser: {
    seconds: 0.34,
    draw: (context, out) => {
      tone(context, out, { freq: 3200, to: 380, sweep: 0.14, wave: "sawtooth", peak: 0.42, decay: 0.2 });
      tone(context, out, { freq: 1650, to: 190, sweep: 0.12, peak: 0.4, decay: 0.2 });
      noise(context, out, { seed: 171, peak: 0.3, decay: 0.008, freq: 5200, q: 0.8, seconds: 0.04 });
    },
  },
  /* Плазма: густой заряд — квадрат вниз, дрожащий синус и глухой толчок. */
  plasma: {
    seconds: 0.5,
    draw: (context, out) => {
      tone(context, out, { freq: 560, to: 90, sweep: 0.25, wave: "square", peak: 0.36, decay: 0.3 });
      wobble(context, out, { freq: 980, to: 280, sweep: 0.3, peak: 0.3, decay: 0.28, rate: 38, depth: 140 });
      noise(context, out, { seed: 181, peak: 0.45, decay: 0.06, filter: "lowpass", freq: 900, seconds: 0.15 });
    },
  },
  /* Рельсотрон: взвизг заряда, хлёсткий щелчок, удар и долгий звон. */
  railgun: {
    seconds: 1.1,
    draw: (context, out) => {
      tone(context, out, { freq: 320, to: 2600, sweep: 0.05, peak: 0.14, decay: 0.05 });
      noise(context, out, { seed: 191, at: 0.045, peak: 0.85, decay: 0.03, freq: 3200, q: 0.6, seconds: 0.1 });
      tone(context, out, { freq: 120, to: 38, sweep: 0.3, at: 0.045, peak: 0.75, decay: 0.4 });
      bell(context, out, { base: 1760, at: 0.05, peak: 0.26, decay: 0.85, partials: [1, 2.4, 3.9] });
    },
  },
  /* Импульс: тройная сухая отсечка и короткий низ, как у импульсных винтовок. */
  pulse: {
    seconds: 0.2,
    draw: (context, out) => {
      [0, 0.032, 0.064].forEach((at, index) =>
        tone(context, out, { freq: 1500 - index * 180, at, wave: "square", peak: 0.34, decay: 0.022 }),
      );
      noise(context, out, { seed: 201, peak: 0.4, decay: 0.02, freq: 2700, q: 1.1, seconds: 0.06 });
      tone(context, out, { freq: 190, to: 85, sweep: 0.06, peak: 0.5, decay: 0.08 });
    },
  },
  /* 8-бит: квадрат вниз и ступенчатый шум звукового чипа. */
  chiptune: {
    seconds: 0.32,
    draw: (context, out) => {
      tone(context, out, { freq: 1900, to: 110, sweep: 0.18, wave: "square", peak: 0.36, decay: 0.2 });
      noise(context, out, { seed: 211, peak: 0.55, decay: 0.1, filter: "lowpass", freq: 3200, q: 0.5, seconds: 0.3, hold: 24 });
    },
  },
  /* Игрушка: щелчок, хлопок пробки и дрожь пружинки. */
  toy: {
    seconds: 0.38,
    draw: (context, out) => {
      noise(context, out, { seed: 221, peak: 0.5, decay: 0.006, freq: 4200, q: 3, seconds: 0.03 });
      tone(context, out, { freq: 950, to: 320, sweep: 0.03, peak: 0.5, decay: 0.04 });
      wobble(context, out, { freq: 540, to: 340, sweep: 0.22, at: 0.02, peak: 0.34, decay: 0.26, rate: 17, depth: 70 });
    },
  },
  /* Тесла: треск разряда поверх гула и свист искры. */
  tesla: {
    seconds: 0.42,
    draw: (context, out) => {
      crackle(context, out, { seed: 231, span: 0.18, count: 12, peak: 0.42 });
      tone(context, out, { freq: 2600, to: 900, sweep: 0.08, peak: 0.25, decay: 0.08 });
      tone(context, out, { freq: 120, wave: "sawtooth", peak: 0.16, decay: 0.24 });
    },
  },
  /* Вода: свист струи вверх и капли. */
  water: {
    seconds: 0.46,
    draw: (context, out) => {
      noise(context, out, { seed: 241, peak: 0.55, attack: 0.01, decay: 0.16, freq: 700, to: 2600, sweep: 0.14, q: 1.8, seconds: 0.35 });
      [0.1, 0.18, 0.26].forEach((at, index) =>
        tone(context, out, { freq: 1100 + index * 260, to: 1900 + index * 300, sweep: 0.03, at, peak: 0.22, decay: 0.035 }),
      );
    },
  },
  /* Пушка: тяжёлый удар, щелчок пороха и рокот. */
  cannon: {
    seconds: 1.2,
    draw: (context, out) => {
      noise(context, out, { seed: 251, peak: 0.5, decay: 0.02, freq: 2000, q: 0.7, seconds: 0.06 });
      tone(context, out, { freq: 72, to: 28, sweep: 0.5, peak: 0.95, decay: 0.75 });
      noise(context, out, { seed: 252, peak: 0.6, decay: 0.24, filter: "lowpass", freq: 620, seconds: 0.6 });
      noise(context, out, { seed: 253, at: 0.06, peak: 0.3, decay: 0.8, filter: "lowpass", freq: 210, seconds: 1.1 });
    },
  },
  /* Гром: треск разряда и раскаты, которые катятся дальше. */
  thunder: {
    seconds: 1.4,
    draw: (context, out) => {
      noise(context, out, { seed: 261, peak: 0.75, decay: 0.04, freq: 3600, q: 0.5, seconds: 0.1 });
      [0.02, 0.22, 0.5, 0.82].forEach((at, index) =>
        noise(context, out, { seed: 262 + index, at, peak: 0.6 - index * 0.12, attack: 0.02, decay: 0.34 + index * 0.06, filter: "lowpass", freq: 520 - index * 70, seconds: 0.6 }),
      );
    },
  },
  /* Арбалет: звон тетивы, стук болта и свист. */
  crossbow: {
    seconds: 0.56,
    draw: (context, out) => {
      noise(context, out, { seed: 271, peak: 0.55, decay: 0.02, freq: 1300, q: 1.2, seconds: 0.05 });
      tone(context, out, { freq: 190, to: 150, sweep: 0.3, wave: "triangle", peak: 0.5, decay: 0.34 });
      tone(context, out, { freq: 570, to: 450, sweep: 0.3, peak: 0.16, decay: 0.2 });
      noise(context, out, { seed: 272, at: 0.02, peak: 0.16, decay: 0.18, freq: 2100, to: 600, sweep: 0.2, q: 1.5, seconds: 0.3 });
    },
  },
  /* Хлопушка: хлопок и искры конфетти. */
  confetti: {
    seconds: 0.8,
    draw: (context, out) => {
      tone(context, out, { freq: 420, to: 120, sweep: 0.04, peak: 0.6, decay: 0.06 });
      noise(context, out, { seed: 281, peak: 0.5, decay: 0.022, freq: 1800, q: 0.8, seconds: 0.06 });
      [2640, 3950, 3140, 5280, 4430, 2960].forEach((freq, index) =>
        tone(context, out, { freq, at: 0.05 + index * 0.06, peak: 0.12, decay: 0.12 }),
      );
    },
  },
  /* Пневматика: мягкий выдох воздуха, щелчок и шипение. */
  airgun: {
    seconds: 0.26,
    draw: (context, out) => {
      noise(context, out, { seed: 291, peak: 0.6, attack: 0.004, decay: 0.07, filter: "lowpass", freq: 1500, seconds: 0.15 });
      tone(context, out, { freq: 2300, wave: "square", peak: 0.18, decay: 0.006 });
      noise(context, out, { seed: 292, peak: 0.16, decay: 0.12, filter: "highpass", freq: 5200, seconds: 0.2 });
    },
  },
  /* Луч пришельцев: дрожащий синус, съезжающий вниз. */
  "space-ray": {
    seconds: 0.62,
    draw: (context, out) => {
      wobble(context, out, { freq: 1500, to: 600, sweep: 0.4, peak: 0.42, decay: 0.45, rate: 24, depth: 180 });
      tone(context, out, { freq: 3000, to: 1200, sweep: 0.2, wave: "triangle", peak: 0.12, decay: 0.2 });
    },
  },
  /* Звуковой удар: щелчок, свист воздуха вверх и упругий низ. */
  sonic: {
    seconds: 0.9,
    draw: (context, out) => {
      noise(context, out, { seed: 301, peak: 0.6, decay: 0.015, freq: 2800, q: 0.7, seconds: 0.05 });
      tone(context, out, { freq: 58, to: 34, sweep: 0.4, peak: 0.85, decay: 0.6 });
      noise(context, out, { seed: 302, peak: 0.32, attack: 0.02, decay: 0.3, freq: 300, to: 3000, sweep: 0.3, q: 1.2, seconds: 0.6 });
    },
  },
  /* Пейнтбол: шлепок шарика и мягкий хлопок. */
  paintball: {
    seconds: 0.2,
    draw: (context, out) => {
      noise(context, out, { seed: 311, peak: 0.5, decay: 0.03, freq: 900, to: 2400, sweep: 0.04, q: 1.4, seconds: 0.08 });
      tone(context, out, { freq: 300, to: 150, sweep: 0.03, peak: 0.42, decay: 0.05 });
    },
  },
  /* Гвоздомёт: пневматический удар и звон гвоздя. */
  nailgun: {
    seconds: 0.32,
    draw: (context, out) => {
      tone(context, out, { freq: 170, to: 90, sweep: 0.04, peak: 0.7, decay: 0.06 });
      noise(context, out, { seed: 321, peak: 0.36, decay: 0.05, filter: "lowpass", freq: 2500, seconds: 0.1 });
      bell(context, out, { base: 3100, at: 0.012, peak: 0.2, decay: 0.2, partials: [1, 2.7] });
    },
  },
  /* Робот: скрежещущий аккорд квадратов, съезжающий вниз. */
  robot: {
    seconds: 0.36,
    draw: (context, out) => {
      [440, 554, 659].forEach((freq) =>
        tone(context, out, { freq, to: freq * 0.78, sweep: 0.2, wave: "square", peak: 0.18, decay: 0.24 }),
      );
      noise(context, out, { seed: 331, peak: 0.4, decay: 0.05, filter: "lowpass", freq: 2600, seconds: 0.12, hold: 16 });
    },
  },

  /* ── Попадания: новые ─────────────────────────────────────────────── */

  /* Щит сломан: стеклянный рассыпчатый звон и падающая нота. */
  "shield-break": {
    seconds: 0.8,
    draw: (context, out) => {
      noise(context, out, { seed: 341, peak: 0.36, decay: 0.08, filter: "highpass", freq: 4200, seconds: 0.2 });
      [3150, 4720, 6180, 3890, 7400, 5360, 8120, 4210].forEach((freq, index) =>
        tone(context, out, { freq, at: index * 0.011, peak: 0.12, decay: 0.3 - index * 0.025 }),
      );
      tone(context, out, { freq: 1760, to: 880, sweep: 0.35, at: 0.05, peak: 0.2, decay: 0.45 });
    },
  },
  /* Крит: две ноты вверх — «попал, и попал сильно». */
  crit: {
    seconds: 0.6,
    draw: (context, out) => {
      noise(context, out, { seed: 351, peak: 0.3, decay: 0.006, freq: 5200, q: 1, seconds: 0.03 });
      bell(context, out, { base: 1319, peak: 0.34, decay: 0.24, partials: [1, 2.01, 3.02] });
      bell(context, out, { base: 1976, at: 0.07, peak: 0.42, decay: 0.45, partials: [1, 2.01, 3.02] });
    },
  },
  /* Бонк: мультяшный деревянный удар по макушке. */
  bonk: {
    seconds: 0.42,
    draw: (context, out) => {
      tone(context, out, { freq: 720, to: 420, sweep: 0.08, wave: "triangle", peak: 0.6, decay: 0.12 });
      tone(context, out, { freq: 1440, to: 840, sweep: 0.08, peak: 0.2, decay: 0.08 });
      wobble(context, out, { freq: 310, at: 0.03, peak: 0.2, decay: 0.26, rate: 21, depth: 45 });
    },
  },
  /* Двойной дзынь: та же нота дважды. */
  "double-ding": {
    seconds: 0.75,
    draw: (context, out) => {
      bell(context, out, { base: 2093, peak: 0.4, decay: 0.3, partials: [1, 2.76, 5.4] });
      bell(context, out, { base: 2093, at: 0.11, peak: 0.44, decay: 0.5, partials: [1, 2.76, 5.4] });
    },
  },
  /* Наковальня: тяжёлый металлический удар с долгим гулом. */
  anvil: {
    seconds: 0.9,
    draw: (context, out) => {
      noise(context, out, { seed: 361, peak: 0.5, decay: 0.01, freq: 3000, q: 1.5, seconds: 0.04 });
      bell(context, out, { base: 880, peak: 0.55, decay: 0.85, partials: [1, 2.32, 4.25, 6.63, 9.38] });
    },
  },
  /* Искры: четыре ноты вверх и мерцание. */
  sparkle: {
    seconds: 0.72,
    draw: (context, out) => {
      [1568, 1976, 2349, 3136].forEach((freq, index) =>
        tone(context, out, { freq, at: index * 0.05, peak: 0.25, decay: 0.3 }),
      );
      noise(context, out, { seed: 371, peak: 0.06, attack: 0.02, decay: 0.3, filter: "highpass", freq: 7000, seconds: 0.5 });
    },
  },
  /* Новый уровень: восьмибитное арпеджио вверх. */
  "level-up": {
    seconds: 0.62,
    draw: (context, out) => {
      [523, 659, 784, 1047].forEach((freq, index) =>
        tone(context, out, { freq, at: index * 0.06, wave: "square", peak: 0.18, decay: index === 3 ? 0.3 : 0.08 }),
      );
    },
  },
  /* Лазерное попадание: короткий падающий «пиу» со щелчком. */
  "laser-hit": {
    seconds: 0.36,
    draw: (context, out) => {
      tone(context, out, { freq: 2800, to: 700, sweep: 0.12, peak: 0.45, decay: 0.2 });
      tone(context, out, { freq: 5600, to: 1400, sweep: 0.1, wave: "square", peak: 0.1, decay: 0.1 });
      noise(context, out, { seed: 381, peak: 0.28, decay: 0.006, freq: 6000, q: 1, seconds: 0.03 });
    },
  },
  /* Щит: тонкий стеклянный отзвук. */
  "shield-hit": {
    seconds: 0.3,
    draw: (context, out) => {
      tone(context, out, { freq: 2620, peak: 0.3, decay: 0.12 });
      tone(context, out, { freq: 3930, peak: 0.12, decay: 0.08 });
      noise(context, out, { seed: 391, peak: 0.22, decay: 0.02, filter: "highpass", freq: 6000, seconds: 0.05 });
    },
  },
  /* Броня: металлический лязг пластины. */
  armor: {
    seconds: 0.3,
    draw: (context, out) => {
      noise(context, out, { seed: 401, peak: 0.45, decay: 0.012, freq: 2400, q: 2, seconds: 0.04 });
      bell(context, out, { base: 1250, peak: 0.35, decay: 0.2, partials: [1, 1.9, 3.3] });
    },
  },
  /* Кулак: глухой толчок и шлепок. */
  punch: {
    seconds: 0.3,
    draw: (context, out) => {
      tone(context, out, { freq: 140, to: 60, sweep: 0.06, peak: 0.8, decay: 0.12 });
      noise(context, out, { seed: 411, peak: 0.55, decay: 0.03, freq: 1600, q: 0.9, seconds: 0.08 });
    },
  },
  /* Блип: короткая высокая точка. */
  blip: {
    seconds: 0.12,
    draw: (context, out) => {
      tone(context, out, { freq: 1760, peak: 0.45, decay: 0.05 });
      tone(context, out, { freq: 3520, peak: 0.1, decay: 0.03 });
    },
  },
  /* Разряд: короткий треск тока. */
  zap: {
    seconds: 0.26,
    draw: (context, out) => {
      crackle(context, out, { seed: 421, span: 0.09, count: 6, peak: 0.45 });
      tone(context, out, { freq: 180, wave: "sawtooth", peak: 0.12, decay: 0.08 });
    },
  },
  /* Пузырь: две капли вверх. */
  bubble: {
    seconds: 0.26,
    draw: (context, out) => {
      tone(context, out, { freq: 300, to: 900, sweep: 0.08, peak: 0.45, decay: 0.12 });
      tone(context, out, { freq: 420, to: 1150, sweep: 0.07, at: 0.06, peak: 0.3, decay: 0.1 });
    },
  },
  /* 8-бит попадание: квадрат вниз и ступенчатый шум. */
  "chip-hit": {
    seconds: 0.2,
    draw: (context, out) => {
      tone(context, out, { freq: 880, to: 220, sweep: 0.08, wave: "square", peak: 0.35, decay: 0.1 });
      noise(context, out, { seed: 431, peak: 0.3, decay: 0.04, filter: "lowpass", freq: 3000, seconds: 0.1, hold: 20 });
    },
  },
  /* Хлыст: взмах и щелчок на конце. */
  whip: {
    seconds: 0.36,
    draw: (context, out) => {
      noise(context, out, { seed: 441, peak: 0.34, attack: 0.03, decay: 0.1, freq: 600, to: 5000, sweep: 0.12, q: 1.4, seconds: 0.2 });
      noise(context, out, { seed: 442, at: 0.12, peak: 0.8, decay: 0.01, freq: 3500, q: 0.8, seconds: 0.04 });
    },
  },
  /*
   * Звуки тела «для боя» (28.09.2026). Запись звука игры показала: удар по
   * телу игра играет в эхо выстрела, у живых — ещё и в крик боли, и шумный
   * или короткий звук в нём тонет (`@modovik/sound-studio/hit-masking`).
   * Эти собраны так, чтобы пробиваться: чистые тона выше крика и дольше
   * 20 мс, у «удара со звоном» — ещё и низ ниже крика. Ниже звона головы по
   * высоте — голову и тело не спутать.
   */
  "body-ring": {
    seconds: 0.36,
    draw: (context, out) => {
      bell(context, out, { base: 3951, peak: 0.5, decay: 0.3, partials: [1, 1.51] });
      noise(context, out, { seed: 451, peak: 0.25, decay: 0.012, freq: 4800, q: 1, seconds: 0.04 });
    },
  },
  "thump-ring": {
    seconds: 0.4,
    draw: (context, out) => {
      tone(context, out, { freq: 110, to: 50, sweep: 0.12, peak: 0.5, decay: 0.16 });
      bell(context, out, { base: 4186, peak: 0.6, decay: 0.3, partials: [1, 1.5] });
    },
  },
  "double-tick": {
    seconds: 0.24,
    draw: (context, out) => {
      for (const [index, at] of [0, 0.07].entries()) {
        tone(context, out, { freq: 3520, at, peak: 0.42, decay: 0.06 });
        tone(context, out, { freq: 5280, at, peak: 0.12, decay: 0.04 });
        noise(context, out, { seed: 461 + index, at, peak: 0.28, decay: 0.01, freq: 6000, q: 1.2, seconds: 0.03 });
      }
    },
  },
  "hit-chime": {
    seconds: 0.45,
    draw: (context, out) => {
      tone(context, out, { freq: 1760, peak: 0.36, decay: 0.3 });
      tone(context, out, { freq: 2637, at: 0.035, peak: 0.3, decay: 0.28 });
      tone(context, out, { freq: 5274, peak: 0.08, decay: 0.12 });
    },
  },
});

export const SYNTH_RECIPE_IDS = Object.freeze(Object.keys(SYNTH_RECIPES));

const rendered = new Map();

/**
 * Звук рецепта — AudioBuffer 48 кГц моно. Один рендер на рецепт за сессию
 * окна: рецепты неизменны.
 */
export function synthesize(recipeId) {
  const recipe = SYNTH_RECIPES[recipeId];
  if (!recipe) return Promise.reject(new Error(tr("Нет такого готового звука: {id}.").replace("{id}", recipeId)));
  if (rendered.has(recipeId)) return rendered.get(recipeId);
  const OfflineContext =
    globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OfflineContext)
    return Promise.reject(new Error(tr("Браузер не поддерживает синтез звука.")));
  const context = new OfflineContext(1, Math.round(RATE * recipe.seconds), RATE);
  const master = context.createGain();
  master.gain.value = 1;
  master.connect(context.destination);
  recipe.draw(context, master);
  const task = context.startRendering().catch((error) => {
    rendered.delete(recipeId);
    throw error;
  });
  rendered.set(recipeId, task);
  return task;
}
