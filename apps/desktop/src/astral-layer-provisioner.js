import { prepareAstralLayer } from "@modovik/install-engine";
import { healCarrierHosts } from "@modovik/install-engine/carrier-host-heal.js";
import {
  composeRpfArchive,
  probeRpfArchive,
  provideLegacyDlcList,
  provideUpdateContentXml,
  resolveRpfHelperExecutable,
} from "./rpf-composer.js";
import { ENTRY_MATERIALIZERS } from "./entry-materializers.js";
import {
  movePointsToGame,
  nativeRestorePointsRoot,
} from "./native-restore-chain.js";

/*
 * Подготовка слоя Astral после подтверждения GTA V.
 *
 * Резервная копия update.rpf делается всегда — для неё нужен только диск.
 * Чтение content.xml/dlclist.xml и создание папки x64/astral идут через RPF
 * helper; без него подготовка честно останавливается на копии
 * (`backup-only`) и говорит об этом в ответе, а не притворяется, что реестр
 * проверен и папка создана. Установить мод без helper всё равно невозможно,
 * так что незакрытая проверка чужого слоя ничем не грозит: первая установка
 * повторит её сама.
 */
export async function provisionAstralLayer({
  gameRoot,
  targetId,
  edition,
  stateDir,
  assertRuntimeSafety,
  onProgress = null,
  signal = null,
  layersOverEntries = [],
  keepWorkOver = {},
  force = false,
  /* Набор контейнеров, что на самом деле лежат в носителе `update2.rpf` (сторож носителя, `carriers-start-guard.js`): без него регистрации пишутся по состоянию. */
  carrierPresence = null,
}) {
  const helper = await resolveRpfHelperExecutable().catch(() => null);
  const result = await prepareAstralLayer({
    gameRoot,
    targetId,
    edition,
    stateDir,
    contentXmlProvider: helper ? provideUpdateContentXml : null,
    dlcListProvider: helper ? provideLegacyDlcList : null,
    rpfComposer: helper ? composeRpfArchive : null,
    rpfProbe: helper ? probeRpfArchive : null,
    materializers: ENTRY_MATERIALIZERS,
    assertRuntimeSafety,
    onProgress,
    signal,
    layersOverEntries,
    keepWorkOver,
    force,
    carrierPresence,
  });
  /* Сторож подпакетов (`carriers-start-guard.js`) называет набор по носителям (`Map` цель → `Set` имён): хозяин собирается заново с регистрацией и числом «по факту» (`carrier-host-heal.js`).
     Набор `Set` (сторож update2) или его отсутствие — прежнее поведение, хозяев не трогаем. */
  const hostPresence = helper && typeof carrierPresence === "function" ? await carrierPresence({ target: null }).catch(() => null) : null;
  const hosts = hostPresence instanceof Map
    ? await healCarrierHosts({ targetId, stateDir, presence: hostPresence, rpfComposer: composeRpfArchive, materializers: ENTRY_MATERIALIZERS, signal, assertRuntimeSafety })
    : null;
  /* Игра переехала — точки отката работ мастерской переезжают с ней
     (`moved-target.js` движка, задача 1 ТЗ 10.10.2026). */
  for (const event of result?.reconcile || [])
    if (event?.kind === "game-moved" && process.env.LOCALAPPDATA)
      await movePointsToGame(nativeRestorePointsRoot(), event.from, event.to).catch((error) =>
        console.warn(`[astral] Точки отката не переехали за игрой: ${error?.message || error}`),
      );
  return {
    ...result,
    ...(hosts?.healed.length || hosts?.parked.length ? { carrierHosts: hosts } : {}),
    toolchain: {
      rpfHelper: helper ? "ready" : "missing",
      ...(helper ? {} : { rpfHelperReason: "RPF helper не собран." }),
    },
  };
}
