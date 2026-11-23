/*
 * Свои модели в местах мастерской (ТЗ 11.10.2026, вечер, задача 1): «Добавь
 * в редактор возможность добавлять свои модельки. Пользователь загружает
 * свою PNG — она становится 3D-моделью, которую он сам выставляет и двигает
 * по карте: ставит в воздухе, крутит, добавляет анимации. Либо загружает
 * готовую текстуру или модель».
 *
 * У каждого места (завод, ангар, маппинг, арена, Мегамолл, «Ашан / Икея»,
 * Вайнвуд) в работе — список `models`. Модель — картинка человека одной из
 * форм (плашка, объём по контуру картинки, куб, шар, цилиндр) или своя
 * модель из файла (GLB, glTF, OBJ — окно переводит её в сетку и лист, см.
 * `model-import.js` окна). У модели свои место, поворот, размер,
 * непрозрачность, свечение, движение и дальность.
 *
 * Место — в метрах сцены кадра (`scene` — какой: у маппинга свои места, у
 * арены — «снаружи» и «внутри» сервера), как у эмблем: окно и установщик
 * переводят сцену в мир одной таблицей `placeModelScenes`. Поворот — три
 * угла в градусах, порядок «Z·Y·X» (сперва наклон вокруг X, потом Y, потом
 * курс вокруг вертикали), — тот же, что у кадра (`Euler(…, "ZYX")`).
 *
 * Как модель попадает в игру (`recolor-place-models.js` установщика): сетка —
 * эта же функция (`placeModelMesh`), с поворотом и размером «в вершинах»,
 * модель и клип движения — нативным хостом (`compile-star-model`: скелет и
 * клип штатной крутящейся модели игры, как у летающего лого), архетип и
 * сущность — своей картой места (`compile-placements`). Сущность стоит без
 * поворота: вращение и парение клипа — вокруг вертикали мира, какой бы
 * наклон модели ни дали.
 *
 * Чистые функции без Node и DOM: их читают окно (кадр, панель), главный
 * процесс (установка) и тесты.
 */

import { EMBLEM_ASSET } from "./emblems.js";

/* ------------------------------------------------------------------ *
 * Пределы и подписи
 * ------------------------------------------------------------------ */

/** Сколько своих моделей держит одно место. */
export const PLACE_MODEL_LIMIT = 16;
export const PLACE_MODEL_LABEL_LIMIT = 40;
/** Своя модель из файла — сетка в хранилище окна. */
export const PLACE_MODEL_ASSET = /^place-model:[a-f0-9]{64}$/;
/** Вершин у сетки: столько берёт одна геометрия игры у нативного хоста. */
export const PLACE_MODEL_MAX_VERTICES = 60000;
export const PLACE_MODEL_MAX_TRIANGLES = 100000;

/* Формы картинки и своя модель. */
export const PLACE_MODEL_SHAPES = Object.freeze(["plate", "solid", "box", "sphere", "cylinder", "mesh"]);
export const PLACE_MODEL_IMAGE_SHAPES = Object.freeze(["plate", "solid", "box", "sphere", "cylinder"]);
export const PLACE_MODEL_SHAPE_LABELS = Object.freeze({
  plate: "Плашка",
  solid: "Объём",
  box: "Куб",
  sphere: "Шар",
  cylinder: "Цилиндр",
  mesh: "Своя модель",
});
export const PLACE_MODEL_SHAPE_NOTES = Object.freeze({
  plate: "Картинка как лист — видна с двух сторон",
  solid: "Фигура по контуру картинки с толщиной",
  box: "Картинка на всех шести гранях",
  sphere: "Картинка обтягивает шар",
  cylinder: "Картинка вокруг колонны",
  mesh: "Модель из файла со своей текстурой",
});

export const PLACE_MODEL_MOTIONS = Object.freeze(["none", "spin", "float", "spinFloat", "sway"]);
export const PLACE_MODEL_MOTION_LABELS = Object.freeze({
  none: "Стоит",
  spin: "Вращается",
  float: "Парит",
  spinFloat: "Парит и вращается",
  sway: "Покачивается",
});

/* Пределы полей: `[мин, макс]`, шаг — у панели. */
export const PLACE_MODEL_LIMITS = Object.freeze({
  /* Длинная сторона модели, м (у хоста модель — до ±40 м от оси). */
  size: Object.freeze([0.1, 40]),
  /* Толщина «Объёма» — доля длинной стороны, %. */
  depth: Object.freeze([1, 100]),
  opacity: Object.freeze([5, 100]),
  /* Свечение, % (100 % — множитель 8, как у ярких вывесок игры). */
  glow: Object.freeze([0, 100]),
  /* Скорость движения — множитель. */
  speed: Object.freeze([0.1, 4]),
  /* Высота парения, м. */
  lift: Object.freeze([0.1, 10]),
  /* Дальность прорисовки, м. */
  distance: Object.freeze([30, 1500]),
  /* Место от середины сцены, м: дальше — уже другое место карты. */
  position: Object.freeze([-1500, 1500]),
  rotation: Object.freeze([-180, 180]),
});

export const PLACE_MODEL_DEFAULTS = Object.freeze({
  shape: "plate",
  size: 3,
  depth: 12,
  opacity: 100,
  glow: 0,
  motion: "none",
  speed: 1,
  lift: 1,
  distance: 300,
});

/*
 * Живая картинка (ТЗ 11.10.2026, ночь, задача 2: «не только картинку
 * загрузить, а ещё гифку»): кадры GIF (APNG, анимированного WebP) лежат
 * листом-атласом — сетка `columns × rows` (степени двойки), кадры по строкам
 * сверху вниз; `delays` — сколько держится каждый кадр, мс. Сетка модели
 * смотрит в первую клетку, кадры в окне и в игре меняет сдвиг развёртки
 * (`placeModelAnimationClip` — клип 30 кадров/с, как у построек игры).
 */
export const PLACE_MODEL_ANIMATION_LIMITS = Object.freeze({
  frames: Object.freeze([2, 64]),
  /* Кадр GIF короче 20 мс браузеры и игра всё равно не покажут. */
  delay: Object.freeze([20, 10000]),
  /* Круг живой картинки — до 20 с (600 кадров клипа). */
  duration: 20000,
  grid: Object.freeze([1, 2, 4, 8]),
  fps: 30,
});
/* Формы, у которых живая картинка меняется целиком (у «Объёма» контур — по первому кадру). */
export const PLACE_MODEL_ANIMATED_SHAPES = Object.freeze(["plate", "box", "sphere", "cylinder"]);
/* Запас от края клетки атласа: мипы не тянут цвет соседнего кадра. Доля клетки; у маленьких клеток он меньше половины текселя, и двусторонняя фильтрация берёт цвет соседнего кадра (розовая кайма на синем кадре
   живого щита, заход 21.11.2026: клетки 32 × 16 текселей, 0,4 % = 0,13 текселя) — тогда отступ задаётся в текселях (`placeModelCellInset`). */
const CELL_INSET = 0.004;
/* Отступ клетки в текселях (когда размер клетки известен): целый тексель — ближайшие четыре тексела фильтрации остаются в своей клетке. Клетка меньше 4 текселей — прежняя доля; отступ не больше 10 % клетки. */
const CELL_INSET_TEXELS = 1;
const CELL_INSET_MAX = 0.1;

/**
 * Отступ клетки от края (доля клетки) по стороне в `pixels` текселей: не меньше `CELL_INSET` и не меньше `CELL_INSET_TEXELS` текселя (у клетки от 250 текселей прежние 0,4 %). Размер клетки неизвестен — `CELL_INSET`.
 */
export function placeModelCellInset(pixels) {
  if (!Number.isFinite(pixels) || pixels < 4) return CELL_INSET;
  return Math.min(CELL_INSET_MAX, Math.max(CELL_INSET, CELL_INSET_TEXELS / pixels));
}

/**
 * Размер клетки листа кадров в текселях `[ширина, высота]`: лист — `animation.sheet` (как его собрало окно), иначе `picture` (`{ width, height }`) — делится на столбцы и строки раскадровки; `side` — предел стороны листа
 * в игре (лист сжимают до него). Нет раскадровки или размера листа — `null`.
 */
export function placeModelCellPixels(animation, picture = null, side = Infinity) {
  if (!animation) return null;
  const sheet = animation.sheet || (picture?.width > 0 && picture?.height > 0 ? [picture.width, picture.height] : null);
  if (!sheet) return null;
  const limit = side > 0 ? side : Infinity;
  return [Math.min(sheet[0], limit) / animation.columns, Math.min(sheet[1], limit) / animation.rows];
}

/* Множитель свечения игры при 100 %. */
export const PLACE_MODEL_GLOW_MAX = 8;

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const ID = /^m([1-9][0-9]?)$/;

function clamp(value, [low, high], fallback, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const factor = 10 ** digits;
  return Math.round(Math.min(high, Math.max(low, number)) * factor) / factor;
}

/* Строка без служебных знаков, не длиннее `limit`, без пробелов по краям. */
function cleanText(value, limit) {
  return Array.from(String(value ?? ""))
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, limit);
}

const SCENE_ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;

/* Угол в −180…180 (поворот на 190° — то же, что −170°); `digits` — знаков после запятой. */
function wrapDegrees(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const wrapped = ((((number + 180) % 360) + 360) % 360) - 180;
  const factor = 10 ** digits;
  return Math.round(wrapped * factor) / factor + 0;
}

function triple(value, fallback, normalize) {
  const list = Array.isArray(value) ? value : [];
  return [0, 1, 2].map((axis) => normalize(list[axis], fallback[axis]));
}

/* Нормаль поверхности, к которой прилипла модель: единичная, три знака; иначе — пол. */
export const placeModelNormal = (value) => unitNormal(value);
function unitNormal(value) {
  const list = Array.isArray(value) ? value.slice(0, 3).map(Number) : [];
  const length = list.length === 3 && list.every(Number.isFinite) ? Math.hypot(...list) : 0;
  if (length < 1e-6) return [0, 0, 1];
  return list.map((component) => Math.round((component / length) * 1000) / 1000 + 0);
}

/** Живая картинка модели или `null` (см. `PLACE_MODEL_ANIMATION_LIMITS`). */
export function normalizePlaceModelAnimation(input) {
  const source = plain(input);
  const { grid, frames: frameRange, delay, duration } = PLACE_MODEL_ANIMATION_LIMITS;
  const columns = Number(source.columns);
  const rows = Number(source.rows);
  if (!grid.includes(columns) || !grid.includes(rows)) return null;
  const count = Math.round(Number(source.frames));
  if (!Number.isFinite(count) || count < frameRange[0] || count > Math.min(frameRange[1], columns * rows)) return null;
  const list = Array.isArray(source.delays) ? source.delays : [];
  if (list.length < count) return null;
  const delays = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const value = clamp(list[index], delay, 100);
    if (total + value > duration && delays.length >= frameRange[0]) break;
    delays.push(value);
    total += value;
  }
  if (delays.length < frameRange[0]) return null;
  /* Лист кадров, как его собрало окно (`[ширина, высота]`, степени двойки 4…2048): по нему счётчик нагрузки знает вес, а не худший случай. */
  const sheet = Array.isArray(source.sheet) && source.sheet.length === 2 && source.sheet.every((value) => Number.isInteger(value) && value >= 4 && value <= 2048 && (value & (value - 1)) === 0) ? [...source.sheet] : null;
  return { columns, rows, frames: delays.length, delays, ...(sheet ? { sheet } : {}), ...(source.economy === true ? { economy: true } : {}) };
}

/**
 * Одна модель: `null` — без картинки или сетки (такая в работе не держится).
 * Своя модель (`shape: "mesh"`) — ключ сетки (`asset`) и, если есть, лист
 * (`texture` — картинка в хранилище эмблем); модель-картинка — `asset`
 * картинки и её размер.
 */
export function normalizePlaceModel(input) {
  const source = plain(input);
  const mesh = PLACE_MODEL_ASSET.test(String(source.asset || ""));
  const image = EMBLEM_ASSET.test(String(source.asset || ""));
  if (!mesh && !image) return null;
  const animation = image ? normalizePlaceModelAnimation(source.animation) : null;
  let shape = mesh ? "mesh" : PLACE_MODEL_IMAGE_SHAPES.includes(source.shape) ? source.shape : PLACE_MODEL_DEFAULTS.shape;
  /* Живая картинка у «Объёма» — плашкой: контур фигуры — только по первому кадру. */
  if (animation && !PLACE_MODEL_ANIMATED_SHAPES.includes(shape)) shape = "plate";
  const position = triple(source.position, [0, 0, 0], (value, fallback) => clamp(value, PLACE_MODEL_LIMITS.position, fallback, 2));
  /* Сотая градуса: плашка в сантиметре от щита в двадцать метров шириной не должна уходить в него (десятая — 9 мм на 10 м). */
  const rotation = triple(source.rotation, [0, 0, 0], (value) => wrapDegrees(value, 2));
  const motion = PLACE_MODEL_MOTIONS.includes(source.motion) ? source.motion : PLACE_MODEL_DEFAULTS.motion;
  const item = {
    id: ID.test(String(source.id)) ? String(source.id) : "",
    label: cleanText(source.label, PLACE_MODEL_LABEL_LIMIT),
    hidden: source.hidden === true,
    asset: String(source.asset),
    name: cleanText(source.name, 120),
    shape,
    scene: SCENE_ID.test(String(source.scene || "")) ? String(source.scene) : "",
    position,
    rotation,
    /* Поверхность, к которой модель прилипла (кольцо поворота — вокруг неё); в игру не едет. */
    normal: unitNormal(source.normal),
    size: clamp(source.size, PLACE_MODEL_LIMITS.size, PLACE_MODEL_DEFAULTS.size, 2),
    opacity: clamp(source.opacity, PLACE_MODEL_LIMITS.opacity, PLACE_MODEL_DEFAULTS.opacity),
    glow: clamp(source.glow, PLACE_MODEL_LIMITS.glow, PLACE_MODEL_DEFAULTS.glow),
    motion,
    speed: clamp(source.speed, PLACE_MODEL_LIMITS.speed, PLACE_MODEL_DEFAULTS.speed, 2),
    lift: clamp(source.lift, PLACE_MODEL_LIMITS.lift, PLACE_MODEL_DEFAULTS.lift, 2),
    distance: clamp(source.distance, PLACE_MODEL_LIMITS.distance, PLACE_MODEL_DEFAULTS.distance),
  };
  if (shape === "solid") item.depth = clamp(source.depth, PLACE_MODEL_LIMITS.depth, PLACE_MODEL_DEFAULTS.depth);
  if (image) {
    item.width = clamp(source.width, [1, 8192], 1);
    item.height = clamp(source.height, [1, 8192], 1);
    if (animation) item.animation = animation;
  } else {
    item.vertices = clamp(source.vertices, [0, PLACE_MODEL_MAX_VERTICES], 0);
    item.texture = EMBLEM_ASSET.test(String(source.texture || "")) ? String(source.texture) : "";
  }
  return item;
}

/** Свободный `id`: `m1`…`m99`. */
export function nextPlaceModelId(items) {
  const taken = new Set((items || []).map((item) => item?.id));
  for (let index = 1; index < 100; index += 1) if (!taken.has(`m${index}`)) return `m${index}`;
  return "m99";
}

/**
 * Список моделей работы: без пустых, не больше `PLACE_MODEL_LIMIT`, `id`
 * без повторов (повтор и пустой — первым свободным).
 */
export function normalizePlaceModels(input) {
  const list = (Array.isArray(input) ? input : []).slice(0, PLACE_MODEL_LIMIT * 2).map(normalizePlaceModel).filter(Boolean).slice(0, PLACE_MODEL_LIMIT);
  const used = new Set();
  for (const item of list) {
    if (item.id && !used.has(item.id)) used.add(item.id);
    else item.id = "";
  }
  for (const item of list)
    if (!item.id) {
      item.id = nextPlaceModelId([...used].map((id) => ({ id })));
      used.add(item.id);
    }
  return list;
}

/** Модели, что уходят в игру: не скрытые. */
export const shownPlaceModels = (items) => (items || []).filter((item) => item && !item.hidden);

/** Подпись модели в списке: своё имя или имя файла. */
export function placeModelTitle(item) {
  if (item?.label) return item.label;
  const name = String(item?.name || "").replace(/\.[a-z0-9]{2,5}$/i, "");
  return name || (item?.shape === "mesh" ? "Своя модель" : "Своя картинка");
}

/** Отпечаток «Применить»: всё, что меняет модели в игре (скрытые не едут). */
export function placeModelsSignature(items) {
  return shownPlaceModels(items).map((item) => {
    /* Нормаль — подсказка кольцу поворота в кадре, в игру она не едет. */
    const { id, label, hidden, name, normal, ...rest } = item;
    void id;
    void label;
    void hidden;
    void name;
    void normal;
    return rest;
  });
}

/** Есть ли в работе модели, что уйдут в игру. */
export const hasPlaceModels = (items) => shownPlaceModels(items).length > 0;

/** Картинки и сетки работы (ключи хранилища окна) без повторов. */
export function placeModelAssets(items) {
  const images = new Set();
  const meshes = new Set();
  for (const item of shownPlaceModels(items)) {
    if (item.shape === "mesh") {
      meshes.add(item.asset);
      if (item.texture) images.add(item.texture);
    } else images.add(item.asset);
  }
  return { images: [...images], meshes: [...meshes] };
}

/*
 * Код для друга: картинки и сетки живут в окне автора и в код не едут — у
 * друга место встанет без своих моделей, и код об этом скажет.
 */
export const shareablePlaceModels = () => [];
export const placeModelsLostInCode = (items) => ((items || []).length ? "свои модели (остаются на этом компьютере)" : "");

/* ------------------------------------------------------------------ *
 * Сцены мест
 * ------------------------------------------------------------------ */

/**
 * Сцена кадра в мире: `world = scene + origin` (сцены мест сняты в осях
 * мира, сдвинутыми к середине места). `interior` — сцена внутри помещения
 * игры (MLO): модели там встают сущностями самого помещения, иначе игра
 * прячет их, когда человек внутри.
 */
export function placeModelWorld(point, origin) {
  return point.map((value, axis) => Math.round((value + (origin?.[axis] || 0)) * 1000) / 1000);
}

/* ------------------------------------------------------------------ *
 * Сетка
 * ------------------------------------------------------------------ */

/*
 * Сетка формы — в «единичном» размере: длинная сторона — 1 м, середина
 * рамки — в начале координат; развёртка — доли картинки (v сверху вниз, как
 * строки картинки и листы игры). Лицо плашки и объёма — в −Y.
 */

function meshWriter() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const vertex = (p, n, uv) => {
    positions.push(p[0], p[1], p[2]);
    normals.push(n[0], n[1], n[2]);
    uvs.push(uv[0], uv[1]);
    return positions.length / 3 - 1;
  };
  return {
    vertex,
    /* Четырёхугольник a-b-c-d против часовой, если смотреть на лицо. */
    quad(points, normal, uv) {
      const at = points.map((point, index) => vertex(point, normal, uv[index]));
      indices.push(at[0], at[1], at[2], at[0], at[2], at[3]);
    },
    triangle(a, b, c) {
      indices.push(a, b, c);
    },
    done: () => ({
      positions: Float32Array.from(positions),
      normals: Float32Array.from(normals),
      uvs: Float32Array.from(uvs),
      indices: Uint32Array.from(indices),
    }),
  };
}

/* Пропорции картинки: ширина и высота при длинной стороне 1. */
function aspectBox(width, height) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const long = Math.max(w, h);
  return [w / long, h / long];
}

function plateMesh(width, height) {
  const [w, h] = aspectBox(width, height);
  const write = meshWriter();
  const x0 = -w / 2;
  const x1 = w / 2;
  const z0 = -h / 2;
  const z1 = h / 2;
  /* Лицо — в −Y; спина — в +Y, картинка зеркально (как сквозь лист). */
  write.quad(
    [
      [x0, 0, z0],
      [x1, 0, z0],
      [x1, 0, z1],
      [x0, 0, z1],
    ],
    [0, -1, 0],
    [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  );
  write.quad(
    [
      [x1, 0, z0],
      [x0, 0, z0],
      [x0, 0, z1],
      [x1, 0, z1],
    ],
    [0, 1, 0],
    [
      [1, 1],
      [0, 1],
      [0, 0],
      [1, 0],
    ],
  );
  return write.done();
}

function boxMesh() {
  const write = meshWriter();
  const h = 0.5;
  const uv = [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ];
  /* Каждая грань — вся картинка, верх картинки — к +Z (у крышки — к +Y). */
  const faces = [
    { n: [0, -1, 0], p: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]] },
    { n: [1, 0, 0], p: [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]] },
    { n: [0, 1, 0], p: [[h, h, -h], [-h, h, -h], [-h, h, h], [h, h, h]] },
    { n: [-1, 0, 0], p: [[-h, h, -h], [-h, -h, -h], [-h, -h, h], [-h, h, h]] },
    { n: [0, 0, 1], p: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], p: [[-h, h, -h], [h, h, -h], [h, -h, -h], [-h, -h, -h]] },
  ];
  for (const face of faces) write.quad(face.p, face.n, uv);
  return write.done();
}

function sphereMesh(segments = 32, rings = 16) {
  const write = meshWriter();
  const r = 0.5;
  const grid = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const v = ring / rings;
    const polar = v * Math.PI;
    const row = [];
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const azimuth = u * Math.PI * 2;
      /* Шов развёртки — сзади (+Y), середина картинки смотрит в −Y. */
      const n = [Math.sin(polar) * Math.sin(azimuth), -Math.sin(polar) * Math.cos(azimuth), Math.cos(polar)];
      row.push(write.vertex([n[0] * r, n[1] * r, n[2] * r], n, [u, v]));
    }
    grid.push(row);
  }
  for (let ring = 0; ring < rings; ring += 1)
    for (let segment = 0; segment < segments; segment += 1) {
      const a = grid[ring][segment];
      const b = grid[ring + 1][segment];
      const c = grid[ring + 1][segment + 1];
      const d = grid[ring][segment + 1];
      if (ring > 0) write.triangle(a, b, d);
      if (ring < rings - 1) write.triangle(d, b, c);
    }
  return write.done();
}

function cylinderMesh(segments = 32) {
  const write = meshWriter();
  const r = 0.3;
  const h = 0.5;
  const ring = (z, v) => {
    const list = [];
    for (let segment = 0; segment <= segments; segment += 1) {
      const u = segment / segments;
      const angle = u * Math.PI * 2;
      const n = [Math.sin(angle), -Math.cos(angle), 0];
      list.push(write.vertex([n[0] * r, n[1] * r, z], n, [u, v]));
    }
    return list;
  };
  const bottom = ring(-h, 1);
  const top = ring(h, 0);
  for (let segment = 0; segment < segments; segment += 1) {
    write.triangle(bottom[segment], bottom[segment + 1], top[segment + 1]);
    write.triangle(bottom[segment], top[segment + 1], top[segment]);
  }
  /* Крышки — середина картинки (её цвет), без растяжки. */
  for (const [z, up] of [
    [h, 1],
    [-h, -1],
  ]) {
    const centre = write.vertex([0, 0, z], [0, 0, up], [0.5, 0.5]);
    const rim = [];
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      rim.push(write.vertex([Math.sin(angle) * r, -Math.cos(angle) * r, z], [0, 0, up], [0.5 + Math.sin(angle) * 0.02, 0.5 - Math.cos(angle) * 0.02]));
    }
    for (let segment = 0; segment < segments; segment += 1)
      if (up > 0) write.triangle(centre, rim[segment], rim[segment + 1]);
      else write.triangle(centre, rim[segment + 1], rim[segment]);
  }
  return write.done();
}

/* Середину рамки — в начало координат, длинную сторону — к 1. */
function unitise(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < mesh.positions.length; at += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.positions[at + axis]);
      max[axis] = Math.max(max[axis], mesh.positions[at + axis]);
    }
  const long = Math.max(1e-6, max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const centre = min.map((value, axis) => (value + max[axis]) / 2);
  const positions = new Float32Array(mesh.positions.length);
  for (let at = 0; at < positions.length; at += 3)
    for (let axis = 0; axis < 3; axis += 1) positions[at + axis] = (mesh.positions[at + axis] - centre[axis]) / long;
  return { ...mesh, positions };
}

/**
 * Сетка модели в единичном размере: `{ positions, normals, uvs, indices }`
 * (длинная сторона — 1 м, середина — в нуле). `source` — у картинки
 * `{ solid }` (готовая сетка объёма, `placeModelSolid`), у своей модели —
 * сама сетка из хранилища (`{ positions, normals, uvs, indices }`, уже
 * единичная). `null` — сетки нет (пустая картинка у «Объёма»). `source.cell` — размер клетки листа живой картинки в текселях (`placeModelCellPixels`): отступ развёртки от края клетки считается в текселях.
 */
export function placeModelUnitMesh(item, source = {}) {
  if (!item) return null;
  if (item.shape === "mesh") return source.mesh || null;
  if (item.shape === "solid") return source.solid || null;
  let unit;
  if (item.shape === "box") unit = boxMesh();
  else if (item.shape === "sphere") unit = sphereMesh();
  else if (item.shape === "cylinder") unit = cylinderMesh();
  else unit = plateMesh(item.width, item.height);
  return item.animation ? intoFirstCell(unit, item.animation, source.cell || placeModelCellPixels(item.animation)) : unit;
}

/* Живая картинка: развёртка — в первую клетку атласа (с запасом от края); кадры меняет сдвиг. `cell` — размер клетки в текселях, если известен (отступ от края в текселях, а не долей). */
export const placeModelIntoFirstCell = (unit, animation, cell = null) => intoFirstCell(unit, animation, cell);
function intoFirstCell(unit, animation, cell = null) {
  const uvs = new Float32Array(unit.uvs.length);
  const insetU = placeModelCellInset(cell?.[0]);
  const insetV = placeModelCellInset(cell?.[1]);
  for (let at = 0; at < uvs.length; at += 2) {
    uvs[at] = (insetU + unit.uvs[at] * (1 - insetU * 2)) / animation.columns;
    uvs[at + 1] = (insetV + unit.uvs[at + 1] * (1 - insetV * 2)) / animation.rows;
  }
  return { ...unit, uvs };
}

/* ------------------------------------------------------------------ *
 * Живая картинка
 * ------------------------------------------------------------------ */

/** Сдвиг развёртки к кадру `frame` (доли листа): `[du, dv]`. */
export function placeModelAnimationShift(animation, frame) {
  const index = ((Math.round(frame) % animation.frames) + animation.frames) % animation.frames;
  return [(index % animation.columns) / animation.columns, Math.floor(index / animation.columns) / animation.rows];
}

/** Круг живой картинки, с. */
export const placeModelAnimationDuration = (animation) => animation.delays.reduce((sum, value) => sum + value, 0) / 1000;

/** Какой кадр виден через `seconds` от начала (по кругу). */
export function placeModelAnimationFrameAt(animation, seconds) {
  const total = animation.delays.reduce((sum, value) => sum + value, 0);
  let left = ((((seconds * 1000) % total) + total) % total) + 1e-6;
  for (let index = 0; index < animation.frames; index += 1) {
    left -= animation.delays[index];
    if (left <= 0) return index;
  }
  return animation.frames - 1;
}

/**
 * Клип развёртки для игры: `{ fps, duration, shifts: [[du, dv], …] }` — сдвиг
 * на каждый кадр клипа (30 кадров/с, как у клипов построек игры); кадр
 * картинки держится столько, сколько у неё задержка (округление — до кадра
 * клипа), последний кадр клипа — снова первый (клип по кругу без стыка).
 */
export function placeModelAnimationClip(animation) {
  const { fps } = PLACE_MODEL_ANIMATION_LIMITS;
  const ticks = Math.max(2, Math.round(placeModelAnimationDuration(animation) * fps));
  const shifts = [];
  for (let tick = 0; tick < ticks; tick += 1) shifts.push(placeModelAnimationShift(animation, placeModelAnimationFrameAt(animation, tick / fps)));
  shifts.push(placeModelAnimationShift(animation, 0));
  return { fps, duration: Math.round((ticks / fps) * 10000) / 10000, shifts };
}

/* ------------------------------------------------------------------ *
 * Поверхность и поворот
 * ------------------------------------------------------------------ */

/*
 * Модель прилипает к поверхности (ТЗ 11.10.2026, ночь, задача 1: «чтобы
 * коннектилось с другими 3D-штучками … легче крутить»): своей «опорной»
 * стороной к ней и кольцом поворота вокруг её нормали.
 *   пол (нормаль вверх)    — стоит низом, верх — по нормали (на скате — с наклоном);
 *   потолок (нормаль вниз) — висит верхом, как люстра или вывеска;
 *   стена                  — спиной к стене: лицо (−Y) — по нормали, верх — к небу.
 * `spin` — поворот вокруг нормали от этого положения, градусы.
 */
export function placeModelSurfaceKind(normal) {
  const z = unitNormal(normal)[2];
  return z >= 0.7 ? "floor" : z <= -0.7 ? "ceiling" : "wall";
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => {
  const length = Math.hypot(...v) || 1;
  return v.map((value) => value / length);
};
const times = (m, v) => [0, 1, 2].map((row) => m[row][0] * v[0] + m[row][1] * v[1] + m[row][2] * v[2]);
const product = (a, b) => [0, 1, 2].map((row) => [0, 1, 2].map((col) => a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col]));
/* Матрица по столбцам-осям. */
const columns = (x, y, z) => [0, 1, 2].map((row) => [x[row], y[row], z[row]]);

/** Поворот вокруг оси `axis` на `degrees` (Родриг). */
export function placeModelAxisTurn(axis, degrees) {
  const [x, y, z] = unit(axis);
  const angle = (degrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = 1 - c;
  return [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ];
}

/* Наименьший поворот, что ведёт ось `from` в `to`. */
function alignTurn(from, to) {
  const a = unit(from);
  const b = unit(to);
  const c = dot(a, b);
  if (c > 1 - 1e-9) return placeModelAxisTurn([0, 0, 1], 0);
  if (c < -1 + 1e-9) return placeModelAxisTurn(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]), 180);
  return placeModelAxisTurn(cross(a, b), (Math.acos(c) * 180) / Math.PI);
}

/** Углы «Z·Y·X» (градусы) из матрицы поворота; `digits` — знаков после запятой (по умолчанию десятая). */
export function placeModelEuler(m, digits = 1) {
  const sy = Math.max(-1, Math.min(1, -m[2][0]));
  const y = Math.asin(sy);
  let x;
  let z;
  if (Math.abs(sy) < 0.99999) {
    x = Math.atan2(m[2][1], m[2][2]);
    z = Math.atan2(m[1][0], m[0][0]);
  } else {
    x = 0;
    z = Math.atan2(-m[0][1], m[1][1]);
  }
  return [x, y, z].map((value) => wrapDegrees((value * 180) / Math.PI, digits));
}

/* Нормаль как есть, без округления до тысячных: поверхность известна точно (щит карты). */
function exactNormal(value) {
  const list = Array.isArray(value) ? value.slice(0, 3).map(Number) : [];
  const length = list.length === 3 && list.every(Number.isFinite) ? Math.hypot(...list) : 0;
  return length < 1e-6 ? [0, 0, 1] : list.map((component) => component / length);
}

/* Положение «без поворота» на поверхности и ось отсчёта поворота вокруг нормали. */
function surfaceFrame(normal, exact = false) {
  const n = exact ? exactNormal(normal) : unitNormal(normal);
  const kind = placeModelSurfaceKind(n);
  if (kind === "floor") return { kind, n, base: alignTurn([0, 0, 1], n), reference: [0, -1, 0] };
  if (kind === "ceiling") return { kind, n, base: alignTurn([0, 0, 1], n.map((value) => -value)), reference: [0, -1, 0] };
  const up = unit([-n[2] * n[0], -n[2] * n[1], 1 - n[2] * n[2]]);
  const face = n.map((value) => -value);
  return { kind, n, base: columns(cross(face, up), face, up), reference: [0, 0, 1] };
}

/**
 * Поворот модели («Z·Y·X», градусы), прилипшей к поверхности с нормалью
 * `normal`, и `spin` вокруг неё. `exact` — поверхность известна точно (щит
 * карты): нормаль без округления до тысячных, углы — до сотых.
 */
export function placeModelSurfaceRotation(normal, spin = 0, { exact = false } = {}) {
  const frame = surfaceFrame(normal, exact);
  return placeModelEuler(product(placeModelAxisTurn(frame.n, spin), frame.base), exact ? 2 : 1);
}

/** Поворот вокруг нормали (градусы) у модели с поворотом `rotation` на поверхности `normal`. */
export function placeModelSpin(rotation, normal) {
  const frame = surfaceFrame(normal);
  const from = times(frame.base, frame.reference);
  const raw = times(placeModelMatrix(rotation), frame.reference);
  const along = dot(raw, frame.n);
  const to = raw.map((value, axis) => value - along * frame.n[axis]);
  if (Math.hypot(...to) < 1e-6) return 0;
  return wrapDegrees((Math.atan2(dot(cross(from, to), frame.n), dot(from, to)) * 180) / Math.PI);
}

/** Поворот, при котором лицо модели на поверхности смотрит на точку `eye` (пол, потолок) или ровно (стена). */
export function placeModelFacing(normal, from, eye) {
  const frame = surfaceFrame(normal);
  if (frame.kind === "wall" || !eye) return 0;
  const face = times(frame.base, frame.reference);
  const look = [0, 1, 2].map((axis) => eye[axis] - from[axis]);
  const along = dot(look, frame.n);
  const target = look.map((value, axis) => value - along * frame.n[axis]);
  if (Math.hypot(...target) < 1e-6) return 0;
  return wrapDegrees((Math.atan2(dot(cross(face, target), frame.n), dot(face, target)) * 180) / Math.PI);
}

/** Поворот `rotation` ещё на `degrees` вокруг оси `axis` (мира). */
export function placeModelTurnAround(rotation, axis, degrees) {
  return placeModelEuler(product(placeModelAxisTurn(axis, degrees), placeModelMatrix(rotation)));
}

/**
 * Насколько середина модели отстоит от поверхности по её нормали, чтобы
 * модель встала на неё, а не в неё: самая дальняя «вниз» точка сетки.
 * `unit` — единичная сетка, `item` — поворот и размер.
 */
export function placeModelLift(item, unit, normal) {
  const n = unitNormal(normal);
  if (!unit?.positions?.length) return (item?.size || 0) / 2;
  const m = placeModelMatrix(item.rotation);
  const down = [-n[0], -n[1], -n[2]];
  /* Ось «вниз» в осях сетки: max(R·s·v · d) = s · max(v · Rᵀd). */
  const local = [0, 1, 2].map((col) => m[0][col] * down[0] + m[1][col] * down[1] + m[2][col] * down[2]);
  let reach = -Infinity;
  for (let at = 0; at < unit.positions.length; at += 3) reach = Math.max(reach, unit.positions[at] * local[0] + unit.positions[at + 1] * local[1] + unit.positions[at + 2] * local[2]);
  return Math.max(0, reach * item.size);
}

/* ------------------------------------------------------------------ *
 * Сцены «внутри» без своих помещений
 * ------------------------------------------------------------------ */

/*
 * Залы Majestic (ТЗ 11.10.2026, ночь, задача 3). Типов помещений сервера
 * (`mazearena_int_<n>.ytyp`) на машине нет и не будет — отдельной сущностью
 * модель в зал не поставить (игра прячет вне помещения то, что не его). Поэтому
 * свои модели вшиваются геометрией в модель самого зала — оболочку главного
 * зала третьего интерьера. Её место в сцене «внутри» выведено из сцены и
 * модели (`scripts/derive-majestic-hall-anchor.mjs`: 1099 пар вершин по
 * развёртке, ошибка ≤ 1 мм); `bounds` — рамка модели в её осях: за ней
 * модель зала игра может не рисовать (рамку архетипа сервера не поменять).
 * У архетипа зала нет словаря клипов — движения и живой картинки там нет;
 * дальность — как у зала.
 */
export const PLACE_MODEL_HALLS = Object.freeze({
  "majestic-inside": Object.freeze({
    file: "mj_ma_int3_shell.ydr",
    resource: "majestic/mj_ma_int3_shell.ydr",
    position: Object.freeze([5.545, 6.665, 7.038]),
    /* Поворот только вокруг вертикали (≈ 50,2°): помещение сервера стоит ровно. */
    rotation: Object.freeze([0, 0, 0.423929, 0.905696]),
    bounds: Object.freeze({ min: Object.freeze([-25.42, -43.38, -7.24]), max: Object.freeze([27.09, 43.67, 11.21]) }),
  }),
});

/* Точка поворотом кватерниона `[x, y, z, w]` (`conjugate` — обратным). */
export function placeModelQuaternionTurn([x, y, z, w], point, conjugate = false) {
  const [qx, qy, qz] = conjugate ? [-x, -y, -z] : [x, y, z];
  const [px, py, pz] = point;
  const tx = 2 * (qy * pz - qz * py);
  const ty = 2 * (qz * px - qx * pz);
  const tz = 2 * (qx * py - qy * px);
  return [px + w * tx + (qy * tz - qz * ty), py + w * ty + (qz * tx - qx * tz), pz + w * tz + (qx * ty - qy * tx)];
}

/** Точка сцены → оси модели зала. */
export function placeModelHallLocal(hall, point) {
  return placeModelQuaternionTurn(
    hall.rotation,
    point.map((value, axis) => value - hall.position[axis]),
    true,
  );
}

/**
 * Модель (её середина и размер) — в рамке модели зала. Плашка тонкая —
 * проверяются углы её прямоугольника, а не шар её размера: баннер команды
 * 8 × 0,7 м у пола не «вылезает» вниз на 4 м (ТЗ 12.10.2026, задача 4).
 */
export function placeModelInHall(hall, item) {
  if (!hall || !item) return false;
  const inside = (point, reach = 0) =>
    placeModelHallLocal(hall, point).every((value, axis) => value - reach >= hall.bounds.min[axis] - 0.05 && value + reach <= hall.bounds.max[axis] + 0.05);
  if (item.shape === "plate" && item.width > 0 && item.height > 0) {
    const long = Math.max(item.width, item.height);
    const half = [((item.width / long) * (item.size || 0)) / 2, ((item.height / long) * (item.size || 0)) / 2];
    const m = placeModelMatrix(item.rotation || [0, 0, 0]);
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].every(([a, b]) => inside([0, 1, 2].map((row) => item.position[row] + m[row][0] * a * half[0] + m[row][2] * b * half[1])));
  }
  return inside(item.position, (item.size || 0) / 2);
}

/**
 * Что можно моделям сцены: `{ hall, motion, animation, distance, note }`.
 * `hall` — модель зала, в которую модели вшиваются (`null` — обычная сцена).
 */
export function placeModelSceneRules(scene) {
  const hall = PLACE_MODEL_HALLS[scene] || null;
  if (!hall)
    return { hall: null, motion: true, animation: true, distance: true, note: "" };
  return {
    hall,
    motion: false,
    animation: false,
    distance: false,
    /* Опыт на клиенте Majestic 20.11.2026: пересобранную модель зала он отвергает («Invalid asset», вылет) — вшивать модели в зал нельзя. */
    note: "Залы Majestic — помещения сервера. В альфе модель внутри зала встаёт дописанной сущностью этого зала; вшивать её в модель зала нельзя (Majestic отвергает пересобранные модели, «Invalid asset», вылет). Модель вне комнат залов и модели в бете и релизе пока в зал не едут.",
  };
}

/** Почему модель не поедет в игру в своей сцене (`""` — поедет). */
export function placeModelSceneProblem(item) {
  const rules = placeModelSceneRules(item?.scene || "");
  if (rules.hall && !placeModelInHall(rules.hall, item)) return "За стенами главного зала Majestic — в игру не поедет: передвиньте её в зал.";
  if (rules.hall) return "В зал Majestic своя модель ставится только в альфе (в бете и релизе пока не поедет) и только внутри комнат залов.";
  return "";
}

/**
 * «Объём» по контуру картинки: `arenaStar(rgba, width, height, options)` —
 * сборщик фигуры звезды арены (`arenaStarModel`), его передаёт вызывающий:
 * так договор моделей не тянет за собой весь модуль звезды. Толщина — доля
 * длинной стороны (`depth`, %). `null` — в картинке нет фигуры.
 */
export function placeModelSolid(arenaStar, rgba, width, height, depth = PLACE_MODEL_DEFAULTS.depth) {
  const share = clamp(depth, PLACE_MODEL_LIMITS.depth, PLACE_MODEL_DEFAULTS.depth);
  /* Сборщик звезды меряет толщину от высоты фигуры (`size`), а «Толщина» —
     доля длинной стороны: у широкой картинки толщина больше во столько же. */
  let built = arenaStar(rgba, width, height, { size: 1, depth: share, stand: "none" });
  if (!built) return null;
  const wide = built.mask.cols / Math.max(1, built.mask.rows);
  if (wide > 1) built = arenaStar(rgba, width, height, { size: 1, depth: share * wide, stand: "none" }) || built;
  const { positions, normals, uvs, indices } = built.mesh;
  return unitise({
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  });
}

/** Своя сетка из файла → единичная (для хранилища окна). */
export const unitPlaceModelMesh = (mesh) => unitise(mesh);

/**
 * Поворот модели матрицей 3 × 3 (строки): `R = Rz · Ry · Rx`, углы в
 * градусах — как `Euler(x, y, z, "ZYX")` у three.js.
 */
export function placeModelMatrix([x, y, z]) {
  const rad = Math.PI / 180;
  const [cx, sx] = [Math.cos(x * rad), Math.sin(x * rad)];
  const [cy, sy] = [Math.cos(y * rad), Math.sin(y * rad)];
  const [cz, sz] = [Math.cos(z * rad), Math.sin(z * rad)];
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

/**
 * Сетка в облике модели: размер и поворот — в вершинах (так её получает
 * игра), середина — в нуле. `{ positions, normals, uvs, indices, bounds }`.
 */
export function placeModelMesh(item, unit) {
  if (!item || !unit) return null;
  const m = placeModelMatrix(item.rotation);
  const s = item.size;
  const count = unit.positions.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < count; index += 1) {
    const p = [unit.positions[index * 3] * s, unit.positions[index * 3 + 1] * s, unit.positions[index * 3 + 2] * s];
    const n = [unit.normals[index * 3], unit.normals[index * 3 + 1], unit.normals[index * 3 + 2]];
    for (let row = 0; row < 3; row += 1) {
      const value = m[row][0] * p[0] + m[row][1] * p[1] + m[row][2] * p[2];
      positions[index * 3 + row] = value;
      normals[index * 3 + row] = m[row][0] * n[0] + m[row][1] * n[1] + m[row][2] * n[2];
      min[row] = Math.min(min[row], value);
      max[row] = Math.max(max[row], value);
    }
  }
  return { positions, normals, uvs: unit.uvs, indices: unit.indices, bounds: { min, max } };
}

/** Высота нижней точки модели над её серединой (отрицательная), м. */
export function placeModelFloorOffset(item, unit) {
  const mesh = placeModelMesh(item, unit);
  return mesh ? mesh.bounds.min[2] : -(item?.size || 0) / 2;
}

/* ------------------------------------------------------------------ *
 * Движение
 * ------------------------------------------------------------------ */

/* Секунд на цикл при скорости 1. */
const PERIOD = Object.freeze({ spin: 8, float: 4, spinFloat: 8, sway: 4 });
const FPS = 30;
const MAX_FRAMES = 480;
/* Покачивание — поворот туда-обратно вокруг вертикали на ±20°. */
const SWAY = (20 / 180) * Math.PI;

/**
 * Движение модели: `{ kind, period, frames, at(t) → { lift, angle } }` —
 * `lift` — подъём над местом, м, `angle` — поворот вокруг вертикали, рад.
 * У «Стоит» — `period: 0`.
 */
export function placeModelMotion(item) {
  const kind = PLACE_MODEL_MOTIONS.includes(item?.motion) ? item.motion : "none";
  if (kind === "none") return { kind, period: 0, frames: 0, at: () => ({ lift: 0, angle: 0 }) };
  const speed = clamp(item.speed, PLACE_MODEL_LIMITS.speed, 1, 2);
  const rise = clamp(item.lift, PLACE_MODEL_LIMITS.lift, 1, 2);
  const period = PERIOD[kind] / speed;
  const frames = Math.min(MAX_FRAMES, Math.max(2, Math.round(period * FPS))) + 1;
  const at = (time) => {
    const share = (((time / period) % 1) + 1) % 1;
    const bob = rise * 0.5 * (1 - Math.cos(share * Math.PI * 2));
    if (kind === "spin") return { lift: 0, angle: share * Math.PI * 2 };
    if (kind === "float") return { lift: bob, angle: 0 };
    /* Парит и вращается: два подъёма за оборот — плавнее, чем один. */
    if (kind === "spinFloat") return { lift: rise * 0.5 * (1 - Math.cos(share * Math.PI * 4)), angle: share * Math.PI * 2 };
    return { lift: 0, angle: SWAY * Math.sin(share * Math.PI * 2) };
  };
  return { kind, period, frames, at };
}

/** Кадры клипа на цикл (последний — снова начало: клип по кругу без стыка). */
export function placeModelFrames(item) {
  const motion = placeModelMotion(item);
  if (!motion.period) return null;
  const lift = [];
  const angle = [];
  for (let frame = 0; frame < motion.frames; frame += 1) {
    const sample = motion.at((frame / (motion.frames - 1)) * motion.period);
    lift.push(Math.round(sample.lift * 10000) / 10000);
    angle.push(Math.round(sample.angle * 100000) / 100000);
  }
  if (motion.kind === "spin" || motion.kind === "spinFloat") angle[angle.length - 1] = Math.round(Math.PI * 2 * 100000) / 100000;
  else angle[angle.length - 1] = angle[0];
  lift[lift.length - 1] = lift[0];
  return { duration: Math.round(motion.period * 10000) / 10000, lift, angle };
}

/** Множитель свечения игры. */
export const placeModelEmissive = (item) => Math.round(((item?.glow || 0) / 100) * PLACE_MODEL_GLOW_MAX * 100) / 100;

/* ------------------------------------------------------------------ *
 * Договоры мест
 * ------------------------------------------------------------------ */

/**
 * Поле отпечатка «Применить»: без моделей — пусто, и отпечатки прежних
 * работ (и поставленных установок) не меняются.
 */
export const placeModelsSignatureField = (items) => (hasPlaceModels(items) ? { models: placeModelsSignature(items) } : {});

/** «Что не поедет в коде для друга» — части через запятую. */
export const joinLostInCode = (...parts) => parts.filter(Boolean).join(", ");
