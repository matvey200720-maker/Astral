/*
 * IPC студии звука. Списки банков, превью и сессия ничего не пишут в игру —
 * проверкой запущенной GTA V обложены только применение и снятие слоя.
 * Вынесено из main.js тем же приёмом, что редактор интерьеров: девять
 * обработчиков одного модуля не должны раздувать входной файл приложения.
 *
 * Обвязка принимается той же, что у воды, неба и растительности
 * (`installOptions` + готовый `runtimeGuard`): своя форма зависимостей стоила
 * бы в main.js девяти строк вместо трёх и одного лишнего способа собрать
 * предохранитель.
 */

import {
  applyHitSounds,
  applySoundCustomization,
  applySoundMix,
  applyWeaponSound,
  beginSoundSession,
  endSoundSession,
  listSoundBanks,
  listSoundWorks,
  planHitSounds,
  planSoundCustomization,
  planSoundMix,
  planWeaponSound,
  readHitSoundBudget,
  readSoundBank,
  readSoundBankProfile,
  readSoundStream,
  readWeaponShot,
  removeSoundCustomization,
  stageSoundWav,
} from "./sound-studio.js";

export function registerSoundStudioIpc({
  IPC,
  handleIpc,
  trusted,
  safeInput,
  nativeContext,
  installOptions,
  runtimeGuard,
}) {
  const plain = (channel, handler) =>
    handleIpc(channel, (event, input) =>
      trusted(event, async () => {
        const storage = await installOptions();
        return handler(safeInput(input), nativeContext(), storage.stateDir);
      }),
    );
  const guarded = (channel, handler) =>
    handleIpc(channel, (event, input) =>
      trusted(event, async () => {
        const storage = await installOptions();
        return handler(
          safeInput(input),
          nativeContext(),
          storage.stateDir,
          runtimeGuard,
        );
      }),
    );

  plain(IPC.WORKSHOP_SOUND_BANKS, listSoundBanks);
  plain(IPC.WORKSHOP_SOUND_STREAM, readSoundStream);
  plain(IPC.WORKSHOP_SOUND_SHOT, readWeaponShot);
  plain(IPC.WORKSHOP_SOUND_BANK, readSoundBank);
  plain(IPC.WORKSHOP_SOUND_PROFILE, readSoundBankProfile);
  plain(IPC.WORKSHOP_SOUND_BEGIN, beginSoundSession);
  plain(IPC.WORKSHOP_SOUND_STAGE, stageSoundWav);
  plain(IPC.WORKSHOP_SOUND_END, endSoundSession);
  plain(IPC.WORKSHOP_SOUND_PLAN, planSoundCustomization);
  plain(IPC.WORKSHOP_SOUND_WORKS, listSoundWorks);
  plain(IPC.WORKSHOP_SOUND_HITS_BUDGET, readHitSoundBudget);
  plain(IPC.WORKSHOP_SOUND_HITS_PLAN, planHitSounds);
  plain(IPC.WORKSHOP_SOUND_WEAPON_PLAN, planWeaponSound);
  plain(IPC.WORKSHOP_SOUND_MIX_PLAN, planSoundMix);
  guarded(IPC.WORKSHOP_SOUND_APPLY, applySoundCustomization);
  guarded(IPC.WORKSHOP_SOUND_HITS_APPLY, applyHitSounds);
  guarded(IPC.WORKSHOP_SOUND_WEAPON_APPLY, applyWeaponSound);
  guarded(IPC.WORKSHOP_SOUND_MIX_APPLY, applySoundMix);
  guarded(IPC.WORKSHOP_SOUND_REMOVE, removeSoundCustomization);
}
