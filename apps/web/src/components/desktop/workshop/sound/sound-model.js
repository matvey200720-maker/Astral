/*
 * Модель студии звука на стороне окна.
 *
 * Всё цифровое звуковое делается здесь, в браузере: декодирование wav/ogg/mp3
 * умеет сам `decodeAudioData`, обрезка, громкость, фейды и ресемплинг в
 * частоту дорожки — один рендер OfflineAudioContext, а в сессию main process
 * уезжает уже готовый PCM16 моно. Что человек слышит в превью, то и едет в
 * игру — двух разных обработок в этой студии нет по построению.
 */

import {
  SOUND_LIMITS,
  adoptSoundAssignments,
  normalizeAssignment,
  normalizeSoundProject,
  parseSoundProject,
  serializeSoundProject,
  soundAssignmentKey,
  soundBankKey,
} from "@modovik/sound-studio";

import { normalizeFx, renderFx } from "./sound-fx.js";
import { fittedSeconds, repeatTo } from "./sound-fit.js";
import { tr } from "../../../../locales/ui.js";

export const SOUND_STORAGE_KEY = "astral.sound-studio.project.v1";

export {
  SOUND_LIMITS,
  adoptSoundAssignments,
  normalizeAssignment,
  normalizeSoundProject,
  parseSoundProject,
  serializeSoundProject,
  soundAssignmentKey,
  soundBankKey,
};

/*
 * Всё, от чего зависит звук назначения, одной строкой. Ключ запаса рендеров и
 * часть отпечатка «что стоит в игре»: два назначения с одной строкой звучат
 * одинаково, и считать второе заново незачем.
 */
const SETTINGS = [
  "assetHash",
  "trimStart",
  "trimEnd",
  "gain",
  "fadeIn",
  "fadeOut",
  "normalize",
  "pitch",
  "reverse",
  "fill",
];

/*
 * Обработка поверх назначения (задача 6 ТЗ 10.10.2026, вечер), то, что
 * меняет сэмплы: «как плёнка» — только при скорости не ×1, шов — только у
 * петли, выбор подгонки (`fit`) — память окна и звука не меняет. Пусто —
 * назначение звучит прежним рендером, байт в байт.
 */
export function assignmentFxKey(fx) {
  if (!fx || typeof fx !== "object") return "";
  const speed = Number(fx.speed ?? 1);
  return Object.keys(fx)
    .filter(
      (name) =>
        name !== "fit" &&
        !(name === "tape" && (!fx.tape || Math.abs(speed - 1) < 1e-6)) &&
        !(name === "loopFade" && !fx.loop) &&
        !(name === "speed" && Math.abs(speed - 1) < 1e-6),
    )
    .sort()
    .map((name) => `${name}=${fx[name]}`)
    .join(",");
}

export const settingsKey = (assignment) => {
  const base = SETTINGS.map((name) => String(assignment?.[name] ?? "")).join(
    "|",
  );
  const extra = assignmentFxKey(assignment?.fx);
  return extra ? `${base}|fx:${extra}` : base;
};

export function loadSoundProject(storage = globalThis.localStorage) {
  try {
    return parseSoundProject(storage?.getItem(SOUND_STORAGE_KEY));
  } catch {
    return normalizeSoundProject(null);
  }
}

/** Дефолтный проект ключа не занимает — как у остальных студий. */
export function storeSoundProject(project, storage = globalThis.localStorage) {
  try {
    const serialized = serializeSoundProject(project);
    if (serialized === serializeSoundProject(null))
      storage?.removeItem(SOUND_STORAGE_KEY);
    else storage?.setItem(SOUND_STORAGE_KEY, serialized);
  } catch {
    /* стораж переполнен или запрещён — студия живёт дальше без памяти */
  }
}

/**
 * Крошечный RIFF/PCM16-энкодер. Импорт AWC принимает строго PCM16 моно —
 * ровно один формат, поэтому энкодер на сорок строк честнее зависимости.
 */
export function encodeWavPcm16(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset, textValue) => {
    for (let index = 0; index < textValue.length; index += 1)
      view.setUint8(offset + index, textValue.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      44 + index * 2,
      Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff),
      true,
    );
  }
  return buffer;
}

/** Пики для отрисовки волны: пары min/max на колонку холста. */
export function waveformPeaks(audioBuffer, columns = 240) {
  const channel = audioBuffer.getChannelData(0);
  const peaks = [];
  const step = Math.max(1, Math.floor(channel.length / columns));
  for (let column = 0; column < columns; column += 1) {
    let low = 0;
    let high = 0;
    const from = column * step;
    const to = Math.min(channel.length, from + step);
    for (let index = from; index < to; index += 1) {
      const value = channel[index];
      if (value < low) low = value;
      if (value > high) high = value;
    }
    peaks.push([low, high]);
  }
  return peaks;
}

/** Буфер задом наперёд — для реверса; сам буфер не трогается. */
function reversedBuffer(context, audioBuffer) {
  const copy = context.createBuffer(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate,
  );
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel).slice();
    data.reverse();
    copy.copyToChannel(data, channel);
  }
  return copy;
}

/*
 * Сколько сэмплов примет банк дорожки (задача 6): у постоянных банков
 * RESIDENT — ровно длина звука игры, их слот памяти занят впритык, и банк
 * длиннее установка не примет. Лишнее отрезается здесь, с коротким спадом,
 * — так же, как студия выстрелов режет звук по длине дорожки ствола: лучше
 * обрезанный звук, чем отказ «Применить».
 */
const CAP_FADE_SECONDS = 0.01;
function capRendition(rendition, maxFrames, rate) {
  if (!(maxFrames > 0) || rendition[0].length <= maxFrames) return rendition;
  const fade = Math.min(Math.round(CAP_FADE_SECONDS * rate), Math.floor(maxFrames / 3));
  return rendition.map((data) => {
    const out = data.slice(0, maxFrames);
    for (let index = 0; index < fade; index += 1)
      out[maxFrames - 1 - index] *= index / fade;
    return out;
  });
}

/**
 * Обработка назначения одним офлайн-рендером: обрезка, громкость, фейды,
 * тон (с темпом, как у плёнки), реверс, нормализация, приведение к частоте
 * дорожки и нужному числу каналов. `fixedFrames` держит ровно заданную
 * длину — радио не терпит другой: недостающее добивается тишиной или
 * повтором клипа, лишнее отрезается. `maxFrames` — сколько примет банк
 * дорожки (`capFrames`): длиннее режется.
 */
export async function renderAssignment(
  audioBuffer,
  assignment,
  targetRate,
  {
    channels = 1,
    maxSeconds = SOUND_LIMITS.trackSeconds,
    fixedFrames = null,
    maxFrames = null,
  } = {},
) {
  const value = normalizeAssignment({ stream: "0X00000000", ...assignment });
  if (assignmentFxKey(value.fx))
    return renderAssignmentFx(audioBuffer, value, targetRate, {
      channels,
      maxSeconds,
      fixedFrames,
      maxFrames,
    });
  const sourceSeconds = audioBuffer.duration;
  const start = Math.min(value.trimStart, sourceSeconds);
  const end =
    value.trimEnd > 0 ? Math.min(value.trimEnd, sourceSeconds) : sourceSeconds;
  const clipSeconds = Math.max(0.01, end - start);
  const rate = 2 ** (value.pitch / 12);
  const seconds = clipSeconds / rate;
  /* Предел банка ниже предела дорожки — длинное обрежется, а не откажет. */
  const capped = maxFrames > 0 && maxFrames / targetRate <= maxSeconds;
  if (seconds > maxSeconds && !capped)
    throw new Error(tr("Дорожка длиннее {seconds} секунд — обрежьте её.").replace("{seconds}", maxSeconds));
  const OfflineContext =
    globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OfflineContext)
    throw new Error(tr("Браузер не поддерживает офлайн-обработку звука."));
  const clipFrames = Math.max(1, Math.round(seconds * targetRate));
  const frames = fixedFrames
    ? Math.max(1, Math.round(fixedFrames))
    : clipFrames;
  const audible = Math.min(seconds, frames / targetRate);
  const context = new OfflineContext(channels, frames, targetRate);
  const source = context.createBufferSource();
  source.buffer = value.reverse
    ? reversedBuffer(context, audioBuffer)
    : audioBuffer;
  const from = value.reverse ? sourceSeconds - end : start;
  const to = value.reverse ? sourceSeconds - start : end;
  if (source.playbackRate) source.playbackRate.value = rate;
  const gainNode = context.createGain();
  const level = value.gain / 100;
  const fadeIn = Math.min(value.fadeIn / 1000, audible / 2);
  const fadeOut = Math.min(value.fadeOut / 1000, audible / 2);
  gainNode.gain.setValueAtTime(fadeIn > 0 ? 0 : level, 0);
  if (fadeIn > 0) gainNode.gain.linearRampToValueAtTime(level, fadeIn);
  const looping =
    Boolean(fixedFrames) && value.fill === "loop" && clipFrames < frames;
  const playEnd = looping ? frames / targetRate : audible;
  if (fadeOut > 0) {
    gainNode.gain.setValueAtTime(level, playEnd - fadeOut);
    gainNode.gain.linearRampToValueAtTime(0, playEnd);
  }
  source.connect(gainNode);
  gainNode.connect(context.destination);
  if (looping) {
    source.loop = true;
    source.loopStart = from;
    source.loopEnd = to;
    source.start(0, from);
  } else {
    source.start(0, from, clipSeconds);
  }
  const rendered = await context.startRendering();
  const rendition = [];
  for (let channel = 0; channel < channels; channel += 1)
    rendition.push(
      rendered
        .getChannelData(Math.min(channel, rendered.numberOfChannels - 1))
        .slice(),
    );
  /*
   * Нормализация — до громкости, а не вместо неё.
   *
   * Пик рендера уже несёт в себе громкость, и деление на него стирало её
   * целиком: при включённой нормализации (а она включена по умолчанию)
   * ползунок «Громкость» не менял ничего — 30 % и 300 % давали один и тот же
   * пик 0,98. Поэтому громкость возвращается множителем после выравнивания:
   * сначала клип приводится к пику, потом звучит так громко, как задано.
   *
   * Выше ста процентов громкость здесь не идёт: пик уже у границы PCM16, и
   * всё сверху было бы срезано при записи. Модель держит этот потолок сама
   * (`SOUND_LIMITS.normalizedGain`), а здесь он стоит ещё раз — на случай
   * назначения, собранного мимо неё.
   */
  if (value.normalize) {
    let peak = 0;
    for (const samples of rendition)
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    if (peak > 0.001) {
      const scale = (0.98 * Math.min(level, 1)) / peak;
      for (const samples of rendition)
        for (let index = 0; index < samples.length; index += 1)
          samples[index] *= scale;
    }
  }
  const fitted = fixedFrames
    ? rendition
    : capRendition(rendition, maxFrames, targetRate);
  const wavs = fitted.map((samples) => encodeWavPcm16(samples, targetRate));
  return {
    samples: fitted[0],
    channels: fitted,
    seconds: fitted[0].length / targetRate,
    sampleRate: targetRate,
    wav: wavs[0],
    wavs,
  };
}

/**
 * Ручки цепочки `sound-fx.js` из назначения с обработкой поверх.
 *
 * Поля назначения значат то же, что и раньше: громкость — проценты (в
 * цепочке — децибелы), «Тон» — плёнкой, то есть вместе с темпом. Плёночный
 * тон складывается со скоростью подгонки: ×1,5 «с сохранением высоты» и
 * тон +2 — это темп ×1,5·2^(2/12) и высота +2; «как плёнка» — всё одной
 * передискретизацией. Тон обработки (`fx.pitch`, «Тяжелее») — без темпа,
 * поверх.
 */
export function assignmentRenderFx(value) {
  const extra = value?.fx || {};
  const tapeRatio = 2 ** ((value?.pitch || 0) / 12);
  const gain = Math.max(10, Number(value?.gain) || 100);
  return {
    ...extra,
    trimStart: value?.trimStart || 0,
    trimEnd: value?.trimEnd || 0,
    gain: 20 * Math.log10(gain / 100),
    normalize: value?.normalize !== false,
    fadeIn: value?.fadeIn || 0,
    fadeOut: value?.fadeOut || 0,
    reverse: value?.reverse === true,
    pitch: (extra.tape ? 0 : value?.pitch || 0) + (Number(extra.pitch) || 0),
    speed: (Number(extra.speed) || 1) * tapeRatio,
    tape: extra.tape === true,
  };
}

/*
 * Рендер назначения с обработкой поверх: та же цепочка, что у студии
 * выстрелов (`renderFx`) — тембр, скорость с высотой и без, рация, петля
 * без щелчка. Ровная длина радио — обрезкой по месту или повтором, как у
 * прежнего рендера.
 */
async function renderAssignmentFx(
  audioBuffer,
  value,
  targetRate,
  { channels, maxSeconds, fixedFrames, maxFrames },
) {
  const fx = assignmentRenderFx(value);
  const seconds = fittedSeconds(audioBuffer.duration, normalizeFx(fx));
  const capped = maxFrames > 0 && maxFrames / targetRate <= maxSeconds;
  if (!fixedFrames && !capped && seconds > maxSeconds + 1e-3)
    throw new Error(tr("Дорожка длиннее {seconds} секунд — обрежьте её.").replace("{seconds}", maxSeconds));
  /* Петлю место банка не срезает, а сшивает на себе (`renderFx`): срез
     поверх готовой петли дал бы щелчок на каждом обороте. */
  const rendered = await renderFx(audioBuffer, fx, {
    sampleRate: targetRate,
    channels,
    maxSamples: fixedFrames
      ? Math.max(1, Math.round(fixedFrames))
      : fx.loop && maxFrames > 0
        ? maxFrames
        : 0,
  });
  let rendition = fixedFrames
    ? rendered.channels
    : capRendition(rendered.channels, maxFrames, targetRate);
  const frames = fixedFrames
    ? Math.max(1, Math.round(fixedFrames))
    : rendition[0].length;
  if (fixedFrames && rendered.samples < frames)
    rendition =
      value.fill === "loop"
        ? repeatTo(rendition, frames)
        : rendition.map((data) => {
            const out = new Float32Array(frames);
            out.set(data);
            return out;
          });
  const wavs = rendition.map((samples) => encodeWavPcm16(samples, targetRate));
  return {
    samples: rendition[0],
    channels: rendition,
    seconds: frames / targetRate,
    sampleRate: targetRate,
    wav: wavs[0],
    wavs,
  };
}

/**
 * Части WAV для сессии: канал IPC ограничен 24 МБ base64, а стерео-музыка
 * на канал весит десятки мегабайт. Каждая часть — самостоятельный base64.
 */
export function splitWavParts(wav, partBytes = SOUND_LIMITS.stagePartBytes) {
  const bytes = new Uint8Array(wav);
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += partBytes)
    parts.push(bufferToBase64(bytes.slice(offset, offset + partBytes).buffer));
  return parts.length ? parts : [bufferToBase64(new ArrayBuffer(0))];
}

export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

export function base64ToBuffer(encoded) {
  const binary = atob(String(encoded || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

const decibels = (value) => (value > 0 ? 20 * Math.log10(value) : -Infinity);

/** Средняя громкость и пик сэмплов, дБ полной шкалы. */
export function levels(samples) {
  let sum = 0;
  let peak = 0;
  const length = samples?.length || 0;
  for (let index = 0; index < length; index += 1) {
    const value = samples[index];
    sum += value * value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  return {
    rms: decibels(length ? Math.sqrt(sum / length) : 0),
    peak: decibels(peak),
  };
}

/*
 * «Как у оригинала»: громкость, при которой свой звук встаёт вровень со
 * звуком игры.
 *
 * Жалоба сообщества одна и та же: «после замены стало тише» или, наоборот,
 * выстрел рвёт уши на фоне остальных. Для коротких звуков интегральная
 * громкость (LUFS) мерит плохо — её гейт рассчитан на секунды, а выстрел
 * длится десятые, — поэтому ровняется средняя громкость клипа к средней
 * громкости оригинала. Сверху стоит потолок пика в −1 дБ: громче этого
 * звук уже режется при записи в PCM16.
 *
 * `have` — уровни своего звука при громкости 100 %, `want` — оригинала.
 */
export function loudnessMatchGain(want, have) {
  if (!Number.isFinite(want?.rms) || !Number.isFinite(have?.rms)) return 100;
  const matched = 100 * 10 ** ((want.rms - have.rms) / 20);
  const ceiling = Number.isFinite(have.peak)
    ? 100 * 10 ** ((-1 - have.peak) / 20)
    : matched;
  return Math.round(Math.min(300, Math.max(10, Math.min(matched, ceiling))));
}

/*
 * Тишина в начале файла.
 *
 * Выстрел, который начинается через десятую секунды после курка, ощущается
 * как задержка, а записи из библиотек звуков почти всегда начинаются с
 * паузы. Порог −45 дБ отделяет тишину и шум записи от атаки; пять
 * миллисекунд до атаки оставлены, чтобы не срезать её фронт. Пауза короче
 * двадцати миллисекунд не считается: её не слышно.
 */
export function leadingSilenceSeconds(audioBuffer, thresholdDb = -45) {
  const channel = audioBuffer?.getChannelData?.(0);
  const rate = Number(audioBuffer?.sampleRate) || 0;
  if (!channel?.length || !rate) return 0;
  const threshold = 10 ** (thresholdDb / 20);
  let index = 0;
  while (index < channel.length && Math.abs(channel[index]) < threshold)
    index += 1;
  if (index >= channel.length) return 0;
  const seconds = Math.max(0, index / rate - 0.005);
  return seconds < 0.02 ? 0 : Math.round(seconds * 1000) / 1000;
}
