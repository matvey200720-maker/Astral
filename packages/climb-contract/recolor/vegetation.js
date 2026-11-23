/*
 * Растительность: цвет и густота листвы, «Реалистичные деревья», «Трава по
 * миру».
 *
 * Как устроена растительность GTA V (исследовано по файлам игры, 03.10.2026):
 *
 *  • ЛИСТВА — материалы моделей с шейдерами `trees_*` (кроны деревьев,
 *    кусты, растения). Лист — DiffuseSampler материала; форма листа — в
 *    альфе, шейдер РЕЖЕТ пиксели по порогу. Полупрозрачной листвы у игры
 *    нет: «прозрачность» листвы — только её густота (доля пикселей листа,
 *    которые остаются), а «без листвы» — альфа 0 у всех.
 *  • ИЗДАЛЕКА — карточки дальней прорисовки (`trees_lod`, `trees_lod2`): на
 *    одном листе и крона, и ствол, поэтому краска и густота ложатся только
 *    на «листовые» пиксели (зелёные тона), ствол остаётся.
 *  • ЗЕМЛЯ — четырёхслойные шейдеры `terrain_cb_w_4lyr*`: четыре листа (песок,
 *    кустарник, камень…), маска смешения и веса в цветах вершин; газоны
 *    города — листы `im_grass*`, `am_grass_*` и «мех» газонов (`*_fur`).
 *    Пустыня зелёная, когда на месте пустынных листов — трава и мох, а маски
 *    дают траве проступить. Так сделан мод владельца «зеленый сенди шортс»;
 *    его зелёные листы — в складе поставки (`scripts/prepare-vegetation-packs.mjs`).
 *  • ТРАВИНКИ — экземпляры карт травы (`*_grass_N.ymap`): модель травы
 *    (`proc_grasses01`, `urbangrngrass_01`…) с листом `ng_ip_*` и цвет
 *    каждого экземпляра; травинка в игре — лист × цвет экземпляра.
 *
 * «Трава по миру» (задача 4 ТЗ 06.10.2026, прежде «Зелёный Сэнди Шорс») —
 * две зоны: «Трава за городом» (пустыня, холмы, горы, леса и фермы) и
 * «Трава в городе» (газоны, парки, обочины и пустыри Лос-Сантоса). У каждой
 * своя трава: как в игре, как в моде (пустыня и пустыри в траве) или свой
 * цвет — эффектом мастерской. Зона файла — по тому, где в мире стоят вещи,
 * которые его берут (опись мира, `scripts/prepare-sandy-places.mjs`): общий
 * словарь земли красится той зоной, где его вещей больше. Прежде зона
 * решалась по имени и папке словаря — и трава аэропорта Лос-Сантоса
 * (`grdairportterrain`) красилась цветом пустыни.
 *
 * Цвет травы — сдвиг с рисунком (`grass-colour.js`), один у листов вблизи,
 * атласов вдали, травинок и снимка в окне.
 *
 * Работа (схема 4) — облик деревьев (`trees`), «Реалистичные деревья»
 * (`improved`), трава (`sandy`: включена ли, что в каждой зоне и «Обе сразу»), большие
 * кусты и живые изгороди (`bushes`), цветы на траве (`flowers`) и виды
 * деревьев перемешкой по районам (`forest`) — последние три с задачи 2 ТЗ
 * 10.10.2026 (вечер), устройство — `vegetation-world.js`. Одна арифметика у
 * кадра и у установщика.
 */

import { colourEffectAt, normalizeColourEffect } from "./colour-effects.js";
import { luma, normalizeRecolourHex, rgbToHsl, tintPixel } from "./colour.js";
import { GRASS_DISPLAY_GREEN } from "./grass-colour.js";
import { BUSH_MODES, VEGETATION_AREA_IDS, normalizeDensity, normalizeFlowers, normalizeForest } from "./vegetation-world.js";
import { normalizeVariety, varietyActive, varietySlots } from "./vegetation-variety.js";

export * from "./vegetation-world.js";
/* Посадка: ряды вдоль дорог, полосы и клумбы засаженности (11.10.2026). */
export * from "./vegetation-planting.js";
/* Покраска: процедурная трава, палитры тинта, камни карт травы (11.10.2026). */
export * from "./vegetation-paint.js";
/* «В разнобой»: деревья и кусты одного вида разными цветами палитры (17.10.2026). */
export * from "./vegetation-variety.js";

export {
  grassInstanceColour,
  grassTarget,
  grassWeight,
  recolourDistantBlocks,
  recolourDistantSand,
  recolourGrass,
  sandWeight,
} from "./grass-colour.js";

export const VEGETATION_PROJECT_SCHEMA = 4;
const NAME_LIMIT = 60;

/* Направления эффектов листвы: по породам, вдоль листа, по яркости. */
export const TREE_DIRECTION_LABELS = Object.freeze({
  along: "По породам",
  across: "Вдоль листа",
  height: "По яркости листвы",
});
/* Направления эффектов кустов: у каждой модели куста и листа изгороди своя доля. */
export const BUSH_DIRECTION_LABELS = Object.freeze({
  along: "По видам кустов",
  across: "Вдоль листа",
  height: "По яркости листвы",
});

/* Сэнди-Шорс: сам город и район вокруг (пустыня Гранд-Сенора). */
export const SANDY_TOWN = Object.freeze({ west: 1357, south: 3516, east: 2045, north: 3925 });
export const SANDY_REGION = Object.freeze({ west: 120, south: 2650, east: 2910, north: 4390 });
/*
 * Рамка травы за городом: от холмов Вайнвуда и Татавиама до Палето-Бэй. По
 * ней градиент и радуга травы ложатся по месту.
 */
export const SANDY_ZONE = Object.freeze({ west: -3500, south: 400, east: 4100, north: 7700 });
export const SANDY_CENTRE = Object.freeze([1700, 3720]);
/* Рамка травы в городе: Лос-Сантос от Пасифик-Блафс до Эль-Бурро, от порта до Вайнвуда. */
export const CITY_ZONE = Object.freeze({ west: -2700, south: -3600, east: 1700, north: 900 });
export const CITY_CENTRE = Object.freeze([220, -880]);

/* Зоны травы: где что красится. Порядок — порядок выбора в окне. */
export const GRASS_ZONES = Object.freeze([
  Object.freeze({
    id: "country",
    label: "Трава за городом",
    short: "За городом",
    note: "Пустыня, холмы, горы, леса и фермы — всё за пределами Лос-Сантоса",
  }),
  Object.freeze({
    id: "city",
    label: "Трава в городе",
    short: "В городе",
    note: "Газоны, парки, гольф-клуб, обочины и пустыри Лос-Сантоса, трава аэропорта",
  }),
]);
export const GRASS_ZONE_IDS = Object.freeze(GRASS_ZONES.map((zone) => zone.id));

/* Направления эффекта травы — по карте своей зоны (поля эффекта мастерской). */
export const GRASS_DIRECTION_LABELS = Object.freeze({
  country: Object.freeze({ along: "С запада на восток", across: "С юга на север", height: "От Сэнди-Шорс" }),
  city: Object.freeze({ along: "С запада на восток", across: "С юга на север", height: "От центра города" }),
});
export const SANDY_DIRECTION_LABELS = GRASS_DIRECTION_LABELS.country;

/*
 * Породы — по имени файла или листа: человек выбирает «Сосны», а не
 * z_prop_pine_2. Порядок — порядок полосы эффекта «По породам». Та же
 * таблица у описи (`scripts/prepare-vegetation-set.mjs`) и установщика.
 */
export const VEGETATION_SPECIES = Object.freeze([
  Object.freeze({ pattern: /pine|conifer/, id: "pine", label: "Сосны" }),
  Object.freeze({ pattern: /cedar/, id: "cedar", label: "Кедры" }),
  Object.freeze({ pattern: /palm/, id: "palm", label: "Пальмы" }),
  Object.freeze({ pattern: /birch/, id: "birch", label: "Берёзы" }),
  Object.freeze({ pattern: /oak/, id: "oak", label: "Дубы" }),
  Object.freeze({ pattern: /cypress/, id: "cypress", label: "Кипарисы" }),
  Object.freeze({ pattern: /olive/, id: "olive", label: "Оливы" }),
  Object.freeze({ pattern: /mquite|mesquite/, id: "mesquite", label: "Мескиты" }),
  Object.freeze({ pattern: /ficus/, id: "ficus", label: "Фикусы" }),
  Object.freeze({ pattern: /joshua|yucca/, id: "joshua", label: "Юкки" }),
  Object.freeze({ pattern: /maple/, id: "maple", label: "Клёны" }),
  Object.freeze({ pattern: /eucalyp/, id: "eucalyptus", label: "Эвкалипты" }),
  Object.freeze({ pattern: /willow/, id: "willow", label: "Ивы" }),
  Object.freeze({ pattern: /bush|shrub|hedge|scrub/, id: "bush", label: "Кусты" }),
  Object.freeze({ pattern: /agave|aloe|cactus|plant|fern|ivy|flower|veg/, id: "plant", label: "Растения" }),
  Object.freeze({ pattern: /tree|forest|dead/, id: "tree", label: "Другие деревья" }),
]);

/** Порода по имени файла или листа (`tree` — неузнанное дерево). */
export const vegetationSpeciesOf = (name) =>
  (VEGETATION_SPECIES.find((item) => item.pattern.test(String(name).toLowerCase())) || VEGETATION_SPECIES.at(-1)).id;

/* Цвета травы: зелень мода (её не перекрашивают — это «как в моде»), красный из ТЗ. */

/* Цвета травы: зелень мода (её не перекрашивают — это «как в моде»), красный из ТЗ. */
export const GRASS_GREEN = GRASS_DISPLAY_GREEN;
export const GRASS_RED = "#c0392b";
export const SANDY_GRASS_MODES = Object.freeze(["mod", "colour"]);
/* Свой цвет травы — эффект мастерской: цвет, градиент, радуга, перелив, линия. */
const DEFAULT_SANDY_LOOK = Object.freeze({ mode: "solid", colour: GRASS_RED, colour2: "#f2c94c", direction: "along", width: 10, shift: 0 });

/* ------------------------------------------------------------------ *
 * Работа
 * ------------------------------------------------------------------ */

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

function clampPercent(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(100, Math.max(0, number)));
}

const DEFAULT_TREES = Object.freeze({ mode: "solid", colour: "#d9741e", colour2: "#f2c94c", direction: "along", width: 2, shift: 0 });
const DEFAULT_BUSHES = Object.freeze({ mode: "solid", colour: "#8e44ad", colour2: "#f2c94c", direction: "along", width: 2, shift: 0 });
const defaultZone = () => ({ enabled: true, grass: "mod", look: normalizeColourEffect({}, DEFAULT_SANDY_LOOK) });

/*
 * Породы, которым можно дать свой цвет: все, кроме кустов (у них свой
 * инструмент), — по таблице пород (`VEGETATION_SPECIES`), одной у описи,
 * установщика и кадра.
 */
export const PAINTABLE_SPECIES = Object.freeze(VEGETATION_SPECIES.filter((item) => item.id !== "bush").map((item) => item.id));

function speciesColoursOf(input) {
  const source = plain(input);
  const out = {};
  for (const id of PAINTABLE_SPECIES) {
    const colour = normalizeRecolourHex(source[id], null);
    if (colour) out[id] = colour;
  }
  return out;
}

/*
 * Большие кусты и живые изгороди. Работы до схемы 4 кустов не знали: кусты
 * красились с листвой деревьев — это и есть «как листва» по умолчанию.
 */
function bushesOf(source) {
  const bushes = plain(source);
  return {
    mode: BUSH_MODES.includes(bushes.mode) ? bushes.mode : "foliage",
    look: normalizeColourEffect(bushes.look, DEFAULT_BUSHES),
    hedges: bushes.hedges !== false,
  };
}

/* Трава одной зоны: красится ли, как в моде или свой цвет (эффект). */
function zoneOf(source, fallback) {
  const zone = plain(source);
  const grass = SANDY_GRASS_MODES.includes(zone.grass) ? zone.grass : fallback.grass;
  const stored = plain(zone.look);
  const look = stored.mode
    ? normalizeColourEffect(stored, DEFAULT_SANDY_LOOK)
    : normalizeColourEffect({ ...fallback.look, colour: normalizeRecolourHex(zone.colour, fallback.look.colour) }, DEFAULT_SANDY_LOOK);
  return { enabled: typeof zone.enabled === "boolean" ? zone.enabled : fallback.enabled, grass, look };
}

/*
 * Трава работ до 06.10.2026 (схемы 1–2): одна на все части. Схема 1 хранила
 * цвет травы полем эффектов: зелёный — «как в моде», любой другой — свой
 * цвет; схема 2 — `grass` и эффект `look`.
 */
function legacyGrass(source) {
  if (SANDY_GRASS_MODES.includes(source.grass)) {
    const colour = normalizeRecolourHex(source.colour, GRASS_RED);
    const stored = plain(source.look);
    return { grass: source.grass, look: normalizeColourEffect(stored.mode ? stored : { mode: "solid", colour }, { ...DEFAULT_SANDY_LOOK, colour }) };
  }
  const old = plain(source.look);
  const colour = normalizeRecolourHex(old.colour, GRASS_GREEN);
  return old.colour && colour !== GRASS_GREEN
    ? { grass: "colour", look: normalizeColourEffect({ mode: "solid", colour }, DEFAULT_SANDY_LOOK) }
    : { grass: "mod", look: normalizeColourEffect({}, DEFAULT_SANDY_LOOK) };
}

/* Поля травы схем 1–2 (одна трава на все части). */
const LEGACY_GRASS_KEYS = Object.freeze(["grass", "look", "colour", "areas"]);

/*
 * Зоны травы. Прежние части «Пустыня и Сэнди-Шорс» и «Холмы и горы» — это
 * «за городом», «Пустыри города» — «в городе»; трава у обеих — прежняя.
 *
 * Новая работа красит только траву за городом: город — своим выключателем
 * (владелец 25.10.2026: «выбрал за городом, а у него красилось в обе» — обе
 * зоны были включены сразу). Включённая трава без зон — работа схемы 1, у
 * неё обе зоны, как и были.
 *
 * «Обе сразу» (`both`, решение владельца 25.10.2026) — своя трава на обе
 * зоны со своим выключателем: включён — обе зоны берут его траву (как в
 * моде или свой цвет), выключен — у каждой зоны её настройки, как их
 * выставили. Настройки зон он не трогает. Работы до 25.10.2026 его не знали —
 * выключен.
 */
function sandyOf(source) {
  const given = plain(source.zones);
  let zones;
  if (Object.keys(given).length) zones = Object.fromEntries(GRASS_ZONE_IDS.map((id) => [id, zoneOf(given[id], defaultZone())]));
  else if (source.enabled === true || LEGACY_GRASS_KEYS.some((key) => key in source)) {
    const areas = plain(source.areas);
    const legacy = legacyGrass(source);
    /* Схемы 1–2 без единой части красили загород — так и читаются. */
    const city = areas.city !== false;
    zones = {
      country: { enabled: areas.desert !== false || areas.hills !== false || !city, ...legacy },
      city: { enabled: city, ...legacy },
    };
  } else zones = { country: defaultZone(), city: { ...defaultZone(), enabled: false } };
  /* Обе зоны выключены — трава как в игре (`grassActive`). Прежде здесь сама
     включалась трава за городом: выключатель зоны «вырубался» обратно. */
  return { zones, both: zoneOf(source.both, { ...defaultZone(), enabled: false }) };
}

/**
 * Трава зоны в игре по траве работы (`sandy` — уже разобранная): «Обе сразу»
 * включён — его трава на обе зоны, иначе — настройки самой зоны.
 */
export const grassZoneSettings = (sandy, zone) => (sandy.both?.enabled ? { ...sandy.both, enabled: true } : sandy.zones[zone]);

/** «Трава по миру» что-то красит: включена и хотя бы одна зона (или «Обе сразу»). */
const grassActive = (project) => project.sandy.enabled && GRASS_ZONE_IDS.some((id) => grassZoneSettings(project.sandy, id).enabled);

export function normalizeVegetationProject(input) {
  const source = plain(input);
  const trees = plain(source.trees);
  const improved = plain(source.improved);
  const sandy = plain(source.sandy);
  return {
    schema: VEGETATION_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    trees: {
      tint: trees.tint === true,
      look: normalizeColourEffect(trees.look, DEFAULT_TREES),
      /* Густота листвы: 100 — как в игре, 0 — деревья без листьев. */
      foliage: clampPercent(trees.foliage, 100),
      /* Свой цвет пород (задача 2 ТЗ 10.10.2026, вечер): пальмы — одним,
         сосны — другим; поверх общего облика листвы. */
      species: speciesColoursOf(trees.species),
    },
    /* «Реалистичные деревья» — склад поставки, файл мода человеку не нужен. */
    improved: { enabled: improved.enabled === true },
    sandy: { enabled: sandy.enabled === true, ...sandyOf(sandy) },
    bushes: bushesOf(source.bushes),
    flowers: normalizeFlowers(source.flowers),
    forest: normalizeForest(source.forest),
    density: normalizeDensity(source.density),
    /* «В разнобой» (задача 7 ТЗ 17.10.2026): палитра по миру. */
    variety: normalizeVariety(source.variety),
  };
}

export const createVegetationProject = () => normalizeVegetationProject({});
export const serializeVegetationProject = (project) => JSON.stringify(normalizeVegetationProject(project));

export function parseVegetationProject(text) {
  try {
    return normalizeVegetationProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createVegetationProject();
  }
}

/** Всё как у Rockstar: ставить нечего. */
export function vegetationProjectIsVanilla(input) {
  const project = normalizeVegetationProject(input);
  return (
    !treesChange(project) &&
    !project.improved.enabled &&
    !grassActive(project) &&
    project.bushes.mode !== "colour" &&
    project.flowers.mode === "game" &&
    !project.forest.enabled &&
    !project.density.value &&
    !varietyActive(project.variety)
  );
}

/* «В разнобой» у деревьев (кустов): модели игры — нулевого места палитры, остальные — копии. */
const varietyTrees = (project) => varietyActive(project.variety) && project.variety.trees;
const varietyBushes = (project) => varietyActive(project.variety) && project.variety.bushes;

/**
 * Архетип вида со своим цветом: `(item: { name, group }) → boolean`. Такой вид «В разнобой» не трогает — ни копий
 * моделей, ни места палитры; его деревья красит цвет вида (`compileVegetationLooks` → `trees.bySpecies`). Вид — по
 * имени модели (`vegetationSpeciesOf`), как у описи копий; кусты видов не имеют.
 */
export function varietyPainted(input) {
  const own = normalizeVegetationProject(input).trees.species;
  return (item) => Boolean(item) && item.group !== "bush" && Boolean(own[vegetationSpeciesOf(item.name)]);
}

/** Листва деревьев меняется (свой цвет, цвет пород, густота или разнобой). */
export const treesChange = (project) =>
  Boolean(project.trees.tint || project.trees.foliage < 100 || Object.keys(project.trees.species || {}).length || varietyTrees(project));

/**
 * Что получают кусты в игре: `null` — как в игре; `{ follow: true }` — как
 * листва деревьев (её цвет и густота); `{ follow: false, look }` — свой цвет.
 */
export function bushStyleOf(input) {
  const project = normalizeVegetationProject(input);
  const { bushes } = project;
  /* «В разнобой» у кустов: модели игры и их карточки — нулевого места
     палитры («как в игре» — без правки), остальные кусты — копиями. Живые
     изгороди — модели карт, не кусты: разнобой их не красит (687 словарей,
     около гигабайта — ради одного цвета). */
  if (varietyBushes(project)) {
    const base = varietySlots(project.variety)[0].colour;
    return base ? { follow: false, look: solid(base), hedges: false } : null;
  }
  if (bushes.mode === "colour") return { follow: false, look: bushes.look, hedges: bushes.hedges };
  /* «Как листва» — общий облик листвы; свой цвет пород кусты не берут. */
  if (bushes.mode === "foliage" && (project.trees.tint || project.trees.foliage < 100)) return { follow: true, look: null, hedges: bushes.hedges };
  return null;
}

/**
 * Нужен ли установщику план «Травы по миру» (карты травы и модели травинок):
 * трава своя, цветы или «без цветов», засаженность (новые деревья встают на
 * места травинок — на землю).
 */
export function vegetationNeedsGrassPlan(input) {
  const project = normalizeVegetationProject(input);
  return grassActive(project) || project.flowers.mode !== "game" || project.density.value > 0 || (varietyActive(project.variety) && project.variety.grass);
}

/** Зоны, где трава меняется (ids по порядку); пусто — трава как в игре. */
export const grassZonesOf = (input) => {
  const { sandy } = normalizeVegetationProject(input);
  return sandy.enabled ? GRASS_ZONE_IDS.filter((id) => grassZoneSettings(sandy, id).enabled) : [];
};

/**
 * Трава зоны в игре: `null` — как в игре, `{ mod: true, look: null }` —
 * зелень мода, `{ mod: false, look }` — свой цвет эффектом.
 */
export function grassZoneOf(input, zone) {
  const { sandy } = normalizeVegetationProject(input);
  const part = GRASS_ZONE_IDS.includes(zone) ? grassZoneSettings(sandy, zone) : null;
  if (!sandy.enabled || !part?.enabled) return null;
  return part.grass === "colour" ? { mod: false, look: part.look } : { mod: true, look: null };
}

/** Эффект травы зоны: `null` — как в игре или зелень мода. */
export const grassZoneLook = (input, zone) => grassZoneOf(input, zone)?.look || null;

/**
 * Зона, чьим цветом красятся общие на весь мир файлы травы — спрайты
 * процедурной травы (`plantsmgr*.ytd`) и наземные растения без своего места;
 * `null` — они как в игре. Один такой файл лежит и в городе, и за городом:
 * цвет одной зоны лёг бы и на другую (владелец 25.10.2026: «выбрал за
 * городом, а у него красилось в обе»). Поэтому они красятся, только когда
 * своим цветом красятся обе зоны, — цветом травы за городом, там их больше.
 */
export const sharedGrassZone = (input) => (GRASS_ZONE_IDS.every((id) => grassZoneLook(input, id)) ? GRASS_ZONE_IDS[0] : null);

/* Рамки эффекта по зонам: «по карте» — по своей зоне, от края до края. */
const ZONE_FRAMES = Object.freeze({
  country: Object.freeze({ box: SANDY_ZONE, centre: SANDY_CENTRE, radius: 5200 }),
  city: Object.freeze({ box: CITY_ZONE, centre: CITY_CENTRE, radius: 3200 }),
});

/**
 * Доля эффекта травы в точке мира: «С запада на восток» и «С юга на север» —
 * через всю рамку зоны, «От Сэнди-Шорс» («От центра города») — от середины
 * зоны наружу. У линии — доля периода: полоса шириной `width × 100` м.
 */
export function sandyShareAt(look, x, y, zone = "country") {
  return shareOfEffect(normalizeColourEffect(look, DEFAULT_SANDY_LOOK), x, y, zone);
}

/**
 * Цвет травы по карте одной функцией `(x, y) → [r, g, b]` — для миллионов
 * травинок карт травы: эффект разбирается один раз, цвета — `steps`
 * ступенями доли (у радуги через всю зону — ≈ 30 м на ступень).
 */
export function sandyColourField(look, steps = 256, zone = "country") {
  const effect = normalizeColourEffect(look, DEFAULT_SANDY_LOOK);
  const palette = Array.from({ length: steps + 1 }, (_, index) => colourEffectAt(effect, index / steps));
  const field = (x, y) => palette[Math.round(shareOfEffect(effect, x, y, zone) * steps)];
  /* Для движка (`vegetation-engine-build.js`): та же полоса цветов и рамка зоны числами — долю по месту он считает сам. */
  const { box, centre, radius } = ZONE_FRAMES[zone] || ZONE_FRAMES.country;
  field.engine = { palette, steps, direction: ["across", "height"].includes(effect.direction) ? effect.direction : "along", line: effect.mode === "line", width: effect.width, box, centre, radius };
  return field;
}

function shareOfEffect(effect, x, y, zone) {
  const { box, centre, radius } = ZONE_FRAMES[zone] || ZONE_FRAMES.country;
  const span =
    effect.direction === "across"
      ? (y - box.south) / (box.north - box.south)
      : effect.direction === "height"
        ? Math.hypot(x - centre[0], y - centre[1]) / radius
        : (x - box.west) / (box.east - box.west);
  if (effect.mode !== "line") return Math.min(1, Math.max(0, span));
  const metres = span * (effect.direction === "height" ? radius : effect.direction === "across" ? box.north - box.south : box.east - box.west);
  const period = effect.width * 200;
  return (((metres % period) + period) % period) / period;
}

/**
 * Цвет травы в точке мира — байты `[r, g, b]` или `null` (без эффекта).
 * `steps` — ступеней доли на всю зону (0 — без ступеней): у листов целого
 * файла соседние файлы различаются на ступень, а готовый лист одного цвета
 * переиспользуется — сборка радуги не кодирует каждый лист заново.
 */
export function sandyColourAt(look, x, y, steps = 0, zone = "country") {
  if (!look) return null;
  const share = sandyShareAt(look, x, y, zone);
  return colourEffectAt(look, steps > 0 ? Math.round(share * steps) / steps : share);
}

/** Середина зоны — точка, где кадр в окне показывает цвет травы. */
export const grassZoneCentre = (zone) => (ZONE_FRAMES[zone] || ZONE_FRAMES.country).centre;

/*
 * Части схемы 4 в отпечатке — только когда они не по умолчанию: работа,
 * поставленная до 10.10.2026, остаётся с тем же отпечатком.
 */
function worldSignature(project) {
  const out = {};
  const { bushes, flowers, forest } = project;
  if (bushes.mode !== "foliage" || !bushes.hedges)
    out.bushes = { mode: bushes.mode, look: bushes.mode === "colour" ? bushes.look : null, hedges: bushes.hedges };
  if (flowers.mode !== "game")
    out.flowers = { mode: flowers.mode, kinds: flowers.mode === "add" ? flowers.kinds : null, share: flowers.mode === "add" ? flowers.share : null, areas: flowers.areas };
  if (forest.enabled) out.forest = { kinds: forest.kinds, areas: forest.areas, share: forest.share };
  if (project.density.value) out.density = project.density;
  if (varietyActive(project.variety)) out.variety = project.variety;
  return out;
}

/** Отпечаток для очереди «Применить»: тот же облик — тот же отпечаток. */
export function vegetationProjectSignature(input) {
  const project = normalizeVegetationProject(input);
  return JSON.stringify({
    trees: {
      tint: project.trees.tint,
      look: project.trees.tint ? project.trees.look : null,
      foliage: project.trees.foliage,
      /* Цвет пород — только если есть: прежние работы — с прежним отпечатком. */
      ...(Object.keys(project.trees.species).length ? { species: project.trees.species } : {}),
    },
    improved: project.improved.enabled,
    sandy: grassActive(project)
      ? {
          zones: Object.fromEntries(
            GRASS_ZONE_IDS.map((id) => {
              /* Трава, что ляжет в игру: у «Обе сразу» — его; прежние работы — с прежним отпечатком. */
              const zone = grassZoneSettings(project.sandy, id);
              return [id, zone.enabled ? { grass: zone.grass, look: zone.grass === "colour" ? zone.look : null } : null];
            }),
          ),
        }
      : null,
    ...worldSignature(project),
  });
}

/** Работа для кода другу: путей и своих файлов в ней нет. */
export const shareableVegetationProject = (input) => normalizeVegetationProject(input);
export const vegetationLostInCode = () => "";

/* ------------------------------------------------------------------ *
 * Листва
 * ------------------------------------------------------------------ */

const STRIP = 256;

/**
 * Эффект, готовый к расчёту: полоса цветов на 256 ступеней (как у воды) и
 * цель перекраски у каждой — тон, насыщенность и светлота: разбор цвета на
 * каждый пиксель листа стоил бы минут на всю листву игры.
 */
export function compileVegetationEffect(input) {
  const effect = normalizeColourEffect(input);
  const strip = new Float32Array(STRIP * 3);
  const targets = [];
  for (let step = 0; step < STRIP; step += 1) {
    const t = effect.mode === "line" ? (step + 0.5) / STRIP : step / (STRIP - 1);
    const rgb = colourEffectAt(effect, t);
    strip.set(rgb, step * 3);
    const [h, sat, l] = rgbToHsl(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    targets.push({ h, s: sat, l });
  }
  return { effect, strip, targets };
}

function stripStep(compiled, t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return compiled.effect.mode === "line" ? Math.min(STRIP - 1, Math.floor(x * STRIP)) : Math.round(x * (STRIP - 1));
}

/**
 * Облик работы, готовый к расчёту. У кустов (`bushes`): `null` — как в
 * игре, иначе `{ compiled, foliage, hedges }` — листва деревьев («как
 * листва») или свой цвет с густотой как в игре.
 */
export function compileVegetationLooks(input) {
  const project = normalizeVegetationProject(input);
  const bush = bushStyleOf(project);
  /* «В разнобой»: модели игры и карточки вдали — нулевого места палитры
     ровным цветом (у «как в игре» — без цвета); общий «Свой цвет листвы» не берётся, а свой цвет вида — берётся
     и побеждает палитру у своего вида. */
  const variety = varietyTrees(project);
  const base = variety ? varietySlots(project.variety)[0].colour : null;
  const trees = {
    tint: variety ? Boolean(base) : project.trees.tint,
    compiled: variety ? (base ? compileVegetationEffect(solid(base)) : null) : project.trees.tint ? compileVegetationEffect(project.trees.look) : null,
    foliage: project.trees.foliage,
    /* Свой цвет вида — ровным цветом поверх облика листвы и поверх палитры «В разнобой» (решение 24.10.2026): модели
       такого вида игры не копируются, а красятся цветом вида (`varietyPainted`). */
    bySpecies: Object.fromEntries(
      Object.entries(project.trees.species).map(([id, colour]) => [id, compileVegetationEffect({ mode: "solid", colour, colour2: "#ffffff", direction: "along", width: 2, shift: 0 })]),
    ),
    active: treesChange(project),
  };
  return {
    trees,
    bushes: bush
      ? bush.follow
        ? { compiled: trees.compiled, foliage: trees.foliage, hedges: bush.hedges, follow: true }
        : { compiled: compileVegetationEffect(bush.look), foliage: 100, hedges: bush.hedges, follow: false }
      : null,
    sandy: {
      enabled: grassActive(project),
      zones: Object.fromEntries(
        GRASS_ZONE_IDS.map((id) => {
          const zone = grassZoneOf(project, id);
          return [id, { enabled: Boolean(zone), mod: Boolean(zone?.mod), look: zone?.look || null }];
        }),
      ),
    },
  };
}


/* Порог альфы шейдера листвы: ниже — пиксель срезан. */
const ALPHA_CUT = 8;

/* Детерминированный «шум» густоты: тот же пиксель — то же решение в кадре и
   в игре, на каждом уровне mip по координатам нулевого. */
function keep(px, py, level, salt, share) {
  if (share >= 1) return true;
  if (share <= 0) return false;
  let h = ((px << level) * 374761393 + (py << level) * 668265263 + salt * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 0xffff) / 0x10000 < share;
}

/*
 * Насколько пиксель карточки — листва (0…1): зелень бывает тёмной и почти
 * серой, ствол — бурый (красного больше зелёного). Мерка мягкая, иначе тёмная
 * крона красилась бы пятнами: где листва уверенная, цвет ложится целиком,
 * на переходе к стволу — частью.
 */
function leafWeight(r, g, b) {
  const lead = g - Math.max(r, b * 0.9);
  if (lead <= -6) return 0;
  if (lead >= 6) return 1;
  return (lead + 6) / 12;
}

/* Покраска: у листа изгороди со стеной серое — стена, а не листва (у карточки
   серое — спорная тень кроны, там мерка мягче). */
function wallLeafWeight(r, g, b) {
  const lead = g - Math.max(r, b * 0.9);
  return lead <= 0 ? 0 : lead >= 6 ? 1 : lead / 6;
}

/*
 * Опора светотени карточки вдали — средняя листва моделей рядом, а не сама
 * карточка (задача 5 ТЗ 06.10.2026, вечер). Rockstar держит карточки темнее
 * листвы рядом: замер по игре — середина листвы моделей 63 из 255, карточек
 * 39, то есть 0,62 от листвы. Карточку освещает свой шейдер ровно, без
 * самозатенения кроны, и эта разница и делает дальнее дерево похожим на
 * ближнее. Своя опора карточки делала бы её среднее «ровно цветом», как
 * листва рядом, — карточки в светлом цвете вдали горели втрое ярче деревьев
 * («столбы пламени» в кадрах из игры).
 */
export const CARD_LEAF_REF = 63 / 255;

/**
 * Уровень листа листвы в облике работы: `rgba` — пиксели уровня `level`
 * (размер `width × height`), `options`:
 *   compiled — эффект цвета (`compileVegetationEffect`) или `null` (цвет игры);
 *   species  — доля породы 0…1 (направление «По породам»);
 *   foliage  — густота листвы 0…100;
 *   card     — лист карточки вдали: только листовые пиксели;
 *   leafOnly — лист, где кроме листвы есть стена, кора или лепестки
 *              (плющ на стене, изгородь с ветками, клумба): красятся
 *              только листовые пиксели, опора — их средняя (покраска
 *              11.10.2026);
 *   salt     — у каждого листа свой узор густоты.
 * Возвращает новые пиксели или тот же массив, если ничего не меняется.
 */
export function recolourLeafLevel(rgba, width, height, { compiled = null, species = 0.5, foliage = 100, card = false, leafOnly = false, level = 0, salt = 0 } = {}) {
  if (!compiled && foliage >= 100) return rgba;
  const weightOf = card ? leafWeight : leafOnly ? wallLeafWeight : null;
  /* Средняя яркость листа — опора светотени: средний лист станет ровно цветом.
     У карточки опора не ниже листвы рядом (`CARD_LEAF_REF`). */
  let sum = 0;
  let count = 0;
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at + 3] < ALPHA_CUT || (weightOf && weightOf(rgba[at], rgba[at + 1], rgba[at + 2]) < 0.5)) continue;
    sum += luma(rgba[at], rgba[at + 1], rgba[at + 2]) / 255;
    count += 1;
  }
  if (!count) return rgba;
  const ref = Math.max(0.04, card ? Math.max(CARD_LEAF_REF, sum / count) : sum / count);
  const share = foliage / 100;
  const direction = compiled?.effect.direction;
  const out = new Uint8ClampedArray(rgba);
  for (let py = 0; py < height; py += 1)
    for (let px = 0; px < width; px += 1) {
      const at = (py * width + px) * 4;
      const r = rgba[at];
      const g = rgba[at + 1];
      const b = rgba[at + 2];
      if (rgba[at + 3] < ALPHA_CUT) continue;
      const weight = weightOf ? weightOf(r, g, b) : 1;
      if (weight <= 0) continue;
      if (weight >= 0.5 && !keep(px, py, level, salt, share)) {
        out[at + 3] = 0;
        continue;
      }
      if (!compiled) continue;
      const t =
        direction === "across" ? (py + 0.5) / height : direction === "height" ? luma(r, g, b) / 255 / Math.max(0.05, ref * 2) : species;
      const [nr, ng, nb] = tintPixel(r / 255, g / 255, b / 255, compiled.targets[stripStep(compiled, t)], { ref });
      out[at] = (r + (nr * 255 - r) * weight) | 0;
      out[at + 1] = (g + (ng * 255 - g) * weight) | 0;
      out[at + 2] = (b + (nb * 255 - b) * weight) | 0;
    }
  return out;
}

/** Доля породы для эффекта «По породам»: место в таблице пород по имени (одно у кадра и установщика). */
const SPECIES_ORDER = Object.freeze(VEGETATION_SPECIES.map((item) => item.id).sort());
export const speciesShare = (id) => {
  const index = SPECIES_ORDER.indexOf(id);
  return index < 0 ? 0.5 : index / (SPECIES_ORDER.length - 1);
};

/*
 * Доля куста для «По видам кустов»: у каждой модели куста и каждого листа
 * изгороди своя — по имени без расширения и `+hi` (`prop_bush_lrg_01` →
 * 0…1), одна у кадра и установщика.
 */
export function bushShare(name) {
  const base = String(name)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/\+hi(dr|fr)?$/, "");
  let hash = 0x811c9dc5;
  for (let index = 0; index < base.length; index += 1) hash = Math.imul(hash ^ base.charCodeAt(index), 0x01000193) >>> 0;
  return (hash % 1000) / 999;
}

/* ------------------------------------------------------------------ *
 * Готовые виды
 * ------------------------------------------------------------------ */

const solid = (colour) => ({ mode: "solid", colour, colour2: "#ffffff", direction: "along", width: 2, shift: 0 });
/* Трава обеих зон одним эффектом — «Обе сразу»: настройки зон остаются, выключил его — вернулись. */
const everywhere = (look) => ({ enabled: true, both: { enabled: true, grass: "colour", look } });
const everywhereMod = Object.freeze({ enabled: true, both: { enabled: true, grass: "mod" } });

const gradient = (colour, colour2, direction = "along") => ({ mode: "gradient", colour, colour2, direction, width: 2, shift: 0 });
const ALL_AREAS = VEGETATION_AREA_IDS;

/*
 * Готовый вид меняет только свою часть: листва — деревья, трава — зоны травы.
 * «Как в игре» возвращает всё.
 *
 * Времена года (`season`) — свой вид каждой части разом: листва, кусты и
 * изгороди, трава и земля, цветы (задача 2 ТЗ 10.10.2026, вечер). Деревья
 * перемешки сезон не трогает. Взятый сезон правится как любая работа — так
 * человек делает свои времена года.
 */
export const VEGETATION_PRESETS = Object.freeze(
  [
    {
      id: "season-spring",
      label: "Весна",
      season: true,
      description: "Молодая листва и цветение, пустыня и пустыри в сочной траве, по полям — маки, люпины и одуванчики",
      trees: { tint: true, look: gradient("#8fce4e", "#f3b3cc"), foliage: 85 },
      bushes: { mode: "colour", look: solid("#7fc449"), hedges: true },
      sandy: everywhereMod,
      flowers: { mode: "add", kinds: ["poppy", "lupin", "dandelion", "meadow"], share: 45, areas: ALL_AREAS },
    },
    {
      id: "season-summer",
      label: "Лето",
      season: true,
      description: "Листва и сухая трава Rockstar — жаркое лето Лос-Сантоса, по полям — белые и жёлтые цветы",
      trees: { tint: false, foliage: 100 },
      bushes: { mode: "foliage", hedges: true },
      sandy: { enabled: false },
      flowers: { mode: "add", kinds: ["quinine", "daisy", "paintbrush", "brittlebush"], share: 25, areas: ALL_AREAS },
    },
    {
      id: "season-autumn",
      label: "Осень",
      season: true,
      description: "Золото и медь листвы, кусты в ржавчину, жёлтая трава, цветов нет",
      trees: { tint: true, look: gradient("#f2c94c", "#b5471b"), foliage: 80 },
      bushes: { mode: "colour", look: solid("#a8431c"), hedges: true },
      sandy: everywhere(solid("#d8a73a")),
      flowers: { mode: "none", areas: ALL_AREAS },
    },
    {
      id: "season-winter",
      label: "Зима",
      season: true,
      description: "Кроны в инее и реже, кусты в снегу, белая земля, цветов нет",
      trees: { tint: true, look: solid("#e4ebf1"), foliage: 55 },
      bushes: { mode: "colour", look: solid("#dfe7ee"), hedges: true },
      sandy: everywhere(solid("#f4f7ff")),
      flowers: { mode: "none", areas: ALL_AREAS },
    },
    {
      id: "game",
      label: "Как в игре",
      description: "Листва, кусты, цветы и трава Rockstar",
      trees: { tint: false, foliage: 100 },
      bushes: { mode: "foliage", hedges: true },
      sandy: { enabled: false },
      flowers: { mode: "game" },
      forest: { enabled: false },
      density: { value: 0 },
      variety: { enabled: false },
    },
    { id: "autumn", label: "Рыжая листва", description: "Рыжая листва по всему штату", trees: { tint: true, look: solid("#d9741e"), foliage: 85 } },
    {
      id: "golden",
      label: "Золотая осень",
      description: "От жёлтого к медному — по породам",
      trees: { tint: true, look: { mode: "gradient", colour: "#f2c94c", colour2: "#b5471b", direction: "along", width: 2, shift: 0 }, foliage: 90 },
    },
    { id: "sakura", label: "Сакура", description: "Розовые кроны", trees: { tint: true, look: solid("#f2a7c3"), foliage: 100 } },
    { id: "sparse", label: "Редкая листва", description: "Половина листьев — сквозь кроны видно", trees: { tint: false, foliage: 50 } },
    { id: "winter", label: "Без листвы", description: "Голые деревья, как зимой", trees: { tint: false, foliage: 0 } },
    {
      id: "rainbow",
      label: "Радужный лес",
      description: "Каждая порода своего цвета",
      trees: { tint: true, look: { mode: "rainbow", colour: "#ff0000", colour2: "#ffffff", direction: "along", width: 2, shift: 0 }, foliage: 100 },
    },
    {
      id: "green-sandy",
      label: "Трава мода",
      description: "Пустыня и пустыри города в траве — как в моде",
      sandy: everywhereMod,
    },
    {
      id: "autumn-country",
      label: "Оранжевая трава за городом",
      description: "Оранжевая трава за городом, в городе — как в игре",
      sandy: { enabled: true, zones: { country: { enabled: true, grass: "colour", look: solid("#e67e22") }, city: { enabled: false } } },
    },
    {
      id: "blue-city",
      label: "Синие газоны",
      description: "Трава города — синяя, за городом — как в игре",
      sandy: { enabled: true, zones: { country: { enabled: false }, city: { enabled: true, grass: "colour", look: solid("#2f80ed") } } },
    },
    { id: "red-sandy", label: "Красная трава", description: "Вся трава — красная, в городе и за городом", sandy: everywhere(solid(GRASS_RED)) },
    { id: "golden-sandy", label: "Золотая трава", description: "Цвета спелой пшеницы по всему миру", sandy: everywhere(solid("#d8a73a")) },
    {
      id: "rainbow-sandy",
      label: "Радужная трава",
      description: "Радуга с запада на восток — через каждую зону",
      sandy: everywhere({ mode: "rainbow", colour: GRASS_RED, colour2: "#f2c94c", direction: "along", width: 10, shift: 0 }),
    },
    {
      id: "gradient-sandy",
      label: "Трава градиентом",
      description: "Зелёная в середине зоны, золотая к краям",
      sandy: everywhere({ mode: "gradient", colour: "#4f9a2c", colour2: "#d8a73a", direction: "height", width: 10, shift: 0 }),
    },
  ].map((item) => Object.freeze(item)),
);

const PRESET_MAP = Object.freeze(Object.fromEntries(VEGETATION_PRESETS.map((item) => [item.id, item])));

/*
 * Трава готового вида поверх работы: зоны, которых вид не называет, — как
 * были. Вид на весь мир — «Обе сразу» (настройки зон не трогает); вид своих
 * зон «Обе сразу» выключает, иначе его трава закрыла бы вид.
 */
function withPresetGrass(current, preset) {
  const zones = { ...current.zones };
  for (const id of GRASS_ZONE_IDS) if (preset.zones?.[id]) zones[id] = { ...current.zones[id], ...preset.zones[id] };
  const both = preset.both ? { ...current.both, ...preset.both } : preset.zones ? { ...current.both, enabled: false } : current.both;
  return { ...current, ...preset, zones, both };
}

/** Работа с частью готового вида; имя и остальное — как были. */
export function applyVegetationPreset(input, presetId) {
  const project = normalizeVegetationProject(input);
  const found = PRESET_MAP[presetId];
  if (!found) return project;
  return normalizeVegetationProject({
    ...project,
    ...(found.trees ? { trees: { ...project.trees, ...found.trees } } : {}),
    ...(found.sandy ? { sandy: withPresetGrass(project.sandy, found.sandy) } : {}),
    ...(found.bushes ? { bushes: { ...project.bushes, ...found.bushes } } : {}),
    ...(found.flowers ? { flowers: { ...project.flowers, ...found.flowers } } : {}),
    ...(found.forest ? { forest: { ...project.forest, ...found.forest } } : {}),
    ...(found.density ? { density: { ...project.density, ...found.density } } : {}),
    /* Сезон и готовый цвет листвы — свой цвет деревьев: разнобой уступает им (иначе вид не виден). */
    ...(found.variety || found.season || found.trees?.tint ? { variety: { ...project.variety, ...(found.variety || { enabled: false }) } } : {}),
  });
}

/** Готовый вид, с которым работа совпадает в его части, или `null`. */
export function matchingVegetationPreset(input) {
  const project = normalizeVegetationProject(input);
  const signature = (value) => JSON.parse(vegetationProjectSignature(value));
  const current = signature(project);
  for (const item of VEGETATION_PRESETS) {
    const applied = signature(applyVegetationPreset(project, item.id));
    const same = (part) => JSON.stringify(applied[part]) === JSON.stringify(current[part]);
    if ((item.trees ? same("trees") : true) && (item.sandy ? same("sandy") : true) && JSON.stringify(applied) === JSON.stringify(current)) return item.id;
  }
  return null;
}
