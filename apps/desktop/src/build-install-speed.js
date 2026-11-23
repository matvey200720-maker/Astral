/*
 * Режим скорости установки на стороне скрипта сборки (18.11.2026).
 *
 * Сборка набора идёт в своём процессе или потоке (`build-process.js`), а потолок записи и отдых диска — состояние
 * модуля (`write-pacing.js`, `disk-care.js`): у процесса сборки оно своё и без этой проводки пустое — сборка писала бы
 * без тормоза. Главный процесс кладёт режим в данные задания (`installSpeed`) и шлёт его заново при каждой смене
 * («Быстрая установка» посреди сборки); здесь он применяется.
 */
import { setBuiltFileSlowDisk } from "@modovik/install-engine/built-file-write.js";
import { setDiskRest, setDiskRestFactor } from "@modovik/install-engine/disk-care.js";
import { setCopyWriteLimitMbps } from "@modovik/install-engine/write-pacing.js";

/** Применить `{ writeLimitMbps, rest, restFactor, slow }`; пустое или не объект — ничего не меняет. */
export function applyBuildInstallSpeed(speed) {
  if (!speed || typeof speed !== "object") return false;
  setCopyWriteLimitMbps(Number(speed.writeLimitMbps) > 0 ? Number(speed.writeLimitMbps) : 0);
  setDiskRest(speed.rest !== false);
  setDiskRestFactor(speed.restFactor ?? 1);
  setBuiltFileSlowDisk(speed.slow === true);
  return true;
}

/**
 * Скрипт сборки следует за режимом: применяет тот, что пришёл с данными задания, и слушает смену. Слушатель остаётся до
 * конца задания — хозяин задания снимает поток или процесс сам, когда получил ответ.
 */
export function followBuildInstallSpeed(port, data) {
  applyBuildInstallSpeed(data?.installSpeed);
  port.on("message", (message) => {
    if (message?.installSpeed) applyBuildInstallSpeed(message.installSpeed);
  });
}
