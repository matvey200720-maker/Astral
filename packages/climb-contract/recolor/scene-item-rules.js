/*
 * Что за вещь по внутреннему имени её модели — таблицы Маппинга, Мегамолла и Ашана / Икеи (ТЗ владельца 26.10.2026, п. A и D).
 *
 * Опись вещей сцены (`scripts/lib/scene-objects.mjs`) знает только имена моделей игры. Правило таблицы называет вещь для человека
 * (категория и имя панели «Предметы»), а ещё род и оболочку — по ним выпечка размечает выделение (`scripts/lib/scene-selection.mjs`):
 *
 *   [выражение, категория, шаблон имени, число, { kind, structure }]
 *
 *   шаблон имени — русская фраза (ключ словаря), `{0}` — число из имени модели (`число(совпадение)`), нет числа — шаблон без вставки;
 *   kind        — род для «Выбрать все такие» (`selection/vocab.js`: flag, rail, light, seat… или свой: building, trailer, ladder);
 *   structure   — оболочка: её не режут на вещи, а делят на классы «группа материала × лист» (стены, крыша, земля одним щелчком).
 *
 * Первое подошедшее правило решает всё. Чистый модуль без DOM и three: его читают выпечка, окно и тесты.
 */

/** Число из имени без нулей спереди: `014` → `14`. */
export const plainNumber = (text) => String(Number(text));

/** Правило модели: `{ category, title, number, kind, structure }` или `null`, если таблица её не знает. */
export function itemRuleOf(rules, modelName) {
  const name = String(modelName || "").toLowerCase();
  for (const [pattern, category, title, number, options] of rules) {
    const match = pattern.exec(name);
    if (match) return { category, title, number: number ? number(match) : "", kind: options?.kind || "", structure: Boolean(options?.structure) };
  }
  return null;
}

/** Все русские фразы таблицы: словарь и его тест берут их отсюда (шаблоны — как есть, с `{0}`). */
export const itemRuleTexts = (rules) => [...new Set(rules.map((rule) => rule[2]))];

/* ---------------------------------------------------------------- Маппинг */

export const MAPPING_ITEM_CATEGORIES = Object.freeze([
  Object.freeze({ id: "buildings", label: "Здания" }),
  Object.freeze({ id: "trailers", label: "Прицепы" }),
  Object.freeze({ id: "fields", label: "Поля" }),
  Object.freeze({ id: "junk", label: "Хлам вокруг" }),
  Object.freeze({ id: "other", label: "Прочее" }),
]);

/*
 * Имена игры говорят прямо (`jhouse` — дом, `jbarns` — сараи, `trailr` — прицеп); чего не знаем наверняка, зовём общо («Строение
 * базы»): внутреннее имя всё равно в подсказке плитки. Здание здесь — одна вещь (в стенах штатной сцены нет имён листов, класс
 * «стены × лист» из них не собрать), поэтому оболочки у маппинга нет.
 */
export const MAPPING_ITEM_RULES = Object.freeze([
  [/^cs6_06_jhouse$/, "buildings", "Дом фермы", null, { kind: "building" }],
  [/^cs6_06_jbarns$/, "buildings", "Сараи фермы", null, { kind: "building" }],
  [/^cs6_06_jstorage$/, "buildings", "Склад фермы", null, { kind: "building" }],
  [/^cs4_02_hanger$/, "buildings", "Ангар у самолёта", null, { kind: "building" }],
  [/^ch3_01_ch_coop$/, "buildings", "Строение базы", null, { kind: "building" }],
  [/^bl_sc1_06_carpark$/, "buildings", "Парковка сервера 5RP", null, { kind: "building" }],
  [/^sc1_06_carpark$/, "buildings", "Штатная парковка", null, { kind: "building" }],
  [/^cs6_06_jcrop(\d*)$/, "fields", "Поле фермы {0}", (match) => match[1], { kind: "field" }],
  [/^ch3_01_(?:tmp_)?trail(?:r_?|er_?)?0*(\d+)_strs$/, "trailers", "Прицеп {0}, доп. часть", (match) => plainNumber(match[1]), { kind: "trailer" }],
  [/^ch3_01_(?:tmp_)?trail(?:r_?|er_?)?0*(\d+)_strs[a-z]+$/, "trailers", "Прицеп {0}, вторая доп. часть", (match) => plainNumber(match[1]), { kind: "trailer" }],
  [/^ch3_01_(?:tmp_)?trail(?:r_?|er_?)?0*(\d+)$/, "trailers", "Прицеп {0}", (match) => plainNumber(match[1]), { kind: "trailer" }],
  [/^ch3_01_trlr_bits0*(\d+)$/, "trailers", "Мелочь у прицепа {0}", (match) => plainNumber(match[1]), { kind: "trailer" }],
  [/^prop_rub_couch01$/, "junk", "Диван", null, { kind: "seat" }],
  [/^prop_rub_buswreck_01$/, "junk", "Разбитый автобус", null, { kind: "wreck" }],
  [/^prop_storagetank_07a$/, "junk", "Бак для хранения", null, { kind: "tank" }],
]);

/* ----------------------------------------------------------- Здания (мегамолл, Ашан / Икея) */

export const BUILDING_ITEM_CATEGORIES = Object.freeze([
  Object.freeze({ id: "building", label: "Здание" }),
  Object.freeze({ id: "ground", label: "Земля и парковка" }),
  Object.freeze({ id: "stairs", label: "Лестницы и перила" }),
  Object.freeze({ id: "fence", label: "Забор и столбики" }),
  Object.freeze({ id: "roof", label: "Крыша" }),
  Object.freeze({ id: "yard", label: "Контейнеры и ящики" }),
  Object.freeze({ id: "lights", label: "Светильники" }),
  Object.freeze({ id: "flags", label: "Флаги" }),
  Object.freeze({ id: "other", label: "Прочее" }),
]);

/*
 * `mall` — торговый центр, `ladder` — лестница, `fncsec` — секция забора, `roofvent` — вентиляция на крыше. Разные модели одного
 * вида различаются числом («вид 1»), чтобы плитки в списке не назывались одинаково. Оболочка (`structure`) — сама постройка и
 * земля: у них стены, крыша, отделка и вывески (группы `walls`, `roof`, `trim`, `ground`, `sign:*`).
 */
export const BUILDING_ITEM_RULES = Object.freeze([
  [/^sc1_22_mall_04bb$/, "building", "Здание торгового центра", null, { kind: "building", structure: true }],
  [/^sc1_22_mall_dec$/, "building", "Здание: наклейки", null, { kind: "building", structure: true }],
  [/^sc1_22_mall_can$/, "building", "Навес", null, { kind: "canopy" }],
  [/^sc1_22_mall_can0*(\d+)$/, "building", "Навес {0}", (match) => String(Number(match[1]) + 1), { kind: "canopy" }],
  [/^sc1_22_park_sld_01$/, "ground", "Парковка", null, { kind: "ground", structure: true }],
  [/^sc1_22_ground([ab])$/, "ground", "Земля, участок {0}", (match) => match[1].toUpperCase(), { kind: "ground", structure: true }],
  [/^sc1_22_ground([ab])_dcl$/, "ground", "Земля, участок {0}: наклейки", (match) => match[1].toUpperCase(), { kind: "ground", structure: true }],
  [/^sc1_22_ladder_0*(\d+)$/, "stairs", "Лестница {0}", (match) => plainNumber(match[1]), { kind: "ladder" }],
  [/^sc1_22_mall_railings_0*(\d+)$/, "stairs", "Перила {0}", (match) => plainNumber(match[1]), { kind: "rail" }],
  [/^prop_fncsec_01b$/, "fence", "Секция забора", null, { kind: "fence" }],
  [/^prop_bollard_02a$/, "fence", "Столбик", null, { kind: "bollard" }],
  [/^prop_roofvent_10b$/, "roof", "Вентиляция на крыше, вид {0}", () => "1", { kind: "vent" }],
  [/^prop_roofvent_16a$/, "roof", "Вентиляция на крыше, вид {0}", () => "2", { kind: "vent" }],
  [/^prop_roofvent_15a$/, "roof", "Вентиляция на крыше, вид {0}", () => "3", { kind: "vent" }],
  [/^cs4_02_roofdetails$/, "roof", "Детали крыши", null, { kind: "building", structure: true }],
  [/^prop_dumpster_02b$/, "yard", "Мусорный бак", null, { kind: "dumpster" }],
  [/^prop_skip_02a$/, "yard", "Мусорный контейнер, вид {0}", () => "1", { kind: "dumpster" }],
  [/^prop_skip_03$/, "yard", "Мусорный контейнер, вид {0}", () => "2", { kind: "dumpster" }],
  [/^prop_skip_04$/, "yard", "Мусорный контейнер, вид {0}", () => "3", { kind: "dumpster" }],
  [/^prop_skip_06a$/, "yard", "Мусорный контейнер, вид {0}", () => "4", { kind: "dumpster" }],
  [/^prop_cratepile_02a$/, "yard", "Стопка ящиков, вид {0}", () => "1", { kind: "crates" }],
  [/^prop_cratepile_05a$/, "yard", "Стопка ящиков, вид {0}", () => "2", { kind: "crates" }],
  [/^prop_rub_trolley01a$/, "yard", "Тележка", null, { kind: "trolley" }],
  [/^prop_bin_02a$/, "yard", "Урна", null, { kind: "bin" }],
  [/^prop_wall_light_02a$/, "lights", "Настенный светильник, вид {0}", () => "1", { kind: "light" }],
  [/^prop_wall_light_03a$/, "lights", "Настенный светильник, вид {0}", () => "2", { kind: "light" }],
  [/^cs4_02_youtool_flag0*(\d+)_s$/, "flags", "Флаг {0}", (match) => plainNumber(match[1]), { kind: "flag" }],
  [/^cs4_02_nmall00$/, "building", "Здание, основа", null, { kind: "building", structure: true }],
  [/^cs4_02_nmall00_int$/, "building", "Здание, внутри", null, { kind: "building", structure: true }],
  [/^cs4_02_nmall00_dtl$/, "building", "Здание, детали", null, { kind: "building", structure: true }],
  [/^cs4_02_nmall00_dec$/, "building", "Здание, наклейки", null, { kind: "building", structure: true }],
  [/^cs4_02_nmall0*(\d+)(?:_g)?$/, "building", "Здание, часть {0}", (match) => plainNumber(match[1]), { kind: "building", structure: true }],
  [/^cs4_02_glue_ytool$/, "building", "Стык частей здания", null, { kind: "building", structure: true }],
]);

/* ----------------------------------------------------------- Завод */

export const FACTORY_ITEM_CATEGORIES = Object.freeze([
  Object.freeze({ id: "buildings", label: "Корпуса и земля" }),
  Object.freeze({ id: "containers", label: "Контейнеры" }),
  Object.freeze({ id: "fences", label: "Заборы и блоки" }),
  Object.freeze({ id: "vehicles", label: "Техника" }),
  Object.freeze({ id: "junk", label: "Ящики и хлам" }),
]);

/*
 * Завод (`inventory/factory.js`, ТЗ 26.10.2026): корпуса и земля — оболочка (`structure`: красятся, не убираются, режутся на классы
 * «лист × группа»), всё остальное — вещи по одной: контейнеры, заборы, блоки, прицеп, погрузчик, ящики, хлам. Вид у контейнера и
 * забора — по порядку модели игры (01a, 01b, 03a…), чтобы плитки в списке не назывались одинаково.
 */
const CONTAINER_VIEWS = Object.freeze({ "01a": "1", "01b": "2", "03a": "3", "04a": "4", "05a": "5" });
export const FACTORY_ITEM_RULES = Object.freeze([
  [/^cs4_13_gnd_01$/, "buildings", "Земля двора", null, { kind: "ground", structure: true }],
  [/^cs4_13_build_0*(\d+)(?:_g)?$/, "buildings", "Корпус {0}", (match) => plainNumber(match[1]), { kind: "building", structure: true }],
  [/^prop_container_(\d+[a-z])$/, "containers", "Контейнер, вид {0}", (match) => CONTAINER_VIEWS[match[1]] || match[1], { kind: "container" }],
  [/^prop_fnccorgm_02([ab])$/, "fences", "Секция забора, вид {0}", (match) => (match[1] === "a" ? "1" : "2"), { kind: "fence" }],
  [/^prop_barier_conc_02a$/, "fences", "Бетонный блок", null, { kind: "barrier" }],
  [/^prop_flattrailer_01a$/, "vehicles", "Прицеп-платформа", null, { kind: "trailer" }],
  [/^prop_rub_frklft$/, "vehicles", "Погрузчик", null, { kind: "forklift" }],
  [/^prop_elecbox_13$/, "junk", "Электрощит", null, { kind: "box" }],
  [/^prop_rub_scrap_0*(\d+)$/, "junk", "Металлолом, вид {0}", (match) => String(Number(match[1]) - 3), { kind: "junk" }],
  [/^prop_box_wood04a$/, "junk", "Деревянный ящик", null, { kind: "crates" }],
  [/^prop_boxpile_02b$/, "junk", "Стопка ящиков", null, { kind: "crates" }],
]);
