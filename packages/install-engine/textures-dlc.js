/*
 * Пакет дополнения Astral с ухудшенными текстурами карты: `astral_textures`
 * (задача 1 ТЗ 05.10.2026).
 *
 * «Ухудшение текстур» на всю карту — около двадцати тысяч словарей игры:
 * город, загород, земля, дороги, здания, предметы и их дальние планы (LOD,
 * SLOD1…3). Ступень 128 px на всю карту — около гигабайта; в update.rpf
 * (у владельца 2,9 ГБ при пределе 4 ГБ) её не положить, а словари из
 * пакетов Rockstar (дороги `patchday2ng`, остров, казино…) из update.rpf и
 * не перекрыть: пакеты грузятся после него. Мод `retexture.rpf` устроен так
 * же — плоский архив словарей под их именами, игра берёт их вместо своих.
 *
 * Пакет Astral устроен как пакет растительности (`vegetation-dlc.js`):
 *
 *   • `content.xml` — записи `RPF_FILE` с `overlay` на потоковые архивы
 *     `astral_textures.rpf`, `astral_textures_2.rpf`…, набор изменений в
 *     `GROUP_STARTUP` (иначе игра их не монтирует — урок хоста оружия);
 *   • `setup2.xml` — `EXTRACONTENT_COMPAT_PACK`, `order` 105: выше всех
 *     пакетов Rockstar (у них до 57), ниже растительности (110) — она
 *     собирается поверх ухудшенных словарей и перекрывает их своими;
 *   • `<потоковый архив>/<имя>.ytd` — словари ступени, и `<имя>.ydr|ydd|yft`
 *     — модели карты со своими текстурами внутри, по частям
 *     `texturesStreamOf` (по имени — файл всегда в одной части).
 *
 * Файлов игры установка не трогает, кроме строки регистрации пакета в
 * dlclist.xml update.rpf. Пакет включён, пока в нём что-то стоит
 * (`direct-dlcs.js`): со снятием ступени регистрация уходит.
 *
 * Основу архива собирает приложение (`apps/desktop/src/textures-dlc-host.js`)
 * и передаёт путём `texturesDlcHost`.
 *
 * Второй пакет `astral_textures_b` (ТЗ 17.10.2026, задача 10): ЧБ-мир
 * красит и модели карты со своими текстурами, а все они с серыми словарями
 * в один пакет не помещаются (4,6 ГиБ на 128 px при пределе 3,6). Модели,
 * что не влезли в первый, едут во второй — своими потоковыми архивами
 * `astral_textures_b.rpf`, `astral_textures_b_2.rpf`…, `order` 106 (выше
 * первого, ниже мест и растительности). Основа второго — `texturesDlcBHost`.
 * Одна установка — один манифест на оба пакета, как у дорог.
 *
 * Третий пакет `astral_textures_c` (ТЗ 17.10.2026, задача 10: чёткость 256 px
 * для ЧБ-мира и стилей): мир целиком на 256 px — около 9,3 ГиБ (замер на игре
 * владельца: словари 4,1, модели 5,3), а пакет держит 3,45. Он ложится в три
 * пакета: словари — в первый и, сколько не влезло, во второй (3,4 тысячи),
 * модели — в оставшееся место и в третий. Поэтому второй и третий пакеты
 * принимают и словари, и модели — но только по возможности
 * `direct-textures-detail-v1` (`TEXTURES_DLC_DETAIL_CAPABILITY`); `order`
 * третьего — 108 (выше мест, ниже растительности). Файлы у пакета мест (107) с
 * игровыми именами — банкоматы, остановки, здания завода, парковка, — и будь
 * такой файл в третьем пакете, серый или стилизованный банкомат перекрыл бы
 * покраску человека; правило проекта — места главнее ступеней текстур
 * (`docs/RECOLOR.md`). Свободного `order` ниже 107 нет (100–106 заняты), а общий
 * `order` у двух дополнений в игре не проверен, поэтому порядок не трогаем:
 * файлы с именами, которые может везти пакет мест (`isCarriedByPlaces`,
 * `recolor-manifest-trust.js`), в третий не кладутся (`texture-levels.js`) и
 * его манифест их не принимает (`textures-manifest-trust.js`). В первом и
 * втором (105, 106) такие файлы можно — место перекрывает их само. Растительность
 * (110) главнее всех.
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

export const TEXTURES_DLC_NAME = "astral_textures";
export const TEXTURES_DLC_TARGET = "update/x64/dlcpacks/astral_textures/dlc.rpf";
export const TEXTURES_DLC_CAPABILITY = "direct-textures-dlc-v1";
/* Порядок пакета: выше Rockstar, ниже растительности (`vegetation-dlc-host.js`). */
export const TEXTURES_DLC_ORDER = 105;

/*
 * Потоковых архивов сорок восемь. Держит их не вес, а имена: в RPF7
 * смещение имени записи — 16 бит, и имена одного архива не длиннее 64 КБ.
 * Двадцать тысяч словарей карты — около 480 КБ имён (в четырёх частях
 * архив выходил битым: запись не находилась после сборки); с моделями,
 * несущими свои текстуры, — ещё двадцать с лишним тысяч имён, около
 * мегабайта на всё, по 20–25 КБ на часть.
 */
export const TEXTURES_DLC_STREAMS = Object.freeze(
  Array.from({ length: 48 }, (_, index) => (index ? `astral_textures_${index + 1}.rpf` : "astral_textures.rpf")),
);
/** Предел имён одной части, байт (с запасом от 64 КБ таблицы имён RPF7). */
export const TEXTURES_STREAM_NAME_BYTES = 60000;
/*
 * Предел веса пакета. Самый большой пакет Rockstar у владельца
 * (`mpbattle`) — 3,98 ГБ; пакет Astral держится ниже: 3 600 МиБ. Словари
 * ступени 128 px — 1,2 ГБ, модели со своими текстурами — до трёх: что не
 * влезло, остаётся как в игре (`texture-levels.js` отбирает по пользе).
 */
export const TEXTURES_DLC_MAX_BYTES = 3600 * 1024 * 1024;

/** Потоковый архив пакета для словаря (FNV-1a имени строчными). */
export function texturesStreamOf(name) {
  let hash = 0x811c9dc5;
  const text = String(name).toLowerCase();
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return TEXTURES_DLC_STREAMS[hash % TEXTURES_DLC_STREAMS.length];
}
const TEXTURES_DLC_OWNER = "@astral-textures-host";

export const TEXTURES_DLC_B_NAME = "astral_textures_b";
export const TEXTURES_DLC_B_TARGET = "update/x64/dlcpacks/astral_textures_b/dlc.rpf";
export const TEXTURES_DLC_B_CAPABILITY = "direct-textures-dlc-b-v1";
export const TEXTURES_DLC_B_ORDER = 106;
/* Имена моделей второго пакета — до 9 тысяч, около 250 КБ: шестнадцать частей. */
export const TEXTURES_DLC_B_STREAMS = Object.freeze(
  Array.from({ length: 16 }, (_, index) => (index ? `astral_textures_b_${index + 1}.rpf` : "astral_textures_b.rpf")),
);

/** Потоковый архив второго пакета для модели (FNV-1a имени строчными). */
export function texturesStreamBOf(name) {
  let hash = 0x811c9dc5;
  const text = String(name).toLowerCase();
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return TEXTURES_DLC_B_STREAMS[hash % TEXTURES_DLC_B_STREAMS.length];
}

/*
 * Чёткость 256 px — своя возможность манифеста: только с ней словари едут во
 * второй и третий пакеты и открывается третий. У прежнего манифеста ЧБ-мира
 * (128 px) её нет, и его второй пакет по-прежнему принимает одни модели.
 */
export const TEXTURES_DLC_DETAIL_CAPABILITY = "direct-textures-detail-v1";

export const TEXTURES_DLC_C_NAME = "astral_textures_c";
export const TEXTURES_DLC_C_TARGET = "update/x64/dlcpacks/astral_textures_c/dlc.rpf";
export const TEXTURES_DLC_C_CAPABILITY = "direct-textures-dlc-c-v1";
/* Выше мест (107): поэтому файлы с именами пакета мест сюда не кладут — см. заголовок файла. */
export const TEXTURES_DLC_C_ORDER = 108;
/* Имена третьего пакета — до 13 тысяч, около 360 КБ: шестнадцать частей. */
export const TEXTURES_DLC_C_STREAMS = Object.freeze(
  Array.from({ length: 16 }, (_, index) => (index ? `astral_textures_c_${index + 1}.rpf` : "astral_textures_c.rpf")),
);

/** Потоковый архив третьего пакета для словаря или модели (FNV-1a имени строчными). */
export function texturesStreamCOf(name) {
  let hash = 0x811c9dc5;
  const text = String(name).toLowerCase();
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return TEXTURES_DLC_C_STREAMS[hash % TEXTURES_DLC_C_STREAMS.length];
}

/*
 * Пакеты текстур: первый — словари и модели, что влезли; второй и третий —
 * остальное (при 128 px — только второй и только модели, при 256 px — оба,
 * словари и модели). `bases` — папка основы в кэше движка.
 */
export const TEXTURES_DLC_PACKS = Object.freeze([
  Object.freeze({
    id: "a",
    name: TEXTURES_DLC_NAME,
    target: TEXTURES_DLC_TARGET,
    capability: TEXTURES_DLC_CAPABILITY,
    streams: TEXTURES_DLC_STREAMS,
    streamOf: texturesStreamOf,
    device: "ASTRAL_TEXTURES",
    order: TEXTURES_DLC_ORDER,
    owner: TEXTURES_DLC_OWNER,
    bases: "textures-dlc",
  }),
  Object.freeze({
    id: "b",
    name: TEXTURES_DLC_B_NAME,
    target: TEXTURES_DLC_B_TARGET,
    capability: TEXTURES_DLC_B_CAPABILITY,
    streams: TEXTURES_DLC_B_STREAMS,
    streamOf: texturesStreamBOf,
    device: "ASTRAL_TEXTURES_B",
    order: TEXTURES_DLC_B_ORDER,
    owner: "@astral-textures-b-host",
    bases: "textures-dlc-b",
  }),
  Object.freeze({
    id: "c",
    name: TEXTURES_DLC_C_NAME,
    target: TEXTURES_DLC_C_TARGET,
    capability: TEXTURES_DLC_C_CAPABILITY,
    streams: TEXTURES_DLC_C_STREAMS,
    streamOf: texturesStreamCOf,
    device: "ASTRAL_TEXTURES_C",
    order: TEXTURES_DLC_C_ORDER,
    owner: "@astral-textures-c-host",
    bases: "textures-dlc-c",
  }),
]);

/** Пакет текстур по букве (`a` — по умолчанию) или по архиву. */
export const texturesPackOf = (id = "a") => TEXTURES_DLC_PACKS.find((pack) => pack.id === (id || "a")) || null;
export const texturesPackByTarget = (target) =>
  TEXTURES_DLC_PACKS.find((pack) => pack.target === String(target || "").toLowerCase()) || null;

/**
 * Подготовка к установке ступени в пакет: ресурсы update.rpf (в нём
 * регистрация пакета) и самого пакета. Первая установка включает пакет
 * строкой в dlclist.xml update.rpf — те же проверки, что у растительности.
 */
async function prepareTexturesPack(pack, {
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
  if (!parsed.files.some((file) => file.target === pack.target))
    throw new Error("Пакету текстур Astral нечего писать в свой архив.");
  /* Следы прежней установки Astral в архиве (задача 1 ТЗ 10.10.2026). */
  let traces = null;
  if (!target.directDlcRegistrations?.[pack.name]) {
    const shadow = await inspectModsShadow(root, exists);
    if (shadow.shadowed)
      throw new Error(
        `Игра читает ${MODS_SHADOW_ARCHIVE}, а не свой update.rpf: рядом стоит загрузчик (${[
          ...shadow.hooks,
          ...shadow.plugins,
        ].join(", ")}). Уберите копию архива из папки mods или отключите загрузчик — иначе ухудшение текстур в игре не появится.`,
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
  return ensureTexturesPackResource(pack, { target, targetKey, paths, root, host, signal });
}

/**
 * Регистрация пакета в dlclist.xml: один раз. Возвращает архив, который
 * пересобран, или `null`, если пакет уже был записан.
 */
async function registerTexturesPack(pack, { target, targetKey, paths, dlcListProvider }) {
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
 * (новая версия приложения) — основа обновляется, слой ступени остаётся и
 * ляжет поверх новой при следующей сборке.
 */
async function ensureTexturesPackResource(pack, { target, targetKey, paths, root, host, signal }) {
  if (!host) throw new Error("Основа пакета текстур Astral не подготовлена.");
  const hostStat = await fs.lstat(host);
  if (!hostStat.isFile() || hostStat.isSymbolicLink()) throw new Error("Основа пакета текстур Astral небезопасна.");
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
    if (!liveStat.isFile() || liveStat.isSymbolicLink()) throw new Error("Существующий пакет текстур Astral небезопасен.");
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

const [PACK_A, PACK_B, PACK_C] = TEXTURES_DLC_PACKS;
export const prepareTexturesDlc = (context) => prepareTexturesPack(PACK_A, context);
export const registerTexturesDlc = (context) => registerTexturesPack(PACK_A, context);
export const ensureTexturesDlcResource = (context) => ensureTexturesPackResource(PACK_A, context);
export const prepareTexturesDlcB = (context) => prepareTexturesPack(PACK_B, context);
export const registerTexturesDlcB = (context) => registerTexturesPack(PACK_B, context);
export const ensureTexturesDlcBResource = (context) => ensureTexturesPackResource(PACK_B, context);
export const prepareTexturesDlcC = (context) => prepareTexturesPack(PACK_C, context);
export const registerTexturesDlcC = (context) => registerTexturesPack(PACK_C, context);
export const ensureTexturesDlcCResource = (context) => ensureTexturesPackResource(PACK_C, context);
