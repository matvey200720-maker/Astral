import { tr, useTr } from "../../../locales/ui.js";
import { frozenClock } from "./TracerRange.jsx";
import { startStageLoop, STAGE_IDLE } from "./stage-loop.js";
import { useState, useRef, useLayoutEffect, useEffect } from "react";

// Положение внутри килла живёт вне React: кадры пишут в него 60 раз в секунду,
// а перерисовывать весь редактор на каждый шаг незачем (docs/3D.md: ползунок
// и текст не лагают).
class Playhead {
  #cur;
  #ears = new Set();

  constructor(initial) {
    this.#cur = initial;
    this.get = () => this.#cur;
    this.set = (next) => {
      if (next !== this.#cur) {
        this.#cur = next;
        this.#announce();
      }
    };
    this.subscribe = (ear) => {
      this.#ears.add(ear);
      return () => this.#ears.delete(ear);
    };
  }

  // Рассылка по снимку; значение читается заново на каждом шаге, поэтому
  // вложенный set из подписчика виден следующим подписчикам.
  #announce() {
    [...this.#ears].forEach((ear) => ear(this.#cur));
  }
}

export const createPlayhead = (initial = 0) => new Playhead(initial);

export function usePlayhead(initial = 0) {
  const [head] = useState(() => createPlayhead(initial));
  return head;
}

// Последнее переданное значение без перезапуска эффектов.
function useLatest(value) {
  const box = useRef(value);
  useLayoutEffect(() => {
    box.current = value;
  });
  return box;
}

const FPS_CAP = 60;

// Чистая часть кадра: что записать в хранилище, через сколько просить следующий
// кадр и кончился ли режим «один раз». Режим не из таблицы просто идёт вперёд.
function frameOutcome(mode, ms, loopMs, endMs) {
  switch (mode) {
    case "once": {
      const over = ms >= endMs;
      return { at: over ? 0 : ms, wait: over ? STAGE_IDLE : 0, over };
    }
    case "loop": {
      const lap = ms % loopMs;
      // Сравнение с NaN ложно: круг тогда идёт без паузы. Вспышка догорела —
      // встаём на её конец и спим таймером, а не перерисовываем неподвижную стену.
      const asleep = lap >= endMs;
      return { at: asleep ? endMs : lap, wait: asleep ? loopMs - lap : 0, over: false };
    }
    default:
      return { at: ms, wait: 0, over: false };
  }
}

function stageFrame({ playhead, playback, loopMs, endMs }, finishRef) {
  return (ms) => {
    const { at, wait, over } = frameOutcome(playback, ms, loopMs, endMs);
    playhead.set(at);
    const done = finishRef.current;
    if (over && done) done();
    return wait;
  };
}

function spinStage(stageRef, frame) {
  const element = stageRef.current;
  return startStageLoop({ maxFps: FPS_CAP, frame, clock: frozenClock(), element });
}

// Цикл кадров общий (stage-loop.js, правило 4 docs/3D.md: свой бесконечный не
// заводить): закрытые ворота — свёрнутое окно, чужой фокус, сцена за краем —
// останавливают проигрывание на месте. «Один раз» обязан кончаться сам, поэтому
// режимов три, а не флаг. runId — только метка перезапуска.
export function useKillPlayback({ stageRef, onFinish, endMs, loopMs, runId, playback, playhead }) {
  const finishRef = useLatest(onFinish);
  useEffect(() => {
    const loop = playback === "paused" ? null : spinStage(stageRef, stageFrame({ playhead, playback, loopMs, endMs }, finishRef));
    return () => loop?.stop();
  }, [runId, stageRef, playback, playhead, endMs, loopMs, finishRef]);
}

const UNIT_SCALE = new Map([
  ["мс", 1],
  ["ms", 1],
  ["с", 1000],
  ["s", 1000],
]);
const MOMENT_PATTERN = new RegExp(`^(\\d+(?:\\.\\d+)?)(${[...UNIT_SCALE.keys()].join("|")})?$`);

// Пробелы выкидываются отовсюду («1 000» — это 1000), запятая — только первая,
// поэтому «1,000» — это 1. Непонятное — null: стёртое поле значит «передумал».
const MOMENT_CLEANUP = [
  (raw) => (raw == null ? "" : String(raw)),
  (txt) => txt.split(/\s+/).join(""),
  (txt) => txt.toLowerCase(),
  (txt) => txt.replace(",", "."),
];

export function parseKillMoment(text) {
  const clean = MOMENT_CLEANUP.reduce((acc, step) => step(acc), text);
  const hit = MOMENT_PATTERN.exec(clean);
  return hit && Number(hit[1]) * (UNIT_SCALE.get(hit[2]) ?? 1);
}

const SCRUB = Object.freeze({ step: 10, bigStep: 100, labelGap: 100 });
const FILL_VAR = "--ui-slider-fill";

// Секунды всегда с точкой, на всех языках.
const fmt = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(2) + tr(" с") : Math.round(ms) + tr(" мс"));
const placeOf = (playhead, max) => Math.min(max, playhead.get());
const snapMoment = (ms, max) => {
  const stepped = Math.round(ms / SCRUB.step) * SCRUB.step;
  return Math.max(0, Math.min(max, stepped));
};

// Не больше одной отдачи за кадр: каждая — полная перерисовка сцены, а мышь
// шлёт движений больше, чем экран успевает показать. Первая уходит сразу, она
// ставит проигрывание на паузу.
class DragGate {
  #ticket = null;
  #queued = null;
  #readSink;

  constructor(readSink) {
    this.#readSink = readSink;
  }

  #give(ms) {
    const sink = this.#readSink();
    if (sink) sink(ms);
  }

  #arm() {
    this.#ticket = window.requestAnimationFrame(() => {
      this.#ticket = null;
      const ms = this.#queued;
      if (ms === null) return;
      this.#queued = null;
      this.#give(ms);
      this.#arm();
    });
  }

  drag = (ms) => {
    if (this.#ticket !== null) {
      this.#queued = ms;
      return;
    }
    this.#give(ms);
    this.#arm();
  };

  commit = (ms) => {
    this.#give(ms);
    this.drop();
  };

  drop = () => {
    this.#queued = null;
    if (this.#ticket === null) return;
    window.cancelAnimationFrame(this.#ticket);
    this.#ticket = null;
  };
}

// Подпись в поле — не чаще labelGap (глаз не читает бегущие миллисекунды, а
// каждое обновление текста — раскладка строки).
class LabelPacer {
  #stamp = -Infinity;
  #timer = null;
  #paint;

  constructor(paint) {
    this.#paint = paint;
  }

  poke() {
    const wait = SCRUB.labelGap - (performance.now() - this.#stamp);
    if (wait <= 0) {
      this.#flush();
    } else if (this.#timer === null) {
      this.#timer = window.setTimeout(() => {
        this.#timer = null;
        this.#flush();
      }, wait);
    }
  }

  dispose() {
    if (this.#timer !== null) window.clearTimeout(this.#timer);
  }

  #flush() {
    this.#stamp = performance.now();
    this.#paint();
  }
}

// Всё, что шкала держит между кадрами, — один изменяемый объект на экземпляр.
function makePad(sinkRef) {
  const pad = {
    slider: null,
    field: null,
    typing: false,
    aborted: false,
    seed: "",
    gate: new DragGate(() => sinkRef.current),
    pinSlider(el) {
      pad.slider = el;
    },
    pinField(el) {
      pad.field = el;
    },
  };
  return pad;
}

// Бегунок и заливка — на каждое изменение хранилища, подпись — через pacer.
function useScrubFollow(pad, playhead, max) {
  useLayoutEffect(() => {
    const { slider, field } = pad;
    const pacer = new LabelPacer(() => {
      // Пока поле в руках, текст не трогаем, но момент обновления помним.
      if (!pad.typing) field.value = fmt(placeOf(playhead, max));
    });
    const follow = () => {
      const pos = placeOf(playhead, max);
      slider.value = pos;
      slider.style.setProperty(FILL_VAR, (pos / max) * 100 + "%");
      pacer.poke();
    };
    follow();
    const unsubscribe = playhead.subscribe(follow);
    return () => {
      pacer.dispose();
      unsubscribe();
    };
  }, [pad, playhead, max]);
}

function fieldHandlers(pad, playhead, max) {
  const nudge = (dir) => (e) => {
    const base = parseKillMoment(pad.field.value) ?? playhead.get();
    const next = snapMoment(base + dir * (e.shiftKey ? SCRUB.bigStep : SCRUB.step), max);
    pad.field.value = String(next);
    pad.gate.commit(next);
  };
  const keyMoves = new Map([
    ["ArrowUp", nudge(1)],
    ["ArrowDown", nudge(-1)],
    ["Enter", () => pad.field.blur()],
    [
      "Escape",
      () => {
        pad.aborted = true;
        pad.field.blur();
      },
    ],
  ]);

  return {
    onFocus() {
      const shown = String(Math.round(placeOf(playhead, max)));
      Object.assign(pad, { typing: true, seed: shown });
      pad.field.value = shown;
      pad.field.select();
    },
    onKeyDown(e) {
      const move = keyMoves.get(e.key);
      if (!move) return;
      e.preventDefault();
      move(e);
    },
    onBlur() {
      const { field } = pad;
      // Сравниваем текст, а не значение: «300 мс» при фокусе «300» — это правка.
      const untouched = pad.aborted || field.value === pad.seed;
      const picked = untouched ? null : parseKillMoment(field.value);
      if (picked !== null) pad.gate.commit(snapMoment(picked, max));
      Object.assign(pad, { typing: false, aborted: false });
      field.value = fmt(placeOf(playhead, max));
    },
  };
}

const rangeAttrs = (max, label) => ({
  min: 0,
  max,
  step: SCRUB.step,
  "aria-label": label,
  type: "range",
  defaultValue: 0,
});

const fieldAttrs = (label, hint) => ({
  className: "kill-scrub-value",
  inputMode: "decimal",
  autoComplete: "off",
  spellCheck: false,
  "aria-label": label,
  title: hint,
  type: "text",
  defaultValue: "",
});

// Поле времени — решение владельца 03.10.2026 («где ползунок — там и цифры»):
// в фокусе оно не бежит за повтором, Enter и уход ставят кадр на набранный момент.
// Оба поля неуправляемые (React не пишет в них после монтирования), у текстового
// нет aria-live: иначе диктор читал бы счётчик миллисекунд.
export function KillScrub({ onScrub, max, playhead }) {
  const say = useTr();
  const sinkRef = useLatest(onScrub);
  const [pad] = useState(() => makePad(sinkRef));
  useScrubFollow(pad, playhead, max);
  useEffect(() => pad.gate.drop, [pad]);

  const typed = fieldHandlers(pad, playhead, max);
  const slide = (e) => {
    const route = e.nativeEvent.type === "input" ? "drag" : "commit";
    pad.gate[route](Number(e.target.value));
  };

  const slider = (
    <input {...rangeAttrs(max, say("Время после килла"))} ref={pad.pinSlider} onChange={slide} />
  );
  const field = (
    <input
      {...fieldAttrs(say("Время после килла: значение"), say("Наберите момент: 400, 400 мс или 0,4 с"))}
      ref={pad.pinField}
      {...typed}
    />
  );
  const total = <small className="kill-scrub-total">{`${say("из")} ${fmt(max)}`}</small>;

  return (
    <div className="kill-scrub ui-slider">
      {slider}
      {field}
      {total}
    </div>
  );
}
