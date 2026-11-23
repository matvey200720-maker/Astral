/*
 * Каналы «Моды в копию из Rockstar Games Launcher» (задача 7): способ
 * доставки у копии, вторая папка игры (сборка с ходом, догонка оригинала,
 * удаление). Регистрация берёт всё параметрами — так её проверяет тест без
 * Electron.
 */

export function registerRockstarDeliveryIpc({ IPC, handleIpc, trusted, safeInput, delivery, dialog, sendProgress = () => {}, operations = null }) {
  /* Способ меняет update.rpf в игре — не посреди записи мастерской. */
  const assertIdle = () => {
    if (operations?.isBusy?.()) throw new Error("Astral сейчас пишет в игру — дождитесь окончания.");
  };

  handleIpc(IPC.ROCKSTAR_DELIVERY_STATUS, (event, input) => trusted(event, async () => delivery.status(safeInput(input))));

  handleIpc(IPC.ROCKSTAR_DELIVERY_SET, (event, input) =>
    trusted(event, async () => {
      assertIdle();
      const value = safeInput(input);
      return delivery.setMode({ targetId: value.targetId, mode: value.mode, method: typeof value.method === "string" ? value.method : null });
    }),
  );

  /* Режим Rockstar (05.11.2026): пересборка чужих архивов, ручные кнопки, журнал режима. */
  handleIpc(IPC.ROCKSTAR_MODE_REBUILD, (event, input) =>
    trusted(event, async () => {
      assertIdle();
      return delivery.rebuild({ targetId: safeInput(input).targetId });
    }),
  );
  handleIpc(IPC.ROCKSTAR_MODE_ARM_NOW, (event, input) => trusted(event, async () => delivery.armNow({ targetId: safeInput(input).targetId })));
  handleIpc(IPC.ROCKSTAR_MODE_DISARM_NOW, (event, input) => trusted(event, async () => delivery.disarmNow({ targetId: safeInput(input).targetId })));
  handleIpc(IPC.ROCKSTAR_MODE_LOG, (event, input) => trusted(event, async () => delivery.logTail({ limit: Number(safeInput(input).limit) || 200 })));

  /* Папку второй копии выбирает человек: путь приходит из диалога главного процесса. */
  handleIpc(IPC.ROCKSTAR_COPY_CHOOSE_FOLDER, (event) =>
    trusted(event, async () => {
      const result = await dialog.showOpenDialog({
        title: "Где собрать вторую папку GTA V (лучше на том же диске, что и игра)",
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled || !result.filePaths?.[0] ? null : result.filePaths[0];
    }),
  );

  handleIpc(IPC.ROCKSTAR_COPY_CREATE, (event, input) =>
    trusted(event, async () => {
      assertIdle();
      const value = safeInput(input);
      const mode = value.mode === "copy" ? "copy" : "link";
      return delivery.createCopy({
        targetId: value.targetId,
        mode,
        destination: typeof value.destination === "string" ? value.destination : "",
        onProgress: (progress) => sendProgress({ targetId: value.targetId, mode, ...progress }),
      });
    }),
  );

  handleIpc(IPC.ROCKSTAR_COPY_SYNC, (event, input) => trusted(event, async () => delivery.syncCopy({ path: safeInput(input).path })));

  handleIpc(IPC.ROCKSTAR_COPY_DELETE, (event, input) =>
    trusted(event, async () => {
      assertIdle();
      return delivery.removeCopy({ path: safeInput(input).path });
    }),
  );
}
