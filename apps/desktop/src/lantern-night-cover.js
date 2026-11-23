/*
 * Обложка «Фонарей» редукса: один столб целиком ночью, со светом из записей его файла (13.11.2026).
 *
 * Слова владельца: «делай полностью столб какой-то один… свет показывать, какой будет». Обложка — один уличный столб автора от земли до плафона на ночной студии мастерской: лампа
 * горит цветом, силой, дальностью и конусом из записи света в самом файле модели (`model-lights.js`: `LightAttributes`), пятно на земле считается по замеренной модели света игры
 * (`lamp-pool.js`), а у плафона светится ореол размером и силой из записи короны. Ничего не выдумывается: у модели без записи света столб стоит без света, а подпись обложки
 * (`LANTERN_CAPTIONS.unlit`) говорит, что света в файле нет.
 *
 * Какой столб. Уличный фонарь, а не тоннель и не дорога (имя и размер, `lampTier`); у кого есть запись света; кого автор поменял — рядом с моделью лежит её штатный двойник `…_def`
 * (в нём свет игры байт в байт: проверено по `prop_streetlight_*` из `x64h.rpf`), и запись света отличается; потом тот, чей рисунок лучше заполняет кадр (размах к высоте), и богаче сеткой.
 *
 * Вторая картинка галереи, если автор свет менял: «слева из игры, справа из файла автора» — два столба рядом, у левого свет штатного двойника (или, когда двойника нет, свет штатной
 * модели из игры игрока), у правого — автора. Третья — крупно плафон с ореолом.
 *
 * Тонкий столб не проходит ворота «предмет в середине кадра»: там середина по замыслу пуста. Кадр идёт в режим «высокий предмет» (`cover-gate.js`: `TALL_MODE`, ответ рисовальщика
 * `layout: "tall"`): рамка высока, стоит по середине, в центральной полосе есть сам предмет.
 */

import { inspectCover } from "./cover-gate.js";
import { modelsScene } from "./mod-model-scene.js";
import { lampPool } from "./lamp-pool.js";
import { keepMissing } from "./game-source-missing.js";
import { readModelLights } from "./model-lights.js";
import {
  GALLERY_MAX,
  bytesOf,
  lampTier,
  modelRows,
  rowLayout,
  upperPart,
} from "./own-model-cover.js";

/** Подписи обложек (ключи словаря окна, `ui-text/zone-own-covers-1311.js`): не оговорки, а описание кадра. */
export const LANTERN_CAPTIONS = Object.freeze({
  lit: "Фонарь автора ночью на сцене мастерской: свет и ореол — по записи в его файле",
  unlit:
    "Фонарь автора на сцене мастерской: в его файле у модели нет записи света",
  pair: "Свет фонаря: слева из игры, справа из файла автора",
});

/** Сколько моделей читается ради света: столбы-кандидаты с запасом, остальное (тоннели, дороги) отсеяно по имени. */
const POLE_LIMIT = 48;
/** Пол кадра: ширина и глубина в высотах столба, поле вокруг ламп и оснований, м. */
const FLOOR_WIDTH = 1.35;
const FLOOR_DEPTH = 1.0;
const FLOOR_MARGIN = 3.6;
/** Расстояние между столбами пары в высотах столба. */
const PAIR_GAP = 1.25;
/** Голова фонаря — верхняя доля высоты столба: плафоны и кронштейны. */
const HEAD_SHARE = 0.3;
/** Рамка головы: вокруг ламп по горизонтали, м. */
const HEAD_AROUND = 2.4;
/** Не больше стольких ламп в плане окна (слотов у кадра — десяток). */
const LIGHTS_MAX = 8;

const stemOf = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "");
const extensionOf = (name) =>
  (/\.[a-z0-9]+$/i.exec(String(name || "")) || [""])[0];
const heightOf = (fact) => fact.max[2] - fact.min[2];
const reachOf = (fact) =>
  Math.max(fact.max[0] - fact.min[0], fact.max[1] - fact.min[1]);

/** Штатный двойник автора: `prop_x_def.yft` — модель с светом игры, `prop_x.yft` — автора. */
export const isStockTwin = (name) => /_def(?:_s)?$/.test(stemOf(name));
/** Имя файла штатного двойника для модели автора. */
export const twinNameOf = (name) => `${stemOf(name)}_def${extensionOf(name)}`;
/** Имя модели в игре по имени у автора: без приставки `zc_` и без `_def`. */
export const stockNameOf = (name) =>
  stemOf(name)
    .replace(/^zc_/, "")
    .replace(/_def(?:_s)?$/, "");

/** Ключ света для сравнения: то, что автор мог поменять, и то, что от этого зависит. */
const keyOf = (light) =>
  [
    light.type,
    ...light.colour,
    light.intensity,
    light.falloff,
    light.exponent,
    ...light.cone,
    light.coronaSize,
    light.coronaIntensity,
    light.flashiness,
  ]
    .map((value) =>
      typeof value === "number" ? Math.round(value * 1000) / 1000 : value,
    )
    .join(",");

/** Списки света разные: число, цвет, сила, дальность, конус, корона. Порядок записей не важен. */
export function lightsDiffer(left, right) {
  const a = (left || []).map(keyOf).sort();
  const b = (right || []).map(keyOf).sort();
  return a.length !== b.length || a.some((key, at) => key !== b[at]);
}

/**
 * Выбор столба. `rows` — `[{ fact, coverage, lights, twinLights? }]`: сводка модели, доля листов, свет модели и свет её штатного двойника (если он есть).
 * Порядок: листы в файлах, уличный раньше настенного и промышленного, есть свет, автор свет менял, рисунок лучше заполняет кадр, богаче сеткой, имя. Штатные двойники сами в кадр не идут,
 * пока рядом есть модель автора. Нет подходящих — `null`.
 */
export function pickPole(rows) {
  const names = new Set(rows.map((row) => stemOf(row.fact.name)));
  const ranked = rows
    .map((row) => ({ row, tier: lampTier(row.fact) }))
    .filter(
      ({ row, tier }) =>
        (tier === 0 || tier === 1) &&
        !(
          isStockTwin(row.fact.name) &&
          names.has(stemOf(row.fact.name).replace(/_def(?:_s)?$/, ""))
        ),
    )
    .map(({ row, tier }) => ({
      row,
      tier,
      lit: row.lights?.length > 0,
      changed:
        Boolean(row.twinLights) && lightsDiffer(row.twinLights, row.lights),
      fill: Math.min(
        1.2,
        reachOf(row.fact) / Math.max(heightOf(row.fact), 1e-6),
      ),
    }));
  ranked.sort((x, y) => {
    const good = (item) => (item.row.coverage >= 0.6 ? 0 : 1);
    return (
      good(x) - good(y) ||
      x.tier - y.tier ||
      Number(y.lit) - Number(x.lit) ||
      Number(y.changed) - Number(x.changed) ||
      y.fill - x.fill ||
      y.row.fact.triangles - x.row.fact.triangles ||
      x.row.fact.name.localeCompare(y.row.fact.name)
    );
  });
  return ranked[0]?.row ?? null;
}

/** Свет модели в осях сцены: положение сдвигается так же, как сама модель (`item.at`, низ на нуле), направление не меняется. */
export function sceneLights(lights, item, shift = [0, 0]) {
  return lights.slice(0, LIGHTS_MAX).map((light) => ({
    type: light.type,
    position: [
      light.position[0] + item.at[0] + shift[0],
      light.position[1] + item.at[1] + shift[1],
      light.position[2] - item.ground,
    ],
    direction: light.direction,
    colour: light.colour,
    intensity: light.intensity,
    falloff: light.falloff,
    exponent: light.exponent,
    cone: light.cone,
    coronaSize: light.coronaSize,
    coronaIntensity: light.coronaIntensity,
  }));
}

/** Коробка кадра: пол вокруг (прямоугольник пятна) и столб (по высоте `height`). */
const frameBox = (rect, height) => ({
  min: [rect.min[0], rect.min[1], 0],
  max: [rect.max[0], rect.max[1], height],
});

/** Ракурсы сцены со столбом целиком — кандидаты в обложку: три четверти и спереди. `box` — коробка кадра (пол и столб). */
export function lanternViews(box) {
  const whole = { crop: true, zoom: 0.8, bounds: box };
  return [
    { id: "pole", cover: true, view: { yaw: -0.45, pitch: 0.12, ...whole } },
    { id: "front", cover: true, view: { yaw: 0.05, pitch: 0.1, ...whole } },
  ];
}

/** Ракурс «голова»: крупно плафоны с ореолом; снимается своей сценой — без пятна на полу, чьи углы не дали бы камере подойти. */
export const headView = (heads) => ({
  id: "head",
  cover: false,
  view: { yaw: -0.35, pitch: 0.06, crop: true, zoom: 0.9, bounds: heads },
});

/** Коробка голов ламп: вокруг ламп по горизонтали и от верхней доли высоты до самого верха плюс запас. */
export function headBox(lights, height) {
  if (!lights.length) return null;
  const xs = lights.map((light) => light.position[0]);
  const ys = lights.map((light) => light.position[1]);
  const top = Math.max(
    height,
    ...lights.map((light) => light.position[2] + 0.8),
  );
  return upperPart(
    {
      min: [Math.min(...xs) - HEAD_AROUND, Math.min(...ys) - HEAD_AROUND, 0],
      max: [Math.max(...xs) + HEAD_AROUND, Math.max(...ys) + HEAD_AROUND, top],
    },
    Math.min(1, (top - height * (1 - HEAD_SHARE)) / top),
  );
}

/** Две модели рядом: слева, справа; середина пары — в начале, низ каждой — на нуле. Ответ как у `rowLayout`: `{ items, boxes }`. */
export function pairLayout(facts, height) {
  const gap = height * PAIR_GAP;
  const items = [];
  const boxes = [];
  facts.forEach((fact, index) => {
    const spot = (index - (facts.length - 1) / 2) * gap;
    const at = [
      spot - (fact.max[0] + fact.min[0]) / 2,
      -(fact.max[1] + fact.min[1]) / 2,
    ];
    items.push({ name: fact.name, at, ground: fact.min[2] });
    boxes.push({
      min: [fact.min[0] + at[0], fact.min[1] + at[1], 0],
      max: [
        fact.max[0] + at[0],
        fact.max[1] + at[1],
        fact.max[2] - fact.min[2],
      ],
    });
  });
  return { items, boxes };
}

/**
 * Прямоугольник пола под столбами: охват оснований и ламп с полем `FLOOR_MARGIN`, не уже `FLOOR_WIDTH` высот столба по ширине и `FLOOR_DEPTH` — по глубине. Пятно света шире (дальность лампы
 * 18 м): за краем прямоугольника оно плавно гаснет (`lamp-pool.js`, `TAPER`), а кадр садится по столбу и этому прямоугольнику, поэтому он не больше, чем нужно, чтобы столб был крупным.
 */
export function floorRect(lights, boxes, height) {
  const points = [
    ...boxes.flatMap((box) => [
      [box.min[0], box.min[1]],
      [box.max[0], box.max[1]],
    ]),
    ...lights.map((light) => [light.position[0], light.position[1]]),
  ];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const middle = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  const width = Math.max(
    height * FLOOR_WIDTH,
    Math.max(...xs) - Math.min(...xs) + FLOOR_MARGIN * 2,
  );
  const depth = Math.max(
    height * FLOOR_DEPTH,
    Math.max(...ys) - Math.min(...ys) + FLOOR_MARGIN * 2,
  );
  return {
    min: [middle[0] - width / 2, middle[1] - depth / 2],
    max: [middle[0] + width / 2, middle[1] + depth / 2],
  };
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

/** `ASTRAL_COVER_FRAMES=<папка>` — отладка камеры: каждый снятый кадр ложится в папку (включая те, что ворота не пропустили). */
async function dumpFrames(name, frames) {
  const folder = process.env.ASTRAL_COVER_FRAMES;
  if (!folder) return;
  const fsp = await import("node:fs/promises");
  await fsp.mkdir(folder, { recursive: true });
  const slug = String(name).replace(/[^a-z0-9]+/gi, "_");
  for (const { view, frame } of frames)
    await fsp.writeFile(`${folder}/${slug}-${view.id}.png`, frame);
}

/** План ночи для окна: лампы сцены и пятно света; без ламп — `null` (кадр без ночи). */
async function nightPlan(lights, rect) {
  if (!lights.length) return null;
  const pool = await lampPool(lights, rect);
  return { lights, ...(pool ? { pool } : {}) };
}

/** Запрос окну одной сцены: модели `items` из файлов, ракурсы `views`, ночь `night`. */
async function sceneRequest({ files, items, fill, views, night, name }) {
  const built = await modelsScene({ files, plan: { items }, fill });
  if (!built) return null;
  const head = {
    scene: "mod",
    frame: "models",
    view: views[0].view,
    views: views.map((one) => one.view),
    ...(night ? { night } : {}),
  };
  const request = [
    jsonFile("scene.json", head),
    { name: "scene.bin", bytes: built.bytes },
    ...built.sheets.map(({ key, bytes }) => ({ name: key, bytes })),
  ];
  return { built, request, name };
}

/** Кадры ответа окна по порядку ракурсов; пустые отбрасываются вместе с ракурсом. */
function framesOf(shot, views) {
  const frames = [shot?.png, ...(shot?.gallery || [])];
  return views
    .map((view, at) => ({
      view,
      frame: frames[at]?.length ? frames[at] : null,
    }))
    .filter((one) => one.frame);
}

/** Ворота кадра: для обложки — «высокий предмет», для галереи — общие проверки. */
const gate = (frame, { cover }) =>
  inspectCover(frame, { kind: "lanterns", ...(cover ? { mode: "tall" } : {}) });

async function litLights(files, byName, name) {
  const file = byName.get(String(name).toLowerCase());
  const bytes = file ? await bytesOf(file).catch(() => null) : null;
  return bytes ? readModelLights(bytes, { name }).lights : [];
}

/**
 * Обложка и галерея фонарей: `{ png, gallery, caption, galleryCaption, layout: "tall" }` или `null` (нет окна, нет столбов, сцена не собралась, окно не вернуло кадр).
 * `job`: `files`, `name`, `render`, `fill`, `onGallery`, `onStaged`, `stockLights(имя в игре)` — свет штатной модели игры (необязательно; у модели автора без двойника `…_def`).
 */
export async function lanternNightCover(job) {
  const {
    files = [],
    name = "",
    render,
    fill = null,
    onGallery = null,
    onStaged = null,
    stockLights = null,
  } = job;
  if (typeof render !== "function") return null;
  const rows = await modelRows(files);
  const byName = new Map(
    files.map((file) => [String(file.name).toLowerCase(), file]),
  );
  const poles = rows
    .filter((row) => [0, 1].includes(lampTier(row.fact)))
    .slice(0, POLE_LIMIT);
  for (const row of poles) {
    row.lights = await litLights(files, byName, row.fact.name);
    const twin = rows.find(
      (one) => stemOf(one.fact.name) === stemOf(twinNameOf(row.fact.name)),
    );
    row.twinLights = twin
      ? await litLights(files, byName, twin.fact.name)
      : null;
  }
  const pole = pickPole(poles);
  debugLine(
    name,
    "столб:",
    pole
      ? `${pole.fact.name} (${pole.lights.length} ламп, листов ${Number(pole.coverage.toFixed(2))})`
      : "нет",
  );
  if (!pole) return null;

  const height = heightOf(pole.fact);
  const layout = rowLayout([pole.fact]);
  const [item] = layout.items;
  const lights = sceneLights(pole.lights, item);
  const rect = floorRect(lights, layout.boxes, height);
  const night = await nightPlan(lights, rect);
  const box = frameBox(rect, height);
  const views = lanternViews(box);
  const lead = await sceneRequest({
    files,
    items: layout.items,
    fill,
    views,
    night,
    name,
  });
  if (!lead) {
    debugLine(name, "сцена не собралась");
    return null;
  }
  const shot = await render({
    kind: "redux-part",
    partKind: "scene",
    name,
    files: lead.request,
  });
  const frames = framesOf(shot, views);
  /* Голова с ореолом — своя сцена без пятна (камера садится по плафонам, а не по полу). */
  const heads = headBox(lights, height);
  if (frames.length && heads && night) {
    const close = [headView(heads)];
    const third = await sceneRequest({
      files,
      items: layout.items,
      fill,
      views: close,
      night: { lights },
      name,
    });
    if (third)
      frames.push(
        ...framesOf(
          await render({
            kind: "redux-part",
            partKind: "scene",
            name,
            files: third.request,
          }),
          close,
        ),
      );
  }
  await dumpFrames(name, frames);
  if (!frames.length) {
    debugLine(name, "окно не вернуло кадр");
    return null;
  }
  let cover = -1;
  for (let at = 0; at < frames.length && cover < 0; at += 1)
    if (
      frames[at].view.cover &&
      (await gate(frames[at].frame, { cover: true })).ok
    )
      cover = at;
  const lead0 = cover >= 0 ? cover : 0;
  debugLine(
    name,
    "кадров:",
    frames.length,
    "обложка — ракурс",
    frames[lead0].view.id,
    cover >= 0 ? "(прошла ворота)" : "(ни один не прошёл ворота)",
  );

  /* Галерея: «игра → автор», если автор свет менял, и голова с ореолом. */
  const gallery = [];
  const stock = pole.twinLights?.length
    ? pole.twinLights
    : stockLights
      ? await stockLights(stockNameOf(pole.fact.name)).catch(keepMissing)
      : null;
  const twinRow = pole.twinLights?.length
    ? rows.find(
        (one) => stemOf(one.fact.name) === stemOf(twinNameOf(pole.fact.name)),
      )
    : null;
  if (pole.lights.length && stock?.length && lightsDiffer(stock, pole.lights)) {
    const sides = [twinRow?.fact ?? pole.fact, pole.fact];
    const pair = pairLayout(sides, height);
    const pairLights = [
      ...sceneLights(stock, pair.items[0]),
      ...sceneLights(pole.lights, pair.items[1]),
    ];
    const pairRect = floorRect(pairLights, pair.boxes, height);
    const pairViews = [
      {
        id: "pair",
        cover: false,
        view: {
          yaw: -0.3,
          pitch: 0.1,
          crop: true,
          zoom: 0.85,
          bounds: frameBox(pairRect, height),
        },
      },
    ];
    const second = await sceneRequest({
      files,
      items: pair.items,
      fill,
      views: pairViews,
      night: await nightPlan(pairLights, pairRect),
      name,
    });
    if (second) {
      const answered = framesOf(
        await render({
          kind: "redux-part",
          partKind: "scene",
          name,
          files: second.request,
        }),
        pairViews,
      );
      await dumpFrames(name, answered);
      if (answered[0] && (await gate(answered[0].frame, { cover: false })).ok)
        gallery.push(answered[0]);
    }
  }
  for (const one of frames) {
    if (gallery.length >= GALLERY_MAX) break;
    if (one.view.id === "head" && (await gate(one.frame, { cover: false })).ok)
      gallery.push(one);
  }
  const shown = gallery.slice(0, GALLERY_MAX);
  /* У каждого кадра галереи своя подпись (`saveRenderedGallery`: кадр — `{ bytes, caption }`): пара «игра → автор» и голова с ореолом говорят о разном. */
  const caption = pole.lights.length
    ? LANTERN_CAPTIONS.lit
    : LANTERN_CAPTIONS.unlit;
  const labelled = shown.map((one) => ({
    bytes: one.frame,
    caption: one.view.id === "pair" ? LANTERN_CAPTIONS.pair : caption,
  }));
  if (labelled.length && typeof onGallery === "function")
    await onGallery(labelled);
  onStaged?.("models");
  return {
    png: frames[lead0].frame,
    ...(shown.length ? { gallery: shown.map((one) => one.frame) } : {}),
    caption,
    layout: "tall",
  };
}
