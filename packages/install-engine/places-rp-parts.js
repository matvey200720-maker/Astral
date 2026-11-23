/*
 * Места на GTA 5 RP частью (21.11.2026): что из набора мест едет контейнером `update.rpf`, а что нет. Обобщение арены (`arena-rp-parts.js`) на здания: завод, маппинг, Мегамолл, Ашан / Икея.
 *
 * Набор здания = (а) файлы игры под своими именами, перекрашенные (модели, словари, дальние планы) — едут по имени, как стена арены; (б) плашки (эмблемы, надписи, стороны, логотипы, щиты) со своими
 * типами, картой и манифестом: ничего не перекрывают; (в) свои модели `astral_<набор>_m1…m16` с клипами; (г) копии вещей (`astral_<набор>_item_N`, `_cNNN`, `_tNN`, копии дальних планов под своим именем,
 * `astral_<набор>_local.ytyp`): они работают только через перекрытия типов и карт игры (карта района наводит сущности на копии, типы района ссылаются на копии словарей), а пакеты Rockstar
 * (`patchday*`, `mpheist`, `mplowrider`) перекрытия перебивают. Контейнером едут (а), (б), (в). НЕ едут перекрытия (`RECOLOR_SETS[набор].overrides`: карты и типы игры, их копии `hei_` и `lr_`, то есть и всё,
 * что игра включает наборами `GROUP_MAP`) и копии (г): без перекрытий они стоят без дела, вещь остаётся штатной, дыры нет.
 *
 * Группы для слов окна («На GTA 5 RP видно: … Не видно: …»): видно — `building` (здание по имени игры), `plates`, `models`; не видно — `items` (вещи по одной: копии и перекрытия карт и типов района) и `far`
 * (вид здания с большого расстояния: копии дальних планов и перекрытия типов дальних планов). Названия — `apps/web/.../install-queue/tasks/rp-places-groups.js` (по требованию).
 *
 * Арена едет своим модулем (`arena-rp-parts.js`: перекрытия зала и полотен, выключатель зала); здесь общий вход для строгой формы манифеста и сервиса установки. Манифест контейнера всегда собирается заново
 * по едущим файлам: пара «карта → типы» попадает в него, только если лежат оба файла (`placesRpManifestDependencies`), в нём нет ни одного имени, которого нет в контейнере.
 *
 * Модуль чистый: ввода-вывода нет. Имена — как в наборе (`RECOLOR_SETS`), регистр не важен.
 */
import {
  ARENA_RP_MANIFEST,
  ARENA_RP_MANIFEST_PAYLOAD,
  arenaRpHallEnabled,
  arenaRpLine,
  arenaRpManifestDependencies,
  arenaRpNeverByContainer,
  arenaRpSplit,
} from "./arena-rp-parts.js";
import {
  BILLBOARDS_SET,
  billboardsRpLine,
  billboardsRpNeverByContainer,
  billboardsRpSplit,
  billboardsRpTypesEnabled,
} from "./billboards-rp-parts.js";
import { RECOLOR_SETS } from "./recolor-manifest-trust.js";
import {
  RECOLOR_SET_ELEMENT_FILES,
  RECOLOR_SET_LOCAL_FILES,
  RECOLOR_SET_LOD_FILES,
} from "./recolor-sets.js";

/** Имя манифеста контейнера и его имя в пакете сборки (`payload/_manifest.rp.ymf`): полный `_manifest.ymf` сборки в контейнер не идёт. */
export const PLACES_RP_MANIFEST = ARENA_RP_MANIFEST;
export const PLACES_RP_MANIFEST_PAYLOAD = ARENA_RP_MANIFEST_PAYLOAD;

const ARENA_SET = "arenas";
const lower = (name) => String(name).toLowerCase();
const lowerSet = (names) => new Set((names || []).map(lower));

/** Порядок групп в словах окна: видно и не видно. */
export const PLACES_RP_SEEN_GROUPS = Object.freeze([
  "building",
  "plates",
  "models",
]);
export const PLACES_RP_HIDDEN_GROUPS = Object.freeze(["items", "far"]);

const rulesCache = new Map();

/* Правила набора-здания по данным набора: перекрытия, копии, шаблоны плашек. */
function rulesOf(setId) {
  if (rulesCache.has(setId)) return rulesCache.get(setId);
  const set = RECOLOR_SETS[setId];
  if (!set) throw new Error(`Набора «${setId}» нет.`);
  const own = `astral_${setId}_`;
  const overrides = lowerSet(set.overrides);
  const lod = lowerSet(RECOLOR_SET_LOD_FILES[setId]);
  const local = lowerSet(RECOLOR_SET_LOCAL_FILES[setId]);
  const element = lowerSet(RECOLOR_SET_ELEMENT_FILES[setId]);
  const copyName = new RegExp(
    `^${own}(?:item_\\d+\\.(?:ydr|yft|ytd)|c\\d{3}\\.(?:ydr|yft|ytd)|t\\d+\\.ytd|local\\.ytyp)$`,
  );
  const isCopy = (name) =>
    copyName.test(name) ||
    (name.startsWith(own) &&
      (lod.has(name) || local.has(name) || element.has(name)));
  const plates = new RegExp(
    `^${own}(?:emblem|mark|logo|wall|side|bill|cover|title)`,
  );
  const models = new RegExp(`^${own}(?:m\\d+|models)`);
  const rules = {
    own,
    /** Группа «не видно» файла или `null`, если он едет. */
    hidden(name) {
      if (!overrides.has(name) && !isCopy(name)) return null;
      return lod.has(name) && !local.has(name) && !copyName.test(name)
        ? "far"
        : "items";
    },
    /** Группа «видно» оставшегося файла или `null`. */
    seen(name) {
      if (plates.test(name)) return "plates";
      if (models.test(name)) return "models";
      if (!name.startsWith(own) && /\.(?:ydr|yft|ytd|ydd|ybn)$/.test(name))
        return "building";
      return null;
    },
  };
  rulesCache.set(setId, rules);
  return rules;
}

/** Файл, которого строгая форма манифеста контейнера не пускает ни при каком выключателе: перекрытия и копии набора (у арены — свой модуль). */
export function placesRpNeverByContainer(setId, name) {
  if (setId === ARENA_SET) return arenaRpNeverByContainer(name);
  if (setId === BILLBOARDS_SET) return billboardsRpNeverByContainer(name);
  return rulesOf(setId).hidden(lower(name)) !== null;
}

/**
 * Разбор собранных файлов набора для режима RP: `names` — имена файлов сборки. Ответ: `{ kept, dropped, unknown, chosen, refused }` (форма как у `arenaRpSplit`): что едет, что снято, имена вне набора,
 * группы «видно» и «не видно» (`[{ id }]`). Опции: `hall` — выключатель зала арены (у зданий его нет).
 */
export function placesRpSplit(setId, names, options = {}) {
  if (setId === ARENA_SET) return arenaRpSplit(names, options);
  if (setId === BILLBOARDS_SET)
    return billboardsRpSplit(names, { types: options.types === true });
  const set = RECOLOR_SETS[setId];
  const allowed = new Set([...set.files, ...set.extra].map(lower));
  const rules = rulesOf(setId);
  const kept = [];
  const dropped = [];
  const unknown = [];
  const hidden = new Set();
  const seen = new Set();
  for (const name of names) {
    const lowered = lower(name);
    if (!allowed.has(lowered)) {
      unknown.push(name);
      continue;
    }
    const group = rules.hidden(lowered);
    if (group) {
      dropped.push(name);
      hidden.add(group);
    } else {
      kept.push(name);
      const shown = rules.seen(lowered);
      if (shown) seen.add(shown);
    }
  }
  return {
    kept,
    dropped,
    unknown,
    chosen: PLACES_RP_SEEN_GROUPS.filter((id) => seen.has(id)),
    refused: PLACES_RP_HIDDEN_GROUPS.filter((id) => hidden.has(id)).map(
      (id) => ({ id }),
    ),
  };
}

/**
 * Связи «карта → типы» для манифеста контейнера по едущим файлам (`kept`): пара попадает в манифест, только если лежат ОБА файла (`<карта>.ymap` и `<типы>.ytyp`). Карта называется `<типы>_map` или
 * `<типы>_map_lod`. Порядок — по имени карты. Ответ для `compile-manifest`: `[{ map, types: [..] }]`; пусто — манифест не нужен.
 */
export function placesRpManifestDependencies(setId, kept) {
  if (setId === ARENA_SET) return arenaRpManifestDependencies(kept);
  const have = new Set(kept.map(lower));
  return [...have]
    .sort()
    .map((name) => /^(.+)_map(?:_lod)?\.ymap$/.exec(name))
    .filter((match) => match && have.has(`${match[1]}.ytyp`))
    .map((match) => ({
      map: match[0].slice(0, -".ymap".length),
      types: [match[1]],
    }));
}

/** Строка журнала: набор ставится частью (что легло, что снято, какие группы не видны). */
export function placesRpLine(setId, split) {
  if (setId === ARENA_SET) return arenaRpLine(split);
  if (setId === BILLBOARDS_SET) return billboardsRpLine(split);
  const groups = split.refused.map(({ id }) => id).join(", ");
  return `Места через update.rpf: набор ${setId} ставится частью — легло файлов ${split.kept.length}, снято ${split.dropped.length} (перекрытия карт и типов игры и то, что едет только с ними${groups ? `: ${groups}` : ""}).`;
}

/** Выключатель зала действует только у арены. */
export const placesRpHallEnabled = (setId, env) =>
  setId === ARENA_SET && arenaRpHallEnabled(env);

/** Опыт «типы районов и копии словарей тоже едут» (`ASTRAL_BILLBOARDS_RP_TYPES=1`) действует только у билбордов. */
export const placesRpTypesEnabled = (setId, env) =>
  setId === BILLBOARDS_SET && billboardsRpTypesEnabled(env);
