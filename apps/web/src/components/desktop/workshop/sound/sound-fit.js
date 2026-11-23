/*
 * Свой звук длиннее нужного (задача 6 ТЗ 10.10.2026, вечер).
 *
 * Владелец: «чтобы человек, когда грузит свой звук больше нужного времени,
 * получал предложение — зациклить, ускорить, замедлить, сменить бас и
 * другой инструментал». Здесь всё, что для этого считается без окна и без
 * Web Audio: сколько звука ждёт каждое место игры, что с лишним сделает
 * игра, какая скорость уложит звук в место, с какого места резать, где шов
 * петли без щелчка и как сама петля сшивается. Окно (`SoundFitDialog`)
 * показывает и слушает, `sound-fx.js` рендерит — оба берут числа отсюда.
 *
 * СКОЛЬКО НУЖНО МЕСТУ (по игре, Legacy):
 *
 *   • выстрел ствола — длины дорожек его голоса (`weapon-voices.js`): у
 *     автоматов выстрел очереди от 0,08 с (Микро-ПП) до 0,22 с (боевой
 *     пулемёт), хвост после очереди до 0,82 с, у полуавтоматов 0,6–1,64 с.
 *     Длиннее дорожки игра не сыграет: окно режет по ней, главный процесс
 *     более длинную не примет;
 *   • попадание (голова, тело) — сколько вмещает банк collision по чистой
 *     основе (~0,88 с, `readHitSoundBudget`); лишнее режется;
 *   • дорожка прежней студии — длина звука игры. Постоянные банки RESIDENT
 *     (сирены, окружение, погода, двери, взрывы, интерфейс, шаги, удары) и
 *     потоковые банки окружения занимают свой слот памяти игры впритык:
 *     длиннее звука игры свой звук не поместится (проба на живой игре
 *     11.10.2026: сирена на 0,3 с длиннее — «Звуки не помещаются в банк
 *     vehicles.awc»), и студия режет по месту (`capFrames`). Банки стволов,
 *     боли и моторов — в общих слотах с запасом (у lmg_combat — 328 КБ, ~5 с
 *     при 32 кГц): там длиннее звука игры сыграет целиком, до запаса и не
 *     больше 30 с. Петли (LoopPoint ≥ 0 — у 170 из 553 дорожек банка машин)
 *     игра крутит по кругу: свой звук там повторяется так же, и шов надо
 *     сгладить;
 *   • музыка загрузки и меню — до 10 минут; песня радио — ровно её длина:
 *     длиннее обрежется, короче — тишина или повтор.
 */

import { FX_LIMITS } from "@modovik/sound-studio/sound-knobs";
import { weaponVoiceSeconds } from "@modovik/sound-studio";
import { tr } from "../../../../locales/ui.js";
import { soundDecimal } from "./sound-copy.js";

const seconds = (value) =>
  tr("{value} с").replace(
    "{value}",
    soundDecimal((Math.round(value * 100) / 100).toFixed(2)),
  );

/* Насколько звук может быть длиннее места, чтобы не беспокоить человека:
   три сотых — щелчок сверх выстрела не слышен, десятая доля — у длинных. */
const LONG_SLACK = 0.03;
const LONG_SHARE = 0.1;

/**
 * @typedef {object} SoundNeed
 * @property {number} seconds сколько звука ждёт место (0 — сколько угодно
 *   до предела)
 * @property {number} limit больше этого звук в игру не уйдёт (0 — без
 *   предела)
 * @property {"cut"|"plays"|"exact"|"refuse"} over что с лишним: режется
 *   (длиной дорожки ствола или местом банка в памяти игры), играет целиком
 *   дольше задуманного, держит ровно длину (радио) или звук не принимается
 * @property {boolean} loops игра крутит звук по кругу
 * @property {string} what что это за место — словами
 * @property {string} why одна фраза: откуда число и что будет с лишним
 */

/** Выстрел ствола: дорожки голоса в своих длинах. */
export function weaponNeed(weapon) {
  const shot = weaponVoiceSeconds(weapon, "shot");
  const tail = weaponVoiceSeconds(weapon, "tail");
  const longest = (weapon?.voice || []).reduce(
    (most, wave) =>
      wave.sampleRate ? Math.max(most, wave.samples / wave.sampleRate) : most,
    0,
  );
  const title = weapon?.title || tr("ствол");
  return {
    seconds: shot,
    limit: longest || shot,
    over: "cut",
    loops: false,
    what: weapon?.auto
      ? tr("выстрел «{title}» в очереди").replace("{title}", title)
      : tr("выстрел «{title}»").replace("{title}", title),
    why:
      weapon?.auto && tail
        ? tr("В очереди каждый выстрел звучит {shot}, после очереди — хвост до {tail}: длиннее игра не сыграет, лишнее обрежется.")
            .replace("{shot}", seconds(shot))
            .replace("{tail}", seconds(tail))
        : tr("Выстрел в игре звучит {shot}: длиннее игра не сыграет, лишнее обрежется.").replace("{shot}", seconds(shot)),
  };
}

const PART_WHAT = Object.freeze({
  head: "попадание в голову",
  body: "попадание в тело",
});

/** Попадание: бюджет дорожки банка collision. */
export function hitNeed(budget, part) {
  const limit = Number(budget?.maxSeconds) || 0.9;
  return {
    seconds: limit,
    limit,
    over: "cut",
    loops: false,
    what: tr(PART_WHAT[part] || "попадание"),
    why: tr("Банк попаданий игры вмещает {limit}: лишнее обрежется.").replace("{limit}", seconds(limit)),
  };
}

/**
 * Сколько сэмплов дорожки примет её банк: длина звука игры и запас слота
 * памяти (`bank.budget` от главного процесса), поделённый на `shares`
 * заменяемых дорожек, — по данным (PCM — 2 байта на сэмпл, ADPCM — полбайта)
 * и по пикам служебных чанков (2 байта на каждые 4096 сэмплов после первых
 * 4096). У постоянных банков RESIDENT запаса нет: ровно длина звука игры.
 * `null` — запас неизвестен (музыка, прежняя опись).
 */
export function capFrames(budget, stream, shares = 1) {
  const samples = Number(stream?.samples) || 0;
  if (!budget || !samples) return null;
  const parts = Math.max(1, shares);
  const perSample = String(stream.codec || "").toUpperCase() === "ADPCM" ? 0.5 : 2;
  const byBytes = Math.floor(budget.bytes / parts / perSample);
  const toBoundary =
    samples >= 8192 ? 4095 - ((samples - 4096) % 4096) : Math.max(0, 8191 - samples);
  const byPeaks = toBoundary + Math.floor(budget.metadata / (2 * parts)) * 4096;
  return samples + Math.max(0, Math.min(byBytes, byPeaks));
}

/**
 * На сколько секунд свой звук цели может быть длиннее звука игры — по
 * запасу слота её банка; варианты слоя делят запас поровну. `null` — запас
 * неизвестен.
 */
export function targetGrowth(target) {
  const streams = target?.streams || [];
  const rate =
    Number(target?.sampleRate) || Number(streams[0]?.sampleRate) || 0;
  if (!target?.bank?.budget || !streams.length || !rate) return null;
  const growth = Math.min(
    ...streams.map(
      (stream) =>
        (capFrames(target.bank.budget, stream, streams.length) ?? 0) -
        (Number(stream.samples) || 0),
    ),
  );
  return Math.max(0, growth) / rate;
}

/**
 * Цель прежней студии: дорожка, слой ствола или банк целиком.
 *
 * @param {object} target цель `sound-targets.js`
 * @param {{loopPoint?: number|null, limit: number}} options `loopPoint` —
 *   петля дорожки игры (−1 разовая, `null` — не прочитана), `limit` — сколько
 *   секунд примет дорожка (`targetMaxSeconds`)
 */
export function targetNeed(target, { loopPoint = null, limit = 30 } = {}) {
  if (target?.kind === "bank") {
    if (target.bank?.fixedLength)
      return {
        seconds: target.seconds,
        limit: target.seconds,
        over: "exact",
        loops: false,
        what: tr("песня «{title}»").replace("{title}", target.title),
        why: tr("Трек занимает место песни и держит её длину — {seconds}: длиннее обрежется, короче — тишина или повтор.").replace("{seconds}", seconds(target.seconds)),
      };
    return {
      seconds: 0,
      limit,
      over: "refuse",
      loops: false,
      what: target?.title ? tr("музыка «{title}»").replace("{title}", target.title) : tr("музыка"),
      why: tr("Музыка ставится целиком — до {minutes} минут.").replace("{minutes}", Math.round(limit / 60)),
    };
  }
  const loops = Number.isInteger(loopPoint) && loopPoint >= 0;
  const length = Number(target?.seconds) || 0;
  /* Банк в памяти игры не растёт сверх своего слота: у постоянных банков
     RESIDENT — ни на сэмпл (задача 6, проба на живой игре: сирена на
     0,3 с длиннее — «Звуки не помещаются в банк vehicles.awc»). */
  const growth = targetGrowth(target);
  const cap = growth === null ? limit : Math.min(limit, length + growth);
  const grows = growth === null || cap > length + 0.01;
  return {
    seconds: length,
    limit: cap,
    /* Сверх места банка студия режет сама (`capFrames` в рендере): лучше
       обрезанный звук, чем отказ установки. */
    over: grows ? "plays" : "cut",
    loops,
    what: target?.title ? `«${target.title}»` : tr("звук игры"),
    why: [
      loops
        ? tr("Игра крутит этот звук по кругу — в ней он длится {seconds}. Ваш тоже будет повторяться: шов петли лучше сгладить.").replace("{seconds}", seconds(length))
        : tr("В игре этот звук длится {seconds}.").replace("{seconds}", seconds(length)),
      !grows
        ? tr("Его банк занимает свой слот памяти игры впритык: длиннее свой звук не поместится — лишнее обрежется.")
        : growth !== null
          ? tr("Ваш сыграет целиком, но места в банке — до {seconds}: дальше звук обрежется.").replace("{seconds}", seconds(cap))
          : loops
            ? ""
            : tr("Ваш сыграет целиком, до {cap} с, — но дольше, чем задумано в игре.").replace("{cap}", cap),
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * Длинный ли звук для места: `fits` — в порядке, `long` — длиннее нужного,
 * `over` — больше предела (в игру так не уйдёт), `short` — короче ровной
 * длины радио.
 */
export function fitVerdict(length, need) {
  if (!need || !(length > 0)) return "fits";
  /* Больше предела — только там, где лишнее не режется само: дорожку
     длиннее 30 с и музыку длиннее 10 минут игра не примет. */
  const refuses = need.over === "plays" || need.over === "refuse";
  if (refuses && need.limit > 0 && length > need.limit + 1e-3) return "over";
  /* Петлю длиннее места не режут: срез ломает шов, а игра крутит её
     целиком. */
  if (need.loops && need.limit > 0 && length > need.limit + 1e-3) return "over";
  if (
    need.seconds > 0 &&
    length - need.seconds > Math.max(LONG_SLACK, need.seconds * LONG_SHARE)
  )
    return "long";
  if (need.over === "exact" && need.seconds - length > 0.5) return "short";
  return "fits";
}

/** Отрезок файла по ручкам обрезки, секунд исходника. */
export function trimmedSeconds(duration, fx) {
  const start = Math.min(Math.max(0, fx?.trimStart || 0), duration);
  const end =
    fx?.trimEnd > start ? Math.min(fx.trimEnd, duration) : duration;
  return Math.max(0, end - start);
}

/**
 * Петля: сколько материала взять сверх отрезка (для шва) и какой длины
 * выйдет петля — одно правило у рендера и у окна. Шов кроссфейдом берёт
 * `fade` секунд из-за конца отрезка; если за концом файла их нет, петля
 * становится на шов короче.
 */
export function loopPlan(duration, fx) {
  const speed = fx?.speed > 0 ? fx.speed : 1;
  const clip = trimmedSeconds(duration, fx);
  const start = Math.min(Math.max(0, fx?.trimStart || 0), duration);
  const fade = Math.min(
    Math.max(0, (fx?.loopFade ?? 60) / 1000),
    clip / speed / 2,
  );
  const extra = fx?.reverse
    ? 0
    : Math.min(fade * speed, Math.max(0, duration - (start + clip)));
  const body = (clip + extra) / speed;
  return { clip, extra, fade, body, length: Math.max(0, body - fade) };
}

/**
 * Сколько звучит результат (секунд), до того как игра что-то отрежет:
 * отрезок, скорость, у петли — без шва.
 */
export function fittedSeconds(duration, fx) {
  if (fx?.loop) return loopPlan(duration, fx).length;
  const speed = fx?.speed > 0 ? fx.speed : 1;
  return trimmedSeconds(duration, fx) / speed;
}

/** Скорость, которая уложит отрезок в нужную длину, — в границах ручки. */
export function speedToFit(length, needSeconds) {
  if (!(length > 0) || !(needSeconds > 0)) return 1;
  const { min, max } = FX_LIMITS.speed;
  return Math.min(max, Math.max(min, Math.round((length / needSeconds) * 100) / 100));
}

/* Каналы буфера (AudioBuffer или его подобие из тестов). */
function channelsOf(buffer) {
  const count = Math.max(1, buffer?.numberOfChannels || 1);
  return Array.from({ length: count }, (_, index) => buffer.getChannelData(index));
}

function monoOf(buffer) {
  const channels = channelsOf(buffer);
  const length = channels[0]?.length || 0;
  if (channels.length === 1) return channels[0];
  const mono = new Float32Array(length);
  for (const data of channels)
    for (let index = 0; index < length; index += 1) mono[index] += data[index];
  return mono;
}

/**
 * С какого места резать кусок длины `span`: перед самым сильным ударом.
 *
 * Выстрел и удар узнаются по атаке, а не по громкости окна: у записи «очередь
 * из пяти выстрелов» самое громкое окно — середина очереди, а нужна атака
 * первого выстрела. Кандидаты — восемь самых крутых подъёмов огибающей (5 мс);
 * у каждого считается энергия окна от него, побеждает самое громкое окно,
 * при равенстве — раннее. Запас перед атакой — один шаг огибающей.
 *
 * @returns {number} начало куска, секунд
 */
export function loudestStart(buffer, span, { hop = 0.005 } = {}) {
  const rate = buffer?.sampleRate || 0;
  const mono = buffer ? monoOf(buffer) : null;
  const length = mono?.length || 0;
  if (!rate || !length) return 0;
  const step = Math.max(1, Math.round(rate * hop));
  const count = Math.ceil(length / step);
  const energy = new Float64Array(count);
  for (let frame = 0; frame < count; frame += 1) {
    let sum = 0;
    const to = Math.min(length, (frame + 1) * step);
    for (let index = frame * step; index < to; index += 1)
      sum += mono[index] * mono[index];
    energy[frame] = sum;
  }
  const prefix = new Float64Array(count + 1);
  for (let frame = 0; frame < count; frame += 1)
    prefix[frame + 1] = prefix[frame] + energy[frame];
  const spanFrames = Math.max(1, Math.round((span * rate) / step));
  const lastStart = Math.max(0, count - spanFrames);
  const windowEnergy = (frame) =>
    prefix[Math.min(count, frame + spanFrames)] - prefix[frame];
  const rises = [];
  for (let frame = 0; frame < count; frame += 1) {
    const rise = energy[frame] - (frame ? energy[frame - 1] : 0);
    if (rise > 0) rises.push([rise, frame]);
  }
  rises.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const candidates = rises.slice(0, 8).map(([, frame]) => {
    const start = Math.min(lastStart, Math.max(0, frame - 1));
    return { start, score: windowEnergy(start) };
  });
  /* Из почти одинаковых ударов (в пределах 1 дБ от самого громкого) — первый:
     у очереди записанных выстрелов громче всех случайно оказывается любой. */
  const loudest = candidates.reduce((most, item) => Math.max(most, item.score), 0);
  const best = candidates
    .filter((item) => item.score >= loudest * 0.79)
    .reduce((first, item) => (first === null || item.start < first ? item.start : first), null);
  return Math.round((((best ?? 0) * step) / rate) * 1000) / 1000;
}

/**
 * Шов петли без щелчка: где кончить петлю, начатую в `start`, чтобы звук
 * за её концом был похож на звук за её началом — тогда переход «конец →
 * начало» почти незаметен, а короткий кроссфейд (`sewLoop`) убирает
 * остаток. Ищется в пределах ±`search` длины петли (не дальше полсекунды)
 * от `end` по нормированной корреляции окна в `window` секунд: грубо — с
 * шагом в четверть миллисекунды, потом по сэмплу.
 *
 * `maxEnd` — дальше этого петля не растёт: банк, у которого нет места в
 * памяти игры, длиннее звука игры не примет.
 *
 * @returns {{end: number, score: number}} конец петли, секунд, и сходство
 *   шва (1 — тот же звук)
 */
export function findLoopEnd(
  buffer,
  { start = 0, end, maxEnd = Infinity, search = 0.25, window = 0.03 } = {},
) {
  const rate = buffer?.sampleRate || 0;
  const mono = buffer ? monoOf(buffer) : null;
  const length = mono?.length || 0;
  const from = Math.max(0, Math.round(start * rate));
  const ceiling = Number.isFinite(maxEnd) ? Math.floor(maxEnd * rate) : Infinity;
  const wanted = Math.min(Math.round((end ?? length / Math.max(1, rate)) * rate), ceiling);
  if (!rate || !length || wanted - from < 8) return { end: wanted / (rate || 1), score: 0 };
  const span = wanted - from;
  const size = Math.max(4, Math.min(Math.round(window * rate), Math.floor(span / 4)));
  const reach = Math.max(1, Math.min(Math.round(span * search), Math.round(rate * 0.5)));
  const low = Math.max(from + 2 * size, wanted - reach);
  const high = Math.min(length - size, wanted + reach, ceiling);
  if (high < low || from + size > length) return { end: wanted / rate, score: 0 };
  let refEnergy = 0;
  for (let index = 0; index < size; index += 1) refEnergy += mono[from + index] ** 2;
  /* Энергия окна кандидата — префиксными суммами. */
  const squares = new Float64Array(length + 1);
  for (let index = 0; index < length; index += 1)
    squares[index + 1] = squares[index] + mono[index] * mono[index];
  const similarity = (at) => {
    let dot = 0;
    for (let index = 0; index < size; index += 1) dot += mono[from + index] * mono[at + index];
    const energy = squares[at + size] - squares[at];
    const norm = Math.sqrt(refEnergy * energy);
    return norm > 1e-12 ? dot / norm : 0;
  };
  /* Из почти одинаковых швов (у ровного тона похож каждый период) берётся
     ближний к тому концу, что выбрал человек: лёгкий штраф за отход. */
  const score = (at) => similarity(at) - (0.05 * Math.abs(at - wanted)) / reach;
  const coarse = Math.max(1, Math.round(rate / 4000));
  let best = Math.min(high, Math.max(low, wanted));
  let bestScore = score(best);
  for (let at = low; at <= high; at += coarse) {
    const value = score(at);
    if (value > bestScore + 1e-9) {
      best = at;
      bestScore = value;
    }
  }
  for (let at = Math.max(low, best - coarse); at <= Math.min(high, best + coarse); at += 1) {
    const value = score(at);
    if (value > bestScore + 1e-9) {
      best = at;
      bestScore = value;
    }
  }
  return { end: best / rate, score: Math.round(similarity(best) * 1000) / 1000 };
}

/**
 * Петля из готового рендера: `body` кадров материала, из которых последние
 * `fade` уходят кроссфейдом в начало, — так «конец → начало» переходит без
 * щелчка. Хвост после `body` (реверберация, эхо) ложится по кругу на начало
 * следующего оборота, как он и звучал бы в игре. Похожие края (шов найден)
 * сводятся прямой, непохожие — по равной мощности: прямая на шуме дала бы
 * провал громкости посреди шва.
 *
 * @param {Float32Array[]} channels рендер, `body` кадров и, может быть, хвост
 * @returns {Float32Array[]} петля длиной `body − fade`
 */
export function sewLoop(channels, body, fade) {
  const total = channels[0]?.length || 0;
  const material = Math.max(1, Math.min(body, total));
  const cross = Math.max(0, Math.min(fade, Math.floor(material / 2)));
  const loop = Math.max(1, material - cross);
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < cross; index += 1) {
    let a = 0;
    let b = 0;
    for (const data of channels) {
      a += data[index];
      b += data[loop + index];
    }
    dot += a * b;
    left += a * a;
    right += b * b;
  }
  const alike = left > 0 && right > 0 && dot / Math.sqrt(left * right) > 0.5;
  return channels.map((data) => {
    const out = new Float32Array(loop);
    out.set(data.subarray(0, loop));
    for (let index = 0; index < cross; index += 1) {
      const t = (index + 0.5) / cross;
      const rise = alike ? t : Math.sin((t * Math.PI) / 2);
      const fall = alike ? 1 - t : Math.cos((t * Math.PI) / 2);
      out[index] = data[index] * rise + data[loop + index] * fall;
    }
    for (let index = material; index < total; index += 1)
      out[(index - loop) % loop] += data[index];
    return out;
  });
}

/*
 * Готовые обработки — «другой инструментал» владельца: то, что делают с
 * чужим звуком, чтобы он встал в игру своим. Каждая — набор ручок тембра и
 * пространства; длину они не меняют (тон — без темпа), поэтому подгонку
 * длины не сбивают. Ручки дальше двигаются как угодно — обработка тогда
 * просто перестаёт быть «готовой».
 */
export const LOOK_KNOBS = Object.freeze([
  "pitch",
  "bass",
  "mid",
  "treble",
  "muffle",
  "drive",
  "echo",
  "room",
  "echoDelay",
  "echoFeedback",
  "echoMix",
  "comp",
  "lowcut",
]);

export const SOUND_LOOKS = Object.freeze([
  { id: "none", title: "Без обработки", hint: "Звук как в файле", fx: {} },
  {
    id: "heavy",
    title: "Тяжелее",
    hint: "Ниже на три полутона, гуще бас",
    fx: { pitch: -3, bass: 5, treble: -2 },
  },
  {
    id: "light",
    title: "Звонче",
    hint: "Выше и ярче, бас тише",
    fx: { pitch: 2, treble: 5, bass: -3 },
  },
  {
    id: "radio",
    title: "Как из рации",
    hint: "Узкая полоса и хрип динамика",
    fx: { lowcut: 62, muffle: 52, drive: 40, mid: 6 },
  },
  {
    id: "phone",
    title: "По телефону",
    hint: "Без низа и верха, чуть хрипит",
    fx: { lowcut: 50, muffle: 46, mid: 4, drive: 12 },
  },
  {
    id: "far",
    title: "Издалека",
    hint: "Глуше, с отзвуком улицы",
    fx: { muffle: 48, echo: 28, room: 2.2, bass: -4 },
  },
  {
    id: "hall",
    title: "В зале",
    hint: "Длинный хвост большого помещения",
    fx: { echo: 40, room: 2.8 },
  },
  {
    id: "dense",
    title: "Плотнее",
    hint: "Тихое подтянуто к громкому",
    fx: { comp: 65, bass: 2 },
  },
  {
    id: "wall",
    title: "За стеной",
    hint: "Глухо, верх срезан",
    fx: { muffle: 70, treble: -6, bass: 2 },
  },
]);

/** Ручки тембра — к готовой обработке; остальные (длина, громкость) — как были. */
export function applyLook(fx, id, defaults) {
  const look = SOUND_LOOKS.find((item) => item.id === id);
  if (!look) return fx;
  const next = { ...fx };
  for (const name of LOOK_KNOBS) next[name] = look.fx[name] ?? defaults[name];
  return next;
}

/** Какая готовая обработка стоит сейчас: `""` — ручки сдвинуты по-своему. */
export function lookOf(fx, defaults) {
  return (
    SOUND_LOOKS.find((look) =>
      LOOK_KNOBS.every(
        (name) => (fx?.[name] ?? defaults[name]) === (look.fx[name] ?? defaults[name]),
      ),
    )?.id || ""
  );
}

/** Повтор до ровной длины — песня радио короче своего места. */
export function repeatTo(channels, frames) {
  return channels.map((data) => {
    const out = new Float32Array(frames);
    if (!data.length) return out;
    for (let index = 0; index < frames; index += data.length)
      out.set(data.subarray(0, Math.min(data.length, frames - index)), index);
    return out;
  });
}
