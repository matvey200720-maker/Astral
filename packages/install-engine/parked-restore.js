/*
 * «Установить снова» после проверки файлов игры (задача 2 ТЗ 10.10.2026).
 *
 * Моды, которые проверка файлов (или обновление игры, или лаунчер проекта)
 * вынула из игры, лежат в «снятых» (`parked-mods.js`) со всеми своими
 * слоями. Здесь они возвращаются одной операцией: слои — под тем, что
 * поставлено после проверки, пакеты DLC — снова в dlclist.xml, архивы
 * собираются поверх нынешней игры и подменяются одной транзакцией, как у
 * обычной установки. Мод, чьих файлов в хранилище не осталось, снимается
 * сборкой (`dropLostLayers`) и называется в ответе — его ставят из каталога
 * заново.
 */

import { LIVE_CARRIER_TARGETS } from "./carrier-targets.js";
import {
  addCarrierRegistryArchive,
  composeAstralContentRegistry,
  composeDirectDlcRegistry,
  isAstralUpdateTarget,
  touchesCarrierRegistry,
} from "./registry-composers.js";
import { composeArchiveResource } from "./resource-composition.js";
import { rebaseDirectUpdateIfNeeded } from "./direct-update-rebase.js";
import { rebasableArchive, rebaseArchiveIfNeeded } from "./archive-rebase.js";
import { readState, serializeMutation } from "./engine-state.js";
import { checkedRecordKey, ownRecordValue } from "./state-record.js";
import { activeBaselinePath, DEFAULT_DIR, statePaths } from "./storage-state.js";
import { recoverPendingTransactions, transact } from "./transactions.js";
import { resolveInside } from "./manifest.js";
import { assertRuntimeSafe, throwIfAborted } from "./runtime-guard.js";
import { unparkMods } from "./parked-mods.js";
import { movesAudioSlotLayer, settleAudioSlotLayer } from "./audio-slot-layer.js";
import { orderForCarriers } from "./carrier-order.js";
import { addSubpackHostArchives } from "./subpack-closure.js";

const UPDATE_ARCHIVE = "update/update.rpf";

/*
 * Запись переигрывания снятого мода (`engineReplay`, шаг 3 ядра фазы 7): только когда
 * восстанавливается ровно один мод, поставленный движком, и его архив — update.rpf. Иначе — прежний путь.
 */
function engineReplayOf(target, restored, archives, engineRestore) {
  const names = [...archives];
  if (restored.length !== 1) return null;
  const record = (target.installed || []).find((item) => item?.modId === restored[0]);
  const replay = record?.engineReplay && typeof record.engineReplay === "object" ? record.engineReplay : null;
  /* Один архив — только update.rpf; многоархивная запись (`multi`) — свои архивы точки. */
  if (replay && replay.multi !== true && (names.length !== 1 || names[0].toLowerCase() !== UPDATE_ARCHIVE)) return null;
  /* Модуль записи без флага — прежний путь: переигрывать его движком не надо. */
  if (replay && typeof engineRestore.accepts === "function" && !engineRestore.accepts(replay)) return null;
  return replay;
}

/*
 * `engineRestore` — `{ install, pointsRoot, verify(replay) }` (за флагом модуля): `verify` проверяет
 * постоянный пакет до первой записи и называет работу при отказе; `install` — `compose-rpf` с блоком
 * `install` (`rpf-composer.js`). Без него — прежний путь.
 */
export async function restoreParkedMods({
  targetId = "default",
  stateDir = DEFAULT_DIR,
  modIds = null,
  rpfComposer = null,
  contentXmlProvider = null,
  dlcListProvider = null,
  signal = null,
  assertRuntimeSafety = null,
  onProgress = null,
  engineRestore = null,
  ...materializers
}) {
  return serializeMutation(async () => {
    onProgress?.({ phase: "prepare", percent: 6, cancellable: true });
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-restore-parked");
    await recoverPendingTransactions({ stateDir });
    const current = await readState(stateDir);
    const next = structuredClone(current);
    const targetKey = checkedRecordKey(targetId, "Target ID");
    const target = ownRecordValue(next.targets, targetKey);
    if (!target) throw new Error("Игровой профиль не найден.");
    if (target.vanillaGuard && target.vanillaGuard.phase !== "restored")
      throw new Error("Сначала завершите сеанс Vanilla Guard и восстановите профиль.");
    const { restored, archives, dlcs } = unparkMods(target, { modIds });
    if (!restored.length) return { state: current, restored: [], lost: [] };
    /* Человек сам попросил вернуть моды: игра больше не держится штатной (`stock-hold.js`). */
    delete target.stockHold;
    /* Проверка пакета — до первой записи (ребейз ниже может писать в игру): отказ называет работу. */
    const replay = engineRestore ? engineReplayOf(target, restored, archives, engineRestore) : null;
    if (replay) {
      if (typeof engineRestore.install !== "function" || !engineRestore.pointsRoot)
        throw new Error("Переигрывание движком: нужны функция установки и корень точек.");
      await engineRestore.verify(replay);
    }
    const engineInstall = replay
      ? { install: engineRestore.install, edition: target.edition, gameRoot: target.gameRoot, pointsRoot: engineRestore.pointsRoot, replay, multi: replay.multi === true }
      : null;
    const paths = statePaths(stateDir);
    const affected = new Set();
    /* Основы — по нынешней игре; «снятые» здесь возвращаются нарочно. */
    for (const archiveTarget of archives) {
      throwIfAborted(signal);
      if (archiveTarget.toLowerCase() === UPDATE_ARCHIVE)
        await rebaseDirectUpdateIfNeeded({
          target,
          root: target.gameRoot,
          paths,
          targetKey,
          contentXmlProvider,
          dlcListProvider,
          signal,
          parkRestored: false,
        });
      else if (rebasableArchive(archiveTarget))
        await rebaseArchiveIfNeeded({ target, archiveTarget, paths, targetKey, signal, parkRestored: false });
      if (target.archives?.[archiveTarget]) affected.add(archiveTarget);
    }
    /*
     * Работа в форме пакета дополнения (дороги, растительность, текстуры, места, звук ствола): её архив — сам пакет, update.rpf среди `archives` нет, но регистрация пакета в `dlclist.xml` собирает update.rpf ниже из основы
     * (`composeDirectDlcRegistry`). Без перебазирования сборка шла бы из прежней основы и стирала правки мастерской, сделанные после проверки файлов (Г2, К4, 22.11.2026). Вызов тот же, что в цикле выше: после `unparkMods`
     * (слои возвращаемых работ уже в состоянии — их записи в живом архиве не уйдут в основу как чужие) и с `parkRestored: false` (в живом архиве после проверки файлов нашего нет, и перебазирование решило бы «Astral ушёл» и тут же
     * запарковало бы только что возвращённые работы).
     */
    if (dlcs.length && target.archives?.[UPDATE_ARCHIVE] && ![...archives].some((archiveTarget) => archiveTarget.toLowerCase() === UPDATE_ARCHIVE))
      await rebaseDirectUpdateIfNeeded({ target, root: target.gameRoot, paths, targetKey, contentXmlProvider, dlcListProvider, signal, parkRestored: false });
    /*
     * Вернулась работа с контейнером в носителе (`update2.rpf`, К4б, 22.11.2026): регистрация контейнера — строка в `content.xml` внутри update.rpf, поэтому update.rpf собирается вместе с носителем
     * (`addCarrierRegistryArchive`, как при установке и снятии), а перебазирование идёт до сборки. Раньше возвращённый контейнер лежал в носителе без регистрации, игра его не видела. Вызов и флаг те же, что в цикле выше.
     */
    if (touchesCarrierRegistry(target, affected)) {
      if (![...archives].some((archiveTarget) => archiveTarget.toLowerCase() === UPDATE_ARCHIVE))
        await rebaseDirectUpdateIfNeeded({ target, root: target.gameRoot, paths, targetKey, contentXmlProvider, dlcListProvider, signal, parkRestored: false });
      addCarrierRegistryArchive(target, affected);
    }
    /* Вернулся пак звуков со слотом памяти: слой слотов пересчитается ниже (`settleAudioSlotLayer`) и соберёт update.rpf из основы, поэтому основа вбирает правки мастерской до пересчёта (К3, 22.11.2026). Условие — по слоям
       вернувшихся работ, в состоянии они уже лежат (`unparkMods`); вызов и флаг те же, что в цикле выше. */
    if (
      typeof contentXmlProvider === "function" &&
      target.archives?.[UPDATE_ARCHIVE] &&
      ![...archives].some((archiveTarget) => archiveTarget.toLowerCase() === UPDATE_ARCHIVE) &&
      (target.installed || []).some((item) => restored.includes(item?.modId) && movesAudioSlotLayer(target, item))
    )
      await rebaseDirectUpdateIfNeeded({ target, root: target.gameRoot, paths, targetKey, contentXmlProvider, dlcListProvider, signal, parkRestored: false });
    /* Вернулась работа с контейнером в подпакете штатного пакета (`dlc<N>.rpf`): регистрация и число подпакетов лежат в архиве хозяина — он пересобирается вместе (`subpack-closure.js`). */
    await addSubpackHostArchives({ target, archives: affected, root: target.gameRoot, paths, targetKey, signal, onProgress });
    /* Вернулся пак звуков оружия: слот памяти звука поднимается под его банк до сборки банка (`audio-slot-layer.js`). */
    if (await settleAudioSlotLayer({ audioSlotSettler: materializers.audioSlotSettler, target, targetKey, paths, signal, onProgress })) affected.add(UPDATE_ARCHIVE);
    onProgress?.({ phase: "compose", percent: 40, cancellable: true });
    if (dlcs.length && target.archives?.[UPDATE_ARCHIVE]) {
      await composeDirectDlcRegistry({ target, targetKey, paths, dlcListProvider, archiveTarget: UPDATE_ARCHIVE });
      affected.add(UPDATE_ARCHIVE);
    }
    for (const archiveTarget of affected) {
      throwIfAborted(signal);
      if (isAstralUpdateTarget(archiveTarget))
        await composeAstralContentRegistry({ target, targetKey, paths, contentXmlProvider, archiveTarget, carrierWriting: new Set([...affected].filter((archive) => LIVE_CARRIER_TARGETS.includes(archive))) });
      await composeArchiveResource({
        target,
        archiveTarget,
        targetKey,
        edition: target.edition,
        gameRoot: target.gameRoot,
        paths,
        rpfComposer,
        signal,
        assertRuntimeSafety,
        onProgress,
        ...materializers,
      });
    }
    const files = [...affected].map((relativePath) => {
      const resource = target.resources[relativePath];
      return {
        relativePath,
        livePath: resolveInside(target.gameRoot, relativePath),
        sourcePath: resource?.layers?.at(-1)?.cachePath || activeBaselinePath(target, resource),
      };
    });
    onProgress?.({ phase: "ready-to-commit", percent: 90, cancellable: true });
    await assertRuntimeSafe(assertRuntimeSafety, signal, "before-restore-parked-commit");
    onProgress?.({ phase: "commit", percent: 94, cancellable: false });
    const state = await transact({
      stateDir,
      current,
      next,
      targetId: targetKey,
      affected: orderForCarriers(files, "install"),
      action: "restore-parked",
      signal,
      engineInstall,
    });
    const installed = new Set((ownRecordValue(state.targets, targetKey)?.installed || []).map((item) => item?.modId));
    onProgress?.({ phase: "finalizing", percent: 99, cancellable: false });
    return {
      state,
      restored: restored.filter((modId) => installed.has(modId)),
      lost: restored.filter((modId) => !installed.has(modId)),
    };
  });
}
