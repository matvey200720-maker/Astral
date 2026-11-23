import { useEffect, useMemo, useState } from "react";
import {
  PREVIEW_WEATHER,
  changedWeathers,
  lookIsNeutral,
  parseProject,
  referenceKeyframeDocument,
  resolveSkyState,
  weatherConditions,
} from "@modovik/timecycle";
import {
  previewDocument,
  previewProject,
} from "../../../components/desktop/workshop/sky/sky-preview.js";
import { detectInstallations, hasDesktopBridge } from "../../../api.js";
import { useCoverPending, useCoverProvisional } from "./cover-bake-context.js";
import { parseCoverState } from "./cover-data.js";
import { readCoverFrame, writeCoverFrame } from "./cover-frames.js";

/*
 * Обложка таймциклов — небо, нарисованное тем же шейдером, что и редактор.
 *
 * Небо нельзя сфотографировать вне игры, но его можно посчитать: у редактора
 * точный порт игрового шейдера, и обложка — его кадр. Стандартная обложка —
 * ясный день эталонного таймцикла; своя работа показывается своей погодой в
 * тот же час.
 *
 * Кадр снимается один раз и остаётся картинкой: живой контекст WebGL ради
 * неподвижной плитки — это видеопамять под кадр, который не меняется.
 * Рендерер (шейдер в семьдесят килобайт) приезжает отдельным куском и только
 * когда кадра ещё нет. Снятый кадр хранится между запусками
 * (`cover-frames.js`) под ключом, в котором есть и погода, и отпечаток
 * шейдера: полка открывается готовой картинкой, а не сборкой программы неба
 * посреди въезда карточек. Снимать новый кадр — в свободное время окна.
 * Без WebGL2 обложка остаётся спокойным градиентом дневного неба.
 *
 * Квартал из игры (задача 5 ТЗ 18.10.2026). Обложка плитки — не нарисованный
 * город, а тот же настоящий квартал из GTA V игрока, что в кадре редактора
 * (`timecycle-block/block-capture.js`): здания, дороги и пропы — из игры, небо и
 * свет — по таймциклу (штатному или правке работы). Читается из файлов игры,
 * поэтому печь снимает её не при запуске (`GAME_READING_COVERS`), а когда
 * человек открыл мастерскую. Без Astral Desktop, без игры или если квартал не
 * собрался — честная заглушка: прежний нарисованный город с подписью на самой
 * картинке, что он нарисован Astral и это не кадр из игры (в поставке нет
 * текстур Rockstar). Заглушка при Astral Desktop — «временный» кадр: печь его
 * не запекает, и подключённая позже игра даёт обложку сразу, а не через трое
 * суток.
 */

const COVER_HOUR = 14;
const COVER_REGION = "GLOBAL";
const COVER_CAMERA = Object.freeze({
  yaw: Math.PI / 2,
  pitch: 0.2,
  fov: 1.15,
  time: 0,
  showGround: true,
});
const FRAME = Object.freeze({ width: 640, height: 272 });

/* Кадры этого окна и снимки, которые уже идут: вторая плитка с тем же небом
   (полка и библиотека, двойной вызов эффекта в разработке) ждёт первый. */
const frames = new Map();
const capturing = new Map();

/* Свободное время окна: снимок неба — десятки миллисекунд главного потока. */
const idle = () =>
  new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function")
      window.requestIdleCallback(() => resolve(), { timeout: 1500 });
    else window.setTimeout(resolve, 200);
  });

/* Короткий отпечаток снимка правки: ключом кадра не должна быть сама правка. */
function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/*
 * Небо работы. Вид острова рисуется так же, как в кадре редактора: ясный день
 * эталона с видом поверх (`sky-preview.js`). Работа прежнего редактора без
 * вида — своей погодой, как и раньше.
 */
function coverState({ project, weather, hour = COVER_HOUR }) {
  if (project && !lookIsNeutral(project.look)) {
    const document = previewDocument(
      referenceKeyframeDocument(PREVIEW_WEATHER),
      project,
    );
    return resolveSkyState({
      document,
      project: previewProject(document, project.look),
      weather: PREVIEW_WEATHER,
      region: COVER_REGION,
      hour,
    });
  }
  return resolveSkyState({
    document: referenceKeyframeDocument(weather),
    project,
    weather,
    region: COVER_REGION,
    hour,
  });
}

/* Шейдер неба собирается мимо главного потока (`createSkyRendererAsync`): синхронная
   сборка стояла окно на секунду-две (Direct3D на процессоре). */
async function renderSky(createSkyRendererAsync, spec, size = FRAME) {
  const canvas = document.createElement("canvas");
  return paintSky(canvas, await createSkyRendererAsync(canvas), spec, size);
}

function paintSky(canvas, renderer, { project, weather }, size = FRAME) {
  try {
    renderer.resize(size.width, size.height, 1);
    renderer.render(
      coverState({ project, weather }),
      COVER_CAMERA,
      project && !lookIsNeutral(project.look)
        ? null
        : weatherConditions(weather),
    );
    return canvas.toDataURL("image/webp", 0.86);
  } finally {
    renderer.dispose();
  }
}

function captureSky(key, spec) {
  if (frames.has(key)) return Promise.resolve(frames.get(key));
  if (capturing.has(key)) return capturing.get(key);
  const job = (async () => {
    const { SKY_RENDERER_STAMP, createSkyRendererAsync } =
      await import("../../../components/desktop/workshop/sky-renderer.js");
    const stored = `sky:${key}:${SKY_RENDERER_STAMP}`;
    const kept = await readCoverFrame(stored);
    if (kept) return kept;
    await idle();
    /* Шейдер неба собирается мимо главного потока (оптимизация 13.10.2026):
       прежде сборка стояла окно секунду-две посреди въезда полки. */
    const canvas = document.createElement("canvas");
    const renderer = await createSkyRendererAsync(canvas);
    await idle();
    const url = paintSky(canvas, renderer, spec);
    void writeCoverFrame(stored, url);
    return url;
  })()
    .then((url) => {
      frames.set(key, url);
      return url;
    })
    .finally(() => capturing.delete(key));
  capturing.set(key, job);
  return job;
}

/* Какое небо на обложке: своя работа — той погодой, которую человек
   правил; ясная — первая, если она среди правленых. */
function skySpec(parsed) {
  const changed = parsed ? changedWeathers(parsed) : [];
  const looked = parsed ? !lookIsNeutral(parsed.look) : false;
  const shown = looked
    ? PREVIEW_WEATHER
    : changed.includes("CLEAR")
      ? "CLEAR"
      : changed[0] || "CLEAR";
  const own = looked || changed.length > 0;
  return { project: own ? parsed : null, weather: shown, own };
}

/**
 * Кадр обложки неба для проекта — `data:` WebP заданного размера. Тот же
 * кадр, что у плитки мастерской: им съёмщик частей при разборе редукса
 * (`part-covers/shooter-service.js`) запекает обложку неба мода.
 */
export async function skyCoverFrame(project, size = FRAME) {
  const { createSkyRendererAsync } =
    await import("../../../components/desktop/workshop/sky-renderer.js");
  const { project: own, weather } = skySpec(
    project ? parseProject(project) : null,
  );
  return renderSky(createSkyRendererAsync, { project: own, weather }, size);
}

/* «День мода» (11.10): утро, день, вечер, ночь — четыре кадра того же неба
   рядом. Один полдень показывал бледное небо над серыми коробками, и по нему
   было не понять, чем небо мода отличается от игры. */
const DAY_HOURS = Object.freeze([7, 13, 19, 23]);
const DAY_GAP = 6;

/**
 * Обложка неба части редукса — день мода полосами, `data:` WebP. Тем же
 * шейдером и сценой, что кадр обложки (`skyCoverFrame`), в часы `DAY_HOURS`.
 */
export async function skyCoverDay(project, size = FRAME) {
  const { createSkyRendererAsync } =
    await import("../../../components/desktop/workshop/sky-renderer.js");
  const { project: own, weather } = skySpec(
    project ? parseProject(project) : null,
  );
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#0c0c0c";
  context.fillRect(0, 0, size.width, size.height);
  /* Края полос — по общей сетке, а не `floor` одной ширины на всех: иначе
     640 − 3 × 6 делилось на четыре с остатком, и у правого края обложки
     оставалась тёмная полоска (владелец, 19.10.2026: «справа зазор на
     фотках таймов»). Последняя полоса доходит до края. */
  const count = DAY_HOURS.length;
  const edge = (index) =>
    Math.round((index * (size.width + DAY_GAP)) / count);
  const frame = document.createElement("canvas");
  const renderer = await createSkyRendererAsync(frame);
  try {
    let width = 0;
    for (const [index, hour] of DAY_HOURS.entries()) {
      const left = edge(index);
      const slice =
        (index === count - 1 ? size.width : edge(index + 1) - DAY_GAP) - left;
      if (slice !== width) {
        renderer.resize(slice, size.height, 1);
        width = slice;
      }
      renderer.render(
        coverState({ project: own, weather, hour }),
        { ...COVER_CAMERA, pitch: 0.4 },
        own && !lookIsNeutral(own.look) ? null : weatherConditions(weather),
      );
      context.drawImage(frame, left, 0);
    }
  } finally {
    renderer.dispose();
  }
  return canvas.toDataURL("image/webp", 0.9);
}

/*
 * «Сутки мода» (19.10.2026, владелец: «проигрыватель… чтобы проигрывались
 * сутки с 12 дня до 12 дня»): лист кадров того же неба — `SKY_CYCLE.frames`
 * часов подряд с полудня до полудня, `columns` в ряд. Страница мода крутит
 * его по кругу (`SkyCyclePlayer`): данных неба по часам в карточке каталога
 * нет, поэтому лист запекает разбор, как обложку (`gallery`, элемент
 * `{ kind: "sky-cycle", frames, columns, startHour, stepMinutes }`).
 */
export const SKY_CYCLE = Object.freeze({
  frames: 48,
  columns: 8,
  startHour: 12,
  stepMinutes: 30,
  width: 480,
  height: 270,
});

/**
 * Лист «сутки мода», `data:` WebP, и его разметка для `gallery`.
 * @returns {Promise<{ url: string, kind: "sky-cycle", frames: number, columns: number, startHour: number, stepMinutes: number }>}
 */
export async function skyCycleStrip(project, spec = SKY_CYCLE) {
  const { createSkyRendererAsync } =
    await import("../../../components/desktop/workshop/sky-renderer.js");
  const { project: own, weather } = skySpec(
    project ? parseProject(project) : null,
  );
  const { frames, columns, startHour, stepMinutes, width, height } = {
    ...SKY_CYCLE,
    ...spec,
  };
  const rows = Math.ceil(frames / columns);
  const canvas = document.createElement("canvas");
  canvas.width = width * columns;
  canvas.height = height * rows;
  const context = canvas.getContext("2d");
  const frame = document.createElement("canvas");
  const renderer = await createSkyRendererAsync(frame);
  try {
    renderer.resize(width, height, 1);
    for (let index = 0; index < frames; index += 1) {
      const hour = (startHour + (index * stepMinutes) / 60) % 24;
      renderer.render(
        coverState({ project: own, weather, hour }),
        { ...COVER_CAMERA, pitch: 0.4 },
        own && !lookIsNeutral(own.look) ? null : weatherConditions(weather),
      );
      context.drawImage(
        frame,
        (index % columns) * width,
        Math.floor(index / columns) * height,
      );
    }
  } finally {
    renderer.dispose();
  }
  return {
    url: canvas.toDataURL("image/webp", 0.85),
    kind: "sky-cycle",
    frames,
    columns,
    startHour,
    stepMinutes,
  };
}

/**
 * Небо мода по часам — кадры того же шейдера, что у «суток» и «дня мода»
 * (25.10.2026, «Таймцикл: видео на превью»): `onFrame(canvas, hour, index)` на
 * каждый час из `hours`. Холст один и тот же — его содержимое годно только
 * внутри вызова (кадр кодируется или снимается сразу), а `await` внутри
 * `onFrame` держит цикл: кодировщик видео не обгоняется кадрами.
 */
export async function skyHourFrames(project, { hours, size = FRAME }, onFrame) {
  const { createSkyRendererAsync } =
    await import("../../../components/desktop/workshop/sky-renderer.js");
  const { project: own, weather } = skySpec(
    project ? parseProject(project) : null,
  );
  const frame = document.createElement("canvas");
  const renderer = await createSkyRendererAsync(frame);
  try {
    renderer.resize(size.width, size.height, 1);
    for (const [index, hour] of hours.entries()) {
      renderer.render(
        coverState({ project: own, weather, hour }),
        { ...COVER_CAMERA, pitch: 0.4 },
        own && !lookIsNeutral(own.look) ? null : weatherConditions(weather),
      );
      await onFrame(frame, hour, index);
    }
  } finally {
    renderer.dispose();
  }
}

/* ── Квартал из игры ──────────────────────────────────────────────────── */

/* Игра игрока — один раз на окно: подключённая Legacy-установка или пусто. */
let gameRootPromise = null;
function legacyGameRoot() {
  if (!hasDesktopBridge()) return Promise.resolve("");
  gameRootPromise ??= Promise.resolve(detectInstallations())
    .then((games) => {
      const legacy = (Array.isArray(games) ? games : []).find(
        (item) => item?.path && String(item.edition || "Legacy").toLowerCase() === "legacy",
      );
      return legacy?.path || "";
    })
    .catch(() => "");
  return gameRootPromise;
}

/* Снятые кварталы этого окна и снимки, что уже идут: две плитки с одним небом ждут один. */
const quarters = new Map();
const quarterJobs = new Map();
/*
 * Квартал не снялся (нет секции карты, нет буфера с плавающей точкой, не уложился в срок) — новый снимок того
 * же неба не раньше, чем через `QUARTER_RETRY_MS`. Без этого каждый показ полки заводил контекст неба и
 * собирал его шейдер ради того же отказа (стенд смены редакторов, 20.10.2026: контекст на каждый возврат на
 * полку). В следующем сеансе окна — снова сразу.
 */
const QUARTER_RETRY_MS = 5 * 60_000;
const quarterFailed = new Map();

function captureQuarter(key, project) {
  if (quarters.has(key)) return Promise.resolve(quarters.get(key));
  if (quarterJobs.has(key)) return quarterJobs.get(key);
  if (Date.now() - (quarterFailed.get(key) ?? -Infinity) < QUARTER_RETRY_MS) return Promise.resolve(null);
  const job = (async () => {
    const gameRoot = await legacyGameRoot();
    if (!gameRoot) return null;
    /* Кадр квартала — отдельным куском: WebGL-сцена и компоновщик нужны только ему. */
    const { captureBlockFrame } = await import("../timecycle-block/block-capture.js");
    await idle();
    const result = await captureBlockFrame({ gameRoot, project });
    return result.url ? result : null;
  })()
    .catch(() => null)
    .then((result) => {
      if (result) {
        quarters.set(key, result);
        quarterFailed.delete(key);
      } else quarterFailed.set(key, Date.now());
      return result;
    })
    .finally(() => quarterJobs.delete(key));
  quarterJobs.set(key, job);
  return job;
}


export default function SkyCover({ state = null }) {
  const { project, weather, key, parsed } = useMemo(() => {
    let parsed = null;
    try {
      const stored = parseCoverState(state);
      parsed = stored ? parseProject(stored) : null;
    } catch {
      parsed = null;
    }
    const spec = skySpec(parsed);
    return {
      project: spec.project,
      weather: spec.weather,
      parsed,
      key: `${spec.weather}:${spec.own ? fingerprint(state) : "stock"}`,
    };
  }, [state]);
  const desktop = hasDesktopBridge();
  /* Кадр квартала называет работу: на другую работу — другой снимок. */
  const quarterKey = `block:${parsed ? fingerprint(state) : "stock"}`;
  const [quarter, setQuarter] = useState(() => (desktop ? quarters.get(quarterKey) || null : null));
  /* Ответ про квартал: ключ, на который он получен. Пока его нет, печь ждёт, а не берёт заглушку. */
  const [asked, setAsked] = useState(() => (!desktop || quarters.has(quarterKey) ? quarterKey : ""));
  const quarterPending = desktop && asked !== quarterKey;
  const [frame, setFrame] = useState(() => frames.get(key) || "");
  /* Кадр неба снимается — печь обложек ждёт его, а не градиент-заглушку. */
  const [gaveUp, setGaveUp] = useState("");
  const placeholder = !quarter && !quarterPending;
  useCoverPending(quarterPending || (placeholder && !frame && gaveUp !== key));
  /* Заглушка при Astral Desktop — кадр временный: игра может подключиться позже. */
  useCoverProvisional()(desktop && placeholder);

  useEffect(() => {
    if (!desktop) return undefined;
    if (quarters.has(quarterKey)) {
      setQuarter(quarters.get(quarterKey));
      setAsked(quarterKey);
      return undefined;
    }
    let alive = true;
    captureQuarter(quarterKey, parsed).then((result) => {
      if (!alive) return;
      setQuarter(result);
      setAsked(quarterKey);
    });
    return () => {
      alive = false;
    };
    // `parsed` меняется вместе с ключом работы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quarterKey, desktop]);

  /* Нарисованный город — только когда квартала нет и спрашивать больше нечего. */
  useEffect(() => {
    if (quarter || quarterPending) return undefined;
    if (frames.has(key)) {
      setFrame(frames.get(key));
      return undefined;
    }
    let alive = true;
    captureSky(key, { project, weather })
      .then((url) => alive && (url ? setFrame(url) : setGaveUp(key)))
      .catch(() => {
        /* WebGL2 нет или шейдер не собрался — остаётся градиент. */
        if (alive) setGaveUp(key);
      });
    return () => {
      alive = false;
    };
  }, [key, project, weather, quarter, quarterPending]);

  if (quarter)
    return (
      <img
        className="workshop-cover-image"
        src={quarter.url}
        alt=""
        draggable="false"
      />
    );
  if (frame)
    return <img className="workshop-cover-image" src={frame} alt="" draggable="false" />;
  return <span className="workshop-cover-sky-fallback" />;
}
