/*
 * Пакеты дополнения Astral с растительностью: `astral_vegetation`
 * (задача 10, 05.10.2026), `astral_vegetation_b` (задача 4 ТЗ 06.10.2026) и
 * `astral_vegetation_c` (19.11.2026, только у работ на три пакета).
 *
 * «Зелёный Сэнди Шорс» целиком — земля всей загородной карты с её дальними
 * планами, модели земли и трава — это около двух гигабайт словарей игры.
 * В update.rpf их не положить: архив игры держит не больше 4 ГБ (смещения
 * записей RPF7), а у владельца он уже 2,9 ГБ. Мод владельца и сам так не
 * делает: он ставит свои словари пакетом дополнения (`hls_sandy.rpf` с
 * `overlay` в `content.xml`), и игра берёт их вместо своих по имени.
 *
 * Пакет Astral устроен так же:
 *
 *   • `content.xml` — записи `RPF_FILE` с `overlay` на свои потоковые
 *     архивы `astral_vegetation.rpf`, `astral_vegetation_2.rpf`…, набор
 *     изменений в `GROUP_STARTUP` (иначе игра их не монтирует — урок хоста
 *     оружия 04.10.2026);
 *   • `setup2.xml` — `EXTRACONTENT_COMPAT_PACK` с высоким `order`: пакет
 *     грузится после пакетов Rockstar и перекрывает и их файлы (трава
 *     mpheist, patchday1ng, mpapartment — из update.rpf она недостижима);
 *   • `<потоковый архив>/<имя>` — словари, модели и карты работы, по
 *     частям `vegetationStreamOf` (с 05.10.2026; прежние установки — в
 *     одном `astral_vegetation.rpf`);
 *   • файлы сетевой карты (`hei_…` районов mpheist) — в `<пакет>_mp.rpf`,
 *     набор изменений в `GROUP_MAP` (`vegetationArchiveOf`, 12.10.2026).
 *
 * Файлов игры установка не трогает, кроме строки регистрации пакета в
 * dlclist.xml update.rpf. Пакет включён, пока в нём что-то стоит
 * (`direct-dlcs.js`): со снятием растительности регистрация уходит.
 *
 * Основу архива собирает приложение (`apps/desktop/src/vegetation-dlc-host.js`)
 * и передаёт путём `vegetationDlcHost`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  assertNoForeignAstralLayer,
  inspectModsShadow,
  MODS_SHADOW_ARCHIVE,
} from "./astral-layer.js";
import { rebaseDirectUpdateIfNeeded } from "./direct-update-rebase.js";
import { resolveInside, sha256File } from "./manifest.js";
import { ASTRAL_UPDATE_TARGET, composeDirectDlcRegistry } from "./registry-composers.js";
import { ensureArchiveResource } from "./resource-composition.js";
import { exists, missingBaseline } from "./storage-state.js";
import { copyFileCancellable } from "./transaction.js";
import { tracedStep } from "./install-trace.js";
import { fingerprintSha256 } from "./file-fingerprint.js";

export const VEGETATION_DLC_NAME = "astral_vegetation";
export const VEGETATION_DLC_TARGET = "update/x64/dlcpacks/astral_vegetation/dlc.rpf";
export const VEGETATION_DLC_CAPABILITY = "direct-vegetation-dlc-v1";
/* Потоковый архив пакета: его записи игра берёт вместо своих по имени. */
export const VEGETATION_DLC_STREAM = "astral_vegetation.rpf";
/*
 * Второй пакет (задача 4 ТЗ 06.10.2026). Трава обеих зон «Травы по миру» со
 * штатной травой города и загорода при полных текстурах — до шести
 * гигабайт, а архив пакета дополнения держит меньше 4 ГиБ (у Rockstar самый
 * большой — 3,98 ГБ). Файлы делятся между двумя пакетами по имени, как между
 * частями: у каждого пакета — свои четыре потоковых архива.
 */
export const VEGETATION_DLC_B_NAME = "astral_vegetation_b";
export const VEGETATION_DLC_B_TARGET = "update/x64/dlcpacks/astral_vegetation_b/dlc.rpf";
export const VEGETATION_DLC_B_CAPABILITY = "direct-vegetation-dlc-b-v1";

/*
 * Потоковых архивов восемь (четыре — с 05.10.2026, ещё четыре во втором
 * пакете — с 06.10.2026), файл работы попадает в один из них по своему
 * имени. Пустыня целиком с «Реалистичными деревьями» и листвой — два с
 * половиной гигабайта, и одним вложенным архивом они не собирались:
 * RageLib читал вложенный архив больше 2 ГБ счётчиком int и падал на
 * «Offset and length were out of bounds (Parameter 'count')», а как игра
 * прочтёт такой архив, никто не проверял. Части держат каждый архив в
 * пределах гигабайта. По имени — значит, файл всегда в одной и той же
 * части, и пересборка его не перекладывает.
 */
export const VEGETATION_DLC_STREAMS = Object.freeze([
  VEGETATION_DLC_STREAM,
  "astral_vegetation_2.rpf",
  "astral_vegetation_3.rpf",
  "astral_vegetation_4.rpf",
  "astral_vegetation_5.rpf",
  "astral_vegetation_6.rpf",
  "astral_vegetation_7.rpf",
  "astral_vegetation_8.rpf",
]);

/** Пакеты растительности: имя, архив, разрешение манифеста, свои части, устройство и порядок загрузки. */
export const VEGETATION_DLC_PACKS = Object.freeze([
  Object.freeze({
    name: VEGETATION_DLC_NAME,
    target: VEGETATION_DLC_TARGET,
    capability: VEGETATION_DLC_CAPABILITY,
    streams: Object.freeze(VEGETATION_DLC_STREAMS.slice(0, 4)),
    device: "ASTRAL_VEGETATION",
    order: 110,
    owner: "@astral-vegetation-host",
    bases: "vegetation-dlc",
  }),
  Object.freeze({
    name: VEGETATION_DLC_B_NAME,
    target: VEGETATION_DLC_B_TARGET,
    capability: VEGETATION_DLC_B_CAPABILITY,
    streams: Object.freeze(VEGETATION_DLC_STREAMS.slice(4)),
    device: "ASTRAL_VEGETATION_B",
    order: 111,
    owner: "@astral-vegetation-b-host",
    bases: "vegetation-dlc-b",
  }),
]);

/*
 * Третий пакет (19.11.2026, `docs/VEGETATION-THIRD-PACK.md`). «Реалистичные деревья» с обеими зонами «Травы по миру» —
 * до 7,4 ГБ, а два пакета держат по 3,75 ГБ, и делятся файлы между ними по хэшу имени неровно (48 / 52): работа не
 * помещалась, хотя сумма меньше предела двух пакетов. Третий пакет — свои четыре части, 9–12.
 *
 * Два прежних пакета и их основы не меняются. Меняется раскладка: у работы на три пакета файл выбирает одну из
 * двенадцати частей, а не из восьми, — это другая схема манифеста (`vegetation-manifest-trust.js`, схема 5). Работы,
 * что помещаются в два пакета, остаются в прежней раскладке: их id и место файлов те же.
 */
export const VEGETATION_DLC_C_NAME = "astral_vegetation_c";
export const VEGETATION_DLC_C_TARGET = "update/x64/dlcpacks/astral_vegetation_c/dlc.rpf";
export const VEGETATION_DLC_C_CAPABILITY = "direct-vegetation-dlc-c-v1";
export const VEGETATION_DLC_C_STREAMS = Object.freeze([
  "astral_vegetation_9.rpf",
  "astral_vegetation_10.rpf",
  "astral_vegetation_11.rpf",
  "astral_vegetation_12.rpf",
]);
export const VEGETATION_DLC_PACK_C = Object.freeze({
  name: VEGETATION_DLC_C_NAME,
  target: VEGETATION_DLC_C_TARGET,
  capability: VEGETATION_DLC_C_CAPABILITY,
  streams: VEGETATION_DLC_C_STREAMS,
  device: "ASTRAL_VEGETATION_C",
  order: 112,
  owner: "@astral-vegetation-c-host",
  bases: "vegetation-dlc-c",
});

/** Все пакеты, которые растительность вправе занимать: два пакета прежней раскладки и третий. */
export const VEGETATION_DLC_ALL_PACKS = Object.freeze([...VEGETATION_DLC_PACKS, VEGETATION_DLC_PACK_C]);

/** Раскладки: 1 — восемь частей двух пакетов (как было), 2 — двенадцать частей трёх. */
export const VEGETATION_LAYOUT_TWO_PACKS = 1;
export const VEGETATION_LAYOUT_THREE_PACKS = 2;
const LAYOUT_STREAMS = Object.freeze({
  [VEGETATION_LAYOUT_TWO_PACKS]: VEGETATION_DLC_STREAMS,
  [VEGETATION_LAYOUT_THREE_PACKS]: Object.freeze([...VEGETATION_DLC_STREAMS, ...VEGETATION_DLC_C_STREAMS]),
});
const streamsOfLayout = (layout) => LAYOUT_STREAMS[layout] || LAYOUT_STREAMS[VEGETATION_LAYOUT_TWO_PACKS];

/** Пакеты раскладки. */
export const vegetationLayoutPacks = (layout = VEGETATION_LAYOUT_TWO_PACKS) =>
  layout === VEGETATION_LAYOUT_THREE_PACKS ? VEGETATION_DLC_ALL_PACKS : VEGETATION_DLC_PACKS;

/*
 * «В разнобой» (задача 7 ТЗ 17.10.2026): постоянные типы копий деревьев и
 * кустов. Основа первого пакета у работы с разнобоем везёт их пустыми (на
 * них смотрит запрос `DLC_ITYP_REQUEST`), и работа кладёт свои поверх —
 * записи основы, которые слой вправе перекрыть (`upsert`, как у пустых типов
 * пакета мест). Имена — те же, что `VARIETY_TYPES` договора; совпадение
 * держит тест.
 */
export const VEGETATION_VARIETY_TYPES = Object.freeze(["astral_vegmix", "astral_vegmix_2"]);
/* Типы копий лежат там, где их ждёт основа первого пакета, в любой раскладке: часть — как в раскладке 1. */
const PINNED_NAMES = new Set(VEGETATION_VARIETY_TYPES.map((name) => `${name}.ytyp`));

/** Потоковый архив пакета для файла работы (FNV-1a имени строчными) в раскладке `layout`. */
export function vegetationStreamOf(name, layout = VEGETATION_LAYOUT_TWO_PACKS) {
  let hash = 0x811c9dc5;
  const text = String(name).toLowerCase();
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const streams = streamsOfLayout(PINNED_NAMES.has(text) ? VEGETATION_LAYOUT_TWO_PACKS : layout);
  return streams[hash % streams.length];
}

/** Пакет растительности, в котором лежит файл работы в раскладке `layout`. */
export const vegetationPackOf = (name, layout = VEGETATION_LAYOUT_TWO_PACKS) => {
  const stream = vegetationStreamOf(name, layout);
  return VEGETATION_DLC_ALL_PACKS.find((pack) => pack.streams.includes(stream));
};

/*
 * Файлы сетевой карты (проверка в игре 12.10.2026, вслед за провалом у
 * ангара). Город GTA Online и серверов (Majestic, GTA 5 RP) — копии районов
 * из mpheist с именами `hei_…`; их архивы mpheist (и правка
 * `update.rpf:dlc_patch/mpheist`) включает наборами группы `GROUP_MAP`.
 * Пакет ставил свои `hei_` карты и словари на старте игры, раньше mpheist, и
 * в сетевой карте брали верх карты mpheist: у Ла-Месы стояли штатные пальмы
 * вместо деревьев работы, а в Рокфорде, у реки Занкудо, на холмах Вайнвуда и
 * у аэропорта штатные деревья рисовались поверх деревьев работы (кадры
 * стенда `entermp`; пол цел — коллизия в `.ybn`, а их пакет не везёт).
 * Теперь `hei_` файлы (кроме общих пропов `hei_prop_…`) — в архиве
 * `<пакет>_mp.rpf`, его включает второй набор изменений пакета в его
 * `GROUP_MAP` — после mpheist. Архив — обычный `overlay`, как сетевые правки
 * Rockstar (`navmeshes.rpf` у mp2023…mp2026) и как части этого же пакета, а
 * не архив данных карты с `loadCompletely`, как у пакета мест: `hei_` карты
 * растительности — 49 и 56 МБ на пакет, а все такие архивы mpheist вместе —
 * 47 МБ (самый большой 4,4). Пакет файла — прежний (по имени), меняется
 * только архив внутри него.
 */
const MAP_FILE = /^hei_(?!prop_)/i;
/*
 * Правило по игре вместо префикса (26.10.2026): в `<пакет>_mp.rpf` идёт ровно то, что игра включает наборами `GROUP_MAP` штатных пакетов и чего нет в ней нигде
 * больше, — `hei_` районов mpheist и файлы без префикса (словари крон `apa_ch2_*_lod*`, `xm_x17_mountain_*`, травяные карты `apa_ch2_*_grass_*.ymap`, `lr_*`).
 * Всё остальное, даже с префиксом `hei_`, — в части на старте: иначе в сюжете остаётся штатное. `mapNames` — имена строчными из игры игрока
 * (`apps/desktop/src/game-map-names.js`). Префикс `hei_` — только запасное правило, когда игру прочитать нельзя (`mapNames` — `null`).
 */
/** Файл сетевой карты: имя из `mapNames` — архивы `GROUP_MAP`; без списка игры — `hei_…` (кроме пропов). */
export const isVegetationMapFile = (name, mapNames = null) => (mapNames ? mapNames.has(String(name).toLowerCase()) : MAP_FILE.test(String(name)));
/** Имя по правилу `hei_` (запасному): от игры игрока не зависит, по нему считается раскладка `map-group-v1`. */
export const isVegetationHeiFile = (name) => MAP_FILE.test(String(name));
/** Архив сетевой карты пакета. */
export const vegetationMapStreamOf = (pack) => `${pack.name}_mp.rpf`;
/** Архивы пакета, в которые растительность вправе писать. */
export const vegetationArchivesOf = (pack) => [...pack.streams, vegetationMapStreamOf(pack)];

/** Архив внутри пакета для файла работы: часть по имени, файлы сетевой карты — в архив `GROUP_MAP`. */
export const vegetationArchiveOf = (name, mapNames = null, layout = VEGETATION_LAYOUT_TWO_PACKS) =>
  isVegetationMapFile(name, mapNames) ? vegetationMapStreamOf(vegetationPackOf(name, layout)) : vegetationStreamOf(name, layout);

/** Пакет растительности по архиву (`target`) или `null`. */
export const vegetationPackByTarget = (target) =>
  VEGETATION_DLC_ALL_PACKS.find((pack) => pack.target === String(target || "").toLowerCase()) || null;

/**
 * Подготовка к установке растительности в пакет: ресурсы update.rpf (в нём
 * регистрация пакета) и самого пакета. Первая установка включает пакет
 * строкой в dlclist.xml update.rpf — те же проверки, что у прямых записей в
 * update.rpf: игра должна читать свой архив, а сменённый в обход движка
 * архив (небо, мини-карта, прицел) — стать основой, а не пропасть.
 */
async function prepareVegetationPack(
  pack,
  { parsed, target, targetKey, paths, root, host, contentXmlProvider, dlcListProvider, rpfProbe, signal, onProgress },
) {
  if (!parsed.files.some((file) => file.target === pack.target))
    throw new Error("Пакету растительности Astral нечего писать в свой архив.");
  if (!target.directDlcRegistrations?.[pack.name]) {
    const shadow = await inspectModsShadow(root, exists);
    if (shadow.shadowed)
      throw new Error(
        `Игра читает ${MODS_SHADOW_ARCHIVE}, а не свой update.rpf: рядом стоит загрузчик (${[
          ...shadow.hooks,
          ...shadow.plugins,
        ].join(", ")}). Уберите копию архива из папки mods или отключите загрузчик — иначе растительность в игре не появится.`,
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
      await assertNoForeignAstralLayer({
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
  return ensureVegetationPackResource(pack, { target, targetKey, paths, root, host, signal });
}

/**
 * Регистрация пакета в dlclist.xml: один раз, строкой после всех пакетов
 * игры. Возвращает архив, который пересобран, или `null`, если пакет уже
 * был записан.
 */
async function registerVegetationPack(pack, { target, targetKey, paths, dlcListProvider }) {
  target.directDlcRegistrations ||= {};
  if (target.directDlcRegistrations[pack.name]) return null;
  target.directDlcRegistrations[pack.name] = {
    owner: pack.owner,
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
 * (новая версия приложения) — основа обновляется, слои работы остаются и
 * лягут поверх новой при следующей сборке.
 */
async function ensureVegetationPackResource(pack, { target, targetKey, paths, root, host, signal }) {
  if (!host) throw new Error("Основа пакета растительности Astral не подготовлена.");
  const hostStat = await fs.lstat(host);
  if (!hostStat.isFile() || hostStat.isSymbolicLink())
    throw new Error("Основа пакета растительности Astral небезопасна.");
  const hostHash = await tracedStep("хэш основы", () => fingerprintSha256(host));
  const directory = path.join(paths.bases, targetKey, pack.bases);
  const compositionPath = path.join(directory, `${pack.name}.${hostHash.slice(0, 16)}.base.rpf`);
  await fs.mkdir(directory, { recursive: true });
  if (!(await exists(compositionPath)))
    await tracedStep("копия основы", () => copyFileCancellable(host, compositionPath, signal));
  /* «В разнобой»: пустые типы копий основы работа перекрывает (`upsert`). */
  const overlays = vegetationBaseOverlays(pack);
  const compositionBase = { exists: true, path: compositionPath, sha256: hostHash, verified: true, ...(overlays.length ? { overlays } : {}) };
  target.resources ||= {};
  target.archives ||= {};
  const existing = target.resources[pack.target];
  if (existing) {
    if (existing.compositionBase?.sha256 !== hostHash) {
      existing.base = compositionBase;
      existing.compositionBase = compositionBase;
      delete target.archives[pack.target]?.lastBuilt;
    } else if (overlays.length && JSON.stringify(existing.compositionBase.overlays || []) !== JSON.stringify(overlays)) existing.compositionBase.overlays = overlays;
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
    if (!liveStat.isFile() || liveStat.isSymbolicLink())
      throw new Error("Существующий пакет растительности Astral небезопасен.");
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

const [PACK_A, PACK_B] = VEGETATION_DLC_PACKS;

/** Записи основы пакета, которые работа вправе перекрыть: пустые типы копий «В разнобой». */
export const vegetationBaseOverlays = (pack = PACK_A) =>
  VEGETATION_VARIETY_TYPES.map((name) => `${vegetationStreamOf(`${name}.ytyp`)}/${name}.ytyp`).filter((entry) =>
    pack.streams.includes(entry.split("/")[0]),
  );

export const prepareVegetationDlc = (context) => prepareVegetationPack(PACK_A, context);
export const registerVegetationDlc = (context) => registerVegetationPack(PACK_A, context);
export const ensureVegetationDlcResource = (context) => ensureVegetationPackResource(PACK_A, context);
export const prepareVegetationDlcB = (context) => prepareVegetationPack(PACK_B, context);
export const registerVegetationDlcB = (context) => registerVegetationPack(PACK_B, context);
export const ensureVegetationDlcBResource = (context) => ensureVegetationPackResource(PACK_B, context);
export const prepareVegetationDlcC = (context) => prepareVegetationPack(VEGETATION_DLC_PACK_C, context);
export const registerVegetationDlcC = (context) => registerVegetationPack(VEGETATION_DLC_PACK_C, context);
export const ensureVegetationDlcCResource = (context) => ensureVegetationPackResource(VEGETATION_DLC_PACK_C, context);
