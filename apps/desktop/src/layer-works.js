/*
 * Память работ слоёв и пересборка пакетов поверх (задача 3 ТЗ 10.10.2026).
 *
 * «Растительность», «Дороги» и ступень «Ухудшения текстур» — свои пакеты
 * дополнения над update.rpf, и собраны они ПОВЕРХ файлов других работ:
 * дальних планов мест и воды, словарей земли оптимизации, словарей дорог.
 * Игра берёт файл у пакета выше — работа снизу сменилась, и пакет сверху
 * надо собрать заново, иначе он закрывает её новую правку прежним видом.
 *
 * Раньше это делало окно по своей записи установки в хранилище браузера, а
 * без записи (поставлено другим окном, хранилище сброшено, у сборки
 * разработчика и у релиза оно своё) отказывало: «Набор встал, но 15 его
 * дальних планов закрывает «Растительность» — примените растительность ещё
 * раз». Человек не понимал, что сломалось и почему вода «не встала».
 *
 * Теперь главный процесс сам помнит работу каждого пакета, который ставит
 * (проект, картинки окна, ступень): `<stateDir>/layer-works/<цель>/<набор>.json`.
 * Работа снизу встала — пакет сверху собирается заново в той же операции
 * той же работой, а окно получает итог и переписывает свою запись.
 * Сборщики регистрируют службы, которые эти пакеты ставят (`registerLayerRebuilder`):
 * «Растительность» и «Дороги» — служба наборов, ступень — служба оптимизации.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { styleOfStages } from "@modovik/optimizer/texture-stages.js";

export const LAYER_WORKS_FOLDER = "layer-works";
const SCHEMA = 1;
/* Картинки окна (дороги рисуют свои листы) — до этого размера; больше —
   работа помнится без них, и пересобрать её сможет только окно. */
const MAX_IMAGES_BYTES = 48 * 1024 * 1024;
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/i;

const workFile = (stateDir, targetId, set) => {
  const target = String(targetId || "");
  const name = String(set || "");
  if (!SAFE_NAME.test(name) || !/^[A-Za-z0-9_-]{1,96}$/.test(target)) return null;
  return path.join(stateDir, LAYER_WORKS_FOLDER, target, `${name}.json`);
};

async function atomicWrite(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const stage = `${file}.${randomUUID()}.stage`;
  await fs.writeFile(stage, text, "utf8");
  try {
    await fs.rename(stage, file);
  } catch (error) {
    await fs.rm(stage, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Запомнить работу пакета, который только что встал. `project` — как его
 * получил план (объект), `state` — та же работа строкой записи окна,
 * `images` — картинки, нарисованные окном, `step` — ступень текстур,
 * `stages` — её стадии (стиль мира, ЧБ-мир).
 * Неудача записи установку не роняет: пересобрать поверх сможет окно.
 */
export async function rememberLayerWork({ stateDir, targetId, set, modId, project = null, images = null, state = null, step = null, stages = null, detail = null, over = null }) {
  const file = workFile(stateDir, targetId, set);
  if (!file || !modId) return false;
  let pictures = images && typeof images === "object" ? images : null;
  if (pictures && Buffer.byteLength(JSON.stringify(pictures)) > MAX_IMAGES_BYTES) pictures = null;
  const work = {
    schema: SCHEMA,
    set,
    modId: String(modId),
    savedAt: new Date().toISOString(),
    ...(project && typeof project === "object" ? { project } : {}),
    ...(pictures ? { images: pictures } : {}),
    ...(typeof state === "string" ? { state } : {}),
    ...(Number.isInteger(step) ? { step } : {}),
    /* Стадии ступени текстур (ЧБ-мир, ТЗ 17.10.2026): пересборка — с ними же. */
    ...(Array.isArray(stages) && stages.length ? { stages: stages.map(String) } : {}),
    /* Чёткость мира, если не 128 px (256 — три пакета текстур, ТЗ 17.10.2026, задача 10). */
    ...(Number.isInteger(detail) && detail !== 128 ? { detail } : {}),
    /* Моды каталога, поверх чьих файлов собран пакет (арена, 16.10). */
    ...(Array.isArray(over) && over.length ? { over: over.map(String) } : {}),
  };
  try {
    await atomicWrite(file, JSON.stringify(work));
    return true;
  } catch (error) {
    console.warn(`[astral] Работа «${set}» не запомнилась: ${error?.message || error}`);
    return false;
  }
}

/** Работа пакета набора или `null`. */
export async function readLayerWork({ stateDir, targetId, set }) {
  const file = workFile(stateDir, targetId, set);
  if (!file) return null;
  try {
    const work = JSON.parse(await fs.readFile(file, "utf8"));
    return work?.schema === SCHEMA && work.set === set && typeof work.modId === "string" ? work : null;
  } catch {
    return null;
  }
}

/** Пакет снят — его работа больше не нужна. */
export async function forgetLayerWork({ stateDir, targetId, set }) {
  const file = workFile(stateDir, targetId, set);
  if (file) await fs.rm(file, { force: true }).catch(() => {});
}

/**
 * Корзина библиотеки сняла моды `removed`: работы, что помнились под их id,
 * уходят с диска (с картинками окна они весят до 48 МБ, а собирать по ним
 * больше нечего). Работа другого пакета того же набора остаётся. Сколько ушло.
 */
export async function forgetRemovedWorks({ stateDir, targetId, removed = [] }) {
  const gone = new Set(removed.map(String));
  const folder = workFile(stateDir, targetId, "x") ? path.dirname(workFile(stateDir, targetId, "x")) : null;
  if (!folder || !gone.size) return 0;
  let forgotten = 0;
  for (const name of await fs.readdir(folder).catch(() => [])) {
    if (!name.endsWith(".json")) continue;
    const set = name.slice(0, -".json".length);
    const work = await readLayerWork({ stateDir, targetId, set });
    if (!work || !gone.has(work.modId)) continue;
    await forgetLayerWork({ stateDir, targetId, set });
    forgotten += 1;
  }
  return forgotten;
}

/**
 * «Вернуть GTA V без модов»: в игре нет ни одного пакета Astral, и работы,
 * что помнились под них, больше ни к чему не ведут — иначе пересборка поверх
 * нижней работы подняла бы ЧБ-мир заново. Сколько работ ушло.
 */
export async function forgetAllLayerWorks({ stateDir, targetId }) {
  const probe = workFile(stateDir, targetId, "x");
  if (!probe) return 0;
  const folder = path.dirname(probe);
  let forgotten = 0;
  for (const name of await fs.readdir(folder).catch(() => [])) {
    if (!name.endsWith(".json")) continue;
    await fs.rm(path.join(folder, name), { force: true }).catch(() => {});
    forgotten += 1;
  }
  return forgotten;
}

const rebuilders = new Map();

/**
 * `build(work, { gameRoot, assertRuntimeSafety })` → итог установки пакета
 * (как у «Применить»). Регистрирует служба, которая пакет ставит.
 */
export function registerLayerRebuilder(set, build) {
  if (typeof build !== "function") throw new TypeError("Сборщик пакета должен быть функцией.");
  rebuilders.set(set, build);
  return () => {
    if (rebuilders.get(set) === build) rebuilders.delete(set);
  };
}

/**
 * Заглушки сборщиков (22.11.2026, обратный порядок «трава → дороги»): настоящие сборщики регистрируют ленивые модули каналов (`recolor-ipc.js`, `optimizer-ipc.js`), и пока человек не вызвал их канал,
 * снятие дорог из «Установленного» не находило сборщика травы — трава оставалась с цветом снятых дорог. Заглушка ставится на старте и при первом вызове ЖДЁТ догрузки настоящего модуля
 * (`ensure(set)`), потом зовёт настоящий сборщик, что заменил её в таблице (двойного вызова нет). Не догрузился или не зарегистрировал — ошибка (в `rebuildDependents` она станет `dependentFailures`), а не молчание.
 * Набор, у которого сборщик уже есть, не трогается.
 */
export function installRebuilderStubs(sets, ensure) {
  for (const set of sets) {
    if (rebuilders.has(set)) continue;
    const stub = async (work, context) => {
      await ensure(set);
      const real = rebuilders.get(set);
      if (!real || real === stub) throw new Error(`Сборщик набора «${set}» не подключился: пакет поверх собрать нечем.`);
      return real(work, context);
    };
    rebuilders.set(set, stub);
  }
}

/**
 * Собрать пакет набора `set` заново той же работой, что стоит в игре
 * (`modId` — его пакет сейчас). `null` — собрать нечем: работы нет, она от
 * другого пакета или сборщик не зарегистрирован; тогда это делает окно по
 * своей записи, как раньше.
 */
export async function rebuildLayer(set, { stateDir, targetId, gameRoot, modId, assertRuntimeSafety = null }) {
  const build = rebuilders.get(set);
  if (!build) return null;
  const work = await readLayerWork({ stateDir, targetId, set });
  if (!work || (modId && work.modId !== modId) || (!work.project && !Number.isInteger(work.step))) return null;
  const result = await build(work, { gameRoot, assertRuntimeSafety });
  return result ? { ...result, ...(work.state ? { state: work.state } : {}), ...(Number.isInteger(work.step) ? { step: work.step } : {}), ...(Array.isArray(work.stages) ? { gray: work.stages.includes("grayscale"), style: styleOfStages(work.stages), detail: Number.isInteger(work.detail) ? work.detail : 128 } : {}) } : null;
}

const messageOf = (error) => String(error?.message || error || "неизвестная ошибка");

/**
 * Ступень пересборки пакета поверх работы — окну: `set` (roads / textures / vegetation / arenas), `state` — `start` | `done` | `failed`.
 * Слушатель окну не хозяин: его сбой установку не роняет.
 */
export function announceStage(onStage, set, state) {
  if (typeof onStage !== "function") return;
  try {
    onStage({ set, state });
  } catch {
    /* ход для окна — не часть работы */
  }
}

/**
 * Пакеты поверх работы, что только что встала: `covered` — что ответили
 * `underRoads`, `underTextures`, `underVegetation` (`{ files, modId }`).
 * Порядок — снизу вверх: дороги (103/104), ступень (105), растительность
 * (110); пересборка нижнего сама пересобирает верхние, и второй раз они не
 * собираются. Возвращает итоги (`roads`, `textures`, `vegetation`), то, что
 * собрать нечем (`underRoads`… — окно соберёт по своей записи), и отказы
 * (`dependentFailures`): работа снизу уже стоит, отказ пакета сверху её не
 * отменяет.
 */
export async function rebuildDependents({ stateDir, targetId, gameRoot, covered = {}, assertRuntimeSafety = null, onStage = null }) {
  const out = {};
  const failures = [];
  const step = async (set, info, leftKey) => {
    if (!info?.files) return;
    /* Пересборка пакета поверх — минуты (растительность: ~14 из 23 минут на сильном ПК), и окну надо знать, что идёт именно она (22.11.2026). */
    announceStage(onStage, set, "start");
    try {
      const result = await rebuildLayer(set, { stateDir, targetId, gameRoot, modId: info.modId, assertRuntimeSafety });
      if (result) out[set] = result;
      else out[leftKey] = info;
      announceStage(onStage, set, "done");
    } catch (error) {
      failures.push({ set, files: info.files, message: messageOf(error) });
      announceStage(onStage, set, "failed");
    }
  };
  await step("roads", covered.roads, "underRoads");
  if (!out.roads?.textures) await step("textures", covered.textures, "underTextures");
  if (!out.roads?.vegetation && !out.textures?.vegetation) await step("vegetation", covered.vegetation, "underVegetation");
  return failures.length ? { ...out, dependentFailures: failures } : out;
}

/* Чьи файлы везут пакеты поверх (те же семьи, что у окна в `recolor.js`). */
const UNDER_ROADS = /^local-legacy-(water|lamp-lights)-/;
const UNDER_TEXTURES = /^local-legacy-(zones|factory|hangar|mapping|arenas|megamall|youtool|vinewood|busstops|atms|mslzones|floatlogo|airships|shops|billboards|water|lamp-lights|roads)-/;
const UNDER_VEGETATION = /^local-legacy-(zones|factory|hangar|mapping|arenas|megamall|youtool|vinewood|busstops|atms|mslzones|floatlogo|airships|shops|billboards|water|lamp-lights|textures|opt-set|roads)-/;

/**
 * Корзина библиотеки сняла работы (`removed` — их id), а пакеты поверх
 * собраны и на их файлах: каждый собирается заново уже без них — той же
 * работой, что стоит. `installed` — что стоит после снятия (`[{ modId }]`),
 * `owners` — как узнать пакет набора по id. Окно получает итоги
 * (`rebuilt`) и не собирает их второй раз; собрать нечем — то, что окно
 * соберёт по своей записи, как раньше.
 */
export async function rebuildAfterRemoval({ stateDir, targetId, gameRoot, removed = [], installed = [], owners = {}, assertRuntimeSafety = null, onStage = null }) {
  const gone = removed.map(String);
  const standing = (set) => installed.find((item) => owners[set]?.(item?.modId))?.modId || "";
  const covered = {};
  const want = (set, family) => {
    const modId = standing(set);
    if (modId && !gone.includes(modId) && gone.some((id) => family.test(id))) covered[set] = { files: 1, modId };
  };
  want("roads", UNDER_ROADS);
  want("textures", UNDER_TEXTURES);
  want("vegetation", UNDER_VEGETATION);
  if (!Object.keys(covered).length) return null;
  return rebuildDependents({ stateDir, targetId, gameRoot, covered, assertRuntimeSafety, onStage });
}

/* Файлы арен мастерской (опись обоих серверов): мод каталога с таким файлом
   в update.rpf — основа сборки работы арены. */
let arenaNames = null;
async function arenaFileNames() {
  if (!arenaNames) {
    const { arenaServerInventory } = await import("@modovik/climb-contract/recolor/arenas");
    arenaNames = new Set();
    for (const server of ["gta5rp", "majestic"])
      for (const texture of arenaServerInventory(server)?.textures || []) arenaNames.add(String(texture.file || "").toLowerCase());
  }
  return arenaNames;
}

/**
 * Работа арены собирается поверх поставленного мода арены (16.10): мод
 * поставили — работу надо собрать поверх его файлов, сняли тот, на чьих
 * файлах она собрана, — собрать из игры. `removed` — id снятых модов,
 * `added` — записи поставленных (`{ modId, archiveEntries }`). Работы арены
 * нет или мод её не касается — `null`; иначе итог пересборки.
 */
export async function rebuildArenaOverMods({ stateDir, targetId, gameRoot, removed = [], added = [], assertRuntimeSafety = null, onStage = null }) {
  const work = await readLayerWork({ stateDir, targetId, set: "arenas" });
  if (!work) return null;
  const gone = removed.map(String);
  const names = added.length ? await arenaFileNames() : null;
  const touches = (record) =>
    (record?.archiveEntries || []).some((entry) => {
      if (String(entry?.target || "").toLowerCase() !== "update/update.rpf") return false;
      const place = String(entry?.entry || "").toLowerCase();
      return /^x64\/astral\/[a-z0-9_]+\.rpf\/[^/]+$/.test(place) && names.has(place.split("/").pop());
    });
  const hit = (work.over || []).some((modId) => gone.includes(modId)) || added.some(touches);
  if (!hit) return null;
  announceStage(onStage, "arenas", "start");
  try {
    return await rebuildLayer("arenas", { stateDir, targetId, gameRoot, modId: work.modId, assertRuntimeSafety });
  } finally {
    announceStage(onStage, "arenas", "done");
  }
}
