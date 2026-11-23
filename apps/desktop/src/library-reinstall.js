/*
 * «Установить снова» после проверки файлов игры (задача 2 ТЗ 10.10.2026).
 *
 * Проверка целостности в Steam, Epic или Rockstar Games Launcher (или
 * обновление игры, или лаунчер проекта со своей копией) кладёт в игру
 * штатный update.rpf — и Astral снимает свои моды из «установленного»: моды
 * каталога и работы-слои движка — в «снятые» (`parked-mods.js` движка),
 * работы, поставленные нативным хостом (мини-карта, прицел, небо…), окно
 * откладывает своими записями. Проекты и «Мои работы» не трогаются.
 *
 * Здесь всё это возвращается одной операцией:
 *   1. движок кладёт снятые слои поверх нынешней игры одной транзакцией
 *      (`restoreParkedMods`);
 *   2. работы хоста ставятся заново из своих папок патчей, по порядку, как
 *      стояли: та же дорога, что у корзины библиотеки, когда она ставит
 *      обратно работы, лежавшие сверху (`library-removal.js`), — с запиской
 *      пересборки, если она есть (патч соберётся поверх нынешнего архива).
 *
 * Работа, чьей папки патча нет (кэш почистили), честно называется в ответе:
 * её ставит заново только её редактор.
 */

import path from "node:path";
import { liveArchivePath } from "./native-restore-chain.js";

const MAX_NATIVES = 64;
const text = (value, limit = 1024) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
const errorText = (error) => String(error?.message || error || "Неизвестная ошибка");

/** Запрос окна: работы хоста по порядку установки. */
export function reinstallRequest(value) {
  const natives = (Array.isArray(value?.natives) ? value.natives : [])
    .slice(0, MAX_NATIVES)
    .map((item) => ({
      restorePointId: text(item?.restorePointId, 80),
      patch: text(item?.patch),
      key: text(item?.key, 200),
      name: text(item?.name, 200),
    }))
    .filter((item) => item.patch);
  return { natives };
}

/**
 * `tools`: `restoreEngine()` → ответ `restoreParkedMods`; `resolvePatch(patch)`
 * → папка патча или пустая строка; `validatePatch`, `recomposePatch`,
 * `installPatch({ patch, gameRoot })` → `{ id }` новой точки;
 * `assertRuntimeSafety`; `fingerprint(file)`; `report(status)`.
 */
export async function reinstallAfterRestore({ gameRoot, natives = [] }, tools) {
  const result = {
    mods: { restored: [], lost: [] },
    natives: { remap: {}, failed: [] },
  };
  const report = (phase) => tools.report?.({ phase, cancellable: false });
  report("prepare");
  await tools.assertRuntimeSafety?.(gameRoot);
  report("restore-mods");
  const engine = await tools.restoreEngine();
  result.mods.restored = [...(engine?.restored || [])];
  result.mods.lost = [...(engine?.lost || [])];
  if (natives.length) report("reinstall-works");
  for (const item of natives) {
    const directory = await tools.resolvePatch(item.patch);
    if (!directory) {
      result.natives.failed.push({ ...item, reason: "patch-missing", message: "Файлов работы больше нет в кэше Astral — откройте её редактор и нажмите «Применить»." });
      continue;
    }
    try {
      await tools.assertRuntimeSafety?.(gameRoot);
      const fresh = tools.recomposePatch ? await tools.recomposePatch(directory).catch(() => null) : null;
      const patch = fresh?.patch || directory;
      if (!fresh) await tools.validatePatch?.(patch);
      const installed = await tools.installPatch({ patch, gameRoot });
      const id = String(installed?.id || "");
      if (!id) throw new Error("Нативный хост не вернул точку отката.");
      result.natives.remap[item.restorePointId || item.key || patch] = { restorePointId: id, patch };
    } catch (error) {
      result.natives.failed.push({ ...item, reason: "install-failed", message: errorText(error) });
    }
  }
  const live = await tools.fingerprint?.(liveArchivePath(path.resolve(gameRoot))).catch(() => null);
  result.archive = live ? { sha256: live.sha256, size: live.size } : null;
  report("complete");
  return result;
}
