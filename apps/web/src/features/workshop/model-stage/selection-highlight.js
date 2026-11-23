/*
 * Подсветка выбранного и того, что под курсором, в 3D-кадрах мастерской
 * (18.10.2026, Session 2, задача 2): «ясно, что именно будет редактироваться» —
 * и при этом видно, как это выглядит сейчас (поправка ведущей: подсветка
 * поверх вида, а не вместо него).
 *
 * Выбранное — внешний контур на экране (силуэт, `addSilhouette`) цветом акцента с тёмной каймой, чтобы
 * читаться и на светлой стене, и на тёмной, плюс ровная заливка цветом акцента в 16 % прозрачности (владелец 01.11.2026: штрихи по
 * пикселям экрана стояли на месте, пока вещь ехала с камерой, — «режут глаза»). Детали внутри вещи не обводятся (владелец 01.11.2026: «чтобы не обводились детали,
 * просто контур»): рёбра сетки (`selection-outline.js`) у сумки обводили ручки, у автомата — каждую бутылку, у табло —
 * стыки граней дуги. Контур по рёбрам остался только у острова листа (`uvRects`: одно полотно из многих на листе) —
 * там его кромка и есть край полотна. Штрихи и контур держатся, пока вещь выбрана (владелец 01.11.2026: «тыкаю — не показывает,
 * что выделил»; до того штрихи гасли через ~1,2 с и у экрана оставалась линия в 2 px). Вспышкой гаснет только
 * правка (`change`). Под курсором — только тонкий контур, без штрихов.
 *
 * Заливка — копия сетки с общей геометрией и шейдером (слой `fill`; имена «штрихи», `HATCH_*` — с тех пор, как она была полосами); контур
 * по рёбрам у острова листа — толстые линии (`LineSegments2`, ширина в пикселях экрана) с чуть подтянутой глубиной,
 * чтобы не тонуть в поверхности и не просвечивать сквозь стены. Копии лучи не
 * видят: их нет в списке сеток, по которому целится кадр (`pick`) — щелчок по
 * подсвеченному берёт настоящую поверхность. Копии делят геометрию с
 * оригиналом и не владеют ею.
 *
 * Контур (`addSilhouette`): трафарет — по всей проекции выбранного, и вокруг него копии, сдвинутые на пиксели по осям; контур —
 * то, что в сдвинутых копиях вышло за трафарет. Держится, как и штрихи, пока вещь выбрана; под курсором такой же контур
 * держится, пока курсор на нём. Большой выбор — тяжелее `LARGE_TRIANGLES` треугольников (фасад здания, «все предметы» зала,
 * кресла) — в полёте прячет свой контур (`veil`: три прохода трафарета по стороне здания). Нужен трафарет в буфере кадра
 * (`stencil: true` у `WebGLRenderer`).
 *
 * Описание того, что подсветить (`spec`) — чистые данные редактора:
 *   { materials?: number[]  — номера материалов сцены,
 *     parts?: number[]      — номера частей сцены,
 *     where?: (info, mesh) => boolean — своя проверка по записи материала,
 *     uvRects?: number[][]  — только эти прямоугольники развёртки `[u0, v0, u1, v1]`
 *                              (остров листа, одно полотно из многих),
 *     none?: boolean        — править есть что, а подсвечивать сетки нечем,
 *     logical?: boolean     — брать не пачки, что рисуются, а логические сетки сцены (у каждой — номер
 *                              сущности в `userData.entity`): так обводят один предмет зала, а не весь
 *                              материал со всеми его соседями (пачка склеивает предметы одного листа),
 *     limit?: number        — сколько сеток брать не больше (по умолчанию `MAX_OVERLAYS`),
 *     proxies?: Proxy[]     — свои «сетки» в мире (`shapeProxy`, `boxProxy`): плоский кусок или коробка, которых нет
 *                              в сцене (рамка вокруг буквы, табло, расстановка модели). Если других условий нет,
 *                              подсвечиваются только они,
 *     runs?: Int32Array     — разметка выделения (`.selmap`): тройки `сетка, от, до` — треугольники `[от, до)` сетки
 *                              сцены (`userData.meshIndex`), одним куском на все сетки (`island-piece.js: rangeProxy`);
 *                              `runsKey` — ключ набора, если он известен вызывающему,
 *     hidden?: boolean      — брать и спрятанные сетки (модель убрана или подменена — виден силуэт, где она стояла),
 *     objects?: boolean     — брать сетки не сцены, а объектов кадра (`setObjects`: буквы, плашки, логотип); какие
 *                              из них — решает `where(info, mesh)` по `mesh.userData.pick`,
 *     follow?: boolean      — вещь двигается (лого над городом, модель мастерской): штрихи и контур едут вместе с ней }
 *
 * Одна подсветка на все редакторы (задача 10Б ТЗ 18.10.2026: «если что-то выделяется для редактирования, оно
 * всегда везде выделяется полосками»): белые рамки-коробки у арены, табло, надписи на холме и логотипа
 * заменены теми же штрихами и контуром; вещь кадра, что двигается (своя модель мастерской), — слоем `model`
 * с `follow`: штрихи и контур едут вместе с сеткой.
 */

import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { outlineSegments } from "./selection-outline.js";
import { rangeProxy, runsSignature } from "./island-piece.js";

/* Не больше стольких копий штрихов за раз: подсветка листа целого зала не должна удвоить его. */
const MAX_OVERLAYS = 256;
const MAX_RECTS = 8;
/* Заливка выбранного: сколько держится вспышка и как гаснет, мс; прозрачность — вид под ней читается, вещь заметна и на светлом, и на тёмном. */
export const HATCH_HOLD_MS = 1200;
export const HATCH_FADE_MS = 500;
const HATCH_ALPHA = 0.16;
/* Контур: ширина линии и каймы, пиксели экрана. */
const LINE_WIDTH = { select: 2, hover: 1.5, model: 2, change: 1.5 };
const HALO_WIDTH = { select: 4.5, hover: 3.5, model: 4.5, change: 3.5 };
const HALO_ALPHA = { select: 0.55, hover: 0.4, model: 0.55, change: 0.4 };
/*
 * Контур не больше стольких отрезков на слой: «все предметы» зала — сорок четыре сотни тысяч рёбер, и контур
 * со штрихами утяжелил бы кадр вчетверо. Сверх предела остаются самые длинные рёбра — они и держат силуэт.
 */
const MAX_OUTLINE_SEGMENTS = 40_000;
/*
 * Контур тяжелее стольких треугольников считается кусками по кадрам (не больше `SLICE_MS` мс подряд) и начинается ПОСЛЕ первого кадра выбора,
 * а не внутри щелчка: у «всех предметов» зала — 780 тысяч треугольников, около секунды, а у предмета в шесть тысяч — ~50 мс на закрытой ×4
 * (замер 26.10.2026, ТЗ перф щелчка: «щелчок → подсветка < 100 мс до первого кадра»). Штрихи встают сразу, контур подъезжает следом.
 * Лёгкий контур (до ~0,6 мс на ×1) остаётся в щелчке: так у мелкой вещи он на экране с первого кадра. Контур, что уже считался (кэш), берётся сразу.
 */
const SYNC_TRIANGLES = 800;
const SLICE_MS = 8;
/* Окно скрыто — `requestAnimationFrame` стоит, и контур ждал бы показа: через столько всё равно начинаем. */
const FRAME_GUARD_MS = 250;
/* Сеток много — каждой не больше стольких отрезков (самые длинные), чтобы силуэт был у каждого предмета, а не только у самых больших. */
const MANY_MESHES = 100;
const MIN_PER_MESH = 24;
/* Слои со штрихами, что гаснут после выбора. */
const HATCHED = ["select", "model"];
/*
 * Правка в кадре (`change`, владелец 31.10.2026: визуализация «как на Большой карте» — правка коротко появляется и тает): то, что
 * сменило облик или пропало, на миг обводится и штрихуется, потом гаснет целиком — и контур, и штрихи — и слой уходит сам.
 */
export const CHANGE_HOLD_MS = 160;
export const CHANGE_FADE_MS = 520;
const FADING = [...HATCHED, "change"];
/* Большой выбор — треугольников больше стольких: в полёте прячет контур. Контур по рёбрам острова листа гуще `BUSY_OUTLINE` отрезков — тоже силуэт. */
export const LARGE_TRIANGLES = 15_000;
export const BUSY_OUTLINE = 4000;
/* Контур: на сколько пикселей экрана сдвинуты копии (сам контур и тёмная кайма под ним) — толщиной как прежние линии выбранного (2 и 4,5 px). */
const SILHOUETTE_PX = { line: 2, halo: 4 };
const SILHOUETTE_ALPHA = { line: 1, halo: 0.55, hover: 0.9 };
/*
 * На сколько метров копии контура подтянуты к камере вдоль луча взгляда (на экране они там же). Изогнутое табло выбрано плоскими плашками
 * по граням дуги в 3 см перед ними, а рамка модели выступает дальше — копии проигрывали ей по глубине, и контур рвался: белая линия
 * пропадала, а тёмная кайма шире неё торчала отрезками (владелец 01.11.2026: «криво обводит круглые элементы»). То же у стыка вещи с полом
 * и стеной. Стены дальше этого контур по-прежнему закрывают.
 */
const SILHOUETTE_PULL = 0.2;
/*
 * Сдвиги копий (единичные, по экрану). Обычный выбор — восемь: четыре стороны и диагонали, иначе у угла копии не сходятся и контур
 * разомкнут (владелец 01.11.2026: «не стык на углу» у картинки вместо автомата). Большой выбор — четыре стороны: у косой кромки полоса уже на
 * треть, зато сторона здания рисуется вдвое реже.
 */
const SHIFTS = [1, 0, -1, 0, 0, 1, 0, -1];
const SHIFTS_CORNERS = [...SHIFTS, 1, 1, -1, 1, 1, -1, -1, -1];
/* Свой бит трафарета у каждого слоя: выбранное, наведение и своя модель не затирают друг друга. */
const STENCIL_BIT = { select: 1, hover: 2, model: 4, change: 8 };
/* Подтяжка глубины линий к камере (NDC): лежат на поверхности, но не просвечивают сквозь стены. */
const DEPTH_BIAS = 0.00003;
const FALLBACK = { accent: "#f4f4f5", ink: "#0a0a0b" };

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAGMENT = /* glsl */ `
  uniform vec3 uColour;
  uniform float uAlpha;
  uniform vec4 uRects[${MAX_RECTS}];
  uniform int uRectCount;
  varying vec2 vUv;
  void main() {
    if (uRectCount > 0) {
      vec2 at = fract(vUv);
      bool inside = false;
      for (int i = 0; i < ${MAX_RECTS}; i += 1) {
        if (i >= uRectCount) break;
        vec4 rect = uRects[i];
        if (at.x >= rect.x && at.x <= rect.z && at.y >= rect.y && at.y <= rect.w) inside = true;
      }
      if (!inside) discard;
    }
    /* Ровная заливка без узора: штрихи по пикселям экрана стояли на месте, пока вещь ехала с камерой, и «ползли» по ней (владелец 01.11.2026:
       «полоски режут глаза, когда двигаешь камеру»). */
    gl_FragColor = vec4(uColour, uAlpha);
  }
`;

const SILHOUETTE_VERTEX = /* glsl */ `
  attribute vec2 aShift;
  uniform vec2 uPixel;
  uniform float uWidth;
  uniform float uPull;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    if (projectionMatrix[2][3] == 0.0) {
      view.z += uPull;
    } else {
      float away = length(view.xyz);
      view.xyz *= max(away - uPull, away * 0.5) / max(away, 1e-6);
    }
    gl_Position = projectionMatrix * view;
    gl_Position.xy += aShift * uPixel * uWidth * gl_Position.w;
  }
`;
const SILHOUETTE_FRAGMENT = /* glsl */ `
  uniform vec3 uColour;
  uniform float uAlpha;
  void main() {
    gl_FragColor = vec4(uColour, uAlpha);
  }
`;

/** Цвета из токенов интерфейса (читаются с элемента кадра); нет токена — запасные. */
function tokenColours(element) {
  const colours = { accent: new THREE.Color(FALLBACK.accent), ink: new THREE.Color(FALLBACK.ink) };
  try {
    const style = getComputedStyle(element || document.documentElement);
    const accent = style.getPropertyValue("--astral-accent").trim();
    const ink = style.getPropertyValue("--astral-accent-ink").trim();
    if (accent) colours.accent.set(accent);
    if (ink) colours.ink.set(ink);
  } catch {
    /* нет окна или значения — остаются запасные цвета */
  }
  return colours;
}

/** Сколько треугольников у сеток вместе. */
export const trianglesOf = (meshes) =>
  meshes.reduce(
    (sum, mesh) => sum + Math.min(mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position?.count || 0, mesh.geometry.drawRange.count) / 3,
    0,
  );

/** Большой ли выбор: контур по рёбрам такому не годится, ему — силуэт. */
export const isLargeSelection = (meshes) => trianglesOf(meshes) > LARGE_TRIANGLES;

/**
 * Охват группового инструмента (п. 7 `docs/3D-ELEMENTS-PICTURES.md`, владелец 31.10.2026): пока взят пункт («Реквизит», «Стены»), его вещи
 * обведены все и держатся видимыми — как выбранная вещь (`steady`), а не гаснут вспышкой. Нечего обводить — описание как было.
 */
export const steadyScope = (spec) => (spec && typeof spec === "object" && !spec.none ? { ...spec, steady: true } : spec);

/** Сетки сцены, что подпадают под описание `spec`. */
export function meshesFor(meshes, spec, materialsOf = () => null) {
  /* `none` — править есть что, но подсвечивать сетки нечем (плашку рисует сам редактор). */
  if (!spec || spec.none) return [];
  const materials = spec.materials ? new Set(spec.materials) : null;
  const parts = spec.parts ? new Set(spec.parts) : null;
  const found = spec.proxies?.length ? [...spec.proxies] : [];
  /* Разметка выделения: треугольники по диапазонам — одним куском на все сетки цели (`island-piece.js`). */
  if (spec.runs?.length) {
    const piece = rangeProxy(meshes, spec.runs, spec.runsKey || runsSignature(spec.runs));
    if (piece) found.push(piece);
  }
  /* Только свои куски: условий по сетке сцены нет — сцену не обходим (иначе «без условий» значило бы «всё»). */
  if (found.length && !materials && !parts && !spec.where) return found;
  for (const mesh of meshes) {
    if (mesh.userData.through || (!spec.hidden && (!mesh.visible || mesh.material?.visible === false))) continue;
    if (materials && !materials.has(mesh.userData.material)) continue;
    if (parts && !parts.has(mesh.userData.part)) continue;
    if (spec.where && !spec.where(materialsOf(mesh), mesh)) continue;
    found.push(mesh);
    if (found.length >= (spec.limit || MAX_OVERLAYS)) break;
  }
  return found;
}

/* «Сетка» для слоя подсветки, которой нет в сцене: геометрия в мире, единичная матрица. */
function proxyOf(geometry) {
  return {
    geometry,
    matrixWorld: new THREE.Matrix4(),
    updateWorldMatrix() {},
    userData: {},
    visible: true,
    isProxy: true,
    dispose: () => geometry.dispose(),
  };
}

/**
 * Плоский выпуклый кусок в мире по точкам обхода `[[x, y, z], …]` (три и больше): рамка вокруг буквы, табло, полотна.
 * Контур у него — кромка, штрихи — по всей площади. Освобождает `proxy.dispose()`.
 */
export function shapeProxy(points) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(points.length * 2), 2));
  const index = [];
  for (let corner = 1; corner + 1 < points.length; corner += 1) index.push(0, corner, corner + 1);
  geometry.setIndex(index);
  return proxyOf(geometry);
}

/** Коробка `{ min, max }` в мире: штрихи на гранях, контур по рёбрам. */
export function boxProxy({ min, max }) {
  const geometry = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  geometry.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  return proxyOf(geometry);
}

/**
 * Своя сетка в мире по готовым сеткам `[{ positions, indices }]` (копия вещи, которой нет в сцене кадра как сетки, — кубок из сцены повторов): штрихи
 * и контур — по её форме, а не коробкой. Пусто — `null`. Освобождает `proxy.dispose()`.
 */
export function meshProxy(meshes) {
  const list = (meshes || []).filter((mesh) => mesh?.positions?.length && mesh?.indices?.length);
  if (!list.length) return null;
  const vertices = list.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  const positions = new Float32Array(vertices * 3);
  const index = new Uint32Array(list.reduce((sum, mesh) => sum + mesh.indices.length, 0));
  let base = 0;
  let at = 0;
  for (const mesh of list) {
    positions.set(mesh.positions, base * 3);
    for (const value of mesh.indices) index[at++] = value + base;
    base += mesh.positions.length / 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(vertices * 2), 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return proxyOf(geometry);
}

/** Освободить прокси, что редактор делал для подсветки. */
export const disposeProxies = (list) => list?.forEach((proxy) => proxy.dispose?.());

/*
 * Геометрия контура общая на все слои с теми же сетками (геометрия и место в мире)
 * и теми же островами листа: два выбора подряд, наведение и выбор одной и той же
 * вещи не строят её заново (тест «мишени района считаются один раз»). Слой берёт
 * геометрию (`acquireLines`) и возвращает (`releaseLines`); пока ею кто-то
 * пользуется, она не освобождается, ненужные копятся не больше `LINE_CACHE_LIMIT`.
 */
const LINE_CACHE_LIMIT = 24;
const lineCache = new Map();

function acquireLines(key, make) {
  let entry = lineCache.get(key);
  if (entry) lineCache.delete(key);
  else entry = { geometry: make(), users: 0 };
  /* Заново вставленная — самая свежая: вытесняются давно не бравшиеся. */
  lineCache.set(key, entry);
  entry.users += 1;
  for (const [other, item] of lineCache) {
    if (lineCache.size <= LINE_CACHE_LIMIT) break;
    if (item.users > 0) continue;
    item.geometry?.dispose();
    lineCache.delete(other);
  }
  return entry.geometry;
}

function releaseLines(key) {
  const entry = lineCache.get(key);
  if (entry) entry.users = Math.max(0, entry.users - 1);
}

/** Ключ контура: чьи сетки (геометрия и положение) и какие острова листа. */
const linesKey = (meshes, rects) =>
  `${meshes.map((mesh) => `${mesh.geometry.uuid}:${mesh.matrixWorld.elements.map((value) => Math.round(value * 1000)).join(",")}`).join("|")}#${rects ? JSON.stringify(rects) : ""}`;

/* Самые длинные отрезки контура (`x y z x y z`), не больше `limit`: силуэт держат длинные рёбра, а не мелкая резьба. */
function longestSegments(segments, limit) {
  const count = segments.length / 6;
  if (count <= limit) return segments;
  const order = Array.from({ length: count }, (_, index) => index);
  const length = (index) => {
    const at = index * 6;
    return (segments[at + 3] - segments[at]) ** 2 + (segments[at + 4] - segments[at + 1]) ** 2 + (segments[at + 5] - segments[at + 2]) ** 2;
  };
  const sizes = Float64Array.from(order, length);
  order.sort((left, right) => sizes[right] - sizes[left]);
  const out = new Float32Array(limit * 6);
  for (let at = 0; at < limit; at += 1) out.set(segments.subarray(order[at] * 6, order[at] * 6 + 6), at * 6);
  return out;
}

/**
 * Что подсвечивать выбранным: `explicit` — описание от редактора (`undefined` — по
 * последнему щелчку, `null` — нигде), `clicked` — цель последнего щелчка,
 * `dismissed` — описание редактора, которое сняли щелчком в пустое место: пока
 * редактор не пришлёт другое, оно не светится (выбор в самом редакторе остаётся,
 * снимается только подсветка — как щелчок мимо в Photoshop).
 */
export function selectionSpec({ explicit, clicked = null, dismissed = null }) {
  if (explicit === undefined) return clicked;
  return explicit && explicit === dismissed ? null : explicit;
}

const smooth = (value) => value * value * (3 - 2 * value);

/** Прозрачность штрихов через `elapsed` мс после выбора: держатся, затем плавно гаснут. */
export function hatchFade(elapsed, hold = HATCH_HOLD_MS, fade = HATCH_FADE_MS) {
  if (elapsed <= hold) return 1;
  if (elapsed >= hold + fade) return 0;
  return 1 - smooth((elapsed - hold) / fade);
}

/* Доля видимости слоя `kind` спустя `elapsed` мс: у правки — свои короткие сроки. */
const fadeOf = (kind, elapsed) => (kind === "change" ? hatchFade(elapsed, CHANGE_HOLD_MS, CHANGE_FADE_MS) : hatchFade(elapsed));

/**
 * Слой подсветки в сцене кадра.
 *
 * @param {object} options
 * @param {THREE.Object3D} options.parent — где лежат копии (сцена кадра)
 * @param {() => void} options.invalidate — перерисовать кадр один раз
 * @param {() => void} [options.kick] — нужен цикл кадров (штрихи гаснут)
 * @param {Element} [options.element] — откуда читать токены цвета (холст кадра)
 * @param {() => number} [options.pixelRatio] — плотность пикселей кадра (шаг штрихов)
 * @param {() => number} [options.sliceClock] — часы, мс, по которым тяжёлый контур режется на куски по `SLICE_MS` (по умолчанию
 *   `performance.now`; тест подаёт свои, и число кусков не зависит от нагрузки машины)
 * @param {() => number} [options.now] — часы, мс (тест)
 * @param {{ accent: string, ink: string }} [options.palette] — свои цвета штрихов и каймы (стена под студией — янтарная,
 *   чтобы отличаться от белого контура части здания); по умолчанию — токены интерфейса
 * @returns {{ set, flash, update, animating, clear, has, count, outlined, dispose }}
 *   `kind` — `select` (выбранное: контур и штрихи), `model` (своя модель мастерской: то же, но слой едет вместе
 *   с сеткой — `follow`) или `hover` (под курсором: только контур)
 */
export function createSelectionHighlight({ parent, invalidate, kick = () => {}, element = null, pixelRatio = () => 1, now = () => performance.now(), sliceClock = () => performance.now(), palette: custom = null }) {
  const layers = { select: null, hover: null, model: null, change: null };
  /* Контур по сетке считается один раз на геометрию и описание островов. */
  const cache = new Map();
  /* Ключи контуров, что брал этот слой: на выходе их видеопамять отдаётся (см. `dispose`). */
  const acquired = new Set();
  const IDENTITY = new THREE.Matrix4();
  let tokens = null;
  /* Выбранное спрятано на время полёта (`veil`). */
  let veiled = false;

  /*
   * В полёте у выбранного уходит только силуэт большого выбора: три прохода трафарета по всей стороне здания — основная доля из 11 мс видеочипа
   * охвата в кадре ангара (`docs/perf/hangar-editor.md`, п. 7). Штрихи и контур вещи остаются: внутри зала летают почти всё время, и выбор, спрятанный
   * целиком (31.10.2026), выглядел как «выделение отпало» (владелец 01.11.2026).
   */
  function showVeiled(layer) {
    if (!layer) return;
    for (const overlay of layer.overlays) overlay.visible = layer.fade > 0;
    for (const object of layer.silhouette) object.visible = !(veiled && layer.large) && layer.fade > 0;
    for (const line of layer.lines) line.visible = true;
  }

  function segmentsOf(mesh, rects) {
    mesh.updateWorldMatrix(true, false);
    const key = `${mesh.geometry.uuid}:${mesh.geometry.drawRange.count}:${mesh.matrixWorld.elements.map((value) => Math.round(value * 1000)).join(",")}|${rects ? JSON.stringify(rects) : ""}`;
    if (!cache.has(key)) {
      cache.set(key, outlineSegments([mesh], { rects }));
      while (cache.size > 96) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }

  /*
   * Материалы подсветки живут до `dispose()` слоя, а не до смены выбора (22.10.2026). three удаляет запись шейдера
   * `ShaderMaterial` (контур — `LineMaterial`, штрихи, силуэт), как только отпущен последний материал с этим текстом, и
   * новый материал получал новый ключ программы: каждая смена выбора собирала те же шейдеры заново, даже если
   * рендерер окна держал прежние (`keepPrograms`). Щелчок по плитке предметов арены — 31 программа, ~100 мс в
   * `getProgramParameter` на закрытой ×4. Материал вида (`select`, `hover`, `model`) один на роль, состояние — юниформы
   * (цвет, альфа, ширина, прямоугольники), их `build` ставит заново; два слоя одного вида одновременно не живут.
   */
  const pool = new Map();
  const pooled = (key, make) => {
    if (!pool.has(key)) pool.set(key, make());
    return pool.get(key);
  };

  function lineMaterial(kind, role, color, width, opacity) {
    const material = pooled(`line:${kind}:${role}`, () => {
      const made = new LineMaterial({ color: color.clone(), linewidth: width, transparent: true, opacity, depthTest: true, depthWrite: false, worldUnits: false });
      /* Линия чуть ближе к камере, чем поверхность под ней. */
      made.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace("gl_Position = clip;", `clip.z -= ${DEPTH_BIAS} * clip.w;\n\t\t\tgl_Position = clip;`);
      };
      return made;
    });
    material.color.copy(color);
    material.linewidth = width;
    material.opacity = opacity;
    return material;
  }

  /* Первый шаг контура — после кадра, в котором встали штрихи: `requestAnimationFrame` стоит до отрисовки, таймер из него — после неё. */
  function afterFrame(layer, run) {
    const go = () => {
      if (layer.frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(layer.frame);
      if (layer.timer) clearTimeout(layer.timer);
      if (layer.guard) clearTimeout(layer.guard);
      layer.frame = 0;
      layer.timer = 0;
      layer.guard = 0;
      run();
    };
    if (typeof requestAnimationFrame !== "function") {
      layer.timer = setTimeout(go, 0);
      return;
    }
    layer.frame = requestAnimationFrame(() => {
      layer.frame = 0;
      layer.timer = setTimeout(go, 0);
    });
    layer.guard = setTimeout(go, FRAME_GUARD_MS);
  }

  function drop(kind) {
    const layer = layers[kind];
    if (!layer) return false;
    if (layer.timer) clearTimeout(layer.timer);
    if (layer.guard) clearTimeout(layer.guard);
    if (layer.frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(layer.frame);
    for (const overlay of layer.overlays) overlay.removeFromParent();
    for (const line of layer.lines) line.removeFromParent();
    for (const key of layer.lineKeys) releaseLines(key);
    disposeSilhouette(layer);
    layers[kind] = null;
    return true;
  }

  /* Силуэт убирается: объекты, материалы и свои геометрии (общие с сеткой буферы не трогаем — их держит сцена). */
  function disposeSilhouette(layer) {
    /* Три объекта на сетку делят одну геометрию копий — освобождается она один раз. */
    const own = new Set();
    for (const object of layer.silhouette) {
      object.removeFromParent();
      if (object.geometry.userData.silhouette) own.add(object.geometry);
    }
    for (const geometry of own) {
      geometry.attributes = { aShift: geometry.attributes.aShift };
      geometry.index = null;
      geometry.dispose();
    }
    layer.silhouette = [];
  }

  function same(layer, meshes, rects, follow) {
    if (!layer || layer.meshes.length !== meshes.length || layer.follow !== follow) return false;
    if (layer.rects !== rects && JSON.stringify(layer.rects) !== JSON.stringify(rects)) return false;
    return layer.meshes.every((mesh, index) => mesh === meshes[index]);
  }

  /* Контур по сеткам: рёбра по кромке и углам — тёмная кайма и цвет акцента сверху. */
  function addOutline(layer, kind, palette, lineKey, make, holder, busy = Infinity) {
    const geometry = acquireLines(lineKey, make);
    layer.lineKeys.push(lineKey);
    acquired.add(lineKey);
    if (!geometry) return;
    /* Контур гуще предела — каркас, а не выделение: вместо него силуэт (геометрия остаётся в кэше — тот же выбор вернётся к ней). */
    if (geometry.attributes.instanceStart.count > busy) {
      layer.large = true;
      addSilhouette(layer, kind, palette, layer.meshes);
      return;
    }
    layer.lineGeometries.push(geometry);
    const halo = new LineSegments2(geometry, lineMaterial(kind, "halo", palette.ink, HALO_WIDTH[kind], HALO_ALPHA[kind]));
    const line = new LineSegments2(geometry, lineMaterial(kind, "line", palette.accent, LINE_WIDTH[kind], 1));
    for (const [object, order, alpha] of [[halo, 23, HALO_ALPHA[kind]], [line, 24, 1]]) {
      object.renderOrder = order;
      /* Своя непрозрачность линии: от неё гаснет контур правки (`change`). */
      object.userData.alpha = alpha;
      object.frustumCulled = false;
      /* Линия не мишень: луч её не видит. `userData.highlight` — чем это слой подсветки: тесты и редакторы считают по нему, а не по имени юниформы. */
      object.raycast = () => {};
      object.userData.highlight = "outline";
      holder.add(object);
      layer.lines.push(object);
    }
  }

  /*
   * Контур выбранного: трафарет по видимому выбранному и копии со сдвигом по пикселям — наружу вышло, то и контур. `follow` — копии садятся
   * детьми на саму сетку (её координаты), и контур едет вместе с ней.
   */
  function addSilhouette(layer, kind, palette, meshes, follow = false) {
    const bit = STENCIL_BIT[kind] || 1;
    const px = Math.max(1, pixelRatio());
    /*
     * Трафарет — по всей проекции выбранного, без проверки глубины (владелец 01.11.2026, завод: «кривое выделение, всё пересвечивает»): маска
     * с проверкой глубины и сдвигом `polygonOffset` на части видеочипов проигрывала той же поверхности сцены, бита не было, и сдвинутые копии
     * контура заливали наклонный низ конвейера и стойки сплошным белым. Копии контура глубину проверяют по-прежнему: встают только снаружи
     * выбранного и не сквозь то, что перед ним.
     */
    const maskMaterial = pooled(`mask:${kind}`, () =>
      new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        stencilWrite: true,
        stencilRef: bit,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFuncMask: 0xff,
        stencilWriteMask: bit,
        stencilFail: THREE.KeepStencilOp,
        stencilZFail: THREE.KeepStencilOp,
        stencilZPass: THREE.ReplaceStencilOp,
      }),
    );
    const ring = (role, colour, width, alpha) => {
      const material = pooled(`ring:${kind}:${role}`, () =>
        new THREE.ShaderMaterial({
          uniforms: {
            uColour: { value: colour.clone() },
            uAlpha: { value: alpha },
            uPixel: { value: new THREE.Vector2(0.002, 0.002) },
            uWidth: { value: width * px },
            uPull: { value: SILHOUETTE_PULL },
          },
          vertexShader: SILHOUETTE_VERTEX,
          fragmentShader: SILHOUETTE_FRAGMENT,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          stencilWrite: true,
          stencilRef: bit,
          stencilFunc: THREE.NotEqualStencilFunc,
          stencilFuncMask: bit,
          stencilWriteMask: 0,
          stencilFail: THREE.KeepStencilOp,
          stencilZFail: THREE.KeepStencilOp,
          stencilZPass: THREE.KeepStencilOp,
        }),
      );
      material.uniforms.uColour.value.copy(colour);
      material.uniforms.uAlpha.value = alpha;
      material.uniforms.uWidth.value = width * px;
      return material;
    };
    const halo = ring("halo", palette.ink, SILHOUETTE_PX.halo, SILHOUETTE_ALPHA.halo);
    const line = ring("line", palette.accent, SILHOUETTE_PX.line, kind === "hover" ? SILHOUETTE_ALPHA.hover : SILHOUETTE_ALPHA.line);
    layer.silhouetteBase = new Map([[halo, SILHOUETTE_ALPHA.halo], [line, kind === "hover" ? SILHOUETTE_ALPHA.hover : SILHOUETTE_ALPHA.line]]);
    const size = new THREE.Vector2();
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const source = mesh.geometry;
      /* Своя геометрия на сетку: те же буферы (положения, индексы), свой список копий — сдвиги по экрану. */
      const copies = new THREE.InstancedBufferGeometry();
      copies.attributes = { ...source.attributes };
      const shifts = layer.large ? SHIFTS : SHIFTS_CORNERS;
      copies.setAttribute("aShift", new THREE.InstancedBufferAttribute(new Float32Array(shifts), 2));
      copies.index = source.index;
      copies.instanceCount = shifts.length / 2;
      copies.drawRange = { ...source.drawRange };
      copies.boundingSphere = source.boundingSphere;
      copies.userData.silhouette = true;
      const make = (material, order) => {
        const object = new THREE.Mesh(copies, material);
        object.matrixAutoUpdate = false;
        object.matrix.copy(follow ? IDENTITY : mesh.matrixWorld);
        object.matrixWorldNeedsUpdate = true;
        object.renderOrder = order;
        object.frustumCulled = false;
        object.castShadow = false;
        object.receiveShadow = false;
        object.raycast = () => {};
        object.userData.highlight = "silhouette";
        if (!follow) object.userData.source = mesh;
        if (material.uniforms) {
          object.onBeforeRender = (renderer) => {
            renderer.getDrawingBufferSize(size);
            material.uniforms.uPixel.value.set(2 / size.x, 2 / size.y);
          };
        }
        (follow ? mesh : parent).add(object);
        layer.silhouette.push(object);
      };
      make(maskMaterial, 20);
      make(halo, 22);
      make(line, 23);
    }
  }

  function build(kind, meshes, rects, follow, steady = false) {
    /* Токены читаются один раз на слой подсветки: `getComputedStyle` сразу после фиксации React заставляет страницу
       пересчитать стили целиком (щелчок по предмету арены — 300 мс на ×4), а цвета с кадра не меняются. */
    tokens ||= tokenColours(element);
    const palette = { accent: tokens.accent.clone(), ink: tokens.ink.clone() };
    if (custom?.accent) palette.accent.set(custom.accent);
    if (custom?.ink) palette.ink.set(custom.ink);
    const layer = {
      meshes: [...meshes],
      rects,
      follow,
      overlays: [],
      lines: [],
      lineKeys: [],
      lineGeometries: [],
      silhouette: [],
      silhouetteBase: null,
      large: false,
      triangles: 0,
      material: null,
      timer: 0,
      frame: 0,
      guard: 0,
      started: now(),
      fade: 1,
      /* Постоянный выбор (`steady`): штрихи и силуэт не гаснут — вид виден, пока выбран предмет. */
      steady,
    };

    /* Внешний контур на экране — у всего, кроме острова листа: у него кромку даёт развёртка (`rects`). */
    const contour = !rects;
    if (follow && contour) {
      /* Слой едет с сеткой: копии контура — её дети. */
      addSilhouette(layer, kind, palette, meshes, true);
    } else if (follow) {
      /* Слой едет с сеткой: контур считается в её собственных координатах и садится ребёнком на неё же. */
      for (const mesh of meshes) {
        const local = { geometry: mesh.geometry, matrixWorld: IDENTITY, updateWorldMatrix() {} };
        addOutline(
          layer,
          kind,
          palette,
          `follow:${mesh.geometry.uuid}#${rects ? JSON.stringify(rects) : ""}`,
          () => {
            const segments = longestSegments(outlineSegments([local], { rects }), MAX_OUTLINE_SEGMENTS);
            if (!segments.length) return null;
            const made = new LineSegmentsGeometry();
            made.setPositions(segments);
            return made;
          },
          mesh,
        );
      }
    } else {
      for (const mesh of meshes) mesh.updateWorldMatrix(true, false);
      layer.triangles = trianglesOf(meshes);
      layer.large = !rects && !meshes.some((mesh) => mesh.isProxy && !mesh.isRange) && isLargeSelection(meshes);
      if (contour) addSilhouette(layer, kind, palette, meshes);
      const key = linesKey(meshes, rects);
      const perMesh = meshes.length > MANY_MESHES ? Math.max(MIN_PER_MESH, Math.floor(MAX_OUTLINE_SEGMENTS / meshes.length)) : Infinity;
      const partOf = (mesh) => {
        const segments = segmentsOf(mesh, rects);
        return segments.length / 6 > perMesh ? longestSegments(segments, perMesh) : segments;
      };
      const assemble = (list) => {
        const parts = list.filter((segments) => segments.length);
        const total = parts.reduce((sum, segments) => sum + segments.length, 0);
        if (!total) return null;
        const positions = new Float32Array(total);
        let at = 0;
        for (const segments of parts) {
          positions.set(segments, at);
          at += segments.length;
        }
        const made = new LineSegmentsGeometry();
        made.setPositions(longestSegments(positions, MAX_OUTLINE_SEGMENTS));
        return made;
      };
      const triangles = trianglesOf(meshes);
      /* Густоту контура знает готовый контур: у обычного выбора (без островов листа и без прокси) гуще `BUSY_OUTLINE` отрезков — силуэт. */
      const plain = !rects && !meshes.some((mesh) => mesh.isProxy && !mesh.isRange);
      if (contour) {
        /* Контур уже встал; рёбер сетки не обводим. */
      } else if (lineCache.has(key) || triangles <= SYNC_TRIANGLES) {
        addOutline(layer, kind, palette, key, () => assemble(meshes.map(partOf)), parent, plain ? BUSY_OUTLINE : Infinity);
      } else {
        /* Контур тяжелее лёгкого — после первого кадра и кусками; сменился выбор раньше конца — недосчитанное бросается (`drop` гасит таймеры). */
        const parts = [];
        let next = 0;
        const step = () => {
          layer.timer = 0;
          if (layers[kind] !== layer) return;
          const start = sliceClock();
          while (next < meshes.length && sliceClock() - start < SLICE_MS) parts.push(partOf(meshes[next++]));
          if (next < meshes.length) {
            layer.timer = setTimeout(step, 0);
            return;
          }
          addOutline(layer, kind, palette, key, () => assemble(parts), parent, plain ? BUSY_OUTLINE : Infinity);
          if (veiled && kind === "select") showVeiled(layer);
          invalidate();
        };
        afterFrame(layer, step);
      }
    }

    /* Заливка — у выбранного; под курсором контур без заливки. */
    if (kind !== "hover") {
      layer.material = pooled(`fill:${kind}`, () =>
        new THREE.ShaderMaterial({
          uniforms: {
            uColour: { value: palette.accent.clone() },
            uAlpha: { value: HATCH_ALPHA },
            uRects: { value: Array.from({ length: MAX_RECTS }, () => new THREE.Vector4()) },
            uRectCount: { value: 0 },
          },
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      const hatch = layer.material.uniforms;
      hatch.uColour.value.copy(palette.accent);
      hatch.uAlpha.value = HATCH_ALPHA;
      hatch.uRects.value.forEach((rect, index) => rect.set(...(rects?.[index] || [0, 0, 0, 0])));
      hatch.uRectCount.value = rects ? rects.length : 0;
      layer.overlays = meshes.map((mesh) => {
        const overlay = new THREE.Mesh(mesh.geometry, layer.material);
        if (follow) {
          mesh.add(overlay);
        } else {
          mesh.updateWorldMatrix(true, false);
          overlay.matrixAutoUpdate = false;
          overlay.matrix.copy(mesh.matrixWorld);
          overlay.matrixWorldNeedsUpdate = true;
          overlay.userData.source = mesh;
          parent.add(overlay);
        }
        overlay.renderOrder = 21;
        overlay.castShadow = false;
        overlay.receiveShadow = false;
        /* Луч подсветку не видит: щелчок берёт настоящую поверхность. */
        overlay.raycast = () => {};
        overlay.userData.highlight = "fill";
        return overlay;
      });
    }
    layers[kind] = layer;
    if (veiled && kind === "select") showVeiled(layer);
  }

  /* Силуэт большого выбора гаснет так же, как штрихи: альфа от `fade`, у погасшего — ни одного вызова отрисовки. */
  function fadeSilhouette(layer, fade) {
    if (!layer.silhouette.length) return;
    for (const [material, base] of layer.silhouetteBase) material.uniforms.uAlpha.value = base * fade;
    for (const object of layer.silhouette) object.visible = fade > 0;
  }

  /* Идёт, пока штрихи (и силуэт) не погасли совсем: срок вышел, а `update` не успел — шаг всё равно будет сделан,
     иначе при остановленном цикле (окно было скрыто) вспышка осталась бы на экране навсегда. */
  const running = (layer) => Boolean(layer?.material) && layer.fade > 0 && !layer.steady;

  return {
    /** `options.follow` — слой едет вместе с сеткой (своя модель мастерской, что двигается). */
    set(kind, meshes, uvRects = null, { follow = false, steady: asked = false } = {}) {
      const rects = uvRects?.length ? uvRects.slice(0, MAX_RECTS) : null;
      /* Выбранное и своя модель держатся, пока выбраны (владелец 01.11.2026: «тыкаю — не показывает, что выделил»): вспышка гасла через 1,2 с,
         у экрана оставалась линия в 2 px, у стены и пола — ничего. Гаснет только правка (`change`); наведение — без штрихов. */
      const steady = asked || HATCHED.includes(kind);
      if (!meshes?.length) {
        if (drop(kind)) invalidate();
        return;
      }
      /* Те же сетки и те же прямоугольники — ничего не меняем: наведение дёргается каждые сто мс. */
      if (same(layers[kind], meshes, rects, follow) && Boolean(layers[kind]?.steady) === steady) return;
      drop(kind);
      build(kind, meshes, rects, follow, steady);
      invalidate();
      if (kind !== "hover") kick();
    },
    /** Щелчок по уже выбранному: штрихи вспыхивают снова. */
    flash() {
      let any = false;
      for (const kind of HATCHED) {
        const layer = layers[kind];
        if (!layer?.material) continue;
        any = true;
        layer.started = now();
        layer.fade = 1;
        layer.material.uniforms.uAlpha.value = HATCH_ALPHA;
        for (const overlay of layer.overlays) overlay.visible = true;
        fadeSilhouette(layer, 1);
        if (veiled && kind === "select") showVeiled(layer);
      }
      if (!any) return;
      invalidate();
      kick();
    },
    /** Сетки выбранного сдвинули в кадре (протяжка своей вещи мышью): заливка и контур — за ними, без пересборки. */
    track() {
      for (const layer of Object.values(layers)) {
        for (const object of [...(layer?.overlays || []), ...(layer?.silhouette || [])]) {
          const source = object.userData.source;
          if (!source) continue;
          source.updateWorldMatrix(true, false);
          object.matrix.copy(source.matrixWorld);
          object.matrixWorldNeedsUpdate = true;
        }
      }
    },
    /** Выбранное не рисуется, пока камера в полёте (`true`), и возвращается, как было (`false`). */
    veil(on) {
      const next = Boolean(on);
      if (next === veiled) return;
      veiled = next;
      showVeiled(layers.select);
    },
    /** Шаг гашения штрихов; `true`, пока они ещё идут. */
    update(time = now()) {
      let going = false;
      for (const kind of FADING) {
        const layer = layers[kind];
        if (!layer?.material) continue;
        const fade = layer.steady ? 1 : fadeOf(kind, time - layer.started);
        if (fade !== layer.fade) {
          layer.fade = fade;
          layer.material.uniforms.uAlpha.value = HATCH_ALPHA * fade;
          for (const overlay of layer.overlays) overlay.visible = fade > 0;
          fadeSilhouette(layer, fade);
          if (veiled && kind === "select") showVeiled(layer);
          /* Правка гаснет целиком: и контур. Погасла — слоя больше нет. */
          if (kind === "change") {
            for (const line of layer.lines) line.material.opacity = (line.userData.alpha ?? 1) * fade;
            if (fade <= 0) {
              drop(kind);
              invalidate();
              continue;
            }
          }
        }
        going = running(layer) || going;
      }
      return going;
    },
    animating: () => FADING.some((kind) => running(layers[kind])),
    clear(kind) {
      let changed = false;
      for (const name of kind ? [kind] : Object.keys(layers)) changed = drop(name) || changed;
      if (changed) invalidate();
    },
    has: (kind) => Boolean(layers[kind]),
    count: (kind) => layers[kind]?.overlays.length || 0,
    /** Сколько треугольников у сеток слоя (стенд и тест). */
    triangles: (kind) => layers[kind]?.triangles || 0,
    /** Большой ли выбор слоя: у него силуэт вместо контура по рёбрам (стенд и тест). */
    large: (kind) => Boolean(layers[kind]?.large),
    /** Сколько объектов силуэта у слоя и виден ли он сейчас (стенд и тест). */
    silhouetted: (kind) => (layers[kind]?.silhouette || []).filter((object) => object.visible).length,
    /** Сколько отрезков контура у слоя (стенд и тест). */
    outlined: (kind) => (layers[kind]?.lineGeometries || []).reduce((sum, geometry) => sum + geometry.attributes.instanceStart.count, 0),
    dispose() {
      for (const name of Object.keys(layers)) drop(name);
      /* Материалы подсветки (см. `pool`) уходят вместе с кадром. */
      for (const material of pool.values()) material.dispose();
      pool.clear();
      cache.clear();
      /* Контуры, которые больше никому не нужны, отдают видеопамять: у кадра на рендерере окна
         (`engine/window-renderer.js`) её не уносит потеря контекста, а ключ с геометрией ушедшего кадра
         уже не встретится. Сама геометрия остаётся в кэше — тот же выбор её не пересчитает, three
         зальёт заново. */
      for (const key of acquired) {
        const entry = lineCache.get(key);
        if (entry && !entry.users) entry.geometry?.dispose();
      }
      acquired.clear();
    },
  };
}
