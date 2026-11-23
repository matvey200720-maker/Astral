import { createHash } from "node:crypto";
import { RECOLOR_SET_ELEMENT_FILES, RECOLOR_SET_FILES, RECOLOR_SET_LOCAL_FILES, RECOLOR_SET_LOCAL_REPLACED, RECOLOR_SET_LOD_FILES } from "./recolor-sets.js";
import { isArenaMapFile, isPlacesHeiFile, PLACES_DLC_CAPABILITY, PLACES_DLC_TARGET, PLACES_MAP_SETS, placesArchiveOf, placesStreamOf } from "./places-dlc.js";
import { SHOPS_TRUST_FILES, SHOPS_TRUST_OVERRIDES } from "./shops-trust.js";
import { BILLBOARDS_TRUST_FILES, BILLBOARDS_TRUST_OVERRIDES } from "./billboards-trust.js";
/* «Флаги» (задача 7 ТЗ 10.10.2026, вечер). */
import { FLAGS_TRUST_FILES } from "./flags-trust.js";

/*
 * Наборы перекраски мастерской (места) — каждый в своём потоковом архиве
 * пакета мест Astral.
 *
 * Редакторы «Запретные зоны», «Завод», «Ангар» и «Маппинг» ставят файлы
 * своего мода, перекрашенные на месте (текстуры и свечение — те же длины и
 * раскладка): модели, словари текстур, а где мод их везёт — карту, типы,
 * коллизию и `_manifest.ymf`. У каждого набора свой потоковый архив
 * `astral_<набор>.rpf` пакета `astral_places` (`places-dlc.js`) и свой
 * слот: наборы ставятся и снимаются порознь и не делят `_manifest.ymf` с
 * чужими модами.
 *
 * Схема 2 (фикс 1 ТЗ 06.10.2026): до неё набор лежал в контейнере
 * update.rpf (`x64/astral/astral_<набор>.rpf`), и всё, что Rockstar
 * перевыпустила в своих пакетах (типы и карты районов в `patchday1ng`/
 * `patchday2ng`), игра брала из пакета, а не у Astral — дальние модели мест
 * оставались штатными. Пакет мест грузится после пакетов Rockstar.
 * Установки схемы 1 узнаются по id и уходят заменой: хэш содержимого схемы
 * 2 другой, даже если файлы те же.
 *
 * Схема 3 (тот же день): карты, типы и манифест места — в своём архиве
 * пакета (`astral_<набор>_metadata.rpf`, данные карты пакета), модели и
 * словари — в потоковом (`astral_<набор>.rpf`). Одним архивом пакет
 * ронял игру на загрузке.
 *
 * Строгая форма: ровно файлы набора (`recolor-sets.js`, копия описи
 * `@modovik/climb-contract/recolor/inventory` — нарочно здесь, чтобы
 * проверку нельзя было ослабить правкой чужого пакета; совпадение держит
 * тест) и ничего сверх. Символ доверия предъявить может только
 * install-engine.
 */
export const LOCAL_RECOLOR_TRUST = Symbol("local-recolor-package");
/* 3 — данные карты места в своём архиве пакета; 4 — свои новые карты,
   типы и манифест места — в контейнер update.rpf, пакету мест — только
   перекрытия файлов игры (`recolorRouteOf`). */
export const RECOLOR_SCHEMA = 4;

const MiB = 1024 * 1024;

/* Плашки эмблем и надписей: модель на каждую, до шестнадцати (`EMBLEM_LIMIT`
   договора `emblems.js`): первая зовётся по имени набора, остальные — с номером. */
const plateModels = (model) => withFarModels(Array.from({ length: 16 }, (_, index) => `${index ? `${model}_${index + 1}` : model}.ydr`));
/* У каждой плашки может быть дальняя копия своей моделью `<имя>_far.ydr` (падение 30.10.2026). */
function withFarModels(names) {
  return names.flatMap((name) => [name, name.replace(/\.ydr$/, "_far.ydr")]);
}

/*
 * Плашки зданий: четыре стороны, эмблемы и надписи (до шестнадцати), стены с картинкой, надпись, типы, карта и
 * манифест — имена своего места (как их собирает `buildingPlateNames`
 * договора; копия — нарочно здесь, совпадение держит тест).
 */
function buildingPlateFiles(place) {
  const prefix = `astral_${place}`;
  return [
    ...withFarModels([
      ...["front", "right", "rear", "left"].map((side) => `${prefix}_side_${side}.ydr`),
      /* Панели широких стен — только фасад и задняя сторона: до восьми по `BUILDING_PANEL_MAX` договора (задача 6Б). */
      ...["front", "rear"].flatMap((side) => Array.from({ length: 8 }, (_, index) => `${prefix}_side_${side}_p${index + 1}.ydr`)),
      /* Фото на щитах крыши (до восьми сторон щитов, задача 5). */
      ...Array.from({ length: 8 }, (_, index) => `${prefix}_bill_${index + 1}.ydr`),
      ...Array.from({ length: 16 }, (_, index) => `${prefix}_logo_${index + 1}.ydr`),
      /* Своя картинка у стены: по плашке на стену, до шестнадцати (3В ТЗ 18.10.2026). */
      ...Array.from({ length: 16 }, (_, index) => `${prefix}_wall_${index + 1}.ydr`),
      `${prefix}_title.ydr`,
      /* Плашки поверх объёмных букв (название You Tool, ENTRANCE над входом). */
      ...[1, 2, 3, 4, 5, 6].map((index) => `${prefix}_cover_${index}.ydr`),
      /* Плашки мест надписи и табличек, разошедшихся по целям (до 64). */
      ...Array.from({ length: 64 }, (_, index) => `${prefix}_mark_${String(index + 1).padStart(2, "0")}.ydr`),
    ]),
    `${prefix}_marks.ytyp`,
    `${prefix}_marks_map.ymap`,
    /* Дальние копии плашек: карта уровнем LOD (фикс 1 ТЗ 06.10.2026). */
    `${prefix}_marks_map_lod.ymap`,
    "_manifest.ymf",
  ];
}

/* Имена МСЛ-зон: десять районов мода по 1…60 плиток, типы, карта, манифест. */
const MSL_DISTRICT_IDS = Object.freeze(["city", "ghetto", "mirror", "industrial", "vinewood", "venograd", "redwood", "windmill", "sandy", "farm"]);
function mslZoneFiles() {
  return [
    ...MSL_DISTRICT_IDS.flatMap((id) => Array.from({ length: 60 }, (_, at) => `astral_msl_${id}_${String(at + 1).padStart(2, "0")}.ydr`)),
    /* Мелкие плитки ближней дальности (10.10.2026): до 400 на район
       (`MSL_TILES_PER_DISTRICT` договора). */
    ...MSL_DISTRICT_IDS.flatMap((id) => Array.from({ length: 340 }, (_, at) => `astral_msl_${id}_${at + 61}.ydr`)),
    "astral_mslzones.ytyp",
    "astral_mslzones.ymap",
    "_manifest.ymf",
  ];
}

/* Имена зон каптов: шайба на каждую из тринадцати зон мода и арену, типы,
   карта, манифест (копия описи договора — нарочно здесь, совпадение держит тест). */
const CAPT_ZONE_IDS = Object.freeze(["vetryaki", "zavod", "mirror", "muraveinik", "osobnyak", "paleto", "pirc", "rockford", "stroyka", "sandy", "tatu", "farm", "cercov", "angar"]);
function captZoneFiles() {
  return [...CAPT_ZONE_IDS.map((id) => `astral_capt_${id}.ydr`), "astral_captzones.ytyp", "astral_captzones.ymap", "_manifest.ymf"];
}

/* Имена «Расписания»: модель на размер табло сервера (у описи их три, четвёртая
   — запас), типы, карта, манифест (копия договора `schedule.js` — нарочно
   здесь, совпадение держит тест). */
function scheduleFiles() {
  return [...Array.from({ length: 4 }, (_, index) => `astral_schedule_${index + 1}.ydr`), "astral_schedule.ytyp", "astral_schedule.ymap", "_manifest.ymf"];
}

/* Файлы «Дирижаблей» — копия списка договора (`airshipFileNames` в
   `climb-contract/recolor/airships.js`, совпадение держит тест). */
function airshipFiles() {
  const kinds = ["blimp", "dragon", "phoenix", "balloon", "lantern", "ufo", "whale", "jellyfish", "banner", "eastern_dragon", "griffin"];
  return [
    "blimp.ytd",
    ...kinds.flatMap((kind) => [`astral_sky_${kind}.ydr`, `astral_sky_${kind}_clips.ycd`]),
    "astral_sky_types.ytyp",
    "astral_sky_map.ymap",
    "_manifest.ymf",
  ];
}

/*
 * Свои модели мест (ТЗ 11.10.2026, вечер, задача 1): до шестнадцати моделей
 * со словарём клипов движения, свои типы и карта моделей и манифест места —
 * копия `placeModelNames` установщика (`recolor-place-models.js`,
 * совпадение держит тест). Модель в помещении игры едет его типами (они уже
 * в списке набора: `v_int_62.ytyp` арены, типы помещений «Интерьеров»).
 */
export const PLACE_MODEL_TRUST_SETS = Object.freeze(["factory", "hangar", "mapping", "arenas", "megamall", "youtool", "vinewood", "shops"]);
export function placeModelTrustFiles(setId) {
  const base = `astral_${String(setId).replace(/[^a-z0-9]/g, "")}`;
  return [
    ...Array.from({ length: 16 }, (_, index) => [`${base}_m${index + 1}.ydr`, `${base}_m${index + 1}_clips.ycd`]).flat(),
    `${base}_models.ytyp`,
    `${base}_models_map.ymap`,
    "_manifest.ymf",
  ];
}

/*
 * Наборы: контейнер, слот, имя пакета и предел размера одного файла.
 * `partial` — набор вправе ехать не целиком: у завода группа «Стандарт»
 * в пакет не едет (игра берёт свои файлы), а группа с отделкой едет
 * штатными файлами игры с правленными листами — они крупнее 4×4 мода.
 */
/* Карты района с вещами фермы, которых нет в плане изоляции Маппинга (вещи с обликом стоят в них): пакет мест главнее пакетов Rockstar, где они лежат. */
const MAPPING_ITEM_MAPS = Object.freeze(["cs6_06_strm_0.ymap", "hei_cs6_06_strm_0.ymap", "lr_cs6_06_strm_0.ymap", "cs6_06_long_0.ymap", "hei_cs6_06_long_0.ymap", "lr_cs6_06_long_0.ymap"]);

/* Постоянные типы места с копиями вещей: у плана изоляции Мегамолла своих копий общих вещей нет, их типы появляются только с копиями вещей работы. */
const MEGAMALL_ITEM_MAPS = Object.freeze(["sc1_22_strm_0.ymap", "hei_sc1_22_strm_0.ymap", "lr_sc1_22_strm_0.ymap", "astral_megamall_local.ytyp"]);
/* Ашан / Икея (27.10.2026): вещи по одной правят карты `cs4_02_strm_7` и `cs4_02_long_4` и их правки пакетов (`hei_`, `lr_`). */
const YOUTOOL_ITEM_MAPS = Object.freeze([
  "cs4_02_strm_7.ymap",
  "hei_cs4_02_strm_7.ymap",
  "lr_cs4_02_strm_7.ymap",
  "cs4_02_long_4.ymap",
  "hei_cs4_02_long_4.ymap",
  "lr_cs4_02_long_4.ymap",
  "astral_youtool_local.ytyp",
]);
/* Копии моделей вещей зданий по номеру группы и их словари листов, карты вещей: совпадение с описью держит тест. */
const buildingItemFiles = (id, maps) =>
  Object.freeze([...Array.from({ length: 16 }, (_, group) => ["ydr", "yft", "ytd"].map((extension) => `astral_${id}_item_${group + 1}.${extension}`)).flat(), ...maps]);
const MEGAMALL_ITEM_FILES = buildingItemFiles("megamall", MEGAMALL_ITEM_MAPS);
const YOUTOOL_ITEM_FILES = buildingItemFiles("youtool", YOUTOOL_ITEM_MAPS);

export const RECOLOR_SETS = Object.freeze(
  Object.fromEntries(
    Object.entries({
      /* Зоны — зелёные, запретные, бизвар, ВЗХ и порт одним набором
         (ТЗ 17.10.2026, задача 12): самая тяжёлая модель — половина обвода
         бизвара, ~0,7 МБ; предел — с запасом на пересборку эффектом. */
      zones: { name: "Запретные зоны Astral", maxBytes: 8 * MiB },
      /* Завод везёт ещё плашку эмблемы (модель, типы, карту и манифест) и
         листы своего дальнего вида из основной игры. */
      factory: {
        name: "Завод Astral",
        maxBytes: 12 * MiB,
        partial: true,
        extra: [
          ...plateModels("astral_factory_emblem"),
          "astral_factory_marks.ytyp",
          "astral_factory_marks_map.ymap",
          "astral_factory_marks_map_lod.ymap",
          "_manifest.ymf",
          "cs4_13_lod.ytd",
          /* Вещи со своим обликом (ТЗ 27.10.2026): копии моделей по номеру группы и их словари листов (`placeItemCopyName` договора, совпадение держит тест). */
          ...Array.from({ length: 16 }, (_, group) => ["ydr", "yft", "ytd"].map((extension) => `astral_factory_item_${group + 1}.${extension}`)).flat(),
        ],
      },
      /* Ангар стандартный (ТЗ 12.10.2026, ночь): штатные файлы ангара
         ограблений из игры игрока с правками (`partial`: едут только
         изменённые — листы стен и пола, нутро без ферм и крана, погашенные
         лампы), плашки эмблем и надписей (свои модели, типы, карта,
         манифест) и дальняя прорисовка общим списком LOD набора. Имена
         файлов мода panika остаются в списке набора: по ним переносятся
         поставленные до этого ангары (`migrateInstalledPlaces`). */
      hangar: {
        name: "Ангар Astral",
        maxBytes: 16 * MiB - 1,
        partial: true,
        extra: [
          ...plateModels("astral_hangar_emblem"),
          "astral_hangar_marks.ytyp",
          "astral_hangar_marks_map.ymap",
          "astral_hangar_marks_map_lod.ymap",
          "_manifest.ymf",
        ],
      },
      /* Маппинг везёт ещё плашку эмблемы (модель, типы, карту и манифест)
         и дальнюю прорисовку мест. */
      mapping: {
        name: "Маппинг Astral",
        maxBytes: 12 * MiB,
        /* Места «как в игре» (10.10.2026, задача 16) не едут: набор — по местам. */
        partial: true,
        extra: [
          ...plateModels("astral_mapping_emblem"),
          "astral_mapping_marks.ytyp",
          "astral_mapping_marks_map.ymap",
          "astral_mapping_marks_map_lod.ymap",
          "_manifest.ymf",
          /* Вещи со своим обликом (ТЗ 27.10.2026): копии моделей по номеру группы и их словари листов, карты вещей фермы (`placeItemMaps` договора, совпадение держит тест). */
          ...Array.from({ length: 16 }, (_, group) => ["ydr", "yft", "ytd"].map((extension) => `astral_mapping_item_${group + 1}.${extension}`)).flat(),
          ...MAPPING_ITEM_MAPS,
        ],
        overrides: MAPPING_ITEM_MAPS,
      },
      /* Арена — два сервера одним набором, едут файлы одного (`partial`) и
         только изменённые: у GTA5RP — штатные файлы арены с правками (список
         из описи), у Majestic — файлы стандартной арены сервера. Сверх них —
         плашка эмблемы, интерьер `v_int_62.ytyp` (кресла, автоматы, звезда
         — правкой сущностей), модель банкомата, своя звезда под именем
         штатной модели и словарь её клипов; дальний фасад — общим списком
         LOD набора. */
      arenas: {
        name: "Арена Astral",
        maxBytes: 16 * MiB - 1,
        partial: true,
        extra: [
          ...plateModels("astral_arenas_emblem"),
          /* Своё на месте объёмных букв, щита и знака над главным входом
             (`ARENA_COVER_PLATES` договора). */
          ...withFarModels(["astral_arenas_cover_portal.ydr", "astral_arenas_cover_shield.ydr", "astral_arenas_cover_maze.ydr"]),
          "astral_arenas_marks.ytyp",
          "astral_arenas_marks_map.ymap",
          "astral_arenas_marks_map_lod.ymap",
          "_manifest.ymf",
          "v_int_62.ytyp",
          "prop_atm_02.ydr",
          "v_62_fos_props01.ydr",
          "astral_arenas_star.ycd",
          /* Пол фойе без затенения под креслами (`ARENA_SEAT_SHADOWS` договора). */
          "v_62_lobmat.ydr",
          /* Перила без ковриков (часть вещи, `ARENA_ITEM_PARTS` договора). */
          "v_62_barrier01.ydr",
          /* Полотна по одному со своим видом — плашками в помещении зала (ТЗ 11.10.2026, ночь). */
          ...placeModelTrustFiles("arenapanels"),
          /* Вещи зала со своей моделью или картинкой — копии моделей по номеру группы (ТЗ 27.10.2026; `arenaItemCopyName` договора, совпадение держит тест). */
          ...Array.from({ length: 16 }, (_, group) => [...[1, 2, 3].flatMap((interior) => [`astral_arenas_item_mj_${group + 1}_${interior}.ydr`, `astral_arenas_item_mj_${group + 1}_${interior}.ytd`]), `astral_arenas_item_rp_${group + 1}.ydr`, `astral_arenas_item_rp_${group + 1}.ytd`]).flat(),
        ],
      },
      /* Здания из игры (Мегамолл, Ашан / Икея) — штатные файлы игры с
         правками (`partial`: едут только изменённые), плашки сторон,
         логотипов и надписи (свои модели, типы, карта, манифест) и дальние
         планы общим списком LOD набора. */
      ...Object.fromEntries(
        [
          ["megamall", "Мегамолл Astral"],
          ["youtool", "Ашан и Икея Astral"],
        ].map(([id, name]) => [id, { name, maxBytes: 16 * MiB - 1, partial: true, extra: buildingPlateFiles(id) }]),
      ),
      /* Мегамолл: вещи по одной (ТЗ 27.10.2026) — копии моделей по номеру группы с их словарями листов и карты района с вещами (убранные и перенацеленные
         вещи правят карты `sc1_22_strm_0` и её правки пакетов); пакет мест главнее пакетов Rockstar, где карты лежат. Совпадение с описью держит тест. */
      megamall: {
        name: "Мегамолл Astral",
        maxBytes: 16 * MiB - 1,
        partial: true,
        extra: [...buildingPlateFiles("megamall"), ...MEGAMALL_ITEM_FILES],
        overrides: MEGAMALL_ITEM_MAPS,
      },
      youtool: {
        name: "Ашан и Икея Astral",
        maxBytes: 16 * MiB - 1,
        partial: true,
        extra: [...buildingPlateFiles("youtool"), ...YOUTOOL_ITEM_FILES],
        overrides: YOUTOOL_ITEM_MAPS,
      },
      /* «Hollywood» — штатные модели надписи и её дальних планов под своими
         именами: буквы, леса, детали, свет и словари LOD собирает нативный
         хост (`compile-sign-models`); едут только заменённые. */
      vinewood: {
        name: "Hollywood Astral",
        maxBytes: 16 * MiB - 1,
        partial: true,
        /* Своя надпись вдали (задача 7 ТЗ 10.10.2026): по плашке на букву
           (до шестнадцати) — прозрачная HD и дальняя `_far`, типы, карты и
           манифест (`VINEWOOD_FAR_PLATE` установщика). */
        extra: [
          ...Array.from({ length: 16 }, (_, index) => `astral_vinewood_far_${String(index + 1).padStart(2, "0")}.ydr`),
          ...Array.from({ length: 16 }, (_, index) => `astral_vinewood_far_${String(index + 1).padStart(2, "0")}_far.ydr`),
          "astral_vinewood_marks.ytyp",
          "astral_vinewood_marks_map.ymap",
          "astral_vinewood_marks_map_lod.ymap",
          "_manifest.ymf",
        ],
      },
      /* «Остановки» — штатные модели остановок игры (листы зашиты в
         фрагмент) и их словари высокой чёткости с правленными листами, у
         прозрачной остановки — с прозрачными шейдерами игры; едут только
         изменённые виды. */
      busstops: {
        name: "Остановки Astral",
        maxBytes: 16 * MiB - 1,
        partial: true,
        /* Плашки гифок на постерах (задача 6 ТЗ 17.10.2026): свои модели с клипами, типы, карта и манифест. */
        extra: placeModelTrustFiles("busstoplive"),
      },
      /* МСЛ-зоны (ТЗ 08.10, задача 3) — свои модели линий плитками по 400 м
         (`astral_msl_<район>_<NN>.ydr`), типы, карта и манифест; модели
         собирает нативный хост, файлов мода в пакете нет. */
      mslzones: { name: "МСЛ-зоны Astral", maxBytes: 8 * MiB, partial: true, generated: true, extra: mslZoneFiles() },
      /* «Летающее лого» (ТЗ 08.10, задача 4) — своя модель со скелетом, клип
         движения, типы с анимированным архетипом, карта и манифест. */
      floatlogo: {
        name: "Летающее лого Astral",
        maxBytes: 16 * MiB - 1,
        partial: true,
        generated: true,
        extra: ["astral_floatlogo.ydr", "astral_floatlogo_clips.ycd", "astral_floatlogo_types.ytyp", "astral_floatlogo_map.ymap", "_manifest.ymf"],
      },
      /* «Дирижабли» (ТЗ 11.10.2026) — свои летающие модели со скелетом и
         клипом полёта по видам, типы с анимированными архетипами, карта и
         манифест; копия словаря дирижабля игры `blimp.ytd` с листом работы
         (перекрывает словарь машины в `vehicles.rpf`). Едет то, что есть в
         работе (`partial`); всё собирает установщик (`generated`). */
      airships: { name: "Дирижабли Astral", maxBytes: 16 * MiB - 1, partial: true, generated: true, extra: airshipFiles() },
      /* «Интерьеры» (задача 3 ТЗ 10.10.2026) — штатные файлы помещений игры с
         правками (`partial`: едут только изменённые): типы помещения (убранные
         вещи — перекрытие файла игры, архив данных карты пакета мест), модели
         оболочек и словари помещений с правленными листами. Список —
         `shops-trust.js` (`scripts/prepare-shops.mjs`). */
      shops: {
        name: "Интерьеры Astral",
        maxBytes: 16 * MiB - 1,
        partial: true,
        generated: true,
        extra: SHOPS_TRUST_FILES,
        overrides: SHOPS_TRUST_OVERRIDES,
      },
      /* «Билборды» (задача 4 ТЗ 10.10.2026, вечер) — штатные модели и словари
         районов с листами щитов (вблизи, в высокой чёткости и вдали), правка
         — только место щита на листе (`partial`: едут только изменённые);
         свои копии словарей щитов, разведённых по одному, и типы районов со
         ссылками на них (перекрытия файлов игры). Список — `billboards-trust.js`
         (`scripts/prepare-billboards.mjs`). */
      billboards: {
        name: "Билборды Astral",
        maxBytes: 16 * MiB - 1,
        partial: true,
        generated: true,
        /* И плашки гифок на живых щитах (задача 6 ТЗ 17.10.2026): свои модели с клипами, типы, карта и манифест. */
        extra: [...BILLBOARDS_TRUST_FILES, ...placeModelTrustFiles("billboardlive")],
        overrides: BILLBOARDS_TRUST_OVERRIDES,
      },
      /* «Зоны каптов» (задача 8 ТЗ 10.10.2026, вечер) — свои модели шайб
         (`astral_capt_<место>.ydr`, едут только видимые зоны), типы, карта и
         манифест; модели собирает нативный хост, файлов мода в пакете нет. */
      captzones: { name: "Зоны каптов Astral", maxBytes: 4 * MiB, partial: true, generated: true, extra: captZoneFiles() },
      /* «Расписание» (задача 11 ТЗ 10.10.2026, вечер) — свои модели табло
         (`astral_schedule_<n>.ydr`, лист 2048 × 1024 DXT5 зашит в каждую),
         типы, карта и манифест; модели собирает нативный хост, файлов
         сервера в пакете нет. */
      schedule: { name: "Расписание Astral", maxBytes: 8 * MiB, partial: true, generated: true, extra: scheduleFiles() },
      /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер) — штатные модели флагов с
         тканью (`prop_flag_<вид>.yft`, `_s`, флаг яхты, флагштоки) и общий
         словарь листов `prop_flags.ytd`: правка — только лист полотнища на
         месте (`partial`: едут виды, что меняются). Список — `flags-trust.js`
         (`scripts/prepare-flags.mjs`). */
      flags: { name: "Флаги Astral", maxBytes: 2 * MiB, partial: true, generated: true, extra: FLAGS_TRUST_FILES },
      /* «Банкоматы» (задача 4 ТЗ 17.10.2026) — штатные модели банкоматов
         (листы и палитры зашиты в модель) и их словари высокой чёткости с
         правленными листами частей, палитрами корпуса и рамки и свечением;
         едут только изменённые модели. Список — `recolor-sets.js`
         (`scripts/prepare-atms.mjs`). */
      atms: { name: "Банкоматы Astral", maxBytes: 16 * MiB - 1, partial: true, extra: [] },
    })
      /* Набор без файлов мода (`generated`: всё собирает установщик) в
         `recolor-sets.js` не пишется — генератор пропускает пустые списки. */
      .filter(([id, set]) => RECOLOR_SET_FILES[id] || set.generated)
      .map(([id, set]) => [
        id,
        Object.freeze({
          id,
          ...set,
          /* Потоковый архив места внутри пакета мест и сам пакет. */
          container: placesStreamOf(id),
          archive: PLACES_DLC_TARGET,
          /* Контейнер слоя Astral в update.rpf: свои новые карты, типы и
             манифест места (плашки, эмблемы, оболочки зон). */
          layer: `x64/astral/astral_${id}.rpf`,
          /* Типы и карты игры, что место правит (копия словаря дальних
             моделей, свои копии вещей): им — пакет мест, он главнее пакетов
             Rockstar, где они лежат. */
          overrides: Object.freeze(
            [
              /* Свои перекрытия набора (типы помещений «Интерьеров»). */
              ...(set.overrides || []),
              ...((RECOLOR_SET_LOD_FILES || {})[id] || []),
              ...((RECOLOR_SET_LOCAL_FILES || {})[id] || []),
              ...((RECOLOR_SET_ELEMENT_FILES || {})[id] || []),
            ]
              .map((name) => name.toLowerCase())
              .filter((name) => /\.(?:ymap|ytyp)$/.test(name)),
          ),
          slot: `recolor-${id}`,
          files: RECOLOR_SET_FILES[id] || Object.freeze([]),
          /* Свои файлы, которые вправе не ехать (остальные — все до одного):
             и те, что едут копией места под своим именем (фикс 2). */
          optional: Object.freeze([...new Set([...(set.optional || []), ...((RECOLOR_SET_LOCAL_REPLACED || {})[id] || [])])]),
          /* Дальняя прорисовка (LOD, SLOD, копии словарей, типы) и окружение
             места — едут, когда их тронул облик работы (`recolor-lod.js`). */
          extra: Object.freeze([
            ...new Set([
              ...(set.extra || []),
              ...((RECOLOR_SET_LOD_FILES || {})[id] || []),
              /* Своё место — своими копиями вещей (фикс 2): копии моделей и
                 словарей, правленые карты и типы района. */
              ...((RECOLOR_SET_LOCAL_FILES || {})[id] || []),
              /* Элементы мест по одному (задача 10): словари полотен у арок
                 и типы района со ссылками на них. */
              ...((RECOLOR_SET_ELEMENT_FILES || {})[id] || []),
              /* Свои модели места (ТЗ 11.10.2026, вечер, задача 1). */
              ...(PLACE_MODEL_TRUST_SETS.includes(id) ? placeModelTrustFiles(id) : []),
            ]),
          ]),
        }),
      ]),
  ),
);

/*
 * Имена, которые может везти пакет мест (`astral_places`, `order` 107): все
 * файлы всех наборов — свои, дальняя прорисовка, копии мест, перекрытия типов
 * и карт. Строгая форма пакета мест не пускает ничего сверх этого списка,
 * поэтому он и есть полный перечень. Пакеты текстур с `order` ниже (105, 106)
 * место перекрывает само; третий (108) перекрыл бы место — файлы из этого
 * списка в него не кладут (`texture-levels.js`) и его манифест не принимает
 * (`textures-manifest-trust.js`). Строится при первом обращении: модуль входит
 * в круг импортов пакета мест.
 */
let carriedByPlaces = null;
export function placesCarriedNames() {
  if (!carriedByPlaces) {
    carriedByPlaces = new Set(
      Object.values(RECOLOR_SETS).flatMap((set) => [...set.files, ...set.extra, ...set.optional, ...set.overrides].map((name) => name.toLowerCase())),
    );
  }
  return carriedByPlaces;
}

/** Может ли пакет мест везти файл с таким именем (без учёта регистра). */
export const isCarriedByPlaces = (name) => placesCarriedNames().has(String(name).toLowerCase());

const SET_IDS = Object.freeze(Object.keys(RECOLOR_SETS));
const MOD_ID = /^local-legacy-(zones|factory|hangar|mapping|arenas|megamall|youtool|vinewood|busstops|mslzones|floatlogo|airships|shops|billboards|captzones|schedule|flags|atms)-([a-f0-9]{12})$/;

const MANIFEST_KEYS = Object.freeze([
  "id",
  "version",
  "name",
  "editions",
  "scope",
  "adapter",
  "requiresLoader",
  "gameplayChanges",
  "capabilities",
  "slots",
  "recolor",
  "files",
]);
const RECOLOR_KEYS = Object.freeze(["set", "schemaVersion", "sourceDigest", "resourceCount"]);
const FILE_KEYS = Object.freeze(["source", "target", "action", "entry", "merge", "size", "sha256"]);
const CAPABILITIES = Object.freeze([
  "rpf-container-entry-v1",
  "astral-content-rpf-v1",
  "direct-update-rpf-v1",
  "direct-update-entries-v1",
  PLACES_DLC_CAPABILITY,
]);

/**
 * Где файл места в игре (схема 4, фикс 1 ТЗ 06.10.2026):
 *
 *   • свои новые карты, типы и манифест (`_manifest.ymf`, плашки, оболочки
 *     зон) — в контейнер слоя Astral update.rpf, как до 06.10: манифест в
 *     пакете дополнения игра кладёт в хранилище метаданных, а оно у игрока
 *     заполнено до конца — GTA падала на загрузке (три дампа 06.10.2026);
 *   • типы и карты игры, что место правит, — в архив данных карты пакета
 *     мест: он главнее пакетов Rockstar (`patchday1ng`/`patchday2ng`);
 *   • модели и словари — в потоковый архив пакета мест.
 */
export function recolorRouteOf(setId, name, mapNames = null) {
  const set = RECOLOR_SETS[setId];
  const lower = String(name).toLowerCase();
  if (/\.(?:ymap|ytyp|ymf)$/.test(lower) && !set.overrides.includes(lower)) return { target: "update/update.rpf", entry: `${set.layer}/${name}` };
  return { target: set.archive, entry: `${placesArchiveOf(setId, name, mapNames)}/${name}` };
}

/* Файл, что игра включает наборами `GROUP_MAP`, ушёл в архив сетевой карты места (`astral_<место>_mp(_metadata).rpf`). */
const MAP_ARCHIVE = /^astral_[a-z0-9]+_mp(?:_metadata)?\.rpf\//;
const inMapArchive = (setId, route) => PLACES_MAP_SETS.includes(setId) && MAP_ARCHIVE.test(String(route.entry));

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, keys) =>
  isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const versionOf = (suffix) => `${RECOLOR_SCHEMA}.0.0-${suffix}`;

/**
 * Хэш содержимого: набор, схема доставки и отсортированные пары
 * `имя\nsha256`. Тот же облик — тот же id пакета, и повторное «Применить»
 * архив игры не пересобирает. Схема — в хэше: установка схемы 1 (контейнер
 * update.rpf) с теми же файлами — другой пакет, и «Применить» её сменит.
 */
export function recolorDigest(setId, files) {
  const lines = files.map((file) => `${file.name}\n${file.sha256}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  /* Файлы сетевой карты в архивах `GROUP_MAP` (12.10.2026) — другая раскладка
     тех же файлов: у места с ними новый id, и поставленное раньше переезжает
     переносом (`migrateInstalledPlaces`). У остальных мест id прежний.
     Раскладка из одних `hei_` — прежняя `map-group-v1` (id мест без перекрытия не меняются); с файлами без `hei_` (26.10.2026: `lr_*`, `m24_*`,
     `tr_*`… из игры игрока) — `map-group-v2` и их список. `file.mapped` — файл лежит в архиве сетевой карты (по умолчанию — по правилу `hei_`). */
  /* Раскладка v2 (по игре игрока): `+имя` — файл без `hei_` в архиве сетевой карты, `-имя` — `hei_` оставлен в архиве на старте. */
  const mappedOf = (file) => file.mapped ?? isPlacesHeiFile(setId, file.name);
  const added = files.filter((file) => mappedOf(file) && !isPlacesHeiFile(setId, file.name)).map((file) => `+${file.name}`).sort();
  const held = files.filter((file) => !mappedOf(file) && isPlacesHeiFile(setId, file.name)).map((file) => `-${file.name}`).sort();
  const layout = added.length || held.length ? `\nmap-group-v2\n${[...added, ...held].join("\n")}` : files.some(mappedOf) ? "\nmap-group-v1" : "";
  return createHash("sha256").update(`${setId}\nplaces-v${RECOLOR_SCHEMA}${layout}\n${lines.join("\n")}`, "utf8").digest("hex");
}

/** Id пакета набора: `local-legacy-<набор>-<12 знаков хэша>`. */
export const isRecolorModId = (value, setId = null) => {
  const match = MOD_ID.exec(String(value || ""));
  return Boolean(match) && (!setId || match[1] === setId);
};

export const recolorSetOfModId = (value) => MOD_ID.exec(String(value || ""))?.[1] || null;

/** Манифест набора из описи собранных файлов `{ name, size, sha256 }`. */
export function buildRecolorManifest(setId, files, { mapNames = null } = {}) {
  const set = RECOLOR_SETS[setId];
  if (!set) throw new Error(`Набора перекраски «${setId}» нет.`);
  /* Файл в архиве сетевой карты — по тому, куда его правда положил маршрут (карты и типы вне перекрытий игры — в контейнер слоя, список игры их не касается). */
  const digest = recolorDigest(
    setId,
    files.map((file) => ({ ...file, mapped: inMapArchive(setId, recolorRouteOf(setId, file.name, mapNames)) })),
  );
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-${setId}-${suffix}`,
    version: versionOf(suffix),
    name: set.name,
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Модели мира: зоны ставят свои оболочки, завод, ангар и маппинг —
    // здания и пропы (у ангара — ещё карта и коллизия). Это изменение мира.
    gameplayChanges: true,
    capabilities: [...CAPABILITIES],
    slots: [set.slot],
    recolor: {
      set: setId,
      schemaVersion: RECOLOR_SCHEMA,
      sourceDigest: `sha256:${digest}`,
      resourceCount: files.length,
    },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => ({
        source: `payload/${file.name}`,
        ...recolorRouteOf(setId, file.name, mapNames),
        action: "import",
        merge: { strategy: "rpf-resource-layer-v1" },
        size: file.size,
        sha256: file.sha256,
      })),
  };
}

export function isLocalRecolorManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.recolor, RECOLOR_KEYS)) return false;
  const setId = manifest.recolor.set;
  if (!SET_IDS.includes(setId)) return false;
  const set = RECOLOR_SETS[setId];
  const idMatch = MOD_ID.exec(manifest.id || "");
  if (!idMatch || idMatch[1] !== setId) return false;
  const suffix = idMatch[2];
  if (manifest.version !== versionOf(suffix)) return false;
  if (manifest.name !== set.name) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== true) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(CAPABILITIES)) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([set.slot])) return false;
  if (manifest.recolor.schemaVersion !== RECOLOR_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.recolor.sourceDigest || "")) return false;

  /* Ровно файлы набора, каждый по разу: у набора нет «необязательных»
     файлов — карта ждёт свои модели, модели — свои словари. Кроме набора
     `partial` (завод): у него файлы групп независимы, «Стандарт» не едет. */
  const files = manifest.files;
  const allowed = [...set.files, ...set.extra];
  if (!Array.isArray(files) || files.length < 1 || files.length > allowed.length) return false;
  if (manifest.recolor.resourceCount !== files.length) return false;
  const seen = new Set();
  const digestInput = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (typeof file.source !== "string" || !file.source.startsWith("payload/")) return false;
    const name = file.source.slice("payload/".length);
    if (!allowed.includes(name) || seen.has(name)) return false;
    seen.add(name);
    const route = recolorRouteOf(setId, name);
    /* Файл вправе лежать в архиве на старте или в архиве сетевой карты своего места: где его положила сборка по игре игрока, решает она, а раскладку держит id
       (`recolorDigest`: какие файлы без `hei_` в архиве сетевой карты и какие `hei_` оставлены в архиве на старте). */
    const mappedRoute = recolorRouteOf(setId, name, new Set([name.toLowerCase()]));
    const unmappedRoute = recolorRouteOf(setId, name, new Set());
    /* Файл арены из набора карты Majestic лежит в архиве сетевой карты при любом списке игры (`ARENA_MAP_FILES`): маршрут от списка не зависит. */
    const mapped =
      inMapArchive(setId, mappedRoute) && file.entry === mappedRoute.entry && (mappedRoute.entry !== unmappedRoute.entry || isArenaMapFile(setId, name));
    if (file.target !== route.target) return false;
    if (file.action !== "import") return false;
    if (file.entry !== mappedRoute.entry && file.entry !== unmappedRoute.entry) return false;
    if (!hasExactKeys(file.merge, ["strategy"])) return false;
    if (file.merge.strategy !== "rpf-resource-layer-v1") return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > set.maxBytes) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    digestInput.push({ name, sha256: file.sha256, mapped });
  }

  /* Набор не `partial` едет целиком: его свои файлы — все до одного,
     кроме `optional`. */
  if (!set.partial && set.files.some((name) => !seen.has(name) && !set.optional.includes(name))) return false;

  // id, версия и digest связаны одним хэшем содержимого.
  const digest = recolorDigest(setId, digestInput);
  if (manifest.recolor.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;
  return true;
}
