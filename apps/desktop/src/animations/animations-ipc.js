/*
 * Каналы окна «Анимации» (ТЗ 29.10.2026-d). Список, скелет, дорожки и позы — чтение: игра и файлы человека не меняются; оно идёт в потоке
 * чтения игры (`animation-reads.js`), главный процесс только передаёт запрос и ответ. Установка замены в игру (`animation-install.js`) —
 * запись в архивы игры через `install-rpf-patch`: под замком мастерской и предохранителем «игра закрыта».
 */

import { createGameReader } from "../game-read-host.js";
import { applyAnimationInstall, listInstalledAnimations, planAnimationInstall } from "./animation-install.js";

export function registerAnimationsIpc({ IPC, handleIpc, trusted, safeInput, nativeContext, installOptions, dialog, installGuard = null }) {
  const reads = (name) => createGameReader(new URL("./animation-reads.js", import.meta.url).href, name, nativeContext);
  const list = reads("listAnimations");
  const rig = reads("readAnimationRig");
  const track = reads("readAnimationTrack");
  const poses = reads("readAnimationPoses");
  const addSource = reads("addAnimationSource");
  const removeSource = reads("removeAnimationSource");
  const run = (reader) => (event, input) =>
    trusted(event, async () => {
      const { stateDir } = await installOptions();
      return reader(safeInput(input), stateDir);
    });

  handleIpc(IPC.ANIMATIONS_LIST, run(list));
  handleIpc(IPC.ANIMATIONS_RIG, run(rig));
  handleIpc(IPC.ANIMATIONS_TRACK, run(track));
  handleIpc(IPC.ANIMATIONS_POSES, run(poses));
  handleIpc(IPC.ANIMATIONS_ADD_SOURCE, run(addSource));
  /* Установка замен в архивы игры: план и «что стоит» — чтение, «поставить» и «убрать» пишут и идут под замком мастерской и предохранителем
     (игра закрыта, Legacy, папка подтверждена). Сама пересборка архива — в движке, здесь только сборка словарей. */
  handleIpc(IPC.ANIMATIONS_PLAN_INSTALL, (event, input) =>
    trusted(event, async () => {
      const { stateDir } = await installOptions();
      return planAnimationInstall(safeInput(input), nativeContext(), stateDir);
    }),
  );
  handleIpc(IPC.ANIMATIONS_INSTALLED, (event, input) =>
    trusted(event, async () => {
      const { stateDir } = await installOptions();
      return listInstalledAnimations(safeInput(input), nativeContext(), stateDir);
    }),
  );
  const write = (event, input, mode) =>
    trusted(event, async () => {
      const { stateDir } = await installOptions();
      const value = safeInput(input);
      const request = mode === "remove" ? { gameRoot: value?.gameRoot, remove: value?.ids, extra: value?.extra } : value;
      return applyAnimationInstall(request, nativeContext(), stateDir, installGuard || {});
    });
  handleIpc(IPC.ANIMATIONS_APPLY_INSTALL, (event, input) => write(event, input, "install"));
  handleIpc(IPC.ANIMATIONS_REMOVE_INSTALL, (event, input) => write(event, input, "remove"));
  handleIpc(IPC.ANIMATIONS_REMOVE_SOURCE, run(removeSource));
  /* Свои файлы: на Windows окно выбора файла и папки — разные окна, поэтому `kind` решает, какое открыть. */
  handleIpc(IPC.ANIMATIONS_CHOOSE_SOURCE, (event, input) =>
    trusted(event, async () => {
      const folder = safeInput(input)?.kind === "folder";
      const result = await dialog.showOpenDialog({
        title: folder ? "Папка с анимациями (.ycd)" : "Словарь анимаций или архив",
        properties: [folder ? "openDirectory" : "openFile"],
        ...(folder ? {} : { filters: [{ name: "Анимации GTA V", extensions: ["ycd", "rpf"] }] }),
      });
      return result.canceled || !result.filePaths?.[0] ? null : { path: result.filePaths[0] };
    }),
  );
}
