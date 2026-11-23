/*
 * Профиль для окна — записи установок без описей (06.10.2026). Полное
 * состояние движка с точками восстановления и описями архивов на установке
 * с пакетом ухудшения текстур (48 тысяч файлов) весит больше 200 МБ: каждый
 * снимок цели в точке восстановления несёт опись пакета. Окно, разбирая
 * такой ответ, висело на заставке «Запускаем безопасную библиотеку».
 * Окну нужны имя, цель, места, происхождение и время установки — описи
 * файлов и архивов остаются в главном процессе.
 *
 * Модуль чистый: им пользуются поток-работник (`install-profile-worker.js`),
 * главный процесс и тесты.
 */

const HEAVY_RECORD_FIELDS = new Set(["resources", "archiveEntries", "files"]);

export const windowInstallRecord = (item) =>
  Object.fromEntries(
    Object.entries(item || {}).filter(([key]) => !HEAVY_RECORD_FIELDS.has(key)),
  );

/**
 * Профиль окна из разобранного файла состояния движка (или `null`, если
 * файла нет или он битый — как `readState`: пустое состояние).
 */
/* Последние события «что Astral исправил сам» по целям (задача 1 ТЗ
   10.10.2026, `reconcile-report.js` движка): окно показывает новые один раз. */
const RECONCILE_EVENTS = 8;

function reconcileByTarget(targets) {
  const out = {};
  for (const [targetId, target] of Object.entries(targets && typeof targets === "object" ? targets : {})) {
    const events = Array.isArray(target?.reconcile?.events) ? target.reconcile.events : [];
    if (events.length) out[targetId] = events.slice(-RECONCILE_EVENTS);
  }
  return out;
}

/* Моды, снятые проверкой файлов игры (задача 2 ТЗ 10.10.2026,
   `parked-mods.js` движка): окну — без слоёв, только что это и когда. Тот же
   вид, что `parkedSummary` движка; здесь своими силами, чтобы поток-работник
   профиля не тянул модули движка. */
function parkedByTarget(targets) {
  const out = {};
  for (const [targetId, target] of Object.entries(targets && typeof targets === "object" ? targets : {})) {
    const installed = new Set((target?.installed || []).map((item) => item?.modId));
    const parked = (Array.isArray(target?.parked) ? target.parked : [])
      .filter((item) => item?.modId && !installed.has(item.modId))
      .map((item) => ({
        modId: item.modId,
        parkedAt: item.parkedAt || null,
        reason: item.reason || "restored",
        ...(item.refusedRelease ? { refusedRelease: item.refusedRelease } : {}),
        ...(item.record?.version ? { version: item.record.version } : {}),
        ...(Array.isArray(item.record?.slots) ? { slots: item.record.slots } : {}),
        ...(item.record?.origin ? { origin: item.record.origin } : {}),
      }));
    if (parked.length) out[targetId] = parked;
  }
  return out;
}

export function windowProfileFromState(parsed) {
  const state = parsed && typeof parsed === "object" ? parsed : {};
  return {
    schemaVersion: 6,
    mode: typeof state.mode === "string" ? state.mode : "transactional",
    updatedAt: state.updatedAt ?? null,
    lastTransaction: state.lastTransaction ?? null,
    installed: (Array.isArray(state.installed) ? state.installed : [])
      .filter((item) => item && typeof item === "object")
      .map(windowInstallRecord),
    reconcile: reconcileByTarget(state.targets),
    parked: parkedByTarget(state.targets),
  };
}

/** Профиль окна плюс установки настроек игры (их состояние отдельное и маленькое). */
export function consolidateWindowProfile(profile, settingsInstalled = []) {
  const installed = new Map(
    [...(profile.installed || []), ...settingsInstalled.map(windowInstallRecord)].map((item) => [
      `${item.targetId}:${item.modId}`,
      item,
    ]),
  );
  return { ...profile, installed: [...installed.values()] };
}
