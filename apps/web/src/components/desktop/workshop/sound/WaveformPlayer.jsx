import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "../../../ui/icons.jsx";
import { waveformPeaks } from "./sound-model.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Плеер с настоящей волной.
 *
 * Первый звук в интерфейсе Astral: до этой студии в окне не было ни одного
 * AudioContext, а «осциллограммы» рисовались палочками со статическими
 * высотами. Здесь волна считается из настоящего буфера, а воспроизведение
 * идёт через Web Audio — тем же буфером, который поедет в обработку.
 */

let sharedContext = null;
function audioContext() {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) return null;
  if (!sharedContext) sharedContext = new Context();
  return sharedContext;
}

/**
 * Завести контекст окна заранее. Его создание открывает устройство вывода и стоит главному потоку десятки–сотни
 * миллисекунд (замер 22.10: 278 мс при ×4): если оно приходится на щелчок «Огонь», окно замирает ровно там, где ждут
 * звук (ТЗ 24.10.2026, п. 3). Студия зовёт это, как только открылась, а щелчку остаётся только `resume`.
 */
export function warmAudio() {
  const context = audioContext();
  if (!context) return false;
  /* Без щелчка по окну браузер контекст не запустит — это не ошибка, запустит первый щелчок. */
  Promise.resolve(context.resume?.()).catch(() => {});
  return true;
}

/** Декод любого поддержанного файла в AudioBuffer — умеет сам браузер. */
export async function decodeAudioBytes(arrayBuffer) {
  const context = audioContext();
  if (!context) throw new Error(tr("Браузер не поддерживает Web Audio."));
  return context.decodeAudioData(arrayBuffer.slice(0));
}

/*
 * Готовые сэмплы — в буфер для воспроизведения.
 *
 * Через общий контекст окна, а не через новый: превью раньше заводило свой
 * `AudioContext` на каждый пересчёт, только чтобы создать буфер, — а Chromium
 * держит их считанное число и ругается на каждый лишний.
 */
export function audioBufferFromChannels(channels, sampleRate) {
  const context = audioContext();
  const list = (channels || []).filter(Boolean);
  if (!context || !list.length) return null;
  const buffer = context.createBuffer(list.length, list[0].length, sampleRate);
  list.forEach((samples, index) => buffer.copyToChannel(samples, index));
  return buffer;
}

/*
 * Одно воспроизведение на всё окно: строка списка, закреплённый плеер и
 * превью инспектора делят один источник, и новый ▶ всегда глушит прежний —
 * два выстрела внахлёст ничего не дают услышать.
 *
 * Источник хранится набором, а не одной ссылкой: глушение — это «тишина в
 * окне», и снять с воспроизведения надо всё, что звучит, а не последнее.
 */
const voices = new Set();

export function stopPlayback() {
  const playing = [...voices];
  voices.clear();
  for (const source of playing) {
    try {
      source.stop();
    } catch {
      /* источник уже отыграл */
    }
  }
}

/*
 * Проиграть буфер один раз; возвращает остановку именно этого запуска.
 *
 * `onEnded` узнаёт, доиграл ли звук сам или его оборвали: «Слушать подряд»
 * переходит к следующей дорожке только в первом случае. Иначе любой другой ▶
 * в окне — в инспекторе, на карточке — обрывал текущую дорожку обхода, обход
 * принимал это за её конец, включал следующую и глушил только что нажатое.
 */
export function playBuffer(buffer, { onEnded, maxSeconds = 0 } = {}) {
  const context = audioContext();
  if (!context || !buffer) return () => {};
  stopPlayback();
  void context.resume?.();
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.onended = () => {
    /* Оборванный звук `stopPlayback` уже вынул из набора. */
    const natural = voices.delete(source);
    onEnded?.({ interrupted: !natural });
  };
  if (maxSeconds > 0 && buffer.duration > maxSeconds)
    source.start(0, 0, maxSeconds);
  else source.start();
  voices.add(source);
  return () => {
    if (voices.has(source)) stopPlayback();
  };
}

/**
 * Часы живого звука: контекст окна, его «сейчас» и перевод его времени в
 * часы страницы (`performance.now()`) — по ним сцена ставит вспышку на тот
 * же кадр, где звучит выстрел. `null` — Web Audio в окне нет.
 */
export function liveClock() {
  const context = audioContext();
  if (!context) return null;
  void context.resume?.();
  const now = context.currentTime;
  const stamp = context.getOutputTimestamp?.();
  const anchored = stamp && stamp.contextTime > 0 && stamp.performanceTime > 0;
  return {
    now,
    toPage: (time) =>
      anchored
        ? stamp.performanceTime + (time - stamp.contextTime) * 1000
        : performance.now() + (time - now) * 1000,
  };
}

/**
 * Один звук на часах контекста — в общий набор голосов, не глуша
 * остальных. Им живёт стрельба без конца: расписание пополняется на ходу, и
 * новый выстрел не имеет права обрывать прежние. `stopPlayback()` глушит и
 * эти голоса — любой ▶ в окне по-прежнему один.
 */
export function scheduleVoice(buffer, when, { gain = 1 } = {}) {
  const context = audioContext();
  if (!context || !buffer) return null;
  const source = context.createBufferSource();
  source.buffer = buffer;
  let node = source;
  if (gain !== 1) {
    const level = context.createGain();
    level.gain.value = gain;
    source.connect(level);
    node = level;
  }
  node.connect(context.destination);
  source.onended = () => voices.delete(source);
  source.start(Math.max(context.currentTime, when));
  voices.add(source);
  return source;
}

/** Снять один запланированный звук, не трогая остальные. */
export function cancelVoice(source) {
  if (!source || !voices.delete(source)) return;
  try {
    source.stop();
  } catch {
    /* источник уже отыграл */
  }
}

/**
 * Несколько звуков по расписанию — очередь стрельбища, серия попаданий.
 *
 * Тот же контекст и тот же набор голосов, что у `playBuffer`: любой ▶ в окне
 * глушит очередь, и очередь глушит всё, что звучало. Время — секунды от
 * начала очереди; ответ — когда очередь начнётся на часах страницы
 * (`performance.now()`), чтобы сцена показала вспышку в ту же миллисекунду,
 * что звучит выстрел.
 *
 * @param {Array<{buffer: AudioBuffer, at: number, gain?: number}>} entries
 * @returns {{startsAt: number, endsAt: number} | null}
 */
export function playSchedule(entries, { onEnded } = {}) {
  const context = audioContext();
  const list = (entries || []).filter((entry) => entry?.buffer);
  if (!context || !list.length) return null;
  stopPlayback();
  void context.resume?.();
  const lead = 0.06;
  const base = context.currentTime + lead;
  let last = 0;
  let finalSource = null;
  for (const entry of list) {
    const source = context.createBufferSource();
    source.buffer = entry.buffer;
    let node = source;
    if (entry.gain !== undefined && entry.gain !== 1) {
      const gain = context.createGain();
      gain.gain.value = entry.gain;
      source.connect(gain);
      node = gain;
    }
    node.connect(context.destination);
    source.start(base + entry.at);
    voices.add(source);
    const ends = entry.at + entry.buffer.duration;
    if (ends >= last) {
      last = ends;
      finalSource = source;
    }
    source.onended = () => {
      const natural = voices.delete(source);
      if (source === finalSource) onEnded?.({ interrupted: !natural });
    };
  }
  const startsAt = performance.now() + lead * 1000;
  return { startsAt, endsAt: startsAt + last * 1000 };
}

/*
 * Цвет волны приходит объявлением CSS — `var(--astral-accent)` по умолчанию,
 * `var(--astral-positive, …)` у превью «как уедет в игру». Холст переменных не
 * понимает: невалидное значение `fillStyle` он молча пропускает и рисует
 * чёрным по чёрному. Именно это здесь и происходило с первого дня — волна была
 * не акцентной, а чёрной, и на тёмной теме её не было видно вовсе.
 *
 * Поэтому переменная разворачивается в живое значение у самого холста: так
 * работает и запасной цвет внутри `var(…, …)`, и тема — у холста она та же,
 * что у всего вокруг.
 */
export function resolveColor(value, node) {
  const text = String(value || "").trim();
  const token = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/.exec(text);
  if (!token || !node) return text || "#ffffff";
  const live = getComputedStyle(node).getPropertyValue(token[1]).trim();
  return live || String(token[2] || "").trim() || "#ffffff";
}

export default function WaveformPlayer({
  buffer,
  label = "",
  accent = "var(--astral-accent)",
  disabled = false,
}) {
  useTr();
  const canvasRef = useRef(null);
  const stopRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  /* Смена темы меняет значение переменной, но не перерисовывает холст сама:
     нарисованное однажды белым так и осталось бы белым на светлой теме. */
  const [themeStamp, setThemeStamp] = useState(0);
  /*
   * Размер холста — тот, которым он стоит на экране, а не выдуманный.
   *
   * Холст был 440×56 при ширине на экране в 234 пикселя: браузер сжимал
   * картинку в 1.88 раза, и столбики в один пиксель размазывались в серую
   * дымку — её и видно как «градиент». Тот же размер плюс плотность экрана
   * даёт столбик ровно в пиксель устройства, без сглаживания.
   */
  const [box, setBox] = useState({ width: 0, height: 0, ratio: 1 });
  /*
   * Столбик в два пикселя и пропуск в один.
   *
   * На «столбик через пиксель» рисунок превращался в ровную серую заливку:
   * половина пикселей закрашена, половина нет, и с расстояния это читается
   * как градиент, а не как звук. Три пикселя на столбик — первая плотность,
   * на которой видно сами столбики.
   */
  const columns = Math.max(16, Math.round(box.width / 3));
  const peaks = useMemo(
    () => (buffer && box.width ? waveformPeaks(buffer, columns) : []),
    [buffer, box.width, columns],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const themed = canvas.closest("[data-theme]") || document.documentElement;
    const observer = new MutationObserver(() => setThemeStamp((n) => n + 1));
    observer.observe(themed, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const measure = () => {
      const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.round(canvas.clientWidth);
      const height = Math.round(canvas.clientHeight);
      setBox((current) =>
        current.width === width &&
        current.height === height &&
        current.ratio === ratio
          ? current
          : { width, height, ratio },
      );
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box.width || !box.height) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { width, height, ratio } = box;
    if (canvas.width !== width * ratio) canvas.width = width * ratio;
    if (canvas.height !== height * ratio) canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!peaks.length) return;
    const middle = height / 2;
    const column = width / peaks.length;
    context.fillStyle = resolveColor(accent, canvas);
    for (const [index, [low, high]] of peaks.entries()) {
      /* Столбик прибит к сетке пикселей устройства: полупиксельный край —
         это и есть размытая полоса вместо чёткой. */
      const x = Math.round(index * column * ratio) / ratio;
      const top = middle + high * middle * 0.92;
      const bottom = middle + low * middle * 0.92;
      const bar = Math.max(1 / ratio, column - 1 / ratio);
      context.fillRect(
        x,
        Math.min(top, bottom),
        bar,
        Math.max(1 / ratio, Math.abs(top - bottom)),
      );
    }
  }, [peaks, accent, themeStamp, box]);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => stop, [buffer, stop]);

  const toggle = () => {
    if (playing) {
      stop();
      return;
    }
    if (!buffer) return;
    stopRef.current = playBuffer(buffer, {
      onEnded: () => {
        stopRef.current = null;
        setPlaying(false);
      },
    });
    setPlaying(true);
  };

  return (
    <div className="snd-player">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || !buffer}
        aria-label={playing ? tr("Пауза") : `${tr("Прослушать")} ${label}`.trim()}
        title={playing ? tr("Пауза") : tr("Прослушать")}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      {/* Размер задаётся листом и снимается с экрана — см. `box` выше. */}
      <canvas ref={canvasRef} aria-hidden="true" />
      {label && <small>{label}</small>}
    </div>
  );
}
