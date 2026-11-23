/*
 * Авторские контейнеры — вторая опора разбора.
 *
 * Как человек находит моды в чужом `update.rpf`: открывает `x64/`, видит
 * папку с нестандартным именем — `hls`, `astral`, `paralox`, — заходит в неё
 * и находит там контейнеры, которые автор сам подключил через `content.xml`.
 * Внутри лежит всё: арена в `arena.rpf`, стволы в `artisred.rpf`, мини-карта
 * и прицел в `core.rpf`. Дальше искать ничего не надо.
 *
 * Эта опора не зависит от чистой базы. Разница с чистой игрой ломается, как
 * только редукс собран под другую сборку: тысячи «изменённых» файлов, из
 * которых авторских — десяток. А авторская папка остаётся авторской папкой
 * при любой сборке: её нет в чистой игре ни в одной версии.
 *
 * Контейнер опознаётся по тому, ЧТО в нём лежит, а не по имени: `core.rpf`
 * с `minimap.gfx`, `hud_reticle.gfx` и `core.ypt` — это мини-карта, прицел и
 * трассеры, три разных мода; `hls.rpf` с тридцатью пропсами — один маппинг,
 * который не надо разбивать на файлы.
 */

import { GRAPHICS_ENTRY } from "@modovik/mod-targets/sky-files";
import {
  FINDING_CATEGORIES,
  NEVER_PUBLISHABLE,
  exactRouteIndex,
} from "./rules.js";
import { getLegacyModTarget } from "@modovik/mod-targets";
import { workshopPlaceOf } from "./workshop-places.js";
import { ENOUGH, identifyPlace } from "./place-fingerprints.js";
import { stockVegetationKind } from "./vegetation-groups.js";

const normalize = (value) =>
  String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .toLowerCase();

/** Папки `x64/`, которые есть в чистой игре, — когда базы нет и спросить не у кого. */
const STANDARD_X64_FOLDERS = Object.freeze(
  new Set([
    "anim",
    "audio",
    "data",
    "levels",
    "models",
    "movies",
    "patch",
    "textures",
    "dlcpacks",
  ]),
);

/**
 * Маркеры арены: детали чаши Maze Bank Arena, которых нет нигде, кроме неё.
 * Список унаследован от прежнего разборщика редуксов и проверен на живых
 * аренах.
 */
const ARENA_MARKERS = Object.freeze([
  "sp1_10_brand_01_wip_dontdelq.ydr",
  "sp1_10_details5.ydr",
  "v_62_bannersx.ydr",
  "v_62_blinds.ydr",
  "sp1_10_ground_2.ydr",
]);
const ARENA_PREFIX = /^(sp1_10|v_62|xs_arena|xs_int_arena)/;
/* Дальние модели (LOD/SLOD) и метаданные интерьера квартала — по
   соглашению имён Rockstar. */
const LOD_NAME =
  /(_s?lod(_children)?\.(ydr|ydd|ytd)|^interior_s?lod\.ytd|_metadata_\d+\.ytyp)$/;

/** Броник — единственный компонент одежды, который кладут почти в каждый редукс. */
const ARMOR_MARKER = /^task_011_u\.ydd$/;

const WEAPON_FILE = /^w_[a-z]{2}_[a-z0-9_+]+\.(ydr|ytd|yft|ydd)$/;
const WEAPON_GROUP =
  /^(w_[a-z]{2}_[a-z0-9_+]+?)(_hi|\+hi|_mag\d|_sight|_supp|_clip\d)?\.(ydr|ytd|yft|ydd)$/;
const CLOTHING_FILE =
  /^(jbib|lowr|uppr|feet|berd|task|accs|hand|teef|decl|hair|head|p_head|p_eyes|p_ears|p_lwrist|p_rwrist)(_diff|_norm|_spec)?_\d{3}[a-z_]*\.(ydd|ytd)$/;
const CLOTHING_GROUP = /^((?:p_)?[a-z]+?)(?:_diff|_norm|_spec)?_(\d{3})/;
const PED_FOLDER = /(mp_[mf]_freemode_01)/;
const TIMECYCLE_FILE = /^(timecycle_mods_\d+|w_[a-z0-9_]+)\.xml$/;
const LARGE_MAP_TILE = /^minimap(_sea)?_\d+_\d+\.ytd$/;
/* Словари текстур мини-карты: `minimap.ytd` рядом с `minimap.gfx`. */
const MINIMAP_DICTIONARY = /^minimap[\w-]*\.ytd$/i;

const WORLD_EXTENSIONS = new Set([
  "ydr",
  "yft",
  "ydd",
  "ytd",
  "ymap",
  "ytyp",
  "ybn",
  "ymf",
  "ynv",
]);
/* `plantsmgr*` — менеджер травы игры (переключатель «без травы»), не
   деревья (17.10, 12 globl: его словари звались «Деревьями»). Новогодняя
   ёлка (`xs3_prop_int_xmas_tree_01`, CLOUD redux) — украшение, пропс DLC,
   а не растительность мира. `tree` — с начала слова: `prop_streetlight`
   (фонари) и `joshuatree_rock` (камни) — не деревья. */
const TREE_NAME =
  /((?<!(xmas|christmas)_)(?<![a-z])tree|_trees_|palm|olive|rio_del|boken|bush|shrub|plant(?!smgr))/;
/** Имя модели растения — для `vegetation-split.js`. */
export const VEGETATION_MODEL_NAME = TREE_NAME;
/* Растение — по имени или по описи растительности игры: пустые сорняки
   TIFFANY (`prop_weeddead_nxg01.ydr`, 568 байт) именем на растение не
   похожи (17.10). */
const isPlant = (name) =>
  TREE_NAME.test(name) || Boolean(stockVegetationKind(name));
/* Карта травы квартала: экземпляры травинок (`GrassInstanceList`). */
const GRASS_MAP = /_grass_\d+\.ymap$/;
/*
 * Земля мира — словари текстур участков карты. Участки игры названы кодом
 * района и номером: `cs4_02.ytd` (пустыня у Сэнди-Шорс), `ch2_lod.ytd`,
 * `po1_05.ytd`. «Зелёный Сенди» переписывает именно их — песок на траву,
 * — и не трогает ни одной модели. Деревья — другой мод: модели
 * `prop_tree_*`, кусты, кактусы. Смешать их в одну карточку значит не дать
 * человеку поставить зелёную землю и чужие деревья вместе.
 */
const AREA_DICTIONARY =
  /^(?:ap|ba|bh|cb|ce|ch|cj|cs|des|dt|el|hei|hw|id|ka|kt|lr|ma|ng|po|sc|sm|sp|ss|vb)\d{1,2}_[a-z0-9_]*\.ytd$/;
const GROUND_NAME = /(terrain|ground|grnd|_dirt|grass|sand|desert)/;
/* Пустая модель дерева — это не рисунок, а удаление: мод убирает деревья. */
const EMPTY_MODEL_BYTES = 4096;
/* Дороги — текстуры асфальта и разметки: общие словари (`globalroads`,
   `roadmarkings`) и дорожные словари участков (`cs4_rd_…`). Это свой мод
   каталога рядом с землёй и деревьями, а не «оптимизация объектов». */
const ROAD_NAME =
  /(globalroads|roadmarkings|im_road|asphalt|pavement|kerb|curb|(^|_)rd(_|\d|\.)|road)/;
const CLIMB_NAME = /(zalaz|zalas|climb|parkour|lazy|lazi|laz_|_laz|залаз)/;
const INTERIOR_NAME = /(interior|_int_|^int_|v_int|mlo|shop_int)/;

/**
 * Куда файл с таким именем ставит каталог.
 *
 * `minimap.gfx` лежит в игре ровно в одном месте, и это место — проверенный
 * маршрут установки. Контейнер автора его только перекрывает. Поэтому файл
 * из авторского контейнера уезжает в пакет не по своему пути, а по маршруту
 * каталога: устанавливать надо туда, где его прочитает игра без `content.xml`
 * автора.
 */
function routeByBaseName() {
  const byName = new Map();
  for (const [entry, allClaims] of exactRouteIndex()) {
    /* graphics.ytd в авторском контейнере — по-прежнему переключатель «без частиц»: небо это или оптимизация, решают соседние файлы
       разницы со штатным (`classify.js`, `graphicsIsSky`), а у контейнера соседей по изменённости нет. */
    const claims = entry === GRAPHICS_ENTRY ? allClaims.filter((item) => item.id !== "timecycle") : allClaims;
    const name = entry.split("/").pop();
    const list = byName.get(name) || [];
    list.push({
      entry,
      ids: [...new Set(claims.map((item) => item.id))],
      action: claims[0]?.action || "replace",
      option: claims[0]?.option || null,
    });
    byName.set(name, list);
  }
  return byName;
}

const uniqueRoute = (routes, name, preferred) => {
  const list = routes.get(name);
  if (!list?.length) return null;
  const chosen = preferred
    ? list.find((item) => preferred.test(item.entry)) || list[0]
    : list[0];
  return chosen;
};

/**
 * Что это за файл внутри авторского контейнера.
 *
 * Возвращает `{ category, group, delivery, installEntry, evidence }` или
 * `null` для файла, который сам по себе ничего не значит и решается по
 * контейнеру целиком (пропс, карта, коллизия).
 */
function classifyFile(name, fullPath, routes) {
  const base = name.toLowerCase();
  if (base === "minimap.gfx")
    return {
      category: "minimap",
      delivery: "route",
      installEntry: uniqueRoute(routes, base)?.entry || null,
      installAction: uniqueRoute(routes, base)?.action || "replace",
      evidence: "minimap.gfx в авторском контейнере",
    };
  if (base === "hud_reticle.gfx")
    return {
      category: "reticle",
      delivery: "route",
      installEntry: uniqueRoute(routes, base)?.entry || null,
      installAction: uniqueRoute(routes, base)?.action || "replace",
      evidence: "hud_reticle.gfx в авторском контейнере",
    };
  if (base === "hud.gfx" || LARGE_MAP_TILE.test(base))
    return {
      category: "large-map",
      delivery: "route",
      installEntry: uniqueRoute(routes, base)?.entry || null,
      installAction: uniqueRoute(routes, base)?.action || "replace",
      evidence: "плитки и hud.gfx большой карты",
    };
  if (base === "core.ypt")
    return {
      category: "tracers",
      delivery: "tracer-draft",
      installEntry: uniqueRoute(routes, base, /\/ptfx\.rpf\//)?.entry || null,
      evidence: "core.ypt — ядро эффектов с трассерами",
    };
  /* Остальные словари частиц автора (17.10): у kray v2 redux в `core.rpf`
     их 355 — пустые (выключенные эффекты) и свои словари стволов. Без
     правила они уходили в «не опознано» и пропадали из описи; в семействе
     эффектов они идут в сводку (`effects-summary.js`). */
  if (base.endsWith(".ypt"))
    return {
      category: "particle-effects",
      delivery: "tracer-draft",
      installEntry: null,
      evidence: "словари частиц автора",
    };
  /* Переключатель оптимизации игры в авторском контейнере (17.10, 12 globl:
     `plantsmgr.ydd` — без травы, `graphics`/`fxdecal`/`frontend.ytd` — без
     частиц): у файла единственный точный маршрут — оптимизация. */
  const toggle = uniqueRoute(routes, base);
  if (toggle?.ids.length === 1 && toggle.ids[0] === "optimization")
    return {
      category: "optimization",
      group: toggle.option,
      delivery: "route",
      installEntry: toggle.entry,
      installAction: toggle.action,
      evidence: `${base} — переключатель оптимизации игры`,
    };
  /* Словари травы игры (`plantsmgr*.ytd`, 12 globl obsolut 17.10) — к
     переключателю «без травы», вместе с `plantsmgr.ydd`. */
  if (/^plantsmgr\d*\.ytd$/.test(base))
    return {
      category: "optimization",
      group: "no-grass",
      delivery: "route",
      installEntry: null,
      evidence: `${base} — словарь травы игры`,
    };
  /* Словари текстур эффектов игры: частицы погоды и кровь на персонажах
     (17.10) — в сводку эффектов. */
  if (/^(fxweather|peddamagedecals)\.ytd$/.test(base))
    return {
      category: "particle-effects",
      delivery: "tracer-draft",
      installEntry: null,
      evidence: `${base} — словарь текстур эффектов игры`,
    };
  if (base === "bloodfx.dat")
    return {
      category: "blood-effects",
      delivery: "route",
      installEntry: uniqueRoute(routes, base)?.entry || null,
      installAction: "replace",
      evidence: "bloodfx.dat — таблица эффектов попадания",
    };
  if (TIMECYCLE_FILE.test(base) && /timecycle/.test(fullPath))
    return {
      category: "timecycle",
      delivery: "route",
      installEntry: `common/data/timecycle/${base}`,
      installAction: "replace",
      evidence: "файлы таймцикла",
    };
  if (WEAPON_FILE.test(base)) {
    const match = base.match(WEAPON_GROUP);
    return {
      category: "weapon-model",
      group: match ? match[1] : "weapon",
      delivery: "weapon-dlc",
      installEntry: null,
      evidence: "модель оружия в авторском контейнере",
    };
  }
  if (CLOTHING_FILE.test(base)) {
    const match = base.match(CLOTHING_GROUP);
    const ped = fullPath.match(PED_FOLDER)?.[1] || null;
    return {
      category: "clothing",
      group: match ? `${match[1]}-${match[2]}` : "clothing",
      delivery: "clothing-dlc",
      installEntry: null,
      ped,
      armor: ARMOR_MARKER.test(base),
      evidence: ARMOR_MARKER.test(base)
        ? "бронежилет task_011 — самая частая замена одежды"
        : "компонент одежды свободного персонажа",
    };
  }
  return null;
}

/*
 * Штатные мелкие объекты в контейнере арены (Хелпер 19, 27.10.2026, TIFFANY REDUX V2): автор кладёт в один контейнер (`oversize.rpf`)
 * и свою арену (`sp1_10_*`, `v_62_*`), и облегчённые штатные объекты — урны, автоматы с водой, жвачку, билеты, сорняки
 * (`prop_bin_*`, `prop_vend_soda_*`, `prop_weeds_*`) и таблицы размещения процедурных объектов (`procobj.ytyp`, `v_rubbish.ytyp`,
 * `v_bush.ytyp`). В «Арену» ехали 319 файлов, 130 из них — подмена урн и автоматов по всему городу: арена не один в один, а чужие
 * объекты меняют мир. Модели арен мастерской (отпечатки `place-fingerprints-data.js`) `prop_*` не содержат ни у GTA 5 RP, ни у
 * Majestic. Объекты отделяются в оптимизацию объектов, если их набралось не меньше трёх (одна-две — случайные).
 */
const STOCK_OBJECT_STEM = /^(prop_|p_[a-z0-9]|proc_|procobj$|v_rubbish$|v_bush$|v_proc\d*$)/;
const ENOUGH_STOCK_OBJECTS = 3;
/* Магазинные интерьеры игры в том же контейнере (TIFFANY: `v_7_*` оружейный, `v_10_*` винный, `v_38_*` парикмахерская, `v_66_*` 24/7, `v_68_*`
   заправка, `v_ret_*` витрины, таблицы `v_int_N.ytyp`): зал арены — `v_62_*`/`v_int_62`, остальные `v_<номер>_` — чужие интерьеры.
   Решение владельца 26.10: интерьеры (Ammu-Nation, заправки…) — на хранение с привязкой к редуксу, не в арену и не в каталог. */
const SHOP_INTERIOR_STEM = /^(v_(?!62_)\d+_|v_ret_|v_int_(?!62$)\d+$)/;
const objectStem = (name) =>
  String(name || "")
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/\+.*$/, "")
    .replace(/^(hi|lo|ma)@/, "");

/**
 * Контейнер арены → `{ arena, objects, interiors }`: штатные мелкие объекты — отдельно (в «оптимизацию объектов»), магазинные интерьеры —
 * отдельно (на хранение). Меньше трёх файлов вида — случайные, остаются в арене.
 */
export function splitStockObjectsOutOfArena(entries = []) {
  const nameOf = (entry) => objectStem(entry.inner || entry.path);
  let objects = entries.filter((entry) => STOCK_OBJECT_STEM.test(nameOf(entry)));
  let interiors = entries.filter((entry) => SHOP_INTERIOR_STEM.test(nameOf(entry)));
  if (objects.length < ENOUGH_STOCK_OBJECTS) objects = [];
  if (interiors.length < ENOUGH_STOCK_OBJECTS) interiors = [];
  const taken = new Set([...objects, ...interiors]);
  return { arena: taken.size ? entries.filter((entry) => !taken.has(entry)) : entries, objects, interiors };
}

/**
 * Категория контейнера по его содержимому целиком.
 *
 * Сюда попадают файлы, которые по одному ничего не значат: пропсы, карты,
 * коллизии. Что это — арена, залазы, интерьер или маппинг — решают маркеры,
 * имя контейнера и состав.
 */
function classifyWorld(
  container,
  names,
  vanillaNames = new Set(),
  entries = [],
) {
  const lowerNames = names.map((name) => name.toLowerCase());
  /* Место мастерской по его собственным файлам (16.10): ангар, зоны,
     расписание, залазы, арена своего сервера. Раньше такие контейнеры
     kray v2 redux уходили в «маппинг» и «оптимизацию объектов». */
  const place = workshopPlaceOf(lowerNames);
  if (place)
    return {
      category: place.place,
      evidence: place.evidence,
      hint: null,
      ...(place.server ? { server: place.server } : {}),
      ...(place.place === "arenas" && place.server
        ? { arena: { server: place.server } }
        : {}),
      ...(place.kinds ? { zones: place.kinds } : {}),
    };
  /* Карта травы квартала арены (`sp1_10_grass_0.ymap`) — штатная карта
     травы, а не чаша: одна такая в контейнере «убрать траву» записывала все
     394 карты травы COMPETITIVE V2 REDUX в «Арену» (11.10). */
  /* Арена — по её моделям или по доле (13.10): «Дороги EUROPE 2.0»
     перекрашивает всю карту, и один словарь земли квартала арены
     (`sp1_10_ground_1+hidr.ytd`) среди 969 файлов делал весь мод «Ареной».
     Словари покрытия квартала (земля, дороги) — не чаша; контейнер, где
     квартал арены — половина и больше, — арена и так. */
  const arenaNames = lowerNames.filter(
    (name) =>
      !GRASS_MAP.test(name) &&
      (ARENA_MARKERS.includes(name) || ARENA_PREFIX.test(name)),
  );
  const surfaceDictionary = (name) =>
    name.endsWith(".ytd") &&
    (AREA_DICTIONARY.test(name) ||
      GROUND_NAME.test(name) ||
      ROAD_NAME.test(name));
  /* Только дальние модели квартала арены (17.10, TIFFANY «Основной»:
     `sp1_10_fake_interior_lod/slod`, `interior_lod.ytd`,
     `sanpedro_metadata_003.ytyp`) — не чаша: без самой арены частью не
     бывают, — строка описи. */
  if (
    arenaNames.length &&
    lowerNames.every((name) => LOD_NAME.test(name) || name === "_manifest.ymf")
  )
    return {
      category: "world-lod",
      evidence: "только дальние модели (LOD) квартала арены",
      hint: null,
    };
  /* Арена без доказанного сервера (план Б, 24.10): общий квартал `sp1_10` годится обоим серверам, а свои модели автора
     (`xs_arena_*`, свой зал) — новая арена. Ни «GTA 5 RP», ни «Majestic» им не ставится: решают отпечатки, не имя. */
  const unnamed = identifyPlace("arena", { names: lowerNames });
  /* Один-два файла арены среди сотен чужих — не арена (план Б, по данным 24.10: пакет «mclovin redux vzp» — 2125 текстур
     людей, острова и города, среди них `v_62_v_stadium_txd` и 13 пропсов Arena War, — публиковался как «арены»). */
  const arenaShare = lowerNames.length ? arenaNames.length / lowerNames.length : 0;
  const bigAndSparse = lowerNames.length > ENOUGH.arena.small && arenaShare < ENOUGH.arena.share;
  if (
    (arenaNames.some((name) => !surfaceDictionary(name)) && !bigAndSparse) ||
    (arenaNames.length && arenaNames.length >= lowerNames.length / 2) ||
    unnamed.status === "new"
  ) {
    const status = unnamed.status === "new" ? "new" : "unproven";
    return {
      category: "arenas",
      evidence: unnamed.evidence || "детали чаши арены (sp1_10, v_62)",
      hint: null,
      arena: { status, evidence: unnamed.evidence || "общий квартал арены: сервер не доказан файлами" },
    };
  }
  const label = container.path.toLowerCase();
  if (CLIMB_NAME.test(label))
    return {
      category: "climbs",
      evidence: "имя контейнера говорит о залазах",
      hint: null,
    };
  if (
    INTERIOR_NAME.test(label) ||
    lowerNames.filter((name) => /^(v_int|int_|v_ilev)/.test(name)).length >
      lowerNames.length / 2
  )
    return {
      category: "interiors",
      evidence: "архетипы помещений",
      hint: null,
    };
  const dictionaries = lowerNames.filter((name) => name.endsWith(".ytd"));
  const roadDictionaries = dictionaries.filter((name) => ROAD_NAME.test(name));
  if (
    roadDictionaries.length &&
    roadDictionaries.length >= dictionaries.length / 2 &&
    !lowerNames.some((name) => name.endsWith(".ymap"))
  )
    return {
      category: "mapping",
      evidence: `текстуры дорог: ${roadDictionaries.slice(0, 4).join(", ")}${roadDictionaries.length > 4 ? "…" : ""}`,
      hint: "дороги",
    };
  const models = lowerNames.filter((name) => /\.(ydr|yft|ydd)$/.test(name));
  const ground = dictionaries.filter(
    (name) => AREA_DICTIONARY.test(name) || GROUND_NAME.test(name),
  );
  if (
    ground.length &&
    ground.length >= dictionaries.length / 2 &&
    models.length <= ground.length / 2 &&
    !lowerNames.some((name) => name.endsWith(".ymap"))
  ) {
    const areas = [
      ...new Set(ground.map((name) => name.split("_")[0]).filter(Boolean)),
    ].slice(0, 6);
    return {
      category: "mapping",
      evidence: `текстуры земли участков карты (${areas.join(", ")}) — меняется поверхность: песок, трава, грунт`,
      hint: "земля",
    };
  }
  /* Покрытие целиком — дороги и земля участков вместе (13.10, «Дороги
     EUROPE 2.0»: 233 словаря дорог и 375 земли из 754 — ни те, ни другие по
     отдельности не половина). Вид — по заметной доле дорог. */
  const surface = dictionaries.filter(
    (name) =>
      ROAD_NAME.test(name) ||
      AREA_DICTIONARY.test(name) ||
      GROUND_NAME.test(name),
  );
  /* Без единого словаря земли или дороги покрытия нет: контейнер оружия
     или одежды (`weapons.rpf` ДЛС «Хэллоуин» в посте про макияж) давал
     «покрытие карты: 0 словарей дорог» и карточку «Дороги». */
  if (
    surface.length > 0 &&
    surface.length >= dictionaries.length / 2 &&
    models.length <= surface.length / 2 &&
    !lowerNames.some((name) => name.endsWith(".ymap"))
  ) {
    const roads = surface.filter((name) => ROAD_NAME.test(name)).length;
    return roads >= surface.length / 3
      ? {
          category: "mapping",
          evidence: `покрытие карты: ${roads} словарей дорог, ${surface.length - roads} — земли участков`,
          hint: "дороги",
        }
      : {
          category: "mapping",
          evidence: `покрытие карты: ${surface.length} словарей земли и дорог участков`,
          hint: "земля",
        };
  }
  /*
   * Трава — карты травы кварталов (`*_grass_N.ymap`): игра сажает по ним
   * травинки газонов и сорняки. Мод, который их приносит, — трава, а не
   * маппинг: обычно убирает её (карты без травинок, пустые модели кустов и
   * клевера), реже перекрашивает. Свой вид — рядом с деревьями и землёй.
   */
  const grassMaps = lowerNames.filter((name) => GRASS_MAP.test(name)).length;
  const maps = lowerNames.filter((name) => name.endsWith(".ymap")).length;
  if (grassMaps && grassMaps >= maps * 0.8) {
    const emptyPlants = entries.filter((entry) => {
      const name = String(entry.path).split("/").pop().toLowerCase();
      return (
        /\.(ydr|yft)$/.test(name) &&
        isPlant(name) &&
        Number(entry.size) > 0 &&
        Number(entry.size) < EMPTY_MODEL_BYTES
      );
    }).length;
    return {
      category: "mapping",
      evidence: `${grassMaps} карт травы кварталов${emptyPlants ? `, ${emptyPlants} пустых моделей растений` : ""}`,
      hint: "трава",
      /* Пустые модели кустов и клевера рядом с картами травы — мод её
         убирает, а не сажает свою. */
      ...(emptyPlants ? { removes: true } : {}),
    };
  }
  const trees = lowerNames.filter((name) => TREE_NAME.test(name)).length;
  /* Растения среди моделей (17.10, «зеленый сендик» CLOUD): деревья и
     кусты — 169 из 249 моделей, но рядом 427 словарей дальних планов
     участков, и по всем файлам (132 из 685) не набиралось трети — контейнер
     уходил в маппинг. */
  const plantModels = models.filter(isPlant).length;
  if (
    (trees && trees >= lowerNames.length / 3) ||
    (plantModels >= 5 && plantModels * 2 >= models.length)
  ) {
    const treeModels = entries.filter((entry) => {
      const name = String(entry.path).split("/").pop().toLowerCase();
      return /\.(ydr|yft)$/.test(name) && isPlant(name);
    });
    const empty = treeModels.filter(
      (entry) =>
        Number(entry.size) > 0 && Number(entry.size) < EMPTY_MODEL_BYTES,
    ).length;
    const removes = treeModels.length > 0 && empty >= treeModels.length * 0.8;
    return {
      category: "mapping",
      evidence: removes
        ? `мод убирает деревья: ${empty} моделей растительности заменены пустыми`
        : "деревья и растительность мира",
      hint: "деревья",
      ...(removes ? { removes: true } : {}),
    };
  }
  /* Маппинг приносит новое — карты размещения (`.ymap`), без которых игра
     не поставит в мир ни одного объекта; архетипы (`.ytyp`) и коллизии сами
     по себе ничего не размещают. Контейнер из одних
     моделей и текстур ничего не добавляет: он подменяет штатные объекты по
     имени — пустые полки магазинов, упрощённые урны. Это оптимизация, и
     подписывать её маппингом нельзя. Имена чистой игры, если известны,
     только подтверждают это. */
  const placesObjects = lowerNames.some((name) => /\.ymap$/.test(name));
  if (!placesObjects) {
    const vanilla = lowerNames.filter((name) => vanillaNames.has(name)).length;
    return {
      category: "object-optimization",
      evidence: vanilla
        ? `только модели и текстуры без карт размещения — подмена штатных объектов (${vanilla} из ${lowerNames.length} имён есть в чистой игре)`
        : "только модели и текстуры без карт размещения — подмена штатных объектов",
      hint: null,
    };
  }
  return {
    category: "mapping",
    evidence: "пропсы, карты и архетипы мира одним контейнером",
    hint: null,
  };
}

/** Категория без своего маршрута ставится маршрутом той же механики. */
const ROUTE_ALIAS = Object.freeze({
  "object-optimization": "mapping",
  /* Места мастерской из редукса (16.10) — контейнер мира, как маппинг. */
  hangar: "mapping",
  zones: "mapping",
  schedule: "mapping",
});
const VECTOR_MAP_CONTAINER = "x64/levels/gta5/minimap.rpf";
/* Плитка векторного радара; штатных 65. */
const RADAR_TILE = /^minimap_\d{1,2}_\d{1,2}\.ydd$/i;
const isRadarContainer = (entries = []) => {
  const tiles = entries.filter((entry) =>
    RADAR_TILE.test(
      String(entry.inner || entry.path)
        .split("/")
        .pop(),
    ),
  ).length;
  return tiles >= 10 && tiles >= entries.length * 0.9;
};

/** Маршрут категории с заменами `ROUTE_ALIAS` — как у находок контейнеров. */
export const placeTarget = (category) =>
  getLegacyModTarget(ROUTE_ALIAS[category] || category);

function containerLabel(path) {
  const name = path.split("/").pop() || path;
  return name.replace(/\.rpf$/i, "");
}

/**
 * Находит авторские контейнеры и папки.
 *
 * Контейнер авторский, если в чистой базе нет ни одной записи внутри него.
 * Берётся самый внешний: `x64/hls/arena.rpf/inner.rpf/…` — это одна арена,
 * а не две. Без базы (авторский пак, которого нет в игре) авторскими
 * считаются папки `x64/`, которых в чистой игре не бывает.
 *
 * `registered` — контейнер подключён автором через `content.xml`. Это не
 * условие, а улика: незарегистрированный контейнер игра не читает, и человеку
 * стоит это видеть.
 */
export function findAuthorContainers(candidate, baseline, { content } = {}) {
  const baseEntries = Array.isArray(baseline?.entries) ? baseline.entries : [];
  const basePaths = baseEntries.map((entry) => normalize(entry.path));
  const baseFolders = new Set();
  const baseContainers = new Set();
  for (const path of basePaths) {
    const parts = path.split("/");
    if (parts[0] === "x64" && parts.length > 2) baseFolders.add(parts[1]);
    let prefix = "";
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (part.endsWith(".rpf")) baseContainers.add(prefix);
    }
  }
  const hasBase = basePaths.length > 0;
  /* Штатные папки `x64/` известны и без базы: чистый пак патчдея не держит
     `models/`, но папка от этого авторской не становится. */
  const knownFolders = new Set([
    ...STANDARD_X64_FOLDERS,
    ...(hasBase ? baseFolders : []),
  ]);

  const registered = new Set(
    (Array.isArray(content?.customRpfs) ? content.customRpfs : [])
      .map((item) =>
        normalize(item)
          .replace(/^update:\//, "")
          .replace(/^update\.rpf\//, ""),
      )
      .filter((item) => item.endsWith(".rpf")),
  );

  const containers = new Map();
  const claim = (key, entry, kind) => {
    if (!containers.has(key))
      containers.set(key, {
        path: key,
        kind,
        registered: registered.has(key),
        astral: key.startsWith("x64/astral/"),
        entries: [],
        bytes: 0,
      });
    const item = containers.get(key);
    item.entries.push(entry);
    item.bytes += Number(entry.size) || 0;
  };

  for (const entry of candidate?.entries || []) {
    const path = normalize(entry?.path);
    if (!path) continue;
    const parts = path.split("/");
    /* Самый внешний контейнер, которого нет в базе. */
    let prefix = "";
    let outer = null;
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (part.endsWith(".rpf") && !baseContainers.has(prefix)) {
        outer = prefix;
        break;
      }
    }
    if (outer) {
      claim(
        outer,
        { ...entry, path: entry.path, inner: path.slice(outer.length + 1) },
        "rpf",
      );
      continue;
    }
    /* Россыпь файлов в авторской папке `x64/<имя>/` вне контейнера. */
    if (parts[0] === "x64" && parts.length > 2 && !knownFolders.has(parts[1])) {
      const folder = `x64/${parts[1]}`;
      if (!basePaths.some((base) => base.startsWith(`${folder}/`)))
        claim(
          folder,
          { ...entry, inner: path.slice(folder.length + 1) },
          "folder",
        );
    }
  }

  return [...containers.values()]
    .map((item) => {
      const parts = item.path.split("/");
      return {
        ...item,
        label: containerLabel(item.path),
        files: item.entries.length,
        /* Авторская папка над контейнером — то, как редукс называет себя.
           Штатная папка игры (`x64/levels/…`) именем автора не считается. */
        author:
          parts[0] === "x64" && parts.length > 2 && !knownFolders.has(parts[1])
            ? parts[1]
            : null,
      };
    })
    .sort((left, right) => right.bytes - left.bytes);
}

const VERDICT = (category, targetLookup) => {
  if (NEVER_PUBLISHABLE.has(category))
    return {
      publishable: "no",
      reason:
        category === "world-lod"
          ? "Только дальние модели (LOD) места, без самого места — частью не бывают."
          : category === "stock-copy"
            ? "Копии файлов игры — те же байты, что в игре: правки нет."
            : "Это след установки, а не мод.",
      target: null,
    };
  const target = targetLookup(category) || null;
  if (!target)
    return {
      publishable: "no",
      reason: "Для этой категории нет проверенного маршрута установки.",
      target: null,
    };
  const shaped = {
    id: target.id,
    label: target.label,
    strategy: target.strategy,
    readiness: target.readiness || "blocked",
  };
  if (target.readiness === "ready")
    return {
      publishable: "ready",
      reason: "Маршрут установки проверен — пакет можно собирать.",
      target: shaped,
    };
  if (target.readiness === "candidate")
    return {
      publishable: "review",
      reason:
        "Маршрут реализован, но игровой smoke-тест не пройден — нужна ручная проверка.",
      target: shaped,
    };
  return {
    publishable: "no",
    reason: "Маршрут установки заблокирован.",
    target: shaped,
  };
};

function findingShell({
  id,
  category,
  group,
  title,
  evidence,
  entries,
  targetLookup,
  extra,
}) {
  const meta = FINDING_CATEGORIES[category] || { label: category };
  const changes = { added: 0, changed: 0, removed: 0 };
  let bytes = 0;
  for (const entry of entries) {
    changes[entry.change || "added"] += 1;
    bytes += Number(entry.size) || 0;
  }
  return {
    id,
    category,
    group: group || null,
    title,
    label: meta.label || category,
    section: meta.section || null,
    slot: meta.slot || null,
    confidence: "exact",
    evidence,
    candidates: null,
    origin: "container",
    entries,
    files: entries.length,
    bytes,
    changes,
    ...VERDICT(category, targetLookup),
    ...extra,
  };
}

/**
 * Раскладывает авторские контейнеры на находки.
 *
 * Смешанный контейнер (`core.rpf` с мини-картой, прицелом и ядром эффектов)
 * даёт находку на каждую суть; однородный мировой контейнер — одну находку
 * со всеми файлами. Оружие и одежда группируются по предметам, как и в
 * разнице: так ганпак потом собирается со слотом на каждый ствол.
 */
export function classifyContainers(
  containers,
  {
    targetLookup: rawLookup = getLegacyModTarget,
    vanillaNames = new Set(),
  } = {},
) {
  const targetLookup = (category) =>
    rawLookup(ROUTE_ALIAS[category] || category);
  const routes = routeByBaseName();
  const findings = [];
  const skipped = [];

  const containerRoutes = exactRouteIndex();

  for (const container of containers) {
    if (container.astral) {
      skipped.push({
        path: container.path,
        files: container.files,
        reason: "слой Astral — след установки приложения",
      });
      continue;
    }
    /* Контейнер, который сам по себе — маршрут каталога: `minimap.rpf`
       большой карты ставится в игру одним файлом. Внутрь не разбирается. */
    /* Векторный радар в папке автора (17.10, TIFFANY FPS REDUX:
       `spex/spex_inta/minimap.rpf`, 65 плиток) — по содержимому: контейнер
       из плиток `minimap_X_Y.ydd`. Без этого он уходил в разбор мира как
       «замена штатных объектов», и редукс терял радар. Ставится маршрутом
       штатного `minimap.rpf`. */
    const radar =
      container.kind === "rpf" &&
      container.path.toLowerCase() !== VECTOR_MAP_CONTAINER &&
      isRadarContainer(container.entries);
    const whole = containerRoutes.get(
      radar ? VECTOR_MAP_CONTAINER : container.path.toLowerCase(),
    );
    if (whole?.length && container.kind === "rpf") {
      const category = whole[0].id;
      const meta = FINDING_CATEGORIES[category] || {};
      /* `minimap.rpf` — векторная большая карта: тайлы-модели, не плитки
         текстур. Это другой формат карты, и в каталоге он идёт отдельно. */
      const vector =
        radar || container.path.toLowerCase() === VECTOR_MAP_CONTAINER;
      findings.push(
        findingShell({
          id: `${container.path}::${category}`,
          category,
          group: null,
          title: `${meta.label || category}${vector ? " · векторная" : ""} · ${container.label}`,
          evidence: radar
            ? `векторный радар в папке автора: ${container.entries.length} плиток minimap_X_Y.ydd`
            : vector
              ? "векторная карта: тайлы-модели в minimap.rpf"
              : "контейнер целиком — маршрут каталога",
          entries: container.entries.map((entry) => ({
            path: entry.path,
            size: entry.size,
            sha256: entry.sha256,
            change: "added",
            inner: entry.inner,
            container: container.path,
          })),
          targetLookup,
          extra: {
            delivery: "route-container",
            ...(vector ? { variant: "vector" } : {}),
            installEntry: radar ? VECTOR_MAP_CONTAINER : container.path,
            installAction: whole[0].action || "import",
            container: {
              path: container.path,
              label: container.label,
              registered: container.registered,
              author: container.author,
            },
          },
        }),
      );
      continue;
    }
    const buckets = new Map();
    const world = [];
    const worldNames = [];
    /* Клипы (`clip@hatemod.ycd`) в контейнере арены — анимация реквизита автора (звезда Blink x Skye); в чужом контейнере (анимации
       персонажей) — по-прежнему «не опознано». */
    const clips = [];
    const unknown = [];
    const stamp = (entry, extra = {}) => ({
      path: entry.path,
      size: entry.size,
      sha256: entry.sha256,
      change: "added",
      inner: entry.inner,
      container: container.path,
      ...extra,
    });

    for (const entry of container.entries) {
      const name = (entry.inner || entry.path).split("/").pop() || "";
      const known = classifyFile(name, entry.inner || entry.path, routes);
      if (known) {
        const key = known.group
          ? `${known.category}:${known.group}`
          : known.category;
        if (!buckets.has(key)) buckets.set(key, { ...known, key, entries: [] });
        if (known.armor) buckets.get(key).armor = true;
        buckets.get(key).entries.push(
          stamp(entry, {
            installEntry: known.installEntry,
            ...(known.installAction
              ? { installAction: known.installAction }
              : {}),
            ...(known.ped ? { ped: known.ped } : {}),
          }),
        );
        continue;
      }
      const ext = name.split(".").pop().toLowerCase();
      if (WORLD_EXTENSIONS.has(ext) || name === "manifest.ymf") {
        world.push(stamp(entry));
        worldNames.push(name);
        continue;
      }
      if (ext === "ycd") {
        clips.push(stamp(entry));
        continue;
      }
      unknown.push(stamp(entry));
    }

    /* Словарь текстур мини-карты (`minimap.ytd`) в её же контейнере — часть
       мода мини-карты, а не «подмена штатных объектов»: живой
       scaleform_minimap_1.rpf давал вторую заявку «Оптимизация объектов»
       (Т-119). Маршрута для словаря у каталога нет — он назван в находке. */
    const minimap = buckets.get("minimap");
    if (minimap)
      for (let index = world.length - 1; index >= 0; index -= 1)
        if (MINIMAP_DICTIONARY.test(worldNames[index])) {
          minimap.companions = [
            worldNames[index],
            ...(minimap.companions || []),
          ];
          world.splice(index, 1);
          worldNames.splice(index, 1);
        }

    for (const bucket of buckets.values()) {
      const meta = FINDING_CATEGORIES[bucket.category] || {};
      const title = bucket.group
        ? bucket.category === "weapon-model"
          ? `Оружие · ${bucket.group}`
          : `Одежда · ${bucket.group}`
        : `${meta.label || bucket.category} · ${container.label}`;
      findings.push(
        findingShell({
          id: `${container.path}::${bucket.key}`,
          category: bucket.category,
          group: bucket.group,
          title,
          evidence: bucket.evidence,
          entries: bucket.entries,
          targetLookup,
          extra: {
            delivery: bucket.delivery,
            container: {
              path: container.path,
              label: container.label,
              registered: container.registered,
              author: container.author,
            },
            ...(bucket.category === "clothing"
              ? { armor: bucket.armor === true }
              : {}),
            ...(bucket.companions ? { companions: bucket.companions } : {}),
          },
        }),
      );
    }

    const worldKind = world.length ? classifyWorld(container, worldNames, vanillaNames, world) : null;
    /* Клипы идут с контейнером, только если он — арена; иначе они «не опознаны», как было. */
    if (worldKind?.category === "arenas") world.push(...clips);
    else unknown.push(...clips);
    if (world.length) {
      const kind = worldKind;
      const meta = FINDING_CATEGORIES[kind.category] || {};
      const hinted = {
        трава: "Трава и кусты",
        деревья: "Деревья",
        земля: "Поверхность земли",
        дороги: "Дороги",
      };
      /* Арена с облегчёнными штатными объектами в одном контейнере — две находки (`splitStockObjectsOutOfArena`). */
      const split = kind.category === "arenas" ? splitStockObjectsOutOfArena(world) : { arena: world, objects: [], interiors: [] };
      findings.push(
        findingShell({
          id: `${container.path}::${kind.category}`,
          category: kind.category,
          group: null,
          title: `${hinted[kind.hint] || meta.label || kind.category} · ${container.label}`,
          evidence: kind.evidence,
          entries: split.arena,
          targetLookup,
          extra: {
            delivery: "content-layer",
            hint: kind.hint,
            ...(kind.removes ? { removes: true } : {}),
            ...(kind.arena ? { arena: kind.arena } : {}),
            ...(kind.server ? { server: kind.server } : {}),
            ...(kind.zones ? { zones: kind.zones } : {}),
            container: {
              path: container.path,
              label: container.label,
              registered: container.registered,
              author: container.author,
            },
          },
        }),
      );
      if (split.objects.length)
        findings.push(
          findingShell({
            id: `${container.path}::object-optimization`,
            category: "object-optimization",
            group: null,
            title: `${FINDING_CATEGORIES["object-optimization"]?.label || "object-optimization"} · ${container.label}`,
            evidence: `${split.objects.length} штатных мелких объектов рядом с ареной (урны, автоматы, сорняки…) — подмена штатных объектов, не арена`,
            entries: split.objects,
            targetLookup,
            extra: {
              delivery: "content-layer",
              hint: null,
              container: { path: container.path, label: container.label, registered: container.registered, author: container.author },
            },
          }),
        );
      if (split.interiors.length)
        findings.push(
          findingShell({
            id: `${container.path}::interiors`,
            category: "interiors",
            group: null,
            title: `${FINDING_CATEGORIES.interiors?.label || "interiors"} · ${container.label}`,
            evidence: `${split.interiors.length} файлов магазинных интерьеров игры рядом с ареной (оружейный, 24/7, заправка, парикмахерская…) — не арена`,
            entries: split.interiors,
            targetLookup,
            extra: {
              delivery: "content-layer",
              hint: null,
              container: { path: container.path, label: container.label, registered: container.registered, author: container.author },
            },
          }),
        );
    }

    if (unknown.length)
      findings.push(
        findingShell({
          id: `${container.path}::unknown`,
          category: "unknown",
          group: null,
          title: `Не опознано · ${container.label}`,
          evidence:
            "файлы авторского контейнера, не подошедшие ни под одно правило",
          entries: unknown,
          targetLookup,
          extra: {
            delivery: "none",
            container: {
              path: container.path,
              label: container.label,
              registered: container.registered,
              author: container.author,
            },
          },
        }),
      );
  }

  return { findings, skipped };
}

/** Имена файлов, которые авторские контейнеры приносят с собой (в нижнем регистре). */
export function containerFileNames(containers) {
  const names = new Set();
  for (const item of containers) {
    if (item.astral) continue;
    for (const entry of item.entries || [])
      names.add(
        String(entry.inner || entry.path)
          .split("/")
          .pop()
          .toLowerCase(),
      );
  }
  return names;
}

/** Имя автора редукса, как его видно из архива: папка `x64/<имя>/`. */
export function authorLabelOf(containers) {
  const names = new Map();
  for (const item of containers)
    if (item.author && !item.astral)
      names.set(item.author, (names.get(item.author) || 0) + item.files);
  const best = [...names.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}
