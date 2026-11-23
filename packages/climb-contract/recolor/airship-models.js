/*
 * Свои модели неба «Дирижаблей»: дракон, феникс, воздушный шар, небесный
 * фонарик, НЛО, кит, медуза и самолёт с баннером (ТЗ 11.10.2026: «сделай
 * готовые модельки дракона, воздушных шаров и т. д.»; вечер, задача 3:
 * «проделай там хорошие модельки, чтобы у них двигались крылья, чтобы
 * воздушные шары тоже там огонь, ну, издалека был виден … ещё какие-то
 * можешь добавить виды»). Их рисует Astral — моделей Rockstar в поставке
 * нет; дирижабль — модель игры игрока (её собирает установщик из `blimp.yft`).
 *
 * Модели «как настоящие» (ТЗ 11.10.2026, ночь, задача 3: «реалистичные
 * модели для вкладки дирижабля (драконы, фениксы и т. д.)»): дракон,
 * феникс, кит и медуза собраны по анатомии (`airship-creatures.js`), шар —
 * клиньями ткани с лентами, НЛО — металлом с иллюминаторами. Сетка —
 * плавные протяжки по кривым со своим сечением, лоскуты перепонок, перья,
 * плавники (`airship-mesh.js`), ~2–26 тыс. вершин на вид.
 *
 * Лист модели — 1024 × 1024 (`airship-paint.js`): куски с нарисованным
 * кодом рисунком (чешуя, щитки брюха, перепонка с жилками, перья, кожа
 * кита со складками горла, купол медузы с каналами, ткань, плетёнка,
 * металл) и клетки плоского цвета 32 × 32 для мелочей. Куски — степени
 * двойки, выровнены по своему размеру, развёртка отступает от их края:
 * уровни мипов не смешивают соседей, пока кусок не сожмётся в точку. Лист
 * зависит только от вида и его цветов и рисуется один раз на облик. Свет —
 * у игры: нормали гладкие у тел и у двусторонних листов.
 *
 * Части модели — по шейдеру: `body` (`default`, освещённая) и светящиеся
 * (`emissive`) со своим множителем: `glow` — глаза, пятна, бумага, купол;
 * `flame` — огонь и яркие огни (горелка шара видна издалека); `dim` —
 * притушенные огни НЛО (между ними бегут яркие). Обход треугольников —
 * против часовой, если смотреть на лицевую сторону (как у плашек эмблем и
 * украшений фонарей, проверенных в игре); перепонки — двусторонние.
 *
 * Движение частей (ТЗ того же вечера: «чтобы у них двигались крылья»). У
 * летающего в игре два подвижных места скелета шаблона: барабан везёт всю
 * модель по кругу полёта, вторая кость («Innards») — то же, что барабан, и
 * поверх ещё своё «местное» движение в осях модели: v → q·v + f. Вершина с
 * долей `flex` w идёт в (1 − w)·v + w·(q·v + f): корни крыльев стоят,
 * концы ходят (у вершины — веса двух костей, `compile-sky-flyer`). Так
 * машут крылья дракона и феникса, ходит хвост кита, мерцает огонь шара и
 * фонарика, бегут огни НЛО (кольцо огней вертится), колышутся щупальца
 * медузы и полощется полотнище самолёта. Доля — от места вершины (одна
 * точка — одна доля во всех частях: сетка не рвётся). Кадр окна двигает
 * вершины той же формулой (`airshipMotionPose`), установщик шлёт хосту
 * «местное» движение кадрами клипа (`airshipMotionFrames`).
 *
 * Лого и своя текстура (ТЗ 11.10.2026, вечер): у модели с ними главное
 * тело — часть `skin` со вторым листом (`AIRSHIP_SKINS`) и настоящей
 * развёрткой: у шара и медузы — оболочка по кругу и по высоте, у дракона,
 * феникса и кита — спина и бока вдоль хребта и по обхвату, у дракона и
 * феникса ещё крылья (по листу на каждую сторону каждого крыла), у НЛО —
 * корпус сверху и снизу в плане, у фонарика — четыре стороны бумаги, у
 * самолёта — обе стороны полотнища. Лист рисует `paintAirshipSkin`: тот
 * же рисунок кожи, что у листа модели (спина в чешуе, перепонка с жилками),
 * сверху своя текстура, сверху лого на своих местах — одна функция для
 * кадра окна и для установщика.
 *
 * Оси — как у игры: метры, Z вверх, нос — +Y, правый борт — +X; начало —
 * середина модели (вокруг него она поворачивается в полёте).
 *
 * Чистые функции без Node и DOM: их читают окно (кадр), главный процесс
 * (установка) и тесты.
 */

import { hexBytes } from "./colour.js";
import { airshipDecalReady, airshipDecorated, airshipKind, airshipSkinReady, normalizeAirshipsProject, quatRotate } from "./airships.js";
import { add, boxFaces, createMesh, curve, ellipsoid, flexAll, lathe, length, lerp, membrane, scale, smooth, sub, surface, sweep, tube } from "./airship-mesh.js";
import { ATLAS_SIZE, createAtlas, fabric, metalHull, paper, rgb, wicker } from "./airship-paint.js";
import {
  DRAGON_LENGTH,
  DRAGON_WING,
  EASTERN_BACK,
  EASTERN_FLANK_U,
  EASTERN_LENGTH,
  GRIFFIN_LENGTH,
  GRIFFIN_WING,
  JELLY_LIFT,
  PHOENIX_LENGTH,
  PHOENIX_WING,
  WHALE_BACK,
  WHALE_FLANK_U,
  WHALE_LENGTH,
  buildDragon,
  buildEasternDragon,
  buildGriffin,
  buildJellyfish,
  buildPhoenix,
  buildWhale,
  dragonMaterials,
  easternMaterials,
  griffinMaterials,
  jellyMaterials,
  phoenixMaterials,
  whaleMaterials,
} from "./airship-creatures.js";

/* Лист модели: 1024 × 1024 — куски с рисунком и клетки плоского цвета 32 × 32 (`airship-paint.js`). */
export const AIRSHIP_ATLAS = Object.freeze({ size: ATLAS_SIZE, cell: 32 });
/* Лист в кадре окна: тот же рисунок вдвое меньше — в кадре его хватает, а перерисовка при смене цвета вчетверо быстрее. */
export const AIRSHIP_PREVIEW_ATLAS = ATLAS_SIZE / 2;

/* ------------------------------------------------------------------ *
 * Лист картинки: лого и своя текстура
 * ------------------------------------------------------------------ */

/* Размер листа по видам: степень двойки (DXT с полной цепочкой мипов). */
export const AIRSHIP_SKINS = Object.freeze({
  dragon: Object.freeze({ width: 1024, height: 1024 }),
  phoenix: Object.freeze({ width: 1024, height: 1024 }),
  balloon: Object.freeze({ width: 1024, height: 512 }),
  lantern: Object.freeze({ width: 512, height: 512 }),
  ufo: Object.freeze({ width: 512, height: 512 }),
  whale: Object.freeze({ width: 1024, height: 512 }),
  jellyfish: Object.freeze({ width: 1024, height: 512 }),
  banner: Object.freeze({ width: 1024, height: 512 }),
  eastern_dragon: Object.freeze({ width: 1024, height: 512 }),
  griffin: Object.freeze({ width: 1024, height: 1024 }),
});
/* Отступ развёртки от края куска листа, px: мипы не тянут цвет соседнего куска. */
const SKIN_INSET = 4;

/* Тела моделей — общие у сетки и у разметки листа. */

/* Оболочка шара: профиль снизу вверх `[r, z]`, 18 клиньев по 2 сегмента. */
const BALLOON_PROFILE = Object.freeze(
  [
    [1.5, 6.0],
    [2.6, 6.9],
    [4.4, 8.4],
    [6.0, 10.2],
    [7.1, 12.2],
    [7.7, 14.2],
    [7.85, 15.8],
    [7.6, 17.4],
    [6.9, 18.9],
    [5.6, 20.2],
    [3.8, 21.2],
    [1.8, 21.8],
    [0.0, 22.0],
  ].map(([r, z]) => Object.freeze([r, z - 11])),
);
const BALLOON_SEGMENTS = 36;
/* Шов развёртки оболочки — сегмент на +Y (90°): лого на боках ±X, вдали от шва. */
const BALLOON_SEAM = 9;
/* Горелка: низ пламени и его верх (у самого входа в оболочку). */
const BALLOON_FLAME = Object.freeze({ base: -8.6, tip: -4.4 });

/* Корпус НЛО: снизу вверх; отрезок 4 — кромка (своим тёмным цветом — клеткой листа). */
const UFO_HULL = Object.freeze([
  [0, -1.4],
  [3.0, -1.35],
  [7.5, -0.9],
  [11.0, -0.25],
  [12.4, 0.15],
  [12.4, 0.35],
  [11.0, 0.7],
  [7.5, 1.2],
  [4.4, 1.55],
]);
const UFO_RIM_BAND = 4;
/* Половина стороны квадрата развёртки корпуса в плане, м. */
const UFO_REACH = 12.6;

/* Фонарик: низ, верх (половины сторон), высота. */
const LANTERN = Object.freeze({ bottom: 0.7, top: 1.1, z0: -1.5, z1: 1.5 });

/* Самолёт с баннером: полотнище от шеста (`front`) до хвоста (`back`), высота от `bottom` до `top`. */
const BANNER = Object.freeze({ front: 6.0, back: -20.5, top: 2.5, bottom: -2.5, columns: 26, rows: 4 });
const BANNER_NODES = Object.freeze([
  [13.0, 0.35, 0.08, 0.1],
  [14.0, 0.3, 0.22, 0.28],
  [15.5, 0.15, 0.38, 0.45],
  [17.0, 0.0, 0.5, 0.6],
  [18.6, 0.0, 0.55, 0.62],
  [19.6, 0.0, 0.52, 0.55],
  [20.2, 0.0, 0.44, 0.46],
  [20.5, 0.0, 0.38, 0.38],
]);

/* Длина хребта от хвоста: накопленная по узлам `[y, z]`. */
function spineLengths(nodes) {
  const out = [0];
  for (let index = 1; index < nodes.length; index += 1)
    out.push(out[index - 1] + Math.hypot(nodes[index][0] - nodes[index - 1][0], nodes[index][1] - nodes[index - 1][1]));
  return out;
}

/* Высота оболочки по дуге профиля: доля 0 (макушка) … 1 (низ). */
const arcFromTop = (profile) => {
  const lengths = spineLengths(profile.map(([r, z]) => [r, z]));
  const total = lengths.at(-1);
  return Object.freeze(lengths.map((value) => 1 - value / total));
};
const BALLOON_ARC = arcFromTop(BALLOON_PROFILE);
/* Экватор шара — самое широкое место профиля. */
const BALLOON_EQUATOR = BALLOON_ARC[6];

/*
 * Разметка листа по видам: куски `regions` — `{ id, rect: [x0, y0, x1, y1]
 * (доли листа), metres: [ширина, высота] (сколько это на модели), wrap —
 * обтягивает ли его своя текстура, seamX — кусок замкнут по ширине (шар),
 * places — места лого: `{ flipX, flipY, candidates: [{ box: [u0, v0, u1,
 * v1] (доли куска), metres }] }` }`. Из нескольких рамок места берётся та,
 * в которую лого влезает крупнее (широкая надпись — в широкую). Повороты
 * подобраны так, что лого читается слева направо с той стороны, откуда на
 * него смотрят.
 */
function boxAround([uc, vc], [halfU, halfV]) {
  return Object.freeze([uc - halfU, vc - halfV, uc + halfU, vc + halfV]);
}

const backV = ([low, high], angle) => (angle - low) / (high - low);

/* Рамки места лого на крыле: `[|x|0, |x|1, y0, y1]` в метрах → доли рамки развёртки крыла. */
const wingCandidates = (box, frames) =>
  Object.freeze(
    frames.map(([a0, a1, b0, b1]) =>
      Object.freeze({
        box: Object.freeze([(a0 - box.a0) / (box.a1 - box.a0), (box.b1 - b1) / (box.b1 - box.b0), (a1 - box.a0) / (box.a1 - box.a0), (box.b1 - b0) / (box.b1 - box.b0)]),
        metres: Object.freeze([a1 - a0, b1 - b0]),
      }),
    ),
  );
/* Места лого на перепонке дракона: внутренний лоскут от бока до четвёртого пальца (и перед рукой). */
const DRAGON_WING_PLACES = wingCandidates(DRAGON_WING, [
  [4.6, 8.6, -3.6, 0.9],
  [2.8, 8.8, -2.8, 0.7],
]);
/* Лого феникса — на кроющих крыла (их тело от плеча до кисти). */
const PHOENIX_WING_PLACES = wingCandidates(PHOENIX_WING, [[1.4, 5.6, -1.2, 0.85]]);
/* Лого грифона — на кроющих крыла, как у феникса. */
const GRIFFIN_WING_PLACES = wingCandidates(GRIFFIN_WING, [[1.0, 4.4, -0.5, 1.1]]);
/*
 * Бока вдоль тела (кит, восточный дракон): левый (его видно в кадре) — как
 * есть, правый — повёрнутым; `flank` — u от головы, `spread` — полуширина
 * по обхвату, °.
 */
const flankPlaces = (flank, back, spread, metres, angles = [125, 55]) =>
  Object.freeze(
    angles.map((angle, index) =>
      Object.freeze({
        flipX: index === 1,
        flipY: index === 1,
        candidates: Object.freeze([Object.freeze({ box: Object.freeze([flank[0], backV(back, angle - spread), flank[1], backV(back, angle + spread)]), metres: Object.freeze(metres) })]),
      }),
    ),
  );
const wingRegion = (id, rect, flipX, box, candidates) =>
  Object.freeze({ id, rect: Object.freeze(rect), metres: Object.freeze([box.a1 - box.a0, box.b1 - box.b0]), wrap: false, places: Object.freeze([Object.freeze({ flipX, flipY: false, candidates })]) });
/* Крылья: правое и левое, верх и низ. Сверху лого читается носом вверх, снизу — тоже (смотрят снизу, нос впереди). */
const wingRegions = (box, candidates) => [
  wingRegion("wing-right-top", [0, 0.375, 0.5, 0.6875], false, box, candidates),
  wingRegion("wing-left-top", [0.5, 0.375, 1, 0.6875], true, box, candidates),
  wingRegion("wing-right-bottom", [0, 0.6875, 0.5, 1], true, box, candidates),
  wingRegion("wing-left-bottom", [0.5, 0.6875, 1, 1], false, box, candidates),
];
/* Оболочка по кругу: лого с двух сторон (по развёртке 0,25 и 0,75 от шва на +Y). */
const sidePlaces = (v, half, metres) =>
  Object.freeze([0.25, 0.75].map((u) => Object.freeze({ flipX: false, flipY: false, candidates: Object.freeze([Object.freeze({ box: boxAround([u, v], half), metres: Object.freeze(metres) })]) })));
const BANNER_SIZE = Object.freeze([BANNER.front - BANNER.back, BANNER.top - BANNER.bottom]);
const bannerRegion = (id, rect) =>
  Object.freeze({
    id,
    rect: Object.freeze(rect),
    metres: BANNER_SIZE,
    wrap: true,
    places: Object.freeze([Object.freeze({ flipX: false, flipY: false, candidates: Object.freeze([Object.freeze({ box: Object.freeze([0.03, 0.09, 0.97, 0.91]), metres: Object.freeze([BANNER_SIZE[0] * 0.94, BANNER_SIZE[1] * 0.82]) })]) })]),
  });

const SKIN_LAYOUTS = Object.freeze({
  dragon: Object.freeze([Object.freeze({ id: "body", rect: Object.freeze([0, 0, 1, 0.375]), metres: Object.freeze([Math.round(DRAGON_LENGTH), 6]), wrap: true, places: Object.freeze([]) }), ...wingRegions(DRAGON_WING, DRAGON_WING_PLACES)]),
  phoenix: Object.freeze([Object.freeze({ id: "body", rect: Object.freeze([0, 0, 1, 0.375]), metres: Object.freeze([Math.round(PHOENIX_LENGTH), 3.5]), wrap: true, places: Object.freeze([]) }), ...wingRegions(PHOENIX_WING, PHOENIX_WING_PLACES)]),
  whale: Object.freeze([
    Object.freeze({
      id: "body",
      rect: Object.freeze([0, 0, 1, 1]),
      metres: Object.freeze([Math.round(WHALE_LENGTH), 11]),
      wrap: true,
      /* Бока над светящимися пятнами. */
      places: flankPlaces(WHALE_FLANK_U, WHALE_BACK, 30, [16, 3.5]),
    }),
  ]),
  balloon: Object.freeze([
    Object.freeze({ id: "envelope", rect: Object.freeze([0, 0, 1, 1]), metres: Object.freeze([49, 23.2]), wrap: true, seamX: true, places: sidePlaces(BALLOON_EQUATOR, [5.5 / 49, 4.5 / 23.2], [11, 9]) }),
  ]),
  jellyfish: Object.freeze([
    /* Купол: по кругу 2π·6 м, по дуге от макушки до кромки ~9 м; лого — на двух боках посередине дуги. */
    Object.freeze({ id: "bell", rect: Object.freeze([0, 0, 1, 1]), metres: Object.freeze([37.7, 9]), wrap: true, seamX: true, places: sidePlaces(0.55, [5 / 37.7, 2.7 / 9], [10, 5.4]) }),
  ]),
  ufo: Object.freeze([
    Object.freeze({
      id: "hull",
      rect: Object.freeze([0, 0, 1, 1]),
      metres: Object.freeze([UFO_REACH * 2, UFO_REACH * 2]),
      wrap: true,
      /* Кольцо между куполом и кромкой, спереди и сзади; верх лого — к середине тарелки. */
      places: Object.freeze(
        [
          [-8.4, false],
          [8.4, true],
        ].map(([y, turned]) =>
          Object.freeze({
            flipX: turned,
            flipY: turned,
            candidates: Object.freeze([Object.freeze({ box: boxAround([0.5, (UFO_REACH - y) / (UFO_REACH * 2)], [4.75 / (UFO_REACH * 2), 3 / (UFO_REACH * 2)]), metres: Object.freeze([9.5, 6]) })]),
          }),
        ),
      ),
    }),
  ]),
  lantern: Object.freeze([
    Object.freeze({
      id: "paper",
      rect: Object.freeze([0, 0, 1, 1]),
      metres: Object.freeze([LANTERN.top * 2, LANTERN.z1 - LANTERN.z0]),
      wrap: true,
      places: Object.freeze([
        Object.freeze({
          flipX: false,
          flipY: false,
          candidates: Object.freeze([Object.freeze({ box: boxAround([0.5, 0.45], [0.7 / (LANTERN.top * 2), 0.96 / (LANTERN.z1 - LANTERN.z0)]), metres: Object.freeze([1.4, 1.92]) })]),
        }),
      ]),
    }),
  ]),
  /* Полотнище: правая сторона (её видно с +X) и левая — каждая своим куском, надпись читается с обеих. */
  banner: Object.freeze([bannerRegion("right", [0, 0, 1, 0.5]), bannerRegion("left", [0, 0.5, 1, 1])]),
  /* Восточный дракон: спина и бока вдоль змеиного тела; лого — на боках средней трети тела. */
  eastern_dragon: Object.freeze([
    Object.freeze({
      id: "body",
      rect: Object.freeze([0, 0, 1, 1]),
      metres: Object.freeze([Math.round(EASTERN_LENGTH), 4.5]),
      wrap: true,
      places: flankPlaces(EASTERN_FLANK_U, EASTERN_BACK, 40, [7, 1.3], [120, 60]),
    }),
  ]),
  griffin: Object.freeze([Object.freeze({ id: "body", rect: Object.freeze([0, 0, 1, 0.375]), metres: Object.freeze([Math.round(GRIFFIN_LENGTH), 4]), wrap: true, places: Object.freeze([]) }), ...wingRegions(GRIFFIN_WING, GRIFFIN_WING_PLACES)]),
});

/** Разметка листа картинки вида: `{ width, height, regions }` или `null` (у вида нет своей модели). */
export function airshipSkinLayout(kindId) {
  const size = AIRSHIP_SKINS[kindId];
  return size ? { ...size, regions: SKIN_LAYOUTS[kindId] } : null;
}

const regionOf = (kindId, id) => SKIN_LAYOUTS[kindId].find((region) => region.id === id);

/* Пиксельный прямоугольник куска с отступом: `[x0, y0, x1, y1]`. */
function insetRect(kindId, region) {
  const { width, height } = AIRSHIP_SKINS[kindId];
  const [x0, y0, x1, y1] = region.rect;
  const padX = region.seamX ? 0 : SKIN_INSET;
  return [x0 * width + padX, y0 * height + SKIN_INSET, x1 * width - padX, y1 * height - SKIN_INSET];
}

/** Доли куска `(u, v)` → развёртка листа `[u, v]` (доли листа). */
function skinUv(kindId, regionId, u, v) {
  const { width, height } = AIRSHIP_SKINS[kindId];
  const [x0, y0, x1, y1] = insetRect(kindId, regionOf(kindId, regionId));
  return [(x0 + u * (x1 - x0)) / width, (y0 + v * (y1 - y0)) / height];
}

/* ------------------------------------------------------------------ *
 * Шар, фонарик, НЛО и самолёт
 * ------------------------------------------------------------------ */

const darker = (hex, k) => {
  const [r, g, b] = hexBytes(hex);
  return `#${[r, g, b].map((value) => Math.min(255, Math.round(value * k)).toString(16).padStart(2, "0")).join("")}`;
};

/* Узор оболочки шара: цвет куска (сегмент из 36, отрезок профиля). */
function balloonPick(item) {
  const [a, b, c] = item.colours;
  return {
    stripes: (segment) => [a, b, c][Math.floor(segment / 2) % 3],
    rings: (segment, band) => [a, b, c][Math.floor(band / 3) % 3],
    checks: (segment, band) => [a, b][(Math.floor(segment / 2) + Math.floor(band / 3)) % 2],
    spiral: (segment, band) => [a, b, c][(Math.floor(segment / 2) + band) % 3],
  }[item.pattern];
}

/* Пламя горелки: снизу белое, выше жёлтое и оранжевое, кончик — красный. */
const FLAME_BANDS = Object.freeze(["#fff0a8", "#ffbf2e", "#ff8a14", "#ff5a0e", "#e8340a"]);

/* Оболочка шара сверху вниз: v развёртки — доля дуги от макушки; клиньев — 18, у каждого 4 столбца сетки. */
const BALLOON_CURVE = curve(BALLOON_PROFILE.slice().reverse().map(([r, z]) => [r, z, 0]));
const BALLOON_GORES = BALLOON_SEGMENTS / 2;
const BALLOON_COLUMNS = BALLOON_GORES * 4;
const BALLOON_ROWS = 32;

/* Точка оболочки: ткань между лентами клиньев выпирает (u — от шва на +Y против часовой). */
function balloonPoint(u, v, inset = 0) {
  const [r0, z] = BALLOON_CURVE.at(v);
  const angle = Math.PI / 2 + Math.PI * 2 * u;
  const lobe = Math.pow(Math.abs(Math.cos(Math.PI * u * BALLOON_GORES)), 0.8);
  const r = r0 * (1 + 0.032 * lobe * smooth(0.02, 0.14, v) * smooth(1, 0.86, v)) - inset;
  return [r * Math.cos(angle), r * Math.sin(angle), z];
}

/** Ткань оболочки шара: узор работы, ленты по швам клиньев, поперечные полотнища, копоть у горловины. */
function balloonFabric(item) {
  const pick = balloonPick(item);
  return fabric({
    colourAt: (u, v) => {
      const segment = (Math.min(BALLOON_SEGMENTS - 1, Math.floor(u * BALLOON_SEGMENTS)) + BALLOON_SEAM) % BALLOON_SEGMENTS;
      let band = 0;
      while (band + 2 < BALLOON_ARC.length && BALLOON_ARC[band + 1] > v) band += 1;
      return rgb(pick(segment, band));
    },
    tapes: BALLOON_GORES,
    tapeShift: 0,
    tapeColour: "#3a3430",
    seams: 11,
    sheen: 0.1,
    scorch: 0.07,
    period: BALLOON_GORES,
  });
}

/* Полотнище баннера: ткань цвета работы с подрубленными краями. */
const bannerCloth = (item) => fabric({ colourAt: () => rgb(item.banner), sheen: 0.08, hem: 0.035 });

/* Развёртка грани ящика: координаты по двум осям грани (м) → доли куска `size` м. */
const boxUv = (map, size) => (point, normal) => {
  const [x, y, z] = point;
  const [a, b] = Math.abs(normal[2]) > 0.5 ? [x, y] : Math.abs(normal[0]) > 0.5 ? [y, z] : [x, z];
  return map(0.5 + a / size, 0.5 - b / size);
};

/*
 * Воздушный шар: высота ~22 м, оболочка клиньями трёх цветов (ткань с
 * лентами по швам, полотнища выпирают между лентами), плетёная корзина с
 * кожаным кантом и горелка. Пламя — крупное (4 м) и яркое: его видно
 * издалека, оно мерцает (кончик прыгает); низ оболочки изнутри подсвечен.
 */
function buildBalloon(item, m, atlas) {
  const { body, glow, flame, skin } = m;
  const envelope = atlas.region("envelope", [0, 0, 1024, 512], balloonFabric(item), 4);
  const wickerMap = atlas.region("basket", [0, 512, 256, 256], wicker({ colour: "#8a5a2b" }));
  surface(skin || body, BALLOON_ROWS, BALLOON_COLUMNS, (i, j) => balloonPoint(j / BALLOON_COLUMNS, i / BALLOON_ROWS), {
    wrap: true,
    uv: (i, j) => (skin ? skinUv("balloon", "envelope", j / BALLOON_COLUMNS, i / BALLOON_ROWS) : envelope(j / BALLOON_COLUMNS, i / BALLOON_ROWS)),
  });
  /* Изнутри низ оболочки подсвечен огнём — лицом внутрь. */
  const [warm, hot] = [atlas.uv("#ffb04a"), atlas.uv("#ff8a2a")];
  surface(glow, 12, BALLOON_COLUMNS, (i, j) => balloonPoint(j / BALLOON_COLUMNS, lerp(0.5, 1, i / 12), 0.25), { wrap: true, flip: true, uv: (i) => (i > 7 ? hot : warm) });
  /* Юбка под оболочкой. */
  lathe(body, atlas, [[1.15, -5.8], [1.5, -5.0]], { segments: 18, colourOf: () => "#2c2c30" });
  /* Стропы — от юбки к углам корзины; стойки рамы горелки. */
  for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    tube(body, atlas, [x * 1.05, y * 1.05, -5.4], [x * 0.75, y * 0.75, -9.8], 0.05, 0.05, "#3b2a1c", { segments: 5, caps: false });
    tube(body, atlas, [x * 0.72, y * 0.72, -9.85], [x * 0.42, y * 0.42, -8.7], 0.04, 0.04, "#6b6f76", { segments: 5, caps: false });
  }
  /* Корзина: плетёная, с кожаным кантом сверху и снизу. */
  boxFaces(body, [[-0.8, -0.8, -11], [0.8, 0.8, -9.95]], boxUv(wickerMap, 1.8));
  for (const z of [-9.92, -10.98])
    for (const [from, to] of [
      [[-0.82, -0.82, z], [0.82, -0.82, z]],
      [[0.82, -0.82, z], [0.82, 0.82, z]],
      [[0.82, 0.82, z], [-0.82, 0.82, z]],
      [[-0.82, 0.82, z], [-0.82, -0.82, z]],
    ])
      tube(body, atlas, from, to, 0.07, 0.07, "#3a2616", { segments: 6, caps: false });
  /* Горелка: баллон, змеевик и пламя (снизу белое, кончик красный; кончик пляшет). */
  tube(body, atlas, [0, 0, -9.0], [0, 0, BALLOON_FLAME.base], 0.34, 0.3, "#6b6f76", { segments: 12 });
  for (let turn = 0; turn < 3; turn += 1) {
    const z = -8.95 + turn * 0.11;
    lathe(body, atlas, [[0.4, z], [0.42, z + 0.05], [0.4, z + 0.1]], { segments: 12, colourOf: () => "#9aa0a8" });
  }
  const { base, tip } = BALLOON_FLAME;
  flame.flexOf = ([, , z]) => Math.pow(smooth(base + 0.3, tip, z), 1.2);
  lathe(
    flame,
    atlas,
    [
      [0.36, base],
      [0.78, base + 0.6],
      [0.98, base + 1.5],
      [0.84, base + 2.4],
      [0.52, base + 3.2],
      [0, tip],
    ],
    { segments: 14, colourOf: (segment, band) => FLAME_BANDS[Math.min(FLAME_BANDS.length - 1, band)] },
  );
  flame.flexOf = null;
}

/*
 * Небесный фонарик: бумажный короб ~1,4 → 2,2 м, высота 3 м, светится весь
 * (бумага с волокнами, светлее к пламени); внутри — пламя, которое мерцает.
 */
function buildLantern(item, m, atlas) {
  const { body, glow, flame, skin } = m;
  const paperMap = atlas.region("paper", [0, 0, 512, 512], paper({ colour: item.colour }));
  const { bottom, top, z0, z1 } = LANTERN;
  const corners = (half, z) => [[-half, -half, z], [half, -half, z], [half, half, z], [-half, half, z]];
  const low = corners(bottom, z0);
  const high = corners(top, z1);
  /* Каждая сторона — весь кусок: u — поперёк стороны (низ уже верха), v — сверху вниз. */
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    const side = [[low[index], low[next], high[next]], [low[index], high[next], high[index]]];
    const along = sub(high[next], high[index]).map((value) => value / (top * 2));
    const middle = scale(add(high[index], high[next]), 0.5);
    const uvOf = (point) => {
      const offset = sub(point, middle);
      const u = 0.5 + (offset[0] * along[0] + offset[1] * along[1]) / (top * 2);
      const v = (z1 - point[2]) / (z1 - z0);
      return skin ? skinUv("lantern", "paper", u, v) : paperMap(u, v);
    };
    /* Бумага видна и снаружи, и изнутри — две грани. */
    membrane(skin || glow, side, uvOf);
  }
  membrane(glow, [[high[0], high[1], high[2]], [high[0], high[2], high[3]]], paperMap(0.5, 0.05));
  /* Бамбуковые рёбра, проволочное кольцо, крестовина и топливная таблетка. */
  for (let index = 0; index < 4; index += 1) {
    tube(body, atlas, low[index], high[index], 0.025, 0.025, "#b08a52", { segments: 5, caps: false });
    tube(body, atlas, low[index], low[(index + 1) % 4], 0.03, 0.03, "#2a2a2a", { segments: 5, caps: false });
    tube(body, atlas, low[index], [0, 0, z0 + 0.05], 0.02, 0.02, "#2a2a2a", { segments: 4, caps: false });
  }
  tube(body, atlas, [0, 0, z0 + 0.0], [0, 0, z0 + 0.12], 0.16, 0.16, "#3a2a1a", { segments: 10 });
  flame.flexOf = ([, , z]) => smooth(z0 + 0.15, z0 + 0.95, z);
  lathe(
    flame,
    atlas,
    [
      [0.14, z0 + 0.12],
      [0.2, z0 + 0.3],
      [0.15, z0 + 0.55],
      [0.07, z0 + 0.78],
      [0, z0 + 0.95],
    ],
    { segments: 10, colourOf: (segment, band) => (band < 1 ? "#fff6c8" : "#ffc24a") },
  );
  flame.flexOf = null;
}

/*
 * НЛО: тарелка ~25 м — металл с кольцевыми швами, листами и заклёпками,
 * купол с антенной, иллюминаторы по верху корпуса, кольцо огней по кромке
 * — яркий через два тусклых: кольцо вертится, огни бегут по кругу; снизу —
 * светящийся круг и венец огней.
 */
function buildUfo(item, m, atlas) {
  const { body, glow, flame, dim, skin } = m;
  const hullMap = atlas.region("hull", [0, 0, 512, 512], metalHull({ colour: item.colour }));
  lathe(body, atlas, UFO_HULL, {
    segments: 48,
    colourOf: (segment, band) => (band === UFO_RIM_BAND ? darker(item.colour, 0.7) : item.colour),
    /* Корпус в плане: сверху — как видно сверху, снизу — как видно снизу (без зеркала); кромка — цветом. */
    skin: {
      mesh: skin || body,
      uv: (band, segment, corner, point) => {
        if (band === UFO_RIM_BAND) return null;
        const below = band < UFO_RIM_BAND;
        const u = (UFO_REACH + (below ? -point[0] : point[0])) / (UFO_REACH * 2);
        const v = (UFO_REACH - point[1]) / (UFO_REACH * 2);
        return skin ? skinUv("ufo", "hull", u, v) : hullMap(u, v);
      },
    },
  });
  lathe(glow, atlas, [[4.4, 1.55], [4.2, 2.4], [3.4, 3.3], [2.0, 3.85], [0, 4.05]], { segments: 40, colourOf: () => "#cfefff" });
  /* Обод купола и иллюминаторы. */
  lathe(body, atlas, [[4.55, 1.5], [4.6, 1.62], [4.4, 1.7]], { segments: 40, colourOf: () => darker(item.colour, 0.6) });
  for (let index = 0; index < 16; index += 1) {
    const angle = (Math.PI * 2 * (index + 0.5)) / 16;
    ellipsoid(glow, atlas, [Math.cos(angle) * 9.2, Math.sin(angle) * 9.2, 1.02], [0.34, 0.34, 0.12], "#d8f4ff", { segments: 8, rings: 4 });
  }
  tube(body, atlas, [0, 0, 3.95], [0, 0, 5.2], 0.07, 0.04, darker(item.colour, 0.7), { segments: 6 });
  ellipsoid(flame, atlas, [0, 0, 5.3], [0.16, 0.16, 0.16], item.lights, { segments: 8, rings: 5 });
  /* Свет снизу — плоский круг лицом вниз и венец из восьми огней. */
  lathe(glow, atlas, [[3.2, -1.45], [0, -1.45]], { segments: 24, colourOf: () => item.lights });
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * (index + 0.5)) / 8;
    ellipsoid(glow, atlas, [Math.cos(angle) * 6.2, Math.sin(angle) * 6.2, -1.15], [0.3, 0.3, 0.16], item.lights, { segments: 8, rings: 4 });
  }
  /* Кольцо огней: вертится целиком (доля движения — 1). */
  flame.flexOf = () => 1;
  dim.flexOf = () => 1;
  for (let index = 0; index < 24; index += 1) {
    const angle = (Math.PI * 2 * index) / 24;
    ellipsoid(index % 3 ? dim : flame, atlas, [Math.cos(angle) * 12.5, Math.sin(angle) * 12.5, 0.25], [0.36, 0.36, 0.3], item.lights, { segments: 8, rings: 5 });
  }
  flame.flexOf = null;
  dim.flexOf = null;
}

/*
 * Самолёт с баннером: биплан ~8 м тянет на тросе полотнище 26,5 × 5 м — на
 * нём лого работы (надпись или картинка) с обеих сторон. Полотнище — ткань
 * с подрубленными краями; оно полощется: хвост ходит из стороны в сторону,
 * шест у троса стоит. Огни на концах крыльев и хвосте светятся.
 */
function buildBanner(item, m, atlas) {
  const { body, glow, skin } = m;
  const clothMap = atlas.region("cloth", [0, 0, 1024, 256], bannerCloth(item));
  flexAll(m, ([, y]) => (y < BANNER.front ? Math.pow((BANNER.front - y) / (BANNER.front - BANNER.back), 1.25) : 0));
  const dark = "#26221e";
  sweep(
    body,
    atlas,
    BANNER_NODES,
    [
      [-30, 210, item.colour],
      [210, 330, darker(item.colour, 0.75)],
    ],
    { segments: 10 },
  );
  /* Капот, кок и винт (две лопасти). */
  tube(body, atlas, [0, 20.3, 0], [0, 20.78, 0], 0.44, 0.4, dark, { segments: 14 });
  tube(body, atlas, [0, 20.78, 0], [0, 21.3, 0], 0.18, 0, item.wings, { segments: 10 });
  for (const sign of [1, -1])
    membrane(
      body,
      [
        [[sign * 0.1, 20.86, -0.09], [sign * 1.25, 20.86, -0.06], [sign * 1.25, 20.86, 0.06]],
        [[sign * 0.1, 20.86, -0.09], [sign * 1.25, 20.86, 0.06], [sign * 0.1, 20.86, 0.09]],
      ],
      atlas.uv(dark),
    );
  /* Крылья: верхнее и нижнее, стойки между ними. */
  const wing = atlas.uv(item.wings);
  boxFaces(body, [[-4.6, 17.35, 1.08], [4.6, 18.65, 1.22]], wing);
  boxFaces(body, [[-4.2, 17.45, -0.52], [4.2, 18.6, -0.4]], wing);
  for (const sign of [1, -1]) {
    tube(body, atlas, [sign * 3.0, 17.9, -0.4], [sign * 3.0, 18.1, 1.08], 0.05, 0.05, dark, { segments: 5, caps: false });
    tube(body, atlas, [sign * 0.45, 18.1, 0.5], [sign * 0.6, 18.2, 1.08], 0.04, 0.04, dark, { segments: 5, caps: false });
    /* Шасси: стойка и колесо. */
    tube(body, atlas, [sign * 0.35, 18.6, -0.5], [sign * 0.8, 18.8, -1.3], 0.05, 0.05, dark, { segments: 5, caps: false });
    ellipsoid(body, atlas, [sign * 0.85, 18.8, -1.3], [0.1, 0.33, 0.33], dark, { segments: 12, rings: 8 });
    /* Огни на концах крыла: справа зелёный, слева красный. */
    ellipsoid(glow, atlas, [sign * 4.62, 18.0, 1.15], [0.1, 0.12, 0.08], sign > 0 ? "#3dff6a" : "#ff3a30", { segments: 6, rings: 4 });
  }
  /* Хвост: стабилизатор, киль, белый огонь. */
  boxFaces(body, [[-1.6, 13.05, 0.3], [1.6, 13.95, 0.4]], wing);
  membrane(
    body,
    [
      [[0, 12.95, 0.4], [0, 13.95, 0.45], [0, 13.45, 1.65]],
      [[0, 12.95, 0.4], [0, 13.45, 1.65], [0, 12.95, 1.55]],
    ],
    atlas.uv(item.colour),
  );
  ellipsoid(glow, atlas, [0, 12.9, 0.55], [0.08, 0.08, 0.08], "#fff8e8", { segments: 6, rings: 4 });
  /* Пилот в открытой кабине. */
  ellipsoid(body, atlas, [0, 17.6, 0.66], [0.22, 0.24, 0.26], "#3b2a1c", { segments: 10, rings: 7 });
  /* Трос и уздечка к шесту полотнища, шест с грузом внизу. */
  const { front, back, top, bottom, columns, rows } = BANNER;
  const hitch = [0, front + 2.5, 0];
  tube(body, atlas, [0, 12.95, 0.1], hitch, 0.03, 0.03, dark, { segments: 4, caps: false });
  for (const z of [top, bottom]) tube(body, atlas, hitch, [0, front, z], 0.025, 0.025, dark, { segments: 4, caps: false });
  tube(body, atlas, [0, front, bottom - 0.15], [0, front, top + 0.15], 0.06, 0.06, dark, { segments: 6 });
  ellipsoid(body, atlas, [0, front, bottom - 0.3], [0.18, 0.18, 0.22], dark, { segments: 8, rings: 5 });
  /* Полотнище: сетка вдоль и поперёк — гнётся плавно, обе стороны своей развёрткой. */
  const at = (column, row) => [0, lerp(front, back, column / columns), lerp(top, bottom, row / rows)];
  const triangles = [];
  for (let column = 0; column < columns; column += 1)
    for (let row = 0; row < rows; row += 1) {
      const [a, b, c, d] = [at(column, row), at(column + 1, row), at(column + 1, row + 1), at(column, row + 1)];
      triangles.push([a, b, c], [a, c, d]);
    }
  membrane(skin || body, triangles, (point, normal) => {
    const right = normal[0] >= 0;
    /* С +X нос самолёта справа: читается от хвоста к самолёту; с −X — наоборот. */
    const u = right ? (point[1] - back) / (front - back) : (front - point[1]) / (front - back);
    const v = (top - point[2]) / (top - bottom);
    return skin ? skinUv("banner", right ? "right" : "left", u, v) : clothMap(u, v);
  });
}

/*
 * Множители свечения частей по видам: огонь шара — ярче всего (его видно
 * издалека), купол и бумага — мягче. `glow` есть у каждого вида.
 */
export const AIRSHIP_GLOW = Object.freeze({
  dragon: Object.freeze({ glow: 6, flame: 10 }),
  phoenix: Object.freeze({ glow: 4, flame: 12 }),
  balloon: Object.freeze({ glow: 3, flame: 24 }),
  lantern: Object.freeze({ glow: 2.5, flame: 12 }),
  ufo: Object.freeze({ glow: 3, flame: 8, dim: 1.2 }),
  whale: Object.freeze({ glow: 4 }),
  jellyfish: Object.freeze({ glow: 2, flame: 6 }),
  banner: Object.freeze({ glow: 6 }),
  eastern_dragon: Object.freeze({ glow: 6 }),
  griffin: Object.freeze({ glow: 4 }),
});
/* Лист картинки светится вместе с телом: бумага фонарика, купол медузы. */
const SKIN_GLOWS = new Set(["lantern", "jellyfish"]);

const BUILDERS = Object.freeze({
  dragon: buildDragon,
  phoenix: buildPhoenix,
  balloon: buildBalloon,
  lantern: buildLantern,
  ufo: buildUfo,
  whale: buildWhale,
  jellyfish: buildJellyfish,
  banner: buildBanner,
  eastern_dragon: buildEasternDragon,
  griffin: buildGriffin,
});

/** Свои ли модели у вида (дирижабль — модель игры, её строит установщик). */
export const airshipHasOwnModel = (kindId) => Boolean(BUILDERS[kindId]);

const PART_ROLES = Object.freeze(["body", "glow", "flame", "dim", "skin"]);

const toArrays = (mesh) => ({
  positions: Float32Array.from(mesh.positions),
  normals: Float32Array.from(mesh.normals),
  uvs: Float32Array.from(mesh.uvs),
  indices: mesh.count > 65535 ? Uint32Array.from(mesh.indices) : Uint16Array.from(mesh.indices),
  flex: Float32Array.from(mesh.flex),
});

/**
 * Модель вида в облике работы: `{ parts: [{ role, shader, emissive,
 * texture, positions, normals, uvs, indices, flex }], atlas: { width,
 * height, rgba }, regions, skin: { width, height } | null, bounds: { min,
 * max }, radius }`. `texture` части — `"atlas"` (лист модели) или `"skin"` (лист
 * картинки: его рисует `paintAirshipSkin`); `skin` есть, когда у вида лого
 * или своя текстура. `flex` — доля «местного» движения у каждой вершины
 * (`airshipMotionPose`). Размер вида (`size`, %) — масштабом всей модели.
 * `atlasSize` — сторона листа модели (игра — 1024, кадр окна — 512, тот же
 * рисунок). Дирижабль — `null` (модель игры).
 */
export function airshipModel(kindId, input, { atlasSize = AIRSHIP_ATLAS.size } = {}) {
  const build = BUILDERS[kindId];
  if (!build || !airshipKind(kindId)) return null;
  const project = normalizeAirshipsProject(input);
  const item = project.fleet[kindId];
  const atlas = createAtlas();
  const meshes = { body: createMesh(), glow: createMesh(), flame: createMesh(), dim: createMesh(), skin: airshipDecorated(kindId, project) ? createMesh() : null };
  build(item, meshes, atlas, { kindId, skinUv: (regionId, u, v) => skinUv(kindId, regionId, u, v) });
  const factor = item.size / 100;
  const glows = AIRSHIP_GLOW[kindId];
  const parts = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const role of PART_ROLES) {
    const mesh = meshes[role];
    if (!mesh?.count) continue;
    const arrays = toArrays(mesh);
    for (let at = 0; at < arrays.positions.length; at += 1) {
      arrays.positions[at] = Math.round(arrays.positions[at] * factor * 1e4) / 1e4;
      min[at % 3] = Math.min(min[at % 3], arrays.positions[at]);
      max[at % 3] = Math.max(max[at % 3], arrays.positions[at]);
    }
    const emissive = role === "body" ? 0 : role === "skin" ? (SKIN_GLOWS.has(kindId) ? glows.glow : 0) : glows[role] || glows.glow;
    parts.push({ role, shader: emissive ? "emissive" : "default", emissive, texture: role === "skin" ? "skin" : "atlas", ...arrays });
  }
  const radius = Math.max(...min.map(Math.abs), ...max.map(Math.abs));
  const key = atlasKey(kindId, item, atlasSize);
  return {
    parts,
    /* Лист рисуется, когда его спросят (рамке снимка он не нужен), и один на вид и цвета. */
    get atlas() {
      return paintedAtlas(key, atlas, atlasSize);
    },
    /* Куски листа модели `[{ id, rect: [x, y, w, h] }]` (px) — для проверок и описания. */
    regions: atlas.regions,
    skin: meshes.skin ? { ...AIRSHIP_SKINS[kindId] } : null,
    bounds: { min, max },
    radius,
  };
}

/*
 * Нарисованные листы моделей: рисунок зависит только от вида и его цветов
 * (размер, сколько, лого и текстура — нет), поэтому лист рисуется один раз
 * на облик и живёт, пока его не вытеснят новые (кадр, плитки, обложка и
 * установка зовут модель много раз). Лист только читают.
 */
const ATLASES = new Map();
const ATLAS_KEEP = 24;
function atlasKey(kindId, item, size) {
  const { count: _count, size: _size, decal: _decal, skin: _skin, ...colours } = item;
  return JSON.stringify([kindId, size, colours]);
}
function paintedAtlas(key, atlas, size) {
  let made = ATLASES.get(key);
  if (made) ATLASES.delete(key);
  else made = atlas.paint(size);
  ATLASES.set(key, made);
  while (ATLASES.size > ATLAS_KEEP) ATLASES.delete(ATLASES.keys().next().value);
  return made;
}

/* ------------------------------------------------------------------ *
 * Движение частей
 * ------------------------------------------------------------------ */

/*
 * «Местное» движение вида: `period` — секунды основного цикла (взмах, удар
 * хвоста, вздох купола); `terms` — сдвиг f как сумма волн `[вектор (м при
 * 100 %), кратность цикла, сдвиг фазы]`; `sway` — покачивание поворотом
 * (вектор поворота по осям, рад, со своими фазами, вокруг `centre`);
 * `spin` — вращение (`rate` — оборотов в секунду вокруг `axis` через
 * `centre`). В игре цикл — целое число раз за круг полёта (клип замкнут),
 * в кадре окна — по своему периоду.
 */
const wave = (period, terms) => Object.freeze({ period, terms: Object.freeze(terms) });
const MOTIONS = Object.freeze({
  /* Взмах: концы — на 4 м вверх и вниз, вниз — резче (вторая волна), вперёд-назад — восьмёркой. */
  dragon: wave(2.6, [
    [[0, 0, 4.0], 1, 0],
    [[0, 0, 0.6], 2, Math.PI / 2],
    [[0, 0.5, 0], 1, Math.PI / 2],
  ]),
  phoenix: wave(1.8, [
    [[0, 0, 3.0], 1, 0],
    [[0, 0, 0.45], 2, Math.PI / 2],
    [[0, 0.4, 0], 1, Math.PI / 2],
  ]),
  /* Огонь: несколько волн разной частоты — кончик прыгает неровно. */
  balloon: wave(0.6, [
    [[0, 0, 0.5], 1, 0],
    [[0, 0, 0.28], 3, 1.1],
    [[0.16, 0, 0], 2, 0.4],
    [[0, 0.12, 0], 5, 2.2],
  ]),
  lantern: wave(0.4, [
    [[0, 0, 0.1], 1, 0],
    [[0, 0, 0.05], 3, 1.3],
    [[0.03, 0, 0], 2, 0.4],
  ]),
  ufo: Object.freeze({ period: 4, terms: Object.freeze([]), spin: Object.freeze({ rate: 0.25, axis: Object.freeze([0, 0, 1]), centre: Object.freeze([0, 0, 0]) }) }),
  whale: wave(5.5, [[[0, 0, 1.9], 1, 0]]),
  jellyfish: Object.freeze({
    period: 6,
    terms: Object.freeze([[[0, 0, 0.8], 2, 0]]),
    sway: Object.freeze({ amplitude: Object.freeze([0.2, 0.14, 0]), phases: Object.freeze([0, Math.PI / 2, 0]), centre: Object.freeze([0, 0, JELLY_LIFT]) }),
  }),
  banner: wave(0.8, [
    [[1.3, 0, 0], 1, 0],
    [[0.35, 0, 0], 2, 0.9],
    [[0, 0, 0.25], 1, 1.6],
  ]),
  /*
   * Восточный дракон летит волной тела. Кость одна, поэтому волна —
   * сдвигом и поворотом вполоборота: вверх-вниз dz = A·sin + B·y·cos, вбок
   * dx = A′·cos − C·y·sin — у головы (y > 0) фаза впереди, у хвоста позади,
   * гребень бежит от головы к хвосту. Голова стоит (доля 0), к хвосту доля
   * растёт до 1 (`buildEasternDragon`).
   */
  eastern_dragon: Object.freeze({
    period: 4.2,
    terms: Object.freeze([
      [[0, 0, 1.4], 1, 0],
      [[1.1, 0, 0], 1, Math.PI / 2],
    ]),
    sway: Object.freeze({ amplitude: Object.freeze([0.09, 0, 0.07]), phases: Object.freeze([Math.PI / 2, 0, 0]), centre: Object.freeze([0, 0, 0]) }),
  }),
  griffin: wave(1.6, [
    [[0, 0, 2.2], 1, 0],
    [[0, 0, 0.3], 2, Math.PI / 2],
    [[0, 0.3, 0], 1, Math.PI / 2],
  ]),
});

/** «Местное» движение вида (см. `MOTIONS`) или `null`. */
export const airshipMotion = (kindId) => MOTIONS[kindId] || null;

/* Частота кадров движения для хоста — та же, что у клипов построек игры. */
export const AIRSHIP_MOTION_FPS = 30;
/* Предел кадров движения: круг ≤ 300 с при 30 кадрах в секунду. */
const MOTION_FRAMES = 9001;

const axisAngle = ([x, y, z], angle) => {
  const half = Math.sin(angle / 2);
  return [x * half, y * half, z * half, Math.cos(angle / 2)];
};

/* Поза движения: фаза основного цикла и угол вращения → `{ q, f }` (v → q·v + f), размер `factor`. */
function poseAt(spec, phase, spinAngle, factor) {
  const f = [0, 0, 0];
  for (const [vector, multiple, shift] of spec.terms) {
    const value = Math.sin(multiple * phase + shift);
    for (let axis = 0; axis < 3; axis += 1) f[axis] += vector[axis] * value * factor;
  }
  let q = [0, 0, 0, 1];
  let centre = [0, 0, 0];
  if (spec.sway) {
    const turn = spec.sway.amplitude.map((value, axis) => value * Math.sin(phase + spec.sway.phases[axis]));
    const angle = length(turn);
    if (angle > 1e-9) q = axisAngle(scale(turn, 1 / angle), angle);
    centre = scale(spec.sway.centre, factor);
  }
  if (spec.spin) {
    q = axisAngle(spec.spin.axis, spinAngle);
    centre = scale(spec.spin.centre, factor);
  }
  /* Поворот вокруг `centre`: v → q·(v − c) + c = q·v + (c − q·c). */
  const turned = quatRotate(q, centre);
  return { q, f: [f[0] + centre[0] - turned[0], f[1] + centre[1] - turned[1], f[2] + centre[2] - turned[2]] };
}

/**
 * Поза «местного» движения в кадре окна в момент `seconds`: `{ q, f }` —
 * вершина v с долей w идёт в (1 − w)·v + w·(q·v + f). `null` — вид не
 * движется.
 */
export function airshipMotionPose(kindId, input, seconds) {
  const spec = MOTIONS[kindId];
  if (!spec) return null;
  const factor = normalizeAirshipsProject(input).fleet[kindId].size / 100;
  return poseAt(spec, (Math.PI * 2 * seconds) / spec.period, spec.spin ? Math.PI * 2 * spec.spin.rate * seconds : 0, factor);
}

/**
 * «Местное» движение на круг полёта `duration` для хоста: кадры
 * `[fx, fy, fz, qx, qy, qz, qw]` с частотой клипа (30 в секунду, до 9001),
 * цикл — целое число раз за круг, вращение — целое число оборотов (клип
 * замкнут); кватернион непрерывен по знаку. `null` — вид не движется.
 */
export function airshipMotionFrames(kindId, input, duration) {
  const spec = MOTIONS[kindId];
  if (!spec) return null;
  const factor = normalizeAirshipsProject(input).fleet[kindId].size / 100;
  const count = Math.min(MOTION_FRAMES, Math.max(2, Math.round(duration * AIRSHIP_MOTION_FPS) + 1));
  const cycles = Math.max(1, Math.round(duration / spec.period));
  const turns = spec.spin ? Math.max(1, Math.round(duration * spec.spin.rate)) : 0;
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const share = index / (count - 1);
    const { q, f } = poseAt(spec, Math.PI * 2 * cycles * share, Math.PI * 2 * turns * share, factor);
    frames.push([...f, ...q].map((value) => Math.round(value * 1e5) / 1e5));
  }
  /* Последний кадр — первое место (цикл замкнут); поворот — непрерывным знаком. */
  for (let axis = 0; axis < 3; axis += 1) frames[count - 1][axis] = frames[0][axis];
  return frames;
}

/* ------------------------------------------------------------------ *
 * Лист картинки
 * ------------------------------------------------------------------ */

/*
 * Картинка `image` (`{ rgba, width, height }`) в пиксельный прямоугольник
 * `[x0, y0, x1, y1]` листа поверх того, что там есть (по прозрачности),
 * усреднением по площади: картинка бывает крупнее места вдесятеро. `crop` —
 * какая часть картинки идёт (доли), `flipX`/`flipY` — зеркала, `wrapX` —
 * лист замкнут по ширине (оболочка шара).
 */
function drawPicture(out, width, height, image, [rx0, ry0, rx1, ry1], { crop = [0, 0, 1, 1], flipX = false, flipY = false, wrapX = false } = {}) {
  if (!image?.rgba || !image.width || !image.height) return;
  const [cx0, cy0, cx1, cy1] = crop;
  const left = Math.round(rx0);
  const right = Math.round(rx1);
  const top = Math.max(0, Math.round(ry0));
  const bottom = Math.min(height, Math.round(ry1));
  const w = right - left;
  const h = Math.round(ry1) - Math.round(ry0);
  if (w < 1 || h < 1) return;
  for (let y = top; y < bottom; y += 1) {
    let t0 = (y - Math.round(ry0)) / h;
    let t1 = (y + 1 - Math.round(ry0)) / h;
    if (flipY) [t0, t1] = [1 - t1, 1 - t0];
    const sy0 = Math.min(image.height - 1, Math.floor((cy0 + t0 * (cy1 - cy0)) * image.height));
    const sy1 = Math.max(sy0 + 1, Math.min(image.height, Math.floor((cy0 + t1 * (cy1 - cy0)) * image.height)));
    for (let x = left; x < right; x += 1) {
      let tx = x;
      if (wrapX) tx = ((x % width) + width) % width;
      else if (x < 0 || x >= width) continue;
      let s0 = (x - left) / w;
      let s1 = (x + 1 - left) / w;
      if (flipX) [s0, s1] = [1 - s1, 1 - s0];
      const sx0 = Math.min(image.width - 1, Math.floor((cx0 + s0 * (cx1 - cx0)) * image.width));
      const sx1 = Math.max(sx0 + 1, Math.min(image.width, Math.floor((cx0 + s1 * (cx1 - cx0)) * image.width)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1)
        for (let sx = sx0; sx < sx1; sx += 1) {
          const at = (sy * image.width + sx) * 4;
          const alpha = image.rgba[at + 3];
          r += image.rgba[at] * alpha;
          g += image.rgba[at + 1] * alpha;
          b += image.rgba[at + 2] * alpha;
          a += alpha;
          n += 1;
        }
      if (!a) continue;
      const share = a / n / 255;
      const to = (y * width + tx) * 4;
      out[to] = Math.round(out[to] * (1 - share) + (r / a) * share);
      out[to + 1] = Math.round(out[to + 1] * (1 - share) + (g / a) * share);
      out[to + 2] = Math.round(out[to + 2] * (1 - share) + (b / a) * share);
    }
  }
}

/*
 * Рисунок куска листа картинки: `(u, v, out)` — тот же, что у куска листа
 * модели с той же развёрткой (спина дракона — чешуёй, перепонка — с
 * жилками), поэтому лого и своя текстура ложатся поверх «кожи» модели.
 */
const flat = (hex) => {
  const [r, g, b] = hexBytes(hex);
  return (u, v, out) => {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  };
};
function regionFill(kindId, regionId, item) {
  if (kindId === "dragon") {
    const paint = dragonMaterials(item);
    return regionId === "body" ? paint.back : paint.wing;
  }
  if (kindId === "phoenix") {
    const paint = phoenixMaterials(item);
    return regionId === "body" ? paint.back : paint.covert;
  }
  if (kindId === "whale") return whaleMaterials(item).back;
  if (kindId === "jellyfish") return jellyMaterials(item).bell;
  if (kindId === "eastern_dragon") return easternMaterials(item).back;
  if (kindId === "griffin") {
    const paint = griffinMaterials(item);
    return regionId === "body" ? paint.back : paint.covert;
  }
  if (kindId === "banner") return bannerCloth(item);
  if (kindId === "balloon") return balloonFabric(item);
  if (kindId === "lantern") return paper({ colour: item.colour });
  if (kindId === "ufo") return metalHull({ colour: item.colour });
  return flat(item.colour);
}

/** Сколько раз своя текстура повторяется по ширине куска: картинка не растягивается сильнее, чем вдвое. */
export function airshipSkinTiles(region, image) {
  if (!image?.width || !image?.height) return 1;
  const want = region.metres[0] / region.metres[1] / (image.width / image.height);
  return Math.max(1, Math.min(8, Math.round(want)));
}

/**
 * Лист картинки вида в облике работы: `{ rgba, width, height }` по
 * `AIRSHIP_SKINS` или `null` (у вида нет ни лого, ни своей текстуры).
 * `decal` и `texture` — уже прочитанные пиксели (`{ rgba, width, height }`):
 * лого (картинка или нарисованная окном надпись) и своя текстура. Куски
 * листа — цвета модели (у шара — его узор); своя текстура ложится поверх
 * каждого обтягиваемого куска (повторами по длине, заполняя высоту,
 * прозрачное — цветом модели); лого — по местам вида, вписанным в рамку
 * места, размером работы (`decal.size`).
 */
export function paintAirshipSkin(kindId, input, { decal = null, texture = null } = {}) {
  const layout = airshipSkinLayout(kindId);
  if (!layout || !airshipDecorated(kindId, input)) return null;
  const project = normalizeAirshipsProject(input);
  const item = project.fleet[kindId];
  const { width, height } = layout;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let at = 3; at < out.length; at += 4) out[at] = 255;
  for (const region of layout.regions) {
    const fill = regionFill(kindId, region.id, item);
    const [x0, y0, x1, y1] = region.rect.map((value, index) => Math.round(value * (index % 2 ? height : width)));
    const [ix0, iy0, ix1, iy1] = insetRect(kindId, region);
    const colour = [0, 0, 0];
    for (let y = y0; y < y1; y += 1) {
      const v = Math.min(1, Math.max(0, (y + 0.5 - iy0) / (iy1 - iy0)));
      for (let x = x0; x < x1; x += 1) {
        fill(Math.min(1, Math.max(0, (x + 0.5 - ix0) / (ix1 - ix0))), v, colour);
        const at = (y * width + x) * 4;
        out[at] = colour[0];
        out[at + 1] = colour[1];
        out[at + 2] = colour[2];
      }
    }
    /* Своя текстура: повторы по ширине, каждый заполняет свою клетку (лишнее по краям картинки срезается). */
    if (region.wrap && airshipSkinReady(item) && texture?.rgba) {
      const tiles = airshipSkinTiles(region, texture);
      const cellAspect = region.metres[0] / tiles / region.metres[1];
      const imageAspect = texture.width / texture.height;
      const crop =
        imageAspect > cellAspect
          ? [(1 - cellAspect / imageAspect) / 2, 0, (1 + cellAspect / imageAspect) / 2, 1]
          : [0, (1 - imageAspect / cellAspect) / 2, 1, (1 + imageAspect / cellAspect) / 2];
      /* Клетки — по куску без отступа: края куска тоже под текстурой. */
      for (let tile = 0; tile < tiles; tile += 1)
        drawPicture(out, width, height, texture, [x0 + ((x1 - x0) * tile) / tiles, y0, x0 + ((x1 - x0) * (tile + 1)) / tiles, y1], { crop, wrapX: Boolean(region.seamX) });
    }
    /* Лого — в рамку места, вписанным; из нескольких рамок — где оно крупнее. */
    if (airshipDecalReady(item) && decal?.rgba)
      for (const place of region.places) {
        const aspect = decal.width / decal.height;
        let best = null;
        for (const candidate of place.candidates) {
          const [bw, bh] = candidate.metres;
          const fw = aspect > bw / bh ? bw : bh * aspect;
          const fh = fw / aspect;
          if (!best || fw * fh > best.area) best = { area: fw * fh, candidate, share: [fw / bw, fh / bh] };
        }
        const k = item.decal.size / 100;
        const [u0, v0, u1, v1] = best.candidate.box;
        const [cu, cv] = [(u0 + u1) / 2, (v0 + v1) / 2];
        const [hu, hv] = [((u1 - u0) * best.share[0] * k) / 2, ((v1 - v0) * best.share[1] * k) / 2];
        const px = (u) => ix0 + u * (ix1 - ix0);
        const py = (v) => iy0 + v * (iy1 - iy0);
        drawPicture(out, width, height, decal, [px(cu - hu), py(cv - hv), px(cu + hu), py(cv + hv)], { flipX: place.flipX, flipY: place.flipY });
      }
  }
  return { rgba: out, width, height };
}

/** Где на листе стоит лого вида (для проверок): пиксельные середины мест `[[x, y] …]` при картинке `aspect`. */
export function airshipDecalCentres(kindId, aspect = 1) {
  const layout = airshipSkinLayout(kindId);
  if (!layout) return [];
  const out = [];
  for (const region of layout.regions) {
    const [ix0, iy0, ix1, iy1] = insetRect(kindId, region);
    for (const place of region.places) {
      let best = null;
      for (const candidate of place.candidates) {
        const [bw, bh] = candidate.metres;
        const fw = aspect > bw / bh ? bw : bh * aspect;
        if (!best || fw * (fw / aspect) > best.area) best = { area: fw * (fw / aspect), candidate };
      }
      const [u0, v0, u1, v1] = best.candidate.box;
      out.push([Math.round(ix0 + ((u0 + u1) / 2) * (ix1 - ix0)), Math.round(iy0 + ((v0 + v1) / 2) * (iy1 - iy0))]);
    }
  }
  return out;
}
