import { inspectProfile, uninstallPackage } from "@modovik/install-engine";
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
  const appendInstall = appCatalogAppend({
    stateDir,
    note: (message) => {
      console.warn(`[astral] ${message}`);
      appLog.record({ level: "warn", source: "install", message });
    },
  });
  const result = await uninstallPackage({
    modId,
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
  });
  /* Снят звуковой пак — снимаем и его переопределения стволов; отказ снятие не отменяет. Выключатель установки
     сюда не относится: переопределения, поставленные при включённом выключателе, должны сниматься и после его выключения.
     Без связей пака removePackWeaponVoice ничего не делает. */
  if (gameRoot) {
    const installed = (await inspectProfile({ stateDir }))?.targets?.[targetId]?.installed || [];
    await removePackWeaponVoice({ packId: modId, targetId, gameRoot, stateDir, installed, studio: soundStudio })
      .catch((error) => console.warn(`[astral] Звук стволов пака не снялся: ${error?.message || error}`));
  }
  return result;
}
