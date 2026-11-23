/*
 * Какие фонари правит редактор.
 *
 * В GTA V 4833 модели со встроенным светом (1,7 ГБ, 80 790 ламп — пересчитано
 * по архивам Legacy). Перекрасить их все — значит переписать полтора
 * гигабайта игры ради одного цвета. Поэтому редактор правит то, что человек
 * называет фонарями, — пропы уличного света. Их светильники живут в самих
 * моделях (`LightAttributes`), а стоят они по всей карте тысячами копий:
 * одна правленая модель перекрашивает каждый фонарь этого вида на острове.
 *
 * Три группы — три ответа на «что красим»:
 *
 *  • улицы — столбы вдоль дорог и тротуаров (`prop_streetlight_*`) и старые
 *    фонари под старину (`prop_oldlight_*`): 28 моделей, 8,8 МБ вместе
 *    с соседями по архиву;
 *  • у зданий — светильники на стенах, над дверями и под навесами
 *    (`prop_wall_light_*`): тот самый свет «под зданиями»;
 *  • прожекторы — мачты промзон, стройплощадок и складов
 *    (`prop_ind_light_*`, `prop_worklight_*`, строительная лампа).
 *
 * Мигалки и подсветка вывесок сюда не входят намеренно: их свет — сигнал, и
 * лиловый светофор был бы поломкой, а не стилем.
 *
 * Светофоры на перекрёстках входят своей лампой улицы (05.10.2026, владелец:
 * «на перекрёстках фонари не меняются вообще»). Мачта светофора
 * `prop_traffic_01a/01b/01d/02a/02b` несёт обычный уличный фонарь — запись
 * LightAttributes (натрий 255,100,10, радиус 20, показатель 64; у 02a/02b —
 * ртутная лампа). Сами сигналы у GTA — светящаяся геометрия без записей
 * света: правка ламп их не касается, красный остаётся красным. Огни вдали
 * этих ламп игра не помечает уличными — их узнаёт подпись
 * (`CROSSING_LOD_SIGNATURES`).
 *
 * Группа — правило имени (им же пакет слоя проверяет, что везёт), а список
 * моделей ниже — то, что лежит в `v_traffic_lights.rpf` Legacy (пересчитано
 * по архиву: у каждой есть хотя бы одна лампа). Модели, которой у игрока нет,
 * установщик просто не находит и идёт дальше.
 */

export const LAMP_GROUPS = Object.freeze([
  group("street", "Улицы", "Фонари вдоль дорог, тротуаров, парков и на перекрёстках", [
    /^prop_streetlight_[a-z0-9_]+$/,
    /^prop_oldlight_01[a-c]$/,
    /^prop_traffic_0(?:1[abd]|2[ab])$/,
  ]),
  group("wall", "У зданий", "Светильники на стенах, над дверями и под навесами", [
    /^prop_wall_light_[a-z0-9_]+$/,
    /^prop_walllight_ld_01$/,
  ]),
  group("flood", "Прожекторы", "Мачты промзон, стройки и склады", [
    /^prop_ind_light_[a-z0-9]+$/,
    /^prop_construcionlamp_01$/,
    /^prop_dt1_13_(?:groundlight|walllightsource)$/,
  ]),
]);

function group(id, label, description, patterns) {
  return Object.freeze({ id, label, description, patterns: Object.freeze(patterns) });
}

export const LAMP_GROUP_IDS = Object.freeze(LAMP_GROUPS.map((item) => item.id));

/*
 * Где лежат модели. Архивы названы путями внутри игры: установщик читает их
 * из самой установки, а не из копии в поставке — текстур и моделей Rockstar
 * у Astral нет.
 *
 * `ytyp` — файл описаний пропов того же архива: в него редактор дописывает
 * частицы у ламп (бабочек, мотыльков, листья). Прожекторы из стройки лежат в
 * своём архиве с другим файлом описаний — частиц у них нет, и это честно:
 * бабочки у строительной лампы никто не заказывал.
 */
export const LAMP_ARCHIVE = Object.freeze({
  archive: "x64h.rpf",
  folder: "levels/gta5/props/roadside/v_traffic_lights.rpf",
  ytyp: "v_traffic_lights.ytyp",
});

const models = (extension, names) => names.map((name) => `${name}.${extension}`);

/* Модели фонарей Legacy с лампами внутри, по файлам архива. */
export const LAMP_MODEL_FILES = Object.freeze([
  ...models("yft", [
    "prop_streetlight_01", "prop_streetlight_01b", "prop_streetlight_02",
    "prop_streetlight_03", "prop_streetlight_03b", "prop_streetlight_03c",
    "prop_streetlight_03d", "prop_streetlight_03e", "prop_streetlight_04",
    "prop_streetlight_05", "prop_streetlight_05_b", "prop_streetlight_06",
    "prop_streetlight_07a", "prop_streetlight_07b", "prop_streetlight_08",
    "prop_streetlight_09", "prop_streetlight_10", "prop_streetlight_11a",
    "prop_streetlight_11b", "prop_streetlight_11c", "prop_streetlight_12a",
    "prop_streetlight_12b", "prop_streetlight_14a", "prop_streetlight_15a",
    "prop_streetlight_16a", "prop_oldlight_01a", "prop_oldlight_01b",
    "prop_oldlight_01c",
    /* Мачты светофоров перекрёстков: одна лампа улицы у 01a/01b/01d, лампа
       и свечение плафона у 02a/02b. */
    "prop_traffic_01a", "prop_traffic_01b", "prop_traffic_01d",
    "prop_traffic_02a", "prop_traffic_02b",
    "prop_wall_light_01a", "prop_wall_light_02a", "prop_wall_light_03a",
    "prop_wall_light_03b", "prop_wall_light_04a", "prop_wall_light_05a",
    "prop_wall_light_05c", "prop_wall_light_06a", "prop_wall_light_07a",
    "prop_wall_light_09a", "prop_wall_light_09b", "prop_wall_light_09c",
    "prop_wall_light_09d", "prop_wall_light_12a", "prop_wall_light_13_snw",
    "prop_wall_light_13a", "prop_wall_light_14a", "prop_wall_light_14b",
    "prop_wall_light_15a", "prop_wall_light_16a", "prop_wall_light_16b",
    "prop_wall_light_16c", "prop_wall_light_16d", "prop_wall_light_16e",
    "prop_wall_light_17a", "prop_wall_light_19a", "prop_wall_light_20a",
    "prop_walllight_ld_01",
    "prop_ind_light_02a", "prop_ind_light_02b", "prop_ind_light_02c",
    "prop_ind_light_03a", "prop_ind_light_03b", "prop_ind_light_03c",
    "prop_ind_light_04", "prop_ind_light_05",
  ]),
  ...models("ydr", [
    "prop_wall_light_08a", "prop_wall_light_10a", "prop_wall_light_10b",
    "prop_wall_light_10c", "prop_wall_light_11", "prop_wall_light_12",
    "prop_wall_light_17b", "prop_wall_light_18a",
    "prop_ind_light_01a", "prop_ind_light_01b", "prop_ind_light_01c",
    "prop_construcionlamp_01", "prop_dt1_13_groundlight",
    "prop_dt1_13_walllightsource",
  ]),
]);

/** Группа модели по её имени (без расширения) или `null`. */
export function lampGroupOf(modelName) {
  const name = String(modelName || "")
    .toLowerCase()
    .replace(/\.(?:yft|ydr|ydd)$/, "");
  for (const item of LAMP_GROUPS)
    if (item.patterns.some((pattern) => pattern.test(name))) return item.id;
  return null;
}

/*
 * Огни вдали ламп на мачтах светофоров. У огня вдали бит «уличный фонарь»
 * игра ставит только пропам `prop_streetlight_*` (13 675 огней штата — все
 * у них), а лампы светофоров оставляет без бита: правило «только улицы»
 * их пропускало, и издалека перекрёсток светил штатным натрием. Узнаются
 * они подписью лампы — радиус 20 и показатель 64: из 1 586 огней вдали с
 * этой подписью 1 523 стоят у мачт светофоров (сверено по картам игры
 * 05.10.2026), остальные — такие же уличные лампы.
 */
export const CROSSING_LOD_SIGNATURES = Object.freeze([Object.freeze({ falloff: 20, exponent: 64 })]);

/** Модели каких расширений несут свет: фрагменты и простые модели. */
export const LAMP_MODEL_EXTENSIONS = Object.freeze([".yft", ".ydr"]);
