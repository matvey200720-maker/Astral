/*
 * Арена — Maze Bank Arena двух серверов: GTA 5 RP и Majestic.
 *
 * Работа одна, у каждого сервера свои настройки (`gta5rp`, `majestic`):
 * переключатель сервера в редакторе ничего не теряет, а в игру уезжает
 * облик выбранного. Листы, места картинок и сущности — опись
 * `inventory/arenas.js` (`scripts/prepare-recolor-sets.mjs --set arenas`).
 *
 * Схема 2 (ТЗ владельца 03.10.2026): основа — стандартная арена, а не чужой
 * мод. У GTA 5 RP это штатная арена игры игрока, у Majestic — стандартная
 * арена сервера (его dlc.rpf, один в один). Всё по умолчанию «Стандарт»:
 * ставить нечего, «Применить» снимает файлы Astral. Человек сам выбирает,
 * что поменять:
 *
 *   снаружи — фасад (свой цвет с эффектами, узор, картинка; дальний фасад —
 *     общей системой LOD) и эмблема плашкой на стене;
 *   внутри — пол, стены и потолок порознь; экраны, таблички, логотипы и
 *     плакаты — своей картинкой в каждом месте листа (острова развёртки,
 *     `arena-slots.js`) с размером, поворотом, сдвигом и фоном, и каждое
 *     место включается отдельно; знаки выхода — свой цвет вместо зелёного;
 *     автоматы (напитки, банкоматы, паркоматы) — показать или убрать;
 *     кресла — цвет, модель игры, убрать; звезда — свой PNG объёмной фигурой
 *     на подставке.
 *
 * Спрайтов в редакторе больше нет (05.10.2026, владелец: «убери полностью
 * функционал спрайтов… оставь выключенным… этот функционал только
 * отпугивает»): наклейки колы и газировки, потёки, номера секций и грязь
 * GTA5RP всегда убраны — и в кадре, и в любой поставленной работе.
 */

import { arenaModImageKey, arenaModIsStock, arenaModSheetImages, arenaModSignature, normalizeArenaMod } from "./arena-mod.js";
export { ARENA_MOD_MODES, ARENA_MOD_PLATE_SIDE, ARENA_MOD_SHEET_LIMIT, arenaModFrameLook, arenaModImageKey, arenaModIsStock, arenaModOp, arenaModSheetImages, normalizeArenaMod } from "./arena-mod.js";
import { hexBytes, normalizeRecolourHex } from "./colour.js";
import { lookOf, normalizeColourEffect } from "./colour-effects.js";
import { decalPlacement, normalizeDecalAngle } from "./decal.js";
import {
  emblemAssets,
  emblemDecal,
  emblemPlateFiles,
  emblemPlateName,
  emblemPlateOffset,
  emblemSignature,
  emblemTextFilled,
  emblemsLostInCode,
  hasEmblems,
  normalizeEmblemList,
  normalizeEmblemText,
  readyEmblems,
  shareableEmblems,
} from "./emblems.js";
import { finishSignature, normalizeFinishFields } from "./finish.js";
import { normalizeSlotTransform, placeImageInIslands } from "./arena-slots.js";
import { arenaPanelFaces, arenaPanelPixels, arenaPlaceHasPanels, arenaPlacePanels } from "./arena-panels.js";
export {
  ARENA_REPLACE_SIGNS,
  ARENA_SIGN_LIMITS,
  ARENA_SIGN_MODES,
  ARENA_SIGN_MODE_LABELS,
  activeArenaSigns,
  arenaReplaceSign,
  arenaSignFaces,
  arenaSignMesh,
  arenaSignModes,
} from "./arena-replace.js";
import {
  activeArenaReplacements,
  activeArenaSigns,
  arenaReplaceEntryChanged,
  arenaReplacementsSignature,
  normalizeArenaReplacements,
} from "./arena-replace.js";
import { ARENA_OBJECTS as ARENA_STOCK_OBJECTS } from "./inventory/arena-objects.js";
import { arenaObjectKind } from "./arena-object-kinds.js";
import { arenaItemParts } from "./arena-item-parts.js";
import { arenaItemModelKey, arenaItemsSignature, itemLookModels, normalizeArenaItems } from "./arena-item-looks.js";
import ARENAS_INVENTORY from "./inventory/arenas.js";
import { hasPlaceModels, joinLostInCode, normalizePlaceModelAnimation, normalizePlaceModels, placeModelsLostInCode, placeModelsSignatureField } from "./place-models.js";

export { ARENAS_INVENTORY };

export const ARENAS_PROJECT_SCHEMA = 3;
export const ARENAS_CONTAINER = ARENAS_INVENTORY.container;
const NAME_LIMIT = 60;

export const ARENA_SERVERS = Object.freeze([
  Object.freeze({ id: "gta5rp", label: "GTA 5 RP" }),
  Object.freeze({ id: "majestic", label: "Majestic" }),
]);
export const ARENA_SERVER_IDS = Object.freeze(ARENA_SERVERS.map((server) => server.id));

/*
 * Выключатель «Площадь» и эмблемы на полу (21.11.2026, слово ведущей: пока владелец не увидел площадь в игре, она в редакторе и в сборке не видна и не работает).
 * Включается переменной окружения `ASTRAL_ARENA_PLAZA=1` (сборка arena14, тесты) или `VITE_ASTRAL_ARENA_PLAZA=1` (песочница окна); `0` выключает при включённом умолчании.
 * Умолчание — одной строкой: `false` — выключено, `true` — включено; включают после захода владельца на arena14. Читается один раз при загрузке модуля: разделы, поверхности и опись
 * строятся сразу без площади, и тогда редактор, отпечатки и сборка — байт в байт как до неё.
 */
export const ARENA_PLAZA_DEFAULT = false;
export const plazaEnabledFrom = (value, fallback = ARENA_PLAZA_DEFAULT) => (value === "1" || value === 1 || value === true ? true : value === "0" || value === 0 || value === false ? false : fallback);
const plazaSwitchValue = () => globalThis.process?.env?.ASTRAL_ARENA_PLAZA ?? import.meta.env?.VITE_ASTRAL_ARENA_PLAZA;
const PLAZA_ON = plazaEnabledFrom(plazaSwitchValue());
export const arenaPlazaEnabled = () => PLAZA_ON;

export const ARENA_VIEWS = Object.freeze([
  Object.freeze({ id: "inside", label: "Внутри" }),
  Object.freeze({ id: "outside", label: "Снаружи" }),
]);

/* Разделы колонки по серверу и виду. */
export const ARENA_SECTIONS = Object.freeze({
  gta5rp: Object.freeze({
    /* Снаружи у GTA5RP ещё надпись, логотипы и баннеры фасада (задача 6); площадь — листы земли блока `sp1_10` базовой игры (21.11.2026). */
    outside: Object.freeze(PLAZA_ON ? ["facade", "plaza", "emblem", "mazeSign", "outLogos", "outBanners"] : ["facade", "emblem", "mazeSign", "outLogos", "outBanners"]),
    inside: Object.freeze(["floor", "walls", "ceiling", "screens", "signs", "logos", "posters", "exits", "objects", "seats", "star"]),
  }),
  majestic: Object.freeze({
    /* «Площадь» (21.11.2026, слова владельца: «чтобы и дорогу у арены красить, и эмблему на пол»): цвет плазы у здания; эмблема на полу — тот же список эмблем. */
    outside: Object.freeze(PLAZA_ON ? ["facade", "plaza", "emblem"] : ["facade", "emblem"]),
    /* «Замена моделей» (ТЗ 11.10.2026, ночь): аирдропы, болид и др. — своими моделями.
       «Картины и баннеры» (ТЗ 12.10.2026, задача 4): картины, фото гонщиков, баннеры команд. */
    inside: Object.freeze(["floor", "walls", "ceiling", "screens", "logos", "posters", "seats", "lights", "replace"]),
  }),
});

export const ARENA_SECTION_LABELS = Object.freeze({
  facade: "Фасад",
  ...(PLAZA_ON ? { plaza: "Площадь" } : {}),
  emblem: "Эмблема на фасаде",
  floor: "Пол",
  walls: "Стены",
  ceiling: "Потолок",
  screens: "Экраны",
  signs: "Таблички",
  logos: "Эмблемы зала",
  posters: "Плакаты",
  exits: "Знаки выхода",
  objects: "Торговые автоматы",
  seats: "Кресла",
  star: "Звезда",
  lights: "Подсветка",
  replace: "Замена моделей",
  mazeSign: "Надпись Maze Bank Arena",
  outLogos: "Логотипы снаружи",
  outBanners: "Баннеры у входов",
});

/* Подпись раздела у сервера: у Majestic «Плакаты» — картины, фото гонщиков и баннеры команд. */
const SERVER_SECTION_LABELS = Object.freeze({
  majestic: Object.freeze({ posters: "Картины и баннеры", ...(PLAZA_ON ? { emblem: "Эмблема на фасаде и площади" } : {}) }),
  ...(PLAZA_ON ? { gta5rp: Object.freeze({ emblem: "Эмблема на фасаде и площади" }) } : {}),
});
export const arenaSectionLabel = (server, id) => SERVER_SECTION_LABELS[server]?.[id] || ARENA_SECTION_LABELS[id];

/* Поверхности: общая отделка и свой цвет с эффектами. */
export const ARENA_SURFACES = Object.freeze(PLAZA_ON ? ["facade", "floor", "walls", "ceiling", "plaza"] : ["facade", "floor", "walls", "ceiling"]);
/* Площадь красится только цветом: её листы — плитка и бордюры, узор или картинка на них растянулись бы по всей земле блока. */
const PLAZA_MODES = Object.freeze(["standard", "colour"]);
export const ARENA_SURFACE_MODES = Object.freeze(["standard", "colour", "pattern", "image"]);
export const ARENA_FINISH_MODES = Object.freeze(["pattern", "image"]);

/*
 * Наложения среди листов поверхностей (задача 11 ТЗ 17.10.2026, «наложение
 * текстур выходит за пределы»): у Majestic в листы пола, стен, потолка и
 * фасада попали атлас наклеек пола (`mj_ma_decal_atlas_a1`), маска точек
 * над экранами, полосы света, плафоны и тени у входа — листы с прозрачностью,
 * что лежат поверх поверхностей. Узор или цвет поверхности ложился и в них:
 * разметка, свет и тени вылезали поверх отделки фигурами её узора. Такой лист
 * (средняя альфа описи ниже `ARENA_OVERLAY_ALPHA`) остаётся как в основе — и
 * в кадре, и в игре.
 */
export const ARENA_OVERLAY_ALPHA = 230;

/** Лист описи поверхности — наложение (не красится обликом поверхности). */
export const arenaOverlaySheet = (record) => Number.isFinite(record?.alpha) && record.alpha < ARENA_OVERLAY_ALPHA;

/* Места картинок: своя картинка ложится в острова листов мест (снаружи —
   в области листов фасада, `regions` описи). */
export const ARENA_SLOTS = Object.freeze(["screens", "signs", "logos", "posters", "mazeSign", "outLogos", "outBanners"]);
export const ARENA_OUTSIDE_SLOTS = Object.freeze(["mazeSign", "outLogos", "outBanners"]);

/* Режимы разделов. «Свой текст» — надпись рисует окно, в игру она едет
   картинкой: у надписи Maze Bank Arena, экранов, табличек, плакатов и
   баннеров — у каждого элемента свой (задача 10 ТЗ 10.10.2026). */
export const ARENA_SECTION_MODES = Object.freeze({
  screens: Object.freeze(["standard", "image", "text"]),
  signs: Object.freeze(["standard", "image", "colour", "text"]),
  logos: Object.freeze(["standard", "image", "hidden"]),
  posters: Object.freeze(["standard", "image", "colour", "text"]),
  exits: Object.freeze(["standard", "colour"]),
  seats: Object.freeze(["standard", "colour", "hidden"]),
  star: Object.freeze(["standard", "image", "hidden"]),
  lights: Object.freeze(["standard", "colour"]),
  mazeSign: Object.freeze(["standard", "text", "image"]),
  outLogos: Object.freeze(["standard", "image", "hidden"]),
  outBanners: Object.freeze(["standard", "image", "colour", "text"]),
});

/*
 * Режимы раздела у сервера. Кресла Majestic не убираются: у GTA5RP кресло —
 * сущность интерьера (её прячет дальность прорисовки), а у Majestic кресла
 * запечены рядами в модели залов вместе со ступенями.
 */
export function arenaSectionModes(server, id) {
  const modes = ARENA_SECTION_MODES[id] || [];
  return server === "majestic" && id === "seats" ? modes.filter((mode) => mode !== "hidden") : modes;
}

export const ARENA_MODE_LABELS = Object.freeze({
  standard: "Стандарт",
  colour: "Свой цвет",
  pattern: "Узор",
  image: "Картинка",
  hidden: "Убрать",
  text: "Свой текст",
});

/* Одно слово для отката к игре во всех редакторах — «Как в игре» (словарь ведущей 30.10.2026); у Majestic исходное — арена сервера. */
export const ARENA_STANDARD_LABELS = Object.freeze({ gta5rp: "Как в игре", majestic: "Как на сервере" });

/* Как картинка стоит в месте по умолчанию: своя картинка заполняет место
   везде (слово владельца 31.10.2026: «Вписать» давало чёрные и серые поля у
   круглого логотипа и планшета). Фон — у «Вписать» и у слов: экраны —
   чёрный экран, таблички — светлая плашка, логотипы — прозрачный фон. */
export const ARENA_SLOT_DEFAULTS = Object.freeze({
  screens: Object.freeze({ fit: "cover", background: "colour", backgroundColour: "#000000" }),
  signs: Object.freeze({ fit: "cover", background: "colour", backgroundColour: "#f2f2f2" }),
  logos: Object.freeze({ fit: "cover", background: "clear", backgroundColour: "#000000" }),
  posters: Object.freeze({ fit: "cover", background: "colour", backgroundColour: "#000000" }),
  /* Надпись — светлые буквы на тёмной полосе, как у штатной стелы; логотип —
     поверх фактуры панели (прежний стирается ею же). */
  mazeSign: Object.freeze({ fit: "cover", background: "colour", backgroundColour: "#1c1d21" }),
  outLogos: Object.freeze({ fit: "cover", background: "keep", backgroundColour: "#000000" }),
  outBanners: Object.freeze({ fit: "cover", background: "colour", backgroundColour: "#000000" }),
});
/* Свои слова в месте встают целиком: «Заполнить» срезало бы буквы по краям. */
export const ARENA_TEXT_FIT = "contain";

/** Положение места `id` по умолчанию для того, что в нём стоит (`mode`): своя картинка заполняет, свои слова вписаны целиком. */
export const arenaSlotDefaults = (id, mode) => (mode === "text" ? { ...ARENA_SLOT_DEFAULTS[id], fit: ARENA_TEXT_FIT } : ARENA_SLOT_DEFAULTS[id]);

/*
 * Кресла GTA5RP: другая модель встаёт на места кресел зала — правкой
 * сущностей интерьера (архетип кресла меняется на выбранный), без замены
 * кресла по всей карте. Модели — штатные из игры: в описи остаются те, что
 * у игрока есть (`ARENAS_INVENTORY…chairs.variants`). «Стадионное» —
 * штатное кресло зала.
 */
export const ARENA_CHAIR_CANDIDATES = Object.freeze([
  Object.freeze({ id: "stadium", archetype: "v_ilev_chair02_ped", label: "Стадионное" }),
  Object.freeze({ id: "plastic", archetype: "prop_chair_08", label: "Пластиковое" }),
  Object.freeze({ id: "office", archetype: "prop_off_chair_01", label: "Офисное" }),
  Object.freeze({ id: "office-mesh", archetype: "prop_off_chair_04", label: "Офисное сетка" }),
  Object.freeze({ id: "office-black", archetype: "prop_off_chair_05", label: "Офисное чёрное" }),
  Object.freeze({ id: "executive", archetype: "v_corp_offchair", label: "Директорское" }),
  Object.freeze({ id: "club", archetype: "v_club_officechair", label: "Клубное" }),
  Object.freeze({ id: "wood", archetype: "prop_chair_01a", label: "Деревянное" }),
  Object.freeze({ id: "wood-dark", archetype: "prop_chair_01b", label: "Деревянное тёмное" }),
  Object.freeze({ id: "kitchen", archetype: "prop_chair_02", label: "Кухонное" }),
  Object.freeze({ id: "garden", archetype: "prop_chair_03", label: "Садовое" }),
  Object.freeze({ id: "metal", archetype: "prop_chair_04a", label: "Металлическое" }),
  Object.freeze({ id: "bistro", archetype: "prop_chair_05", label: "Бистро" }),
  Object.freeze({ id: "cafe", archetype: "prop_chair_06", label: "Кафе" }),
  Object.freeze({ id: "classic", archetype: "prop_chair_07", label: "Классическое" }),
  Object.freeze({ id: "school", archetype: "prop_chair_09", label: "Школьное" }),
  Object.freeze({ id: "lounge", archetype: "prop_chair_10", label: "Лаунж" }),
  Object.freeze({ id: "stool", archetype: "prop_bar_stool_01", label: "Барный табурет" }),
  Object.freeze({ id: "armchair", archetype: "v_res_m_armchair", label: "Кресло" }),
  Object.freeze({ id: "sofa", archetype: "v_res_m_dinechair", label: "Столовое" }),
  Object.freeze({ id: "skid", archetype: "prop_skid_chair_01", label: "Табурет-ящик" }),
  Object.freeze({ id: "rocker", archetype: "prop_rock_chair_01", label: "Качалка" }),
]);

/* Звезда GTA5RP: подставка, анимация, пределы. */
export const ARENA_STAR_STANDS = Object.freeze(["none", "pedestal", "cube", "steps", "ring"]);
export const ARENA_STAR_STAND_LABELS = Object.freeze({
  none: "Без подставки",
  pedestal: "Тумба",
  cube: "Куб",
  steps: "Ступени",
  ring: "Кольцо",
});
export const ARENA_STAR_ANIMATIONS = Object.freeze(["none", "bounce", "spin", "levitate"]);
export const ARENA_STAR_ANIMATION_LABELS = Object.freeze({
  none: "Стоит",
  bounce: "Прыжки",
  spin: "Оборот 360°",
  levitate: "Левитация",
});
export const ARENA_STAR_LIMITS = Object.freeze({ size: [1, 10], speed: [0.2, 3], height: [0.1, 3], depth: [2, 60] });

/* Эмблема на фасаде: высота плашки, м. */
export const ARENA_EMBLEM_SIZE = Object.freeze([1, 30]);

/* Имена своей плашки эмблемы в игре (контейнер набора). */
export const ARENA_PLATE = Object.freeze({
  model: "astral_arenas_emblem",
  types: "astral_arenas_marks",
  map: "astral_arenas_marks_map",
  lodDist: 400,
});
/* Файлы плашек по числу эмблем: модель на каждую, типы, карта, манифест. */
export const arenaPlateFiles = (count = 1) => emblemPlateFiles(ARENA_PLATE, count);
export const ARENA_PLATE_FILES = Object.freeze(arenaPlateFiles(1));

/* Показать или убрать: автоматы. */
export const ARENA_SHOW = Object.freeze(["show", "hide"]);
/*
 * Спрайты GTA5RP — всегда убраны (05.10.2026): наклейки колы, газировки и
 * чипсов (`cola`) и потёки, номера секций и грязь (`decals`). Переключателя
 * нет; работа держит их как есть, установщик делает их листы прозрачными, а
 * стенд с колой прячет.
 */
export const ARENA_SPRITES_GONE = Object.freeze({ cola: "hide", decals: "hide" });

/*
 * Затенение под рядами кресел GTA5RP (05.10.2026, владелец: «когда
 * накладываешь текстуры, под стульями появляются чёрные полосы»): наклейка
 * `tl_v_stadium_ao` (шейдер decal_dirt) модели пола фойе — тёмный квадрат под
 * каждым креслом и десять полос под рядами. На своём поле, без кресел или с
 * другой моделью кресла она выделяется — тогда её треугольники уходят из
 * модели, и пол под креслами такой же, как вокруг. Файл — рядом с типами
 * интерьера в описи.
 */
export const ARENA_SEAT_SHADOWS = Object.freeze({
  gta5rp: Object.freeze([Object.freeze({ file: "v_62_lobmat.ydr", textures: Object.freeze(["tl_v_stadium_ao"]) })]),
});
/** Файлы затенения под креслами — для доверия пакету. */
export const arenaSeatShadowFiles = () => [...new Set(Object.values(ARENA_SEAT_SHADOWS).flatMap((list) => list.map((item) => item.file)))];

export const ARENA_OBJECTS = Object.freeze([
  Object.freeze({ id: "vending", label: "Автоматы с напитками", hint: "Три автомата в фойе и автомат с водой в студии" }),
  Object.freeze({ id: "atms", label: "Банкоматы", hint: "Два банкомата в фойе" }),
  Object.freeze({ id: "parking", label: "Паркоматы", hint: "Шесть паркоматов у входов" }),
]);

/*
 * Вещи зала по одной (ТЗ 43Б, 20.10.2026): у GTA 5 RP опись вещей снята со сцены зала
 * (`inventory/arena-objects.js`), и каждую вещь можно убрать из игры — запись её сущности в
 * `v_int_62.ytyp`, а не модель у всех; у Majestic — запись в `mazearena_int_<n>.ytyp` (ТЗ 27.10.2026). Оболочку зала (стены, пол, потолок,
 * наклейки) убрать нельзя.
 */
/* Ключ модели вещи зала по её номеру (имя, у GTA 5 RP — с архетипом, если под именем две модели): опись вещей сцены (GTA 5 RP) или сервера (Majestic). */
const itemModelCache = new Map();
function arenaItemModelName(server, key) {
  if (!itemModelCache.has(server)) {
    const raw = ARENA_STOCK_OBJECTS[server] || arenaServerInventory(server)?.objects;
    itemModelCache.set(server, raw ? new Map(raw.items.map(([number, model]) => [number, arenaItemModelKey(server, number, raw.models[model].name)])) : new Map());
  }
  return itemModelCache.get(server).get(key);
}

const removableCache = new Map();
export function arenaRemovableKeys(server) {
  if (removableCache.has(server)) return removableCache.get(server);
  let keys = null;
  const stock = ARENA_STOCK_OBJECTS[server];
  /* Части вещей (коврики у перил, `arena-item-parts.js`) убираются из самой модели; их номера — вне номеров сущностей. */
  if (stock) keys = new Set([...stock.items.filter(([, model]) => !stock.models[model].shell).map(([key]) => key), ...arenaItemParts(server).filter((part) => stock.items.some(([key]) => key === part.entity)).map((part) => part.key)]);
  else {
    /*
     * Majestic (ТЗ 27.10.2026): вещь зала — запись сущности в типах помещения сервера (`mazearena_int_<n>.ytyp` набора; номер вещи — интерьер × 100000 +
     * номер сущности, хеш модели совпал у всех 604 вещей), так что убрать можно любую, штатную и серверную: дальность прорисовки сущности 1 см, файл
     * модели не трогается. Оболочка зала красится, но не убирается.
     */
    const inventory = arenaServerInventory(server);
    const raw = inventory?.objects;
    if (raw?.items?.length && inventory.mlos?.length)
      keys = new Set(raw.items.filter(([, model]) => !raw.models[model].shell && arenaObjectKind(raw.models[model].name) !== "structure").map(([key]) => key));
  }
  removableCache.set(server, keys);
  return keys;
}

/** Номера убранных вещей: только настоящие и не оболочка, без повторов, по возрастанию. */
function normalizeRemoved(server, input) {
  const allowed = arenaRemovableKeys(server);
  if (!allowed || !Array.isArray(input)) return [];
  return [...new Set(input.filter((key) => Number.isInteger(key) && allowed.has(key)))].sort((a, b) => a - b);
}

const IMAGE_ASSET = /^hangar-emblem:[a-f0-9]{64}$/;

/* ------------------------------------------------------------------ *
 * Опись
 * ------------------------------------------------------------------ */

/*
 * Эмблема в центре зала Majestic (ТЗ 11.10.2026, ночь: «в середине зала на
 * полу тоже свою эмблему поставить»). Крылатый знак на белом круге пола —
 * одна наклейка оболочки зала (`mj_ma_int3_shell.ydr`, лист
 * `mj_ma_decal_atlas_a1` 512 × 512): квадрат пола в середине зала берёт
 * верхнюю полосу листа, и больше её не берёт ни одна сетка зала (снято со
 * сцены «внутри»: 2 треугольника из 322 у листа). Опись Majestic готовит
 * архив сервера, которого на этой машине нет, — место дописано здесь.
 */
export const MAJESTIC_CENTRE_EMBLEM = Object.freeze({
  section: "logos",
  place: Object.freeze({ id: "centre", label: "Эмблема в центре зала", textures: Object.freeze(["mj_ma_decal_atlas_a1"]), on: true }),
  record: Object.freeze({
    file: "mj_ma_int3_shell.ydr",
    name: "mj_ma_decal_atlas_a1",
    format: "DXT5",
    width: 512,
    height: 512,
    levels: 8,
    role: "diffuse",
    group: "logos",
    colour: "#010101",
    alpha: 28,
    islands: Object.freeze([Object.freeze({ rect: Object.freeze([0, 0, 1, 0.3142]), swap: false, flipU: true, flipV: true, aspect: 3.183 })]),
  }),
});

function withMajesticCentre(servers) {
  const majestic = servers?.majestic;
  if (!majestic || (majestic.places?.logos || []).some((place) => place.id === MAJESTIC_CENTRE_EMBLEM.place.id)) return servers;
  return {
    ...servers,
    majestic: {
      ...majestic,
      places: { ...majestic.places, logos: [...(majestic.places?.logos || []), MAJESTIC_CENTRE_EMBLEM.place] },
      textures: [...(majestic.textures || []), MAJESTIC_CENTRE_EMBLEM.record],
    },
  };
}

/*
 * Картины и баннеры Majestic (ТЗ 12.10.2026, задача 4: «менять на полках вот
 * эти всякие картинки»): картины на стенах гоночной зоны и фото гонщиков
 * (атласы модели `mj_ma_int3_rm4_wp_recth`), баннеры команд над игровыми
 * местами (`team_banners_2048`). Опись Majestic без архива сервера не
 * пересобрать, поэтому места дописаны здесь, а сами картины — полотна описи
 * (`scripts/prepare-arena-panels.mjs` находит их по листу в любой группе
 * сцены). `plates` — у места нет листа в наборе: и «Все сразу», и своя
 * картинка встают плашками поверх каждой картины (`arenaPanelPlates`).
 */
export const MAJESTIC_POSTER_PLACES = Object.freeze(
  [
    { id: "paintings", label: "Картины на стенах", textures: ["ss_wallpaintings_atlas"], on: true, plates: true },
    { id: "photos", label: "Фото гонщиков", textures: ["ss_driverphotos_atlas"], on: true, plates: true },
    { id: "teams", label: "Баннеры команд", textures: ["team_banners_2048"], on: true, plates: true },
  ].map((place) => Object.freeze({ ...place, textures: Object.freeze(place.textures) })),
);

function withMajesticPosters(servers) {
  const majestic = servers?.majestic;
  if (!majestic || majestic.places?.posters?.length) return servers;
  return { ...servers, majestic: { ...majestic, places: { ...majestic.places, posters: MAJESTIC_POSTER_PLACES } } };
}

/*
 * Majestic: ближний фасад арены (21.11.2026). Листы стадиона лежат в `sp1_10_stadium.ytd`, а вблизи игра берёт их двойники с вдвое большим размером
 * из `sp1_10_stadium+hi.ytd` (файл базовой игры, в наборе Majestic его нет): красился только низкий словарь, и вблизи фасад оставался штатным. Как у GTA 5 RP
 * (`hd` у записи листа), дописываем двойники пяти листов с «+hi» и два листа козырька и стекла (тёмные, но тоже в «+hi»); файл читается из игры игрока.
 */
const SP1_10_ARENA = "x64m.rpf:levels/gta5/_cityw/sanpedro_01/sp1_10.rpf";
const MAJESTIC_FACADE_HD = Object.freeze({
  sp1_10_rsn_mc_wall_0001: Object.freeze({ format: "DXT1", width: 1024, height: 1024, levels: 9 }),
  sp1_10_rsd_dr_brand02: Object.freeze({ format: "DXT1", width: 1024, height: 512, levels: 8 }),
  sp1_10_rsn_mc_metal_0002: Object.freeze({ format: "DXT1", width: 512, height: 512, levels: 8 }),
  sp1_10_stadium_tpage_tile_d: Object.freeze({ format: "DXT1", width: 512, height: 1024, levels: 8 }),
  kt1_04_rsn_mc_wall_0003: Object.freeze({ format: "DXT1", width: 512, height: 512, levels: 8 }),
});
const MAJESTIC_FACADE_EXTRA = Object.freeze([
  Object.freeze({ name: "mc_window_0005", colour: "#2e2f31", hd: Object.freeze({ format: "DXT1", width: 512, height: 512, levels: 8 }) }),
  Object.freeze({ name: "bh1_11_rsn_mc_metal_0002", colour: "#303131", hd: Object.freeze({ format: "DXT1", width: 512, height: 512, levels: 8 }) }),
]);
function withMajesticFacadeHd(servers) {
  const majestic = servers?.majestic;
  if (!majestic?.textures || majestic.textures.some((record) => record.hd?.file === "sp1_10_stadium+hi.ytd")) return servers;
  const twin = (hd) => ({ file: "sp1_10_stadium+hi.ytd", at: `${SP1_10_ARENA}/sp1_10_stadium+hi.ytd`, ...hd });
  const textures = majestic.textures.map((record) => (record.file === "sp1_10_stadium.ytd" && record.role === "diffuse" && MAJESTIC_FACADE_HD[record.name] ? { ...record, hd: twin(MAJESTIC_FACADE_HD[record.name]) } : record));
  for (const extra of MAJESTIC_FACADE_EXTRA)
    textures.push({ file: "sp1_10_stadium.ytd", name: extra.name, format: "DXT1", width: 256, height: 256, levels: 7, role: "diffuse", group: "facade", colour: extra.colour, alpha: 255, hd: twin(extra.hd) });
  return { ...servers, majestic: { ...majestic, textures } };
}

/*
 * Majestic: площадь у здания (21.11.2026). Плита, бордюры клумб и ступени `sp1_10_ground_*` читают листы словарей блока `sp1_10` базовой игры: `sp1_10.ytd` и его двойник `+hi`. Файлы читаются из
 * игры игрока (`at`), как «+hi» фасада; строение не меняется, едут в потоковый архив пакета мест на старте — так плаза красилась в заходе arena11diag. Красятся семь листов земли блока;
 * общие городские (трава, бетон, асфальт, разметка) и листы с чужими соседями (`railing_whiterail_basic_a`, `im_drains03`) — нет. `colour` — средний цвет листа игры (для плашки и подсказки).
 */
const MAJESTIC_PLAZA_SHEETS = Object.freeze(
  [
    ["sp1_10_rsn_mc_ground_0001", 256, 256, 7, "#828386"],
    ["sp1_10_ground_tile_tpage_d", 256, 512, 7, "#686960"],
    ["sp1_10_ground_floor_tpage_d", 256, 512, 7, "#c8c9ca"],
    ["rsn_am_im_floortiles05", 256, 256, 7, "#b8b9b6"],
    ["im_floortiles12", 1024, 1024, 9, "#535354"],
    ["im_floortiles12_brighter", 1024, 1024, 9, "#6c6c6d"],
    ["kt1_04_rsn_mc_wall_0005", 512, 512, 8, "#919392"],
  ].map(([name, width, height, levels, colour]) => Object.freeze({ name, width, height, levels, colour })),
);
/* Двойники «+hi» четырёх из них (у `sp1_10_rsn_mc_ground_0001`, `im_floortiles12` и `…_brighter` двойника в игре нет). */
const MAJESTIC_PLAZA_HD = Object.freeze({
  sp1_10_ground_tile_tpage_d: Object.freeze({ width: 512, height: 1024, levels: 8 }),
  sp1_10_ground_floor_tpage_d: Object.freeze({ width: 512, height: 1024, levels: 8 }),
  rsn_am_im_floortiles05: Object.freeze({ width: 512, height: 512, levels: 8 }),
  kt1_04_rsn_mc_wall_0005: Object.freeze({ width: 1024, height: 1024, levels: 9 }),
});
/* Площадь есть у обоих серверов: листы блока `sp1_10` — базовая игра, а не файлы сервера. */
function withPlaza(servers) {
  let out = servers;
  for (const id of ["majestic", "gta5rp"]) out = withPlazaOf(out, id);
  return out;
}
function withPlazaOf(servers, id) {
  const majestic = servers?.[id];
  if (!majestic?.textures || majestic.textures.some((record) => record.group === "plaza")) return servers;
  const textures = [...majestic.textures];
  for (const sheet of MAJESTIC_PLAZA_SHEETS) {
    const hd = MAJESTIC_PLAZA_HD[sheet.name];
    textures.push({
      file: "sp1_10.ytd",
      at: `${SP1_10_ARENA}/sp1_10.ytd`,
      name: sheet.name,
      format: "DXT1",
      width: sheet.width,
      height: sheet.height,
      levels: sheet.levels,
      role: "diffuse",
      group: "plaza",
      colour: sheet.colour,
      alpha: 255,
      ...(hd ? { hd: { file: "sp1_10+hi.ytd", at: `${SP1_10_ARENA}/sp1_10+hi.ytd`, format: "DXT1", ...hd } } : {}),
    });
  }
  return { ...servers, [id]: { ...majestic, textures } };
}

const WITHOUT_PLAZA = withMajesticFacadeHd(withMajesticPosters(withMajesticCentre(ARENAS_INVENTORY.arenas?.servers || {})));
const SERVERS = PLAZA_ON ? withPlaza(WITHOUT_PLAZA) : WITHOUT_PLAZA;

/** Место рисуется только плашками (своего листа в наборе нет). */
export const arenaPlacePlated = (server, section, placeId) => Boolean(arenaPlaces(server, section).find((place) => place.id === placeId)?.plates);

/** Опись сервера: листы, места, сущности, камеры. */
export const arenaServerInventory = (server) => SERVERS[server] || null;

/** Сцена кадра: `{ url, origin }` или `null`. */
export function arenaScene(server, view) {
  return (ARENAS_INVENTORY.scenes || []).find((item) => item.id === `${server}-${view}`) || null;
}

/** Места картинок раздела у сервера: `[{ id, label, textures, on }]`. */
export const arenaPlaces = (server, section) => SERVERS[server]?.places?.[section] || [];

/* ------------------------------------------------------------------ *
 * Элементы мест (задача 10 ТЗ 10.10.2026)
 * ------------------------------------------------------------------ */

/*
 * Как место делится на элементы, которые правятся по одному: `textures` —
 * у места несколько листов, и каждый — свой плакат или экран; `islands` —
 * один лист, но его острова — разные полотна (у каждого свой кусок листа);
 * `cloths` — полотна у арок: 18 своих моделей с одним листом, у каждого
 * полотна свой словарь (`arenaClothJobs`). Остальные места — один элемент
 * (само место). Деление — по описи: отдельный лист или остров есть в
 * файлах игры (сервера), значит, свою картинку ему можно дать.
 */
export const ARENA_ELEMENT_SPLITS = Object.freeze({
  gta5rp: Object.freeze({
    signs: Object.freeze({ sections: "textures" }),
    posters: Object.freeze({ banners: "islands", blinds: "islands", show: "textures", kiosks: "textures" }),
    outBanners: Object.freeze({ cloth: "cloths", flags: "islands", players: "islands" }),
  }),
  majestic: Object.freeze({
    screens: Object.freeze({ rosters: "textures", tv: "textures", walls: "islands", monitors: "textures", corridor: "textures" }),
  }),
});

/* Подписи элементов: у листа — что на нём, у острова и полотна — номер. */
const ELEMENT_TEXTURE_LABELS = Object.freeze({
  screen_rnx_roster: "Состав RNX",
  screen_titan_roster: "Состав Titan",
  caster: "Экран комментатора",
  prop_tv_screen: "Телевизор",
  prop_tv_screen2: "Телевизор у стены",
  mj_minimap_mazearena: "Экран с картой",
  racing: "Гоночное табло",
  monitor_stats: "Монитор статистики",
  screen_interface: "Сенсорная панель",
});
const ELEMENT_NOUNS = Object.freeze({
  "gta5rp:signs:sections": "Табличка секций",
  "gta5rp:posters:banners": "Баннер фойе",
  "gta5rp:posters:blinds": "Полотно с игроками",
  "gta5rp:posters:show": "Плакат шоу",
  "gta5rp:posters:kiosks": "Реклама киоска",
  "gta5rp:outBanners:cloth": "Полотно у арки",
  "gta5rp:outBanners:flags": "Флаг стел",
  "gta5rp:outBanners:players": "Полотно с игроком",
  "majestic:screens:tv": "Экран",
  "majestic:screens:walls": "Табло на стене",
  "majestic:screens:monitors": "Монитор",
  "majestic:screens:corridor": "Длинный экран",
  /* Полотна по одному (ТЗ 11.10.2026, ночь): у каждого физического полотна — свой номер. */
  "gta5rp:screens:tvs": "Телевизор",
  "gta5rp:screens:wall": "Экран над залом",
  "gta5rp:signs:restroom": "Табличка туалета",
  "gta5rp:signs:search": "Табличка досмотра",
  "gta5rp:signs:smoking": "Табличка «Не курить»",
  "gta5rp:logos:shield": "Щит",
  "gta5rp:logos:panic": "Логотип",
  "gta5rp:logos:banner": "Надпись Maze Bank Arena",
  "gta5rp:logos:maze": "Знак лабиринта",
});

/*
 * Полотна Majestic по листу (ТЗ 12.10.2026, задача 4: «на каждом мониторе,
 * планшете — своя фотография»): у места «Мониторы и панели» — планшеты на
 * круглом столе и сенсорные панели, у «Телевизоров и табло» — мониторы
 * игровых мест, гоночные табло и большие экраны. Номер — свой у каждого рода.
 */
const PANEL_TEXTURE_NOUNS = Object.freeze({
  monitor_stats: "Планшет",
  screen_interface: "Сенсорная панель",
  mj_ma_fake_screen_a1_15: "Мини-экран",
  mj_ma_fake_screen_a1_16: "Мини-экран",
  prop_tv_screen2: "Монитор игрока",
  prop_tv_screen: "Телевизор",
  racing: "Гоночное табло",
  mj_minimap_mazearena: "Экран с картой",
  "13a9b6c135b486eed26bc960d60768e5_fb821ec6-34ca-4774-9131-557e83c94948": "Большой экран",
  ss_wallpaintings_atlas: "Картина",
  ss_driverphotos_atlas: "Фото гонщика",
  team_banners_2048: "Баннер команды",
  screen_rnx_roster: "Экран состава",
  screen_titan_roster: "Экран состава",
  caster: "Экран состава",
  standings_en: "Табло турнира",
  sector_racing_text_decal_emi_light_512: "Вывеска гонок",
});

const CLOTH_MODEL = /^sp1_10_brand_01_cloth(\d\d)$/;

/* Лист места в описи: у разделов зала — запись своей группы, снаружи — область листа фасада. */
function placeIslands(server, section, place) {
  const records = (SERVERS[server]?.textures || []).filter((record) => record.name === place.textures[0]);
  const inside = records.find((record) => record.group === section && record.islands?.length);
  if (inside) return inside.islands;
  for (const record of records) {
    const region = (record.regions || []).find((item) => item.section === section && item.place === place.id);
    if (region) return region.islands;
  }
  return [];
}

/* Сторона света от середины арены: «с севера», «с юго-востока»… (север — +Y игры). */
const COMPASS = Object.freeze(["с севера", "с северо-востока", "с востока", "с юго-востока", "с юга", "с юго-запада", "с запада", "с северо-запада"]);
const bearingOf = (position, centre) => (Math.atan2(position[0] - centre[0], position[1] - centre[1]) * 180) / Math.PI;
const compassOf = (degrees) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];

/*
 * Полотна у арок: модели фасада `sp1_10_brand_01_clothNN` — по кругу от
 * севера по часовой стрелке, чтобы номер полотна в окне шёл вокруг арены, а
 * подпись говорила, с какой стороны оно висит.
 */
function clothPlacements(server) {
  const seen = new Map();
  for (const placement of SERVERS[server]?.facade || []) {
    const match = CLOTH_MODEL.exec(String(placement.model || ""));
    if (match && !seen.has(match[1])) seen.set(match[1], { number: match[1], model: placement.model, position: placement.position });
  }
  const centre = SERVERS[server]?.origins?.outside || [0, 0, 0];
  const turn = (item) => (((bearingOf(item.position, centre) % 360) + 360) % 360);
  return [...seen.values()]
    .map((item) => ({ ...item, hint: compassOf(bearingOf(item.position, centre)) }))
    .sort((left, right) => turn(left) - turn(right) || left.number.localeCompare(right.number));
}

const elementCache = new Map();

/**
 * Элементы места: `[{ key, place, label, texture?, islands?, cloth?,
 * model?, position? }]`. Ключ места без деления — его ид, у делёного —
 * `<место>.<номер>` (номер с единицы). `islands` — номера островов листа
 * места (у зала — `record.islands`, снаружи — `region.islands`).
 */
export function arenaPlaceElements(server, section, placeId) {
  const cacheKey = `${server}|${section}|${placeId}`;
  if (elementCache.has(cacheKey)) return elementCache.get(cacheKey);
  const place = arenaPlaces(server, section).find((item) => item.id === placeId);
  let out = [];
  if (place) {
    const split = ARENA_ELEMENT_SPLITS[server]?.[section]?.[placeId] || "";
    const noun = ELEMENT_NOUNS[`${server}:${section}:${placeId}`] || place.label;
    /* Физические полотна (опись `arena-panels.js`) — первыми: только так свой
       вид одного полотна не задевает соседей с тем же куском листа. */
    if (arenaPlaceHasPanels(server, section, placeId)) {
      /* Подпись — род полотна по листу (планшет, монитор игрока…) и его номер среди своих. */
      const counts = new Map();
      out = arenaPlacePanels(server, section, placeId).map((panel, index) => {
        const own = PANEL_TEXTURE_NOUNS[panel.texture] && server === "majestic" ? PANEL_TEXTURE_NOUNS[panel.texture] : noun;
        counts.set(own, (counts.get(own) || 0) + 1);
        return {
          key: `${placeId}.${index + 1}`,
          place: placeId,
          label: `${own} ${counts.get(own)}`,
          panel,
          hint: panel.hint,
        };
      });
    } else if (split === "textures" && place.textures.length > 1) {
      out = place.textures.map((texture, index) => ({
        key: `${placeId}.${index + 1}`,
        place: placeId,
        label: ELEMENT_TEXTURE_LABELS[texture] || `${noun} ${index + 1}`,
        texture,
      }));
    } else if (split === "islands") {
      const islands = placeIslands(server, section, place);
      if (islands.length > 1) {
        /* Номера — слева направо по листу: так их проще узнать в кадре. */
        const order = islands.map((island, index) => ({ index, u: island.rect?.[0] ?? index })).sort((left, right) => left.u - right.u);
        out = order.map((item, number) => ({ key: `${placeId}.${number + 1}`, place: placeId, label: `${noun} ${number + 1}`, islands: [item.index] }));
      }
    } else if (split === "cloths") {
      const cloths = clothPlacements(server);
      if (cloths.length)
        out = cloths.map((cloth, index) => ({
          key: `${placeId}.${index + 1}`,
          place: placeId,
          label: `${noun} ${index + 1}`,
          cloth: cloth.number,
          model: cloth.model,
          position: cloth.position,
          hint: cloth.hint,
        }));
    }
    if (!out.length) out = [{ key: placeId, place: placeId, label: place.label }];
  }
  const frozen = Object.freeze(out.map((item) => Object.freeze(item)));
  elementCache.set(cacheKey, frozen);
  return frozen;
}

/** Все элементы раздела у сервера — по местам подряд. */
export const arenaSlotElements = (server, section) => arenaPlaces(server, section).flatMap((place) => arenaPlaceElements(server, section, place.id));

/** Свой ли вид у элемента (запись в `item.elements`). */
export const arenaElementOwn = (item, key) => Boolean(key && item?.elements?.[key]);

/** Вид элемента: свой (если заведён) или общий раздела («Все сразу»). */
export function arenaElementSettings(item, key) {
  const own = key ? item?.elements?.[key] : null;
  return own || item || null;
}

/** Ключ картинки элемента у главного процесса: общий раздела или `<раздел>:<элемент>`. */
export const arenaElementImageKey = (section, key, own) => (own ? `${section}:${key}` : section);

/*
 * Острова элементов места кусками: элементы без своего вида — одним куском
 * общего вида раздела (как было до деления: один слой на место), элементы
 * со своим видом — каждый своим. `[{ key, islands, shared }]`.
 */
function mergeShared(item, elements, islandsOf, placeId) {
  const shared = { key: placeId, islands: [], shared: true };
  const out = [shared];
  for (const element of elements) {
    if (arenaElementOwn(item, element.key)) out.push({ key: element.key, islands: islandsOf(element), shared: false });
    else shared.islands.push(...islandsOf(element));
  }
  return out.filter((piece) => piece.islands.length);
}

/* Лист-плашка 4×4 и меньше: красится заливкой, а не тоном. */
const isPlateRecord = (record) => Math.max(record?.width || 0, record?.height || 0) <= 8;

/* Вид элемента на целом листе: `null` — лист как в основе. */
function wholeSheetOp(section, key, look, own, record) {
  if (!look || look.mode === "standard") return null;
  if (look.mode === "image")
    return look.image?.asset && record.islands?.length ? { image: arenaElementImageKey(section, key, own), islands: record.islands, transform: look.transform } : null;
  if (look.mode === "text")
    return emblemTextFilled(look.text) && record.islands?.length ? { image: arenaElementImageKey(section, key, own), islands: record.islands, transform: look.transform } : null;
  if (look.mode === "colour") return isPlateRecord(record) ? { flat: hexBytes(look.colour) } : { tint: look.colour };
  if (look.mode === "hidden") return { transparent: true };
  return null;
}

/* Вид элемента на своих островах листа — слоем: картинка, заливка цветом, прозрачный. */
function islandLayer(section, key, look, own, islands) {
  if (!look || look.mode === "standard" || !islands.length) return null;
  if (look.mode === "image" || look.mode === "text") {
    const ready = look.mode === "text" ? emblemTextFilled(look.text) : Boolean(look.image?.asset);
    return ready ? { islands, image: arenaElementImageKey(section, key, own), transform: look.transform } : null;
  }
  if (look.mode === "colour") return { islands, transform: { ...look.transform, background: "colour", backgroundColour: look.colour } };
  if (look.mode === "hidden") return { islands, transform: { ...look.transform, background: "clear" } };
  return null;
}

/**
 * Что делать с листом зала раздела картинок (экраны, таблички, логотипы,
 * плакаты): `{ image, islands, transform }`, `{ layers }`, `{ tint }`,
 * `{ flat }`, `{ transparent }` или `null`. У места, делёного по островам, —
 * слои по элементам: у каждого свой вид или общий раздела. Одна функция у
 * кадра и у установщика.
 */
export function arenaSlotSheetOp(server, settings, record) {
  if (!record || !ARENA_SLOTS.includes(record.group)) return null;
  const section = record.group;
  const item = settings?.[section];
  if (!item) return null;
  const place = arenaTexturePlace(server, section, record.name);
  if (!place || !item.places?.[place.place]) return null;
  const elements = arenaPlaceElements(server, section, place.place);
  /* Место полотнами: лист несёт только общий вид — свой вид полотна едет
     плашкой поверх него (`arenaPanelPlates`), и лист соседей не трогает. */
  if (elements.some((element) => element.panel)) return wholeSheetOp(section, place.place, item, false, record);
  if (elements.some((element) => element.islands)) {
    const layers = mergeShared(item, elements, (element) => element.islands.map((index) => record.islands?.[index]).filter(Boolean), place.place)
      .map((piece) => islandLayer(section, piece.key, piece.shared ? item : arenaElementSettings(item, piece.key), !piece.shared, piece.islands))
      .filter(Boolean);
    return layers.length ? { layers } : null;
  }
  const element = elements.find((entry) => entry.texture === record.name) || elements[0];
  const own = arenaElementOwn(item, element?.key);
  return wholeSheetOp(section, element?.key, arenaElementSettings(item, element?.key), own, record);
}

/**
 * Свои картинки полотен (`panel`) пикселями ЛИСТА, что уже есть в модели или словаре: без плашки и без вшивки в модель зала
 * (Majestic такую модель не принимает, опыт 20.11.2026). Полотно смотрит на остров листа (`panel.texture`, `panel.island`):
 * слой на этот остров, как у мест, делёных по островам. Полотна, что смотрят на один и тот же остров, делят его: ложится последнее.
 * `{ layers }` или `null` (у листа нет такого полотна со своим видом).
 */
export function arenaPanelSheetOp(server, settings, record, { keys = null } = {}) {
  if (!record || !ARENA_SLOTS.includes(record.group)) return null;
  const section = record.group;
  const item = settings?.[section];
  if (!item) return null;
  const layers = [];
  for (const element of arenaSlotElements(server, section)) {
    const panel = element.panel;
    if (!panel || panel.texture !== record.name || !(panel.island >= 0) || !arenaElementOwn(item, element.key)) continue;
    if (keys && !keys.has(element.key)) continue;
    const island = record.islands?.[panel.island];
    if (!island) continue;
    const layer = islandLayer(section, element.key, arenaElementSettings(item, element.key), true, [island]);
    if (layer) layers.push(layer);
  }
  return layers.length ? { layers } : null;
}

/** Модели кресел, что есть у игрока (описи), — первые двадцать. */
export function arenaChairVariants() {
  const known = new Set(SERVERS.gta5rp?.chairs?.variants?.map((item) => item.archetype) || ARENA_CHAIR_CANDIDATES.map((item) => item.archetype));
  return ARENA_CHAIR_CANDIDATES.filter((item) => known.has(item.archetype)).slice(0, 20);
}

/**
 * Сдвиг по высоте другой модели кресла, м: у стадионного кресла начало
 * модели — в середине сиденья, у остальных — у пола; низ встаёт на пол.
 */
export function arenaChairLift(id) {
  const variants = SERVERS.gta5rp?.chairs?.variants || [];
  const stock = variants.find((item) => item.id === "stadium");
  const known = variants.find((item) => item.id === id);
  return stock && known ? Math.round((stock.bottom - known.bottom) * 1000) / 1000 : 0;
}

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const clampNumber = (value, [low, high], fallback, digits = 1) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const factor = 10 ** digits;
  return Math.round(Math.min(high, Math.max(low, number)) * factor) / factor;
};
/* Режим схемы 1 «как в моде»: основы-мода больше нет — это стандарт. */
const legacyMode = (mode) => (mode === "mod" ? "standard" : mode);

/*
 * Картинка раздела или элемента. `animated` — гифка (ТЗ 11.10.2026, ночь):
 * `asset` — лист кадров, `width`/`height` — размер кадра, `animation` —
 * сетка и задержки (`normalizePlaceModelAnimation`). Живой бывает только
 * своя картинка полотна (плашкой); в листе игры кадры не сменить.
 */
function normalizeImage(input, { animated = false } = {}) {
  const source = plain(input);
  const asset = IMAGE_ASSET.test(String(source.asset || "")) ? source.asset : "";
  const animation = asset && animated ? normalizePlaceModelAnimation(source.animation) : null;
  return {
    asset,
    name: asset ? String(source.name || "").slice(0, 80) : "",
    width: asset ? Math.round(Math.min(8192, Math.max(1, Number(source.width) || 1))) : 0,
    height: asset ? Math.round(Math.min(8192, Math.max(1, Number(source.height) || 1))) : 0,
    ...(animation ? { animation } : {}),
  };
}

const SURFACE_DEFAULTS = Object.freeze({
  facade: "#2f6fd6",
  floor: "#3a3f47",
  walls: "#d9d4cc",
  ceiling: "#15171b",
  plaza: "#8a8f98",
});

function normalizeSurface(id, input) {
  const source = plain(input);
  const colour = SURFACE_DEFAULTS[id] || "#808080";
  const mode = legacyMode(source.mode);
  return {
    mode: (id === "plaza" ? PLAZA_MODES : ARENA_SURFACE_MODES).includes(mode) ? mode : "standard",
    look: normalizeColourEffect(lookOf(source), { colour, colour2: "#ffffff", direction: id === "facade" ? "along" : "height" }),
    ...normalizeFinishFields(source),
  };
}

/* Места раздела: включено ли каждое (по описи сервера; неизвестные — прочь). */
function normalizePlaces(server, section, input) {
  const source = plain(input);
  const out = {};
  for (const place of arenaPlaces(server, section)) out[place.id] = typeof source[place.id] === "boolean" ? source[place.id] : Boolean(place.on);
  return out;
}

const SLOT_COLOURS = Object.freeze({ signs: "#2f80ed", posters: "#f2c94c", outBanners: "#b3262e" });
/* Свой текст по умолчанию: у надписи — штатные слова, у остальных — пусто
   (до первых слов место как в игре); на светлой табличке буквы тёмные. */
const SLOT_TEXTS = Object.freeze({
  mazeSign: Object.freeze({ value: "MAZE BANK ARENA", colour: "#f2f2f2", outline: "none" }),
  signs: Object.freeze({ value: "", colour: "#1c1d21", outline: "none" }),
});
const SLOT_TEXT = Object.freeze({ value: "", colour: "#f2f2f2", outline: "none" });

/* Вид раздела или его элемента: режим, цвет, картинка, положение, текст. */
function normalizeSlotLook(server, id, source, { animated = false } = {}) {
  const modes = arenaSectionModes(server, id);
  const legacy = legacyMode(source.mode);
  const mode = modes.includes(legacy) ? legacy : "standard";
  return {
    mode,
    colour: normalizeRecolourHex(source.colour, SLOT_COLOURS[id] || "#2f80ed"),
    image: normalizeImage(source.image, { animated }),
    transform: normalizeSlotTransform(source.transform, arenaSlotDefaults(id, mode)),
    /* Свой текст надписи: слова, шрифт, цвет — картинку из них рисует окно
       (в кадре и при «Применить»), в работе её нет. */
    ...(modes.includes("text") ? { text: normalizeEmblemText(source.text ?? SLOT_TEXTS[id] ?? SLOT_TEXT) } : {}),
  };
}

/*
 * Режимы своего вида у элемента. Полотно своим видом встаёт плашкой поверх
 * листа: «Стандарт» у него — это «как все» (своего вида нет), а «Убрать»
 * плашкой не сделать.
 */
export function arenaElementModes(server, id, element) {
  const modes = arenaSectionModes(server, id);
  return element?.panel ? modes.filter((mode) => mode !== "standard" && mode !== "hidden") : modes;
}

/** Живая ли плашка полотна (гифка) у сервера: у GTA 5 RP — сущность помещения с клипом, у Majestic — нет. */
export const arenaPanelsAnimated = (server) => server !== "majestic";

/* Свой вид элементов (задача 10): только элементы описи этого раздела. */
function normalizeElements(server, id, input) {
  const source = plain(input);
  const out = {};
  for (const element of arenaSlotElements(server, id)) {
    const raw = source[element.key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    /* Своя картинка полотна бывает живой (гифка): плашка сменяет кадры. У Majestic
       плашки вшиты в модель зала сервера, клипов у неё нет — гифка встаёт первым кадром. */
    const look = normalizeSlotLook(server, id, raw, { animated: Boolean(element.panel) && arenaPanelsAnimated(server) });
    /* Полотно без своего вида плашкой («Стандарт», «Убрать») — как все. */
    if (element.panel && !arenaElementModes(server, id, element).includes(look.mode)) continue;
    out[element.key] = look;
  }
  return out;
}

function normalizeSlot(server, id, input) {
  const source = plain(input);
  const look = normalizeSlotLook(server, id, source);
  return {
    mode: look.mode,
    colour: look.colour,
    image: look.image,
    places: normalizePlaces(server, id, source.places),
    transform: look.transform,
    ...(look.text ? { text: look.text } : {}),
    elements: normalizeElements(server, id, source.elements),
  };
}

function normalizeChoice(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}

function normalizeServer(server, input) {
  const source = plain(input);
  const sections = new Set([...ARENA_SECTIONS[server].outside, ...ARENA_SECTIONS[server].inside]);
  const out = {};
  for (const id of ARENA_SURFACES) if (id !== "plaza" || sections.has("plaza")) out[id] = normalizeSurface(id, source[id] ?? (id === "ceiling" ? source.walls : undefined));
  /* Схема 1: «эмблемы зала» — теперь логотипы с местами. */
  const legacyLogos = source.logos ?? (source.emblems && !Array.isArray(source.emblems) ? { mode: source.emblems.mode, image: source.emblems.image } : undefined);
  for (const id of ARENA_SLOTS) if (sections.has(id)) out[id] = normalizeSlot(server, id, id === "logos" ? legacyLogos : source[id]);
  if (sections.has("exits")) {
    const exits = plain(source.exits);
    out.exits = { mode: normalizeChoice(legacyMode(exits.mode), ARENA_SECTION_MODES.exits, "standard"), colour: normalizeRecolourHex(exits.colour, "#2f80ed") };
  }
  if (sections.has("lights")) {
    const lights = plain(source.lights);
    const lightsMode = normalizeChoice(legacyMode(lights.mode), ARENA_SECTION_MODES.lights, "standard");
    const lightsColour = normalizeRecolourHex(lights.colour, "#7a1fa2");
    /*
     * Чисто чёрная подсветка (#000000) — не выбор, а умолчание: у сохранённых работ нет признака «менял», а владелец арены сказал про свет «не трогал»
     * (20.11.2026), хотя поле стояло «цвет, #000000». Чёрный цвет у светящихся листов выключает плафоны и накладки света при живых лампах игры
     * (мерцание в arena5), так что такой цвет принимается за «как на сервере»; тёмно-серый (#0a0a0a и светлее) остаётся выбором.
     */
    const blackDefault = lightsMode === "colour" && lightsColour === "#000000";
    out.lights = blackDefault ? { mode: "standard", colour: "#7a1fa2" } : { mode: lightsMode, colour: lightsColour };
  }
  /* Спрайты GTA5RP — всегда убраны: прежние «показать» не возвращаются. */
  if (server === "gta5rp") out.sprites = { ...ARENA_SPRITES_GONE };
  if (sections.has("objects")) {
    const objects = plain(source.objects);
    const atms = plain(source.atms);
    out.objects = {
      vending: normalizeChoice(objects.vending, ARENA_SHOW, "show"),
      atms: normalizeChoice(objects.atms, [...ARENA_SHOW, "colour"], atms.mode === "hidden" ? "hide" : atms.mode === "colour" ? "colour" : "show"),
      atmsColour: normalizeRecolourHex(objects.atmsColour ?? atms.colour, "#2f80ed"),
      parking: normalizeChoice(objects.parking, ARENA_SHOW, "show"),
    };
  }
  if (sections.has("seats")) {
    const seats = plain(source.seats);
    const modes = arenaSectionModes(server, "seats");
    out.seats = { mode: normalizeChoice(legacyMode(seats.mode), modes, "standard"), colour: normalizeRecolourHex(seats.colour, "#b3262e") };
    if (server === "gta5rp") out.seats.model = arenaChairVariants().some((item) => item.id === seats.model) ? seats.model : "stadium";
  }
  if (sections.has("star")) {
    const star = plain(source.star);
    out.star = {
      mode: normalizeChoice(legacyMode(star.mode), ARENA_SECTION_MODES.star, "standard"),
      image: normalizeImage(star.image),
      stand: ARENA_STAR_STANDS.includes(star.stand) ? star.stand : "pedestal",
      animation: ARENA_STAR_ANIMATIONS.includes(star.animation) ? star.animation : "none",
      size: clampNumber(star.size, ARENA_STAR_LIMITS.size, 4),
      speed: clampNumber(star.speed, ARENA_STAR_LIMITS.speed, 1),
      height: clampNumber(star.height, ARENA_STAR_LIMITS.height, 0.6),
      depth: clampNumber(star.depth, ARENA_STAR_LIMITS.depth, 12, 0),
    };
  }
  /* Модели сервера своими (`arena-replace.js`): аирдропы, болид, гонщик… */
  if (sections.has("replace")) out.replace = normalizeArenaReplacements(server, source.replace);
  /* Убранные вещи зала по одной (GTA 5 RP; `arenaRemovableKeys`). */
  if (arenaRemovableKeys(server)) {
    out.removed = normalizeRemoved(server, source.removed);
    /* Свои модели и картинки вещей зала (ТЗ 27.10.2026, `arena-item-looks.js`): убранное не меняют. */
    out.items = normalizeArenaItems(source.items, { allowed: arenaRemovableKeys(server), modelOf: (key) => arenaItemModelName(server, key), removed: out.removed });
  }
  /* Покраска стен комнат (ТЗ 21.10.2026): `комната|материал` → цвет; `*` — вся арена (`arena-shell-paint.js`). */
  const shellPaint = normalizeShellPaint(source.shellPaint);
  if (Object.keys(shellPaint).length) out.shellPaint = shellPaint;
  out.emblems = normalizeEmblemList(source, (raw) => normalizeEmblem(server, raw));
  /* Свои модели (ТЗ 11.10.2026, вечер, задача 1): у каждого сервера свои, сцены — `<сервер>-inside` и `<сервер>-outside`. */
  out.models = normalizePlaceModels(source.models);
  return out;
}

/* Покраска стен: только записи «комната|материал» с цветом `#rrggbb`; пустые (`null`) — уходят. */
function normalizeShellPaint(source) {
  const out = {};
  if (!source || typeof source !== "object") return out;
  for (const [key, colour] of Object.entries(source)) {
    if (key.includes("|") && typeof colour === "string" && /^#[0-9a-f]{6}$/i.test(colour)) out[key] = colour.toLowerCase();
  }
  return out;
}

/* Место на фасаде (метры сцены «снаружи»): точка с запасом и нормаль. */
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

function normalizeEmblem(server, input) {
  const source = plain(input);
  const image = normalizeImage(source);
  const fallback = SERVERS[server]?.decal || { point: [0, 60, 20], normal: [0, 1, 0] };
  const opacity = Number(source.opacity);
  return {
    ...image,
    ...normalizePlace(source, fallback),
    size: clampNumber(source.size, ARENA_EMBLEM_SIZE, 8),
    opacity: Number.isFinite(opacity) ? Math.round(Math.min(100, Math.max(0, opacity))) : 100,
    angle: normalizeDecalAngle(source.angle),
  };
}

export function createArenasProject() {
  return normalizeArenasProject({});
}

/** Приводит работу в порядок; лишние поля отбрасываются молча. */
/*
 * Схема 3 (01.11.2026): табло турнира Majestic — 6 целых экранов, а не 7 обрезков (`arena-panels.js`: прогнутая средняя грань выпадала из описи,
 * а крайние грани двух соседних экранов слипались в «Табло 2»). Свой вид табло из работы схемы 2 и раньше переезжает на экран, где он стоял:
 * «Табло 1» — левый экран пары, «Табло 3» (правая треть второго экрана) — правый, «Табло 2» (на обоих) — туда, где места не занято;
 * 4–7 → 3–6. Без переноса картинка молча встала бы на соседнее табло, а у седьмого пропала бы.
 */
const MAJESTIC_WALLS_SCHEMA3 = Object.freeze([
  ["walls.1", ["walls.1", "walls.2"]],
  ["walls.2", ["walls.3", "walls.2"]],
  ["walls.3", ["walls.4"]],
  ["walls.4", ["walls.5"]],
  ["walls.5", ["walls.6"]],
  ["walls.6", ["walls.7"]],
]);

function majesticWallsToSchema3(source) {
  const screens = plain(plain(source.majestic).screens);
  const elements = plain(screens.elements);
  if (Number(source.schema) >= 3 || !Object.keys(elements).some((key) => key.startsWith("walls."))) return source;
  const out = Object.fromEntries(Object.entries(elements).filter(([key]) => !key.startsWith("walls.")));
  const used = new Set();
  for (const [next, from] of MAJESTIC_WALLS_SCHEMA3) {
    const key = from.find((item) => elements[item] && !used.has(item));
    if (!key) continue;
    out[next] = elements[key];
    used.add(key);
  }
  return { ...source, majestic: { ...source.majestic, screens: { ...screens, elements: out } } };
}

export function normalizeArenasProject(input) {
  const source = majesticWallsToSchema3(plain(input));
  /* Арена мода (`arena-mod.js`): работа про зал самого мода и его листы; без неё поля нет — прежние работы не меняются. */
  const mod = normalizeArenaMod(source.mod);
  return {
    schema: ARENAS_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    server: ARENA_SERVER_IDS.includes(source.server) ? source.server : "gta5rp",
    gta5rp: normalizeServer("gta5rp", source.gta5rp),
    majestic: normalizeServer("majestic", source.majestic),
    ...(mod ? { mod } : {}),
  };
}

export const serializeArenasProject = (project) => JSON.stringify(normalizeArenasProject(project));

export function parseArenasProject(text) {
  try {
    return normalizeArenasProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createArenasProject();
  }
}

/** Настройки выбранного сервера. */
export const arenaServerProject = (input) => {
  const project = normalizeArenasProject(input);
  return project[project.server];
};

/* Включённые места раздела (ид мест). */
export const arenaActivePlaces = (item) => Object.entries(item?.places || {}).filter(([, on]) => on).map(([id]) => id);

/* Место элемента по ключу: `<место>` или `<место>.<номер>`. */
export const arenaElementPlace = (key) => String(key || "").split(".")[0];

/* Вид раздела или элемента «как в игре»: стандарт, картинка без файла, пустой текст. */
const lookIsStock = (look) =>
  !look || look.mode === "standard" || (look.mode === "image" && !look.image?.asset) || (look.mode === "text" && !emblemTextFilled(look.text));

/* Свои виды элементов включённых мест: `[[ключ, вид]]`. */
function liveElements(item) {
  const places = new Set(arenaActivePlaces(item));
  return Object.entries(item?.elements || {}).filter(([key]) => places.has(arenaElementPlace(key)));
}

function lookSignature(look) {
  if (!look || look.mode === "standard") return "standard";
  const out = { mode: look.mode };
  if (look.mode === "colour") out.colour = look.colour;
  if (look.mode === "image") Object.assign(out, { image: look.image.asset, transform: look.transform, ...(look.image.animation ? { animation: look.image.animation } : {}) });
  if (look.mode === "text") Object.assign(out, { text: look.text, transform: look.transform });
  return out;
}

/* Что из настроек раздела меняет файлы — для отпечатка. */
function sectionSignature(id, item) {
  if (!item) return null;
  if (ARENA_SURFACES.includes(id)) {
    if (item.mode === "standard") return "standard";
    if (item.mode === "colour") return { mode: "colour", look: item.look };
    return finishSignature(item) || { mode: item.mode };
  }
  if (ARENA_SLOTS.includes(id)) {
    const elements = liveElements(item).map(([key, look]) => [key, lookSignature(look)]);
    if (item.mode === "standard" && !elements.length) return "standard";
    const own = lookSignature(item);
    return {
      ...(own === "standard" ? { mode: "standard" } : own),
      places: arenaActivePlaces(item),
      ...(elements.length ? { elements: Object.fromEntries(elements) } : {}),
    };
  }
  if (id === "sprites" || id === "objects") return item;
  const out = { mode: item.mode };
  if (item.mode === "colour") out.colour = item.colour;
  if (id === "seats" && item.model && item.model !== "stadium") out.model = item.model;
  if (id === "star" && item.mode === "image")
    Object.assign(out, { image: item.image.asset, stand: item.stand, animation: item.animation, size: item.size, speed: item.speed, height: item.height, depth: item.depth });
  return out;
}

/*
 * Отпечаток для очереди «Применить»: сервер и всё, что меняет его файлы.
 * Настройки другого сервера в игру не едут — и отпечаток их не держит.
 */
export function arenasProjectSignature(input) {
  const project = normalizeArenasProject(input);
  const settings = project[project.server];
  const parts = { server: project.server };
  for (const [id, item] of Object.entries(settings)) {
    if (id === "emblems" || id === "models") continue;
    /* Площадь (21.11.2026) — в отпечатке, только если её красили: у прежних работ отпечаток прежний. */
    if (id === "plaza" && item.mode === "standard") continue;
    /* Убранные вещи — в отпечатке, только если они есть: прежние отпечатки не меняются. */
    if (id === "removed") {
      if (item.length) parts.removed = item;
      continue;
    }
    if (id === "items") {
      if (item.length) parts.items = arenaItemsSignature(item);
      continue;
    }
    parts[id] = id === "replace" ? arenaReplacementsSignature(project.server, item) : sectionSignature(id, item);
  }
  Object.assign(parts, placeModelsSignatureField(settings.models));
  const modSignature = arenaModSignature(project.mod);
  if (modSignature) parts.mod = modSignature;
  Object.assign(
    parts,
    emblemSignature(settings.emblems, (item) => ({
      asset: item.asset,
      point: item.point,
      normal: item.normal,
      size: item.size,
      opacity: item.opacity,
      angle: item.angle,
    })),
  );
  return JSON.stringify(parts);
}

/* Раздел в стандартном виде? (Картинка без файла и места без картинки — тоже стандарт.) */
function sectionIsStock(id, item) {
  if (id === "emblems") return !hasEmblems(item);
  if (id === "models") return !hasPlaceModels(item);
  if (id === "removed" || id === "items") return !item.length;
  if (id === "replace") return !Object.values(item || {}).some(arenaReplaceEntryChanged);
  /* Спрайты убраны у любой поставленной работы, но сами работу не делают:
     всё остальное «Стандарт» — ставить нечего, арена как в игре. */
  if (id === "sprites") return true;
  if (id === "objects") return item.vending === "show" && item.atms === "show" && item.parking === "show";
  if (ARENA_SLOTS.includes(id)) {
    /* Свой вид хотя бы одного элемента включённого места — уже работа. */
    if (liveElements(item).some(([, look]) => !lookIsStock(look))) return false;
    if (lookIsStock(item)) return true;
    return !arenaActivePlaces(item).length;
  }
  if (id === "star") return item.mode === "standard" || (item.mode === "image" && !item.image.asset);
  if (id === "seats") return item.mode === "standard" && (!item.model || item.model === "stadium");
  return item.mode === "standard";
}

/**
 * «Стандарт»: у выбранного сервера всё как в игре (GTA5RP) или как на
 * сервере (Majestic), эмблемы нет — ставить нечего, «Применить» снимает
 * файлы Astral.
 */
export function arenasProjectIsStock(input) {
  const project = normalizeArenasProject(input);
  return arenaModIsStock(project.mod) && Object.entries(project[project.server]).every(([id, item]) => sectionIsStock(id, item));
}

/* Основы-мода больше нет: «как в моде» и «стандарт» — одно и то же. */
export const arenasProjectIsMod = arenasProjectIsStock;

/**
 * Уходит ли затенение под креслами (`ARENA_SEAT_SHADOWS`): свой пол, кресла
 * убраны или другая модель кресла. Только GTA5RP.
 */
export function arenaSeatShadowsHidden(input, server = null) {
  const project = normalizeArenasProject(input);
  const id = server || project.server;
  if (!ARENA_SEAT_SHADOWS[id]) return false;
  const settings = project[id];
  return settings.floor?.mode !== "standard" || settings.seats?.mode === "hidden" || Boolean(settings.seats?.model && settings.seats.model !== "stadium");
}

/** «Как было» у выбранного сервера: другой сервер и имя работы не трогаются. */
export function resetArenasServer(input) {
  const project = normalizeArenasProject(input);
  return { ...project, [project.server]: createArenasProject()[project.server] };
}

/** Работа «Стандарт» целиком — кнопка «Стандарт» одним шагом (картинки помнятся). */
export function applyArenasStandard(input) {
  const project = normalizeArenasProject(input);
  const server = project.server;
  const settings = project[server];
  const next = {};
  for (const [id, item] of Object.entries(settings)) {
    if (id === "emblems") next[id] = [];
    /* Свои модели «Стандарт» не трогает: это не облик арены, а добавленное человеком. */
    else if (id === "models") next[id] = item;
    /* «Стандарт» возвращает убранные вещи: арена как в игре. */
    else if (id === "removed" || id === "items") next[id] = [];
    else if (id === "sprites") next[id] = item;
    else if (id === "objects") next[id] = { ...item, vending: "show", atms: "show", parking: "show" };
    /* Замены — модели сервера на месте и со своими надписями; выбранные свои модели и слова помнятся. */
    else if (id === "replace")
      next[id] = Object.fromEntries(
        Object.entries(item).map(([key, entry]) => [key, { ...entry, mode: "standard", ...(entry.sign ? { sign: { ...entry.sign, mode: "standard" } } : {}) }]),
      );
    /* Свои виды элементов «Стандарт» снимает: всё снова «Все сразу». */
    else next[id] = { ...item, mode: "standard", ...(id === "seats" && item.model ? { model: "stadium" } : {}), ...(item.elements ? { elements: {} } : {}) };
  }
  /* Листы мода «Стандарт» возвращает как у мода; сам открытый мод остаётся. */
  return { ...project, [server]: next, ...(project.mod ? { mod: { ...project.mod, sheets: {} } } : {}) };
}

/* Код для друга: свои картинки живут в окне автора и в код не едут. */
export function shareableArenasProject(input) {
  const project = normalizeArenasProject(input);
  const empty = { asset: "", name: "", width: 0, height: 0 };
  const stripLook = (look) => ({ ...look, image: empty, ...(look.mode === "image" ? { mode: "standard" } : {}) });
  const strip = (settings) => {
    const out = {};
    for (const [id, item] of Object.entries(settings)) {
      if (item?.image)
        out[id] = {
          ...stripLook(item),
          ...(item.elements ? { elements: Object.fromEntries(Object.entries(item.elements).map(([key, look]) => [key, stripLook(look)])) } : {}),
        };
      else if (id === "emblems") out[id] = shareableEmblems(item);
      else if (id === "models") out[id] = [];
      /* Свои модели вместо моделей сервера остаются у автора; «Убрать» и надпись домика (словами) едут. */
      else if (id === "replace")
        out[id] = Object.fromEntries(
          Object.entries(item)
            .filter(([, entry]) => entry.mode === "hidden" || entry.sign)
            .map(([key, entry]) => [key, { mode: entry.mode === "hidden" ? "hidden" : "standard", ...(entry.sign ? { sign: entry.sign } : {}), scale: entry.scale, turn: entry.turn }]),
        );
      else out[id] = item;
    }
    return out;
  };
  return { ...project, gta5rp: strip(project.gta5rp), majestic: strip(project.majestic) };
}

export function arenasLostInCode(input) {
  const project = normalizeArenasProject(input);
  const settings = project[project.server];
  /* Свой текст надписи едет словами — окно друга нарисует его заново. */
  const lostLook = (look) => look?.mode !== "text" && look?.image?.asset;
  const lost = Object.entries(settings).some(([id, item]) =>
    id === "emblems" ? emblemsLostInCode(item) : id === "models" || id === "replace" || id === "removed" || id === "items" ? false : lostLook(item) || Object.values(item?.elements || {}).some(lostLook),
  );
  const replaced = Object.values(settings.replace || {}).some((entry) => entry.mode === "model");
  /* Свои модели и картинки вещей зала (`items`) — файлы и картинки этого компьютера: в код работы не едут. */
  return joinLostInCode(lost ? "свои картинки (остаются на этом компьютере)" : "", placeModelsLostInCode(settings.models), replaced ? "свои модели вместо моделей сервера" : "", settings.items?.some((entry) => entry.model) ? "свои модели и картинки вещей зала" : "");
}

/* ------------------------------------------------------------------ *
 * Облик листа
 * ------------------------------------------------------------------ */

/** Настройки группы листа у сервера: поверхность или раздел. */
export function arenaGroupSettings(input, server, group) {
  const project = normalizeArenasProject(input);
  return project[server]?.[group] || null;
}

/**
 * Слои листа фасада снаружи (запись описи с `regions`, задача 6): у каждого
 * включённого места своего раздела — свой слой по своим островам.
 * `{ islands, image?: <раздел>, transform, clear? }` — `image` — ключ
 * картинки раздела (своя картинка или нарисованный окном текст), `clear` —
 * сперва стереть остров куском того же листа (прежний логотип). Одна функция
 * у кадра и у установщика.
 */
export function arenaOutsideLayers(settings, record, server = "gta5rp") {
  const layers = [];
  for (const region of record?.regions || []) {
    const item = settings?.[region.section];
    if (!item || !item.places?.[region.place]) continue;
    const clear = region.clear ? { clear: region.clear } : {};
    const elements = arenaPlaceElements(server, region.section, region.place);
    /* Делёное по островам место — по элементу на свои острова; полотна у
       арок — общий вид раздела на общем листе (у полотна со своим видом —
       свой словарь, `arenaClothJobs`); остальное — место целиком. */
    const pieces = elements.some((element) => element.islands)
      ? mergeShared(item, elements, (element) => element.islands.map((index) => region.islands[index]).filter(Boolean), region.place)
      : [{ key: region.place, islands: region.islands, shared: elements.some((element) => element.cloth) }];
    for (const piece of pieces) {
      const own = !piece.shared && arenaElementOwn(item, piece.key);
      const look = own ? arenaElementSettings(item, piece.key) : item;
      if (!look || look.mode === "standard" || !piece.islands.length) continue;
      const image = arenaElementImageKey(region.section, piece.key, own);
      if (look.mode === "image" || look.mode === "text") {
        if (look.mode === "text" ? emblemTextFilled(look.text) : look.image?.asset) layers.push({ islands: piece.islands, image, transform: look.transform, ...clear });
      } else if (look.mode === "colour") layers.push({ islands: piece.islands, transform: { ...look.transform, background: "colour", backgroundColour: look.colour } });
      else if (look.mode === "hidden") layers.push({ islands: piece.islands, transform: { ...look.transform, background: "keep" }, ...clear });
    }
  }
  return layers;
}

/*
 * Полотна у арок со своим видом (задача 10): 18 моделей фасада
 * (`sp1_10_brand_01_clothNN`) с одним листом `xj_v_fameorshamebanner`
 * словаря `sp1_10_stadium`. Своё полотно — свой словарь из одного этого листа
 * (`astral_arenas_bNN`, его собирает нативный хост) и своя ссылка архетипа
 * на него в типах района (`ARENA_CLOTH_TYPES`). Остальные полотна — общий вид
 * раздела на общем листе.
 */
export const ARENA_CLOTH_TEXTURE = "xj_v_fameorshamebanner";
export const ARENA_CLOTH_TYPES = Object.freeze({
  name: "sanpedro_metadata_004_strm.ytyp",
  at: "x64m.rpf:levels/gta5/_cityw/sanpedro_01/sanpedro_metadata.rpf/sanpedro_metadata_004_strm.ytyp",
});
export const arenaClothTxd = (cloth) => `astral_arenas_b${cloth}`;

/*
 * Полотна вдали (проверка в игре 10.10.2026): дальше 90 м вместо модели
 * полотна игра ставит его дальнюю модель — плоскость `sp1_10_brand_01_
 * clothNN_lod` (номер у неё свой) с общим листом `sp1_10_banners_lod`
 * словаря `sp1_10_lod`, и полотно снова было штатным. У полотен этот лист
 * — нижняя половина: слева один рисунок, справа другой, дальняя модель
 * берёт свою половину. Свой вид полотна вдали — тот же лист в его словаре
 * (обе половины — его видом) и ссылка архетипа дальней модели на словарь;
 * общий вид раздела — в обеих половинах листа игры. Какая дальняя модель
 * у полотна — родитель сущности полотна в карте квартала (`maps`).
 */
const SANPEDRO = "x64m.rpf:levels/gta5/_cityw/sanpedro_01";
export const ARENA_CLOTH_LOD = Object.freeze({
  texture: "sp1_10_banners_lod",
  file: "sp1_10_lod.ytd",
  at: `${SANPEDRO}/sp1_10.rpf/sp1_10_lod.ytd`,
  types: Object.freeze({ name: "sanpedro_metadata_003.ytyp", at: `${SANPEDRO}/sanpedro_metadata.rpf/sanpedro_metadata_003.ytyp` }),
  maps: Object.freeze({
    hd: Object.freeze([`${SANPEDRO}/sanpedro_metadata.rpf/sp1_10_strm_0.ymap`, `${SANPEDRO}/sanpedro_metadata.rpf/sp1_10_strm_1.ymap`]),
    parent: `${SANPEDRO}/sanpedro_metadata.rpf/sp1_10.ymap`,
  }),
  /* Половины листа под полотна — по развёртке дальних моделей; пропорции — полотна.
     Лицевая грань дальней модели (снаружи арены) развёрнута зеркально — u
     растёт справа налево (штатный рисунок вдали читается наоборот, с 300 м
     этого не видно): своя картинка и текст кладутся зеркально, чтобы снаружи
     читаться как вблизи (проверка в игре 10.10.2026: «18» вдали было «81»). */
  islands: Object.freeze([
    Object.freeze({ rect: Object.freeze([0, 0.5, 0.5, 1]), swap: false, flipU: true, flipV: false, aspect: 0.278 }),
    Object.freeze({ rect: Object.freeze([0.5, 0.5, 1, 1]), swap: false, flipU: true, flipV: false, aspect: 0.278 }),
  ]),
});

/** Имена словарей всех полотен и типов с их архетипами — для доверия пакету. */
export const arenaClothFiles = () => [...clothPlacements("gta5rp").map((cloth) => `${arenaClothTxd(cloth.number)}.ytd`), ARENA_CLOTH_TYPES.name, ARENA_CLOTH_LOD.types.name];

/**
 * Общий вид раздела на дальнем листе полотен: слои нижних половин
 * `sp1_10_banners_lod` (как у листа полотен вблизи) или пусто.
 */
export function arenaClothLodLayers(settings, server = "gta5rp") {
  const region = { section: "outBanners", place: "cloth", islands: ARENA_CLOTH_LOD.islands };
  return arenaOutsideLayers(settings, { regions: [region] }, server);
}

/**
 * Полотна со своим видом: `[{ key, label, cloth, model, look, image, txd }]`.
 * Полотно, чей свой вид — «Стандарт», едет, только если у раздела не
 * стандарт: тогда у него штатный лист, а у остальных — общий вид.
 */
export function arenaClothJobs(input, server = null) {
  const project = normalizeArenasProject(input);
  const id = server || project.server;
  const item = project[id]?.outBanners;
  if (!item?.places?.cloth) return [];
  const sectionStock = lookIsStock(item);
  return arenaPlaceElements(id, "outBanners", "cloth")
    .filter((element) => element.cloth && arenaElementOwn(item, element.key))
    .map((element) => ({ ...element, look: item.elements[element.key], image: arenaElementImageKey("outBanners", element.key, true), txd: arenaClothTxd(element.cloth) }))
    .filter((job) => !(lookIsStock(job.look) && sectionStock));
}

/** Место листа в разделе: `{ section, place }` или `null`. */
export function arenaTexturePlace(server, section, texture) {
  const place = arenaPlaces(server, section).find((item) => item.textures.includes(texture));
  return place ? { section, place: place.id } : null;
}

/**
 * Эмблемы на фасаде: `[{ id, asset, point, normal, width, height, opacity,
 * angle }]` в метрах сцены «снаружи».
 */
export function arenaEmblemDecals(input, server = null) {
  const project = normalizeArenasProject(input);
  return readyEmblems(project[server || project.server].emblems).map((item) => emblemDecal(item));
}

/** Плашки эмблем в мире: место в координатах игры — для `compile-emblem-plates`. */
/* Отступ плашки от поверхности: на отвесной стене — прежний (3 см, шаг 1 см), на полу площади (нормаль вверх или вниз, только при включённой площади) — 2 см:
   достаточно, чтобы плашка не мерцала с плиткой, и не настолько много, чтобы под ней была видна щель. Столкновений у плашки нет (архетип без физики, `EmblemPlateCommands.cs`). */
const PLATE_FLOOR_START = 0.02;
const PLATE_FLOOR_STEP = 0.01;
export function arenaEmblemPlateOffset(index, normal = null) {
  const flat = PLAZA_ON && Array.isArray(normal) && Math.abs(Number(normal[2])) > 0.9;
  return flat ? Math.round((PLATE_FLOOR_START + index * PLATE_FLOOR_STEP) * 1000) / 1000 : emblemPlateOffset(index);
}

export function arenaEmblemPlates(input, server = null) {
  const project = normalizeArenasProject(input);
  const id = server || project.server;
  const origin = arenaScene(id, "outside")?.origin || SERVERS[id]?.origins?.outside || [0, 0, 0];
  return arenaEmblemDecals(project, id).map((decal, index) => {
    const place = decalPlacement(decal, { offset: arenaEmblemPlateOffset(index, decal.normal) });
    return {
      id: decal.id,
      asset: decal.asset,
      name: emblemPlateName(ARENA_PLATE.model, index),
      position: place.position.map((value, axis) => Math.round((value + origin[axis]) * 1000) / 1000),
      rotation: place.rotation,
      size: place.size,
      lodDist: ARENA_PLATE.lodDist,
      opacity: decal.opacity,
    };
  });
}

/*
 * Объёмные места над главным входом GTA5RP (задача 6): буквы MAZE BANK ARENA
 * (место `portal` раздела «Надпись»), белый щит PANIC и знак Maze Bank
 * (места `shield` и `maze` раздела «Логотипы снаружи») — модели, а не
 * рисунок листа. Своя надпись или эмблема встаёт на их место своей плашкой
 * (`compile-emblem-plates`, имена — `ARENA_COVER_PLATES`), а их треугольники
 * сводятся в точку в моделях игры (`erase` описи); «Убрать» — только
 * стирание. Место в описи: `cover: { point, normal, width, height, erase }`.
 */
export const ARENA_COVER_PLATES = Object.freeze({
  portal: "astral_arenas_cover_portal",
  shield: "astral_arenas_cover_shield",
  maze: "astral_arenas_cover_maze",
});
/* Плашка места чуть перед лицом прежних букв или щита — без мерцания. */
const COVER_OFFSET = 0.02;

/** Объёмные места сервера: `[{ section, place, label, cover }]`. */
export function arenaCovers(server) {
  const out = [];
  for (const [section, places] of Object.entries(SERVERS[server]?.places || {}))
    for (const place of places) if (place.cover) out.push({ section, place: place.id, label: place.label, cover: place.cover });
  return out;
}

/*
 * Объёмные места, которые работа меняет: раздел не «Стандарт», место
 * включено и есть чем заменить (слова, картинка) или «Убрать». `plate` —
 * встаёт ли на место своя плашка.
 */
export function arenaActiveCovers(input, server = null) {
  const project = normalizeArenasProject(input);
  const id = server || project.server;
  const settings = project[id];
  const out = [];
  for (const entry of arenaCovers(id)) {
    const section = settings?.[entry.section];
    if (!section || !section.places?.[entry.place]) continue;
    /* Объёмное место — один элемент (ключ — ид места): свой вид или общий. */
    const own = arenaElementOwn(section, entry.place);
    const item = arenaElementSettings(section, entry.place);
    if (!item || item.mode === "standard") continue;
    const plate = item.mode === "text" ? emblemTextFilled(item.text) : item.mode === "image" ? Boolean(item.image?.asset) : false;
    if (!plate && item.mode !== "hidden") continue;
    out.push({ ...entry, item, plate, image: arenaElementImageKey(entry.section, entry.place, own) });
  }
  return out;
}

/** Прячет ли кадр объёмное место (`cover:<место>` сцены). */
export const arenaCoverHidden = (input, server, place) => arenaActiveCovers(input, server).some((entry) => entry.place === place);

/** Что сводить в точку в моделях игры: `[{ key, erase }]` (одна запись — модель места). */
export function arenaCoverErasures(input, server = null) {
  return arenaActiveCovers(input, server).flatMap((entry) => entry.cover.erase.map((erase) => ({ key: `${entry.section}:${entry.place}`, erase })));
}

/**
 * Плашки объёмных мест в мире: `[{ key, section, place, name, decal,
 * position, rotation, size, lodDist, opacity }]` — `decal` в метрах сцены
 * «снаружи» (кадр), остальное — для `compile-emblem-plates`.
 */
export function arenaCoverPlates(input, server = null) {
  const project = normalizeArenasProject(input);
  const id = server || project.server;
  const origin = arenaScene(id, "outside")?.origin || SERVERS[id]?.origins?.outside || [0, 0, 0];
  return arenaActiveCovers(project, id)
    .filter((entry) => entry.plate && ARENA_COVER_PLATES[entry.place])
    .map((entry) => {
      const decal = { point: entry.cover.point, normal: entry.cover.normal, width: entry.cover.width, height: entry.cover.height, angle: 0 };
      const place = decalPlacement(decal, { offset: COVER_OFFSET });
      return {
        key: `${entry.section}:${entry.place}`,
        section: entry.section,
        place: entry.place,
        /* Ключ картинки и вид места: свой элемента или общий раздела. */
        image: entry.image,
        look: entry.item,
        name: ARENA_COVER_PLATES[entry.place],
        decal,
        position: place.position.map((value, axis) => Math.round((value + origin[axis]) * 1000) / 1000),
        rotation: place.rotation,
        size: place.size,
        lodDist: ARENA_PLATE.lodDist,
        opacity: 1,
      };
    });
}

/* Сторона картинки плашки места, px: длинная — 1024, короткая — по пропорции. */
export function arenaCoverPixels(cover) {
  const aspect = cover.width / Math.max(0.01, cover.height);
  return aspect >= 1 ? [1024, Math.max(16, Math.round(1024 / aspect))] : [Math.max(16, Math.round(1024 * aspect)), 1024];
}

/**
 * Картинка плашки объёмного места: своя картинка или нарисованный окном
 * текст (`picture` — `{ rgba, width, height }`) в рамку места тем же
 * способом, что и в листах (`placeImageInIslands`: вписать, размер, поворот,
 * сдвиг, фон). Фон «Как было» — прозрачный: за плашкой — стена входа, буквы
 * игры стёрты. Одна функция у кадра и у установщика. `{ rgba, width, height }`.
 */
export function arenaCoverPicture(item, picture, cover) {
  const [width, height] = arenaCoverPixels(cover);
  const rgba = new Uint8ClampedArray(width * height * 4);
  placeImageInIslands(rgba, width, height, [{ rect: [0, 0, 1, 1] }], picture, item.transform);
  return { rgba, width, height };
}

/* ------------------------------------------------------------------ *
 * Полотна по одному (ТЗ 11.10.2026, ночь, задача 2)
 * ------------------------------------------------------------------ */

/* Сколько сторон полотен встаёт плашками: столько моделей держит набор
   (`PLACE_MODEL_LIMIT`) — восемь двусторонних баннеров или шестнадцать экранов. */
export const ARENA_PANEL_FACE_LIMIT = 16;
/*
 * У Majestic плашки вшиваются в модель зала, а не сущностями набора: предел —
 * размер модели зала (16 МБ), его держат 64 плашки (листы мелких экранов —
 * по 256 px). Столько, чтобы у каждого планшета, монитора и картины была своя.
 */
export const ARENA_PANEL_FACE_LIMITS = Object.freeze({ gta5rp: ARENA_PANEL_FACE_LIMIT, majestic: 64 });
export const arenaPanelFaceLimit = (server) => ARENA_PANEL_FACE_LIMITS[server] || ARENA_PANEL_FACE_LIMIT;

/**
 * Полотна со своим видом — плашками поверх листа: `[{ key, section, place,
 * label, panel, look, image, faces }]` (`faces` — стороны, `arenaPanelFaces`;
 * `image` — ключ картинки элемента у главного процесса, у цвета — `null`).
 * Только включённые места и виды, которым есть что показать; сторон — не
 * больше `ARENA_PANEL_FACE_LIMIT`, по порядку разделов и номеров (лишние —
 * `{ over: true }`: кадр и установщик их не ставят, панель говорит об этом).
 */
export function arenaPanelPlates(input, server = null) {
  const project = normalizeArenasProject(input);
  const id = server || project.server;
  const settings = project[id];
  const out = [];
  const ready = (look) => look && (look.mode === "colour" || (look.mode === "image" && Boolean(look.image?.asset)) || (look.mode === "text" && emblemTextFilled(look.text)));
  for (const section of ARENA_SLOTS) {
    const item = settings?.[section];
    if (!item) continue;
    const own = new Map(liveElements(item));
    for (const element of arenaSlotElements(id, section)) {
      if (!element.panel) continue;
      /* Своя картинка полотна — плашкой; у мест без листа в наборе и «Все сразу» — плашкой на каждое полотно. */
      const mine = own.get(element.key);
      const shared = !mine && arenaPlacePlated(id, section, element.place) && item.places?.[element.place] ? item : null;
      const look = mine || shared;
      if (!ready(look)) continue;
      out.push({
        key: element.key,
        section,
        place: element.place,
        label: element.label,
        panel: element.panel,
        look,
        image: look.mode === "colour" ? null : arenaElementImageKey(section, mine ? element.key : null, Boolean(mine)),
        faces: arenaPanelFaces(element.panel),
      });
    }
  }
  let faces = 0;
  const limit = arenaPanelFaceLimit(id);
  return out.map((plate) => {
    faces += plate.faces.length;
    return faces > limit ? { ...plate, over: true } : plate;
  });
}

/**
 * Доля картинки полотна для стороны-грани изогнутого экрана (`face.crop` —
 * `[s0, s1]` ширины): столбцы картинки этой грани. Без `crop` — вся
 * картинка. Одна функция у кадра и у установщика.
 */
export function arenaPanelFacePicture(pixels, face) {
  if (!face?.crop) return pixels;
  const x0 = Math.max(0, Math.min(pixels.width - 1, Math.round(face.crop[0] * pixels.width)));
  const x1 = Math.max(x0 + 1, Math.min(pixels.width, Math.round(face.crop[1] * pixels.width)));
  const width = x1 - x0;
  const rgba = new Uint8ClampedArray(width * pixels.height * 4);
  for (let y = 0; y < pixels.height; y += 1) rgba.set(pixels.rgba.subarray((y * pixels.width + x0) * 4, (y * pixels.width + x1) * 4), y * width * 4);
  return { rgba, width, height: pixels.height };
}

/**
 * Картинка плашки полотна: свой цвет — заливкой, своя картинка или
 * нарисованный окном текст (`picture` — `{ rgba, width, height }`) — в рамку
 * полотна тем же способом, что в листе (`placeImageInIslands`: вписать,
 * размер, поворот, сдвиг, фон). Фон «Как было» — прозрачный: сквозь него
 * видно само полотно. Одна функция у кадра и у установщика.
 */
export function arenaPanelPicture(look, picture, panel) {
  const [width, height] = arenaPanelPixels(panel);
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (look.mode === "colour") {
    const [r, g, b] = hexBytes(look.colour);
    for (let at = 0; at < rgba.length; at += 4) {
      rgba[at] = r;
      rgba[at + 1] = g;
      rgba[at + 2] = b;
      rgba[at + 3] = 255;
    }
    return { rgba, width, height };
  }
  if (picture) placeImageInIslands(rgba, width, height, [{ rect: [0, 0, 1, 1], aspect: panel.width / Math.max(0.01, panel.height) }], picture, look.transform);
  return { rgba, width, height };
}

/* Сторона атласа живой плашки полотна, px (как у живых моделей мест). */
export const ARENA_PANEL_ATLAS_SIDE = 2048;

/**
 * Живая картинка полотна (гифка): каждый кадр листа кадров (`picture` —
 * `{ rgba, width, height }`, клетки `animation.columns` × `rows`) — в
 * рамку полотна тем же способом, что `arenaPanelPicture`, и в свою клетку
 * нового листа той же сетки. `{ rgba, width, height, frame: [w, h],
 * animation }` — `frame` — размер клетки (пропорции полотна). Одна
 * функция у кадра и у установщика.
 */
export function arenaPanelAtlas(look, picture, panel) {
  const animation = look.image?.animation;
  if (!animation || !picture) return null;
  const { columns, rows } = animation;
  const long = Math.min(1024, Math.floor(ARENA_PANEL_ATLAS_SIDE / Math.max(columns, rows)));
  const aspect = panel.width / Math.max(0.01, panel.height);
  const cell = aspect >= 1 ? [long, Math.max(8, Math.round(long / aspect))] : [Math.max(8, Math.round(long * aspect)), long];
  const width = cell[0] * columns;
  const height = cell[1] * rows;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const source = [Math.floor(picture.width / columns), Math.floor(picture.height / rows)];
  for (let frame = 0; frame < animation.frames; frame += 1) {
    const cx = frame % columns;
    const cy = Math.floor(frame / columns);
    /* Кадр гифки — клетка её листа. */
    const piece = new Uint8ClampedArray(source[0] * source[1] * 4);
    for (let y = 0; y < source[1]; y += 1) {
      const from = ((cy * source[1] + y) * picture.width + cx * source[0]) * 4;
      piece.set(picture.rgba.subarray(from, from + source[0] * 4), y * source[0] * 4);
    }
    const one = new Uint8ClampedArray(cell[0] * cell[1] * 4);
    placeImageInIslands(one, cell[0], cell[1], [{ rect: [0, 0, 1, 1], aspect }], { rgba: piece, width: source[0], height: source[1] }, look.transform);
    for (let y = 0; y < cell[1]; y += 1) rgba.set(one.subarray(y * cell[0] * 4, (y + 1) * cell[0] * 4), ((cy * cell[1] + y) * width + cx * cell[0]) * 4);
  }
  return { rgba, width, height, frame: cell, animation };
}

/** Картинки работы (ключи хранилища окна) — что уедет главному процессу. */
export function arenaImageAssets(input) {
  const project = normalizeArenasProject(input);
  const settings = project[project.server];
  const out = {};
  const emblems = emblemAssets(settings.emblems);
  if (emblems.length) out.emblems = emblems;
  for (const id of ARENA_SLOTS) {
    const item = settings[id];
    if (!item) continue;
    if (item.mode === "image" && item.image.asset && arenaActivePlaces(item).length) out[id] = item.image.asset;
    /* Свой текст — картинкой окна: `"text"` вместо ключа хранилища. */
    if (item.mode === "text" && emblemTextFilled(item.text) && arenaActivePlaces(item).length) out[id] = "text";
    /* Свои картинки и тексты элементов — по ключу `<раздел>:<элемент>`. */
    for (const [key, look] of liveElements(item)) {
      if (look.mode === "image" && look.image.asset) out[arenaElementImageKey(id, key, true)] = look.image.asset;
      if (look.mode === "text" && emblemTextFilled(look.text)) out[arenaElementImageKey(id, key, true)] = "text";
    }
  }
  if (settings.star?.mode === "image" && settings.star.image.asset) out.star = settings.star.image.asset;
  /* Своя картинка листа мода (арена мода, 28.10.2026): `mod:<лист>`. */
  for (const [sheet, asset] of Object.entries(arenaModSheetImages(project.mod))) out[arenaModImageKey(sheet)] = asset;
  /* Своя надпись на домике (Majestic) — тоже картинкой окна: `sign:<модель>`. */
  for (const { id, sign } of activeArenaSigns(project.server, settings.replace)) if (sign.mode === "text") out[`sign:${id}`] = "text";
  return out;
}

/**
 * Слова надписи под ключом картинки `"text"` (`arenaImageAssets`): своего
 * текста раздела (`screens`), элемента (`posters:show.3`) или надписи на
 * домике (`sign:stand`). `null` — у ключа нет слов.
 */
export function arenaPictureText(settings, key) {
  const [section, element] = String(key || "").split(":");
  if (section === "sign") return settings?.replace?.[element]?.sign?.text || null;
  const look = element ? settings?.[section]?.elements?.[element] : settings?.[section];
  return look?.text || null;
}

/**
 * Свои модели вместо моделей сервера («Своя модель») и свои модели и картинки
 * вещей зала — записями «Моделей» мест: их картинки и сетки окно отдаёт и
 * установщик читает тем же путём, что и у своих моделей
 * (`placeModelImages` / `decodePlaceModelImages`).
 */
export function arenaReplacementModels(input) {
  const project = normalizeArenasProject(input);
  const settings = project[project.server];
  return [
    ...activeArenaReplacements(project.server, settings.replace)
      .filter(({ entry }) => entry.mode === "model")
      .map(({ entry }) => ({ ...entry.model, position: [0, 0, 0] })),
    /* Облик вещей зала (`items`) — тот же разбор: своя картинка или сетка группы, картинки на элементах. */
    ...itemLookModels(settings.items, (entry) => arenaItemModelName(project.server, entry.keys?.[0])),
  ];
}

/**
 * Картинка грани надписи на домике: нарисованный окном текст (`picture` —
 * `{ rgba, width, height }`) вписан в грань (`face` — `arenaSignFaces`) по
 * середине. Фон: `background` — цвет бруска (`#rrggbb`, грань целиком), без
 * него — прозрачный (сквозь плашку видно стену). Одна функция у кадра и у
 * установщика. `{ rgba, width, height }`.
 */
export function arenaSignPicture(picture, face, background = null) {
  const [width, height] = arenaPanelPixels(face);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const transform = normalizeSlotTransform(background ? { fit: "contain", background: "colour", backgroundColour: background } : { fit: "contain", background: "clear" });
  if (background) {
    const [r, g, b] = hexBytes(background);
    for (let at = 0; at < rgba.length; at += 4) rgba.set([r, g, b, 255], at);
  }
  if (picture) placeImageInIslands(rgba, width, height, [{ rect: [0, 0, 1, 1], aspect: face.width / Math.max(0.01, face.height) }], picture, transform);
  return { rgba, width, height };
}

/** Строка того, что уедет в игру, — под кадром. */
export function arenaPlanText(input) {
  const project = normalizeArenasProject(input);
  const settings = project[project.server];
  const label = ARENA_SERVERS.find((item) => item.id === project.server)?.label || project.server;
  if (arenasProjectIsStock(project))
    return project.server === "majestic"
      ? `${label}: арена сервера как есть — файлы Astral снимаются, ставить нечего.`
      : `${label}: стандартная арена игры — файлы Astral снимаются, ставить нечего.`;
  const changed = Object.entries(settings)
    .filter(([id, item]) => !sectionIsStock(id, item))
    .map(([id]) => ARENA_SECTION_LABELS[id]?.toLowerCase())
    .filter(Boolean);
  const base = project.server === "majestic" ? "стандартная арена сервера" : "стандартная арена игры";
  return `${label}: ${base} и свой облик — ${changed.join(", ")}.`;
}
