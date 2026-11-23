/*
 * Растительность по миру (задача 2 ТЗ 10.10.2026, вечер): большие кусты и
 * живые изгороди, цветы на траве, виды деревьев и их перемешка по районам.
 *
 * Как это устроено в игре (исследовано по файлам игры 10.10.2026):
 *
 *  • КУСТЫ — модели `prop_bush_*` (по миру их ≈ 576 тыс.: `prop_bush_med_03`
 *    одна — 164 тыс.), листва у каждой зашита в саму модель шейдерами
 *    `trees_*`, как у деревьев. Вдали — карточки `slod_prop_bush_*` в
 *    словарях дальних планов районов.
 *  • ЖИВЫЕ ИЗГОРОДИ — у особняков Рокфорд-Хиллз, в Дель-Перро, Вайнвуд-Хиллз,
 *    центре — это модели карт районов (`bh1_*_furhedge*`, `ch1_*_hedgedtl_*`,
 *    `dt1_*_hedge*`…): обычные шейдеры `normal_spec` с листом изгороди
 *    (`rsn_am_hedge_02`, `rsn_am_hedge_03`, `im_hedge01`…) и «мех» изгороди
 *    (`rsn_am_hedge_02_fur`). Листы лежат в словарях районов и в общем
 *    словаре `globalroads` — красятся по имени листа (опись — `world.json`).
 *  • ЦВЕТЫ — пачки травы карт `*_grass_N.ymap`: у пачки одна модель
 *    (`proc_grasses01`…), у Rockstar есть и цветочные — маки, люпины,
 *    одуванчики, луговая смесь. Все они — шейдер `grass_batch` в одних
 *    постоянных типах `v_proc1.ytyp`, поэтому пачке травы можно дать модель
 *    цветов: размер записи и число травинок те же, игра грузит те же типы.
 *  • ДЕРЕВЬЯ — сущности карт районов (`*_critical_N.ymap`, `*_strm_N.ymap`):
 *    у сущности хеш модели. Типы деревьев (`v_trees`, `v_palm`, `v_fanpalm`,
 *    `v_cacti`, `v_snow`) у игры постоянные (`PERMANENT_ITYP_FILE` в
 *    `gta5.meta`) — замена модели находит новую всегда, без манифестов.
 *    Вдали дерево — общая карточка группы деревьев (родитель LOD): она
 *    остаётся прежней породы.
 *
 * Здесь — общая арифметика кадра и установщика: районы по имени карты, что
 * считать кустом, какая пачка становится цветами, какое дерево — каким.
 * Решения детерминированы (хеш места): кадр и игра видят одно и то же, и
 * пересборка не перекладывает деревья.
 */

import VEGETATION_WORLD from "./inventory/vegetation-world.js";

export { VEGETATION_WORLD };

/* ------------------------------------------------------------------ *
 * Районы
 * ------------------------------------------------------------------ */

/*
 * Районы — по коду района в имени карты (`cs1_11b_critical_3`,
 * `hei_cs1_…`, `lr_cs4_…`, `apa_ch2_01_grass_0`): так их делит сама игра.
 * Рамки и счёт — по описи мира (`scripts/prepare-vegetation-world.mjs`).
 */
export const VEGETATION_AREAS = Object.freeze(
  [
    {
      id: "city",
      label: "Лос-Сантос",
      note: "Город: газоны, парки, особняки Рокфорд-Хиллз, пляжи Веспуччи и Дель-Перро",
      codes: ["ap1", "bh1", "bt1", "dt1", "hw1", "id1", "id2", "kt1", "po1", "sc1", "sm", "sp1", "ss1", "vb"],
    },
    { id: "vinewood", label: "Вайнвуд-Хиллз", note: "Холмы над городом и особняки на склонах", codes: ["ch2"] },
    { id: "chumash", label: "Чумаш и Тонгва", note: "Западное побережье, каньон Бэнхэм, холмы Тонгва", codes: ["ch1"] },
    { id: "tataviam", label: "Татавиам и Паломино", note: "Горы к востоку от города", codes: ["ch3"] },
    { id: "harmony", label: "Хармони и Чапаррал", note: "Шоссе 68, Хармони, Грейт-Чапаррал", codes: ["cs6"] },
    { id: "zancudo", label: "Занкудо и Ратон", note: "Форт и озеро Занкудо, каньон Ратон", codes: ["cs3"] },
    { id: "desert", label: "Сэнди-Шорс и пустыня", note: "Пустыня Гранд-Сенора, Сэнди-Шорс, Аламо", codes: ["cs4", "cs5"] },
    { id: "grapeseed", label: "Грейпсид и Гордо", note: "Поля Грейпсида, гора Гордо, Сан-Шаньски", codes: ["cs2"] },
    { id: "paleto", label: "Палето и Чилиад", note: "Гора Чилиад, лес и бухта Палето", codes: ["cs1"] },
  ].map((area) => Object.freeze({ ...area, codes: Object.freeze(area.codes) })),
);
export const VEGETATION_AREA_IDS = Object.freeze(VEGETATION_AREAS.map((area) => area.id));
const AREA_BY_CODE = new Map(VEGETATION_AREAS.flatMap((area) => area.codes.map((code) => [code, area.id])));

/**
 * Район карты по имени файла (`cs1_11b_critical_3.ymap` → `paleto`) или
 * `null` (пролог, интерьеры, карты без кода района). Код ищется в первых
 * трёх частях имени: у дополнений он идёт после своей приставки.
 */
export function areaOfMapName(name) {
  const parts = String(name).toLowerCase().replace(/\.[a-z0-9]+$/, "").split("_");
  for (let index = 0; index < Math.min(3, parts.length); index += 1) {
    const area = AREA_BY_CODE.get(parts[index]);
    if (area) return area;
  }
  return null;
}

/* Районы работы: известные, без повторов, в порядке списка; пусто — все. */
export function normalizeAreas(input, fallback = VEGETATION_AREA_IDS) {
  const given = new Set(Array.isArray(input) ? input.map(String) : []);
  const areas = VEGETATION_AREA_IDS.filter((id) => given.has(id));
  return areas.length ? areas : [...fallback];
}

/* ------------------------------------------------------------------ *
 * Детерминированный выбор по месту
 * ------------------------------------------------------------------ */

/* Перемешивание 32 бит (murmur3 fmix): то же число у кадра и установщика. */
function mix32(a, b, salt) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Доля 0…1 места в мире (`x`, `y` — метры) под своей «солью». */
export function placeShare(x, y, salt) {
  return mix32(Math.round(Number(x) * 10), Math.round(Number(y) * 10), salt) / 4294967296;
}

const SALT_FLOWER = 0x0f10;
const SALT_FLOWER_KIND = 0x0f11;
const SALT_TREE = 0x07ee;
const SALT_TREE_KIND = 0x07ef;
const SALT_TREE_MODEL = 0x07f0;

/* Хеш имени, как его считает игра (joaat, строчными). */
export function joaatName(text) {
  const value = String(text).toLowerCase();
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash + value.charCodeAt(index)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  return (hash + (hash << 15)) >>> 0;
}

const clampShare = (value, fallback, low = 5) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(100, Math.max(low, number)) / 5) * 5;
};

/* ------------------------------------------------------------------ *
 * Кусты и живые изгороди
 * ------------------------------------------------------------------ */

/*
 * Что красит инструмент «Кусты»:
 *   foliage — как листва деревьев (так было до 10.10.2026: кусты шли с
 *             листвой одним цветом и одной густотой);
 *   game    — как в игре, даже если листва деревьев своего цвета;
 *   colour  — свой цвет кустов и живых изгородей (густота — как в игре).
 */
export const BUSH_MODES = Object.freeze(["foliage", "game", "colour"]);

/** Файл модели или словаря — куст (`prop_bush_lrg_01.ydr`, `veg_snow_bushes.ytd`). */
export const isBushFile = (name) =>
  /^(prop_bush_|prop_skunk_bush|prop_snow_bush|prop_creosote|creator_bushes|veg_snow_bushes)/.test(String(name).toLowerCase());

/** Лист карточки вдали — куст или изгородь (`slod_prop_bush_lrg_04b_2`). */
export const isBushCard = (texture) => /(bush|hedge)/.test(String(texture).toLowerCase());

/* ------------------------------------------------------------------ *
 * Цветы
 * ------------------------------------------------------------------ */

/*
 * Цветы — модели пачек травы Rockstar (`v_proc1.ytyp`, шейдер `grass_batch`).
 * `colour` — цвет цветка для плитки окна (лист цветов — из игры игрока),
 * `scale` — разброс размера пачки, как у Rockstar (мин., макс., разброс
 * по высоте), `tint` — средний цвет травинки у Rockstar (на него ложится
 * лист): пачка цветов на сухой траве не желтеет.
 */
export const FLOWER_KINDS = Object.freeze(
  [
    {
      id: "poppy",
      label: "Маки",
      note: "Оранжевые калифорнийские маки",
      model: "proc_meadowpoppy_01",
      texture: "nxg_proc_sl_meadowmix_poppy",
      dictionary: "ng_ip_plants",
      colour: "#f08a2a",
      scale: [0.5, 1.2, 0.3],
      tint: [114, 114, 89],
    },
    {
      id: "lupin",
      label: "Люпины",
      note: "Сиреневые свечки люпина",
      model: "proc_lupins_01",
      texture: "nxg_proc_sl_lupins_01",
      dictionary: "ng_ip_plants",
      colour: "#8a63d2",
      scale: [0.5, 0.9, 0.4],
      tint: [111, 110, 87],
    },
    {
      id: "dandelion",
      label: "Одуванчики",
      note: "Жёлтые головки в траве",
      model: "proc_grassdandelion01",
      texture: "nxg_proc_sl_dandelion_01",
      dictionary: "ng_ip_plants",
      colour: "#f2cf2e",
      scale: [0.6, 0.9, 0.2],
      tint: [122, 119, 96],
    },
    {
      id: "meadow",
      label: "Луговые цветы",
      note: "Эхинацея и жёлтые цветы вперемешку",
      model: "proc_meadowmix_01",
      texture: "nxg_proc_sl_meadowmix_01",
      dictionary: "ng_ip_plants",
      colour: "#b765c9",
      scale: [0.5, 1.2, 0.3],
      tint: [117, 115, 91],
    },
    {
      id: "quinine",
      label: "Белые соцветия",
      note: "Белые зонтики на высоких стеблях",
      model: "proc_wildquinine",
      texture: "nxg_proc_sl_wildquinine_01",
      dictionary: "ng_ip_plants",
      colour: "#f1f0e6",
      scale: [0.5, 0.9, 0.2],
      tint: [115, 114, 90],
    },
    {
      id: "daisy",
      label: "Ромашки",
      note: "Мелкие белые ромашки",
      model: "prop_flowerweed_005_a",
      texture: "nxg_proc_sl_flowerweed_005",
      dictionary: "ng_ip_forest",
      colour: "#f4efd8",
      scale: [0.8, 1, 0.2],
      tint: [104, 98, 75],
    },
    {
      id: "paintbrush",
      label: "Красные кисточки",
      note: "Кастиллея — алые соцветия",
      model: "proc_indian_pbrush_01",
      texture: "nxg_proc_sl_indianpaintbrush_01",
      dictionary: "ng_ip_dry_bushes",
      colour: "#e2462c",
      scale: [0.6, 1, 0.2],
      tint: [144, 134, 112],
    },
    {
      id: "brittlebush",
      label: "Жёлтые цветы пустыни",
      note: "Энцелия — жёлтые кустики",
      model: "proc_brittlebush_01",
      texture: "nxg_proc_sl_brittlebush_01",
      dictionary: "ng_ip_dry_bushes",
      colour: "#f4d02a",
      scale: [0.6, 1, 0.2],
      tint: [132, 127, 104],
    },
    {
      id: "sage",
      label: "Шалфей",
      note: "Лиловые колоски шалфея",
      model: "proc_desert_sage_01",
      texture: "nxg_proc_sl_desertsage_01",
      dictionary: "ng_ip_dry_bushes",
      colour: "#a07cc8",
      scale: [0.7, 1, 0.2],
      tint: [143, 134, 113],
    },
  ].map((kind) => Object.freeze({ ...kind, hash: joaatName(kind.model), scale: Object.freeze(kind.scale), tint: Object.freeze(kind.tint) })),
);
export const FLOWER_KIND_IDS = Object.freeze(FLOWER_KINDS.map((kind) => kind.id));
const FLOWER_BY_ID = new Map(FLOWER_KINDS.map((kind) => [kind.id, kind]));
/** Модели цветов (хеши) — траву «Травы по миру» они не красят: цветы своего цвета. */
export const FLOWER_ARCHETYPES = Object.freeze(new Set(FLOWER_KINDS.map((kind) => kind.hash)));

/*
 * Что делать с цветами:
 *   game — как в игре;
 *   add  — часть пачек мелкой травы — цветами выбранных видов («растут на
 *          траве»: там же, где росла трава);
 *   none — без цветов: пачки цветов Rockstar становятся травой (зима).
 */
export const FLOWER_MODES = Object.freeze(["game", "add", "none"]);

/*
 * Мелкая трава — пачки, которые могут стать цветами: зелёная и сухая трава
 * города и загорода. Камни, папоротники, саженцы, бревна и кусты остаются.
 */
export const SMALL_GRASS_MODELS = Object.freeze([
  "proc_grasses01",
  "proc_grasses01b",
  "proc_grassplantmix_01",
  "proc_grassplantmix_02",
  "proc_grassfronds01",
  "proc_forest_grass01",
  "urbangrngrass_01",
  "urbangrnfrnds_01",
  "proc_drygrasses01",
  "proc_drygrasses01b",
  "proc_drygrassfronds01",
  "proc_dryplantsgrass_01",
  "proc_dryplantsgrass_02",
  "urbandrygrass_01",
  "urbandryfrnds_01",
  "prop_grass_ca",
  "prop_grass_da",
  "prop_tall_grass_ba",
  "prop_grass_001_a",
  "prop_tall_drygrass_aa",
]);
const SMALL_GRASS = new Set(SMALL_GRASS_MODELS.map(joaatName));
/* Трава на месте цветов у «без цветов» — обычная зелёная трава Rockstar. */
export const PLAIN_GRASS = Object.freeze({ model: "proc_grasses01", hash: joaatName("proc_grasses01"), scale: Object.freeze([0.4, 0.8, 0.2]), tint: Object.freeze([110, 110, 86]) });

const DEFAULT_FLOWER_KINDS = Object.freeze(["poppy", "lupin", "dandelion", "meadow"]);

/** Цветы работы в порядке: режим, виды (хотя бы один), доля пачек, районы. */
export function normalizeFlowers(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const given = new Set(Array.isArray(source.kinds) ? source.kinds.map(String) : []);
  const kinds = FLOWER_KIND_IDS.filter((id) => given.has(id));
  return {
    mode: FLOWER_MODES.includes(source.mode) ? source.mode : "game",
    kinds: kinds.length ? kinds : [...DEFAULT_FLOWER_KINDS],
    share: clampShare(source.share, 35),
    areas: normalizeAreas(source.areas),
  };
}

/**
 * Решение по пачкам одной карты: `(archetype, x, y) → { kind, hash, scale,
 * tint } | null`, где `x`, `y` — угол рамки пачки (место пачки в мире).
 * `null` — пачка как была. Цветы выбранных районов; карта не в районе —
 * всё как было.
 */
export function flowerBatchChooser(flowers, area) {
  const plan = normalizeFlowers(flowers);
  if (plan.mode === "game" || !area || !plan.areas.includes(area)) return () => null;
  if (plan.mode === "none")
    return (archetype) => (FLOWER_ARCHETYPES.has(archetype >>> 0) ? { kind: "grass", ...PLAIN_GRASS } : null);
  const kinds = plan.kinds.map((id) => FLOWER_BY_ID.get(id));
  const share = plan.share / 100;
  return (archetype, x, y) => {
    if (!SMALL_GRASS.has(archetype >>> 0) || placeShare(x, y, SALT_FLOWER) >= share) return null;
    const kind = kinds[Math.min(kinds.length - 1, Math.floor(placeShare(x, y, SALT_FLOWER_KIND) * kinds.length))];
    return { kind: kind.id, hash: kind.hash, scale: kind.scale, tint: kind.tint };
  };
}

/* ------------------------------------------------------------------ *
 * Виды деревьев и перемешка
 * ------------------------------------------------------------------ */

/*
 * Готовые виды — модели деревьев игры (постоянные типы). Порода (`species`)
 * — как у листвы (`VEGETATION_SPECIES`): по ней красятся их кроны.
 */
export const TREE_KINDS = Object.freeze(
  [
    {
      id: "palm",
      label: "Пальмы",
      note: "Веерные, высокие и низкие",
      species: "palm",
      models: [
        "prop_palm_sm_01a",
        "prop_palm_sm_01d",
        "prop_palm_sm_01e",
        "prop_palm_sm_01f",
        "prop_palm_med_01a",
        "prop_palm_med_01b",
        "prop_palm_med_01c",
        "prop_palm_med_01d",
        "prop_palm_fan_02_a",
        "prop_palm_fan_02_b",
        "prop_palm_fan_03_a",
        "prop_palm_fan_03_b",
        "prop_palm_fan_03_c",
        "prop_palm_fan_03_d",
        "prop_palm_fan_04_a",
        "prop_palm_fan_04_b",
        "prop_palm_fan_04_c",
        "prop_palm_fan_04_d",
        "prop_palm_huge_01a",
        "prop_palm_huge_01b",
        "prop_fan_palm_01a",
      ],
    },
    {
      id: "fir",
      label: "Ёлки и кедры",
      note: "Хвойный лес Чилиада",
      species: "cedar",
      models: [
        "prop_tree_cedar_s_01",
        "prop_tree_cedar_s_02",
        "prop_tree_cedar_s_04",
        "prop_tree_cedar_s_05",
        "prop_tree_cedar_s_06",
        "prop_tree_cedar_02",
        "prop_tree_cedar_03",
        "prop_tree_cedar_04",
        "prop_w_r_cedar_01",
      ],
    },
    { id: "pine", label: "Сосны", note: "Высокие сосны", species: "pine", models: ["prop_tree_pine_01", "prop_tree_pine_02"] },
    {
      id: "snowfir",
      label: "Заснеженные ели",
      note: "Ели в снегу из Северного Янктона",
      species: "pine",
      models: ["prop_snow_tree_03_h", "prop_snow_tree_03_i", "prop_snow_t_ml_03"],
    },
    { id: "oak", label: "Дубы", note: "Раскидистые дубы", species: "oak", models: ["prop_tree_oak_01", "prop_tree_eng_oak_01"] },
    {
      id: "birch",
      label: "Берёзы",
      note: "Белые стволы",
      species: "birch",
      models: ["prop_tree_birch_01", "prop_tree_birch_02", "prop_tree_birch_03", "prop_tree_birch_03b", "prop_tree_birch_04"],
    },
    { id: "maple", label: "Клёны", note: "Кленовые кроны", species: "maple", models: ["prop_tree_maple_02", "prop_tree_maple_03"] },
    { id: "jacaranda", label: "Жакаранды", note: "Сиреневые цветущие кроны", species: "tree", models: ["prop_tree_jacada_01", "prop_tree_jacada_02"] },
    {
      id: "ficus",
      label: "Фикусы",
      note: "Густые городские кроны",
      species: "ficus",
      models: ["prop_tree_lficus_02", "prop_tree_lficus_03", "prop_tree_lficus_05", "prop_tree_lficus_06"],
    },
    { id: "eucalyptus", label: "Эвкалипты", note: "Высокие светлые стволы", species: "eucalyptus", models: ["prop_tree_eucalip_01"] },
    { id: "olive", label: "Оливы", note: "Низкие серебристые кроны", species: "olive", models: ["prop_rus_olive", "prop_tree_olive_01"] },
    { id: "cypress", label: "Кипарисы", note: "Узкие свечки", species: "cypress", models: ["prop_tree_cypress_01"] },
    { id: "mesquite", label: "Мескиты", note: "Деревья пустыни", species: "mesquite", models: ["prop_tree_mquite_01"] },
    {
      id: "joshua",
      label: "Юкки",
      note: "Деревья Джошуа пустыни",
      species: "joshua",
      models: [
        "prop_joshua_tree_01a",
        "prop_joshua_tree_01b",
        "prop_joshua_tree_01c",
        "prop_joshua_tree_01d",
        "prop_joshua_tree_01e",
        "prop_joshua_tree_02a",
        "prop_joshua_tree_02b",
        "prop_joshua_tree_02c",
        "prop_joshua_tree_02d",
        "prop_joshua_tree_02e",
      ],
    },
    { id: "dead", label: "Сухие деревья", note: "Голые сухие стволы", species: "tree", models: ["prop_w_r_cedar_dead", "prop_s_pine_dead_01"] },
  ].map((kind) => Object.freeze({ ...kind, models: Object.freeze(kind.models), hashes: Object.freeze(kind.models.map(joaatName)) })),
);
export const TREE_KIND_IDS = Object.freeze(TREE_KINDS.map((kind) => kind.id));
const TREE_BY_ID = new Map(TREE_KINDS.map((kind) => [kind.id, kind]));

/*
 * Деревья, которые перемешка вправе заменить: модели всех видов и ещё
 * `prop_rio_del_01`. Пни, бревна, поваленные деревья, кактусы и кусты —
 * нет: у них своя роль в мире.
 */
export const TREE_MODELS = Object.freeze([...new Set([...TREE_KINDS.flatMap((kind) => kind.models), "prop_rio_del_01"])]);
const TREE_HASHES = new Set(TREE_MODELS.map(joaatName));
/** Хеш модели — дерево, которое перемешка может заменить. */
export const isMixableTree = (hash) => TREE_HASHES.has(hash >>> 0);

const DEFAULT_FOREST_KINDS = Object.freeze(["palm"]);

/** Перемешка работы в порядке: включена ли, виды (хотя бы один), районы, доля деревьев. */
export function normalizeForest(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const given = new Set(Array.isArray(source.kinds) ? source.kinds.map(String) : []);
  const kinds = TREE_KIND_IDS.filter((id) => given.has(id));
  return {
    enabled: source.enabled === true,
    kinds: kinds.length ? kinds : [...DEFAULT_FOREST_KINDS],
    areas: normalizeAreas(source.areas, ["city"]),
    share: clampShare(source.share, 100),
  };
}

/**
 * Решение по деревьям одной карты: `(archetype, x, y) → хеш новой модели |
 * null`. Дерево района меняется на вид из смеси с долей `share`; в каком
 * месте какой вид — по хешу места.
 */
export function treeChooser(forest, area) {
  const plan = normalizeForest(forest);
  if (!plan.enabled || !area || !plan.areas.includes(area)) return () => null;
  const kinds = plan.kinds.map((id) => TREE_BY_ID.get(id));
  const share = plan.share / 100;
  return (archetype, x, y) => {
    if (!isMixableTree(archetype) || placeShare(x, y, SALT_TREE) >= share) return null;
    const kind = kinds[Math.min(kinds.length - 1, Math.floor(placeShare(x, y, SALT_TREE_KIND) * kinds.length))];
    const hash = kind.hashes[Math.min(kind.hashes.length - 1, Math.floor(placeShare(x, y, SALT_TREE_MODEL) * kind.hashes.length))];
    return hash === archetype >>> 0 ? null : hash;
  };
}

/** Вид дерева по id (для подписей). */
export const treeKindOf = (id) => TREE_BY_ID.get(id) || null;
/** Вид цветов по id (для подписей). */
export const flowerKindOf = (id) => FLOWER_BY_ID.get(id) || null;

/* ------------------------------------------------------------------ *
 * Засаженность
 * ------------------------------------------------------------------ */

/*
 * Засаженность — одна ступень 0…100 % на три части (ТЗ 11.10.2026):
 *
 *   • `roads` — ряды деревьев вдоль трасс и улиц (план посадки,
 *     `vegetation-planting.js`): 50 % — каждое второе место ряда, 100 % — все
 *     места и второй-третий ряд у трасс;
 *   • `medians` — деревья и кусты разделительных полос и клумбы вдоль их
 *     бордюров;
 *   • `forests` — «как в модах»: в картах районов рядом с деревьями Rockstar
 *     встают новые рощами (`value` — сколько процентов к числу деревьев
 *     карты, до вдвое). В городе леса не гуще: у особняков и на улицах трава
 *     растёт у самых стен, зелень города — ряды и полосы.
 *
 * Районы по умолчанию — все: города касаются ряды и полосы.
 */
/* Посадка: районы по умолчанию — все, город сажают ряды и полосы. */
const DEFAULT_DENSITY_AREAS = VEGETATION_AREA_IDS;

/** Засаженность работы: процент 0…100 шагом 10, районы и части. */
export function normalizeDensity(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const value = Number(source.value);
  return {
    value: Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value)) / 10) * 10 : 0,
    areas: normalizeAreas(source.areas, DEFAULT_DENSITY_AREAS),
    /* Посадка: части засаженности, по умолчанию все. */
    roads: source.roads !== false,
    medians: source.medians !== false,
    forests: source.forests !== false,
  };
}

/** Леса гуще в районе: часть «Леса» включена, район выбран, не город. */
export const densityForestsIn = (density, area) =>
  Boolean(density?.value > 0 && density.forests !== false && area && area !== "city" && density.areas?.includes(area));

const SALT_PLANT = 0x0b1a;
const SALT_PLANT_KIND = 0x0b1b;
const SALT_PLANT_MODEL = 0x0b1c;
const SALT_PLANT_YAW = 0x0b1d;
const SALT_PLANT_SCALE = 0x0b1e;
/* Между новыми деревьями — не ближе 6 м (в глубине рощи; к краю — реже,
   до 9 м), до любой вещи карты — 4 м. */
export const PLANT_SPACING = 6;
export const PLANT_CLEARANCE = 4;
/* Дальность новых деревьев (самостоятельных, без карточки вдали): дальше
   самостоятельных деревьев Rockstar (126…159 м), ближе деревьев с карточкой
   (≈ 290 м) — роща не пропадает за поворотом, а лес не тяжелеет вдали. */
export const PLANT_LOD_DISTANCE = 200;
/* Посадка: решётка рощ — пятна шумом по клеткам 48 м. */
const GROVE_CELL = 48;
const SALT_GROVE = 0x0b1f;

/* Плавный шум 0…1: хеш углов клетки, гладкая смесь между ними. */
function groveField(x, y) {
  const gx = x / GROVE_CELL;
  const gy = y / GROVE_CELL;
  const cx = Math.floor(gx);
  const cy = Math.floor(gy);
  const fx = gx - cx;
  const fy = gy - cy;
  const corner = (dx, dy) => mix32(cx + dx, cy + dy, SALT_GROVE) / 4294967296;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * sx;
  const bottom = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * sx;
  return top + (bottom - top) * sy;
}

/* Сетка занятых мест: ячейка — шаг проверки. */
function occupancy(step) {
  const cells = new Map();
  const key = (x, y) => `${Math.floor(x / step)},${Math.floor(y / step)}`;
  return {
    add(x, y) {
      const cell = key(x, y);
      if (!cells.has(cell)) cells.set(cell, []);
      cells.get(cell).push(x, y);
    },
    near(x, y, distance) {
      const reach = Math.ceil(distance / step);
      const cx = Math.floor(x / step);
      const cy = Math.floor(y / step);
      for (let dx = -reach; dx <= reach; dx += 1)
        for (let dy = -reach; dy <= reach; dy += 1) {
          const list = cells.get(`${cx + dx},${cy + dy}`);
          if (!list) continue;
          for (let at = 0; at < list.length; at += 2) if (Math.hypot(list[at] - x, list[at + 1] - y) < distance) return true;
        }
      return false;
    },
  };
}

/**
 * Новые деревья одной карты — рощами. `entities` — сущности карты `[{
 * archetype, position, scale? }]`, `points` — земля под травой рядом (`[x,
 * y, z, …]`, места травинок: на дорогах, в зданиях и в воде травы нет),
 * `count` — сколько посадить, `mix` — смесь видов (`TREE_KINDS` по id) или
 * `null` — породы самой карты (как у Rockstar здесь, только гуще),
 * `occupied` — `[x, y, …]` мест, уже занятых посадкой (ряды вдоль дорог).
 *
 * Рощи (ТЗ 11.10.2026): места берутся не вразброс, а по плавному шуму
 * (`groveField`, пятна ≈ 50…150 м) и рядом с деревьями Rockstar — сначала
 * сердцевины пятен, с ростом засаженности рощи расширяются к краям. В
 * глубине рощи — 6 м между деревьями, к краю — реже (до 9 м); порода рощи
 * — как у ближайшего дерева Rockstar, у смеси — один вид на клетку рощи.
 * Возвращает `[{ archetype, position, rotation, scale, lodDist }]`: место,
 * поворот и размер — по хешу точки, поэтому кадр, пересборка и игра видят одно.
 */
export function plantTrees({ entities, points, count, mix = null, occupied = [] }) {
  if (!count || !points?.length) return [];
  const local = entities.filter((entity) => entity && isMixableTree(entity.archetype));
  const kinds = mix ? mix.map((id) => TREE_BY_ID.get(id)).filter(Boolean) : null;
  if (!kinds?.length && !local.length) return [];
  /* Размер — как у деревьев карты (Rockstar ставит их уменьшенными, ≈ 0,7). */
  const scales = local.map((entity) => entity.scale?.[0] || 1).sort((a, b) => a - b);
  const baseScale = scales.length ? scales[Math.floor(scales.length / 2)] : 0.75;
  const taken = occupancy(PLANT_SPACING);
  for (const entity of entities) if (entity) taken.add(entity.position[0], entity.position[1]);
  for (let at = 0; at + 1 < occupied.length; at += 2) taken.add(occupied[at], occupied[at + 1]);
  const planted = occupancy(PLANT_SPACING);
  /* Деревья Rockstar рядом — опора рощ: сетка 32 м для поиска ближайшего. */
  const neighbours = new Map();
  for (const entity of local) {
    const key = `${Math.floor(entity.position[0] / 32)},${Math.floor(entity.position[1] / 32)}`;
    if (!neighbours.has(key)) neighbours.set(key, []);
    neighbours.get(key).push(entity);
  }
  const nearest = (x, y) => {
    let best = null;
    let distance = Infinity;
    const cx = Math.floor(x / 32);
    const cy = Math.floor(y / 32);
    for (let dx = -2; dx <= 2; dx += 1)
      for (let dy = -2; dy <= 2; dy += 1)
        for (const entity of neighbours.get(`${cx + dx},${cy + dy}`) || []) {
          const d = Math.hypot(entity.position[0] - x, entity.position[1] - y);
          if (d < distance) {
            distance = d;
            best = entity;
          }
        }
    return { entity: best, distance };
  };
  /* Порядок мест: сердцевины пятен шума и места у деревьев Rockstar — первыми. */
  const order = [];
  for (let at = 0; at + 2 < points.length; at += 3) {
    const x = points[at];
    const y = points[at + 1];
    const near = nearest(x, y);
    const support = near.entity ? Math.max(0, 1 - near.distance / 40) * 0.35 : 0;
    const field = groveField(x, y) + support + placeShare(x, y, SALT_PLANT) * 0.08;
    order.push([-field, at, field]);
  }
  order.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const [, at, field] of order) {
    if (out.length >= count) break;
    const x = points[at];
    const y = points[at + 1];
    /* В глубине рощи гуще, к краю — реже. */
    const spacing = PLANT_SPACING + 3 * Math.max(0, Math.min(1, 1 - field));
    if (taken.near(x, y, PLANT_CLEARANCE) || planted.near(x, y, spacing)) continue;
    let archetype;
    if (kinds?.length) {
      const grove = mix32(Math.floor(x / GROVE_CELL), Math.floor(y / GROVE_CELL), SALT_PLANT_KIND) / 4294967296;
      const kind = kinds[Math.min(kinds.length - 1, Math.floor(grove * kinds.length))];
      archetype = kind.hashes[Math.min(kind.hashes.length - 1, Math.floor(placeShare(x, y, SALT_PLANT_MODEL) * kind.hashes.length))];
    } else {
      const near = nearest(x, y);
      archetype = near.entity && near.distance < 60 ? near.entity.archetype >>> 0 : local[Math.min(local.length - 1, Math.floor(placeShare(x, y, SALT_PLANT_MODEL) * local.length))].archetype >>> 0;
    }
    const yaw = placeShare(x, y, SALT_PLANT_YAW) * Math.PI * 2;
    const scale = Math.round(baseScale * (0.85 + placeShare(x, y, SALT_PLANT_SCALE) * 0.3) * 1000) / 1000;
    out.push({
      archetype,
      /* Ствол чуть в землю: место травинки — её основание на склоне. */
      position: [x, y, points[at + 2] - 0.15],
      rotation: [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)],
      scale: [scale, scale],
      lodDist: PLANT_LOD_DISTANCE,
    });
    planted.add(x, y);
  }
  return out;
}
