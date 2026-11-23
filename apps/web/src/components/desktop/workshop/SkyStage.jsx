/*
 * Кадр неба: город и небо на весь кадр мастерской, лента суток над ними.
 *
 * Органов вида на кадре нет — ни «купол/сцена», ни сторон света, ни паузы, ни
 * яркости просмотра (владелец, 25.09.2026: «у него просто предпросмотр и ниже
 * время»). Всё, что человек делает с кадром, — оглядывается мышью и листает
 * сутки лентой. Мышь — та же, что у остальных кадров мастерской (владелец,
 * 03.10.2026: одна раскладка на все редакторы): кнопкой — оглядеться (правой
 * тоже — так поворачивают в редакторах карт игры, а на тачпаде правой не
 * потянешь), колесо — приближение, двойной щелчок — вид по умолчанию.
 *
 * Лента — не декорация: её цвета посчитаны тем же таймциклом, что и кадр, и
 * по ней видно весь день целиком — где ночь, где закат, где полдень. Отметки
 * под ней — тринадцать опорных кадров игры, выбранные для правки подсвечены.
 * Щелчок по отметке ставит время ровно на неё; часы слева от ленты можно
 * набрать.
 *
 * Лента — органы кадра (`StageBar`) во всю ширину верха: левый нижний угол
 * занят подсказками управления, правый нижний — подписью кадра, а плашки
 * полёта, ради которой каркас держит свободным левый верхний угол, у неба нет.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise } from "../../ui/icons.jsx";
import { TIMECYCLE_SAMPLES, SAMPLE_COUNT } from "@modovik/timecycle";
import { watchFrameGate } from "../../../attention.js";
import { humanFailure } from "../../../utils/installFailure.js";
import Button from "../../ui/Button.jsx";
import { StageBar } from "../../ui/StageOverlay.jsx";
import { SKY_FOCUS_COPY } from "./sky/sky-focus.js";
import { visibleLabels } from "./timebar-labels.js";
import DayPlayButton from "./sky/day-play.jsx";
import { createSkyRendererAsync } from "./sky-renderer.js";
import { markWheel } from "../../ui/wheel-mark.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Горизонт чуть ниже середины кадра: небо — предмет правки, город — подложка. */
const DEFAULT_CAMERA = Object.freeze({ yaw: Math.PI / 2, pitch: 0.2, fov: 1.2 });

/*
 * Приближение — угол обзора, а не шаг камеры: глаз стоит в городе, и подойти
 * к небу ближе нельзя. Уже 0,45 рад облака расплываются пятнами своих листов,
 * шире 1,6 горизонт гнётся рыбьим глазом.
 */
const FOV_RANGE = Object.freeze({ min: 0.45, max: 1.6 });
/* Щелчок колеса (100 точек) — шестая часть угла: десяток щелчков от края до
   края, как у приближения остальных кадров. */
const WHEEL_ZOOM = 0.0016;

/*
 * Облака идут тридцатью кадрами в секунду, а не частотой экрана: облако за
 * тридцатую долю секунды сдвигается меньше чем на точку, а кадр неба с
 * городом и тенями — это полтора миллиона точек шейдера. Допуск в четыре
 * миллисекунды — чтобы дрожание отметок кадра не роняло шаг до двадцати.
 */
const CLOUD_FRAME_MS = 1000 / 30 - 4;
const CLOUD_MAX_STEP_MS = 100;

/* Шаг ленты — три минуты; стрелки в поле часов шагают так же, с Shift — по
   полчаса. Набранное время держится с точностью до минуты. */
const HOUR_STEP = 0.05;
const HOUR_LEAP = 0.5;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Час в сутках до минуты: 24:00 — это полночь, три минуты до полуночи — 23:57. */
function wrapHour(hour) {
  const minutes = Math.round((((hour % 24) + 24) % 24) * 60);
  return (minutes % (24 * 60)) / 60;
}

/** Ширина отрезка ленты — сколько часов держится кадр. */
function sampleSpan(index) {
  const current = TIMECYCLE_SAMPLES[index];
  const next = TIMECYCLE_SAMPLES[(index + 1) % SAMPLE_COUNT];
  const span =
    index === SAMPLE_COUNT - 1 ? 24 - current.hour : next.hour - current.hour;
  return Math.max(span, 1);
}

export function formatHour(hour) {
  const total = Math.round((((hour % 24) + 24) % 24) * 60);
  const hours = Math.floor(total / 60) % 24;
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Часы и минуты — в час суток; `null`, если такого времени нет. */
function clockHour(hours, minutes) {
  if (minutes > 59) return null;
  const hour = hours + minutes / 60;
  return hour > 24 ? null : wrapHour(hour);
}

/**
 * Час из набранного текста — так, как время пишут: «18:30», «7», «1830»,
 * «18,5» (десятые — доли часа, как у чисел остальных полей). Непонятное и
 * пустое — `null`: стёртое поле значит «передумал», а не «полночь».
 */
export function parseHour(text) {
  const cleaned = String(text ?? "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  let match = /^(\d{1,2})[:ч](\d{1,2})$/i.exec(cleaned);
  if (match) return clockHour(Number(match[1]), Number(match[2]));
  match = /^(\d{1,2})(\d{2})$/.exec(cleaned);
  if (match) return clockHour(Number(match[1]), Number(match[2]));
  if (/^\d{1,2}(\.\d+)?$/.test(cleaned)) return clockHour(Number(cleaned), 0);
  return null;
}

/**
 * Часы ленты, которые можно набрать (владелец, 03.10.2026: «где ползунок —
 * там и цифры»). Ведут себя как число у любого ползунка мастерской: в фокусе
 * текст выделен целиком и набранное заменяет его, Enter или уход фокуса
 * принимают, Escape возвращает прежнее, стрелки шагают по ленте.
 */
function SkyClock({ hour, onChange }) {
  useTr();
  const [draft, setDraft] = useState(null);
  const input = useRef(null);
  const cancelled = useRef(false);
  /* Выделять после отрисовки: смена значения сбрасывает выделение, сделанное
     до неё. Первое отпускание кнопки после фокуса мышью своего действия не
     выполняет — иначе Chrome ставит курсор в точку щелчка и снимает выделение
     (так же у числа ползунка, `Slider.jsx`). */
  const selectAfterRender = useRef(false);
  const keepSelection = useRef(false);

  useLayoutEffect(() => {
    if (draft === null || !selectAfterRender.current) return;
    selectAfterRender.current = false;
    input.current?.select();
  }, [draft]);

  const nudge = (text, direction, large) => {
    const next = wrapHour(
      (parseHour(text) ?? hour) + direction * (large ? HOUR_LEAP : HOUR_STEP),
    );
    setDraft(formatHour(next));
    onChange(next);
  };

  return (
    <input
      ref={input}
      className="sky-timebar-clock"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      aria-label={tr("Время суток: значение")}
      title={tr("Наберите время: 18:30, 7 или 18,5")}
      value={draft ?? formatHour(hour)}
      onMouseDown={(event) => {
        if (document.activeElement !== event.currentTarget)
          keepSelection.current = true;
      }}
      onMouseUp={(event) => {
        if (!keepSelection.current) return;
        keepSelection.current = false;
        event.preventDefault();
      }}
      onFocus={() => {
        selectAfterRender.current = true;
        setDraft(formatHour(hour));
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          event.currentTarget.blur();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          nudge(
            event.currentTarget.value,
            event.key === "ArrowUp" ? 1 : -1,
            event.shiftKey,
          );
        }
      }}
      onBlur={(event) => {
        /* Текст — из самого поля: Enter уводит фокус в том же событии, и
           состояние к этому моменту ещё старое. */
        const text = event.currentTarget.value;
        keepSelection.current = false;
        setDraft(null);
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        const parsed = parseHour(text);
        if (parsed !== null && Math.abs(parsed - hour) > 1e-6) onChange(parsed);
      }}
    />
  );
}

/* Лента суток: часы, полоса суток с бегунком поверх и отметки опорных кадров (её берёт и кадр с кварталом). */
export function SkyTimebar({ hour, onHourChange, band, selected, dayPlay = null }) {
  useTr();
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  /* Подписи часов — сколько умещается по ширине дорожки: в узкой ленте 05 06 07 и 16…22 слипались. */
  const marksRef = useRef(null);
  const [marksWidth, setMarksWidth] = useState(0);
  useLayoutEffect(() => {
    const element = marksRef.current;
    if (!element) return undefined;
    const measure = () => setMarksWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const labelled = useMemo(
    () => visibleLabels(TIMECYCLE_SAMPLES.map((sample) => sampleSpan(sample.index)), marksWidth, { selected: selectedSet }),
    [marksWidth, selectedSet],
  );
  return (
    <div className="sky-timebar">
      {/* Часы и «Сутки» (прогон 12:00 → 12:00, `sky/day-play.jsx`) — слева от ленты. */}
      <div className="sky-timebar-head">
        <SkyClock hour={hour} onChange={onHourChange} />
        <DayPlayButton hour={hour} onHourChange={onHourChange} dayPlay={dayPlay} />
      </div>
      <div className="sky-timebar-track ui-slider">
        <div className="sky-timebar-band" aria-hidden="true">
          {TIMECYCLE_SAMPLES.map((sample) => (
            <i
              key={sample.index}
              style={{
                flexGrow: sampleSpan(sample.index),
                background: band[sample.index]
                  ? `rgb(${band[sample.index].join(",")})`
                  : undefined,
              }}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={23.95}
          step={HOUR_STEP}
          value={hour}
          aria-label={tr("Время суток")}
          aria-valuetext={formatHour(hour)}
          onChange={(event) => onHourChange(Number(event.target.value))}
        />
        <ol className="sky-timebar-marks" ref={marksRef}>
          {TIMECYCLE_SAMPLES.map((sample) => (
            <li
              key={sample.index}
              style={{ flexGrow: sampleSpan(sample.index) }}
            >
              <button
                type="button"
                className={selectedSet.has(sample.index) ? "is-selected" : ""}
                aria-pressed={selectedSet.has(sample.index)}
                aria-label={`${tr("Время")} ${sample.label}`}
                onClick={() => onHourChange(sample.hour)}
                /* Ширина метки — не размер мишени, а шаг шкалы: метка стоит
                   под своим часом, и соседние часы (16…22) при самом узком
                   окне (1180) делят дорожку по двадцать с небольшим точек.
                   Шире — значит налезть на соседа. Мишень выбора времени —
                   ползунок во всю дорожку над метками; метка — ярлык на
                   точный час. */
                data-audit-ignore="hit-target"
              >
                <span className={labelled.has(sample.index) ? undefined : "is-thin"}>{sample.label.slice(0, 2)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function SkyStage({
  state,
  hour,
  onHourChange,
  band = [],
  selected = [],
  textures = null,
  clouds = null,
  hats = null,
  sheets = null,
  /* Настройки радуги (`rainbow.js`), когда она включена; иначе `null`. */
  rainbow = null,
  /* Погода кадра: осадки, ветер, снег, мокрота, молния, туман (`previewConditions`); `null` — таймцикл без добавок. */
  conditions = null,
  /* Подпись кадра: короткая строка на виду и подробности по наведению. */
  /* Участок, который правит группа ползунков под курсором (`sky-focus.js`):
     кадр приглушает остальное и подписывает, что это в игре. */
  focus = null,
  /* Переключатель кадра — орган редактора, не кадра (был «Из игры / Нарисованный», снят 17.11.2026). */
  modeControl = null,
  /* Нарисованный город под небом: у каталога и обложек пока есть, у мастерской таймциклов `false` — города из игры нет, и рисовать его нечем (17.11.2026). */
  city = true,
  /* Кадр — жилец рендерера окна (шаг Б фазы 5), а не свой контекст WebGL. */
  share = false,
  /* Прогон суток: `{ autoStart, loop }` — предпросмотр каталога гонит сутки сам и по кругу; у мастерской `null`. */
  dayPlay = null,
  /* Шейдер собран и первый кадр неба нарисован: каталог проявляет сцену поверх фото. У мастерской `null`. */
  onReady = null,
}) {
  useTr();
  const canvasRef = useRef(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const rendererRef = useRef(null);
  const drawRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const cloudsRef = useRef(clouds);
  cloudsRef.current = clouds;
  /* Радуга — то, что игра покажет сверх таймцикла: её рисует рендерер по
     часам модели, если выключатель включён. */
  const extras = useMemo(
    () => (rainbow || conditions ? { ...conditions, ...(rainbow ? { rainbow } : null) } : null),
    [rainbow, conditions],
  );
  const extrasRef = useRef(null);
  extrasRef.current = extras;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const sceneTimeRef = useRef(0);
  const loopingRef = useRef(false);
  const dirtyRef = useRef(false);
  const [camera, setCamera] = useState(DEFAULT_CAMERA);
  /* Взгляд без города: рендерер неба прячет нарисованный квартал по `showCity === false` (`sky-renderer.js`). */
  const viewed = useMemo(() => (city ? camera : { ...camera, showCity: false }), [camera, city]);
  const cameraRef = useRef(viewed);
  cameraRef.current = viewed;
  const [failure, setFailure] = useState("");
  const [dragging, setDragging] = useState(false);
  /* Шейдер неба собран и рендерер на месте — зависящие от него эффекты идут снова. */
  const [ready, setReady] = useState(false);

  /*
   * Шейдер неба — семьдесят килобайт: собранный в главном потоке, он ставил
   * окно на 0,3–1,5 с при первом открытии редактора (стенд 13.10.2026: девять
   * долгих задач, 1,5 с блокировки). Теперь его собирает видеочип
   * (`createSkyRendererAsync`, KHR_parallel_shader_compile), а окно живёт
   * дальше: кадр неба появляется, когда сборка кончилась.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let cancelled = false;
    let observer = null;
    let renderer = null;
    createSkyRendererAsync(canvas, { share }).then(
      (created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        renderer = created;
        setFailure("");
        rendererRef.current = renderer;
        drawRef.current = () => {
          const active = rendererRef.current;
          if (!active || !stateRef.current) return;
          active.render(
            stateRef.current,
            {
              ...cameraRef.current,
              time: sceneTimeRef.current,
              focus: focusRef.current,
            },
            extrasRef.current,
            cloudsRef.current,
          );
        };
        observer = new ResizeObserver(() => {
          const box = canvas.getBoundingClientRect();
          renderer.resize(box.width, box.height, window.devicePixelRatio || 1);
          drawRef.current?.();
        });
        observer.observe(canvas);
        setReady(true);
      },
      (error) => {
        if (!cancelled) setFailure(humanFailure(error));
      },
    );
    return () => {
      cancelled = true;
      observer?.disconnect();
      drawRef.current = null;
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, [share]);

  /* Первый кадр: рендерер на месте, кадр нарисован и показан (два кадра экрана) — об этом узнаёт тот, кто ждёт сцену (`onReady`). */
  useEffect(() => {
    if (!ready) return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      drawRef.current?.();
      second = requestAnimationFrame(() => onReadyRef.current?.());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [ready]);

  /* Луна и звёзды из игры приезжают позже холста — их надо достать из архива. */
  useEffect(() => {
    rendererRef.current?.setSkyTextures({
      moon: textures?.moon || null,
      starfield: textures?.starfield || null,
    });
    drawRef.current?.();
  }, [textures, ready]);

  /* Облачные шапки игры: модели приходят одной описью, листы — по мере
     надобности. Пока их нет, кадр показывает облака купола. */
  useEffect(() => {
    rendererRef.current?.setCloudHats(hats);
    drawRef.current?.();
  }, [hats, ready]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !sheets?.size) return;
    for (const [name, image] of sheets)
      if (!renderer.hasCloudHatSheet(name)) renderer.setCloudHatSheet(name, image);
    drawRef.current?.();
  }, [hats, sheets, ready]);

  /* Кадр на каждое изменение неба или взгляда; пока идёт цикл облаков, он
     рисует правку ближайшим кадром экрана, мимо своего такта. */
  useEffect(() => {
    if (loopingRef.current) {
      dirtyRef.current = true;
      return undefined;
    }
    const frame = requestAnimationFrame(() => drawRef.current?.());
    return () => cancelAnimationFrame(frame);
  }, [state, viewed, clouds, extras, focus]);

  /* Облака плывут, пока на кадр смотрят: ворота кадров (`attention.js`)
     останавливают цикл, когда окно в фоне или кадр уехал за край. */
  useEffect(() => {
    let last = 0;
    let drawnAt = -Infinity;
    let frame = 0;
    const loop = (now) => {
      frame = requestAnimationFrame(loop);
      if (last)
        sceneTimeRef.current += Math.min(now - last, CLOUD_MAX_STEP_MS) / 1000;
      last = now;
      if (!dirtyRef.current && now - drawnAt < CLOUD_FRAME_MS) return;
      dirtyRef.current = false;
      drawnAt = now;
      drawRef.current?.();
    };
    const stopGate = watchFrameGate(canvasRef.current, (open) => {
      cancelAnimationFrame(frame);
      frame = 0;
      loopingRef.current = open;
      if (!open) return;
      last = 0;
      drawnAt = -Infinity;
      frame = requestAnimationFrame(loop);
    });
    return () => {
      stopGate();
      loopingRef.current = false;
      cancelAnimationFrame(frame);
    };
  }, []);

  /*
   * Колесо — приближение. Слушатель свой, не реактовский: React вешает
   * колесо пассивным, и отменить прокрутку из него нельзя — колесо над кадром
   * листало бы ещё и панель вокруг. Строки (Firefox) переводятся в точки.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
      setCamera((current) => ({
        ...current,
        fov: clamp(
          current.fov * Math.exp(delta * WHEEL_ZOOM),
          FOV_RANGE.min,
          FOV_RANGE.max,
        ),
      }));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const unmarkWheel = markWheel(canvas);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      unmarkWheel();
    };
  }, [failure]);

  function startDrag(event) {
    if (event.button !== 0 && event.button !== 2) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    setDragging(true);
    const origin = { x: event.clientX, y: event.clientY, ...cameraRef.current };
    const move = (moveEvent) => {
      const deltaX = (moveEvent.clientX - origin.x) / canvas.clientWidth;
      const deltaY = (moveEvent.clientY - origin.y) / canvas.clientHeight;
      setCamera((current) => ({
        ...current,
        yaw: origin.yaw - deltaX * origin.fov * 2.2,
        /* Вниз взгляд опускается меньше, чем поднимается: под ногами город,
           а править пришли небо. */
        pitch: clamp(origin.pitch + deltaY * origin.fov * 1.6, -0.35, 1.3),
      }));
    };
    const stop = () => {
      setDragging(false);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", stop);
      canvas.removeEventListener("pointercancel", stop);
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
  }

  return (
    <div className="sky-stage">
      <div className={`sky-frame${dragging ? " is-dragging" : ""}`}>
        {failure ? (
          <p className="sky-frame-failure">
            {tr("Предпросмотр неба недоступен:")} {failure}
          </p>
        ) : (
          <canvas
            ref={canvasRef}
            aria-label={tr("Предпросмотр неба. Оглядитесь, зажав кнопку мыши; колесо — приближение, двойной щелчок — вид по умолчанию")}
            onPointerDown={startDrag}
            onContextMenu={(event) => event.preventDefault()}
            onDoubleClick={() => setCamera(DEFAULT_CAMERA)}
          />
        )}
        {focus && SKY_FOCUS_COPY[focus] && !failure && (
          <p className="sky-focus-note" role="status">
            <b>{tr(SKY_FOCUS_COPY[focus].title)}</b>
            <span>{tr(SKY_FOCUS_COPY[focus].text)}</span>
          </p>
        )}
      </div>
      <StageBar wide className="sky-stage-bar" label={tr("Время суток")}>
        <SkyTimebar
          hour={hour}
          onHourChange={onHourChange}
          band={band}
          selected={selected}
          dayPlay={dayPlay}
        />
        {modeControl}
        {!failure && (
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowCounterClockwise />}
            aria-label={tr("Вид по умолчанию")}
            title={tr("Вид по умолчанию (двойной щелчок по кадру)")}
            disabled={camera === DEFAULT_CAMERA}
            onClick={() => setCamera(DEFAULT_CAMERA)}
          />
        )}
      </StageBar>
    </div>
  );
}
