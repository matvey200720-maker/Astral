/*
 * Обложка «своих моделей автора» (растительность и фонари редукса, 13.11.2026).
 *
 * Часть «Растительность» редукса (`sakura_trees_artis.rpf`: `spex_trees.ydr` с листами `trees.ytd`) и часть «Фонари» (`lanterns.rpf`: десятки `.ydr`/`.yft`, от столбов до
 * тоннельных оболочек) — свои модели автора, а штатных у них нет: сцены растительности мастерской (дуб, куст, земля) ждут имена игры и ничего не находят, а фонарям сцены нет вовсе.
 * Обложка — сами модели автора со своими листами на нейтральной сцене мастерской (`mod-model-scene.js`, тот же способ, что у моделей маппинга и ангара): листы берутся
 * из моделей и словарей `.ytd` части; где листа у автора нет, его кладёт игра игрока (`fill`, печь с `--game`) либо поверхность серая — подпись обложки говорит, что это сцена мастерской, и называет серое. Света, которого в файле нет, не выдумывается: ночное свечение ламп (`emissivenight`) днём не горит, кадр дневной.
 *
 * Здесь — выбор моделей и раскладка кадра (чистые функции, тесты без окна и игры) и сборка запроса окну-съёмщику. Окно, листы игры и подпись приходят снаружи (`part-covers.js`).
 *
 *   • растительность — самые крупные деревья автора (до трёх, разных семейств), в ряд; тёмные листья (серый ствол, чёрные лепестки) — на светлой студии, иначе они сливаются с полом;
 *   • фонари — столбы, а не тоннели и дороги (по имени и размеру): уличные фонари раньше настенных и промышленных, у каждой серии одна модель (`_def`, `_s`, буква-вариант — один и тот же
 *     столб), те, у которых листы есть в файлах, раньше тех, кому листа не хватает; до трёх в ряд.
 *
 * Ракурсы снимаются одной сценой (`views` окна), а обложкой становится первый кадр, прошедший ворота обложки (`cover-gate.js`): у тонкого столба середина кадра пуста, у его головы — нет, поэтому
 * фонари начинаются с головы главного столба, а ряд идёт в галерею. Остальные кадры, что не пусты и не чёрные, — галерея (не больше `GALLERY_MAX`).
 */

import { inflateRawNode } from "@modovik/rpf7/node";
import {
  decodeTextureRef,
  readDrawable,
  readTextureDictionary,
} from "@modovik/rage-drawable";
import { inspectCover } from "./cover-gate.js";
import {
  isDrawn,
  meanLuminance,
  modelFact,
  modelsScene,
} from "./mod-model-scene.js";
import { usableModel } from "./model-cover-plan.js";

/**
 * Подписи обложек (ключи словаря окна, `ui-text/zone-own-model-cover-1311.js`): прямо говорят, что на картинке — сцена мастерской с моделями автора, а не кадр игры. Оговоркой в смысле публикации
 * (`captionIsDisclaimer`: «не кадр из игры», «нарисовано Astral») они не считаются — иначе окно спрятало бы подпись, а она и говорит, что на кадре.
 */
export const OWN_MODEL_CAPTIONS = Object.freeze({
  "vegetation-world":
    "Деревья автора на сцене мастерской, с текстурами из его файлов",
});
/** Та же подпись, когда у части поверхностей без листа заметно больше: серое названо прямо. */
export const OWN_MODEL_CAPTIONS_BARE = Object.freeze({
  "vegetation-world":
    "Деревья автора на сцене мастерской: где в его файлах нет текстуры, поверхность серая",
});
/** Виды, что снимаются своими моделями автора: деревья — этим модулем, фонари — одним столбом ночью (`lantern-night-cover.js`). */
export const OWN_MODEL_KINDS = Object.freeze(["vegetation-world", "lanterns"]);

/** Сколько моделей в кадре. */
export const PICK_MAX = 3;
/** Кадров галереи — не больше (обложка в счёт не идёт). */
export const GALLERY_MAX = 2;
/** Сколько моделей читается ради выбора: у части фонарей их десятки, а не тысячи. */
const SCAN_LIMIT = 300;
/** Доля треугольников с листом (у автора или в игре), ниже которой модель — «серая» и выбирается в последнюю очередь. */
const COVERAGE_GOOD = 0.6;
/** Поверхностей без листа больше этой доли — подпись называет серое. */
const BARE_SHARE = 0.05;
/** Средняя яркость листов (0…255) ниже этой — кадр на светлой студии: тёмное на тёмном полу (22) не читается. */
export const LIGHT_BELOW = 60;
/** Деревья: от этой высоты, м (куст ниже — тоже растение, но ряд из травы кадр не держит). */
const TREE_MIN_HEIGHT = 2.5;
/** Фонарь — столб: высота в этих пределах, м, и размах по земле не шире. */
const LAMP_HEIGHT = Object.freeze([2.5, 30]);
const LAMP_REACH = 12;
/** Запас между моделями в ряду: доля высоты самой высокой, не меньше метра. */
const ROW_GAP_SHARE = 0.35;
/** Крона дерева — верхняя доля высоты. */
const CROWN_SHARE = 0.7;

// ---------------------------------------------------------------- чистые помощники

const stemOf = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "");
const sizeOf = (fact) => fact.max.map((value, axis) => value - fact.min[axis]);
const centreOf = (fact, axis) => (fact.max[axis] + fact.min[axis]) / 2;
const reachOf = (fact) => Math.max(...sizeOf(fact).slice(0, 2));
const heightOf = (fact) => sizeOf(fact)[2];

/** Не облик объекта: тоннели, дороги, оболочки, запасной уровень и служебные модели — для фонарей. */
const NOT_LAMP =
  /tunnel|(^|_)tun\d|shell|road|(^|_)rd\d|fwy|detail|ground|dummy|decal|dcl|strip|stuff|critical|interior|(^|_)int(_|$)|strm|lod|shadow|sign|snow/i;
const LAMP_WORD = /light|lamp|lantern/i;
/** Упавшее, мёртвое, зимнее, запасной уровень — не облик дерева. */
const NOT_TREE =
  /fallen|stump|(^|_)log(_|$)|dead|burnt|lod|wint|snow|shadow|decal|dummy/i;

/**
 * Серия модели: `zc_prop_streetlight_03b_def` и `prop_streetlight_03d` — один столб с разными кронштейнами и тенями; ключ — имя без приставки `zc_`, без `_def` / `_s` и без буквы-варианта.
 * По ключу в кадр идёт одна модель серии.
 */
export function seriesKey(name) {
  let stem = stemOf(name).replace(/^zc_/, "");
  for (let step = 0; step < 3; step += 1) stem = stem.replace(/_(def|s)$/, "");
  return stem.replace(/(\d)[a-z]$/, "$1").replace(/(\d)_[a-z]$/, "$1");
}

/** Ступень фонаря: 0 — уличный фонарь, 1 — настенный или промышленный светильник, 2 — прочие светильники; `null` — не фонарь. */
export function lampTier(fact) {
  const stem = stemOf(fact?.name);
  if (!fact || !LAMP_WORD.test(stem) || NOT_LAMP.test(stem)) return null;
  if (!usableModel(fact)) return null;
  const [low, high] = LAMP_HEIGHT;
  if (!(
    heightOf(fact) >= low &&
    heightOf(fact) <= high &&
    reachOf(fact) <= LAMP_REACH
  ))
    return null;
  if (/street/.test(stem)) return 0;
  if (/(wall|ind)_?light/.test(stem)) return 1;
  return 2;
}

/** Ступень дерева: 0 — дерево (высокое), 1 — остальное растение; `null` — упавшее, мёртвое, запасной уровень, заглушка. */
export function treeTier(fact) {
  const stem = stemOf(fact?.name);
  if (!fact || NOT_TREE.test(stem) || !usableModel(fact)) return null;
  return heightOf(fact) >= TREE_MIN_HEIGHT ? 0 : 1;
}

/**
 * Выбор моделей кадра. `rows` — `[{ fact, coverage, luma? }]`: сводка модели (`modelFact`), доля её треугольников с листом (0…1) и средняя яркость листов (0…255). Ответ — до `PICK_MAX`
 * записей той же формы в порядке кадра: сначала те, у кого листы есть, затем ступень (фонарь или дерево), затем число треугольников; по одной модели на серию.
 */
export function pickOwnModels(kind, rows) {
  const ranked = rows
    .map((row) => ({
      ...row,
      tier: kind === "lanterns" ? lampTier(row.fact) : treeTier(row.fact),
    }))
    .filter((row) => row.tier !== null)
    .sort((left, right) => {
      const goodLeft = left.coverage >= COVERAGE_GOOD ? 0 : 1;
      const goodRight = right.coverage >= COVERAGE_GOOD ? 0 : 1;
      return (
        goodLeft - goodRight ||
        left.tier - right.tier ||
        right.fact.triangles - left.fact.triangles ||
        left.fact.name.localeCompare(right.fact.name)
      );
    });
  const taken = new Set();
  const chosen = [];
  for (const { tier: _tier, ...row } of ranked) {
    const key = seriesKey(row.fact.name);
    if (taken.has(key)) continue;
    taken.add(key);
    chosen.push(row);
    if (chosen.length >= PICK_MAX) break;
  }
  return chosen;
}

/** Светлая ли студия нужна кадру: средняя яркость листов выбранных моделей (по треугольникам) ниже `LIGHT_BELOW`. Яркости нет ни у одной — студия обычная. */
export function wantsLightStudio(chosen) {
  const known = chosen.filter((row) => Number.isFinite(row.luma));
  const weight = known.reduce((sum, row) => sum + row.fact.triangles, 0);
  if (!weight) return false;
  return (
    known.reduce((sum, row) => sum + row.luma * row.fact.triangles, 0) /
      weight <
    LIGHT_BELOW
  );
}

/**
 * Раскладка кадра: модели в ряд вдоль оси x, каждая стоит на своей земле (низ на нуле), центры по земле — по порядку, середина ряда — в начале. Ответ — `{ items, boxes }`:
 * `items` — запись плана `modelsScene` (`name`, `at`, `ground`), `boxes` — коробка каждой модели в осях сцены (низ на нуле) для крупных кадров.
 */
export function rowLayout(facts) {
  if (!facts.length) return { items: [], boxes: [] };
  const tallest = Math.max(...facts.map(heightOf));
  const gap = Math.max(1, tallest * ROW_GAP_SHARE);
  const widths = facts.map((fact) => sizeOf(fact)[0]);
  const total =
    widths.reduce((sum, width) => sum + width, 0) + gap * (facts.length - 1);
  const items = [];
  const boxes = [];
  let left = -total / 2;
  facts.forEach((fact, index) => {
    const spot = [left + widths[index] / 2, 0];
    const at = [spot[0] - centreOf(fact, 0), spot[1] - centreOf(fact, 1)];
    items.push({ name: fact.name, at, ground: fact.min[2] });
    boxes.push({
      min: [fact.min[0] + at[0], fact.min[1] + at[1], 0],
      max: [fact.max[0] + at[0], fact.max[1] + at[1], heightOf(fact)],
    });
    left += widths[index] + gap;
  });
  return { items, boxes };
}

const unionOf = (boxes) => ({
  min: [0, 1, 2].map((axis) => Math.min(...boxes.map((box) => box.min[axis]))),
  max: [0, 1, 2].map((axis) => Math.max(...boxes.map((box) => box.max[axis]))),
});

/** Верхняя часть коробки (доля высоты сверху): голова фонаря, крона дерева. */
export const upperPart = (box, share) => ({
  min: [box.min[0], box.min[1], box.max[2] - (box.max[2] - box.min[2]) * share],
  max: [...box.max],
});

/**
 * Ракурсы кадра по порядку — кандидаты в обложку, остальные уйдут в галерею (одной сценой, `views` окна). Углы — радианы окна (`scene-cover-shots.js`: `orbitOf`); `bounds` — коробка, что
 * камера сажает в кадр целиком; `crop` и `zoom` меньше единицы — плотнее посадка.
 *   • растительность: дерево целиком в три четверти — сбоку пониже, шире — крона сверху.
 * `light` — светлая студия (`backdrop`): у тёмных листьев тёмный пол не годится.
 * @returns {{ id: string, view: object }[]}
 */
export function ownModelViews(kind, layout, { light = false } = {}) {
  const { boxes } = layout;
  if (!boxes.length) return [];
  const studio = light ? { backdrop: "light" } : {};
  const all = unionOf(boxes);
  const candidates = [
    {
      id: "tree",
      view: {
        yaw: -0.6,
        pitch: 0.25,
        crop: true,
        zoom: 0.8,
        bounds: all,
      },
    },
    {
      id: "side",
      view: { yaw: 0.5, pitch: 0.1, crop: true, zoom: 0.8, bounds: all },
    },
    {
      id: "crown",
      view: {
        yaw: -0.25,
        pitch: 0.5,
        crop: true,
        zoom: 0.6,
        bounds: upperPart(boxes[0], CROWN_SHARE),
      },
    },
  ];
  return candidates.map(({ id, view }) => ({
    id,
    view: { ...view, ...studio },
  }));
}

/**
 * Кадры окна по порядку ракурсов → обложка и галерея. Обложка — первый кадр, прошедший ворота обложки (`gate(frame, { cover: true })`); ни один не прошёл — первый (отказ даст этап обложек
 * с причиной). Галерея — остальные кадры, что прошли общие проверки (не чёрные, не одноцветные, не пустые: `gate(frame, { cover: false })`), не больше `GALLERY_MAX`.
 * @returns {{ cover: number, gallery: number[], passed: boolean }}
 */
export async function chooseFrames(frames, gate) {
  let cover = -1;
  for (let at = 0; at < frames.length && cover < 0; at += 1)
    if ((await gate(frames[at], { cover: true }))?.ok) cover = at;
  const passed = cover >= 0;
  const lead = passed ? cover : 0;
  const gallery = [];
  for (
    let at = 0;
    at < frames.length && gallery.length < GALLERY_MAX;
    at += 1
  ) {
    if (at === lead) continue;
    if ((await gate(frames[at], { cover: false }))?.ok) gallery.push(at);
  }
  return { cover: lead, gallery, passed };
}

/** Подпись обложки по виду и доле поверхностей без листа. */
export function ownModelCaption(kind, bareShare = 0) {
  const table =
    bareShare >= BARE_SHARE ? OWN_MODEL_CAPTIONS_BARE : OWN_MODEL_CAPTIONS;
  return table[kind] || "";
}

// ---------------------------------------------------------------- чтение моделей

export const bytesOf = async (file) => {
  const value =
    file?.bytes ??
    (typeof file?.read === "function" ? await file.read() : null);
  return value ? new Uint8Array(value) : null;
};

const isModel = (file) => /\.(ydr|yft)$/i.test(String(file?.name || ""));
const isDictionary = (file) => /\.ytd$/i.test(String(file?.name || ""));
/** Сторона, до которой листы читаются ради яркости: среднее по мелкому уровню то же, что по полному. */
const LUMA_SIDE = 64;

function drawableOf(bytes) {
  try {
    return (
      readDrawable(bytes, { inflateRaw: inflateRawNode }).drawables[0] || null
    );
  } catch {
    return null;
  }
}

/** Листы словарей `.ytd` части: имя (строчное) → ссылка. Словарь, что не читается, пропускается. */
async function dictionaryRefs(files) {
  const refs = new Map();
  for (const file of files.filter(isDictionary)) {
    try {
      const bytes = await bytesOf(file);
      if (!bytes) continue;
      for (const ref of readTextureDictionary(bytes, {
        inflateRaw: inflateRawNode,
      }))
        refs.set(String(ref.name || "").toLowerCase(), ref);
    } catch {
      /* словарь не читается — у моделей останутся их собственные листы */
    }
  }
  return refs;
}

/**
 * Листы модели: доля треугольников с листом у автора (в самой модели или в словарях части; сетка без имени листа — наклейка или цвет — не штрафуется) и средняя яркость этих листов
 * (по треугольникам; листы читаются мелким уровнем, у каждого — один раз на `lumaOf`).
 */
export function sheetsOf(drawable, dictionary, lumaOf = new Map()) {
  const embedded = new Map(
    (drawable.embeddedTextures || []).map((ref) => [
      String(ref.name || "").toLowerCase(),
      ref,
    ]),
  );
  let named = 0;
  let found = 0;
  let lumaSum = 0;
  let lumaWeight = 0;
  for (const mesh of drawable.meshes.filter(isDrawn)) {
    const name = String(mesh.material?.textures?.diffuse || "").toLowerCase();
    if (!name || /_pal$/.test(name)) continue;
    const triangles = mesh.indices.length / 3;
    named += triangles;
    const ref = embedded.get(name) || dictionary.get(name);
    if (!ref) continue;
    found += triangles;
    const key = `${name}|${ref.width}x${ref.height}`;
    if (!lumaOf.has(key)) {
      try {
        lumaOf.set(
          key,
          meanLuminance(decodeTextureRef(ref, { maxSize: LUMA_SIDE }).rgba),
        );
      } catch {
        lumaOf.set(key, null);
      }
    }
    const luma = lumaOf.get(key);
    if (luma !== null) {
      lumaSum += luma * triangles;
      lumaWeight += triangles;
    }
  }
  return {
    coverage: named ? found / named : 1,
    luma: lumaWeight ? lumaSum / lumaWeight : null,
  };
}

/** Строки выбора по файлам части: сводка, доля листов и яркость каждой читаемой модели. */
export async function modelRows(files) {
  const dictionary = await dictionaryRefs(files);
  const lumaOf = new Map();
  const rows = [];
  for (const file of files.filter(isModel).slice(0, SCAN_LIMIT)) {
    const bytes = await bytesOf(file).catch(() => null);
    if (!bytes) continue;
    const fact = modelFact(file.name, bytes);
    const drawable = fact ? drawableOf(bytes) : null;
    if (fact && drawable)
      rows.push({ fact, ...sheetsOf(drawable, dictionary, lumaOf) });
  }
  return rows;
}

// ---------------------------------------------------------------- кадр

const encoder = new TextEncoder();
const jsonFile = (name, value) => ({
  name,
  bytes: encoder.encode(JSON.stringify(value)),
});

function debugLine(...parts) {
  if (process.env.ASTRAL_COVER_DEBUG) console.error("[cover]", ...parts);
}

/** Ворота кадра своих моделей: те же, что у этапа обложек. Для обложки — с проверкой предмета в середине кадра («модели»), для галереи — общие проверки. */
const gateOf =
  (kind) =>
  (frame, { cover }) =>
    inspectCover(frame, { kind, ...(cover ? { mode: "models" } : {}) });

/**
 * Обложка и галерея своих моделей части. `job`: `kind` (`vegetation-world` или `lanterns`), `files` (модели и словари части, `{ name, bytes | read }`), `name`, `render` (окно-съёмщик),
 * `fill` — листы игры тем, чего нет у автора (`async (names) => Map`, необязательно), `onGallery`, `onStaged`. Ответ — `{ png, gallery, caption }` или `null` (нет окна, нет подходящих моделей,
 * сцена не собралась, окно не вернуло кадр).
 */
export async function ownModelCover(job) {
  const {
    kind,
    files = [],
    name = "",
    render,
    fill = null,
    onGallery = null,
    onStaged = null,
  } = job;
  if (!OWN_MODEL_KINDS.includes(kind) || typeof render !== "function")
    return null;
  /* Фонарь — один столб целиком и ночью, со светом из записей его файла: у него свой модуль (`lantern-night-cover.js`). */
  if (kind === "lanterns") {
    const { lanternNightCover } = await import("./lantern-night-cover.js");
    return lanternNightCover(job);
  }
  const rows = await modelRows(files);
  const chosen = pickOwnModels(kind, rows);
  debugLine(
    name,
    "своих моделей в кадре:",
    JSON.stringify(
      chosen.map((row) => [
        row.fact.name,
        row.fact.triangles,
        Number(row.coverage.toFixed(2)),
        row.luma === null ? null : Math.round(row.luma),
      ]),
    ),
    "из",
    rows.length,
  );
  if (!chosen.length) return null;

  const layout = rowLayout(chosen.map((row) => row.fact));
  const built = await modelsScene({
    files,
    plan: { items: layout.items },
    fill,
  });
  if (!built) {
    debugLine(name, "сцена не собралась");
    return null;
  }
  const total = built.textured + built.filled + built.bare;
  const bareShare = total ? built.bare / total : 1;
  debugLine(
    name,
    "треугольников: с листом",
    built.textured,
    "листы игры",
    built.filled,
    "серых",
    built.bare,
  );
  if (built.textured + built.filled === 0) return null;

  const light = wantsLightStudio(chosen);
  const candidates = ownModelViews(kind, layout, { light });
  const [lead] = candidates;
  const head = {
    scene: "mod",
    frame: "models",
    view: lead.view,
    views: candidates.map((one) => one.view),
  };
  const request = [
    jsonFile("scene.json", head),
    { name: "scene.bin", bytes: built.bytes },
    ...built.sheets.map(({ key, bytes }) => ({ name: key, bytes })),
  ];
  const shot = await render({
    kind: "redux-part",
    partKind: "scene",
    name,
    files: request,
  });
  const frames = [shot?.png, ...(shot?.gallery || [])].filter(
    (frame) => frame?.length,
  );
  if (!frames.length) {
    debugLine(name, "окно не вернуло кадр");
    return null;
  }
  const picked = await chooseFrames(frames, gateOf(kind));
  debugLine(
    name,
    "кадров:",
    frames.length,
    "обложка — ракурс",
    candidates[picked.cover]?.id ?? picked.cover,
    picked.passed ? "(прошла ворота)" : "(ни один не прошёл ворота)",
    "галерея:",
    JSON.stringify(picked.gallery.map((at) => candidates[at]?.id ?? at)),
  );
  onStaged?.(bareShare >= BARE_SHARE ? "models-bare" : "models");
  const gallery = picked.gallery.map((at) => frames[at]);
  if (gallery.length && typeof onGallery === "function")
    await onGallery(gallery);
  return {
    png: frames[picked.cover],
    ...(gallery.length ? { gallery } : {}),
    caption: ownModelCaption(kind, bareShare),
  };
}
