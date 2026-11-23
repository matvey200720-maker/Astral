import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Button from "../../../components/ui/Button.jsx";
import {
  ArrowCounterClockwise,
  ArrowRight,
  Pause,
  Play,
} from "../../../components/ui/icons.jsx";
import {
  STAGE_IDLE,
  startStageLoop,
} from "../../../components/desktop/workshop/stage-loop.js";
import { tr, useTr } from "../../../locales/ui.js";
import { useTrack } from "./animation-data.js";
import { mainProcessText } from "./animation-errors.js";
import { kindLabel } from "./animation-library.js";
import {
  cadenceDue,
  newCadence,
  restartCadence,
} from "../engine/frame-cadence.js";
import { newPace, stepPace } from "./animation-pace.js";
import AnimationDuration from "./AnimationDuration.jsx";

/*
 * Два окна проигрывания (ТЗ 29.10.2026-d): слева «На сервере» — анимация, которую заменяют, справа «У тебя» — та, что играть вместо
 * неё. Обе идут по кругу и начинаются вместе, чтобы их можно было сравнить на глаз.
 *
 * Рисует их сцена (`animation-scene.js`) одним кадром на одном буфере окна — ножницами, по половине холста; здесь — холст, часы
 * проигрывания, подписи и состояние каждой половины (читается, не прочиталась, ничего не выбрано). Кадры идут по требованию
 * (`stage-loop.js`): пауза, закрытое окно и скрытая вкладка кадров не просят.
 */

const EMPTY = Object.freeze({ status: "idle", track: null, error: "" });

/* Частота проигрывания — `animation-pace.js`: шестьдесят кадров, слабая видеокарта режет разрешение, а не частоту. Шаг кадров — целое число
   развёрток экрана, время клипа — по метке развёртки (`engine/frame-cadence.js`): без этого на экране 200 Гц кадры шли через 15 и 20 мс вперемешку. */
const FULL_FPS = 60;
const HALF_FPS = 30;
/* Сколько кадров между записями `data-interval`: запись атрибута каждый кадр — лишний пересчёт стилей сцены. */
const MARK_EVERY = 30;
const noop = () => () => {};
const zero = () => 0;

/* Скорость самого экрана: четырнадцать развёрток, пока окно ничего не рисует (на нём ещё нет клипа). Живёт всё окно приложения. 0 — ещё не измерена. */
let displayMs = 0;
function probeDisplay() {
  if (displayMs || typeof requestAnimationFrame !== "function") return;
  const times = [];
  const tick = (time) => {
    times.push(time);
    /* Окно спрятано или кадры остановлены — замер не крутится вечно (две секунды); окно закрыто и rAF уже нет — не вызываем его. */
    if (
      times.length < 14 &&
      typeof requestAnimationFrame === "function" &&
      time - times[0] < 2000
    ) {
      requestAnimationFrame(tick);
      return;
    }
    if (times.length < 8) return;
    const gaps = times
      .slice(1)
      .map((value, at) => value - times[at])
      .sort((left, right) => left - right);
    displayMs = Math.max(4, Math.min(40, gaps[Math.floor(gaps.length * 0.3)]));
  };
  requestAnimationFrame(tick);
}

/* Холст сцены не больше экрана: выше этого окно не бывает, а размер, снятый с растущего родителя, раскрутил холст до 100 тысяч пикселей и положил видеокарту (1.11.2026). */
const MAX_STAGE_WIDTH = 3840;
const MAX_STAGE_HEIGHT = 2160;

/** Подпись клипа, что играет только началом (длиннее потолка дорожки или тяжелее предела памяти): «Показаны только первые 300 с клипа». */
export const cutText = (seconds) =>
  tr("Показаны только первые {0} с клипа").replace(
    "{0}",
    String(Math.round(seconds)),
  );

function Half({
  side,
  label,
  entry,
  state,
  hint,
  name,
  kind,
  preview,
  cut = 0,
}) {
  const failed = state.status === "error";
  return (
    <div
      className="animation-window"
      data-side={side}
      data-state={entry ? state.status : "empty"}
      data-preview={preview ? "" : undefined}
    >
      <span className="animation-window-label">{label}</span>
      {!entry && <p className="animation-window-note">{hint}</p>}
      {entry && state.status === "loading" && (
        <p className="animation-window-note" role="status">
          <i aria-hidden="true" />
          {tr("Готовлю анимацию…")}
        </p>
      )}
      {entry && failed && (
        <p className="animation-window-note is-error" role="alert">
          {tr("Клип не прочитался")}
          <small>{mainProcessText(state.error)}</small>
        </p>
      )}
      {entry && (
        <span className="animation-window-caption">
          <small className="animation-window-kind">
            {kind}
            {cut > 0 ? ` · ${cutText(cut)}` : ""}
          </small>
          <b className="animation-window-name">{name}</b>
        </span>
      )}
    </div>
  );
}

/* Настоящая длина клипа в секундах: из дорожки, что прочиталась; пока клип читается или не прочитался — длины нет (0), и полоса её не рисует. */
const lengthOf = (state) =>
  state.status === "ready" && state.track
    ? Number(state.track.clipDuration || state.track.duration) || 0
    : 0;

export default function AnimationStage({
  scene,
  shelf = null,
  gameRoot,
  server,
  mine,
  serverHint,
  mineHint,
}) {
  useTr();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const sizeRef = useRef(null);
  const loopRef = useRef(null);
  const viewsRef = useRef([null, null]);
  /* Часы клипа — по меткам развёртки: `start` < 0 — начало ставит следующий кадр (новый клип, конец паузы), `shown` — момент клипа на холсте. */
  const clockRef = useRef({ start: -1, pausedAt: 0, last: 0, shown: 0 });
  const cadenceRef = useRef(newCadence());
  /* Частота: средний интервал между кадрами, самый короткий из последних (скорость самого экрана), режим «на тридцать» и счёт кадров на разгон и между сменами разрешения. */
  const paceRef = useRef(newPace());
  const pausedRef = useRef(false);
  /* Метка проигрывания полосы длины: её ставит `AnimationDuration`, кадр сцены зовёт её с моментом клипа. */
  const headRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const serverState = useTrack(server, gameRoot) || EMPTY;
  const mineState = useTrack(mine, gameRoot) || EMPTY;
  /* Позы плиток приходят по мере снимков: пока клип читается, окно показывает запись в позе её плитки, а не пустоту. */
  useSyncExternalStore(shelf?.subscribe || noop, shelf?.version || zero);
  const shownTrack = (entry, state) =>
    state.status === "ready"
      ? state.track
      : state.status === "loading" && entry
        ? shelf?.pose(entry.id) || null
        : null;
  const serverTrack = shownTrack(server, serverState);
  const mineTrack = shownTrack(mine, mineState);

  /* Две «роли» персонажа — по одной на окно; живут, пока жива сцена. */
  useEffect(() => {
    paceRef.current = newPace();
    scene?.setScale?.(1);
    probeDisplay();
    if (!scene) return undefined;
    const views = [scene.makeView(), scene.makeView()];
    viewsRef.current = views;
    return () => {
      viewsRef.current = [null, null];
      for (const view of views) view?.dispose();
    };
  }, [scene]);

  const restart = useCallback(() => {
    /* Новый клип — новый разгон: первые кадры (сборка программ, дорожка в видеопамять) о скорости ничего не говорят. */
    paceRef.current.frames = 0;
    paceRef.current.interval = 0;
    paceRef.current.probe = null;
    const clock = clockRef.current;
    clock.start = -1;
    clock.pausedAt = 0;
    clock.last = 0;
    restartCadence(cadenceRef.current);
    loopRef.current?.invalidate();
  }, []);

  /* Клип сменился — оба окна начинаются заново, вместе. Поза плитки встаёт сразу; когда клип прочитан, он занимает её место. */
  useEffect(() => {
    const [left, right] = viewsRef.current;
    left?.setTrack(serverTrack);
    right?.setTrack(mineTrack);
    restart();
  }, [serverTrack, mineTrack, scene, restart]);

  useEffect(() => {
    const element = wrapRef.current;
    const canvas = canvasRef.current;
    if (!scene || !element || !canvas) return undefined;
    const measure = () => {
      const width = Math.floor(element.clientWidth);
      const height = Math.floor(element.clientHeight);
      sizeRef.current =
        width > 40 && height > 40
          ? [
              Math.min(MAX_STAGE_WIDTH, width - (width % 2)),
              Math.min(MAX_STAGE_HEIGHT, height),
            ]
          : null;
      loopRef.current?.invalidate();
    };
    measure();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    const loop = startStageLoop({
      element,
      /* Предел частоты — свой, по развёрткам (`cadenceDue`): шестьдесят, пока успевают; на слабой машине — тридцать (`paceRef`). */
      paused: () => pausedRef.current,
      frame(_time, { now, stopped, frameTime = now }) {
        const size = sizeRef.current;
        if (!size) return STAGE_IDLE;
        const pace = paceRef.current;
        const playing = viewsRef.current.some(
          (view) => view?.track?.frames > 1,
        );
        const running = playing && !stopped && !pausedRef.current;
        /* Идущий клип рисуется через одно и то же число развёрток; пауза, клип в один кадр и просьба со стороны — сразу. */
        if (
          running &&
          !cadenceDue(cadenceRef.current, frameTime, {
            maxFps: pace.half ? HALF_FPS : FULL_FPS,
            displayMs,
          })
        )
          return 0;
        const clock = clockRef.current;
        if (clock.start < 0) clock.start = frameTime - clock.pausedAt * 1000;
        const seconds = pausedRef.current
          ? clock.pausedAt
          : (frameTime - clock.start) / 1000;
        clock.shown = seconds;
        headRef.current?.(seconds);
        const dt = clock.last
          ? Math.min(0.1, (frameTime - clock.last) / 1000)
          : 0.016;
        clock.last = stopped ? 0 : frameTime;
        if (!running) restartCadence(cadenceRef.current);
        const views = viewsRef.current;
        for (const view of views) view?.pose(seconds);
        scene.renderViews(
          views.map((view) => (view?.track ? view : null)),
          canvas,
          size,
          dt,
        );
        if (playing) {
          /* Перерыв (пауза, вкладка спрятана) и разовые долгие кадры смены клипа в интервал не идут: он говорит о скорости кадров, а не о том,
             сколько окно простояло или собирало программы. */
          const next = stepPace(pace, {
            now: frameTime,
            scale: scene.scale,
            displayMs,
            minScale: scene.minScale,
          });
          if (next !== null) scene.setScale(next);
          const rate = pace.half ? "30" : "60";
          if (element.dataset.rate !== rate) element.dataset.rate = rate;
          if (pace.frames % MARK_EVERY === 0)
            element.dataset.interval = String(
              Math.round(pace.interval * 10) / 10,
            );
          const share = String(Math.round(scene.scale * 100) / 100);
          if (element.dataset.scale !== share) element.dataset.scale = share;
        }
        /* Что сейчас в холсте — для проверок и стенда (`scripts/perf/baseline/anim-stage.mjs`): запись левого окна и идёт ли клип. */
        const left = views[0]?.track;
        const shown = left?.id || "";
        if (element.dataset.drawn !== shown) element.dataset.drawn = shown;
        const motion = left && left.frames > 1 ? "1" : "";
        if (element.dataset.motion !== motion) element.dataset.motion = motion;
        /* Поза плитки стоит неподвижно — кадров не просит; кадры идут, только пока играет клип (хотя бы в одном окне). */
        return stopped || !playing ? STAGE_IDLE : 0;
      },
    });
    loopRef.current = loop;
    loop.invalidate();
    /* Стенд разработки (`scripts/perf/baseline/anim-cadence.mjs`): момент клипа на холсте — шаг движения против шага развёрток. */
    const probe = () => clockRef.current.shown;
    if (import.meta.env?.DEV) window.__astralAnimClock = probe;
    return () => {
      if (window.__astralAnimClock === probe) delete window.__astralAnimClock;
      loop.stop();
      loopRef.current = null;
      observer?.disconnect();
    };
  }, [scene]);

  const toggle = () => {
    const clock = clockRef.current;
    /* Пауза встаёт на том моменте, что сейчас на холсте; дальше клип идёт с него же — начало ставит следующий кадр по своей метке развёртки. */
    if (!pausedRef.current)
      clock.pausedAt = clock.start < 0 ? clock.pausedAt : clock.shown;
    clock.start = -1;
    clock.last = 0;
    restartCadence(cadenceRef.current);
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    loopRef.current?.invalidate();
  };

  return (
    <>
      <div
        className="animation-stage"
        ref={wrapRef}
        data-ready={scene ? "" : undefined}
      >
        <canvas
          className="animation-canvas"
          ref={canvasRef}
          aria-hidden="true"
        />
        <div className="animation-windows">
          <Half
            side="server"
            label={tr("На сервере")}
            entry={server}
            state={serverState}
            hint={serverHint}
            name={server?.name}
            kind={server ? kindLabel(server) : ""}
            preview={Boolean(serverTrack?.preview)}
            cut={serverTrack?.truncated ? serverTrack.duration : 0}
          />
          <Half
            side="mine"
            label={tr("У тебя")}
            entry={mine}
            state={mineState}
            hint={mineHint}
            name={mine?.name}
            kind={mine ? kindLabel(mine) : ""}
            preview={Boolean(mineTrack?.preview)}
            cut={mineTrack?.truncated ? mineTrack.duration : 0}
          />
          <span className="animation-arrow" aria-hidden="true">
            <ArrowRight />
          </span>
        </div>
        {(server || mine) && (
          <div
            className="animation-controls"
            role="group"
            aria-label={tr("Проигрывание")}
          >
            <Button
              variant="ghost"
              size="sm"
              icon={paused ? <Play /> : <Pause />}
              aria-label={paused ? tr("Играть") : tr("Пауза")}
              title={paused ? tr("Играть") : tr("Пауза")}
              onClick={toggle}
            />
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowCounterClockwise />}
              aria-label={tr("С начала")}
              title={tr("С начала")}
              onClick={restart}
            />
          </div>
        )}
      </div>
      <AnimationDuration
        serverLength={lengthOf(serverState)}
        serverName={server?.name || ""}
        mineLength={lengthOf(mineState)}
        mineName={mine?.name || ""}
        headRef={headRef}
      />
    </>
  );
}
