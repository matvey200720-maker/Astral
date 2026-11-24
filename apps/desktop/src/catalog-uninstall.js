import { inspectProfile, uninstallPackage, uninstallPackages } from "@modovik/install-engine";
import * as soundStudio from "./sound-studio.js";
import { removePackWeaponVoice } from "./pack-weapon-overrides.js";
import {
  composeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
} from "./rpf-composer.js";
import { uninstallSettingsPackage } from "./settings-package.js";
import { materializeTracerEntry } from "./tracer-composer.js";
import { materializePtfxTextureEntry } from "./ptfx-texture-composer.js";
import { materializeAwcEntry } from "./audio-composer.js";
import { materializeBloodRoutingEntry } from "./bloodfx-composer.js";
import { appReduxTools } from "./redux-install.js";
/* Подмена по умолчанию для установщика («одна запись вместо двух», выключатель `ASTRAL_ENGINE_INSTALL_OPS`). */
import "./ops-install.js";
import { appCatalogAppend } from "./catalog-append.js";
import { appLog } from "./app-log.js";

/*
 * Снятие установленного мода — одна дорога на очередь загрузок и на
 * библиотеку.
 *
 * Мод настроек живёт не в архивах, а в settings.xml со своими слоями, и
 * спрашивается первым: движку про него сказать нечего. Всё остальное снимает
 * движок, и снимает с полным набором сборщиков — трассеры, текстуры PTFX,
 * звук и кровь пересобираются из оставшихся слоёв. Урезанный набор здесь
 * означал бы, что удаление одного мода роняет сборку записи, которую держит
 * другой.
 */
export async function uninstallCatalogMod({
  modId,
  targetId = "default",
  stateDir,
  gameRoot = null,
  settingsPath,
  settingsStateDir,
  signal = null,
  assertRuntimeSafety = null,
  onProgress = null,
}) {
  onProgress?.({
    phase: "checking-settings",
    percent: 10,
    cancellable: false,
  });
  const settingsResult = await uninstallSettingsPackage({
    modId,
    targetId,
    settingsPath,
    stateDir: settingsStateDir,
  });
  if (settingsResult) {
    onProgress?.({ phase: "finalizing", percent: 99, cancellable: false });
    return settingsResult;
  }
  const result = await uninstallPackage({ modId, ...engineOptions({ targetId, stateDir, signal, assertRuntimeSafety, onProgress }) });
  await removeVoiceOf(modId, { targetId, gameRoot, stateDir });
  return result;
}

/* Полный набор сборщиков движка для снятия: один для снятия по одному и пачкой. */
function engineOptions({ targetId, stateDir, signal, assertRuntimeSafety, onProgress }) {
  const appendInstall = appCatalogAppend({
    stateDir,
    note: (message) => {
      console.warn(`[astral] ${message}`);
      appLog.record({ level: "warn", source: "install", message });
    },
  });
  return {
    targetId,
    stateDir,
    rpfComposer: composeRpfArchive,
    contentXmlProvider: provideUpdateContentXml,
    dlcListProvider: provideLegacyDlcList,
    signal,
    assertRuntimeSafety,
    onProgress,
    tracerMaterializer: materializeTracerEntry,
    ptfxTextureMaterializer: materializePtfxTextureEntry,
    awcMaterializer: materializeAwcEntry,
    bloodRoutingMaterializer: materializeBloodRoutingEntry,
    /* Редукс со слоем движка (`redux-install.js`): слой снимается движком, dlc освобождаются. Выключателем не закрыт. */
    reduxRemover: appReduxTools({ stateDir }).reduxRemover,
    /* Дозапись в update.rpf (`catalog-append.js`): снятие последнего дозаписанного мода — откат записи, а не пересборка архива. Выключатель пуст — прежний путь. */
    ...(appendInstall ? { appendInstall } : {}),
  };
}

/* Снят звуковой пак — снимаем и его переопределения стволов; отказ снятие не отменяет. Выключатель установки
   сюда не относится: переопределения, поставленные при включённом выключателе, должны сниматься и после его выключения.
   Без связей пака removePackWeaponVoice ничего не делает. */
async function removeVoiceOf(modId, { targetId, gameRoot, stateDir }) {
  if (!gameRoot) return;
  const installed = (await inspectProfile({ stateDir }))?.targets?.[targetId]?.installed || [];
  await removePackWeaponVoice({ packId: modId, targetId, gameRoot, stateDir, installed, studio: soundStudio })
    .catch((error) => console.warn(`[astral] Звук стволов пака не снялся: ${error?.message || error}`));
}

/*
 * Снятие нескольких модов разом (23.11.2026, «удаление стволов из библиотеки слишком долгое»): моды настроек — каждый своим путём,
 * остальные — ОДНОЙ транзакцией движка (`uninstallPackages`): каждый затронутый архив собирается и подменяется один раз, а не по разу на мод.
 * Пачка всё или ничего; отказала — моды снимаются по одному прежним путём, чтобы один плохой не держал остальных, и отказавшие названы
 * в `failed` (`{ modId, message }`). Снимать больше нечем, чем сказано, — `removed` перечисляет снятых.
 * @returns {Promise<{ removed: string[], failed: { modId: string, message: string }[], batched: boolean }>}
 */
export async function uninstallCatalogMods({ modIds, deps = {}, ...common }) {
  const batchEngine = deps.uninstallPackages || uninstallPackages;
  const uninstallOne = deps.uninstallOne || uninstallCatalogMod;
  const ids = [...new Set((Array.isArray(modIds) ? modIds : []).map(String).filter(Boolean))];
  const removed = [];
  const failed = [];
  const one = async (modId) => {
    try {
      await uninstallOne({ ...common, modId });
      removed.push(modId);
    } catch (error) {
      failed.push({ modId, message: String(error?.message || error) });
    }
  };
  if (ids.length < 2) {
    for (const modId of ids) await one(modId);
    return { removed, failed, batched: false };
  }
  const { targetId = "default", stateDir, gameRoot = null, settingsPath, settingsStateDir, signal = null, assertRuntimeSafety = null, onProgress = null } = common;
  /* Моды настроек живут в settings.xml, а не в архивах: они — первыми и по одному. */
  const engineIds = [];
  onProgress?.({ phase: "checking-settings", percent: 10, cancellable: false });
  for (const modId of ids) {
    let settingsResult = null;
    try {
      settingsResult = await uninstallSettingsPackage({ modId, targetId, settingsPath, stateDir: settingsStateDir });
    } catch (error) {
      failed.push({ modId, message: String(error?.message || error) });
      continue;
    }
    if (settingsResult) removed.push(modId);
    else engineIds.push(modId);
  }
  if (engineIds.length < 2) {
    for (const modId of engineIds) await one(modId);
    return { removed, failed, batched: false };
  }
  try {
    await batchEngine({ modIds: engineIds, ...engineOptions({ targetId, stateDir, signal, assertRuntimeSafety, onProgress }) });
  } catch (error) {
    appLog.record({
      level: "warn",
      source: "install",
      message: `снятие ${engineIds.length} модов одной транзакцией не вышло (${String(error?.message || error).split("\n")[0].slice(0, 200)}): снимаю по одному`,
    });
    for (const modId of engineIds) await one(modId);
    return { removed, failed, batched: false };
  }
  for (const modId of engineIds) {
    removed.push(modId);
    await removeVoiceOf(modId, { targetId, gameRoot, stateDir });
  }
  return { removed, failed, batched: true };
}
