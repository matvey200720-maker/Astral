/*
 * Заставка запуска окна «Контур» и экран пробуждения после сна (15.11.2026): сам слой. Едет отдельным куском — в стартовый
 * кусок окна входит только `StartupSplash.jsx`, а первый кадр (знак, ореол) стоит в `index.html` (`#boot-splash`) и виден до
 * скриптов; этот слой встаёт на его место в том же кадре и снимает его.
 *
 * Ход берёт из `startup-flow.js`: свет идёт по настоящим этапам запуска. Движение рисует холст (`contour-engine.js`, ещё один
 * кусок): пока он грузится, стоят неподвижный знак и слова из разметки, так что запуск от него не зависит.
 */

import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { tr, useTr } from "../../../locales/ui.js";
import {
  motionEnabled,
  systemPrefersReducedMotion,
} from "../../../motion-preference.js";
import { STAR_D, STAR_SW, STAR_VIEWBOX } from "./star-glyph.js";
import {
  DONE_WORDS,
  FAIL_WORDS,
  LONG_WORDS,
  STAGE_WORDS,
  WAKE_WORDS,
} from "./splash-words.js";
import { WAKE_FLY_MS, wakeFrames, wakeLayout } from "./wake-model.js";
import { markLanding } from "./landing.js";
import { startupFlow as flow } from "./startup-flow.js";
import { WAKE_QA_MS } from "./startup-flow-qa.js";
import "./splash-contour.css";

const SplashFailure = lazy(() => import("./SplashFailure.jsx"));
const loadEngine = () => import("./contour-engine.js");
const loadHost = () => import("./contour-host.js");
const LEAVE_MS = 180;
// Метка на корне окна: `held` — оболочка под заставкой прозрачна, `released` — видна (`splash-contour.css`); со слоем заставки метка уходит.
const SHELL_HOLD = "data-startup-hold";
const holdShell = () =>
  document.documentElement.setAttribute(SHELL_HOLD, "held");
const releaseShell = () =>
  document.documentElement.setAttribute(SHELL_HOLD, "released");
const dropShell = () => document.documentElement.removeAttribute(SHELL_HOLD);
const POLL_MS = 60;

const FIRST = Object.freeze({ kind: "stage", index: 0, long: false });
// Спокойная версия: человек выключил анимации или система просит меньше движения (`?qa-splash-calm` — то же для песочницы).
const calmNow = () =>
  !motionEnabled() ||
  systemPrefersReducedMotion() ||
  (import.meta.env.DEV && window.location.search.includes("qa-splash-calm"));

const Star = ({ children }) => (
  <svg viewBox={STAR_VIEWBOX} focusable="false" aria-hidden="true">
    {children}
  </svg>
);

/** Слова фазы: [заголовок, пояснение] — русские ключи словаря, переводятся здесь. */
function wordsOf(phase) {
  if (phase.kind === "error") return [FAIL_WORDS.title, FAIL_WORDS.detail];
  if (phase.kind === "done") return DONE_WORDS;
  const [title, detail] = STAGE_WORDS[phase.index];
  return [title, phase.long ? LONG_WORDS : detail];
}

function ContourSplash() {
  useTr();
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const veilRef = useRef(null);
  const trackRef = useRef(null);
  const [calm] = useState(calmNow);
  const [phase, setPhase] = useState(FIRST);
  const [live, setLive] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    holdShell();
    return dropShell;
  }, []);

  useEffect(() => {
    let alive = true;
    let stop = () => {};
    let timer = 0;
    const giveUp = () => {
      // холст не доехал: окно не ждёт красоты, слой уходит, как только запуск закончен
      timer = window.setInterval(
        () => flow.isReady() && flow.finish(),
        POLL_MS,
      );
    };
    const parts = () => ({
      root: rootRef.current,
      canvas: canvasRef.current,
      veil: veilRef.current,
      track: [...trackRef.current.querySelectorAll("b")],
      flow,
      onPhase: setPhase,
      // уход начался — оболочка под заставкой становится видимой, пока открывается дыра для неё
      onExit: releaseShell,
      // страница входа едет отдельным куском: пока её нет на месте, уходить не на что
      hold: () => Boolean(document.querySelector("[data-onboarding-pending]")),
      onFinish: () => {
        setLeaving(true);
        timer = window.setTimeout(() => flow.finish(), LEAVE_MS);
      },
    });
    // Холст рисует воркер: занятый главный поток (каталог, сборка оболочки под заставкой) не рвёт движение света.
    // Нет воркера, спокойная версия, кадр песочницы на заданный миг — прежний цикл на главном потоке.
    const inThread = async () => {
      if (calm || (import.meta.env.DEV && flow.qa?.frozenAt != null))
        return false;
      try {
        const { startContourHosted } = await loadHost();
        if (!alive) return true;
        const hosted = await startContourHosted({
          ...parts(),
          onLive: () => alive && setLive(true),
          onBroken: giveUp,
        });
        if (!hosted) return false;
        if (alive) stop = hosted;
        else hosted();
        return true;
      } catch {
        return false;
      }
    };
    const onMainThread = async () => {
      const { startContour } = await loadEngine();
      if (!alive) return;
      stop = startContour({ ...parts(), calm });
      setLive(true);
    };
    inThread()
      .then((started) => started || onMainThread())
      .catch(giveUp);
    return () => {
      alive = false;
      stop();
      window.clearTimeout(timer);
      window.clearInterval(timer);
    };
  }, [calm]);

  const [title, detail] = wordsOf(phase);
  const failed = phase.kind === "error";
  return (
    <div
      className="startup-splash"
      data-mode="start"
      data-failed={failed ? "" : undefined}
      data-calm={calm ? "" : undefined}
      data-live={live && !calm ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
      ref={rootRef}
    >
      <div className="ss-veil" ref={veilRef} />
      <div className="ss-halo" />
      <div className="ss-mark">
        <Star>
          <g className="ss-ghost">
            <path d={STAR_D} />
            <path d={STAR_SW} />
          </g>
          <g className="ss-fill">
            <path d={STAR_D} />
            <path d={STAR_SW} />
          </g>
        </Star>
      </div>
      {calm ? null : (
        <canvas className="ss-canvas" ref={canvasRef} aria-hidden="true" />
      )}
      <div className="ss-text" role="status" aria-live="polite">
        {failed ? (
          <>
            <div className="ss-alert" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 7.5v5.5M12 16.6v.1" />
              </svg>
            </div>
            <div className="ss-kicker" data-audit-ignore="caps">
              {tr(FAIL_WORDS.kicker)}
            </div>
          </>
        ) : null}
        <h2
          className="ss-title"
          key={`t${phase.kind}${phase.index}${phase.long}`}
        >
          {tr(title)}
        </h2>
        <p
          className="ss-desc"
          key={`d${phase.kind}${phase.index}${phase.long}`}
        >
          {tr(detail)}
        </p>
        <div
          className="ss-track"
          ref={trackRef}
          hidden={failed}
          aria-hidden="true"
        >
          <i>
            <b />
          </i>
          <i>
            <b />
          </i>
          <i>
            <b />
          </i>
          <i>
            <b />
          </i>
        </div>
        {failed ? (
          <Suspense fallback={null}>
            <SplashFailure />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}

/** Пробуждение после сна (`wake.html`): тёмное окно, знак уже горит; окно открылось — знак уезжает в заголовок. */
function WakeSplash() {
  useTr();
  const rootRef = useRef(null);
  const veilRef = useRef(null);
  const chromeRef = useRef(null);
  const coreRef = useRef(null);
  const haloRef = useRef(null);
  const capRef = useRef(null);
  const [calm] = useState(calmNow);

  useEffect(() => {
    const root = rootRef.current;
    let timer = 0;
    let mark = null;
    const giveBack = () => {
      if (mark?.el) mark.el.style.visibility = "";
    };
    const end = () => {
      giveBack();
      flow.finish();
    };
    const fadeOut = (el, ms, delay = 0) =>
      el.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: ms,
        delay,
        fill: "forwards",
        easing: "ease-in-out",
      });
    // `at` — только песочница (`?qa-splash-at`): остановить уход на этом миге, как `?T=` у макета
    const leave = (at = null) => {
      window.clearInterval(timer);
      if (calm) {
        fadeOut(root, 220).finished.then(end, end);
        return;
      }
      mark = markLanding();
      if (mark.el) mark.el.style.visibility = "hidden";
      const box = root.getBoundingClientRect();
      const run = [
        coreRef.current.animate(
          wakeFrames(wakeLayout(box.width, box.height), mark.land),
          { duration: WAKE_FLY_MS, fill: "forwards", easing: "linear" },
        ),
        fadeOut(haloRef.current, 500),
        fadeOut(capRef.current, 260),
        fadeOut(chromeRef.current, 300, 150),
        fadeOut(veilRef.current, 450, 150),
      ];
      // знак ложится на место, под ним возвращается настоящий — и слой тает
      const landed = fadeOut(coreRef.current, 160, WAKE_FLY_MS);
      if (import.meta.env.DEV && at !== null) {
        for (const animation of [...run, landed]) {
          animation.pause();
          animation.currentTime = at;
        }
        return;
      }
      window.setTimeout(giveBack, WAKE_FLY_MS);
      landed.finished.then(end, end);
    };
    if (import.meta.env.DEV && flow.qa?.frozenAt != null) {
      if (flow.qa.frozenAt > WAKE_QA_MS) leave(flow.qa.frozenAt - WAKE_QA_MS);
      return () => giveBack();
    }
    timer = window.setInterval(
      () =>
        flow.isReady() &&
        !document.querySelector("[data-onboarding-pending]") &&
        leave(),
      POLL_MS,
    );
    return () => {
      window.clearInterval(timer);
      giveBack();
    };
  }, [calm]);

  return (
    <div
      className="startup-splash"
      data-mode="wake"
      data-calm={calm ? "" : undefined}
      ref={rootRef}
      role="status"
    >
      <div className="ss-veil ss-wake-veil" ref={veilRef} />
      <div className="ss-wake-chrome" ref={chromeRef} aria-hidden="true">
        <i className="a" />
        <i className="b" />
        <div>
          <b />
          <b />
          <b />
          <b />
          <b />
          <b />
          <b />
        </div>
      </div>
      <div className="ss-wake-core" ref={coreRef} aria-hidden="true">
        <div className="ss-wake-hw" ref={haloRef}>
          <div className="ss-wake-halo" />
        </div>
        <svg className="ss-wake-star" viewBox={STAR_VIEWBOX} focusable="false">
          <defs>
            <linearGradient id="ss-wake-lit" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#c8c8ce" />
              <stop offset="1" stopColor="#fff" />
            </linearGradient>
          </defs>
          <g className="ss-wake-dim">
            <path d={STAR_D} />
            <path d={STAR_SW} />
          </g>
          <g fill="url(#ss-wake-lit)">
            <path d={STAR_D} />
            <path d={STAR_SW} />
          </g>
        </svg>
      </div>
      <div className="ss-wake-cap" ref={capRef}>
        <b>{tr(WAKE_WORDS[0])}</b>
        <span>{tr(WAKE_WORDS[1])}</span>
      </div>
    </div>
  );
}

/** Слой заставки: запуск или пробуждение — какой из двух, решает ход окна (`startup-flow.js`). Первый кадр из `index.html` снимается здесь. */
export default function StartupSplashView() {
  useLayoutEffect(() => {
    document.getElementById("boot-splash")?.remove();
  }, []);
  return flow.isWaking() ? <WakeSplash /> : <ContourSplash />;
}
