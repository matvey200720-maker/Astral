import { runCacheHousekeepingNow } from "./cache-housekeeping.js";

export function registerStorageIpc({
  IPC,
  handleIpc,
  trusted,
  desktopStorage,
  dialog,
  shell,
  safeInput,
  tidyNow = runCacheHousekeepingNow,
}) {
  const sendProgress = (event) => (progress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(IPC.STORAGE_PROGRESS, progress);
    }
  };

  handleIpc(IPC.STORAGE_STATUS, (event) =>
    trusted(event, () => desktopStorage().status()),
  );
  handleIpc(IPC.OPEN_CACHE_DIRECTORY, (event) =>
    trusted(event, async () => {
      const { cachePath } = await desktopStorage().status();
      const error = await shell.openPath(cachePath);
      if (error) throw new Error(error);
      return { opened: true };
    }),
  );
  handleIpc(IPC.CHOOSE_CACHE_DIRECTORY, (event) =>
    trusted(event, async () => {
      const result = await dialog.showOpenDialog({
        title: "Выберите диск или папку для кэша Astral",
        buttonLabel: "Выбрать папку",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled) return null;
      return desktopStorage().moveToParent(
        result.filePaths[0],
        sendProgress(event),
      );
    }),
  );
  handleIpc(IPC.RESET_CACHE_DIRECTORY, (event) =>
    trusted(event, () => desktopStorage().reset(sendProgress(event))),
  );
  handleIpc(IPC.SET_CACHE_ENABLED, (event, input) =>
    trusted(event, () =>
      desktopStorage().setEnabled(Boolean(safeInput(input).enabled)),
    ),
  );
  handleIpc(IPC.SET_CACHE_LIMIT, (event, input) =>
    trusted(event, () =>
      desktopStorage().setLimit(Number(safeInput(input).limitBytes)),
    ),
  );
  /* «Быстрая установка»: тормоз записи снят или работает. Действует сразу — и на идущую установку. */
  handleIpc(IPC.SET_FAST_INSTALL, (event, input) =>
    trusted(event, () =>
      desktopStorage().setFastInstall(safeInput(input).enabled === true),
    ),
  );
  /* Ответ на плашку первой установки: «Применить» (fast) или «Продолжить без ускорения», крестик, Esc. */
  handleIpc(IPC.FAST_INSTALL_OFFER_SETTLE, (event, input) =>
    trusted(event, () =>
      desktopStorage().settleFastInstallOffer(safeInput(input).fast === true),
    ),
  );
  /* Бюджет на Astral («auto» или байты) и «Освободить» у вида (только то, что можно скачать или собрать снова). */
  handleIpc(IPC.SET_STORAGE_BUDGET, (event, input) =>
    trusted(event, () => {
      const { value } = safeInput(input);
      return desktopStorage().setBudget(value === "auto" ? "auto" : Number(value));
    }),
  );
  handleIpc(IPC.FREE_STORAGE_KIND, (event, input) =>
    trusted(event, () => desktopStorage().freeKind(String(safeInput(input).kind || ""))),
  );
  /* Скорость загрузки (МБ/с, 0 — без потолка): один потолок на каталог, обновления и загрузчики. */
  handleIpc(IPC.SET_DOWNLOAD_LIMIT, (event, input) =>
    trusted(event, () =>
      desktopStorage().setDownloadLimit(Number(safeInput(input).mbps)),
    ),
  );
  /*
   * «Очистить кэш»: скачанные пакеты и сразу уборка памяти движка по её
   * правилам — брошенные копии, недописанное, старые точки отката кусками
   * (задача 5 ТЗ 10.10.2026). Моды, работы и откат остаются.
   */
  handleIpc(IPC.CLEAR_CACHE, (event) =>
    trusted(event, async () => {
      const cleared = await desktopStorage().clear();
      const report = await tidyNow();
      if (!report?.bytes) return { ...cleared, tidiedBytes: 0 };
      /* Уборка сменила размеры — их надо мерить заново. */
      desktopStorage().forgetSizes?.();
      return { ...(await desktopStorage().status()), tidiedBytes: report.bytes };
    }),
  );
  handleIpc(IPC.CANCEL_CACHE_MOVE, (event) =>
    trusted(event, () => desktopStorage().cancelMove()),
  );
}
