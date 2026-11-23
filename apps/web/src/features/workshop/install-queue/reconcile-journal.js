/*
 * Журнал сверки с игрой — часть окна (ТЗ H1, 14.11.2026, раздел 4).
 *
 * Главный процесс при «Применить» собирает запись сверки (`reconcile` в ответе
 * установки: экран игры, посчитанное, записанное, прочитанное обратно —
 * `@modovik/minimap-contract/reconcile`). Окно добавляет то, чего главный процесс
 * не знает: работу проекта (id и имя), версию Astral и то, что запустило установку
 * («Применить», перестановка при запуске или автопересборка после починки фильма). Дальше запись:
 *   — остаётся в записи установки работы (`record.reconcile`: её хранит проект,
 *     `native-record.js` копирует ответ установки целиком);
 *   — уходит в журнал приложения видом `hud-reconcile` (`writeAppLog`), откуда её
 *     читает «Настройки › Логи › Сверка с игрой».
 * Журнал не должен ронять установку: любой его сбой — молча.
 */

import {
  RECONCILE_KIND,
  RECONCILE_TRIGGERS,
} from "@modovik/minimap-contract/reconcile";
import { desktopHost } from "../../../api.js";

/** Запись(и) сверки из ответа установки: мини-карта отдаёт объект, прицел — массив. */
export function reconcileRecordsOf(installed) {
  const value = installed?.reconcile;
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter(
    (item) => item && typeof item === "object",
  );
}

let versionPromise = null;

/** Версия Astral из приложения (`getAppInfo`); без приложения — пусто. Спрашивается один раз. */
export function astralVersion() {
  if (!versionPromise) {
    versionPromise = Promise.resolve()
      .then(() => desktopHost()?.getAppInfo?.())
      .then((info) => String(info?.version || ""))
      .catch(() => "");
  }
  return versionPromise;
}

/** Для тестов: забыть закэшированную версию. */
export function forgetAstralVersion() {
  versionPromise = null;
}

/** Что дописывается к виду редактора в строке журнала: «Применить» — ничего, остальное — что именно запустило установку. */
const TRIGGER_SUFFIX = Object.freeze({
  remap: " (перестановка)",
  repair: " (автопересборка после починки фильма)",
});

/** Запись с работой, версией Astral и тем, что запустило установку. */
export function enrichReconcile(
  record,
  { project = null, trigger = "apply", astral = "" } = {},
) {
  return {
    ...record,
    astral: record.astral || astral,
    trigger:
      RECONCILE_TRIGGERS.includes(trigger) && trigger !== "apply"
        ? trigger
        : record.trigger || "apply",
    work:
      project?.id || project?.name
        ? { id: String(project.id || ""), name: String(project.name || "") }
        : record.work || null,
  };
}

const pad = (value) => String(value).padStart(2, "0");

const percent = (value) =>
  Number.isFinite(Number(value))
    ? `${(Number(value) * 100).toFixed(1)} %`
    : "?";

/** Строка для журнала приложения: что поставлено, на каком экране и сошлось ли. По-русски, как остальные служебные строки журнала. */
export function reconcileLogLine(record) {
  const editor =
    {
      minimap: "мини-карта",
      reticle: "прицел",
      ammo: "счётчик патронов",
      damage: "счётчик урона",
    }[record.editor] || record.editor;
  const game = record.game || {};
  const screen = game.known
    ? `экран игры ${game.resolution || "разрешение неизвестно"}, ${game.form || "?"}${game.stretched ? " (растянут)" : ""}`
    : `экран игры неизвестен (${game.reason || "?"})`;
  const parts = [
    `hud-reconcile: ${editor}${TRIGGER_SUFFIX[record.trigger] || ""} — ${screen}`,
  ];
  const rect = record.computed?.gameRect?.fractions;
  if (rect)
    parts.push(
      `кадр ${percent(rect.left)}/${percent(rect.top)}, ${percent(rect.width)}×${percent(rect.height)}`,
    );
  /* Точка отката — та, что движок поставил при этой установке; позже она могла смениться, и строка так и говорит. */
  const restorePoint = record.verify?.engine?.restorePoint;
  if (restorePoint)
    parts.push(`точка отката на момент установки: ${restorePoint}`);
  const frontend = record.verify?.frontend;
  if (frontend)
    parts.push(
      `frontend.xml: ${frontend.matches ? "прочитан обратно, совпал" : `НЕ совпал (${(frontend.diffs || []).length})`}`,
    );
  if (record.problems?.length)
    parts.push(`замечания: ${record.problems.join(", ")}`);
  return parts.join("; ");
}

/** Уровень строки журнала: расхождение — предупреждение, остальное — сведения. */
export const reconcileLogLevel = (record) =>
  record.problems?.length ? "warn" : "info";

/** Записать одну запись сверки в журнал приложения; сбой — молча. */
export async function writeReconcileLog(record) {
  try {
    const write = desktopHost()?.writeAppLog;
    if (typeof write !== "function") return false;
    await write({
      level: reconcileLogLevel(record),
      source: "hud",
      message: reconcileLogLine(record),
      kind: RECONCILE_KIND,
      data: record,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Дописать запись(и) сверки и отправить в журнал приложения. Возвращает ответ
 * установки с обогащённой записью (`reconcile` — тот же вид: объект или массив).
 * Ответ без записи сверки возвращается как есть.
 */
export async function journalReconcile({
  installed,
  project = null,
  trigger = "apply",
}) {
  const records = reconcileRecordsOf(installed);
  if (!records.length) return installed;
  const astral = await astralVersion();
  const enriched = records.map((record) =>
    enrichReconcile(record, { project, trigger, astral }),
  );
  await Promise.all(enriched.map((record) => writeReconcileLog(record)));
  return {
    ...installed,
    reconcile: Array.isArray(installed.reconcile) ? enriched : enriched[0],
  };
}

/** «дд.мм чч:мм» для строк журнала и заголовков. */
export function reconcileStamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
