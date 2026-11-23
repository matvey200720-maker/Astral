import React, { Suspense, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { motionLeft } from "../../../components/ui/motion-quiet.js";
import { EDITOR_ROOM_ATTRIBUTE, editorRoomOpen } from "../../../components/ui/useEditorRoom.js";
import { CoverBakeContext } from "./cover-bake-context.js";
import { bakePersistent, forgetProvisionalBake, refuseBake, rememberBaked, rememberProvisionalBake } from "./cover-bake.js";
import { writeCoverFrame } from "./cover-frames.js";
import { coverComponent } from "./cover-loaders.js";
import { coverCanvasesIdle } from "./useCoverCanvas.js";

/*
 * Печь обложек (оптимизация 13.10.2026).
 *
 * Обложка рисуется тем же кодом, что и раньше, — но не на полке, а здесь: в
 * невидимом месте окна, по своей очереди и только в тихую минуту (колесо и
 * полоса прокрутки затихли, рейка и волна карточек доехали). Когда обложка
 * сказала «нарисовала» (`cover-bake-context.js`) и больше ничего не ждёт,
 * печь снимает её кадр — все холсты и картинки обложки на своих местах — в
 * WebP и кладёт в хранилище обложек. Полка показывает готовую картинку и
 * обложку живьём не рисует вовсе.
 *
 * Очередь: сначала то, что на экране полки (`priority` 1), потом остальные
 * плитки полки (0), потом прогрев после запуска (−1, только когда человек
 * ничего не делает). Одновременно — несколько обложек: большую часть времени
 * обложка ждёт (лист, снимок, шрифт), а не считает. Кроме прогрева: он идёт по
 * одной обложке с отдыхом (`warmPolicy` ниже) — на слабом ПК его вес был виден.
 *
 * Обложка, которую печь снять не может (ничего не нарисовала, упала,
 * нарисовала разметкой), отвечает `null` — полка показывает её живьём, как
 * прежде.
 *
 * С 25.10.2026 полка мастерской и библиотека печь не зовут: плитка редактора — готовая картинка с настоящего
 * предпросмотра (`stock-covers.js`), обложка работы — снимок кадра редактора при «Сохранить»
 * (`works/work-covers.js`), прогрева после запуска нет. Печь осталась для обложек частей каталога
 * (`features/catalog/part-covers/shooter-service.js`).
 */

const SLOTS = 4;
/* Тишина после последнего «нарисовала»: обложка могла дорисовать лист. */
const SETTLE_MS = 350;
/* Обложка ничего не нарисовала и ничего не ждёт — снимать нечего. */
const EMPTY_GIVE_UP_MS = 3000;
/* Потолок на обложку: снимок 3D-сцены ждёт листы игры до шести секунд. */
const JOB_LIMIT_MS = 25_000;
/* Квартал таймцикла читается из игры и собирает программы: первый раз — минуты на слабой машине.
   Жертва обложки попаданий — тело из архивов игры: первое чтение ждёт до минуты. Улица обложки
   «Фонарей» — тот же квартал плюс опись ламп игры и бандл со столбами: до ста секунд. */
const JOB_LIMITS_MS = { sky: 100_000, impact: 60_000, lamps: 100_000 };
const TICK_MS = 120;
/* Тихая минута — как у снимков сцен (`scene-snapshot.js`). */
const QUIET_MS = 260;
const START_GAP_MS = 40;
/* Прогрев стартует в тихом месте очереди кадров окна (`requestIdleCallback`), но не позже чем через столько. */
const IDLE_MOMENT_MS = 1000;

/*
 * Прогрев вежливый (23.10.2026).
 *
 * После запуска прогрев (`cover-prebake.js`) отдаёт печи все обложки полки с `priority: -1`, и в чистом профиле
 * печь пекла их четыре разом, одну за другой без передышки: на любой странице первые 75–80 с главный поток держали
 * 100–900 мс задачи (закрытая ×4, Windows: 81–133 долгих задач, самая долгая 448–923 мс, «занят» до 69 %) — у
 * тестеров на слабых ПК это тормоза сразу после запуска. Теперь:
 *
 *   - прогревных обложек в печи не больше `slots` (одна): обложки, что человек видит или что стоят на полке
 *     (`priority` ≥ 0), по-прежнему идут в четыре слота и прогрев не ждут;
 *   - после каждой прогревной обложки печь отдыхает `restMs`: передышка окну, а не следующий кадр сразу;
 *   - прогревная обложка стартует, только когда человек `idleInputMs` ничего не нажимал и не крутил, и только в
 *     тихом месте очереди кадров (`requestIdleCallback`), а не посреди его щелчка и входа на страницу.
 *
 * Пороги — одним объектом: стенд и тесты их двигают (`oven-warm.mjs`, `cover-oven.test.jsx`).
 */
export const warmPolicy = { slots: 1, restMs: 1500, idleInputMs: 2500 };
let warmRestUntil = 0;

/** Отдых прогрева кончен — следующая прогревная обложка может стартовать (тесты: отдых прошлого теста не переезжает). */
export function resetWarmRest() {
  warmRestUntil = 0;
}

const jobs = new Map();
const active = [];
const subscribers = new Set();
let order = 0;
let pumping = false;
let host = null;
let lastScroll = -Infinity;
let lastInput = -Infinity;

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  const scrolled = () => {
    lastScroll = performance.now();
    lastInput = lastScroll;
  };
  const touched = () => {
    lastInput = performance.now();
  };
  for (const type of ["wheel", "scroll", "touchmove"])
    window.addEventListener(type, scrolled, { passive: true, capture: true });
  for (const type of ["pointerdown", "pointermove", "keydown"])
    window.addEventListener(type, touched, { passive: true, capture: true });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Сон насоса, который будит появление видимой обложки: она не ждёт конца отдыха прогрева. */
const sleepers = new Set();
function nap(ms) {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      sleepers.delete(wake);
      resolve();
    };
    const timer = setTimeout(wake, ms);
    sleepers.add(wake);
  });
}
const wakePump = () => {
  for (const wake of [...sleepers]) wake();
};

/* Тихое место в очереди кадров окна: прогревная обложка стартует в нём, а не посреди чужой работы. Видимая обложка будит. */
function idleMoment() {
  return new Promise((resolve) => {
    let handle = 0;
    const wake = () => {
      sleepers.delete(wake);
      if (handle && typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
      resolve();
    };
    sleepers.add(wake);
    if (typeof requestIdleCallback !== "function") {
      setTimeout(wake, 0);
      return;
    }
    handle = requestIdleCallback(wake, { timeout: IDLE_MOMENT_MS });
  });
}

const warmCount = () => active.reduce((count, job) => count + (job.warm ? 1 : 0), 0);

function notify() {
  for (const listener of subscribers) listener();
}

/*
 * Сколько ещё ждать тихой минуты для обложки (0 — можно). Ждём короткими
 * шагами и после каждого берём лучший запрос заново: плитка на экране не
 * должна стоять за прогревом, который ждёт, пока человек отпустит мышь.
 */
/*
 * Открыт редактор (`data-editor-room`, 22.10.2026): полки за ним не видно, а снимок обложки — сцена, листы и
 * программы в главном потоке окна. Невидимое (плитки полки за редактором — `priority` 0, прогрев — −1) ждёт, пока
 * редактор закроют: на стенде (закрытая ×4) обложки воды и растительности держали кадр 210 мс на щелчке «Время
 * суток» в редакторе арен. Видимое (`priority` 1: обложка в панели вида ствола) печётся как прежде.
 */
const PAUSED = Infinity;
const pausedByEditor = (job) => job.priority < 1 && editorRoomOpen();

function waitFor(job) {
  if (pausedByEditor(job)) return PAUSED;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return 500;
  const now = performance.now();
  const sinceScroll = now - lastScroll;
  if (sinceScroll < QUIET_MS) return QUIET_MS - sinceScroll + 10;
  if (job.priority < 0 && now - lastInput < warmPolicy.idleInputMs) return warmPolicy.idleInputMs - (now - lastInput) + 10;
  if (motionLeft()) return 60;
  return 0;
}

/* Редактор закрыли — очередь идёт дальше. Новое видимое задание будит насос и раньше (`bakeCover`, `bumpCover`). */
let roomWatch = null;
function resumeAfterEditor() {
  if (roomWatch || typeof MutationObserver === "undefined") return;
  roomWatch = new MutationObserver(() => {
    if (editorRoomOpen()) return;
    roomWatch.disconnect();
    roomWatch = null;
    void pump();
  });
  roomWatch.observe(document.documentElement, { attributes: true, attributeFilter: [EDITOR_ROOM_ATTRIBUTE] });
}

function nextJob() {
  let best = null;
  for (const job of jobs.values()) {
    if (job.state !== "queued") continue;
    if (!best || job.priority > best.priority || (job.priority === best.priority && job.order < best.order)) best = job;
  }
  return best;
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      if (active.length >= SLOTS) return;
      const job = nextJob();
      if (!job) return;
      if (job.priority < 0) {
        /* Прогрев: не больше `slots` разом (допёк — `finish` разбудит насос) и с отдыхом после каждой. */
        if (warmCount() >= warmPolicy.slots) return;
        const rest = warmRestUntil - performance.now();
        if (rest > 0) {
          await nap(Math.min(rest, 250));
          continue;
        }
      }
      const wait = waitFor(job);
      /* Лучшее задание ждёт закрытия редактора — насос не крутится вхолостую, а встаёт снова сам. */
      if (wait === PAUSED) {
        resumeAfterEditor();
        return;
      }
      if (wait > 0) {
        await nap(Math.min(wait, 250));
        continue;
      }
      if (job.priority < 0) {
        await idleMoment();
        /* Пока ждали тихого места, задание могли отпустить, а видимая обложка — прийти: выбираем заново. */
        if (job.state !== "queued" || nextJob() !== job) continue;
      }
      job.state = "baking";
      job.warm = job.priority < 0;
      job.started = performance.now();
      active.push(job);
      ensureHost();
      notify();
      await sleep(START_GAP_MS);
    }
  } finally {
    pumping = false;
  }
}

/* Чем кончились последние задания — для замера (`coverOvenJobs`): запеклась обложка или осталась живой и почему.
   Обложка, которая остаётся живой, печётся заново на каждом запуске. */
const history = [];
const HISTORY_LIMIT = 80;

function finish(job, url, title = "", reason = "") {
  if (job.state === "done") return;
  job.state = "done";
  history.push({ kind: job.spec.kind, baked: Boolean(url), reason: url ? "" : reason || "без картинки", ms: job.started ? Math.round(performance.now() - job.started) : 0 });
  if (history.length > HISTORY_LIMIT) history.shift();
  const index = active.indexOf(job);
  if (index >= 0) active.splice(index, 1);
  if (job.warm) warmRestUntil = performance.now() + warmPolicy.restMs;
  jobs.delete(job.key);
  if (url) {
    rememberBaked(job.key, { url, title });
    if (bakePersistent(job.key)) void writeCoverFrame(job.key, url, { title });
    forgetProvisionalBake(job.key);
  } else {
    refuseBake(job.key);
    if (reason === "временный кадр") rememberProvisionalBake(job.key);
  }
  job.resolve(url || null);
  notify();
  void pump();
}

/**
 * Снять обложку `spec` (`{ kind, projectId, state }`) размера `size` под
 * ключом `key`. Ответ — `data:`-адрес картинки или `null` (снять нельзя).
 */
export function bakeCover(key, spec, size, { priority = 0 } = {}) {
  const known = jobs.get(key);
  if (known) {
    known.askers += 1;
    if (priority > known.priority) known.priority = priority;
    if (priority >= 0) wakePump();
    void pump();
    return known.promise;
  }
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  const job = { key, spec, size, priority, order: (order += 1), state: "queued", resolve, promise, started: 0, askers: 1 };
  jobs.set(key, job);
  if (priority >= 0) wakePump();
  void pump();
  return promise;
}

/**
 * Плитка, просившая обложку `key`, ушла (сменился размер плитки, закрыли полку).
 * Задание, которого больше никто не ждёт и которое ещё не началось, из очереди
 * выпадает — ключ старого размера не должен занимать печь. Отказом это не
 * считается: ключ не помечается «живым».
 */
export function releaseCover(key) {
  const job = jobs.get(key);
  if (!job) return;
  job.askers = Math.max(0, job.askers - 1);
  if (job.askers > 0 || job.state !== "queued") return;
  job.state = "done";
  jobs.delete(key);
  job.resolve(null);
  notify();
}

/**
 * Что сейчас в печи и чем кончились последние задания — для замера (`__astralPerf.ui.ovenJobs`, 21.10): одна и та же
 * минута печи после каждого запуска на Windows значит, что часть обложек не запекается и печётся заново.
 */
export function coverOvenJobs(now = performance.now()) {
  return {
    jobs: [...jobs.values()]
      .filter((job) => job.state !== "done")
      .map((job) => ({ kind: job.spec.kind, state: job.state, priority: job.priority, paused: job.state === "queued" && pausedByEditor(job), bakingMs: job.started ? Math.round(now - job.started) : 0 })),
    history: history.slice(),
  };
}

/**
 * Печь свободна: ни одна обложка не печётся и не ждёт очереди — кроме тех, что стоят до закрытия редактора (они
 * не начнутся, пока он открыт). Стенд ждёт её перед замером, чтобы фоновые обложки не попадали в числа.
 */
export function coverOvenIdle() {
  for (const job of jobs.values()) {
    if (job.state === "baking") return false;
    if (job.state === "queued" && !pausedByEditor(job)) return false;
  }
  return true;
}

/** Плитка подъехала к экрану — её обложка в очереди первая. */
export function bumpCover(key, priority = 1) {
  const job = jobs.get(key);
  if (job && job.state === "queued" && priority > job.priority) {
    job.priority = priority;
    if (priority >= 0) wakePump();
    void pump();
  }
}

/* ── Снимок кадра ──────────────────────────────────────────────────────── */

const visibleBox = (rect) => rect.width >= 1 && rect.height >= 1;

/* Где в кадре лежит рисунок с `object-fit`: откуда брать и куда класть. */
function fitted(fit, source, target) {
  if (fit !== "cover" && fit !== "contain") return { source: [0, 0, source.width, source.height], target };
  const scale =
    fit === "cover"
      ? Math.max(target.width / source.width, target.height / source.height)
      : Math.min(target.width / source.width, target.height / source.height);
  if (fit === "cover") {
    const width = target.width / scale;
    const height = target.height / scale;
    return {
      source: [(source.width - width) / 2, (source.height - height) / 2, width, height],
      target,
    };
  }
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    source: [0, 0, source.width, source.height],
    target: { left: target.left + (target.width - width) / 2, top: target.top + (target.height - height) / 2, width, height },
  };
}

/*
 * Все холсты и картинки обложки — на один холст, на своих местах и с
 * собственной прозрачностью. Разметка с рисунком (SVG, блоки) этим способом
 * не снимается — тогда `null`, и обложка остаётся живой.
 */
export function composeCover(root, size) {
  const frame = root.getBoundingClientRect();
  if (!visibleBox(frame)) return null;
  if ([...root.querySelectorAll("svg")].some((svg) => visibleBox(svg.getBoundingClientRect()))) return null;
  const ratio = size.ratio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(frame.width * ratio));
  canvas.height = Math.max(1, Math.round(frame.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) return null;
  let drawn = 0;
  for (const element of root.querySelectorAll("canvas, img")) {
    const rect = element.getBoundingClientRect();
    if (!visibleBox(rect)) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const alpha = Number(style.opacity);
    if (alpha <= 0) continue;
    const image = element.tagName === "IMG";
    if (image && (!element.complete || !element.naturalWidth)) continue;
    const source = image
      ? { width: element.naturalWidth, height: element.naturalHeight }
      : { width: element.width, height: element.height };
    if (!source.width || !source.height) continue;
    const place = fitted(style.objectFit, source, {
      left: (rect.left - frame.left) * ratio,
      top: (rect.top - frame.top) * ratio,
      width: rect.width * ratio,
      height: rect.height * ratio,
    });
    context.globalAlpha = Number.isFinite(alpha) ? Math.min(1, alpha) : 1;
    try {
      context.drawImage(element, ...place.source, place.target.left, place.target.top, place.target.width, place.target.height);
      drawn += 1;
    } catch {
      /* Холст с чужой картинкой не читается — такую обложку не печём. */
      return null;
    }
  }
  context.globalAlpha = 1;
  return drawn ? canvas : null;
}

function canvasUrl(canvas) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(canvas.toDataURL("image/webp", 0.9));
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      },
      "image/webp",
      0.9,
    );
  });
}

/* ── Невидимое место окна ──────────────────────────────────────────────── */

class OvenBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Mounted({ onMount }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return null;
}

/* Подпись картинок обложки: новая или догрузившаяся картинка — тоже «рисует». */
function imagesSignature(root) {
  let pending = false;
  let ready = 0;
  const parts = [];
  for (const image of root.querySelectorAll("img")) {
    if (!image.complete) pending = true;
    else if (image.naturalWidth) ready += 1;
    parts.push(`${image.currentSrc || image.src}:${image.complete}`);
  }
  return { pending, ready, text: parts.join("|") };
}

function OvenSlot({ job }) {
  const rootRef = useRef(null);
  const watch = useRef({ drawn: 0, last: 0, holds: new Set(), mounted: 0, failed: false, images: "", provisional: false });
  const context = useMemo(
    () => ({
      drawn() {
        watch.current.drawn += 1;
        watch.current.last = performance.now();
      },
      hold(id, on) {
        if (on) watch.current.holds.add(id);
        else watch.current.holds.delete(id);
        watch.current.last = performance.now();
      },
      /* Кадр обложки нарисован без листов игры, что ещё могут приехать. */
      provisional(on) {
        watch.current.provisional = Boolean(on);
        watch.current.last = performance.now();
      },
    }),
    [],
  );
  const onMount = useMemo(
    () => () => {
      watch.current.mounted = performance.now();
    },
    [],
  );
  const onFail = useMemo(
    () => () => {
      watch.current.failed = true;
    },
    [],
  );

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      if (stopped) return;
      const root = rootRef.current;
      const state = watch.current;
      const now = performance.now();
      /* Свёрнутое окно не рисует кадров — его время в потолок не идёт. */
      if (typeof document !== "undefined" && document.visibilityState === "hidden") job.started += TICK_MS;
      if (!root || state.failed || now - job.started > (JOB_LIMITS_MS[job.spec.kind] || JOB_LIMIT_MS)) {
        finish(job, null, "", !root ? "нет корня" : state.failed ? "ошибка обложки" : "потолок времени");
        return;
      }
      const images = imagesSignature(root);
      if (images.text !== state.images) {
        state.images = images.text;
        state.last = now;
      }
      const busy = state.holds.size > 0 || images.pending;
      const pictured = state.drawn > 0 || images.ready > 0;
      if (!busy && pictured && coverCanvasesIdle() && now - state.last >= SETTLE_MS) {
        /* Снимок — тоже в тихую минуту: он читает холсты обложки. */
        if (now - lastScroll < QUIET_MS || motionLeft()) {
          timer = setTimeout(tick, TICK_MS);
          return;
        }
        /* Кадр без листов игры, что ещё могут приехать, — временный: запечённый,
           он жил бы трое суток. Обложка остаётся живой (и дорисуется сама). */
        if (state.provisional) {
          finish(job, null, "", "временный кадр");
          return;
        }
        /* Подсказка обложки едет с картинкой («постановочный кадр…»). */
        const title = root.querySelector("[title]")?.getAttribute("title") || "";
        let url = null;
        try {
          const canvas = composeCover(root, job.size);
          url = canvas ? await canvasUrl(canvas) : null;
        } catch {
          /* Холст с чужой картинкой не читается — обложка останется живой. */
          url = null;
        }
        finish(job, url, title, url ? "" : "снимок не сложился");
        return;
      }
      if (!busy && !pictured && state.mounted && now - state.mounted > EMPTY_GIVE_UP_MS) {
        finish(job, null, "", "ничего не нарисовано");
        return;
      }
      timer = setTimeout(tick, TICK_MS);
    };
    timer = setTimeout(tick, TICK_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [job]);

  const Cover = coverComponent(job.spec.kind);
  const box = { position: "absolute", left: 0, top: 0, width: `${job.size.width}px`, height: `${job.size.height}px` };
  return (
    <div style={box}>
      <span ref={rootRef} className="workshop-cover" data-cover={job.spec.kind}>
        <CoverBakeContext.Provider value={context}>
          <OvenBoundary onFail={onFail}>
            <Suspense fallback={null}>
              {Cover && <Cover projectId={job.spec.projectId || ""} state={job.spec.state ?? null} kind={job.spec.kind} />}
              <Mounted onMount={onMount} />
            </Suspense>
          </OvenBoundary>
        </CoverBakeContext.Provider>
      </span>
    </div>
  );
}

const subscribe = (listener) => {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
};
let snapshot = [];
const activeSnapshot = () => {
  if (snapshot.length !== active.length || snapshot.some((job, index) => job !== active[index])) snapshot = [...active];
  return snapshot;
};

function OvenHost() {
  const baking = useSyncExternalStore(subscribe, activeSnapshot);
  return baking.map((job) => <OvenSlot key={job.key} job={job} />);
}

/*
 * Место печи — свой корень React в конце `body`: обложкам не нужен контекст
 * окна (язык — общий модуль), а полке не нужна печь в своём дереве. Место в
 * углу окна, прозрачное и мимо мыши: наблюдатели «подъехало к экрану» и
 * очередь кадров работают как на полке, а человек ничего не видит.
 * `desktop-app` — те же правила плашки обложки, что на полке.
 */
function ensureHost() {
  if (host || typeof document === "undefined") return;
  const container = document.createElement("div");
  container.className = "desktop-app cover-oven";
  container.setAttribute("aria-hidden", "true");
  container.dataset.auditIgnore = "covered";
  Object.assign(container.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "0",
    height: "0",
    minHeight: "0",
    display: "block",
    overflow: "visible",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
    contain: "layout style",
  });
  document.body.appendChild(container);
  host = createRoot(container);
  host.render(<OvenHost />);
}
