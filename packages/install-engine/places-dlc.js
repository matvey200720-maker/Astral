/*
 * Пакет дополнения Astral с местами мастерской: `astral_places` (фикс 1
 * ТЗ 06.10.2026).
 *
 * Места — Завод, Ангар, Маппинг, Зоны, Арена, Мегамолл, «Ашан / Икея»,
 * Вайнвуд — правят файлы игры: модели и словари вблизи, дальние планы
 * (LOD, SLOD1…3), типы (`.ytyp`) и карты (`.ymap`) района. До 06.10 они
 * лежали в контейнерах update.rpf (`x64/astral/astral_<набор>.rpf`), и
 * часть правок игра не видела вовсе: типы и карты городских районов
 * Rockstar перевыпустила в пакетах `patchday1ng`/`patchday2ng`, а пакеты
 * дополнений грузятся после update.rpf и перекрывают его. Копия словаря
 * дальних моделей подключалась правкой типов — правку перекрывал
 * patchday, и на части дистанций (у Мегамолла 220–420 м, у «Ашана» —
 * ближний LOD) в игре была ваниль. Правка карт района (своё место —
 * своими копиями вещей, фикс 2) из update.rpf не доехала бы тоже.
 *
 * Пакет устроен как пакеты Rockstar, что правят карту (`patchday2ng`):
 *
 *   • `content.xml` — у каждого места потоковый архив моделей и словарей
 *     (`astral_<набор>.rpf`, `RPF_FILE` с `overlay`) и архив данных карты
 *     (`astral_<набор>_metadata.rpf`: карты, типы, манифест — `overlay`,
 *     `loadCompletely`, `CONTENTS_DLC_MAP_DATA`); набор изменений — в
 *     `GROUP_STARTUP` (урок хоста оружия 04.10.2026). Манифестов пакет не
 *     везёт: хранилище метаданных игры у игрока заполнено до конца (3200 из
 *     3200), и манифест места в пакете ронял GTA на загрузке; постоянные
 *     типы копий вещей мест (фикс 2) — запросом `DLC_ITYP_REQUEST`, как
 *     пропы пакетов Rockstar (`PLACES_LOCAL_TYPES_SETS`);
 *   • `setup2.xml` — `EXTRACONTENT_COMPAT_PACK`, `order` 107: выше всех
 *     пакетов Rockstar (у них до 57) и ступени «Ухудшения текстур» (105) —
 *     её мыло больше не перекрывает облик места вдали; ниже растительности
 *     (110), которая собирается поверх файлов мест;
 *   • места ставятся и снимаются порознь, у каждого свои архивы и свой
 *     `_manifest.ymf`.
 *
 * Файлов игры установка не трогает, кроме строки регистрации пакета в
 * dlclist.xml update.rpf. Пакет включён, пока в нём стоит хоть одно место
 * (`direct-dlcs.js`).
 *
 * Основу архива собирает приложение (`apps/desktop/src/places-dlc-host.js`)
 * и передаёт путём `placesDlcHost`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { foreignAstralTraces, inspectModsShadow, MODS_SHADOW_ARCHIVE, settleForeignAstralTraces } from "./astral-layer.js";
import { rebaseDirectUpdateIfNeeded } from "./direct-update-rebase.js";
import { readState, serializeMutation } from "./engine-state.js";
import { resolveInside, sha256File } from "./manifest.js";
import { ASTRAL_UPDATE_TARGET, composeDirectDlcRegistry } from "./registry-composers.js";
import { composeArchiveResource, ensureArchiveResource } from "./resource-composition.js";
import { assertRuntimeSafe } from "./runtime-guard.js";
import { checkedRecordKey, ownRecordValue } from "./state-record.js";
import { DEFAULT_DIR, exists, missingBaseline, statePaths } from "./storage-state.js";
import { copyFileCancellable } from "./transaction.js";
import { recoverPendingTransactions, transact } from "./transactions.js";

export const PLACES_DLC_NAME = "astral_places";
export const PLACES_DLC_TARGET = "update/x64/dlcpacks/astral_places/dlc.rpf";
export const PLACES_DLC_CAPABILITY = "direct-places-dlc-v1";
/* Выше Rockstar и «Ухудшения текстур» (105), ниже растительности (110). */
export const PLACES_DLC_ORDER = 107;

/*
 * Места пакета — у каждого свой потоковый архив и архив данных карты.
 * Новое место — строка здесь: основа пакета (схема хоста) пересоберётся
 * сама, поставленные места лягут поверх новой основы.
 */
export const PLACES_DLC_SETS = Object.freeze([
  "zones",
  "factory",
  "hangar",
  "mapping",
  "arenas",
  "megamall",
  "youtool",
  "vinewood",
  "busstops",
  "mslzones",
  "floatlogo",
  /* «Дирижабли» (ТЗ 11.10.2026): свои летающие модели и копия словаря дирижабля игры. */
  "airships",
  /* «Интерьеры» (задача 3 ТЗ 10.10.2026): файлы помещений магазинов. */
  "shops",
  /* «Билборды» (задача 4 ТЗ 10.10.2026, вечер): модели и словари районов с листами щитов. */
  "billboards",
  /* «Зоны каптов» (задача 8 ТЗ 10.10.2026, вечер): свои модели шайб над каптами и ареной. */
  "captzones",
  /* «Расписание» (задача 11 ТЗ 10.10.2026, вечер): свои модели табло на местах табло сервера Majestic. */
  "schedule",
  /* «Флаги» (задача 7 ТЗ 10.10.2026, вечер): штатные модели флагов с тканью и общий словарь листов. */
  "flags",
  /* «Банкоматы» (задача 4 ТЗ 17.10.2026): штатные модели банкоматов и их словари высокой чёткости. */
  "atms",
]);

/*
 * Файлы сетевой карты (провал у ангара, ТЗ 12.10.2026). Город в GTA Online и
 * на серверах (Majestic, GTA 5 RP — они грузят ту же карту) в районах
 * ограблений — не базовый, а копии mpheist с именами `hei_…` (аэропорт,
 * Бербанк, Даунтаун, Вайнвуд, сельская местность…): их архивы mpheist
 * включает только наборами изменений группы `GROUP_MAP` (вход в сетевую
 * карту), а базовые архивы района теми же наборами отключает. Пакет мест
 * ставил свои `hei_` файлы на старте игры (`GROUP_STARTUP`), раньше mpheist,
 * и у ангара в сетевой карте не стало коллизии: пол рисуется, а игрок падает
 * сквозь него (стенд 12.10.2026, `entermp`: луч вниз не находит пола внутри
 * ангара, к западу, северу и в 170 м к востоку, игрок падает до −61 м; в
 * сюжетной карте и за пределами аэропорта пол на месте). Пакеты Rockstar
 * правят сетевую карту архивом `overlay` в своей группе `GROUP_MAP` (у
 * mp2023…mp2026 — navmeshes), так же и здесь: `astral_<место>_mp.rpf` и
 * `astral_<место>_mp_metadata.rpf` включаются в `GROUP_MAP` пакета мест —
 * после mpheist (order 10 < 107).
 *
 * Все `hei_` файлы мест (12.10.2026: ангар 17, интерьеры 34, завод, маппинг
 * и билборды по 2–4) сверены с игрой — они из архивов `GROUP_MAP` mpheist
 * (`bh1_13` — через `update.rpf:dlc_patch/mpheist`). Пропы mpheist
 * (`hei_prop_…`) — общие, на старте; место с новыми `hei_` файлами —
 * строка здесь (её требует `tests/places-dlc.test.js`).
 */
/* Мегамолл и Ашан / Икея (27.10.2026): вещи по одной правят карты района и их правки пакетов — `hei_` (mpheist) и `lr_` (лоурайдеры), им место в архивах сетевой карты.
   Арена (21.11.2026): здание вблизи у Majestic идёт набором карты (`ARENA_MAP_FILES`), порядок — как в `PLACES_DLC_SETS`. */
export const PLACES_MAP_SETS = Object.freeze(["factory", "hangar", "mapping", "arenas", "megamall", "youtool", "shops", "billboards"]);
const MAP_FILE = /^hei_(?!prop_)/i;
/*
 * Арена Majestic: стена здания вблизи (21.11.2026, разбор по файлам клиента).
 *
 * DLC Majestic `mazearena` (order 100) ставит словарь стены `sp1_10_stadium.ytd` и модели здания (`sp1_10_mainwall_1`, `sp1_10_wind01…04`, `sp1_10_ground_1/2`…) НЕ на старте, а набором
 * карты `mazearena_GTA5_CITYW_SANPEDRO_01` группы `GROUP_MAP`: он отключает базовый `sp1_10.rpf` и включает свой overlay-архив с этими файлами. `GROUP_MAP` исполняется после
 * `GROUP_STARTUP`, поэтому наши файлы с теми же именами из потокового архива пакета мест (набор `CCS_ASTRAL_PLACES_STREAMING`, order 107) уступали ему: заход arena11diag 21.11 — плаза
 * (`sp1_10.ytd`, в overlay Majestic его нет) красится, стена (`sp1_10_stadium.ytd`, `sp1_10_mainwall_1.ydr`, `wind01/04`) нет ни из одного носителя. Внутренние модели зала лежат у
 * Majestic в `mj_ma_props.rpf` набора `mazearena_AUTOGEN` (старт) — их наш пакет перекрывал и раньше. Лекарство то же, что у ангара 12.10: файл в `astral_arenas_mp.rpf` под набор
 * `CCS_ASTRAL_PLACES_MAP` (тот же `GROUP_MAP`, order 107 после 100). Строение файла не меняется: тот же словарь, другой архив пакета.
 *
 * Едут только словари стены: цвет стены, окон и металла — листы `sp1_10_stadium.ytd` (99,8 % площади `mainwall_1` — лист `sp1_10_rsn_mc_wall_0001`), модели здания Majestic в игре остаются
 * его собственными. Наши копии моделей набора 09.10 в карту не едут: Majestic мог обновить их после 09.10, и копия откатила бы форму здания. Дальние планы (`sp1_10_lod.ytd`,
 * `sp1_lod_10_11_children.*`) и базовые словари блока (`sp1_10.ytd`, `sp1_10_details.ytd`) остаются на старте: так они уже работали. Файлы, которых нет в наборе, в списке безвредны.
 */
export const ARENA_MAP_FILES = Object.freeze(["sp1_10_stadium.ytd", "sp1_10_stadium+hi.ytd"]);
const ARENA_MAP_FILE_SET = new Set(ARENA_MAP_FILES);
/** Файл арены из набора карты Majestic: всегда в архив сетевой карты, список игры его не касается (Majestic в папке игры нет). */
export const isArenaMapFile = (setId, name) => setId === "arenas" && ARENA_MAP_FILE_SET.has(String(name).toLowerCase());
/*
 * Правило по игре вместо префикса (как у дорог и растительности, `roads-dlc.js`): в архивы `<место>_mp(_metadata).rpf` идёт ровно то, что штатные пакеты включают
 * наборами `GROUP_MAP` и чего нет в игре нигде больше, — `hei_` районов mpheist и файлы без префикса (`lr_*` лоурайдеров, `apa_*`, `m24_*`, `tr_*`…).
 * Остальное, даже с `hei_`, — в архивы на старте. `mapNames` — имена строчными из игры игрока (`apps/desktop/src/game-map-names.js`). Префикс `hei_` —
 * только запасное правило, когда игру прочитать нельзя (`mapNames` — `null`).
 */
/** Файл места из архивов сетевой карты: имя из `mapNames` — архивы `GROUP_MAP`; без списка игры — `hei_…` (кроме пропов). */
export const isPlacesMapFile = (setId, name, mapNames = null) =>
  PLACES_MAP_SETS.includes(setId) &&
  (isArenaMapFile(setId, name) || (mapNames ? mapNames.has(String(name).toLowerCase()) : MAP_FILE.test(String(name))));
/** Имя по правилу `hei_` (запасному): от игры игрока не зависит, по нему считается раскладка `map-group-v1`. */
export const isPlacesHeiFile = (setId, name) => PLACES_MAP_SETS.includes(setId) && MAP_FILE.test(String(name));
export const placesMapStreamOf = (setId) => `astral_${setId}_mp.rpf`;
export const placesMapMetadataOf = (setId) => `astral_${setId}_mp_metadata.rpf`;

/** Потоковый архив места внутри пакета: модели и словари. */
export const placesStreamOf = (setId) => `astral_${setId}.rpf`;
/*
 * Архив данных карты места: карты (`.ymap`), типы (`.ytyp`) и манифест.
 * Так раскладывает свои пакеты Rockstar (`…_metadata.rpf` с
 * `CONTENTS_DLC_MAP_DATA`): с картой и манифестом в простом потоковом
 * архиве пакет дополнения ронял игру на загрузке (06.10.2026, дамп —
 * запись по нулевому адресу при разборе `astral_factory.rpf`).
 */
export const placesMetadataOf = (setId) => `astral_${setId}_metadata.rpf`;
const MAP_DATA = /\.(?:ymap|ytyp|ymf)$/i;
/** Архив места для файла по его имени: данные карты — в свой, файлы сетевой карты — в архивы `GROUP_MAP`. */
export const placesArchiveOf = (setId, name, mapNames = null) => {
  const mapData = MAP_DATA.test(String(name));
  if (isPlacesMapFile(setId, name, mapNames)) return mapData ? placesMapMetadataOf(setId) : placesMapStreamOf(setId);
  return mapData ? placesMetadataOf(setId) : placesStreamOf(setId);
};

/*
 * Постоянные типы копий места (фикс 2): общая вещь (контейнер, забор,
 * банкомат) красится только в своём месте копией архетипа под своим
 * именем; копии живут в `astral_<место>_local.ytyp` архива данных карты, и
 * пакет держит их постоянно (`DLC_ITYP_REQUEST`, как пакеты Rockstar —
 * свои пропы): карта района находит копию, когда бы ни загрузилась. Основа
 * пакета везёт пустые типы, поставленное место перекрывает их своими.
 */
/* «Интерьеры» (второй заход задачи 3 ТЗ 10.10.2026): свои колонки станций — копиями в `astral_shops_local`. */
export const PLACES_LOCAL_TYPES_SETS = Object.freeze(["factory", "hangar", "mapping", "arenas", "megamall", "youtool", "shops"]);
export const placesLocalTypesOf = (setId) => `astral_${setId}_local`;
/** Записи основы, которые место перекрывает своими: пустые постоянные типы. */
export const placesBaseOverlays = () => PLACES_LOCAL_TYPES_SETS.map((set) => `${placesMetadataOf(set)}/${placesLocalTypesOf(set)}.ytyp`);

const PLACES_DLC_OWNER = "@astral-places-host";

/**
 * Подготовка к установке места в пакет: ресурсы update.rpf (в нём
 * регистрация пакета) и самого пакета. Первая установка включает пакет
 * строкой в dlclist.xml update.rpf — те же проверки, что у растительности.
 */
export async function preparePlacesDlc({
  parsed,
  target,
  targetKey,
  paths,
  root,
  host,
  contentXmlProvider,
  dlcListProvider,
  rpfProbe,
  signal,
  onProgress,
}) {
  if (!parsed.files.some((file) => file.target === PLACES_DLC_TARGET))
    throw new Error("Пакету мест Astral нечего писать в свой архив.");
  /* Следы прежней установки Astral в архиве (задача 1 ТЗ 10.10.2026). */
  let traces = null;
  if (!target.directDlcRegistrations?.[PLACES_DLC_NAME]) {
    const shadow = await inspectModsShadow(root, exists);
    if (shadow.shadowed)
      throw new Error(
        `Игра читает ${MODS_SHADOW_ARCHIVE}, а не свой update.rpf: рядом стоит загрузчик (${[
          ...shadow.hooks,
          ...shadow.plugins,
        ].join(", ")}). Уберите копию архива из папки mods или отключите загрузчик — иначе место в игре не появится.`,
      );
    const hadUpdateResource = Boolean(target.resources?.[ASTRAL_UPDATE_TARGET]);
    await rebaseDirectUpdateIfNeeded({
      target,
      root,
      paths,
      targetKey,
      contentXmlProvider,
      dlcListProvider,
      signal,
    });
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
  await ensureArchiveResource({
    target,
    archiveTarget: ASTRAL_UPDATE_TARGET,
    root,
    paths,
    targetKey,
    signal,
    onProgress,
  });
  await settleForeignAstralTraces({ target, traces, paths, targetKey, dlcListProvider, signal });
  return ensurePlacesDlcResource({ target, targetKey, paths, root, host, signal });
}

/**
 * Регистрация пакета в dlclist.xml: один раз. Возвращает архив, который
 * пересобран, или `null`, если пакет уже был записан.
 */
export async function registerPlacesDlc({ target, targetKey, paths, dlcListProvider }) {
  target.directDlcRegistrations ||= {};
  if (target.directDlcRegistrations[PLACES_DLC_NAME]) return null;
  target.directDlcRegistrations[PLACES_DLC_NAME] = {
    owner: PLACES_DLC_OWNER,
    registeredAt: new Date().toISOString(),
  };
  await composeDirectDlcRegistry({
    target,
    targetKey,
    paths,
    dlcListProvider,
    archiveTarget: ASTRAL_UPDATE_TARGET,
  });
  return ASTRAL_UPDATE_TARGET;
}

/**
 * Состояние архива пакета: основа — копия хоста в кэше движка. Хост сменился
 * (новое место, новая версия приложения) — основа обновляется, слои мест
 * остаются и лягут поверх новой при следующей сборке.
 */
export async function ensurePlacesDlcResource({ target, targetKey, paths, root, host, signal }) {
  if (!host) throw new Error("Основа пакета мест Astral не подготовлена.");
  const hostStat = await fs.lstat(host);
  if (!hostStat.isFile() || hostStat.isSymbolicLink()) throw new Error("Основа пакета мест Astral небезопасна.");
  const hostHash = await sha256File(host);
  const directory = path.join(paths.bases, targetKey, "places-dlc");
  const compositionPath = path.join(directory, `${PLACES_DLC_NAME}.${hostHash.slice(0, 16)}.base.rpf`);
  await fs.mkdir(directory, { recursive: true });
  if (!(await exists(compositionPath))) await copyFileCancellable(host, compositionPath, signal);
  /* Пустые постоянные типы мест — записи основы, которые место перекрывает. */
  const overlays = placesBaseOverlays();
  const compositionBase = { exists: true, path: compositionPath, sha256: hostHash, verified: true, overlays };
  target.resources ||= {};
  target.archives ||= {};
  const existing = target.resources[PLACES_DLC_TARGET];
  if (existing) {
    if (existing.compositionBase?.sha256 !== hostHash) {
      existing.base = compositionBase;
      existing.compositionBase = compositionBase;
      delete target.archives[PLACES_DLC_TARGET]?.lastBuilt;
    } else if (JSON.stringify(existing.compositionBase.overlays || []) !== JSON.stringify(overlays)) existing.compositionBase.overlays = overlays;
    target.archives[PLACES_DLC_TARGET] ||= { entries: {} };
    target.archives[PLACES_DLC_TARGET].entries ||= {};
    return existing;
  }
  /* Файла пакета в игре до Astral не было — откат к оригиналу его убирает.
     Если он уже лежит (прежняя установка без состояния), он и есть
     оригинал: чужое движок не удаляет. */
  const livePath = resolveInside(root, PLACES_DLC_TARGET);
  let original = missingBaseline();
  if (await exists(livePath)) {
    const liveStat = await fs.lstat(livePath);
    if (!liveStat.isFile() || liveStat.isSymbolicLink()) throw new Error("Существующий пакет мест Astral небезопасен.");
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
  target.resources[PLACES_DLC_TARGET] = resource;
  target.archives[PLACES_DLC_TARGET] = { entries: {} };
  return resource;
}

/**
 * Основа пакета мест сменилась (новая схема хоста), а места стоят на
 * прежней: пакет собирается заново из тех же слоёв поверх новой основы —
 * одной транзакцией с точкой отката, как любая установка: мест не
 * переставляют, их файлы те же (06.10.2026 так менялась основа — данные
 * карты своим архивом, постоянные типы копий мест). Пакет, который сменили
 * мимо движка, не трогается.
 */
export async function refreshPlacesDlcBase({
  targetId = "default",
  stateDir = DEFAULT_DIR,
  host,
  rpfComposer = null,
  signal = null,
  assertRuntimeSafety = null,
  onProgress = null,
}) {
  return serializeMutation(async () => {
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const targetKey = checkedRecordKey(targetId, "Target ID");
    const target = ownRecordValue(current.targets, targetKey);
    const resource = target?.resources?.[PLACES_DLC_TARGET];
    if (!resource?.layers?.length || !host) return { status: "current" };
    const hostHash = await sha256File(host);
    if (resource.compositionBase?.sha256 === hostHash) return { status: "current" };
    if (typeof rpfComposer !== "function") return { status: "no-helper" };
    const livePath = resolveInside(target.gameRoot, PLACES_DLC_TARGET);
    const expected = resource.layers.at(-1)?.sha256;
    if (!expected || !(await exists(livePath)) || (await sha256File(livePath)) !== expected) return { status: "skipped" };
    const next = structuredClone(current);
    const nextTarget = ownRecordValue(next.targets, targetKey);
    const paths = statePaths(stateDir);
    await ensurePlacesDlcResource({ target: nextTarget, targetKey, paths, root: nextTarget.gameRoot, host, signal });
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-refresh");
    const sourcePath = await composeArchiveResource({
      target: nextTarget,
      archiveTarget: PLACES_DLC_TARGET,
      targetKey,
      edition: nextTarget.edition,
      gameRoot: nextTarget.gameRoot,
      paths,
      rpfComposer,
      signal,
      assertRuntimeSafety,
      onProgress,
    });
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-refresh-commit");
    await transact({
      stateDir,
      current,
      next,
      targetId: targetKey,
      affected: [{ relativePath: PLACES_DLC_TARGET, livePath, sourcePath }],
      action: "refresh-places-base",
      signal,
    });
    return { status: "refreshed" };
  });
}
