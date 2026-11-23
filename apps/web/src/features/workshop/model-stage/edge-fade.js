/*
 * Мягкий край куска карты (ТЗ 19.10.2026): расчёт и перенос на материалы кадра.
 *
 * Сцена из куска настоящей карты — прострелы, зоны каптов, местность зон, дороги, роща, залазы — кончается краем, где
 * вырезка резала землю и здания, и за краем пустота. Затухание уводит цвет и прозрачность к краю куска (шейдер —
 * `recolor-material.js`, defines `RC_FADE`, `RC_FADE_MAP`). Здесь — чистая часть: какая рамка, какой ширины и какой формы
 * край, и как включить затухание у материалов; рендерера не нужно, поэтому тесты гоняют её на настоящих материалах.
 *
 * Край бывает двух видов, и они складываются (берётся тот, что темнее):
 *   • «рамка» — расстояние до рамки куска (прямоугольник в плане), широкая полоса: пятая часть короткой стороны;
 *   • «контур» (по умолчанию) — расстояние до пустоты в плане, узкая полоса. Кусок из карты не прямоугольный: вырезка
 *     идёт по кускам карты, и обрыв лежит не по рамке, а по контуру. Контур берётся из самой сцены: треугольники — на
 *     сетку плана, мелкие щели замыкаются, дальше поле расстояний до пустоты (двумя проходами «фаски»), в текстуру 8 бит.
 *     Полоса у контура узкая нарочно: у рваного куска пустоты внутри, и широкая полоса съела бы настоящую землю.
 *
 * Опция кадра (`ModelStage.edgeFade`): `true` — рамка и контур, ширина рамки — пятая часть короткой стороны (от 3 до
 * 120 м), контура — её шестнадцатая (от 3 до 24 м); число — своя доля рамки; `{ fraction, width, contour, box: [x0, y0,
 * x1, y1], shape: "box" }` — своё (`shape: "box"` — без контура); `false` — как было.
 *
 * Круг (ТЗ 20.10.2026): `{ shape: "disc", centre: [x, y], radius, width? }` — всё, что дальше `radius` от центра (оси сцены, метры),
 * уходит в чёрную пустоту, полоса затухания — `width` внутри круга (по умолчанию пятая часть радиуса, 3…120 м); внутри полосы
 * не темнеет ничего. Для кадров, где кусок карты собран кругом (`groundChunk`). Без `centre` и `radius` — круг, вписанный в рамку
 * сцены (кусок, вырезанный прямоугольником: «Дороги»).
 *
 * План (ТЗ 02.11.2026): `{ shape: "plan", points: [[x, y], …], top, width }` — выпуклый многоугольник против часовой стрелки, до `FADE_PLAN_EDGES` вершин, и высота `top`. Полоса
 * `width` внутри них темнеет, за их краем сцены нет совсем (кадр зоны: чернота в двух метрах от ленты).
 */

import * as THREE from "three";
import { footprintDistances } from "./edge-field.js";
import { FADE_PLAN_EDGES, FADE_PLAN_FAR } from "./recolor-material.js";

export const EDGE_FADE_FRACTION = 0.2;
export const EDGE_FADE_RANGE = Object.freeze([3, 120]);
export const EDGE_CONTOUR_FRACTION = 0.06;
export const EDGE_CONTOUR_RANGE = Object.freeze([3, 24]);
/* Поле контура — `edge-field.js`: его считает и поток разбора сцен. */
export { EDGE_FIELD_CLOSE, EDGE_FIELD_SIZE, footprintDistances } from "./edge-field.js";

/**
 * Рамка, ширина и форма затухания по границам сцены (`asset.bounds`, метры, оси сцены).
 *
 * @param {{ min: number[], max: number[] }|null|undefined} bounds
 * @param {boolean|number|{ fraction?: number, width?: number, box?: number[], shape?: "box"|"footprint" }|null} option
 * @returns {{ box: number[], width: number, contour: number, shape: "box"|"footprint" }|null} `null` — затухания нет: опция
 *   выключена, сцены нет или она плоская; `width` — полоса у рамки, `contour` — у контура, метры
 */
export function resolveEdgeFade(bounds, option) {
  if (!option) return null;
  const spec = option === true ? {} : typeof option === "number" ? { fraction: option } : option;
  if (spec.shape === "plan") {
    const edges = planEdges(spec.points);
    if (!edges) return null;
    const xs = spec.points.map((point) => point[0]);
    const ys = spec.points.map((point) => point[1]);
    const width = Math.max(1e-3, Number.isFinite(spec.width) ? spec.width : 1);
    return { box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], width, contour: width, shape: "plan", plan: { edges, top: Number.isFinite(spec.top) ? spec.top : FADE_PLAN_FAR } };
  }
  if (spec.shape === "disc") {
    /* Без центра и радиуса — круг, вписанный в рамку сцены (кусок, вырезанный прямоугольником). */
    const inscribed = !Array.isArray(spec.centre) && !Number.isFinite(spec.radius) && bounds?.min && bounds?.max;
    const [cx, cy] = inscribed ? [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2] : Array.isArray(spec.centre) ? spec.centre : [0, 0];
    const radius = inscribed ? Math.min(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]) / 2 : Number(spec.radius);
    if (!(radius > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const wanted = Number.isFinite(spec.width) ? spec.width : THREE.MathUtils.clamp(EDGE_FADE_FRACTION * radius, EDGE_FADE_RANGE[0], EDGE_FADE_RANGE[1]);
    const width = Math.max(1e-3, Math.min(wanted, radius));
    return { box: [cx - radius, cy - radius, cx + radius, cy + radius], width, contour: width, shape: "disc", disc: [cx, cy, radius], ...(spec.dissolve ? { dissolve: true } : {}) };
  }
  const box = Array.isArray(spec.box) && spec.box.length === 4 ? spec.box : bounds?.min && bounds?.max ? [bounds.min[0], bounds.min[1], bounds.max[0], bounds.max[1]] : null;
  if (!box) return null;
  const [x0, y0, x1, y1] = box;
  const short = Math.min(x1 - x0, y1 - y0);
  if (!(short > 0)) return null;
  const wanted = Number.isFinite(spec.width) ? spec.width : THREE.MathUtils.clamp((Number.isFinite(spec.fraction) ? spec.fraction : EDGE_FADE_FRACTION) * short, EDGE_FADE_RANGE[0], EDGE_FADE_RANGE[1]);
  /* Две полосы затухания с противоположных сторон не должны сойтись: центр куска остаётся целым. */
  const width = Math.max(1e-3, Math.min(wanted, short / 2));
  const contour = Number.isFinite(spec.contour) ? spec.contour : THREE.MathUtils.clamp(EDGE_CONTOUR_FRACTION * short, EDGE_CONTOUR_RANGE[0], EDGE_CONTOUR_RANGE[1]);
  return { box: [x0, y0, x1, y1], width, contour: Math.max(1e-3, Math.min(contour, width)), shape: spec.shape === "box" ? "box" : "footprint" };
}

/* Рёбра плана: `[a, b, c]`, где `a·x + b·y + c` — метры внутрь. */
function planEdges(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > FADE_PLAN_EDGES) return null;
  return points.map(([x0, y0], at) => {
    const [x1, y1] = points[(at + 1) % points.length];
    const size = Math.hypot(x1 - x0, y1 - y0) || 1;
    const a = -(y1 - y0) / size;
    const b = (x1 - x0) / size;
    return [a, b, -(a * x0 + b * y0)];
  });
}

/** Лежит ли точка в плане края (`resolveEdgeFade`): срезанное кадр не рисует, и щелчок сквозь него идёт дальше. */
export function insidePlan({ edges, top }, x, y, z) {
  return z < top && edges.every(([a, b, c]) => a * x + b * y + c > 0);
}

const fields = new WeakMap();

/* Те же вершины и треугольники — те же буферы у каждой сетки по порядку (материал и прочее — не в счёт). */
const sameGeometry = (meshes, source) =>
  Array.isArray(source) && meshes.length === source.length && meshes.every((mesh, index) => mesh.positions === source[index].positions && mesh.indices === source[index].indices);

/**
 * Текстура затухания по контуру куска: красный канал — расстояние до пустоты в долях полосы контура (0 — край, 1 —
 * дальше полосы). Поле считается один раз на сцену и рамку; смена ширины пересчитывает только 8 бит.
 *
 * @param {{ meshes?: object[] }|null|undefined} asset — сцена кадра (`scene-asset.js`)
 * @param {{ box: number[], width: number, contour?: number }} fade — результат `resolveEdgeFade`
 * @returns {THREE.DataTexture|null} `null` — у сцены нечего растрировать: остаётся затухание по рамке
 */
export function edgeFadeMap(asset, fade) {
  if (!asset?.meshes?.length || !fade) return null;
  const key = fade.box.join(",");
  let entry = fields.get(asset);
  if (!entry || entry.key !== key) {
    /* Поле, что посчитал поток разбора (`scene-asset-worker.js`), — если вершины те же, что у кадра (своя раскладка
       материалов, как полотна арены, — та же; урезанная сцена — своя), и рамка та же; иначе — здесь, как раньше. */
    const ready = asset.footprint;
    const fits = ready && ready.box.join(",") === key && sameGeometry(asset.meshes, ready.source);
    entry = { key, field: fits ? ready : footprintDistances(asset.meshes, fade.box) };
    fields.set(asset, entry);
  }
  const field = entry.field;
  if (!field) return null;
  const data = new Uint8Array(field.metres.length);
  const reach = fade.contour ?? fade.width;
  for (let at = 0; at < data.length; at += 1) data[at] = Math.round(Math.min(1, field.metres[at] / reach) * 255);
  const texture = new THREE.DataTexture(data, field.size, field.size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Включает или выключает затухание у материалов перекраски (`createRecolourMaterial`). Программа с новым define
 * собирается заново — только у тех, у кого он менялся.
 *
 * @param {object[]} materials
 * @param {{ box: number[], width: number, map?: THREE.Texture|null }|null} fade — `map` из `edgeFadeMap`: с ней край идёт по
 *   контуру куска, без неё — по рамке
 * @returns {boolean} менялся ли хоть один набор define — вызывающему пора собрать программы заранее
 */
export function applyEdgeFadeTo(materials, fade) {
  let changed = false;
  for (const material of materials) {
    const uniforms = material?.userData?.recolour;
    if (!uniforms?.uRcFade) continue;
    const had = material.defines || {};
    const defines = { ...had };
    if (fade) {
      if (fade.disc) uniforms.uRcFade.value.set(fade.disc[0], fade.disc[1], fade.disc[2], 0);
      else uniforms.uRcFade.value.set(...fade.box);
      uniforms.uRcFadeWidth.value = fade.width;
      uniforms.uRcFadeMap.value = fade.map || null;
      defines.RC_FADE = "";
      if (fade.map) defines.RC_FADE_MAP = "";
      else delete defines.RC_FADE_MAP;
      if (fade.disc) defines.RC_FADE_DISC = "";
      else delete defines.RC_FADE_DISC;
      if (fade.dissolve) defines.RC_FADE_DISSOLVE = "";
      else delete defines.RC_FADE_DISSOLVE;
      if (fade.plan) {
        uniforms.uRcFadePlan.value.forEach((edge, at) => {
          if (fade.plan.edges[at]) edge.set(...fade.plan.edges[at]);
          else edge.set(0, 0, FADE_PLAN_FAR);
        });
        uniforms.uRcFadeTop.value = fade.plan.top;
        defines.RC_FADE_PLAN = "";
      } else delete defines.RC_FADE_PLAN;
    } else {
      delete defines.RC_FADE;
      delete defines.RC_FADE_MAP;
      delete defines.RC_FADE_DISC;
      delete defines.RC_FADE_DISSOLVE;
      delete defines.RC_FADE_PLAN;
      uniforms.uRcFadeMap.value = null;
    }
    if (("RC_FADE" in had) !== ("RC_FADE" in defines) || ("RC_FADE_MAP" in had) !== ("RC_FADE_MAP" in defines) || ("RC_FADE_DISC" in had) !== ("RC_FADE_DISC" in defines) || ("RC_FADE_DISSOLVE" in had) !== ("RC_FADE_DISSOLVE" in defines) || ("RC_FADE_PLAN" in had) !== ("RC_FADE_PLAN" in defines)) {
      material.defines = defines;
      material.needsUpdate = true;
      changed = true;
    }
  }
  return changed;
}

/* Рамка «на весь мир»: расстояние до края куска у любой точки сцены огромное, затухание = 1. */
const FADE_OFF_REACH = 1e7;
let fadeOffMap = null;

/**
 * На время снимка предмета затухание у края куска выключено у материалов `materials` — только значениями uniform (рамка на весь мир,
 * белая карта контура), программы не пересобираются. Плитка панели «Предметы» показывает вещь, а не то, куда её посадил край куска:
 * контейнер «вид 3» стоит у края завода, там кадр гасит вещи в чёрное, и плитка с тем же материалом выходила чёрной (яркость
 * непрозрачных пикселей 13 из 255 против 44 без затухания; ТЗ 26.10.2026). Возвращает функцию «вернуть как было».
 *
 * @param {object[]} materials
 * @returns {() => void}
 */
export function suspendEdgeFade(materials) {
  const kept = [];
  for (const material of new Set(materials)) {
    const uniforms = material?.userData?.recolour;
    const defines = material?.defines;
    if (!uniforms?.uRcFade || !defines || !("RC_FADE" in defines)) continue;
    kept.push([uniforms, uniforms.uRcFade.value.clone(), uniforms.uRcFadeMap.value, uniforms.uRcFadePlan.value.map((edge) => edge.clone()), uniforms.uRcFadeTop.value]);
    for (const edge of uniforms.uRcFadePlan.value) edge.set(0, 0, FADE_PLAN_FAR);
    uniforms.uRcFadeTop.value = FADE_PLAN_FAR;
    if ("RC_FADE_DISC" in defines) uniforms.uRcFade.value.set(0, 0, FADE_OFF_REACH, 0);
    else uniforms.uRcFade.value.set(-FADE_OFF_REACH, -FADE_OFF_REACH, FADE_OFF_REACH, FADE_OFF_REACH);
    if ("RC_FADE_MAP" in defines) {
      fadeOffMap ||= Object.assign(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType), { needsUpdate: true });
      uniforms.uRcFadeMap.value = fadeOffMap;
    }
  }
  return () => {
    for (const [uniforms, box, map, plan, top] of kept) {
      uniforms.uRcFade.value.copy(box);
      uniforms.uRcFadeMap.value = map;
      uniforms.uRcFadePlan.value.forEach((edge, at) => edge.copy(plan[at]));
      uniforms.uRcFadeTop.value = top;
    }
  };
}
