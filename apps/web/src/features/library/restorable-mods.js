import { useMemo } from "react";
import { readParkedWorkshopUnits } from "../../workshop-library.js";
import { isWaiting } from "./waiting-mods.js";

/*
 * Сколько модов пропало из игры после проверки файлов (владелец, 16.11.2026: «если после проверки файлов игры все моды пропали, в Настройках это подсвечивается»).
 * Движок, увидев, что Astral ушёл из архива игры (проверка в Steam, Epic или Rockstar Games Launcher, обновление, чужой лаунчер), сам переносит свои моды в «снятые»
 * (`profile.parked`, `useCheckRemoved.js`), а записи работ мастерской перестают считаться стоящими (`parked-installs.js`). Здесь они складываются в одно число;
 * моды, что ждут новой версии после обновления игры, не считаются: их «Вернуть» не вернёт (они ставятся сами, когда версия выйдет).
 */

/** Пропавшие моды движка и работы мастерской, которые можно вернуть. */
export const restorableCount = (removed = []) =>
  removed.filter((item) => !isWaiting(item)).length +
  readParkedWorkshopUnits().length;

/**
 * Для Настроек и рейки: сколько можно вернуть и чем (`reinstall` из `useCheckRemoved`). Число пересчитывается, когда пришли снятые или сменилась ревизия отметок
 * (`parkPoints` и `unparkPoints` пишут записи работ в хранилище окна, подписки на него нет).
 */
export function useRestorableMods({ removed, revision, reinstall }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const count = useMemo(() => restorableCount(removed), [removed, revision]);
  return { count, restore: reinstall };
}
