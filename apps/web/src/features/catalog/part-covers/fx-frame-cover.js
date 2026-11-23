/*
 * Обложки частей-эффектов из сцен FX (25.10.2026, `docs/fx-scenes.md` §6, решение владельца 24.10 о кадрах игры для предпросмотра эффектов).
 *
 * Трассер, «Попадания» и килл-эффект части редукса или работы снимаются так же, как их показывает мастерская: настоящий кадр GTA V с картой
 * глубины (набор сцен, снятый стендом `tools/ingame-qa`), а поверх — эффект автора правилами частиц из игры игрока (`createFrameStage`).
 * Рисованного человека и рисованных штрихов на обложке нет. Печь (`catalog:render-covers`) отдаёт окну набор по `/api/fx-scenes/…` и базу
 * эффектов игры по `/fx-cover/base.json` (`scripts/part-shots-electron.js`); без них (набор не дан, игры нет, WebGL не завёлся) обложка
 * остаётся прежней, с прежней честной подписью.
 *
 * Миг выбирается счётом, а не на глаз, и каждый раз один и тот же: зёрна частиц сцены начинаются с одного числа (`deterministic`), шаг
 * времени — 1/60 с. Эффект автора отделяется от остального вычитанием: выстрел играется дважды — без эффекта автора (вспышка дула, штатное
 * попадание в стену остаются) и с ним — и считается площадь отличия, то есть только то, что принёс автор. Перед каждым прогоном выстрел
 * проигрывается вхолостую (`warm`): лист частицы грузится, только когда её впервые нарисовали, и без прогрева разницей двух прогонов была
 * бы загрузка листов, а не эффект.
 *
 *   hit    — один выстрел в тело (сцена вблизи, от третьего лица): площадь эффекта зоны «тело» растёт к пику; берётся первый миг, где
 *            она достигла `OPEN_SHARE` пика, но не самый первый кадр эффекта — раскрылся, но ещё не гаснет; кадр — по эффекту;
 *   core   — «Эффекты» редукса (ядро автора целиком, `fxCoreCover`): тот же кадр, но миг — разлёт (`spreadMoment`): где капли и куски ушли дальше всего от
 *            точки попадания и ещё видны; листы частиц автора рисуются по его сетке кадров (`ptxclipregions.dat` пакета), каждый — своим кадром;
 *   tracer — сцена сбоку (на виде от третьего лица след смотрит в камеру точкой); игра ставит след спрайтом на кадр игры, и пуля на этом
 *            расстоянии пролетает весь путь меньше чем за кадр, поэтому след — короткая черта у дула в первых кадрах выстрела. Берётся миг
 *            первых кадров, где след автора заметнее всего (в круге у дула), кадр — крупно по следу и дулу;
 *   kill   — кадр серии «падает» (+450 мс) с экранным эффектом автора на пике, слева тот же кадр без эффекта.
 *
 * Эффекта на кадре нет (правил нет, клон не собрался, площадь меньше порога) — `{ reason }`, обложка остаётся прежней: кадр без эффекта
 * не обложка эффекта.
 */

import { decodeDds, wholeMipLevels } from "@modovik/dds";
import { ASTRAL_TRACER_SHAPE, tracerShape } from "@modovik/tracer-contract";
import { tracerParticleShape } from "@modovik/ptfx-studio/tracer-slot.js";
import { tracerPreviewCanvas } from "../../../components/desktop/workshop/effects-preview.js";
import { impactZoneSprites } from "../../../components/desktop/workshop/impact-sim.js";
import { createFrameSource } from "../../workshop/fx-frame/frame-loader.js";
import { createFrameStage } from "../../workshop/fx-frame/frame-stage.js";

/* Размер обложки части — как у остальных кадров окна-съёмщика (`PART_SHOT`). */
export const FX_COVER = Object.freeze({ width: 1200, height: 800 });
/* Кадр читается уменьшенным: по нему считается площадь эффекта. След тонкий (пять сантиметров), ему нужен кадр мельче. */
const PROBE = Object.freeze({ width: 480, height: 270 });
const PROBE_FINE = Object.freeze({ width: 960, height: 540 });
/* Шаг времени сцены. */
const STEP = 1 / 60;
/* Точка отличается, если хоть один канал двух кадров разошёлся на столько (0–255): кадры из одной сцены с одними зёрнами, шума между ними нет. */
const DIFF = 28;
/* Эффект раскрылся: первый миг, где его площадь дошла до этой доли пика. */
export const OPEN_SHARE = 0.6;
/* Меньше стольких точек проверочного кадра эффект не виден — обложка прежняя. */
const MIN_AREA = 60;
const MIN_AREA_FINE = 12;
/* След — тонкая светлая черта поверх яркой вспышки: разница с кадром без следа мала, порог ниже. */
const TRACER_DIFF = 10;
/* Просмотр: попадание — до 1,5 с; след трассера живёт первые кадры выстрела — шесть, у дула, в круге такого радиуса (доли высоты кадра); у «без следа» берётся кадр, когда вспышка в разгаре. */
const HIT_SECONDS = 1.5;
const TRACER_SECONDS = 0.1;
/* Радиус зоны вокруг точки попадания (доли высоты кадра). */
const HIT_RADIUS = 0.3;
const TRACER_RADIUS = 0.16;
/* Кадр трассера: ширина окна (доля ширины кадра) и сдвиг его центра от дула вправо, вдоль пути пули. */
const TRACER_WIDTH = 0.2;
const TRACER_SHIFT = 0.035;
const FLASH_STEP = 2;
/* След тоньше точки проверочного кадра (25.10.2026: Nick V4 — белые искры толщиной 0,16, Blink x Skye — игла #444): разница по ячейке — доли
   яркости, и порог `TRACER_DIFF` её не видит, хотя усиленная разница показывает чёрточки вдоль пути пули. Тогда след мерится тонко — порог ниже,
   зона шире (чёрточки идут от дула далеко вправо) — и кадр берётся крупнее: кроп того же кадра вокруг следа, а не рисованный образец. */
const FAINT_DIFFS = [3, 1];
const FAINT_MIN_AREA = 6;
const FAINT_RADIUS = 0.45;
/* Окно держит дуло и ближайшие чёрточки: стрелок слева, след вправо — как на кадрах остальных трассеров. */
const FAINT_PAD = 1.6;
const FAINT_MIN_WIDTH = 0.14;
const FAINT_MAX_WIDTH = 0.24;
const FAINT_MUZZLE_MARGIN = { x: 0.04, y: 0.05 };
/* Килл: кадр серии, ближайший к этому сдвигу, мс («падает»). */
export const KILL_COVER_MS = 450;
/* Ждём листы частиц (картинки грузятся асинхронно). */
const SETTLE_MS = 8000;
/* Крупный кадр рисуется сцене с запасом разрешения (частицы чёткие, а не растянутые из 1920 × 1080), но не больше этого числа точек по ширине. */
const MAX_RENDER_WIDTH = 5760;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* --- Набор сцен и база --- */

let source = null;
const frames = new Map();
let basePromise = null;

const scenes = () => (source ??= createFrameSource({ base: "/api/fx-scenes" }));

/* Байты базы идут `{ "$bytes": base64 }` (как у кэша приложения, `ptfx-base-cache.js`) и возвращаются массивами байт. */
function reviveBytes(value) {
  if (Array.isArray(value)) return value.map(reviveBytes);
  if (value && typeof value === "object") {
    if (typeof value.$bytes === "string") return Uint8Array.from(atob(value.$bytes), (char) => char.charCodeAt(0));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, reviveBytes(item)]));
  }
  return value;
}

/** База эффектов игры от печи или `null`: игры нет. */
export function loadBase() {
  basePromise ??= fetch("/fx-cover/base.json", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((base) => (base ? reviveBytes(base) : null))
    .catch(() => null);
  return basePromise;
}

/** Сцена режима: записи манифеста → нужная → её файлы. `null`, если сцен нет. */
export async function loadScene({ mode, bone, view, distance }) {
  const entries = await scenes().list({ mode, bone });
  /* Нужный ракурс и расстояние, а нет такого в наборе — соседний (как в редакторе, `chooseView`). */
  const withView = view ? entries.filter((item) => (item.view || "side") === view) : entries;
  const viewed = withView.length ? withView : entries;
  const withDistance = distance ? viewed.filter((item) => item.distance === distance) : viewed;
  const entry = (withDistance.length ? withDistance : viewed)[0];
  if (!entry) return null;
  if (!frames.has(entry.id)) frames.set(entry.id, scenes().load(entry).catch(() => null));
  const frame = await frames.get(entry.id);
  return frame ? { entry, frame } : null;
}

/* --- Отладка: печь с `ASTRAL_FX_COVER_DEBUG=<папка>` принимает промежуточные кадры и ряды измерений --- */

let debugOn = null;
let debugCount = 0;
export const debugEnabled = () => (debugOn ??= fetch("/fx-cover/debug", { method: "HEAD" }).then((response) => response.ok, () => false));

export async function debugDump(name, what) {
  if (!(await debugEnabled())) return;
  const body = typeof what === "string" ? what : await new Promise((resolve) => what.toBlob(resolve, "image/png"));
  await fetch(`/fx-cover/debug?name=${encodeURIComponent(name)}`, { method: "POST", body }).catch(() => {});
}

/** Ряд измерений и кадры выстрела в названные мигах — в папку отладки, если печь её завела. */
async function debugFrames(prefix, stage, series, window, moments, picked) {
  if (!(await debugEnabled())) return;
  debugCount += 1;
  const tag = `${prefix}${debugCount}`;
  await debugDump(`${tag}-series.json`, JSON.stringify({ picked, series: series.map((item) => [item.area, item.mass, item.box, item.spread, item.parts]) }));
  for (const k of moments) if (k < series.length) await debugDump(`${tag}-t${String(k).padStart(3, "0")}.png`, stage.shotAt(k, window));
}

/**
 * Контактный лист мигов выстрела: мелкие кадры сеткой с подписью (миг, площадь, размах, куски) — чтобы выбор мига видно было глазами. Только при отладке печи.
 */
async function debugContact(prefix, stage, series, window, moments, picked) {
  if (!(await debugEnabled())) return;
  const columns = 4;
  const cell = { width: 450, height: 300 };
  const sheet = document.createElement("canvas");
  sheet.width = columns * cell.width;
  sheet.height = Math.ceil(moments.length / columns) * cell.height;
  const context = sheet.getContext("2d");
  context.fillStyle = "#222";
  context.fillRect(0, 0, sheet.width, sheet.height);
  moments.forEach((k, index) => {
    if (k >= series.length) return;
    const left = (index % columns) * cell.width;
    const top = Math.floor(index / columns) * cell.height;
    context.drawImage(stage.shotAt(k, window), left, top, cell.width, cell.height);
    const item = series[k];
    context.fillStyle = k === picked ? "#ff0" : "#fff";
    context.font = "bold 18px sans-serif";
    context.fillText(`k=${k} S=${item.area} r=${(item.spread ?? 0).toFixed(3)} n=${item.parts ?? 0}`, left + 8, top + 22);
  });
  await debugDump(`${prefix}${debugCount}-contact.png`, sheet);
}

/* --- Площадь отличия --- */

function createProbe(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return {
    /** Пиксели источника в размере проверочного кадра (копия). */
    grab(from) {
      context.drawImage(from, 0, 0, size.width, size.height);
      return context.getImageData(0, 0, size.width, size.height).data;
    },
  };
}

/** Зона: круг вокруг `at` (экранные доли), `radius` — доля высоты кадра; без `at` — весь кадр. */
function zoneMask(size, at = null, radius = 0) {
  const mask = new Uint8Array(size.width * size.height);
  if (!at) return mask.fill(1);
  const cx = at[0] * size.width;
  const cy = at[1] * size.height;
  const r = radius * size.height;
  for (let y = 0; y < size.height; y += 1)
    for (let x = 0; x < size.width; x += 1) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask[y * size.width + x] = 1;
  return mask;
}

/*
 * Разлёт — это когда эффект распался на куски и куски разошлись от точки попадания. Считается по тем же точкам отличия: `spread` — радиус, в который
 * уложилась `SPREAD_SHARE` точек (доли высоты кадра, от точки попадания), `parts` — сколько отдельных кусков (связных групп точек не мельче
 * `PART_MIN_POINTS`). Одно сплошное пятно — один кусок и малый радиус; брызги и капли — много кусков и большой радиус.
 */
export const SPREAD_SHARE = 0.9;
export const PART_MIN_POINTS = 3;
const SPREAD_BINS = 400;

/** `points` — номера точек отличия (`y * ширина + x`) в кадре размера `size`; `center` — точка попадания (доли кадра). */
export function diffShape(points, size, center) {
  if (!points.length) return { spread: 0, parts: 0 };
  const cx = center[0] * size.width;
  const cy = center[1] * size.height;
  const bins = new Uint32Array(SPREAD_BINS + 1);
  for (const at of points) {
    const x = at % size.width;
    const y = (at / size.width) | 0;
    bins[Math.min(SPREAD_BINS, Math.floor((Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / size.height) * SPREAD_BINS))] += 1;
  }
  const need = points.length * SPREAD_SHARE;
  let spread = 1;
  let counted = 0;
  for (let bin = 0; bin <= SPREAD_BINS; bin += 1) {
    counted += bins[bin];
    if (counted >= need) {
      spread = (bin + 1) / SPREAD_BINS;
      break;
    }
  }
  /* Куски: обход в ширину по четырём соседям; метка 1 — точка отличия, 2 — уже посчитана. */
  const marks = new Uint8Array(size.width * size.height);
  for (const at of points) marks[at] = 1;
  const stack = [];
  let parts = 0;
  for (const start of points) {
    if (marks[start] !== 1) continue;
    marks[start] = 2;
    stack.push(start);
    let count = 0;
    while (stack.length) {
      const at = stack.pop();
      count += 1;
      const x = at % size.width;
      for (const next of [x > 0 ? at - 1 : -1, x < size.width - 1 ? at + 1 : -1, at - size.width, at + size.width]) {
        if (next >= 0 && next < marks.length && marks[next] === 1) {
          marks[next] = 2;
          stack.push(next);
        }
      }
    }
    if (count >= PART_MIN_POINTS) parts += 1;
  }
  return { spread, parts };
}

/**
 * Чем один кадр отличается от другого: точки (`area`), их яркость (`mass`) и рамка в долях кадра. С `center` (точка попадания, доли кадра) — ещё размах
 * и число кусков (`diffShape`).
 */
export function measure(now, reference, mask, size, threshold = DIFF, center = null) {
  let area = 0;
  let mass = 0;
  let minX = size.width;
  let minY = size.height;
  let maxX = -1;
  let maxY = -1;
  const points = center ? [] : null;
  for (let at = 0; at < mask.length; at += 1) {
    if (!mask[at]) continue;
    const p = at * 4;
    const d = Math.max(Math.abs(now[p] - reference[p]), Math.abs(now[p + 1] - reference[p + 1]), Math.abs(now[p + 2] - reference[p + 2]));
    if (d <= threshold) continue;
    area += 1;
    mass += d;
    if (points) points.push(at);
    const x = at % size.width;
    const y = (at / size.width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const box = area ? { left: minX / size.width, top: minY / size.height, right: (maxX + 1) / size.width, bottom: (maxY + 1) / size.height } : null;
  return points ? { area, mass, box, ...diffShape(points, size, center) } : { area, mass, box };
}

/** Разница двух кадров, усиленная вшестеро, — только для отладки: видно, что именно принёс эффект. */
function amplifiedDifference(first, second) {
  const out = document.createElement("canvas");
  out.width = first.width;
  out.height = first.height;
  const a = first.getContext("2d").getImageData(0, 0, first.width, first.height);
  const b = second.getContext("2d").getImageData(0, 0, first.width, first.height);
  for (let at = 0; at < a.data.length; at += 4) {
    for (let c = 0; c < 3; c += 1) a.data[at + c] = Math.min(255, Math.abs(a.data[at + c] - b.data[at + c]) * 6);
    a.data[at + 3] = 255;
  }
  out.getContext("2d").putImageData(a, 0, 0);
  return out;
}

/**
 * Миг «эффект раскрылся»: первый, где площадь достигла `share` пика (пик берётся по `score`), но не самый первый кадр эффекта — того, где он
 * только появился. Эффект-однокадровка (пик — сам первый кадр) отдаёт следующий, пока тот ещё не меньше `share` пика, иначе пик. `null` — эффекта нет.
 */
export function openingMoment(series, { share = OPEN_SHARE, from = 0, score = (item) => item.area, minArea = MIN_AREA } = {}) {
  let peak = 0;
  let peakAt = -1;
  series.forEach((item, index) => {
    if (index < from) return;
    const value = score(item);
    if (value > peak) {
      peak = value;
      peakAt = index;
    }
  });
  if (peakAt < 0 || series[peakAt].area < minArea) return null;
  /* Первый кадр, где эффект уже заметен (хотя бы двадцатая доля пика): с него начинается раскрытие. */
  let first = from;
  while (first < peakAt && score(series[first]) < peak * 0.05) first += 1;
  for (let index = first + 1; index <= peakAt; index += 1) if (score(series[index]) >= peak * share) return index;
  const next = series[peakAt + 1];
  return peakAt === first && next && score(next) >= peak * share ? peakAt + 1 : peakAt;
}

/*
 * Миг разлёта (13.11.2026, владелец о «Эффектах» редукса: «они как PNG-шки, а должны прям как эффекты разлетаться»). Площадь отличия — мерка раскрытия
 * пятна, а не разлёта: у пятна-наклейки она максимальна сразу, а у брызг, распавшихся на капли, падает, когда капли разошлись. Разлёт — это далеко и ещё видно,
 * поэтому миг берётся по произведению размаха на корень площади: `spread · √area` — «как далеко ушло» на «сколько линейно осталось видно». Размах — радиус,
 * в который укладывается `SPREAD_SHARE` точек отличия от точки попадания (`diffShape`), поэтому одиночные брызги далеко от пятна его не раздувают. Кадры, где
 * видно меньше `SPREAD_VISIBLE` пика площади, не берутся: хвост из пары капель далеко от места не «разлёт». Неподвижная наклейка отдаёт кадр наибольшей площади,
 * как и раньше; мелкий дым без разлёта — пик дыма.
 */
export const SPREAD_VISIBLE = 0.2;

/** Балл разлёта кадра: размах на корень площади (0, если размаха нет). */
export const spreadScore = (item) => (item?.spread > 0 && item.area > 0 ? item.spread * Math.sqrt(item.area) : 0);

/**
 * Миг разлёта: кадр с наибольшим баллом среди видимых (первый из равных). `null` — эффекта на кадре нет (площадь пика меньше порога) или размаха не мерили
 * (ряд без `spread`).
 */
export function spreadMoment(series, { minArea = MIN_AREA, visible = SPREAD_VISIBLE } = {}) {
  const peak = series.reduce((most, item) => Math.max(most, item?.area || 0), 0);
  if (peak < minArea) return null;
  let best = null;
  let bestScore = 0;
  series.forEach((item, index) => {
    if (!(item?.area >= Math.max(minArea, peak * visible))) return;
    const score = spreadScore(item);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

/**
 * Тонкий след (см. `FAINT_DIFF`): миг, где он ярче всего, и окно вокруг него. `withTracer` и `without` — пиксели проверочных кадров выстрела
 * с авторским следом и без (по мигам), `muzzle` — дуло (доли кадра), `resolution` — размер кадра сцены. `null`, если и тонко мерить нечего.
 */
export function faintTracerMoment({ withTracer, without, muzzle, size = PROBE_FINE, resolution }) {
  const mask = zoneMask(size, muzzle, FAINT_RADIUS);
  for (const threshold of FAINT_DIFFS) {
    const series = withTracer.map((pixels, k) => (without[k] ? measure(pixels, without[k], mask, size, threshold) : { area: 0, mass: 0, box: null }));
    const moment = brightestMoment(series, { from: 1, minArea: FAINT_MIN_AREA });
    if (moment == null) continue;
    const { box } = series[moment];
    /* Рамка — след и дуло: окно берёт и стрелка, и чёрточки. */
    const rect = {
      left: Math.min(box.left, muzzle[0] - FAINT_MUZZLE_MARGIN.x),
      right: Math.max(box.right, muzzle[0] + FAINT_MUZZLE_MARGIN.x),
      top: Math.min(box.top, muzzle[1] - FAINT_MUZZLE_MARGIN.y),
      bottom: Math.max(box.bottom, muzzle[1] + FAINT_MUZZLE_MARGIN.y),
    };
    return {
      moment,
      series,
      threshold,
      window: windowAround(resolution, rect, { pad: FAINT_PAD, min: FAINT_MIN_WIDTH, max: FAINT_MAX_WIDTH }),
    };
  }
  return null;
}

/** Миг наибольшей яркости отличия: первый из равных. */
export function brightestMoment(series, { from = 0, minArea = MIN_AREA } = {}) {
  let best = -1;
  series.forEach((item, index) => {
    if (index >= from && (best < 0 || item.mass > series[best].mass)) best = index;
  });
  return best >= 0 && series[best].area >= minArea ? best : null;
}

/* --- Сцена с эффектом --- */

export async function settle(stage) {
  const started = Date.now();
  stage.drawNow();
  while (stage.inspect().pending > 0 && Date.now() - started < SETTLE_MS) {
    await sleep(60);
    stage.drawNow();
  }
}

/**
 * Сцена кадра с эффектом, листы частиц дождались. `run(секунды, each)` играет выстрел с начала шагами 1/60 с и зовёт `each(пиксели, k)`
 * на каждом (пиксели — копия кадра в размере `size`); `shotAt(k, окно, масштаб)` играет его заново до мига `k` и отдаёт обложку `FX_COVER`
 * — тем же ходом, поэтому кадр тот, что считали.
 */
async function openStage({ frame, base, zones = null, slot = null, single = false, size = PROBE }) {
  const canvas = document.createElement("canvas");
  const probe = createProbe(size);
  let current = null;
  let crop = null;
  let output = null;
  const stage = createFrameStage({
    canvas,
    share: false,
    deterministic: true,
    single,
    sprites: (zoneId, settings) => impactZoneSprites(zoneId, settings, null),
    onDraw: (gl) => {
      current = probe.grab(gl);
      if (crop && output) {
        const context = output.getContext("2d");
        context.imageSmoothingQuality = "high";
        context.drawImage(gl, crop.left, crop.top, crop.width, crop.height, 0, 0, output.width, output.height);
      }
    },
  });
  const { width, height } = frame.scene.resolution;
  stage.resize(width, height, 1);
  stage.setBase(base);
  if (zones) stage.setZones(zones, Object.keys(zones));
  if (slot) stage.setSlot(slot);
  stage.setFrame(frame);
  await settle(stage);
  let scale = 1;
  return {
    clean: probe.grab(frame.image),
    get ready() {
      return stage.ready;
    },
    get failures() {
      return stage.zoneFailures;
    },
    inspect: () => stage.inspect(),
    /** Зоны автора другие (пустые — выстрел без эффекта автора). */
    async useZones(next) {
      stage.setZones(next, Object.keys(next));
      await settle(stage);
    },
    /** Другой слот следа. */
    async useSlot(next) {
      stage.setSlot(next);
      await settle(stage);
    },
    run(seconds, each) {
      stage.shoot();
      stage.drawNow();
      each(current, 0);
      for (let k = 1; k <= Math.round(seconds / STEP); k += 1) {
        stage.advance(STEP);
        each(current, k);
      }
    },
    /**
     * Прогрев: выстрел играется целиком вхолостую и листы ждут. Лист частицы просится у банка, только когда её впервые нарисовали, и пока он
     * грузится, частица не видна: без прогрева первый прогон теряет вспышку и клон, а второй их показывает, и «отличие» двух прогонов — не эффект
     * автора, а загрузка листов.
     */
    async warm(seconds) {
      for (let pass = 0; pass < 2; pass += 1) {
        this.run(seconds, () => {});
        await settle(stage);
      }
    },
    shotAt(k, window, zoom = 1) {
      /* Крупный кадр — из сцены побольше: частицы остаются чёткими. Не вышло (видеопамять) — кадр прежнего размера. */
      const wanted = Math.max(1, Math.min(zoom, Math.floor(MAX_RENDER_WIDTH / width)));
      if (wanted !== scale) {
        stage.resize(width * wanted, height * wanted, 1);
        scale = wanted;
      }
      stage.shoot();
      for (let i = 0; i < k; i += 1) stage.advance(STEP);
      output = document.createElement("canvas");
      output.width = FX_COVER.width;
      output.height = FX_COVER.height;
      crop = { left: window.left * scale, top: window.top * scale, width: window.width * scale, height: window.height * scale };
      stage.drawNow();
      crop = null;
      return output;
    },
    dispose() {
      stage.dispose();
    },
  };
}

/** Пиксели проверочного кадра в холст — только для отладки. */
function pixelsCanvas(pixels, size) {
  const out = document.createElement("canvas");
  out.width = size.width;
  out.height = size.height;
  out.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels), size.width, size.height), 0, 0);
  return out;
}

/** Окно кадрирования 3:2 вокруг точки `center` (доли кадра) шириной `widthShare` долей кадра, внутри кадра. */
export function cropWindow(resolution, center, widthShare) {
  const ratio = FX_COVER.width / FX_COVER.height;
  const width = Math.min(resolution.width, Math.round(resolution.width * widthShare));
  const height = Math.round(width / ratio);
  const fitHeight = Math.min(height, resolution.height);
  const fitWidth = Math.round(fitHeight * ratio);
  const left = Math.min(Math.max(Math.round(center[0] * resolution.width - fitWidth / 2), 0), resolution.width - fitWidth);
  const top = Math.min(Math.max(Math.round(center[1] * resolution.height - fitHeight / 2), 0), resolution.height - fitHeight);
  return { left, top, width: fitWidth, height: fitHeight };
}

/**
 * Окно вокруг рамки `rect` (доли кадра): по её центру, шириной в `pad` рамок (высота рамки считается в ширинах обложки), но не уже `min`
 * и не шире `max` долей кадра.
 */
export function windowAround(resolution, rect, { pad = 2.2, min = 0.22, max = 0.9 } = {}) {
  const ratio = FX_COVER.width / FX_COVER.height;
  const aspect = resolution.width / resolution.height;
  const span = Math.max(rect.right - rect.left, ((rect.bottom - rect.top) * ratio) / aspect);
  return cropWindow(resolution, [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2], Math.min(max, Math.max(min, span * pad)));
}

/** Во сколько раз окно крупнее обложки: на столько сцене даётся запас разрешения. */
const zoomOf = (window) => Math.min(3, Math.ceil(FX_COVER.width / window.width));

async function pngOf(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/* --- Попадание --- */

/** Эффект зоны «тело» автора в точке попадания на кадре вблизи. `zone` — настройки зоны (`coverBodyZone`). Ответ — `{ png, note }` или `{ reason }`. */
export async function fxHitCover({ zone }) {
  const [base, loaded] = await Promise.all([loadBase(), loadScene({ mode: "hit", bone: "chest", view: "third", distance: "close" })]);
  if (!base?.tracerScene?.exports?.length) return { reason: "правил эффектов из игры нет (--game, --keys)" };
  if (!loaded) return { reason: "в наборе нет сцены попадания «в тело, вблизи»" };
  const { frame, entry } = loaded;
  const target = frame.scene.target;
  /* Выстрел без эффекта автора: вспышка, след и штатные частицы остаются, и вычитаются. */
  const stage = await openStage({ frame, base, zones: {}, single: true, size: PROBE });
  try {
    if (!stage.ready) return { reason: "правила частиц игры не собрались" };
    const without = [];
    await stage.warm(HIT_SECONDS);
    stage.run(HIT_SECONDS, (pixels) => without.push(pixels));
    await stage.useZones({ body: zone });
    if (stage.failures.length) return { reason: `слой эффекта не собрался: ${stage.failures[0]}` };
    await stage.warm(HIT_SECONDS);
    const mask = zoneMask(PROBE, target.screen, HIT_RADIUS);
    const series = [];
    const kept = {};
    stage.run(HIT_SECONDS, (pixels, k) => {
      if (k === 2) kept.with = pixels;
      series.push(measure(pixels, without[k], mask, PROBE));
    });
    if (await debugEnabled()) {
      await debugDump('probe-with-2.png', pixelsCanvas(kept.with, PROBE));
      await debugDump('probe-without-2.png', pixelsCanvas(without[2], PROBE));
      await debugDump('probe-clean.png', pixelsCanvas(stage.clean, PROBE));
    }
    const moment = openingMoment(series);
    const peak = Math.max(...series.map((item) => item.area));
    /* Кадр — по эффекту в выбранный миг, но не уже трети и не шире двух третей кадра. */
    const rect = moment == null ? null : series[moment].box;
    const window = rect ? windowAround(frame.scene.resolution, rect, { pad: 3, min: 0.36, max: 0.66 }) : cropWindow(frame.scene.resolution, target.screen, 0.5);
    await debugFrames("hit", stage, series, window, [0, 2, 4, 7, 12, 20, 32, 50, 80], moment);
    if (await debugEnabled()) {
      /* Что именно вычитается: те же миги с эффектом автора и без него и усиленная разница. */
      for (const k of [1, 2, 4, 8]) {
        const withZone = stage.shotAt(k, window);
        await debugDump(`hit${debugCount}-with-${k}.png`, withZone);
        await stage.useZones({});
        const bare = stage.shotAt(k, window);
        await debugDump(`hit${debugCount}-without-${k}.png`, bare);
        await debugDump(`hit${debugCount}-diff-${k}.png`, amplifiedDifference(withZone, bare));
        await stage.useZones({ body: zone });
      }
    }
    if (moment == null) return { reason: `эффект на кадре не виден (площадь ${peak} точек)` };
    const picture = stage.shotAt(moment, window, zoomOf(window));
    return { png: await pngOf(picture), note: `${entry.id} · ${(moment * STEP).toFixed(2)} с · площадь ${series[moment].area} из ${peak}` };
  } finally {
    stage.dispose();
  }
}

/* --- Трассер --- */

/** Размер следа слота Astral: штатный размер донора `bullet_tracer` из правил игры (правки размера у картинки нет). */
function donorShape(base) {
  const donor = tracerParticleShape(base?.tracerScene?.exports?.[0]?.particles?.bullet_tracer);
  const clamp = (value, range, fallback) => (Number.isFinite(value) && value > 0 ? Math.min(range.max, Math.max(range.min, value)) : fallback);
  return { width: clamp(donor?.width, ASTRAL_TRACER_SHAPE.width, 0.05), length: clamp(donor?.length, ASTRAL_TRACER_SHAPE.length, 0.7) };
}

/** DDS слота → холст 128×256 и размер следа. */
export function slotOf(dds, base) {
  const level = decodeDds(dds).levels[0];
  const canvas = document.createElement("canvas");
  canvas.width = level.width;
  canvas.height = level.height;
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(level.rgba), level.width, level.height), 0, 0);
  return { canvas, ...donorShape(base) };
}

/** След по профилю трассера мастерской (вид, цвета, сердцевина, толщина, длина) — тем же холстом и размером, что в редакторе «Трассеры». */
export function profileSlot(tracer) {
  const shape = tracerShape(tracer);
  return { canvas: tracerPreviewCanvas(tracer), width: shape.width, length: shape.length };
}

/** Прозрачный слот: у профиля «без трассера» (`off`) следа нет, вспышка и попадание остаются. */
export function emptySlot(base) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  return { canvas, ...donorShape(base) };
}

/**
 * Трассер на кадре игры: первые кадры выстрела очереди, миг, где след автора занимает больше всего.
 *
 * След — профиль мастерской (`tracer`: `style`, `colours`, `coreColour`, `thickness`, `length`), как рисует его редактор, или картинка
 * автора (`dds`, слой ядра Astral) на штатном размере слота. Игра ставит след по спрайту на кадр игры, а пуля на этом расстоянии пролетает
 * весь путь меньше чем за кадр, поэтому след — короткая яркая черта у дула на первых кадрах выстрела: смотреть его надо там, крупно, не дальше
 * зоны вокруг дула. Профиль «без трассера» (`off`) — честный кадр без следа: вспышка дула на месте, след не рисуется, и обложка так и подписана
 * (`framed: "tracer-off"`).
 *
 * Второй ракурс — только когда на заданном следа не видно ВОВСЕ (ALLIANCE V3 «Gray», 13.11.2026: тонкий белый след 2,4 × 36 см на виде сбоку — в 8–10 м от
 * камеры и на фоне светлого неба — не дал ни одной точки отличия, и части доставался кадр обзора): тот же выстрел снимается из-за плеча, где след у дула
 * в разы ближе к камере и идёт по тёмному фону. Кадр, который уже вышел (пусть тонкий), не переснимается: вид обложек принятых трассеров не меняется.
 */
export async function fxTracerCover({ tracer = null, dds = null, off = false, view = "side" }) {
  const first = await tracerShot({ tracer, dds, off, view });
  if (off || first.png) return first;
  const second = await tracerShot({ tracer, dds, off, view: view === "third" ? "side" : "third" }).catch((error) => ({ reason: String(error?.message || error) }));
  return secondView(first, second);
}

/** Итог двух ракурсов: кадр второго, если он вышел; иначе причина первого (к ней — что и второй ракурс следа не показал). */
export function secondView(first, second) {
  if (second?.png) return { ...second, note: `${second.note || ""} · второй ракурс: на первом ${first?.reason || "кадра нет"}` };
  return { ...first, reason: `${first?.reason || "кадра нет"}; второй ракурс: ${second?.reason || "кадра нет"}` };
}

async function tracerShot({ tracer, dds, off, view }) {
  const [base, loaded] = await Promise.all([loadBase(), loadScene({ mode: "tracer", view })]);
  if (!base?.tracerScene?.exports?.length) return { reason: "правил эффектов из игры нет (--game, --keys)" };
  if (!loaded) return { reason: "в наборе нет сцены трассера" };
  const slot = off ? null : tracer ? profileSlot(tracer) : dds ? slotOf(dds, base) : null;
  if (!off && !slot) return { reason: "в части нет ни профиля, ни картинки следа" };
  const { frame, entry } = loaded;
  const muzzle = frame.scene.muzzle.screen;
  const stage = await openStage({ frame, base, slot: emptySlot(base), size: PROBE_FINE });
  try {
    if (!stage.ready) return { reason: "правила следа игры не собрались" };
    const series = [];
    let moment;
    let faint = null;
    if (off) {
      /* Следа нет, мерить нечего: берётся кадр, когда вспышка дула в самом разгаре. */
      moment = FLASH_STEP;
    } else {
      /* Те же первые кадры выстрела без следа автора — и с ним: отличие в зоне дула — только след. */
      const mask = zoneMask(PROBE_FINE, muzzle, TRACER_RADIUS);
      const without = [];
      const withTracer = [];
      await stage.warm(TRACER_SECONDS);
      stage.run(TRACER_SECONDS, (pixels) => without.push(pixels));
      await stage.useSlot(slot);
      await stage.warm(TRACER_SECONDS);
      stage.run(TRACER_SECONDS, (pixels, k) => {
        withTracer.push(pixels);
        series.push(measure(pixels, without[k], mask, PROBE_FINE, TRACER_DIFF));
      });
      moment = brightestMoment(series, { from: 1, minArea: MIN_AREA_FINE });
      /* Заметного следа нет — тонкий: тот же кадр крупнее, вокруг следа. */
      if (moment == null) faint = faintTracerMoment({ withTracer, without, muzzle, resolution: frame.scene.resolution });
    }
    const peak = series.length ? Math.max(...series.map((item) => item.area)) : 0;
    /* Кадр у всех трассеров один: стрелок слева, вспышка и след вправо от дула, крупно, — обложки разных трассеров отличаются только следом. */
    const window = faint ? faint.window : cropWindow(frame.scene.resolution, [muzzle[0] + TRACER_SHIFT, muzzle[1]], TRACER_WIDTH);
    if (faint) moment = faint.moment;
    await debugFrames("tracer", stage, faint ? faint.series : series, window, [0, 1, 2, 3, 4, 5], moment);
    if (!off && (await debugEnabled())) {
      /* Что именно вычитается: те же миги с авторским следом и без него и усиленная разница. */
      for (const k of [1, 2, 3]) {
        const withTracer = stage.shotAt(k, window, zoomOf(window));
        await debugDump(`tracer${debugCount}-with-${k}.png`, withTracer);
        await stage.useSlot(emptySlot(base));
        const without = stage.shotAt(k, window, zoomOf(window));
        await debugDump(`tracer${debugCount}-without-${k}.png`, without);
        await debugDump(`tracer${debugCount}-diff-${k}.png`, amplifiedDifference(withTracer, without));
        await stage.useSlot(slot);
      }
    }
    if (moment == null) return { reason: `след на кадре не виден (площадь ${peak} точек)` };
    const picture = stage.shotAt(moment, window, zoomOf(window));
    const note = off
      ? `${entry.id} · ${(moment * STEP).toFixed(2)} с · вспышка без следа`
      : faint
        ? `${entry.id} · ${(moment * STEP).toFixed(2)} с · тонкий след (порог ${faint.threshold}), кадр крупнее (площадь ${faint.series[moment].area})`
        : `${entry.id} · ${(moment * STEP).toFixed(2)} с · площадь следа ${series[moment].area} из ${peak}`;
    return { png: await pngOf(picture), ...(off ? { framed: "tracer-off" } : {}), note };
  } finally {
    stage.dispose();
  }
}

/* --- Килл --- */

/** Кадр серии «падает» без эффекта слева и с экранным эффектом автора на пике справа. `paint(scene)` рисует эффект на холсте-сцене. */
export async function fxKillCover({ paint }) {
  const loaded = await loadScene({ mode: "kill", view: "third" });
  if (!loaded?.frame.frames?.length) return { reason: "в наборе нет серии кадров килла" };
  const { frame, entry } = loaded;
  const series = frame.frames;
  let at = 0;
  series.forEach((item, index) => {
    if (Math.abs(item.offsetMs - KILL_COVER_MS) < Math.abs(series[at].offsetMs - KILL_COVER_MS)) at = index;
  });
  const shot = series[at];
  const { width, height } = frame.scene.resolution;
  const target = frame.scene.target.screen;
  const window = cropWindow({ width, height }, [target[0] - 0.12, target[1]], 0.84);
  const { width: outWidth, height: outHeight } = FX_COVER;
  const scene = document.createElement("canvas");
  scene.width = outWidth;
  scene.height = outHeight;
  const sceneContext = scene.getContext("2d");
  sceneContext.imageSmoothingQuality = "high";
  sceneContext.drawImage(shot.image, window.left, window.top, window.width, window.height, 0, 0, outWidth, outHeight);
  const effect = document.createElement("canvas");
  effect.width = outWidth;
  effect.height = outHeight;
  paint({ context: effect.getContext("2d"), width: outWidth, height: outHeight, scene });
  const out = document.createElement("canvas");
  out.width = outWidth;
  out.height = outHeight;
  const context = out.getContext("2d");
  const gap = 6;
  const half = Math.floor((outWidth - gap) / 2);
  context.fillStyle = "#0c0c0c";
  context.fillRect(0, 0, outWidth, outHeight);
  context.drawImage(scene, 0, 0, half, outHeight, 0, 0, half, outHeight);
  const right = outWidth - half;
  context.drawImage(effect, right, 0, half, outHeight, right, 0, half, outHeight);
  return { png: await pngOf(out), note: `${entry.id} · кадр ${shot.index} (+${shot.offsetMs} мс)` };
}

/* --- Карточка ядра эффектов («наш Core», Х20 29.10.2026) --- */

/* Лист автора крупнее этого по длинной стороне уменьшается (память видеокарты окна-съёмщика). */
export const SHEET_EDGE_MAX = 2048;

/** Размер листа на сцене: свой, не крупнее `SHEET_EDGE_MAX` по длинной стороне, с прежней пропорцией. */
export function sheetSize(width, height) {
  const scale = Math.min(1, SHEET_EDGE_MAX / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/*
 * Лист карточки — записью базы: сетка — автора (`ptxclipregions.dat` его пакета), иначе как у листа игры под тем же именем, иначе 1×1. Размер — свой, не
 * как у штатного листа: 13.11.2026 у HALLOWEEN `ptfx_blood_spray` — 2880 × 2880 (кадр 411 точек), а штатный лист в базе — превью, и пятно на кадре выходило мыльным.
 */
async function sheetOfDds(bytes, like, grid) {
  const top = decodeDds(wholeMipLevels(bytes)).levels[0];
  const { width, height } = sheetSize(top.width, top.height);
  const full = document.createElement("canvas");
  full.width = top.width;
  full.height = top.height;
  full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(top.rgba), top.width, top.height), 0, 0);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(full, 0, 0, width, height);
  return { width, height, columns: grid?.columns || like?.columns || 1, rows: grid?.rows || like?.rows || 1, png: await pngOf(canvas) };
}

/* Окно кадра попадания вокруг рамки эффекта: обычное — не уже трети и не шире двух третей кадра; крупное (`plan.fine`) — для эффекта с ладонь. */
const HIT_FRAMING = Object.freeze({ pad: 3, min: 0.36, max: 0.66 });
const HIT_FRAMING_FINE = Object.freeze({ pad: 4, min: 0.18, max: 0.5 });

/* Какой кадр выстрела берётся, когда попадание автора ничего не рисует и вспышку найти не удалось: стрелок уже выстрелил, цель ещё стоит. */
const BLANK_HIT_MOMENT = 4;
/* Окно кадра «попадание без эффекта»: стрелок со стволом слева, цель в центре — видно и выстрел, и то, что крови на цели нет. */
const BLANK_HIT_WIDTH = 0.34;
/* Вспышка выстрела ищется в первых шагах против спокойного кадра (вспышки уже нет): точка «вспышки» ярче спокойной на столько по сумме каналов. */
const FLASH_SCAN = 12;
const FLASH_STEADY = 30;
const FLASH_GAIN = 150;
const FLASH_MIN_AREA = 12;

/**
 * Шаг, на котором вспышка выстрела ярче всего: `frames[k]` — пиксели проверочного кадра шага `k` (RGBA), `steady` — кадр, где вспышки уже нет.
 * `null` — вспышки не видно (её нет в кадре или автор её убрал).
 */
export function flashMoment(frames, steady) {
  if (!steady) return null;
  let best = null;
  let bestMass = 0;
  frames.forEach((pixels, k) => {
    if (!pixels) return;
    let area = 0;
    let mass = 0;
    for (let p = 0; p < pixels.length; p += 4) {
      const gain = pixels[p] + pixels[p + 1] + pixels[p + 2] - steady[p] - steady[p + 1] - steady[p + 2];
      if (gain < FLASH_GAIN) continue;
      area += 1;
      mass += gain;
    }
    if (area >= FLASH_MIN_AREA && mass > bestMass) {
      best = k;
      bestMass = mass;
    }
  });
  return best;
}

/* Сцена трассера с правкой карточки: выстрел длится столько (вспышка, след, искры и крошка попадания в стену). */
const CORE_TRACER_SECONDS = 0.6;

/*
 * След сцены — слотом из правила `bullet_tracer` своей базы, без картинки (лист — игры или карточки) и с его же размером: штатный след
 * без слота на этом расстоянии не рисуется — пуля пролетает путь меньше чем за кадр (`combat-shot-fx.js`, `tracerStrokes`).
 */
function ruleSlot(base) {
  const shape = tracerParticleShape(base?.tracerScene?.exports?.[0]?.particles?.bullet_tracer);
  const fallback = donorShape(base);
  return { canvas: null, width: shape?.width > 0 ? shape.width : fallback.width, length: shape?.length > 0 ? shape.length : fallback.length };
}

/*
 * Правка карточки на кадре игры: выстрел с базой игры и с базой, в которую вписана правка (`core-cover.js`). Кровь — сцена
 * попадания в тело; вспышка карабина, след, попадание в стену — сцена трассера. `card` — `{ strategy, merge, patches?, effects?,
 * dds: [{ name, bytes }], grids?, ownExport? }`. Ответ — `{ png, note }` или `{ reason }`.
 */
export async function fxCoreCover({ card }) {
  const [{ coreCoverPlan }, base] = await Promise.all([import("./core-cover.js"), loadBase()]);
  if (!base?.impact?.model && !base?.tracerScene?.exports?.length) return { reason: "правил эффектов из игры нет (--game, --keys)" };
  const known = { ...(base.tracerScene?.sheets || {}), ...(base.impact?.sheets || {}) };
  const sheets = {};
  for (const { name, bytes } of card.dds || []) {
    const key = Object.keys(known).find((item) => item.toLowerCase() === name.toLowerCase());
    sheets[key || name] = await sheetOfDds(bytes, known[key], card.grids?.[name.toLowerCase()]);
  }
  const plan = coreCoverPlan(base, { ...card, sheets });
  if (!plan.scene) return { reason: plan.reason };
  if (plan.scene === "tracer") return coreTracerCover(base, plan);
  const loaded = await loadScene({ mode: "hit", bone: "chest", view: "third", distance: "close" });
  if (!loaded) return { reason: "в наборе нет сцены попадания «в тело, вблизи»" };
  const { frame, entry } = loaded;
  const target = frame.scene.target;
  /* Попадание автора бывает с ладонь (владелец 12.11.2026 о GODMODE: «эффекты попадания, они там чёрные» — на общем плане чёрных брызг не видно):
     такой план (`fine`) меряется на крупном проверочном кадре с малым порогом площади и снимается окном по самому эффекту. */
  const fine = plan.fine === true;
  const size = fine ? PROBE_FINE : PROBE;
  const framing = fine ? HIT_FRAMING_FINE : HIT_FRAMING;
  /* Без карточки: та же зона на базе игры (у своих частиц — выстрел без эффекта зоны). */
  const without = [];
  const plain = await openStage({ frame, base, zones: plan.withoutZones, single: true, size });
  try {
    if (!plain.ready) return { reason: "правила частиц игры не собрались" };
    await plain.warm(HIT_SECONDS);
    plain.run(HIT_SECONDS, (pixels) => without.push(pixels));
  } finally {
    plain.dispose();
  }
  /* Попадание не видно — кадр выстрела без эффекта (автор убрал кровь) или причина. */
  let missed = null;
  const stage = await openStage({ frame, base: plan.base, zones: plan.withZones, single: true, size });
  try {
    if (!stage.ready) return { reason: "правила частиц с правкой карточки не собрались" };
    if (stage.failures.length) return { reason: `слой эффекта не собрался: ${stage.failures[0]}` };
    await stage.warm(HIT_SECONDS);
    const mask = zoneMask(size, target.screen, HIT_RADIUS);
    const series = [];
    let mid = null;
    const early = [];
    let steady = null;
    stage.run(HIT_SECONDS, (pixels, k) => {
      series.push(measure(pixels, without[k], mask, size, DIFF, target.screen));
      if (k <= FLASH_SCAN) early[k] = pixels;
      if (k === FLASH_STEADY) steady = pixels;
      if (k === 8) mid = stage.inspect();
    });
    /* «Эффекты» автора (`plan.scatter`): миг — разлёт (`spreadMoment`), а не раскрытие пятна, — брызги и капли, и обложка должна показать, как они разошлись.
       Карточки «нашего Core» (лист, числа, свои правила) — прежний миг раскрытия: их обложки приняты. */
    const options = fine ? { minArea: MIN_AREA_FINE } : {};
    const moment = plan.scatter ? spreadMoment(series, options) : openingMoment(series, options);
    const peak = Math.max(...series.map((item) => item.area));
    if (moment != null) {
      const rect = series[moment].box;
      const window = rect ? windowAround(frame.scene.resolution, rect, framing) : cropWindow(frame.scene.resolution, target.screen, 0.5);
      await debugFrames("core-hit", stage, series, window, [-8, -4, 0, 4, 8, 12, 16].map((shift) => moment + shift).filter((k) => k >= 0), moment);
      await debugContact("core-hit", stage, series, window, [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 70], moment);
      const picture = stage.shotAt(moment, window, zoomOf(window));
      return { png: await pngOf(picture), note: `${entry.id} · ${plan.label} · ${(moment * STEP).toFixed(2)} с · площадь ${series[moment].area} из ${peak}${plan.scatter ? ` · разлёт ${series[moment].spread.toFixed(3)} высоты кадра, кусков ${series[moment].parts}` : ""}` };
    }
    await debugFrames("core-hit-missed", stage, series, cropWindow(frame.scene.resolution, target.screen, 0.3), [2, 4, 8, 16, 30], null);
    if (plan.blankOk) {
      /* Попадание автора ничего не рисует (кровь убрана или её листы — пустышки): миг выстрела — вспышка у ствола, цель без крови; признак `hit-off` —
         подпись обложки скажет об этом. Это и есть картинка «Эффектов» такого редукса, а не кадр со сцены трассера (владелец 13.11.2026). */
      const flash = flashMoment(early, steady);
      const at = Math.min(flash ?? BLANK_HIT_MOMENT, series.length - 1);
      const blankWindow = cropWindow(frame.scene.resolution, target.screen, BLANK_HIT_WIDTH);
      const picture = stage.shotAt(at, blankWindow, zoomOf(blankWindow));
      missed = { png: await pngOf(picture), framed: "hit-off", note: `${entry.id} · ${plan.label} · эффекта на кадре нет (площадь ${peak} точек; частиц зоны ${mid?.hits ?? "?"}, листов ждут ${mid?.pending ?? "?"}) · ${flash == null ? "вспышки не видно" : "вспышка выстрела"}, ${(at * STEP).toFixed(2)} с` };
    } else {
      /* Что играла зона в середине выстрела — чтобы «не видна» было объяснимо (частиц нет или они вне кадра). */
      missed = { reason: `правка карточки на кадре не видна (площадь ${peak} точек; частиц зоны ${mid?.hits ?? "?"}, листов ждут ${mid?.pending ?? "?"})` };
    }
  } finally {
    stage.dispose();
  }
  return missed;
}

/*
 * Сцена трассера сбоку: один выстрел — с базой игры и с правкой карточки. Отличие мерится там, где правка видна (`plan.spots`): у дула
 * (вспышка, след — тот же кадр, что у обложек трассеров, `fxTracerCover`) или в точке попадания в стену (искры, крошка); порог — как у
 * тонкого следа. Кадр — место, где отличие ярче, крупно: по рамке всего отличия окно вышло бы на весь путь пули, и тонкий след в нём не виден.
 */
async function coreTracerCover(base, plan) {
  const loaded = await loadScene({ mode: "tracer", view: "side" });
  if (!loaded) return { reason: "в наборе нет сцены трассера" };
  const { frame, entry } = loaded;
  const without = [];
  /* Зоны плана — у обоих прогонов: попадание в человека на этой сцене одно и то же, отличие мерится только у выстрела. */
  const plain = await openStage({ frame, base, zones: plan.zones || null, slot: ruleSlot(base), single: true, size: PROBE_FINE });
  try {
    if (!plain.ready) return { reason: "правила следа игры не собрались" };
    await plain.warm(CORE_TRACER_SECONDS);
    plain.run(CORE_TRACER_SECONDS, (pixels) => without.push(pixels));
  } finally {
    plain.dispose();
  }
  const stage = await openStage({ frame, base: plan.base, zones: plan.zones || null, slot: ruleSlot(plan.base), single: true, size: PROBE_FINE });
  try {
    if (!stage.ready) return { reason: "правила следа с правкой карточки не собрались" };
    await stage.warm(CORE_TRACER_SECONDS);
    const muzzle = frame.scene.muzzle.screen;
    /* Где смотреть, решает план: след и вспышка — у дула, попадание в стену — в точке попадания первого выстрела. */
    const centers = { muzzle: [muzzle[0] + TRACER_SHIFT, muzzle[1]], impact: frame.scene.impacts?.[0]?.screen || frame.scene.target?.screen };
    const spots = (plan.spots?.length ? plan.spots : ["muzzle"])
      .filter((id) => centers[id])
      .map((id) => ({ id, center: centers[id], series: [], mask: zoneMask(PROBE_FINE, centers[id], TRACER_RADIUS) }));
    const withCard = [];
    stage.run(CORE_TRACER_SECONDS, (pixels, k) => {
      withCard.push(pixels);
      for (const spot of spots) spot.series.push(measure(pixels, without[k], spot.mask, PROBE_FINE, TRACER_DIFF));
    });
    const mass = (spot) => Math.max(...spot.series.map((item) => item.mass));
    const spot = spots.reduce((best, item) => (mass(item) > mass(best) ? item : best));
    let series = spot.series;
    let moment = brightestMoment(series, { from: 1, minArea: MIN_AREA_FINE });
    let window = cropWindow(frame.scene.resolution, spot.center, TRACER_WIDTH);
    let faint = null;
    /* У дула отличие тоньше точки проверочного кадра (след в пять сантиметров) — тонко, как у обложек трассеров. */
    if (moment == null && spot.id === "muzzle") {
      faint = faintTracerMoment({ withTracer: withCard, without, muzzle, resolution: frame.scene.resolution });
      /* Миг и замер — тонкие, а окно остаётся тем же, что у обложек трассеров: стрелок слева, вспышка и след вправо. Окно «по рамке тонкого отличия» у
         выстрела автора уезжало вправо вдоль всего пути пули и обрезало стрелка (ALLIANCE V3, 13.11.2026: в кадре пустое поле и вспышка у левого края). */
      if (faint) ({ moment, series } = faint);
    }
    const peak = Math.max(...series.map((item) => item.area));
    await debugFrames("core-tracer", stage, series, window, [1, 2, 4, 8, 16, 30], moment);
    if (moment == null) return { reason: `правка карточки на кадре не видна (площадь ${peak} точек)` };
    const picture = stage.shotAt(moment, window, zoomOf(window));
    const measured = faint ? `тонкое отличие (порог ${faint.threshold}), площадь ${series[moment].area}` : `площадь ${series[moment].area} из ${peak}`;
    return { png: await pngOf(picture), note: `${entry.id} · ${plan.label} · ${(moment * STEP).toFixed(2)} с · ${measured}` };
  } finally {
    stage.dispose();
  }
}
