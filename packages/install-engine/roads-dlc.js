/*
 * Пакеты дополнения Astral с дорогами: `astral_roads` и `astral_roads_b`
 * (задача 6 ТЗ 07.10.2026).
 *
 * «Дороги» правят листы асфальта, грунтовок, тротуаров и разметки по всей
 * карте — в общих словарях `gtxd.rpf`, их копиях `+hi` и дальних планах, и
 * в словарях районов: около полутора тысяч словарей, до четырёх с лишним
 * гигабайт, если менять всё сразу. В update.rpf их не положить (у владельца
 * он 2,9 ГБ при пределе 4 ГБ), а главный словарь дорог `globalroads` игра
 * берёт из пакета Rockstar `patchday2ng` — из update.rpf его не перекрыть
 * вовсе. Пакеты устроены как пакеты растительности (`vegetation-dlc.js`):
 *
 *   • `content.xml` — записи `RPF_FILE` с `overlay` на свои потоковые
 *     архивы, набор изменений — в `GROUP_STARTUP`;
 *   • `setup2.xml` — `EXTRACONTENT_COMPAT_PACK`, `order` 103 и 104;
 *   • `<потоковый архив>/<имя>.ytd` — словари с перекрашенными листами
 *     дорог, остальные листы словаря — как в игре, байт в байт; и модели
 *     (`.ydr`, `.ydd`, `.yft`), у которых лист дороги встроен внутрь, — по
 *     возможности `direct-roads-models-v1` (`ROADS_MODELS_CAPABILITY`);
 *   • файлы сетевой карты (`hei_…`) — в `<пакет>_mp.rpf`, набор изменений
 *     в `GROUP_MAP` (`roadsArchiveOf`, 12.10.2026).
 *
 * Два пакета — потому что архив пакета дополнения держит меньше 4 ГиБ (у
 * Rockstar самый большой — 3,98 ГБ), а словари дорог со всеми частями —
 * больше четырёх. Словарь попадает в пакет и часть по своему имени.
 *
 * Файлов игры установка не трогает, кроме строк регистрации пакетов в
 * dlclist.xml update.rpf; со снятием дорог регистрация уходит
 * (`direct-dlcs.js`). Основы архивов собирает приложение
 * (`apps/desktop/src/roads-dlc-host.js`) и передаёт путями `roadsDlcHost` и
 * `roadsDlcBHost`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { foreignAstralTraces, inspectModsShadow, MODS_SHADOW_ARCHIVE, settleForeignAstralTraces } from "./astral-layer.js";
import { rebaseDirectUpdateIfNeeded } from "./direct-update-rebase.js";
import { resolveInside, sha256File } from "./manifest.js";
import { ASTRAL_UPDATE_TARGET, composeDirectDlcRegistry } from "./registry-composers.js";
import { ensureArchiveResource } from "./resource-composition.js";
import { exists, missingBaseline } from "./storage-state.js";
import { copyFileCancellable } from "./transaction.js";

export const ROADS_DLC_NAME = "astral_roads";
export const ROADS_DLC_TARGET = "update/x64/dlcpacks/astral_roads/dlc.rpf";
export const ROADS_DLC_CAPABILITY = "direct-roads-dlc-v1";
export const ROADS_DLC_B_NAME = "astral_roads_b";
export const ROADS_DLC_B_TARGET = "update/x64/dlcpacks/astral_roads_b/dlc.rpf";
export const ROADS_DLC_B_CAPABILITY = "direct-roads-dlc-b-v1";
/*
 * Модели со встроенными листами дорог (ТЗ 17.10.2026, вечер, задача 1): 839
 * моделей карты (по описи) несут лист разметки или асфальта внутри — аэропорт, часть
 * Вайнвуда, наклейки у домов. Они едут в те же пакеты, но только по своей
 * возможности манифеста и только по именам из описи (`roads-model-names.js`).
 */
export const ROADS_MODELS_CAPABILITY = "direct-roads-models-v1";

/*
 * Части: четыре потоковых архива, по два в пакете. Имена одной части
 * держатся в пределах таблицы имён RPF7, вес — около гигабайта (RageLib
 * читал вложенный архив больше 2 ГБ счётчиком int — урок растительности).
 */
/*
 * Порядок и пакет мест. У пакета мест (`astral_places`, order 107) игровые
 * имена файлов, у дорог (103, 104) — тоже: если имя модели дорог совпадает с
 * именем файла места, место главнее (107 > 104) — так и надо по правилу
 * проекта «места главнее дорог и ступеней текстур», в отличие от третьего
 * пакета текстур (108), чьи файлы с именами места в пакет не кладутся.
 * Совпадение имён описи дорог с именами мест держит тест.
 */
export const ROADS_DLC_STREAMS = Object.freeze(["astral_roads.rpf", "astral_roads_2.rpf", "astral_roads_3.rpf", "astral_roads_4.rpf"]);

/*
 * Порядок пакетов: 103 и 104 — выше всех пакетов Rockstar (у владельца
 * старший — 57: их `globalroads` из patchday2ng тоже перекрывается) и ниже
 * ступени «Ухудшения текстур» (105): ступень собирается поверх словарей
 * дорог и ужимает их в их новом цвете, а растительность (110) — поверх
 * всех (её газоны лежат в тех же словарях земли).
 */
export const ROADS_DLC_PACKS = Object.freeze([
  Object.freeze({
    name: ROADS_DLC_NAME,
    target: ROADS_DLC_TARGET,
    capability: ROADS_DLC_CAPABILITY,
    streams: Object.freeze(ROADS_DLC_STREAMS.slice(0, 2)),
    device: "ASTRAL_ROADS",
    order: 103,
    owner: "@astral-roads-host",
    bases: "roads-dlc",
  }),
  Object.freeze({
    name: ROADS_DLC_B_NAME,
    target: ROADS_DLC_B_TARGET,
    capability: ROADS_DLC_B_CAPABILITY,
    streams: Object.freeze(ROADS_DLC_STREAMS.slice(2)),
    device: "ASTRAL_ROADS_B",
    order: 104,
    owner: "@astral-roads-b-host",
    bases: "roads-dlc-b",
  }),
]);

/* Предел веса одного пакета: как у пакета текстур. */
export const ROADS_DLC_MAX_BYTES = 3600 * 1024 * 1024;

/** Потоковый архив для словаря (FNV-1a имени строчными). */
export function roadsStreamOf(name) {
  let hash = 0x811c9dc5;
  const text = String(name).toLowerCase();
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ROADS_DLC_STREAMS[hash % ROADS_DLC_STREAMS.length];
}

/** Пакет дорог, в котором лежит словарь. */
export const roadsPackOf = (name) => {
  const stream = roadsStreamOf(name);
  return ROADS_DLC_PACKS.find((pack) => pack.streams.includes(stream));
};

/*
 * Словари сетевой карты (12.10.2026, вслед за провалом у ангара): `hei_…`
 * районов mpheist игра берёт из его архивов, которые mpheist включает
 * наборами группы `GROUP_MAP` (вход в сетевую карту GTA Online и серверов).
 * Пакет ставил свои `hei_` словари на старте, раньше mpheist, — так же, как
 * растительность свои `hei_` карты, а у неё в сетевой карте брали верх
 * карты mpheist (`vegetation-dlc.js`). Как у пакета мест и растительности:
 * `hei_` словари — в архиве `<пакет>_mp.rpf`, его включает второй набор
 * изменений пакета в `GROUP_MAP`, после mpheist. Пакет словаря — прежний.
 */
const MAP_FILE = /^hei_(?!prop_)/i;
/*
 * Правило по игре вместо префикса (26.10.2026): в `<пакет>_mp.rpf` идёт ровно то, что игра включает наборами `GROUP_MAP` штатных пакетов и чего нет в ней нигде
 * больше, — и `hei_` районов mpheist, и файлы без префикса (`apa_*` апартаментов, `lr_*`, `xm_*`… — на игре владельца 22 из 2442). Всё остальное, даже с префиксом
 * `hei_` (`hei_ch3_rd1a_*` лежат у Rockstar вне `GROUP_MAP`), — в части на старте: иначе в сюжете остаётся штатное. `mapNames` — имена строчными из игры игрока
 * (`apps/desktop/src/game-map-names.js`). Префикс `hei_` — только запасное правило, когда игру прочитать нельзя (`mapNames` — `null`: нет ключей).
 */
/** Словарь или модель сетевой карты: имя из `mapNames` — архивы `GROUP_MAP`; без списка игры — `hei_…` (кроме пропов). */
export const isRoadsMapFile = (name, mapNames = null) => (mapNames ? mapNames.has(String(name).toLowerCase()) : MAP_FILE.test(String(name)));
/** Имя по правилу `hei_` (запасному): от игры игрока не зависит, по нему считается раскладка `map-group-v1`. */
export const isRoadsHeiFile = (name) => MAP_FILE.test(String(name));
/** Архив сетевой карты пакета. */
export const roadsMapStreamOf = (pack) => `${pack.name}_mp.rpf`;
/** Архивы пакета, в которые дороги вправе писать. */
export const roadsArchivesOf = (pack) => [...pack.streams, roadsMapStreamOf(pack)];
/** Архив внутри пакета для словаря: часть по имени, словари сетевой карты — в архив `GROUP_MAP`. */
export const roadsArchiveOf = (name, mapNames = null) => (isRoadsMapFile(name, mapNames) ? roadsMapStreamOf(roadsPackOf(name)) : roadsStreamOf(name));

/** Пакет дорог по архиву (`target`) или `null`. */
export const roadsPackByTarget = (target) =>
  ROADS_DLC_PACKS.find((pack) => pack.target === String(target || "").toLowerCase()) || null;

/**
 * Подготовка к установке дорог в пакет: ресурсы update.rpf (в нём
 * регистрация пакета) и самого пакета. Первая установка включает пакет
 * строкой в dlclist.xml update.rpf — те же проверки, что у растительности.
 */
async function prepareRoadsPack(
  pack,
  { parsed, target, targetKey, paths, root, host, contentXmlProvider, dlcListProvider, rpfProbe, signal, onProgress },
) {
  if (!parsed.files.some((file) => file.target === pack.target)) throw new Error("Пакету дорог Astral нечего писать в свой архив.");
  /* Следы прежней установки Astral в архиве (задача 1 ТЗ 10.10.2026). */
  let traces = null;
  if (!target.directDlcRegistrations?.[pack.name]) {
    const shadow = await inspectModsShadow(root, exists);
    if (shadow.shadowed)
      throw new Error(
        `Игра читает ${MODS_SHADOW_ARCHIVE}, а не свой update.rpf: рядом стоит загрузчик (${[
          ...shadow.hooks,
          ...shadow.plugins,
        ].join(", ")}). Уберите копию архива из папки mods или отключите загрузчик — иначе дороги в игре не изменятся.`,
      );
    const hadUpdateResource = Boolean(target.resources?.[ASTRAL_UPDATE_TARGET]);
    await rebaseDirectUpdateIfNeeded({ target, root, paths, targetKey, contentXmlProvider, dlcListProvider, signal });
    if (!hadUpdateResource)
      traces = await foreignAstralTraces({
        target,
        root,
        paths,
        targetKey,
        contentXmlProvider,
        dlcListProvider,
        rpfProbe,
        resolveInside,
      });
  }
  await ensureArchiveResource({ target, archiveTarget: ASTRAL_UPDATE_TARGET, root, paths, targetKey, signal, onProgress });
  await settleForeignAstralTraces({ target, traces, paths, targetKey, dlcListProvider, signal });
  return ensureRoadsPackResource(pack, { target, targetKey, paths, root, host, signal });
}

/**
 * Регистрация пакета в dlclist.xml: один раз. Возвращает архив, который
 * пересобран, или `null`, если пакет уже был записан.
 */
async function registerRoadsPack(pack, { target, targetKey, paths, dlcListProvider }) {
  target.directDlcRegistrations ||= {};
  if (target.directDlcRegistrations[pack.name]) return null;
  target.directDlcRegistrations[pack.name] = { owner: pack.owner, registeredAt: new Date().toISOString() };
  await composeDirectDlcRegistry({ target, targetKey, paths, dlcListProvider, archiveTarget: ASTRAL_UPDATE_TARGET });
  return ASTRAL_UPDATE_TARGET;
}

/**
 * Состояние архива пакета: основа — копия хоста в кэше движка. Хост сменился
 * (новая версия приложения) — основа обновляется, слой дорог остаётся и
 * ляжет поверх новой при следующей сборке.
 */
async function ensureRoadsPackResource(pack, { target, targetKey, paths, root, host, signal }) {
  if (!host) throw new Error("Основа пакета дорог Astral не подготовлена.");
  const hostStat = await fs.lstat(host);
  if (!hostStat.isFile() || hostStat.isSymbolicLink()) throw new Error("Основа пакета дорог Astral небезопасна.");
  const hostHash = await sha256File(host);
  const directory = path.join(paths.bases, targetKey, pack.bases);
  const compositionPath = path.join(directory, `${pack.name}.${hostHash.slice(0, 16)}.base.rpf`);
  await fs.mkdir(directory, { recursive: true });
  if (!(await exists(compositionPath))) await copyFileCancellable(host, compositionPath, signal);
  const compositionBase = { exists: true, path: compositionPath, sha256: hostHash, verified: true };
  target.resources ||= {};
  target.archives ||= {};
  const existing = target.resources[pack.target];
  if (existing) {
    if (existing.compositionBase?.sha256 !== hostHash) {
      existing.base = compositionBase;
      existing.compositionBase = compositionBase;
      delete target.archives[pack.target]?.lastBuilt;
    }
    target.archives[pack.target] ||= { entries: {} };
    target.archives[pack.target].entries ||= {};
    return existing;
  }
  /* Файла пакета в игре до Astral не было — откат к оригиналу его убирает.
     Если он уже лежит (прежняя установка без состояния), он и есть
     оригинал: чужое движок не удаляет. */
  const livePath = resolveInside(root, pack.target);
  let original = missingBaseline();
  if (await exists(livePath)) {
    const liveStat = await fs.lstat(livePath);
    if (!liveStat.isFile() || liveStat.isSymbolicLink()) throw new Error("Существующий пакет дорог Astral небезопасен.");
    const originalPath = path.join(directory, "pre-astral.original.rpf");
    await copyFileCancellable(livePath, originalPath, signal);
    original = { exists: true, path: originalPath, sha256: await sha256File(originalPath), verified: true };
  }
  const resource = {
    base: compositionBase,
    compositionBase,
    original,
    clean: missingBaseline(),
    persistentManaged: true,
    layers: [],
  };
  target.resources[pack.target] = resource;
  target.archives[pack.target] = { entries: {} };
  return resource;
}

const [PACK_A, PACK_B] = ROADS_DLC_PACKS;
export const prepareRoadsDlc = (context) => prepareRoadsPack(PACK_A, context);
export const registerRoadsDlc = (context) => registerRoadsPack(PACK_A, context);
export const ensureRoadsDlcResource = (context) => ensureRoadsPackResource(PACK_A, context);
export const prepareRoadsDlcB = (context) => prepareRoadsPack(PACK_B, context);
export const registerRoadsDlcB = (context) => registerRoadsPack(PACK_B, context);
export const ensureRoadsDlcBResource = (context) => ensureRoadsPackResource(PACK_B, context);
