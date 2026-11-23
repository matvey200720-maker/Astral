/*
 * Завод: цвет корпусов, земли, контейнеров и реквизита мода «серого»
 * завода в пустыне Гранд-Сенора (cs4_13).
 *
 * Все текстуры мода — плашки 4×4 одного серого цвета (#7b797b): цвет
 * поверхности, нормали, блики и палитры тинта. Поэтому перекраска — не
 * рисунок, а ровный цвет в каждую текстуру цвета: установщик пишет его на
 * месте (та же длина), нормали и блики не трогаются. Материалы под тинтом
 * (контейнеры, заборы, прицеп) в игре — цвет × палитра строки тинта: при
 * перекраске палитра становится белой, и итог — ровно цвет работы. У
 * контейнеров наоборот: общий цвет корпуса белый, а цвет несёт палитра своей
 * модели — так у каждого вида контейнера может быть свой цвет.
 *
 * Группа — по файлу: корпуса и их словари, земля (и словарь дальних
 * моделей места), контейнеры, остальной реквизит. Контейнеры, заборы и
 * реквизит — модели игры: мод меняет их по всей карте, и цвет работы они
 * получат везде, не только у завода.
 *
 * Корпуса красятся и по частям (схема 2, 29.09.2026): листы у трёх зданий
 * общие, поэтому «часть» — это смысл листа: стены, крыши, бетон, металл и
 * трубы, конвейеры и вышки, лестницы с дверями и окнами (`factoryPartOf`).
 * Часть «как весь корпус» берёт настройку группы.
 *
 * Эмблема человека — плашка с картинкой в любом месте завода (листы завода
 * повторяются по модели, картинку в них «в одно место» не положить): точка и
 * нормаль поверхности, как у наклеек ангара (`decal.js`); в игру её ставит
 * своя модель, свой архетип и своя карта (`compile-emblem-plates`).
 */

import { bytesHex, hexBytes, hslToRgb, normalizeRecolourHex } from "./colour.js";
import { decalPlacement, normalizeDecalAngle } from "./decal.js";
import {
  EMBLEM_ASSET,
  emblemDecal,
  emblemPlateFiles,
  emblemPlateName,
  emblemPlateOffset,
  emblemSignature,
  emblemsLostInCode,
  hasEmblems,
  normalizeEmblemList,
  readyEmblems,
  shareableEmblems,
} from "./emblems.js";
import { finishSignature, normalizeFinishFields } from "./finish.js";
import { flatTexturePayload } from "./flat.js";
import FACTORY_INVENTORY from "./inventory/factory.js";
import { normalizePlaceItems, placeItemsSignature } from "./place-item-looks.js";
import { hasPlaceModels, joinLostInCode, normalizePlaceModels, placeModelsLostInCode, placeModelsSignatureField } from "./place-models.js";

export { FACTORY_INVENTORY };

export const FACTORY_PROJECT_SCHEMA = 2;
export const FACTORY_CONTAINER = FACTORY_INVENTORY.container;
const NAME_LIMIT = 60;

/*
 * Группы и их режимы. Общая отделка (`finish.js`) — у всех: «Стандарт»
 * (штатные листы GTA), узор, своя картинка, градиент.
 */
const FINISHES = Object.freeze(["standard", "pattern", "image", "gradient"]);
export const FACTORY_GROUPS = Object.freeze([
  Object.freeze({ id: "buildings", label: "Корпуса", modes: Object.freeze(["mod", "colour", "rainbow", ...FINISHES]) }),
  Object.freeze({ id: "ground", label: "Земля", modes: Object.freeze(["mod", "colour", "buildings", ...FINISHES]) }),
  Object.freeze({ id: "containers", label: "Контейнеры", modes: Object.freeze(["mod", "colour", "classic", "rainbow", ...FINISHES]) }),
  Object.freeze({ id: "props", label: "Реквизит", modes: Object.freeze(["mod", "colour", "buildings", "rainbow", ...FINISHES]) }),
]);

export const FACTORY_MODE_LABELS = Object.freeze({
  mod: "Как в моде",
  colour: "Свой цвет",
  rainbow: "Радуга",
  buildings: "Как корпуса",
  classic: "Разноцветные",
  standard: "Стандарт GTA",
  pattern: "Узор",
  image: "Своя картинка",
  gradient: "Градиент",
});

/*
 * Части корпуса: по смыслу листа. Правила идут по порядку — первое совпадение
 * решает (накладки и вывески — «детали», хотя в имени бывает «wall»).
 */
export const FACTORY_PARTS = Object.freeze([
  Object.freeze({ id: "walls", label: "Стены" }),
  Object.freeze({ id: "roofs", label: "Крыши" }),
  Object.freeze({ id: "concrete", label: "Бетон и ступени" }),
  Object.freeze({ id: "metal", label: "Металл и трубы" }),
  Object.freeze({ id: "machinery", label: "Конвейеры и вышки" }),
  Object.freeze({ id: "details", label: "Лестницы, двери, окна" }),
]);
const PART_RULES = Object.freeze([
  ["roofs", /roof/],
  ["machinery", /conveyor|quarry|tower|telegraph/],
  ["concrete", /concrete|storm|drain|rebar|steps_01/],
  /* Ржавые и рифлёные листы — металл («Металл и трубы»), а не детали: у
     них в имени бывает и «nonslip», и «tread», и «step0». */
  ["metal", /metal|pipe|girder|edges|bits|blackk|nonslip|tread|rust|galv|ridged|steel/],
  ["details", /rail|step0|door|window|fence|alley|sign|graf|overlay|trellace/],
  ["walls", /corr|wall|panel/],
]);

/*
 * Ржавые листы: ржавчина в них — перепады яркости, и светотень штатного
 * листа в отделке тянет её наружу (градиент «в пятнах»). У таких листов
 * светотень слабее (`FACTORY_RUST_SHADE`).
 */
const RUSTY_SHEET = /rust|crust|nonslip|treadplate|treadmesh|galv/;
export const FACTORY_RUST_SHADE = 0.3;

/** Ржавый ли лист по имени. */
export function factoryRustySheet(textureName) {
  return RUSTY_SHEET.test(String(textureName || "").toLowerCase());
}

/** Часть корпуса по имени листа (`walls`, если правило не нашлось). */
export function factoryPartOf(textureName) {
  const name = String(textureName || "").toLowerCase();
  return PART_RULES.find(([, rule]) => rule.test(name))?.[0] || "walls";
}

/*
 * Слои поверх стен корпусов (модель `cs4_13_build_03_g` — наклейки на
 * стенах). Грязь и потёки (`overlay`) лежат на ~1450 м² стен корпуса при
 * прозрачности вершин ~70 %: у мода они — непрозрачная серая плашка 4×4, у
 * игры — серая грязь. Если их не убрать, покрашенные стены остаются под
 * серой коркой — «здание не покрасилось» (29.09.2026). Поэтому грязь идёт за
 * стенами: стены как в моде — как в моде, «Стандарт» — штатная, покрашены —
 * исчезает. Вывески и граффити (`sign`, `graffiti`) идут за деталями:
 * «как в моде» — серые, иначе — штатные (их картинку в 4×4 не уложить).
 */
export function factoryLayerOf(textureName) {
  const name = String(textureName || "").toLowerCase();
  if (/overlay/.test(name)) return "overlay";
  if (/graf/.test(name)) return "graffiti";
  if (/sign|billb|logo/.test(name)) return "sign";
  return null;
}

/*
 * Граффити на стенах завода — переключателем (задача 11 ТЗ 17.10.2026,
 * владелец: «добавить возможность убирать графити с завода, чтобы их не
 * было»). Это наклейки модели-наложения `cs4_13_build_03_g` — листы
 * `rnbj_rivgraf_0002` (ряд тегов вдоль цоколя, «TRAP») и `rnbj_rivgraf_0003`
 * (большой красный кусок на башне); у дальнего завода те же теги запечены в
 * лист окон `cs4_13_windows_001_lod`. «Убрать» — листы граффити прозрачные
 * в любом облике корпуса (и «как в моде»), а вдали их место на дальнем
 * листе стирается цветом стены вокруг (`factoryGraffitiFrames`). Вывески
 * («LOADING», «GRAND BANKS») — не граффити, остаются.
 */
export const FACTORY_GRAFFITI = Object.freeze(["keep", "hidden"]);

/** Убраны ли граффити с завода. */
export const factoryGraffitiHidden = (input) => normalizeFactoryProject(input).graffiti === "hidden";

/*
 * Граффити дальнего завода: у LOD-стен теги запечены в лист
 * `cs4_13_windows_001_lod` (словарь места, у завода — своя копия, её видят
 * одни модели завода). Полоса `rows` (доли высоты листа: ряды 336–448 из 512)
 * — гофрированные панели с тегами; `keep` — что в полосе не граффити:
 * вывеска «LOADING» и блок окон (доли ширины и высоты: u0, v0, u1, v1).
 * Измерено по листу игры 17.10.2026.
 */
export const FACTORY_LOD_GRAFFITI = Object.freeze({
  sheet: "cs4_13_lod/cs4_13_windows_001_lod",
  rows: Object.freeze([336 / 512, 448 / 512]),
  keep: Object.freeze([Object.freeze([53 / 128, 411 / 512, 101 / 128, 427 / 512]), Object.freeze([92 / 128, 392 / 512, 1, 411 / 512])]),
});

/*
 * Наложения корпуса по смыслу шейдера, а не имени листа (задача 11 ТЗ
 * 17.10.2026, «наложение текстур выходит за пределы»). Ржавые пояса силосов
 * — наклейка `normal_spec_decal` модели-наложения с листом
 * `id1_17_rntg_pipe_0003`, тем же, что у труб: ~790 м² полос поверх
 * бункеров. Лист общий с трубами, поэтому при отделке его узор ложился и
 * в пояса — со своей развёрткой наклейки, полосами другого масштаба поверх
 * узора бункера, а в кадре пояса оставались ржавыми. Как грязь стен: у
 * покрашенной части наклейка уходит (в игре её треугольники сводятся в
 * точку — лист труб остаётся общим), у «Стандарта» и «как в моде» — как была.
 */
export const FACTORY_OVERLAY_DECALS = Object.freeze([
  Object.freeze({ file: "cs4_13_build_03_g.ydr", texture: "id1_17_rntg_pipe_0003" }),
]);

/** Наклейка-наложение корпуса (лист, что вне наложения — обычная поверхность). */
export const factoryOverlayDecal = (textureName) =>
  FACTORY_OVERLAY_DECALS.some((item) => item.texture === String(textureName || "").toLowerCase());

/**
 * Видна ли наклейка-наложение (`FACTORY_OVERLAY_DECALS`) с листом
 * `textureName`: у покрашенной части — нет.
 */
export function factoryOverlayDecalHidden(input, textureName) {
  if (!factoryOverlayDecal(textureName)) return false;
  const settings = factoryTextureSettings(input, "buildings", textureName);
  return !["mod", "standard"].includes(settings.mode);
}

/*
 * Общие словари района, а не завода (задача 11 ТЗ 17.10.2026, владелец:
 * «появляются текстуры у растительности, когда красишь завод»). Мод кладёт
 * в набор `cs4_13_props_lod.ytd` (и `+hi`) — словарь дальних моделей всего
 * района cs4_13: в нём листы дальних кустов, юкк, кактусов, дубов, берёз,
 * камней, щебня и столбов. Набор красил его как «Землю»: ровным цветом у
 * листов мода, отделкой — в штатном файле, — и вокруг завода розовели
 * деревья, кусты и камни. Дальние модели самого завода в этом словаре
 * красит общая система LOD по своим текселям (`recolor-lod.js`, маски
 * `lod.shared` берегут чужие), поэтому файл из описи набора не едет ни в
 * каком облике — и «как в моде» тоже: серые плашки мода гасили растительность
 * всего района.
 */
export const FACTORY_AREA_FILES = Object.freeze(["cs4_13_props_lod.ytd", "cs4_13_props_lod+hi.ytd"]);

/** Файл описи — общий словарь района (в набор не едет). */
export const factoryAreaFile = (fileName) => FACTORY_AREA_FILES.includes(String(fileName || "").toLowerCase());

/*
 * Земля вокруг завода из окружения места (опись `footprint`) — не завод:
 * подсыпка, камни и пятна масла поверх рельефа (`cs4_13_land_01_ov`) и
 * колея с отпечатками шин (`cs4_13_gndtrk_01`). Окружение ехало вместе с
 * покрашенным корпусом и брало цвет стен — пустыня вокруг завода покрывалась
 * пятнами цвета корпуса (розовыми у владельца, задача 11 ТЗ 17.10.2026), а
 * вдали этот облик переносился на листы рельефа LOD. Рельеф — как в игре.
 */
const FACTORY_TERRAIN = /^cs4_13_(land_|gndtrk)/;

/** Модель окружения — рельеф вокруг завода (не красится ни вблизи, ни вдали). */
export const factoryTerrainModel = (model) => FACTORY_TERRAIN.test(String(model || "").toLowerCase());

/**
 * Облик слоя поверх стен: `"mod"` — как у мода, `"standard"` — штатный лист
 * игры, `"hidden"` — не виден, или `null`, если лист — не слой корпуса.
 */
export function factoryLayerLook(input, texture) {
  if (texture?.group && texture.group !== "buildings") return null;
  const layer = factoryLayerOf(texture?.name);
  if (!layer) return null;
  const project = normalizeFactoryProject(input);
  /* Граффити убраны переключателем — при любом облике корпуса. */
  if (layer === "graffiti" && project.graffiti === "hidden") return "hidden";
  const part = layer === "overlay" ? "walls" : "details";
  const settings = factoryTextureSettings(project, "buildings", part === "walls" ? "wall" : "sign");
  if (settings.mode === "mod") return "mod";
  if (settings.mode === "standard") return "standard";
  return layer === "overlay" ? "hidden" : "standard";
}

/** Покрашен ли корпус (хоть одна часть не «как в моде»). */
export function factoryBuildingsPainted(input) {
  const project = normalizeFactoryProject(input);
  if (project.buildings.mode !== "mod") return true;
  return FACTORY_PARTS.some((part) => !["buildings", "mod"].includes(project.parts[part.id].mode));
}

/* Режимы части: «как весь корпус» и режимы корпусов. */
export const FACTORY_PART_MODES = Object.freeze(["buildings", "mod", "colour", "rainbow", ...FINISHES]);
export const FACTORY_PART_MODE_LABELS = Object.freeze({ buildings: "Как весь корпус" });

/* Эмблема на заводе: высота плашки в метрах, место по умолчанию — описи. */
export const FACTORY_EMBLEM_SIZE = Object.freeze([1, 40]);
const EMBLEM_SIZE_DEFAULT = 4;
export const FACTORY_DECAL = Object.freeze({
  point: Object.freeze([...(FACTORY_INVENTORY.factory.decal?.point || [0, 0, 8])]),
  normal: Object.freeze([...(FACTORY_INVENTORY.factory.decal?.normal || [0, -1, 0])]),
});
/* Имена своей плашки в игре: модель, типы, карта (контейнер набора). */
export const FACTORY_PLATE = Object.freeze({
  model: "astral_factory_emblem",
  types: "astral_factory_marks",
  map: "astral_factory_marks_map",
  lodDist: 300,
});
/* Файлы плашек по числу эмблем: модель на каждую, типы, карта, манифест. */
export const factoryPlateFiles = (count = 1) => emblemPlateFiles(FACTORY_PLATE, count);
export const FACTORY_PLATE_FILES = Object.freeze(factoryPlateFiles(1));

/*
 * Дальний завод: листы словаря места `cs4_13_lod.ytd` и чей облик они
 * повторяют — стены и окна корпусов, бетон у корпусов, бетон двора.
 */
export const FACTORY_LOD = Object.freeze({
  file: "cs4_13_lod.ytd",
  at: FACTORY_INVENTORY.factory.lod?.ytd || null,
  sheets: Object.freeze([
    Object.freeze({ match: /^cs4_13_(walls_00\d|windows_001)_lod$/, group: "buildings", texture: "id1_17_rntg_corr_0002" }),
    Object.freeze({ match: /^cs4_13_ground_001_lod$/, group: "buildings", texture: "im_concrete20" }),
    Object.freeze({ match: /^im_concrete1[79]_lod$/, group: "ground", texture: "im_concrete17" }),
  ]),
});

/* Режимы, где группе нужны штатные файлы игры (у мода листы 4×4). */
export const FACTORY_VANILLA_MODES = Object.freeze(FINISHES);
export const FACTORY_FINISH_MODES = Object.freeze(["pattern", "image", "gradient"]);

/* Где в игре лежат штатные файлы набора (адрес для «Стандарта»). */
export const FACTORY_VANILLA = Object.freeze({ ...(FACTORY_INVENTORY.factory.vanilla || {}) });

/* Наклейки на контейнерах: у мода — серые плашки поверх корпуса. */
export const FACTORY_LABELS = Object.freeze(["hidden", "white", "dark"]);
export const FACTORY_LABEL_TITLES = Object.freeze({ hidden: "Без наклеек", white: "Белые", dark: "Тёмные" });
export const FACTORY_LABEL_COLOURS = Object.freeze({ white: "#f2f2f2", dark: "#222428" });
const LABEL_COLOURS = FACTORY_LABEL_COLOURS;

/* Разноцветные контейнеры — цвета порта: красный, синий, зелёный… */
export const FACTORY_CLASSIC_COLOURS = Object.freeze([
  "#b8382c",
  "#1f5fae",
  "#2e8b57",
  "#e07b24",
  "#6d7a86",
  "#8e5a2b",
  "#d9a91a",
  "#16867a",
]);

/* Нутро и двери контейнеров, которые делят несколько моделей. */
const CONTAINER_NEUTRAL = "#6f747a";
const WHITE = "#ffffff";

const DEFAULTS = Object.freeze({
  buildings: Object.freeze({ mode: "mod", colour: "#9aa0a6" }),
  ground: Object.freeze({ mode: "mod", colour: "#6b665c" }),
  containers: Object.freeze({ mode: "mod", colour: "#1f5fae", labels: "hidden" }),
  props: Object.freeze({ mode: "mod", colour: "#8c5a3c" }),
});

export const FACTORY_TEXTURES = Object.freeze(FACTORY_INVENTORY.factory.textures.map((item) => Object.freeze({ ...item })));
export const FACTORY_CONTAINERS = Object.freeze([...FACTORY_INVENTORY.factory.containers]);
export const FACTORY_MODELS = Object.freeze(FACTORY_INVENTORY.factory.models.map((item) => Object.freeze({ ...item })));
export const FACTORY_PLACE = Object.freeze({
  district: FACTORY_INVENTORY.factory.district,
  districtLabel: FACTORY_INVENTORY.factory.districtLabel,
  placements: FACTORY_INVENTORY.factory.placements.length,
});

/*
 * Вещи завода, убираемые по одной (ТЗ 26.10.2026, раздел A4: «Удалить предмет» и «Откатить»): контейнер, прицеп, секция забора, блок,
 * ящик, мусор. Номер вещи — место модели в картах игры (`mesh.entity` сцены, с 1 по порядку `factory.placements`, опись —
 * `inventory.scene.objects`). Корпуса и земля (`shell`) красятся, но не убираются — без них завода нет. Установщик прячет сущность
 * этого места в картах района (`place-isolation.js: hidePlaceEntities`); вещь той же модели в другом месте города не трогается.
 */
const REMOVABLE = new Set(
  (FACTORY_INVENTORY.scene.objects?.items || []).filter(([, model]) => !FACTORY_INVENTORY.scene.objects.models[model]?.shell).map(([entity]) => entity),
);
/* Модель вещи завода по её номеру — для облика вещей (`place-item-looks.js`). */
const MODEL_OF = new Map((FACTORY_INVENTORY.scene.objects?.items || []).map(([entity, model]) => [entity, FACTORY_INVENTORY.scene.objects.models[model].name]));
export const factoryItemModel = (entity) => MODEL_OF.get(entity);
/** Можно ли убрать вещь с этим номером. */
export const factoryRemovable = (entity) => REMOVABLE.has(entity);
/** Сколько вещей завода убирается по одной. */
export const FACTORY_REMOVABLE_COUNT = REMOVABLE.size;

/** Убранные вещи работы: `[{ entity, model, position }]` — где в мире стояла и какой модели; установщик по ним ищет сущность в картах игры. */
export function factoryRemovedPlaces(input) {
  return normalizeFactoryProject(input).removed.map((entity) => {
    const placement = FACTORY_INVENTORY.factory.placements[entity - 1];
    return { entity, model: placement.model, position: [...placement.position] };
  });
}

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

/* Место на поверхности: точка у завода (с запасом) и нормаль. */
function normalizePlace(source, fallback) {
  const point =
    Array.isArray(source.point) && source.point.length === 3 && source.point.every(Number.isFinite)
      ? source.point.map((value) => Math.min(400, Math.max(-400, Number(value))))
      : [...fallback.point];
  const raw = Array.isArray(source.normal) && source.normal.length === 3 && source.normal.every(Number.isFinite) ? source.normal : fallback.normal;
  const length = Math.hypot(...raw) || 1;
  return {
    point: point.map((value) => Math.round(value * 100) / 100),
    normal: raw.map((value) => Math.round((value / length) * 1000) / 1000),
  };
}

function normalizeEmblem(input) {
  const source = plain(input);
  const asset = EMBLEM_ASSET.test(String(source.asset || "")) ? source.asset : "";
  const size = Number(source.size);
  const opacity = Number(source.opacity);
  return {
    asset,
    name: asset ? String(source.name || "").slice(0, 80) : "",
    width: asset ? Math.round(Math.min(8192, Math.max(1, Number(source.width) || 1))) : 0,
    height: asset ? Math.round(Math.min(8192, Math.max(1, Number(source.height) || 1))) : 0,
    ...normalizePlace(source, FACTORY_DECAL),
    size: Number.isFinite(size)
      ? Math.round(Math.min(FACTORY_EMBLEM_SIZE[1], Math.max(FACTORY_EMBLEM_SIZE[0], size)) * 10) / 10
      : EMBLEM_SIZE_DEFAULT,
    opacity: Number.isFinite(opacity) ? Math.round(Math.min(100, Math.max(0, opacity))) : 100,
    angle: normalizeDecalAngle(source.angle),
  };
}

function normalizePart(input) {
  const source = plain(input);
  return {
    mode: FACTORY_PART_MODES.includes(source.mode) ? source.mode : "buildings",
    colour: normalizeRecolourHex(source.colour, DEFAULTS.buildings.colour),
    ...normalizeFinishFields(source),
  };
}

function normalizeGroup(group, input) {
  const source = plain(input);
  const fallback = DEFAULTS[group.id];
  const next = {
    mode: group.modes.includes(source.mode) ? source.mode : fallback.mode,
    colour: normalizeRecolourHex(source.colour, fallback.colour),
    ...normalizeFinishFields(source),
  };
  if (group.id === "containers") next.labels = FACTORY_LABELS.includes(source.labels) ? source.labels : fallback.labels;
  return next;
}

export function createFactoryProject() {
  return normalizeFactoryProject({});
}

/*
 * С чего начинается завод в редакторе и на плитке — «Стандарт GTA»
 * (13.10.2026, владелец: «сделай завод изначально стандартным, а не чёрным —
 * на плитке, в предпросмотре и в редакторе»). Мод красит весь завод плашками
 * 4×4 одного серого, а под тинтом цвет умножается на такую же серую палитру —
 * в кадре и в игре выходит почти чёрный завод. «Как в моде» остался готовым
 * видом (`FACTORY_PRESETS`), но не отправной точкой.
 *
 * `createFactoryProject()` по-прежнему — пустая работа с модом: так
 * достраиваются недостающие поля старых работ и кодов и считается «ставить
 * нечего». Начинать же с этой работы редактору и плитке нельзя.
 */
export const FACTORY_START_PRESET = "standard";
export function createFactoryStartProject() {
  return applyFactoryPreset(createFactoryProject(), FACTORY_START_PRESET);
}

/** Приводит работу в порядок; лишние поля отбрасываются молча. */
export function normalizeFactoryProject(input) {
  const source = plain(input);
  const project = {
    schema: FACTORY_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
  };
  for (const group of FACTORY_GROUPS) project[group.id] = normalizeGroup(group, source[group.id]);
  const parts = plain(source.parts);
  project.parts = Object.fromEntries(FACTORY_PARTS.map((part) => [part.id, normalizePart(parts[part.id])]));
  /* Граффити на стенах: как в игре или убраны (задача 11 ТЗ 17.10.2026). */
  project.graffiti = FACTORY_GRAFFITI.includes(source.graffiti) ? source.graffiti : "keep";
  project.emblems = normalizeEmblemList(source, normalizeEmblem);
  /* Свои модели (ТЗ 11.10.2026, вечер, задача 1). */
  project.models = normalizePlaceModels(source.models);
  /* Убранные по одной вещи (ТЗ 26.10.2026): номера из описи, без повторов и без корпусов и земли. */
  project.removed = [...new Set((Array.isArray(source.removed) ? source.removed : []).filter((entity) => Number.isInteger(entity) && REMOVABLE.has(entity)))].sort((a, b) => a - b);
  /* Облик вещей — своя модель, цвет или картинка (ТЗ 27.10.2026): группы вещей одной модели, убранные не берутся. */
  project.items = normalizePlaceItems("factory", source.items, { modelOf: factoryItemModel, removed: project.removed });
  return project;
}

export const serializeFactoryProject = (project) => JSON.stringify(normalizeFactoryProject(project));

export function parseFactoryProject(text) {
  try {
    return normalizeFactoryProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createFactoryProject();
  }
}

/*
 * Отпечаток для очереди «Применить»: только то, что меняет файлы. Цвет
 * группы «как в моде» в игру не едет — и отпечаток его не держит.
 */
export function factoryProjectSignature(input) {
  const project = normalizeFactoryProject(input);
  const parts = {};
  for (const group of FACTORY_GROUPS) {
    const item = project[group.id];
    const finish = finishSignature(item);
    if (item.mode === "mod" || item.mode === "standard") parts[group.id] = item.mode;
    else if (finish) parts[group.id] = { ...finish, ...(group.id === "containers" ? { labels: item.labels } : {}) };
    else
      parts[group.id] = {
        mode: item.mode,
        ...(item.mode === "colour" ? { colour: item.colour } : {}),
        ...(group.id === "containers" ? { labels: item.labels } : {}),
      };
  }
  if (project.ground.mode === "buildings" || project.props.mode === "buildings") parts.buildingsColour = project.buildings.colour;
  /* Части корпуса — только свои, «как весь корпус» ничего не меняет. */
  const own = {};
  for (const part of FACTORY_PARTS) {
    const item = project.parts[part.id];
    if (item.mode === "buildings") continue;
    own[part.id] =
      item.mode === "mod" || item.mode === "standard"
        ? item.mode
        : finishSignature(item) || { mode: item.mode, ...(item.mode === "colour" ? { colour: item.colour } : {}) };
  }
  if (Object.keys(own).length) parts.parts = own;
  /* Граффити — только убранные: у прежних работ отпечаток тот же. */
  if (project.graffiti === "hidden") parts.graffiti = "hidden";
  /* Убранные по одной вещи — только если они есть. */
  if (project.removed.length) parts.removed = project.removed;
  /* Облик вещей — только если он есть: у прежних работ отпечаток тот же. */
  if (project.items.length) parts.items = placeItemsSignature(project.items);
  Object.assign(
    parts,
    emblemSignature(project.emblems, (item) => ({
      asset: item.asset,
      point: item.point,
      normal: item.normal,
      size: item.size,
      opacity: item.opacity,
      angle: item.angle,
    })),
    placeModelsSignatureField(project.models),
  );
  return JSON.stringify(parts);
}

/**
 * Настройки группы, как их видит игра: «как корпуса» раскрыто в настройки
 * корпусов (наклейки контейнеров — свои).
 */
export function factoryGroupSettings(input, groupId) {
  const project = normalizeFactoryProject(input);
  const settings = project[groupId];
  if (!settings) return null;
  if (settings.mode !== "buildings") return settings;
  return { ...project.buildings, ...(settings.labels ? { labels: settings.labels } : {}) };
}

/**
 * Настройки одного листа, как их видит игра: у корпусов — своя часть (или
 * весь корпус), у группы «как корпуса» — корпус целиком.
 */
export function factoryTextureSettings(input, groupId, textureName) {
  const project = normalizeFactoryProject(input);
  if (groupId === "buildings") {
    const part = project.parts[factoryPartOf(textureName)];
    return part && part.mode !== "buildings" ? part : project.buildings;
  }
  return factoryGroupSettings(project, groupId);
}

/**
 * Эмблемы на заводе: `[{ id, asset, point, normal, width, height, opacity,
 * angle }]` в метрах сцены (высота — `size`, ширина — по пропорциям
 * картинки); пусто, пока ни одной нет.
 */
export function factoryEmblemDecals(input) {
  return readyEmblems(normalizeFactoryProject(input).emblems).map((item) => emblemDecal(item));
}

/**
 * Плашки эмблем в мире: место в координатах игры (сцена + центр набора),
 * обратный кватернион сущности, размер — для `compile-emblem-plates`; у
 * каждой своё имя и своя картинка (`asset`).
 */
export function factoryEmblemPlates(input) {
  const centre = FACTORY_INVENTORY.factory.centre;
  return factoryEmblemDecals(input).map((decal, index) => {
    const place = decalPlacement(decal, { offset: emblemPlateOffset(index) });
    return {
      id: decal.id,
      asset: decal.asset,
      name: emblemPlateName(FACTORY_PLATE.model, index),
      position: place.position.map((value, axis) => Math.round((value + centre[axis]) * 1000) / 1000),
      rotation: place.rotation,
      size: place.size,
      lodDist: FACTORY_PLATE.lodDist,
      opacity: decal.opacity,
    };
  });
}

/* Код для друга: своя картинка эмблемы живёт в окне автора и в код не едет. */
export function shareableFactoryProject(input) {
  const project = normalizeFactoryProject(input);
  return { ...project, emblems: shareableEmblems(project.emblems), models: [], items: [] };
}

export function factoryLostInCode(input) {
  const project = normalizeFactoryProject(input);
  return joinLostInCode(emblemsLostInCode(project.emblems) ? "эмблемы-картинки (остаются на этом компьютере)" : "", placeModelsLostInCode(project.models), project.items.length ? "свои модели, цвета и картинки вещей (остаются на этом компьютере)" : "");
}

/* Группа файла набора: по описи моделей и текстур. */
const FILE_GROUPS = (() => {
  const map = new Map();
  for (const item of FACTORY_INVENTORY.factory.models || []) map.set(item.file, item.group);
  for (const item of FACTORY_INVENTORY.factory.textures || []) if (!map.has(item.file)) map.set(item.file, item.group);
  return map;
})();
export const factoryFileGroup = (fileName) => FILE_GROUPS.get(String(fileName || "").toLowerCase()) || null;

export function factoryProjectIsMod(input) {
  const project = normalizeFactoryProject(input);
  return (
    FACTORY_GROUPS.every((group) => project[group.id].mode === "mod") &&
    FACTORY_PARTS.every((part) => ["buildings", "mod"].includes(project.parts[part.id].mode)) &&
    project.graffiti === "keep" &&
    !hasEmblems(project.emblems) &&
    !hasPlaceModels(project.models) &&
    !project.items.length &&
    !project.removed.length
  );
}

/** Работа — «Стандарт GTA» как есть: все группы штатные, части, эмблемы и модели не тронуты. */
export function factoryProjectIsStandard(input) {
  const project = normalizeFactoryProject(input);
  return (
    FACTORY_GROUPS.every((group) => project[group.id].mode === "standard") &&
    FACTORY_PARTS.every((part) => ["buildings", "standard"].includes(project.parts[part.id].mode)) &&
    project.graffiti === "keep" &&
    !hasEmblems(project.emblems) &&
    !hasPlaceModels(project.models) &&
    !project.items.length &&
    !project.removed.length
  );
}

/* ------------------------------------------------------------------ *
 * Цвета
 * ------------------------------------------------------------------ */

/* Спектр по золотому углу: соседние номера далеко друг от друга по тону. */
export function factorySpectrum(index) {
  const hue = (index * 137.508) % 360;
  const [r, g, b] = hslToRgb(hue, 0.78, 0.52);
  return bytesHex([r * 255, g * 255, b * 255]);
}

function shade(hex, factor) {
  const [r, g, b] = hexBytes(hex);
  return bytesHex([r * factor, g * factor, b * factor]);
}

/* Номер текстуры цвета в своей группе — для радуги: одно имя — один тон. */
const RAINBOW_INDEX = (() => {
  const index = new Map();
  for (const group of FACTORY_GROUPS) {
    const names = [
      ...new Set(
        FACTORY_TEXTURES.filter((item) => item.group === group.id && item.role === "diffuse").map((item) => item.name),
      ),
    ].sort();
    names.forEach((name, position) => index.set(`${group.id}|${name}`, position));
  }
  return index;
})();

/** Цвет модели контейнера (у LOD — его модели). */
export function factoryContainerColour(project, model) {
  const settings = project.containers;
  const base = String(model || "").replace(/_ld$/, "a");
  const position = Math.max(0, FACTORY_CONTAINERS.indexOf(base) >= 0 ? FACTORY_CONTAINERS.indexOf(base) : FACTORY_CONTAINERS.indexOf(model));
  if (settings.mode === "classic") return FACTORY_CLASSIC_COLOURS[position % FACTORY_CLASSIC_COLOURS.length];
  if (settings.mode === "rainbow") return factorySpectrum(position + 3);
  return settings.colour;
}

/*
 * Облик одной текстуры набора: `{ colour, alpha }` — что писать в неё, или
 * `null`, если она остаётся как у мода (группа «как в моде», нормали,
 * блики, высоты, детализация).
 */
export function factoryTextureLook(input, texture) {
  const project = normalizeFactoryProject(input);
  const own = project[texture.group];
  if (!own) return null;
  /* Словарь района (растительность вдали) набор не правит вовсе. */
  if (factoryAreaFile(texture.file)) return null;
  /* Убранные граффити — прозрачные при любом облике корпуса, и «как в моде». */
  if (texture.role === "diffuse" && texture.group === "buildings" && factoryLayerOf(texture.name) === "graffiti" && project.graffiti === "hidden")
    return { colour: "#000000", alpha: 0 };
  /* Настройки листа: часть корпуса или «как корпуса» — уже раскрыты. */
  const resolved = factoryTextureSettings(project, texture.group, texture.name);
  if (resolved.mode === "mod") return null;
  /* «Стандарт» и отделка — не ровный цвет: их пишет установщик в штатные
     листы игры (`buildFactoryFiles`). */
  if (FACTORY_VANILLA_MODES.includes(resolved.mode)) return null;
  if (!["diffuse", "palette"].includes(texture.role)) return null;
  const settings = texture.group === "containers" ? own : resolved;
  const alpha = texture.alpha;
  /* Слой поверх стен в листах мода 4×4: штатную картинку в них не уложить,
     поэтому у покрашенного корпуса слой не виден, у мода — как у мода. */
  const layer = texture.role === "diffuse" ? factoryLayerLook(project, texture) : null;
  if (layer === "mod") return null;
  if (layer) return { colour: "#000000", alpha: 0 };

  if (texture.group === "containers") {
    if (texture.role === "palette") return { colour: factoryContainerColour(project, texture.owner), alpha };
    if (texture.decal) {
      if (settings.labels === "hidden") return { colour: "#000000", alpha: 0 };
      return { colour: LABEL_COLOURS[settings.labels], alpha };
    }
    if (texture.tinted) return { colour: WHITE, alpha };
    if (texture.owner) return { colour: factoryContainerColour(project, texture.owner), alpha };
    return { colour: settings.mode === "colour" ? shade(settings.colour, 0.72) : CONTAINER_NEUTRAL, alpha };
  }

  /* «Как корпуса» берёт режим и цвет корпусов; корпуса «как в моде» —
     и группа остаётся как у мода. */
  const { mode, colour } = settings;
  if (mode === "mod") return null;
  if (texture.role === "palette") return { colour: WHITE, alpha };
  if (mode === "rainbow") {
    const group = own.mode === "buildings" ? "buildings" : texture.group;
    const index = RAINBOW_INDEX.get(`${group}|${texture.name}`) ?? RAINBOW_INDEX.get(`${texture.group}|${texture.name}`) ?? 0;
    return { colour: factorySpectrum(index + (group === "props" ? 7 : 0)), alpha };
  }
  return { colour, alpha };
}

/**
 * Правки файлов набора: у каждого файла — новые пиксели текстур, чей облик
 * отличается от мода. Файлы без правок едут как есть.
 */
export function factoryFilePatches(input) {
  const project = normalizeFactoryProject(input);
  const byFile = new Map();
  for (const texture of FACTORY_TEXTURES) {
    if (factoryAreaFile(texture.file)) continue;
    const look = factoryTextureLook(project, texture);
    if (!look) continue;
    const payload = flatTexturePayload(texture, hexBytes(look.colour), look.alpha);
    const patch = byFile.get(texture.file) || { file: texture.file, textures: {} };
    patch.textures[texture.name] = payload;
    byFile.set(texture.file, patch);
  }
  return [...byFile.values()];
}

/* Цвет текстуры группы в кадре: облик работы или цвет мода. */
function textureColour(project, group, name) {
  const texture =
    FACTORY_TEXTURES.find((item) => item.group === group && item.name === name) ||
    FACTORY_TEXTURES.find((item) => item.name === name);
  if (!texture) return { colour: "#808080", alpha: 255 };
  const look = factoryTextureLook(project, texture);
  return look || { colour: texture.mod, alpha: texture.alpha };
}

/**
 * Облик материала сцены кадра: цвет поверхности (под тинтом — цвет ×
 * палитра, как считает игра) и видна ли она (снятые наклейки — нет).
 */
export function factoryMaterialLook(input, material) {
  const project = normalizeFactoryProject(input);
  const settings = factoryTextureSettings(project, material.group, material.texture);
  /* Слои поверх стен — как их поставит установщик. */
  const layer = material.group === "buildings" ? factoryLayerLook(project, { name: material.texture, group: "buildings" }) : null;
  if (layer === "hidden") return { colour: "#000000", visible: false };
  if (layer === "standard") return { colour: material.vanillaColour || material.colour, visible: true, standard: true };
  /* Ржавые пояса силосов у покрашенного металла уходят — как в игре
     (`FACTORY_OVERLAY_DECALS`): иначе в кадре пояса ржавые, а в игре — узор
     своей развёрткой поверх узора бункера. */
  if (material.decal && material.group === "buildings" && factoryOverlayDecalHidden(project, material.texture)) return { colour: "#000000", visible: false };
  /* Наклейки контейнеров живут своей настройкой и в «Стандарте», и под
     отделкой: снять, белые, тёмные. */
  if (material.decal && material.group === "containers" && FACTORY_FINISH_MODES.includes(settings?.mode)) {
    const labels = project.containers.labels;
    return labels === "hidden" ? { colour: "#000000", visible: false } : { colour: LABEL_COLOURS[labels], visible: true };
  }
  if (settings?.mode === "standard") return { colour: material.vanillaColour || material.colour, visible: true, standard: true };
  /* Наклейки и надписи под отделкой остаются штатными: узор ложится на
     стены, а не на граффити поверх них. */
  if (FACTORY_FINISH_MODES.includes(settings?.mode))
    return material.decal
      ? { colour: material.vanillaColour || material.colour, visible: true, standard: true }
      : { colour: material.vanillaColour || material.colour, visible: true, finish: settings };
  const surface = textureColour(project, material.group, material.texture);
  let rgb = hexBytes(surface.colour);
  if (material.palette) {
    const palette = hexBytes(textureColour(project, material.group, material.palette).colour);
    rgb = rgb.map((value, channel) => (value * palette[channel]) / 255);
  }
  return { colour: bytesHex(rgb), visible: surface.alpha > 0 };
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

const preset = (id, label, description, look) => Object.freeze({ id, label, description, look: Object.freeze(look) });

export const FACTORY_PRESETS = Object.freeze([
  preset("standard", "Стандарт GTA", "Завод, как в игре без модов: штатные листы из вашей GTA V.", {
    buildings: { mode: "standard" },
    ground: { mode: "standard" },
    containers: { mode: "standard" },
    props: { mode: "standard" },
  }),
  preset("mod", "Как в моде", "Серый завод, как у автора мода.", {
    buildings: { mode: "mod" },
    ground: { mode: "mod" },
    containers: { mode: "mod" },
    props: { mode: "mod" },
  }),
  preset("stone", "Розовый камень", "Корпуса пятнистым камнем, остальное — как в игре.", {
    buildings: { mode: "pattern", pattern: { id: "stone" } },
    ground: { mode: "standard" },
    containers: { mode: "standard" },
    props: { mode: "standard" },
  }),
  preset("hazard", "Сигнальный", "Жёлто-чёрные полосы на корпусах, контейнеры порта.", {
    buildings: { mode: "pattern", pattern: { id: "stripes", scale: 60 } },
    ground: { mode: "standard" },
    containers: { mode: "classic", labels: "hidden" },
    props: { mode: "standard" },
  }),
  preset("concrete", "Бетон и ржавчина", "Светлый бетон, ржавый реквизит, контейнеры порта.", {
    buildings: { mode: "colour", colour: "#9aa0a6" },
    ground: { mode: "colour", colour: "#6b665c" },
    containers: { mode: "classic", labels: "hidden" },
    props: { mode: "colour", colour: "#8c5a3c" },
  }),
  preset("brick", "Кирпичный", "Красный кирпич, синие контейнеры.", {
    buildings: { mode: "colour", colour: "#9c4a32" },
    ground: { mode: "colour", colour: "#5f5a52" },
    containers: { mode: "colour", colour: "#2c5d8f", labels: "white" },
    props: { mode: "colour", colour: "#6e6e6e" },
  }),
  preset("industrial", "Промзона", "Сигнальный жёлтый, как краны и погрузчики.", {
    buildings: { mode: "colour", colour: "#c9a227" },
    ground: { mode: "colour", colour: "#545454" },
    containers: { mode: "classic", labels: "dark" },
    props: { mode: "colour", colour: "#d35400" },
  }),
  preset("white", "Белый", "Чистый белый завод — видно каждого.", {
    buildings: { mode: "colour", colour: "#e8e8e8" },
    ground: { mode: "colour", colour: "#b8b8b8" },
    containers: { mode: "colour", colour: "#f4f4f4", labels: "dark" },
    props: { mode: "colour", colour: "#cfcfcf" },
  }),
  preset("army", "Армейский", "Хаки и олива.", {
    buildings: { mode: "colour", colour: "#56613f" },
    ground: { mode: "colour", colour: "#6b5f45" },
    containers: { mode: "colour", colour: "#4b5320", labels: "hidden" },
    props: { mode: "colour", colour: "#3f4a2e" },
  }),
  preset("night", "Ночной неон", "Тёмный завод, яркие контейнеры.", {
    buildings: { mode: "colour", colour: "#23263a" },
    ground: { mode: "colour", colour: "#16181f" },
    containers: { mode: "rainbow", labels: "hidden" },
    props: { mode: "colour", colour: "#7b2cff" },
  }),
  preset("port", "Морской порт", "Светлые корпуса, синий реквизит, пёстрые контейнеры.", {
    buildings: { mode: "colour", colour: "#cfd8dc" },
    ground: { mode: "colour", colour: "#546e7a" },
    containers: { mode: "classic", labels: "white" },
    props: { mode: "colour", colour: "#1565c0" },
  }),
  preset("rainbow", "Радуга", "Каждая поверхность — свой цвет радуги.", {
    buildings: { mode: "rainbow" },
    ground: { mode: "colour", colour: "#3a3a3a" },
    containers: { mode: "rainbow", labels: "hidden" },
    props: { mode: "rainbow" },
  }),
]);

export const findFactoryPreset = (id) => FACTORY_PRESETS.find((item) => item.id === id) || null;

export function applyFactoryPreset(input, presetId) {
  const project = normalizeFactoryProject(input);
  const found = findFactoryPreset(presetId);
  if (!found) return project;
  const next = { ...project };
  for (const group of FACTORY_GROUPS) next[group.id] = { ...project[group.id], ...(found.look[group.id] || {}) };
  /* Готовый вид задаёт корпус целиком: части — снова «как весь корпус». */
  next.parts = Object.fromEntries(FACTORY_PARTS.map((part) => [part.id, { ...project.parts[part.id], mode: "buildings" }]));
  return normalizeFactoryProject(next);
}

/** Готовый вид, с которым совпадает работа (для отметки плитки). */
export function matchingFactoryPreset(input) {
  const signature = factoryProjectSignature(input);
  return FACTORY_PRESETS.find((item) => factoryProjectSignature(applyFactoryPreset(input, item.id)) === signature)?.id || null;
}
