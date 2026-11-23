/*
 * План обложки компонента редукса по описи (Р6, `REDUX-SYSTEM-1011.md` §8 и §11; Хелпер 29, 11.11.2026).
 *
 * Обложка строится из моделей самого компонента, а вид задаёт только камера. Конвейер кладёт в `part.json` блок `scene` (`packages/rpf-inspector/anatomy-scene.js`, схема 2):
 * камера по слоту, модели, места моделей в мире из `.ymap` компонента, рамка по местам, `world`. Здесь — только решение, без чтения файлов и без окна (тесты без игры):
 * каким видом снимать, что поставить в кадр и по чему проверять результат. Размеры моделей приходят от сборщика сцены (`mod-model-scene.js`: `facts` — `[{ name, triangles, min, max }]` в осях игры).
 *
 *   • зал — арена, ангар, интерьер: свои сцены мастерской, камера у входа (`ARENA_LOBBY_COVER`, `HANGAR_COVER_EYE`, интерьер от входа, `ref/2`, `ref/3`, `ref/6`, `ref/7`);
 *   • экран — мини-карта, большая карта, прицел, таймцикл, эффекты, звук: свои сцены, «как сейчас»;
 *   • карточка — цвета интерфейса, вода, переключатели: обложка-карточка;
 *   • объект — `building-front`, `model-front`: объект спереди, вокруг круг мира, дальше чёрное (`ref/4`, `ref/5`), если у компонента есть места в мире (`world`); нет мест — модели на нейтральной
 *     сцене (`model-cover-plan.js`), а нет и моделей, которые можно показать, — обложки нет (причина названа, ничего не выдумывается: «нечего честно показать — не ставить кадр»).
 */

import { familyOf, planModelCover, usableModel } from "./model-cover-plan.js";

/** Запас круга мира за краем мест, м (как у кругов мест мастерской, `prepare-world-ring.mjs`). */
export const RING_MARGIN = 35;
/** Круг мира не меньше и не больше этого радиуса, м: меньше — вокруг объекта ничего нет, больше — не влезает в бюджет сцены (`prepare-capt-territory.mjs`: 235 м у самой большой зоны). */
export const RING_MIN = 40;
export const RING_MAX = 235;
/** Глаз стоит напротив объекта на этой доле его размера (по большей стороне основания) и не ближе `FRONT_MIN`, м: `ref/5` — здание целиком с парковки. */
const FRONT_SHARE = 1.4;
const FRONT_MIN = 4;

/** Виды, у которых своя сцена мастерской и камера у входа: `[режим, редактор, вид]`. */
const HALLS = Object.freeze({
  "arena-hall": ["hall", "arenas", "lobby"],
  "hangar-entrance": ["hall", "hangar", "entrance"],
  "interior-entrance": ["hall", "interior", "entrance"],
});

/** Экранные виды: сцена та же, что у плитки мастерской («как сейчас»). */
const SCREENS = Object.freeze(new Set(["minimap", "large-map", "crosshair", "timecycle", "effects", "sounds"]));

/** Виды-карточки: у компонента своей картинки нет, обложка — карточка вида. */
const CARDS = Object.freeze(new Set(["card"]));

/** Виды-объекты: камера смотрит на здание или модель. */
const OBJECTS = Object.freeze(new Set(["building-front", "model-front"]));

/*
 * Ракурс объекта (радианы): `pitch` — подъём глаза, `zoom` — посадка в кадр (1 — как открывается редактор). Здание целиком — выше и дальше, вещь — ближе и круче (`cover-views.js`:
 * Ашан `pitch 0,2 zoom 0,7`, ангар `ref/5` — `pitch ≈ 0,15–0,2`, `zoom ≈ 0,9–1,1`).
 */
const OBJECT_VIEWS = Object.freeze({
  "building-front": { pitch: 0.18, zoom: 1 },
  "model-front": { pitch: 0.25, zoom: 1 },
});

const sizeOf = (fact) => fact.max.map((value, axis) => value - fact.min[axis]);
const baseOf = (fact) => {
  const [width, depth] = sizeOf(fact);
  return width * depth;
};
const stemOf = (name) => String(name || "").toLowerCase().replace(/\.[a-z0-9]+$/, "");
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Виды, что знает планировщик, по способам съёмки (для описи камер `component-cover-cameras.js` и её теста): залы — вид → `[способ, редактор, вид]`, экраны, карточки, объекты. */
export const COVER_CAMERAS = Object.freeze({ halls: HALLS, screens: [...SCREENS], cards: [...CARDS], objects: [...OBJECTS] });

/**
 * Запись для журнала этапа обложек (`covers.jsonl`): какой вид и какой способ съёмки описи компонента, без размеров моделей — `{ camera, shot }` или `null`, если блока `scene` нет.
 * Для вида-объекта способ — тот же, что у ворот (`coverModeOf`: `world` или `models`); неизвестный вид записан как есть в `assumed`.
 */
export function planNoteOf(scene) {
  if (!scene || typeof scene !== "object") return null;
  const { kind, known } = cameraKind(scene);
  const shot = HALLS[kind] ? HALLS[kind][0] : SCREENS.has(kind) ? "screen" : CARDS.has(kind) ? "card" : coverModeOf(scene);
  return { camera: kind, shot, ...(known ? {} : { assumed: String(scene.camera || "") }) };
}

/**
 * Какой вид снимать: `scene.camera`, а неизвестный — как здание спереди (так же решает `cameraOfSlot`).
 * @returns {{ kind: string, known: boolean }}
 */
export function cameraKind(scene) {
  const kind = String(scene?.camera || "");
  const known = Object.hasOwn(HALLS, kind) || SCREENS.has(kind) || CARDS.has(kind) || OBJECTS.has(kind);
  return { kind: known ? kind : "building-front", known: known || kind === "" };
}

/**
 * Режим обложки для ворот (`cover-gate.js`, `SUBJECT_MODES`) по одному блоку `scene`, без размеров моделей: `"world"` — объект спереди и круг мира (места есть), `"models"` — объект на нейтральной
 * сцене (вид-объект, мест нет), иначе пусто — общие проверки ворот. Совпадает с `planComponentCover` там, где тот не зависит от размеров моделей.
 */
export function coverModeOf(scene) {
  if (!scene || typeof scene !== "object") return "";
  const { kind } = cameraKind(scene);
  if (!OBJECTS.has(kind)) return "";
  return scene.world && Array.isArray(scene.places) && scene.places.length ? "world" : "models";
}

/**
 * Предмет кадра среди мест компонента: модель с самым большим основанием (по размерам модели; нет размеров — по числу мест, затем по имени), и все её места.
 * @param {{ model: string, position: number[], rotation?: number[] }[]} places
 * @param {{ name: string, min: number[], max: number[] }[]} facts
 */
export function subjectOf(places, facts = []) {
  const byModel = new Map();
  for (const place of places) {
    const list = byModel.get(stemOf(place.model)) || [];
    list.push(place);
    byModel.set(stemOf(place.model), list);
  }
  const factOf = (stem) => facts.find((fact) => stemOf(fact.name) === stem && Array.isArray(fact.min) && Array.isArray(fact.max));
  const ranked = [...byModel.entries()].sort(([left, leftPlaces], [right, rightPlaces]) => {
    const a = factOf(left);
    const b = factOf(right);
    if (a && b && baseOf(a) !== baseOf(b)) return baseOf(b) - baseOf(a);
    if (Boolean(a) !== Boolean(b)) return a ? -1 : 1;
    return rightPlaces.length - leftPlaces.length || left.localeCompare(right);
  });
  if (!ranked.length) return null;
  const [stem, own] = ranked[0];
  const fact = factOf(stem) || null;
  return { model: stem, places: own, fact, extent: fact ? Math.max(...sizeOf(fact).slice(0, 2)) : null, family: familyOf(stem) };
}

/**
 * Круг мира вокруг мест: центр рамки, радиус — самое дальнее место плюс запас; в пределах `RING_MIN`…`RING_MAX` и не меньше половины предмета кадра (здание на краю входит целиком).
 */
export function ringOf(frame, subject = null) {
  if (!frame?.center) return null;
  const half = subject?.extent ? subject.extent / 2 : 0;
  return { centre: [...frame.center], radius: clamp(Math.max((Number(frame.radius) || 0) + RING_MARGIN, half + RING_MARGIN), RING_MIN, RING_MAX) };
}

/**
 * План обложки: `{ shot, ... }` — `shot` (способ съёмки), а не `mode`: слово `mode` в `apps/desktop/src` ищет тест помощника RPF (`rpf-helper-capabilities.test.js`) как режим его вызова.
 *   `hall`    — `{ editor, view }`: сцена мастерской у входа (арена — `venue`, если доказан, и второй кадр снаружи);
 *   `screen`  — `{ editor }`; `card` — `{}`;
 *   `world`   — `{ subject, places, ring, view: { pitch, zoom, distance } }`: объект спереди и круг мира;
 *   `models`  — `{ plan }`: `planModelCover` (вещи, здание с пристройками, площадка) на нейтральной сцене;
 *   `none`    — `{ reason }`: честно показать нечего.
 *
 * @param {object} scene блок `scene` описи (`sceneOf`)
 * @param {{ facts?: object[], hint?: string }} [options] размеры моделей (`modelFact`) и название части для поиска её модели
 */
export function planComponentCover(scene, { facts = [], hint = "" } = {}) {
  const { kind, known } = cameraKind(scene);
  const base = { camera: kind, ...(known ? {} : { assumed: String(scene?.camera || "") }) };
  if (HALLS[kind]) {
    const [shot, editor, view] = HALLS[kind];
    return { ...base, shot, editor, view, ...(kind === "arena-hall" ? { second: "outside", ...(scene?.venue ? { venue: scene.venue } : {}) } : {}) };
  }
  if (SCREENS.has(kind)) return { ...base, shot: "screen", editor: kind };
  if (CARDS.has(kind)) return { ...base, shot: "card" };
  const places = Array.isArray(scene?.places) ? scene.places : [];
  if (scene?.world && places.length) {
    const subject = subjectOf(places, facts);
    const ring = ringOf(scene.frame, subject);
    const look = OBJECT_VIEWS[kind] || OBJECT_VIEWS["building-front"];
    const distance = subject?.extent ? Math.max(FRONT_MIN, subject.extent * FRONT_SHARE) : null;
    return { ...base, shot: "world", subject, places: places.filter((place) => stemOf(place.model) === subject?.model), ring, view: { ...look, ...(distance ? { distance } : {}) } };
  }
  const plan = planModelCover(facts.filter(usableModel), { hint });
  if (plan) return { ...base, shot: "models", plan };
  const total = Array.isArray(scene?.models) ? scene.models.length : 0;
  return { ...base, shot: "none", reason: total ? "у моделей компонента нет читаемой геометрии (заглушки, запасные уровни, служебные)" : "в компоненте нет моделей, которые можно показать" };
}
