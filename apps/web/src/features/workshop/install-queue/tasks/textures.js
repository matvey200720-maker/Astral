/*
 * «Ухудшение текстур» в игру (задача 1 ТЗ 05.10.2026): ступень на всю карту
 * — свой пакет дополнения `astral_textures`, один пакет движка на ступень.
 *
 * До 06.10.2026 ступень была слоем набора оптимизации в update.rpf и
 * мылила только две тысячи словарей мода. Такая прежняя ступень узнаётся
 * по набору: первая же установка убирает её из набора и ставит ту же
 * ступень пакетом на всю карту.
 *
 * Запись установки — одна (`OPTIMIZATION_TEXTURES_RECORD_KEY`): мод слоя
 * (`layerModId`), номер ступени, `gray` — ЧБ-мир и `style` — стиль мира
 * (ТЗ 17.10.2026, задача 10): тот же пакет, поверх ступени — стадии стиля и
 * ЧБ (`texture-stages.js`; без ступени — предел `GRAY_WORLD_CAP`, а при
 * `detail` 256 — 256 px в трёх пакетах). «Как в игре» без ЧБ и без стиля её
 * стирает.
 */

import { OPTIMIZATION_TEXTURES_RECORD_KEY } from "@modovik/optimizer/layer-ids.js";
import { TEXTURE_STYLES } from "@modovik/optimizer/texture-style-ids.js";
import {
  TEXTURE_LEVEL_LAYERS,
  TEXTURE_MODEL_BUILD,
  TEXTURE_MODEL_BUILD_SINCE,
  textureLevelAt,
  textureStepOfLayers,
} from "@modovik/optimizer/texture-levels.js";
import { applyOptimizationLayer, planOptimizationLayer } from "../../../../api.js";
import { forgetInstallRecord, readInstallRecord, rememberInstallRecord } from "../../useInstallRecord.js";
import { locateLegacyTarget } from "../game-root.js";
import { installOptimizationSet, installedOptimizationLayers } from "./optimization-set.js";
import { refreshVegetation } from "./recolor.js";
import { humanRouteMessage } from "./rp-update-notes.js";
import { tr } from "../../../../locales/ui.js";

/** Ступень прежним слоем набора (до 06.10.2026); 0 — такого нет. */
export const legacyTextureStep = () => textureStepOfLayers(installedOptimizationLayers());

/** Стоит ли ЧБ-мир: пакет текстур поставлен серым. */
export function installedGrayWorld() {
  const record = readInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY);
  return Boolean(record?.layerModId && record.gray === true);
}

/** Стиль мира, в котором стоит пакет текстур, или `null`. */
export function installedWorldStyle() {
  const record = readInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY);
  return record?.layerModId && TEXTURE_STYLES.includes(record.style) ? record.style : null;
}

/** Чёткость, в которой стоят ЧБ-мир и стиль: 256 или (по умолчанию) 128 px. */
export function installedWorldDetail() {
  const record = readInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY);
  return record?.layerModId && record.detail === 256 ? 256 : 128;
}

/*
 * Сколько словарей и моделей не поместилось в пакеты и осталось как в игре
 * (`note.dictionariesOverBudget` и `modelsOverBudget` движка, в ответе —
 * `leftOut`): `{ dictionaries, models }` или `null`, когда влезло всё.
 */
export function installedWorldLeftOut() {
  const record = readInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY);
  return record?.layerModId ? leftOutOf(record.leftOut) : null;
}

function leftOutOf(value) {
  const count = (number) => (Number.isInteger(number) && number > 0 ? number : 0);
  const dictionaries = count(value?.dictionaries);
  const models = count(value?.models);
  return dictionaries || models ? { dictionaries, models } : null;
}

/** Ступень, что стоит в игре: пакетом или прежним слоем набора. */
export function installedTextureStep() {
  const record = readInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY);
  if (record?.layerModId && Number.isInteger(record.step)) return textureLevelAt(record.step).step;
  return legacyTextureStep();
}

/** Стоит ли ступень прежним слоем набора (её перенесёт первая установка). */
export const textureStepIsLegacy = () => !readInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY)?.layerModId && legacyTextureStep() > 0;

/*
 * Охват ступени: 1 — словари карты (06.10.2026, ночь), 2 — ещё и модели
 * карты со своими текстурами внутри. Ступень, поставленная с меньшим
 * охватом, — «Установить» ставит ту же ступень заново, уже с моделями.
 */
export const TEXTURE_COVERAGE = 2;

/** Стоит ли ступень пакетом прежнего охвата (без моделей карты). */
export function textureStepIsDated() {
  const record = readInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY);
  return Boolean(record?.layerModId && Number.isInteger(record.step) && record.step > 0 && (Number(record.coverage) || 1) < TEXTURE_COVERAGE);
}

/*
 * Сборка моделей, которой собран стоящий пакет (ТЗ 19.10.2026): у записи новых версий окна — `modelBuild` из ответа
 * движка (`textures.modelBuild` манифеста); у записи прежних — по времени установки: сборка 2 появилась в main
 * `TEXTURE_MODEL_BUILD_SINCE`, всё, что ставилось раньше, — сборка 1.
 */
function modelBuildOf(record) {
  if (Number.isInteger(record?.modelBuild) && record.modelBuild > 0) return record.modelBuild;
  const installed = Date.parse(record?.installedAt);
  return Number.isFinite(installed) && installed >= Date.parse(TEXTURE_MODEL_BUILD_SINCE) ? TEXTURE_MODEL_BUILD : 1;
}

/**
 * Стоит ли пакет текстур (ступень, ЧБ-мир или стиль), собранный прежней сборкой моделей. Такие модели хост
 * пересохранял целиком, и игра падала на их столкновениях; новая сборка меняет в файле модели только текстуры.
 * Пересборка — та же установка (`rebuildTextureLook`), без нажатия человека в игру не пишется. Пакет без моделей
 * (или со всеми моделями вне пакета) не затронут.
 */
export function textureModelsAreStale() {
  const record = readInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY);
  if (!record?.layerModId || !standingLook()) return false;
  const models = Number.isInteger(record.models) ? record.models > 0 : (Number(record.coverage) || 1) >= TEXTURE_COVERAGE;
  return models && modelBuildOf(record) < TEXTURE_MODEL_BUILD;
}

/**
 * Поставить ступень (0 — «Как в игре»), ЧБ-мир (`gray`) и стиль мира
 * (`style`, `null` — без стиля); не названо — как стоит. Прежняя ступень из
 * набора уходит тем же движением. `{ result, unchanged? }`.
 */
export async function installTextureStep({ step, gray = installedGrayWorld(), style = installedWorldStyle(), detail = installedWorldDetail(), report = null }) {
  const target = textureLevelAt(step).step;
  const grayWorld = gray === true;
  const worldStyle = TEXTURE_STYLES.includes(style) ? style : null;
  const worldDetail = detail === 256 ? 256 : 128;
  const game = await locateLegacyTarget();
  report?.({ step: "prepare" });
  /* Прежняя ступень — слой набора: набор без неё. Карточки остаются. */
  if (legacyTextureStep()) {
    const layers = [...installedOptimizationLayers()].filter((layerId) => !TEXTURE_LEVEL_LAYERS.includes(layerId));
    await installOptimizationSet({ layers, report, keepTextures: false, refresh: false });
  }
  const plan = await planOptimizationLayer({
    textures: target,
    gray: grayWorld,
    ...(worldStyle ? { style: worldStyle } : {}),
    ...(worldDetail === 256 ? { detail: 256 } : {}),
    gameRoot: game.path,
  });
  const result = await applyOptimizationLayer({ gameRoot: game.path, planId: plan.planId });
  if ((!target && !grayWorld && !worldStyle) || !result?.layerModId) forgetInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY);
  else
    await rememberTextureStep(
      { ...result, step: target, gray: grayWorld, style: worldStyle, detail: worldDetail, cap: result.cap ?? plan.cap, files: result.files ?? plan.files },
      game.path,
      report,
    );
  /* Растительность собирает словари земли поверх ступени: ступень сменилась —
     она собирается заново поверх новой (задача 10). */
  const vegetation = await refreshVegetation("textures", result, report);
  return { result: vegetation ? { ...result, vegetation } : result, unchanged: result?.status === "unchanged" };
}

/**
 * Запись установки ступени. Её пишет и `installTextureStep`, и окно, когда
 * ступень собрал заново главный процесс поверх сменившейся работы
 * (`adoptRebuilt`, задача 3 ТЗ 10.10.2026).
 */
export function rememberTextureStep(result, gameRoot, report = null) {
  return rememberInstallRecord(
    OPTIMIZATION_TEXTURES_RECORD_KEY,
    { layerModId: result.layerModId },
    {
      editor: "optimization-textures",
      step: result.step,
      cap: result.cap,
      coverage: TEXTURE_COVERAGE,
      ...(result.gray === true ? { gray: true } : {}),
      ...(TEXTURE_STYLES.includes(result.style) ? { style: result.style } : {}),
      ...(result.detail === 256 ? { detail: 256 } : {}),
      ...(leftOutOf(result.leftOut) ? { leftOut: leftOutOf(result.leftOut) } : {}),
      /* Сколько моделей карты в пакете и какой они сборки (`textureModelsAreStale`). */
      ...(Number.isInteger(result.models) && result.models > 0 ? { models: result.models } : {}),
      ...(Number.isInteger(result.modelBuild) && result.modelBuild > 0 ? { modelBuild: result.modelBuild } : {}),
      /* Сколько штатного оружия в пакете (задача 35 (б)): пока оно там, скины и стволы мастерской пакет перекрыл бы. */
      ...(Number.isInteger(result.weapons) && result.weapons > 0 ? { weapons: result.weapons } : {}),
      gameRoot,
      files: result.files,
    },
    { report },
  );
}

/* Что стоит пакетом: `{ step, gray, style, detail }` или `null` (ЧБ-мир или стиль без ступени — тоже пакет). */
function standingLook() {
  const saved = readInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY);
  if (!saved?.layerModId || !Number.isInteger(saved.step)) return null;
  const gray = saved.gray === true;
  const style = TEXTURE_STYLES.includes(saved.style) ? saved.style : null;
  return saved.step > 0 || gray || style ? { step: saved.step, gray, style, detail: saved.detail === 256 ? 256 : 128 } : null;
}

/*
 * Работа поставила свои словари или модели карты (фонари кладут свои
 * словари дорог и столбы): стоящая ступень собирается заново поверх них —
 * пакет ступени везёт и модели со своими текстурами, и прежний столб из
 * него перекрыл бы новый. `names` — файлы работы.
 */
export async function refreshTexturesAfterWork(names, report) {
  const look = standingLook();
  if (!look || !(names || []).some((name) => /\.(?:ytd|ydr|ydd|yft)$/i.test(String(name)))) return null;
  return (await installTextureStep({ ...look, report })).result;
}

/*
 * Работа с оружием мастерской встала или снялась (скин ствола, ствол пака,
 * пак каталога; задача 35 (б)): пока Astral Weapons DLC (`order` 100) не было,
 * ступень везла штатное оружие, а пакеты ступени выше (105+) — копия
 * штатного ствола перекрыла бы его скин и модель. Перепись берёт оружие, только
 * пока этого пакета нет, — стоящая ступень с оружием собирается заново без
 * него. Ступени без оружия (запись без `weapons`) пересобирать не нужно.
 * Отказ — словами очереди: работа с оружием уже в игре.
 */
export async function refreshTexturesAfterWeaponWork(report = null) {
  const record = readInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY);
  const look = standingLook();
  if (!look || !(Number(record?.weapons) > 0)) return null;
  try {
    return (await installTextureStep({ ...look, report })).result;
  } catch (error) {
    throw new Error(tr("Оружие встало, но «Ухудшение текстур» не собралось заново без штатного оружия: {0} Нажмите там «Установить» ещё раз.").replace("{0}", humanRouteMessage(error?.message || error)));
  }
}

/* Работы, чьи словари карты ступень мылит в их цвете (дирижабли — ТЗ 11.10.2026, как лого). */
const MAP_WORKS = /^local-legacy-(zones|factory|hangar|mapping|arenas|megamall|youtool|vinewood|busstops|atms|mslzones|floatlogo|airships|shops|billboards|water|lamp-lights|roads)-/;

/*
 * «Библиотека» сняла работы: ступень, собранная поверх их словарей, иначе
 * показывала бы их и дальше (снятый синий Мегамолл — мутным синим).
 * `result` — ответ `removeFromLibrary`.
 */
export async function refreshTexturesAfterRemoval(result, report = null) {
  const look = standingLook();
  if (!look) return null;
  const removed = (result?.mods || []).filter((item) => ["remove", "missing"].includes(item?.action)).map((item) => String(item.modId || ""));
  if (!removed.some((modId) => MAP_WORKS.test(modId))) return null;
  return (await installTextureStep({ ...look, report })).result;
}

/*
 * Набор Astral сменил словари, из которых собрана стоящая ступень
 * (перекрашенный Мегамолл мылится в своём цвете, задача 1): та же ступень
 * собирается заново — из памяти, кроме сменившихся словарей. Возвращает
 * итог установки ступени или `null`, если пересобирать нечего.
 */
export async function refreshTextures(set, result, report) {
  const covered = result?.underTextures;
  if (set === "textures" || !covered?.files) return null;
  const saved = readInstallRecord(OPTIMIZATION_TEXTURES_RECORD_KEY);
  if (!saved?.layerModId || saved.layerModId !== covered.modId || !Number.isInteger(saved.step))
    throw new Error(
      `Набор встал, но ${covered.files} его словарей ухудшает «Ухудшение текстур» — нажмите там «Установить» ещё раз, чтобы ступень собралась поверх новой правки.`,
    );
  try {
    const again = await installTextureStep({
      step: saved.step,
      gray: saved.gray === true,
      style: TEXTURE_STYLES.includes(saved.style) ? saved.style : null,
      detail: saved.detail === 256 ? 256 : 128,
      report,
    });
    return again.result;
  } catch (error) {
    throw new Error(
      `Набор встал, но «Ухудшение текстур» не собралось заново поверх него: ${humanRouteMessage(error?.message || error)} Нажмите там «Установить» ещё раз.`,
    );
  }
}
