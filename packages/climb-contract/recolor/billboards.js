/*
 * «Билборды» — рекламные щиты всей карты (задача 4 ТЗ 10.10.2026, вечер):
 * на крышах домов, у дорог и шоссе, на стенах.
 *
 * Щит GTA V — плоское лицо в модели района с листом рекламы
 * (`inventory/billboards.js`, `scripts/prepare-billboards.mjs`): у лица своё
 * место на листе (`clip`) и три угла щита на листе (`map`). Вдали щит рисуют
 * дальние модели — у них тоже место на своём листе (`far`).
 *
 * Работа держит облик «Все щиты» (`all`) и, у щита, что правят по одному, —
 * свой (`boards[id].own`). Облик:
 *   standard — «Как в игре»: реклама Rockstar (можно тусклее или ярче);
 *   image    — своя картинка, подогнанная под пропорцию щита: «Заполнить»
 *              (лишнее обрежется поровну), «Вписать» (поля цветом фона),
 *              «Растянуть»;
 *   colour   — ровный цвет (пустой щит);
 *   gradient — градиент двух цветов.
 * И у каждого — яркость картинки и свечение ночью (у щитов, что светятся:
 * множитель шейдера `emissive*` модели).
 *
 * Бывает, что одно место листа рисует несколько щитов: одна модель стоит на
 * карте не раз, или словарь района делят две модели. Такие щиты связаны
 * (`linkedBillboards`): картинка у них одна — окно говорит это прямо, а
 * работа держит у связанных один облик.
 *
 * Картинка в лист — одна арифметика у кадра окна и установщика
 * (`billboardPicture`, `placeBillboardPicture`). Исходный облик — «Как в
 * игре»: ставить нечего, «Применить» снимает установку.
 *
 * Гифка на полотне (задача 6 ТЗ 17.10.2026, вечер): своя картинка может
 * быть гифкой (`image.animation` — лист кадров). Лицо щита запечено в
 * модель района, и клип развёртки двигал бы весь район, поэтому живая гифка
 * — плашка перед полотном (`billboardPlate`, `billboardLiveState`): своя
 * модель с клипом, на сантиметр впереди полотна, видна так же далеко, как
 * ближняя модель щита. Живых плашек на работу — не больше
 * `GIF_SURFACE_PROFILES.billboards.maxLive`; остальные щиты, а также вдали,
 * на общем листе и в «Всех щитах» показывают первый кадр на самом листе.
 *
 * Большие полотна (задача 3 ТЗ 17.10.2026): в описи не только щиты, но и
 * баннеры на фасадах, вертикальные полотна во всю высоту дома и рекламные
 * стены (`board.kind`). Своя картинка ложится на любое с кадрированием
 * («Заполнить» — масштаб и сдвиг: какая часть фото останется на узком
 * баннере), а поверх облика — свой рисунок (`look.drawing`): кисть, ластик,
 * заливка и текст. Рисунок в работе — шагами (`ops`), картинкой в игру его
 * делает окно (`billboardDrawingKey` — ключ этой картинки среди своих).
 */

import { billboardDrawingHas, billboardDrawingKey, emptyBillboardDrawing, normalizeBillboardDrawing } from "./billboard-drawing.js";
import { fitImagePixels } from "./building-images.js";
import { hexBytes, normalizeRecolourHex } from "./colour.js";
import { GIF_SURFACE_PROFILES, gifSurfaceBudget, gifSurfaceFrame } from "./gif-surface.js";
import BILLBOARD_PLATES from "./inventory/billboard-plates.js";
import BILLBOARDS_INVENTORY from "./inventory/billboards.js";
import { normalizePlaceModelAnimation, placeModelSurfaceRotation } from "./place-models.js";

export { BILLBOARDS_INVENTORY };
export * from "./billboard-drawing.js";

/*
 * Схема работы: 2 — «Все щиты» красят щиты, а не полотна зданий (ТЗ 24.10.2026, п. 4). Работа схемы 1 (всё, что
 * было сохранено или передано кодом до этого) красила и полотна, и при чтении (`normalizeBillboardsProject`)
 * она переписывается в схему 2 так, чтобы в игре осталось то же самое: облик «Всех щитов» становится общим обликом
 * полотен зданий (`bannersLook`, у кого своего ещё нет) — со всем, что у него было, и гифкой первым кадром. Следующее
 * «Применить» ничего не меняет молча. «Стандарт» снимает и его.
 */
export const BILLBOARDS_PROJECT_SCHEMA = 2;
const NAME_LIMIT = 60;

/* ------------------------------------------------------------------ *
 * Опись
 * ------------------------------------------------------------------ */

/*
 * Поправки описи (18.10.2026, «Баннеры на зданиях», Центральный банк). Баннер Flow
 * огибает угол банка одной сеткой на листе `s035`: прямые куски у стен — щиты описи
 * (`flw01_229_221` слева — доли 0…0,26 листа, `flw01_235_209` справа — 0,76…1), а
 * середина (0,26…0,76 — сам изгиб за угол, полвысоты кадра «бутылок») не принадлежала
 * никому: правка щита красила два столба, а между ними оставалась реклама игры — угол
 * выглядел сломанным. Поэтому изгиб делят пополам оба щита: у каждого — своя половина
 * баннера, как у соседнего `flw02` (там листы 0…0,5 и 0,5…1), и один щелчок выбирает ровно
 * свою грань. `size` остаётся прямым куском у стены (по нему стоит плашка гифки), а картинка
 * считается по `pictureSize` — прямой кусок плюс половина изгиба (≈ 12 м), по пропорции листа.
 */
const BOARD_FIXES = Object.freeze({
  hw1_02_flw01_229_221: Object.freeze({
    pictureSize: [12, 26.58],
    face: Object.freeze({ clip: [0.0013, 0.0457, 0.5, 0.9771], map: [[-0.002, 0.0457], [0.5, 0.0457], [0.0005, 0.9769]] }),
  }),
  hw1_02_flw01_235_209: Object.freeze({
    pictureSize: [12, 26.58],
    face: Object.freeze({ clip: [0.5, 0.0457, 0.9995, 0.9771], map: [[0.5, 0.0454], [1.0061, 0.0454], [0.4928, 0.9774]] }),
  }),
});

function withFix(board) {
  const fix = BOARD_FIXES[board.id];
  if (!fix) return board;
  const [first, ...rest] = board.faces;
  return { ...board, pictureSize: fix.pictureSize, faces: [{ ...first, ...fix.face }, ...rest] };
}

export const BILLBOARD_LIST = Object.freeze(BILLBOARDS_INVENTORY.boards.map((board) => Object.freeze(withFix(board))));
export const BILLBOARD_IDS = Object.freeze(BILLBOARD_LIST.map((board) => board.id));
const boardById = new Map(BILLBOARD_LIST.map((board) => [board.id, board]));
const sheetById = new Map(BILLBOARDS_INVENTORY.sheets.map((sheet) => [sheet.id, sheet]));

/** Щит описи или `null`. */
export const billboard = (id) => boardById.get(id) || null;
/** Лист описи или `null`. */
export const billboardSheet = (id) => sheetById.get(id) || null;

/** Районы по порядку описи: `[{ district, ids }]`. */
export const BILLBOARD_DISTRICTS = Object.freeze(
  [...BILLBOARD_LIST.reduce((map, board) => map.set(board.district, [...(map.get(board.district) || []), board.id]), new Map())].map(([district, ids]) =>
    Object.freeze({ district, ids: Object.freeze(ids) }),
  ),
);

/** Щиты, что светятся ночью (шейдеры `emissive*`). */
export const BILLBOARD_GLOWING = Object.freeze(BILLBOARD_LIST.filter((board) => board.glow).map((board) => board.id));

/*
 * Вид полотна (опись, `kind`): щит у дороги или на стене, щит на крыше,
 * баннер (ткань, наклейка, плакат), вертикальное полотно, полотно во всю
 * стену дома.
 */
export const BILLBOARD_KINDS = Object.freeze(["board", "roof", "banner", "vertical", "giant"]);
export const BILLBOARD_KIND_LABELS = Object.freeze({
  board: "Щиты",
  roof: "Щиты на крышах",
  banner: "Баннеры и плакаты",
  vertical: "Вертикальные полотна",
  giant: "Полотна во всю стену",
});
/** Вид полотна (у старой описи без вида — щит). */
export const billboardKind = (board) => (BILLBOARD_KINDS.includes(board?.kind) ? board.kind : "board");
/** Полотна вида: `[id, …]`. */
export const billboardsOfKind = (kind) => BILLBOARD_IDS.filter((id) => billboardKind(billboard(id)) === kind);

/*
 * Щиты и большие полотна (ТЗ 24.10.2026, п. 4): «Билборды» — только обычные щиты у дорог, на стенах и на крышах;
 * баннеры на фасадах, вертикальные полотна и полотна во всю стену правятся в «Баннерах на зданиях». Опись, работа и
 * установка у них одни (один лист игры — одна картинка), делится только то, где их правят: щит — в «Билбордах»,
 * полотно — в «Баннерах».
 */
export const BILLBOARD_SHIELD_KINDS = Object.freeze(["board", "roof"]);
export const BILLBOARD_CANVAS_KINDS = Object.freeze(["banner", "vertical", "giant"]);
/** Большое полотно здания (баннер, вертикальное, во всю стену), а не обычный щит. */
export const billboardIsCanvas = (board) => BILLBOARD_CANVAS_KINDS.includes(billboardKind(board));
/** Обычный щит: его правят в «Билбордах». */
export const billboardIsShield = (board) => Boolean(board) && !billboardIsCanvas(board);
export const BILLBOARD_SHIELD_IDS = Object.freeze(BILLBOARD_IDS.filter((id) => billboardIsShield(boardById.get(id))));
export const BILLBOARD_CANVAS_IDS = Object.freeze(BILLBOARD_IDS.filter((id) => billboardIsCanvas(boardById.get(id))));

const SIDES = Object.freeze(["север", "северо-восток", "восток", "юго-восток", "юг", "юго-запад", "запад", "северо-запад"]);
/** Куда смотрит щит: «на юг». */
export const billboardDirection = (board) => SIDES[Math.round((Number(board?.facing) || 0) / 45) % 8];

/* ------------------------------------------------------------------ *
 * Связанные щиты: одно место листа — одна картинка
 * ------------------------------------------------------------------ */

const overlaps = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1e-4 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1e-4;

function buildLinks() {
  const parent = new Map(BILLBOARD_IDS.map((id) => [id, id]));
  const find = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  /* Вблизи: лица на одном листе с пересекающимися местами. Лица разных
     моделей на листе словаря района, которым можно дать свою копию словаря
     (`split`), не связаны: их разводит установщик. Дальние листы не
     связывают: там щит — несколько пикселей, сторона щита — своя. */
  const bySheet = new Map();
  for (const board of BILLBOARD_LIST)
    for (const face of board.faces) {
      const list = bySheet.get(face.sheet) || [];
      for (const other of list) {
        if (other.id === board.id || !overlaps(other.clip, face.clip)) continue;
        if (other.split && face.split && other.arch !== face.arch) continue;
        parent.set(find(board.id), find(other.id));
      }
      list.push({ id: board.id, clip: face.clip, arch: face.arch, split: Boolean(face.split) });
      bySheet.set(face.sheet, list);
    }
  const groups = new Map();
  for (const id of BILLBOARD_IDS) {
    const key = find(id);
    groups.set(key, [...(groups.get(key) || []), id]);
  }
  return new Map(BILLBOARD_IDS.map((id) => [id, Object.freeze(groups.get(find(id)))]));
}
const LINKS = buildLinks();

/** Щиты с той же картинкой (сам щит — первым по описи): `[id, …]`. */
export const linkedBillboards = (id) => LINKS.get(id) || Object.freeze([id]);

/** Имя своей копии словаря района для модели щита (по хешу архетипа). */
export const billboardCopyName = (arch) => `astral_bb_${(Number(arch) >>> 0).toString(16).padStart(8, "0")}`;

/**
 * Щиты, что делят место листа словаря района с другими моделями, но
 * правятся по одному: установщик даёт их модели свою копию словаря.
 */
export const billboardSplits = (id) => (billboard(id)?.faces || []).some((face) => face.split);

/* ------------------------------------------------------------------ *
 * Облик щита
 * ------------------------------------------------------------------ */

export const BILLBOARD_MODES = Object.freeze(["standard", "image", "colour", "gradient"]);
export const BILLBOARD_MODE_LABELS = Object.freeze({ standard: "Как в игре", image: "Своя картинка", colour: "Ровный цвет", gradient: "Градиент" });
export const BILLBOARD_FITS = Object.freeze(["cover", "contain", "stretch"]);
export const BILLBOARD_FIT_LABELS = Object.freeze({ cover: "Заполнить", contain: "Вписать", stretch: "Растянуть" });
export const BILLBOARD_DIRECTIONS = Object.freeze(["right", "down"]);
/* Яркость картинки, % (100 — как есть) и свечение ночью, % множителя игры. */
export const BILLBOARD_BRIGHTNESS = Object.freeze({ min: 40, max: 160, standard: 100 });
export const BILLBOARD_GLOW = Object.freeze({ min: 0, max: 300, standard: 100 });
/*
 * Кадрирование своей картинки при «Заполнить»: масштаб (%, 100 — картинка
 * целиком по меньшей стороне) и сдвиг окна по ширине и высоте (−100 — к
 * левому или верхнему краю картинки, 100 — к правому или нижнему).
 */
export const BILLBOARD_ZOOM = Object.freeze({ min: 100, max: 400, standard: 100 });
export const BILLBOARD_PAN = Object.freeze({ min: -100, max: 100, standard: 0 });

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const choice = (value, list, fallback) => (list.includes(value) ? value : fallback);
const clampInt = (value, { min, max, standard }) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(max, Math.max(min, number))) : standard;
};

/*
 * Своя картинка щита. Гифка: `asset` — лист кадров, `width`/`height` — размер
 * кадра, `animation` — сетка и задержки (`normalizePlaceModelAnimation`).
 */
function normalizeImage(input) {
  const source = plain(input);
  const asset = typeof source.asset === "string" && source.asset.length <= 200 ? source.asset : "";
  const animation = asset ? normalizePlaceModelAnimation(source.animation) : null;
  return {
    asset,
    name: asset ? String(source.name ?? "").slice(0, 120) : "",
    width: asset ? Math.max(0, Math.round(Number(source.width) || 0)) : 0,
    height: asset ? Math.max(0, Math.round(Number(source.height) || 0)) : 0,
    ...(animation ? { animation } : {}),
  };
}

/** Облик щита (или «Всех щитов»). */
export function normalizeBillboardLook(input) {
  const source = plain(input);
  return {
    mode: choice(source.mode, BILLBOARD_MODES, "standard"),
    image: normalizeImage(source.image),
    fit: choice(source.fit, BILLBOARD_FITS, "cover"),
    background: normalizeRecolourHex(source.background, "#101114"),
    colour: normalizeRecolourHex(source.colour, "#f4f2ec"),
    colour2: normalizeRecolourHex(source.colour2, "#2f80ed"),
    direction: choice(source.direction, BILLBOARD_DIRECTIONS, "right"),
    brightness: clampInt(source.brightness, BILLBOARD_BRIGHTNESS),
    glow: clampInt(source.glow, BILLBOARD_GLOW),
    zoom: clampInt(source.zoom, BILLBOARD_ZOOM),
    panX: clampInt(source.panX, BILLBOARD_PAN),
    panY: clampInt(source.panY, BILLBOARD_PAN),
    drawing: normalizeBillboardDrawing(source.drawing),
  };
}

/* Облик, который ничего не меняет: «Как в игре», яркость и свечение — как есть, рисунка нет.
   Своя картинка без картинки — тоже «как в игре»: ставить нечего. */
export const billboardLookIsStock = (look) =>
  (look.mode === "standard" || (look.mode === "image" && !look.image.asset)) &&
  look.brightness === BILLBOARD_BRIGHTNESS.standard &&
  look.glow === BILLBOARD_GLOW.standard &&
  !billboardDrawingHas(look.drawing);

/** Облик меняет пиксели листа (а не только свечение модели). */
export const billboardLookPaints = (look) =>
  look.mode === "colour" ||
  look.mode === "gradient" ||
  (look.mode === "image" && Boolean(look.image.asset)) ||
  look.brightness !== BILLBOARD_BRIGHTNESS.standard ||
  billboardDrawingHas(look.drawing);

/* Кадрирование «Заполнить» не штатное (масштаб или сдвиг). */
const cropped = (look) => look.zoom !== BILLBOARD_ZOOM.standard || look.panX !== BILLBOARD_PAN.standard || look.panY !== BILLBOARD_PAN.standard;

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

/*
 * «Все щиты» ложатся на щиты, а не на полотна зданий (ТЗ 24.10.2026, п. 4): баннер правят в «Баннерах на зданиях», и
 * общий облик карты его не красит. Исключение — полотно, что делит место листа со щитом (`linkedBillboards`): у них в
 * игре одна картинка, и общий облик держит её целиком, а не наполовину.
 */
let inheritsAll = null;
function inherits(id) {
  if (!inheritsAll) {
    inheritsAll = new Map(
      BILLBOARD_IDS.map((member) => [
        member,
        billboardIsShield(boardById.get(member)) || linkedBillboards(member).some((other) => billboardIsShield(boardById.get(other))),
      ]),
    );
  }
  return inheritsAll.get(id) ?? true;
}
const STOCK_LOOK = Object.freeze(normalizeBillboardLook({}));

export function normalizeBillboardsProject(input) {
  const source = plain(input);
  const boards = plain(source.boards);
  const own = {};
  for (const id of BILLBOARD_IDS) {
    const item = plain(boards[id]);
    if (item.own === true) own[id] = { own: true, ...normalizeBillboardLook(item) };
  }
  /* Схема 1: «Все щиты» красили и полотна зданий — теперь тот же облик стоит общим у полотен (`bannersLook`). Работа без
     схемы (собрана кодом, а не прочитана из сохранённого) — уже по новым правилам. */
  const all = normalizeBillboardLook(source.all);
  const banners = source.bannersLook ? normalizeBillboardLook(source.bannersLook) : source.schema === 1 ? all : null;
  /* Связанные щиты — один облик: у группы берётся облик первого своего по описи. */
  for (const id of BILLBOARD_IDS) {
    const group = linkedBillboards(id);
    if (group.length < 2) continue;
    const leader = group.find((member) => own[member]);
    if (!leader) continue;
    for (const member of group) own[member] = own[leader];
  }
  return {
    schema: BILLBOARDS_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    all,
    ...(banners && !billboardLookIsStock(banners) ? { bannersLook: banners } : {}),
    boards: Object.fromEntries(BILLBOARD_IDS.filter((id) => own[id]).map((id) => [id, own[id]])),
  };
}

export const createBillboardsProject = () => normalizeBillboardsProject({});
export const serializeBillboardsProject = (project) => JSON.stringify(normalizeBillboardsProject(project));

export function parseBillboardsProject(text) {
  try {
    return normalizeBillboardsProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createBillboardsProject();
  }
}

/** Облик щита в игре: свой, если заведён, иначе — «Все щиты»; у полотна здания — общий облик полотен (`bannersLook`) или как в игре. */
export function billboardLookOf(project, id) {
  const own = project.boards?.[id];
  if (own?.own) {
    const { own: _own, ...look } = own;
    return look;
  }
  return inherits(id) ? project.all : project.bannersLook || STOCK_LOOK;
}

/** Щит правится по одному (свой облик). */
export const billboardIsOwn = (project, id) => Boolean(project.boards?.[id]?.own);

/* ------------------------------------------------------------------ *
 * Гифка: живая плашка перед полотном
 * ------------------------------------------------------------------ */

/** Облик — гифка: своя картинка с кадрами. */
export const billboardLookIsGif = (look) => look?.mode === "image" && Boolean(look.image?.asset) && Boolean(look.image?.animation);

/* Плашка встаёт перед полотном на столько, м: меньше — мерцает на грани, больше — видно щель сбоку. */
export const BILLBOARD_PLATE_OFFSET = 0.01;
/*
 * Какое полотно держит плашку: вершины лиц выступают над плоскостью полотна
 * не больше чем на 5 мм (плашка в сантиметре от неё закрывает всё полотно) и
 * западают не глубже 30 мм (иначе плашка парит над впадиной); сторона — не
 * больше 40 м (предел модели мест).
 */
export const BILLBOARD_PLATE_LIMITS = Object.freeze({ protrusion: 5, recess: 30, side: 40 });

/**
 * Точная геометрия полотна для плашки или `null` (полотна нет в описи плашек):
 * `{ centre, normal, width, height, protrusion, recess, distance, even }` —
 * середина и нормаль точно (м, мир), размер (м), выступ и западание вершин
 * (мм), дальность ближней модели (м) и годится ли полотно под плашку (`even`).
 */
export function billboardPlate(id) {
  const raw = BILLBOARD_PLATES[id];
  if (!raw) return null;
  const [x, y, z, nx, ny, nz, width, height, protrusion, recess, distance] = raw;
  const long = Math.max(width, height);
  return {
    centre: [x, y, z],
    normal: [nx, ny, nz],
    width,
    height,
    protrusion,
    recess,
    distance,
    even: protrusion <= BILLBOARD_PLATE_LIMITS.protrusion && recess <= BILLBOARD_PLATE_LIMITS.recess && long >= 0.1 && long <= BILLBOARD_PLATE_LIMITS.side,
  };
}

/** Середина плашки: середина полотна, сдвинутая по нормали на `BILLBOARD_PLATE_OFFSET`. */
export const billboardPlateCentre = (plate) => plate.centre.map((value, axis) => Math.round((value + plate.normal[axis] * BILLBOARD_PLATE_OFFSET) * 10000) / 10000);

/** Поворот плашки «Z·Y·X» (градусы): лицо — по нормали полотна, верх — к небу; углы — до сотых. */
export const billboardPlateRotation = (plate) => placeModelSurfaceRotation(plate.normal, 0, { exact: true });

/*
 * Кто из щитов с гифкой живой. Гифка «Всех щитов» живой не бывает (сотни
 * плашек), живые — щиты с отдельным видом (`own`), по порядку описи, пока
 * хватает предела плашек и веса (`gifSurfaceBudget`); полотну, что не годится
 * под плашку (`even`), живой не быть. Ответ: `{ states: Map(id → состояние),
 * live: [id], limit, bytes }`; состояние — `"live"`, `"limit"` (предел
 * плашек), `"weight"` (вес), `"uneven"` (полотно неровное или его нет в
 * описи плашек) или `"shared"` («Все щиты»): кроме `"live"`, гифка лежит на
 * листе первым кадром.
 */
export function billboardLiveState(input) {
  /* Работа в окне неизменна (каждая правка — новый объект): ответ помнится по объекту — списки на сотни щитов спрашивают его на каждую строку. */
  const keep = input && typeof input === "object";
  if (keep && LIVE_STATES.has(input)) return LIVE_STATES.get(input);
  const project = normalizeBillboardsProject(input);
  const states = new Map();
  const candidates = [];
  for (const id of BILLBOARD_IDS) {
    const look = billboardLookOf(project, id);
    if (!billboardLookIsGif(look)) continue;
    if (!billboardIsOwn(project, id)) states.set(id, "shared");
    else if (!billboardPlate(id)?.even) states.set(id, "uneven");
    else candidates.push({ key: id });
  }
  const budget = gifSurfaceBudget("billboards", candidates);
  for (const id of budget.live) states.set(id, "live");
  for (const { key, reason } of budget.still) states.set(key, reason);
  const state = { states, live: budget.live, limit: GIF_SURFACE_PROFILES.billboards.maxLive, bytes: budget.bytes };
  if (keep) LIVE_STATES.set(input, state);
  return state;
}
const LIVE_STATES = new WeakMap();

/** Состояние гифки щита (`billboardLiveState`) или `null` — у щита не гифка. */
export const billboardGifState = (input, id) => billboardLiveState(input).states.get(id) || null;

/*
 * Один облик — на группу полотен (выбранные в «Где стоят», район, вид):
 * у каждого и у связанных с ним — свой облик `look`. Рисунок и картинка
 * подгоняются под пропорцию каждого полотна сами.
 */
export function applyBillboardLook(input, ids, look) {
  const project = normalizeBillboardsProject(input);
  const own = { ...normalizeBillboardLook(look), own: true };
  const boards = { ...project.boards };
  for (const id of ids) if (boardById.has(id)) for (const member of linkedBillboards(id)) boards[member] = own;
  return normalizeBillboardsProject({ ...project, boards });
}

/** Группа полотен — снова «как у всех» (свои облики сняты, у связанных тоже). */
export function clearBillboardLooks(input, ids) {
  const project = normalizeBillboardsProject(input);
  const boards = { ...project.boards };
  for (const id of ids) for (const member of linkedBillboards(id)) delete boards[member];
  return normalizeBillboardsProject({ ...project, boards });
}

/** Щиты, чей облик уходит в игру. */
export function changedBillboards(input) {
  const project = normalizeBillboardsProject(input);
  return BILLBOARD_IDS.filter((id) => !billboardLookIsStock(billboardLookOf(project, id)));
}

/** Все щиты как в игре: ставить нечего. */
export const billboardsProjectIsStock = (input) => changedBillboards(input).length === 0;

/* Что из облика меняет файлы. */
function lookSignature(look) {
  if (billboardLookIsStock(look)) return null;
  const drawing = billboardDrawingKey(look.drawing);
  /* Рисунок подгоняется под полотно так же, как своя картинка (`fit`). */
  const tone = { brightness: look.brightness, glow: look.glow, ...(drawing ? { drawing, drawingFit: look.fit } : {}) };
  if (look.mode === "image" && look.image.asset)
    return {
      mode: "image",
      asset: look.image.asset,
      ...(look.image.animation ? { gif: look.image.animation.frames } : {}),
      fit: look.fit,
      ...(look.fit === "contain" ? { background: look.background } : {}),
      ...(look.fit === "cover" && cropped(look) ? { zoom: look.zoom, panX: look.panX, panY: look.panY } : {}),
      ...tone,
    };
  if (look.mode === "colour") return { mode: "colour", colour: look.colour, ...tone };
  if (look.mode === "gradient") return { mode: "gradient", colour: look.colour, colour2: look.colour2, direction: look.direction, ...tone };
  return { mode: "standard", ...tone };
}

/** Что щит покажет на листе — строкой: те же пиксели — та же строка (лист как в игре — `"stock"`). */
export function billboardPaintKey(look) {
  if (!billboardLookPaints(look)) return "stock";
  const { glow: _glow, ...paint } = lookSignature(look);
  return JSON.stringify(paint);
}

/** Отпечаток для очереди «Применить»: тот же облик щитов — тот же отпечаток. */
export function billboardsProjectSignature(input) {
  const project = normalizeBillboardsProject(input);
  const live = billboardLiveState(project).live;
  return JSON.stringify({
    all: lookSignature(project.all),
    ...(project.bannersLook ? { banners: lookSignature(project.bannersLook) } : {}),
    own: Object.fromEntries(Object.keys(project.boards).map((id) => [id, lookSignature(billboardLookOf(project, id))])),
    /* Какие щиты ставят плашку гифки: порядок описи меняет набор — меняется и установка. */
    ...(live.length ? { live } : {}),
  });
}

/** «Стандарт»: все щиты как в игре; картинки и цвета помнятся. */
export function applyBillboardsStandard(input) {
  const project = normalizeBillboardsProject(input);
  const { bannersLook: _banners, ...rest } = project;
  return { ...rest, all: { ...project.all, mode: "standard", brightness: BILLBOARD_BRIGHTNESS.standard, glow: BILLBOARD_GLOW.standard }, boards: {} };
}

export const resetBillboardsProject = (input) => ({ ...createBillboardsProject(), name: normalizeBillboardsProject(input).name });

/*
 * Картинки человека в код не едут: щит со своей картинкой становится «Как в
 * игре». Рисунок — тоже: код для друга короткий, а рисунок — тысячи точек.
 */
export function shareableBillboardsProject(input) {
  const project = normalizeBillboardsProject(input);
  const strip = (look) => {
    const bare = { ...look, drawing: emptyBillboardDrawing() };
    return look.mode === "image" ? { ...bare, mode: "standard", image: { asset: "", name: "", width: 0, height: 0 } } : bare;
  };
  return {
    ...project,
    all: strip(project.all),
    ...(project.bannersLook ? { bannersLook: strip(project.bannersLook) } : {}),
    boards: Object.fromEntries(Object.entries(project.boards).map(([id, look]) => [id, strip(look)])),
  };
}

export function billboardsLostInCode(input) {
  const project = normalizeBillboardsProject(input);
  const looks = [project.all, ...(project.bannersLook ? [project.bannersLook] : []), ...Object.values(project.boards)];
  const images = looks.some((look) => look.mode === "image" && look.image.asset);
  const drawings = looks.some((look) => billboardDrawingHas(look.drawing));
  if (images && drawings) return "свои картинки и рисунки (остаются на этом компьютере)";
  if (images) return "свои картинки (остаются на этом компьютере)";
  return drawings ? "рисунки на щитах (остаются на этом компьютере)" : "";
}

/**
 * Свои картинки работы, которые нужны установщику (`Map` ключ → имя): у
 * щитов, что уходят в игру, — загруженные картинки и рисунки (ключ рисунка —
 * `billboardDrawingKey`, картинку ему делает окно).
 */
export function billboardsImageAssets(input) {
  const project = normalizeBillboardsProject(input);
  const out = new Map();
  for (const id of changedBillboards(project)) {
    const look = billboardLookOf(project, id);
    if (look.mode === "image" && look.image.asset && !out.has(look.image.asset)) out.set(look.image.asset, look.image.name || "Своя картинка");
    const drawing = billboardDrawingKey(look.drawing);
    if (drawing && !out.has(drawing)) out.set(drawing, "Рисунок на щите");
  }
  return out;
}

/** Рисунки щитов, что уходят в игру: `Map` ключ картинки → рисунок. */
export function billboardsDrawings(input) {
  const project = normalizeBillboardsProject(input);
  const out = new Map();
  for (const id of changedBillboards(project)) {
    const look = billboardLookOf(project, id);
    const key = billboardDrawingKey(look.drawing);
    if (key && !out.has(key)) out.set(key, look.drawing);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Готовые наборы (без картинок Rockstar)
 * ------------------------------------------------------------------ */

/*
 * Готовые наборы — что на щитах, без яркости и свечения (слово владельца 30.10.2026, `design-qa.md`, п. 11: ползунков нет, и
 * набор не ставит то, что человек не видит и не вернёт; «Ночной город» и «Выцветшие» были только яркостью и свечением — их нет).
 */
export const BILLBOARDS_PRESETS = Object.freeze(
  [
    { id: "game", label: "Как в игре", description: "Реклама Rockstar на всех щитах", all: {} },
    {
      id: "logo",
      label: "Свой логотип",
      description: "Ваша картинка целиком, по центру на тёмном — на каждом щите карты",
      all: { mode: "image", fit: "contain", background: "#0e0f12" },
    },
    { id: "photo", label: "Одна картинка", description: "Ваша картинка на весь щит: лишнее по краям обрежется поровну", all: { mode: "image", fit: "cover" } },
    { id: "dark", label: "Тёмные щиты", description: "Ровный чёрный без рекламы", all: { mode: "colour", colour: "#121317" } },
    { id: "clean", label: "Город без рекламы", description: "Пустые светлые щиты", all: { mode: "colour", colour: "#e9e5dc" } },
    { id: "neon", label: "Неон", description: "Розовый в бирюзу во весь щит", all: { mode: "gradient", colour: "#ff2bd6", colour2: "#22d3ee", direction: "right" } },
  ].map((item) => Object.freeze(item)),
);

/** Работа с готовым набором: облик всех щитов, свои облики щитов сняты; своя картинка помнится. */
export function applyBillboardsPreset(input, presetId) {
  const project = normalizeBillboardsProject(input);
  const preset = BILLBOARDS_PRESETS.find((item) => item.id === presetId);
  if (!preset) return project;
  const all = normalizeBillboardLook({
    ...project.all,
    mode: "standard",
    fit: "cover",
    background: "#101114",
    brightness: BILLBOARD_BRIGHTNESS.standard,
    glow: BILLBOARD_GLOW.standard,
    ...preset.all,
  });
  return { ...project, all, boards: {} };
}

/** Готовый набор, с которым совпадает работа, или `null`. */
export function matchingBillboardsPreset(input) {
  const project = normalizeBillboardsProject(input);
  if (Object.keys(project.boards).length) return null;
  const current = JSON.stringify(presetShape(project.all));
  return BILLBOARDS_PRESETS.find((preset) => JSON.stringify(presetShape(applyBillboardsPreset(project, preset.id).all)) === current)?.id || null;
}

/* Сравнение с набором: без самой картинки, её кадрирования и рисунка (у набора их нет). */
function presetShape(look) {
  const { image: _image, drawing: _drawing, zoom: _zoom, panX: _panX, panY: _panY, ...rest } = look;
  if (rest.mode !== "image") {
    delete rest.fit;
    delete rest.background;
  } else if (rest.fit !== "contain") delete rest.background;
  if (rest.mode !== "colour" && rest.mode !== "gradient") delete rest.colour;
  if (rest.mode !== "gradient") {
    delete rest.colour2;
    delete rest.direction;
  }
  return rest;
}

/* ------------------------------------------------------------------ *
 * Картинка щита и лист — одна арифметика у кадра и установщика
 * ------------------------------------------------------------------ */

/** Пропорция щита в метрах (ширина к высоте); у щита с изгибом (`pictureSize`) — картинки, а не прямого куска. */
export const billboardAspect = (board) => {
  const size = board?.pictureSize || board?.size;
  return Math.max(0.05, Number(size?.[0]) || 1) / Math.max(0.05, Number(size?.[1]) || 1);
};

/*
 * Сколько пикселей занимает щит на листе: по краям рамки щита на листе
 * (`map`). `sheetWidth`/`sheetHeight` — размер того листа, куда кладём.
 */
export function billboardPixels(entry, sheetWidth, sheetHeight) {
  const [a, b, c] = entry.map;
  return [
    Math.max(1, Math.round(Math.hypot((b[0] - a[0]) * sheetWidth, (b[1] - a[1]) * sheetHeight))),
    Math.max(1, Math.round(Math.hypot((c[0] - a[0]) * sheetWidth, (c[1] - a[1]) * sheetHeight))),
  ];
}

/** Рекомендуемый размер своей картинки: щит на самом крупном листе (копия высокой чёткости). */
export function billboardRecommendedPixels(board) {
  let best = [0, 0];
  for (const face of board?.faces || []) {
    const sheet = billboardSheet(face.sheet);
    if (!sheet) continue;
    const size = billboardPixels(face, sheet.hd?.width || sheet.width, sheet.hd?.height || sheet.height);
    if (size[0] * size[1] > best[0] * best[1]) best = size;
  }
  if (!best[0]) {
    const aspect = billboardAspect(board);
    best = aspect >= 1 ? [1024, Math.round(1024 / aspect)] : [Math.round(1024 * aspect), 1024];
  }
  /* Своя картинка крупнее листа не станет чётче в игре, но и мельче — мягче. */
  const scale = Math.min(1, 2048 / Math.max(best[0], best[1]));
  return [Math.max(1, Math.round(best[0] * scale)), Math.max(1, Math.round(best[1] * scale))];
}

const clampByte = (value) => (value < 0 ? 0 : value > 255 ? 255 : value);

/*
 * Окно картинки, что ляжет на полотно при «Заполнить» с кадрированием:
 * `[x0, y0, x1, y1]` в долях картинки. Без масштаба и сдвига — середина
 * картинки по пропорции полотна (как у `fitImagePixels`).
 */
export function billboardCropWindow(look, imageAspect, targetAspect) {
  let [w, h] = imageAspect > targetAspect ? [targetAspect / imageAspect, 1] : [1, imageAspect / targetAspect];
  const zoom = (Number(look?.zoom) || BILLBOARD_ZOOM.standard) / 100;
  w /= zoom;
  h /= zoom;
  const cx = 0.5 + ((Number(look?.panX) || 0) / 100) * ((1 - w) / 2);
  const cy = 0.5 + ((Number(look?.panY) || 0) / 100) * ((1 - h) / 2);
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

/* Кусок картинки по окну (доли) — целыми пикселями, не меньше пикселя. */
function cropImage(image, [x0, y0, x1, y1]) {
  const left = Math.max(0, Math.min(image.width - 1, Math.round(x0 * image.width)));
  const top = Math.max(0, Math.min(image.height - 1, Math.round(y0 * image.height)));
  const width = Math.max(1, Math.min(image.width - left, Math.round((x1 - x0) * image.width)));
  const height = Math.max(1, Math.min(image.height - top, Math.round((y1 - y0) * image.height)));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) rgba.set(image.rgba.subarray(((top + y) * image.width + left) * 4, ((top + y) * image.width + left + width) * 4), y * width * 4);
  return { rgba, width, height };
}

/* Выборка с прозрачностью (premultiplied): среднее по клетке источника или билинейно. */
function sampleOverlay(image, u, v, stepU, stepV, out) {
  const fx = u * image.width - 0.5;
  const fy = v * image.height - 0.5;
  const reachX = Math.max(0, Math.floor((stepU * image.width) / 2));
  const reachY = Math.max(0, Math.floor((stepV * image.height) / 2));
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let weights = 0;
  const take = (x, y, weight) => {
    const at = (Math.min(image.height - 1, Math.max(0, y)) * image.width + Math.min(image.width - 1, Math.max(0, x))) * 4;
    const alpha = image.rgba[at + 3] * weight;
    r += image.rgba[at] * alpha;
    g += image.rgba[at + 1] * alpha;
    b += image.rgba[at + 2] * alpha;
    a += alpha;
    weights += weight;
  };
  if (reachX > 0 || reachY > 0) {
    const cx = Math.round(fx);
    const cy = Math.round(fy);
    for (let y = cy - reachY; y <= cy + reachY; y += 1) for (let x = cx - reachX; x <= cx + reachX; x += 1) take(x, y, 1);
  } else {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const wx = fx - x0;
    const wy = fy - y0;
    take(x0, y0, (1 - wx) * (1 - wy));
    take(x0 + 1, y0, wx * (1 - wy));
    take(x0, y0 + 1, (1 - wx) * wy);
    take(x0 + 1, y0 + 1, wx * wy);
  }
  out[3] = weights ? a / weights : 0;
  out[0] = a ? r / a : 0;
  out[1] = a ? g / a : 0;
  out[2] = a ? b / a : 0;
  return out;
}

/*
 * Рисунок (RGBA с прозрачностью) на полотне `width × height` — так же, как
 * своя картинка (`fit`), но поля прозрачны: под ними облик щита. Холст
 * рисунка в пропорции этого полотна ложится как есть.
 */
export function fitBillboardOverlay(image, width, height, { fit = "cover", aspect = null } = {}) {
  const out = new Uint8ClampedArray(width * height * 4);
  const target = aspect > 0 ? aspect : width / height;
  const own = image.width / Math.max(1, image.height);
  let src = [0, 0, 1, 1];
  let dst = [0, 0, 1, 1];
  if (Math.abs(own / target - 1) > 0.01 && fit === "cover") src = billboardCropWindow({ zoom: 100, panX: 0, panY: 0 }, own, target);
  else if (Math.abs(own / target - 1) > 0.01 && fit === "contain") {
    if (own > target) {
      const share = target / own;
      dst = [0, (1 - share) / 2, 1, (1 + share) / 2];
    } else {
      const share = own / target;
      dst = [(1 - share) / 2, 0, (1 + share) / 2, 1];
    }
  }
  const stepU = (src[2] - src[0]) / Math.max(1, (dst[2] - dst[0]) * width);
  const stepV = (src[3] - src[1]) / Math.max(1, (dst[3] - dst[1]) * height);
  const colour = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const s = (x + 0.5) / width;
      const t = (y + 0.5) / height;
      if (s < dst[0] || s > dst[2] || t < dst[1] || t > dst[3]) continue;
      const u = src[0] + ((s - dst[0]) / (dst[2] - dst[0])) * (src[2] - src[0]);
      const v = src[1] + ((t - dst[1]) / (dst[3] - dst[1])) * (src[3] - src[1]);
      sampleOverlay(image, u, v, stepU, stepV, colour);
      const at = (y * width + x) * 4;
      out[at] = colour[0];
      out[at + 1] = colour[1];
      out[at + 2] = colour[2];
      out[at + 3] = colour[3];
    }
  return out;
}

/*
 * Картинка щита `width × height` (RGBA): облик щита и своя картинка
 * (`{ rgba, width, height }`) → пиксели. `aspect` — пропорция щита в метрах:
 * лист растянется на щит по ней, и «Заполнить» и «Вписать» не искажают
 * картинку. У «Как в игре» картинки нет — `null` (лист остаётся, меняется
 * только яркость: `shadeBillboardRegion`).
 *
 * `drawing` — картинка рисунка облика (с прозрачностью): ложится поверх.
 * У «Как в игре» с рисунком ответ — один рисунок с прозрачностью
 * (`overlay: true`): его кладут поверх рекламы игры.
 *
 * Гифка (`look.image.animation`): `image` — лист кадров, берётся кадр
 * `frame` (на листе щита и вдали — первый).
 */
export function billboardPicture(look, image, width, height, aspect, drawing = null, frame = 0) {
  const overlay = drawing && billboardDrawingHas(look.drawing) ? fitBillboardOverlay(drawing, width, height, { fit: look.fit, aspect }) : null;
  let rgba = null;
  if (look.mode === "image" && image) {
    const crop = look.fit === "cover" && cropped(look);
    const target = aspect > 0 ? aspect : width / height;
    const still = look.image?.animation ? gifSurfaceFrame(image, look.image.animation, frame) : image;
    rgba = crop
      ? fitImagePixels(cropImage(still, billboardCropWindow(look, still.width / Math.max(1, still.height), target)), width, height, { fit: "stretch", aspect })
      : fitImagePixels(still, width, height, { fit: look.fit, background: look.background, aspect });
  } else if (look.mode === "image" || look.mode === "standard") {
    return overlay ? { rgba: overlay, width, height, overlay: true } : null;
  } else if (look.mode === "colour") {
    rgba = new Uint8ClampedArray(width * height * 4);
    const [r, g, b] = hexBytes(look.colour);
    for (let at = 0; at < rgba.length; at += 4) {
      rgba[at] = r;
      rgba[at + 1] = g;
      rgba[at + 2] = b;
      rgba[at + 3] = 255;
    }
  } else if (look.mode === "gradient") {
    rgba = new Uint8ClampedArray(width * height * 4);
    const from = hexBytes(look.colour);
    const to = hexBytes(look.colour2);
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const t = look.direction === "down" ? (y + 0.5) / height : (x + 0.5) / width;
        const at = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) rgba[at + channel] = from[channel] + (to[channel] - from[channel]) * t;
        rgba[at + 3] = 255;
      }
  } else return null;
  const factor = look.brightness / 100;
  if (factor !== 1) for (let at = 0; at < rgba.length; at += 4) for (let channel = 0; channel < 3; channel += 1) rgba[at + channel] = clampByte(rgba[at + channel] * factor);
  /* Рисунок — поверх, своей прозрачностью (яркость облика его не трогает). */
  if (overlay)
    for (let at = 0; at < rgba.length; at += 4) {
      const alpha = overlay[at + 3] / 255;
      if (!alpha) continue;
      for (let channel = 0; channel < 3; channel += 1) rgba[at + channel] = rgba[at + channel] * (1 - alpha) + overlay[at + channel] * alpha;
    }
  return { rgba, width, height };
}

/* Доли щита (s — слева направо, t — сверху вниз) точки листа (u, v) по трём углам. */
function boardSpace(map) {
  const [a, b, c] = map;
  const e1 = [b[0] - a[0], b[1] - a[1]];
  const e2 = [c[0] - a[0], c[1] - a[1]];
  const det = e1[0] * e2[1] - e1[1] * e2[0];
  if (Math.abs(det) < 1e-12) return null;
  return (u, v) => {
    const du = u - a[0];
    const dv = v - a[1];
    return [(du * e2[1] - dv * e2[0]) / det, (e1[0] * dv - e1[1] * du) / det];
  };
}

/* Тексели листа, что рисуют щит: обход прямоугольника `clip` с долями щита. */
function forEachBoardTexel(width, height, entry, visit) {
  const toBoard = boardSpace(entry.map);
  if (!toBoard) return;
  const x0 = Math.max(0, Math.floor(entry.clip[0] * width));
  const y0 = Math.max(0, Math.floor(entry.clip[1] * height));
  const x1 = Math.min(width, Math.ceil(entry.clip[2] * width));
  const y1 = Math.min(height, Math.ceil(entry.clip[3] * height));
  /* Полтекселя запаса у края: фильтрация листа не тянет в щит соседний рисунок. */
  const slack = 0.75 / Math.max(width, height);
  for (let y = y0; y < y1; y += 1)
    for (let x = x0; x < x1; x += 1) {
      const [s, t] = toBoard((x + 0.5) / width, (y + 0.5) / height);
      if (s < -slack || s > 1 + slack || t < -slack || t > 1 + slack) continue;
      visit((y * width + x) * 4, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, t)));
    }
}

/* Выборка картинки щита: среднее по клетке, если картинка крупнее места на листе, иначе билинейно. */
function samplePicture(picture, s, t, stepS, stepT, out) {
  const fx = s * picture.width - 0.5;
  const fy = t * picture.height - 0.5;
  const reachX = Math.max(0, Math.floor((stepS * picture.width) / 2));
  const reachY = Math.max(0, Math.floor((stepT * picture.height) / 2));
  out[0] = out[1] = out[2] = 0;
  if (reachX > 0 || reachY > 0) {
    const cx = Math.round(fx);
    const cy = Math.round(fy);
    let count = 0;
    for (let y = cy - reachY; y <= cy + reachY; y += 1)
      for (let x = cx - reachX; x <= cx + reachX; x += 1) {
        const at = (Math.min(picture.height - 1, Math.max(0, y)) * picture.width + Math.min(picture.width - 1, Math.max(0, x))) * 4;
        out[0] += picture.rgba[at];
        out[1] += picture.rgba[at + 1];
        out[2] += picture.rgba[at + 2];
        count += 1;
      }
    out[0] /= count;
    out[1] /= count;
    out[2] /= count;
    return out;
  }
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const wx = fx - x0;
  const wy = fy - y0;
  for (const [dx, dy, weight] of [
    [0, 0, (1 - wx) * (1 - wy)],
    [1, 0, wx * (1 - wy)],
    [0, 1, (1 - wx) * wy],
    [1, 1, wx * wy],
  ]) {
    const at = (Math.min(picture.height - 1, Math.max(0, y0 + dy)) * picture.width + Math.min(picture.width - 1, Math.max(0, x0 + dx))) * 4;
    out[0] += picture.rgba[at] * weight;
    out[1] += picture.rgba[at + 1] * weight;
    out[2] += picture.rgba[at + 2] * weight;
  }
  return out;
}

/**
 * Картинку щита — в лист на месте: `base` — пиксели листа (RGBA `width ×
 * height`, меняются на месте), `entry` — `{ clip, map }` лица или дальней
 * модели, `picture` — `billboardPicture`. Тексели вне рамки щита (кромка
 * острова) остаются как были; альфа листа — непрозрачная.
 */
export function placeBillboardPicture(base, width, height, entry, picture) {
  if (!picture) return base;
  const [w, h] = billboardPixels(entry, width, height);
  const stepS = 1 / w;
  const stepT = 1 / h;
  const colour = [0, 0, 0, 0];
  /* Один рисунок (`overlay`) — поверх того, что на листе, своей прозрачностью. */
  if (picture.overlay) {
    forEachBoardTexel(width, height, entry, (at, s, t) => {
      sampleOverlay(picture, s, t, stepS, stepT, colour);
      const alpha = colour[3] / 255;
      if (!alpha) return;
      base[at] = base[at] * (1 - alpha) + colour[0] * alpha;
      base[at + 1] = base[at + 1] * (1 - alpha) + colour[1] * alpha;
      base[at + 2] = base[at + 2] * (1 - alpha) + colour[2] * alpha;
      base[at + 3] = base[at + 3] + (255 - base[at + 3]) * alpha;
    });
    return base;
  }
  forEachBoardTexel(width, height, entry, (at, s, t) => {
    samplePicture(picture, s, t, stepS, stepT, colour);
    base[at] = colour[0];
    base[at + 1] = colour[1];
    base[at + 2] = colour[2];
    base[at + 3] = 255;
  });
  return base;
}

/** Яркость рекламы Rockstar на месте щита («Как в игре», тусклее или ярче). */
export function shadeBillboardRegion(base, width, height, entry, brightness) {
  const factor = brightness / 100;
  if (factor === 1) return base;
  forEachBoardTexel(width, height, entry, (at) => {
    base[at] = clampByte(base[at] * factor);
    base[at + 1] = clampByte(base[at + 1] * factor);
    base[at + 2] = clampByte(base[at + 2] * factor);
  });
  return base;
}

/**
 * Облик щита на листе: картинка (своя, цвет, градиент) или яркость рекламы
 * игры, и поверх — рисунок. `pictureOf(entry)` — картинка щита под размер
 * места на этом листе (`billboardPicture`).
 */
export function paintBillboardOnSheet(base, width, height, entry, look, pictureOf) {
  if (look.mode === "standard" || (look.mode === "image" && !look.image.asset)) {
    shadeBillboardRegion(base, width, height, entry, look.brightness);
    if (!billboardDrawingHas(look.drawing)) return base;
  }
  const picture = pictureOf(entry);
  return picture ? placeBillboardPicture(base, width, height, entry, picture) : base;
}

/** Множитель свечения шейдера щита: штатный × свечение облика. */
export const billboardGlowMultiplier = (standard, look) => Math.round(Number(standard) * look.glow) / 100;
