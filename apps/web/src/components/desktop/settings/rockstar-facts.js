/*
 * Что вкладка «Rockstar Games» знает о копии и режиме — из ответа
 * `getRockstarDelivery` (контракт 14.11.2026, `.local/rockstar-tab-1411/CONTRACT.md`).
 *
 * Новые поля (`platform`, `needed`, `supported`, `unsupportedReason`,
 * `visibleMethods`, `imageFolder`, `gameRunning`) добавляет главный процесс;
 * старый их не присылает, и тогда берётся запасное значение из записи самой
 * копии — вкладка не ломается ни с тем, ни с другим.
 */

/** Способы, которые вкладка предлагает человеку, и их порядок. */
export const VISIBLE_METHODS = ["agent-same", "manual-same"];

/** Папка игры для сравнения: Windows не различает регистр и вид черты. */
export const rootKey = (folder) =>
  String(folder || "")
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();

/** Магазин копии → `rockstar | steam | epic | other`. */
export function platformOf(status, target) {
  if (typeof status?.platform === "string" && status.platform)
    return status.platform;
  if (target?.rockstarLauncher) return "rockstar";
  const store = String(target?.store || "other").toLowerCase();
  if (store.includes("steam")) return "steam";
  if (store.includes("epic")) return "epic";
  if (store.includes("rockstar")) return "rockstar";
  return "other";
}

const own = (status, key, fallback) =>
  status && status[key] !== undefined && status[key] !== null
    ? status[key]
    : fallback;

/**
 * Факты для экрана. `target` — основная копия игры (`null`, пока папка не
 * выбрана), `status` — ответ главного процесса (`null` без приложения или
 * пока он не пришёл).
 */
export function deliveryFacts(status, target) {
  const linked = Boolean(target?.linkedCopy || status?.linkedCopy);
  const reason =
    status && status.unsupportedReason !== undefined
      ? status.unsupportedReason
      : linked
        ? "linked-copy"
        : null;
  const supported = own(status, "supported", !linked);
  const listed = Array.isArray(status?.visibleMethods)
    ? status.visibleMethods.filter((id) => VISIBLE_METHODS.includes(id))
    : [];
  const enabled = status?.mode === "swap";
  const method = status?.method || "";
  const swap = status?.swap || {};
  /* Режим и вторая папка у одной игры — одно из двух (14.11.2026): у самой второй папки своей второй папки нет. */
  const hasCopy =
    !linked &&
    Boolean(
      own(
        status,
        "hasCopy",
        Array.isArray(status?.copies) && status.copies.length > 0,
      ),
    );
  return {
    hasCopy,
    /* Режима нет, а вторая папка есть: тумблер закрыт, пока её не удалят. */
    copyBlocksMode: hasCopy && !enabled,
    /* Прежние сборки позволяли оба: режим включён, а моды идут во вторую папку. */
    both: hasCopy && enabled,
    platform: platformOf(status, target),
    needed: Boolean(own(status, "needed", Boolean(target?.rockstarLauncher))),
    supported: Boolean(supported),
    reason: reason || (supported ? null : "other"),
    methods: listed.length ? listed : VISIBLE_METHODS,
    imageFolder:
      typeof status?.imageFolder === "string" && status.imageFolder
        ? status.imageFolder
        : null,
    gameRunning: Boolean(own(status, "gameRunning", false)),
    linked,
    enabled,
    method,
    legacy: enabled && method === "replacex",
    manual: enabled && method === "manual-same",
    waiting: Boolean(status?.manualWaiting),
    journal: swap.journal || "idle",
    stale: enabled && Array.isArray(swap.stale) ? swap.stale : [],
    hosting: status?.hosting || "off",
  };
}

/**
 * Одна строка состояния под шапкой: ключ слова в `rockstar-panel-copy.js` и
 * тон. Порядок — от важного к обычному: «моды не в игре» перекрывает всё,
 * потом идущая подстановка, игра, ожидание и, наконец, кто следит.
 */
export function stateLine(facts) {
  if (!facts.enabled) return { key: "stateOff", tone: "" };
  if (facts.stale.length) return { key: "stateStale", tone: "attention" };
  if (facts.journal === "arming" || facts.journal === "disarming")
    return { key: "journalBusy", tone: "" };
  if (facts.journal === "armed") return { key: "stateArmed", tone: "positive" };
  if (facts.manual)
    return facts.waiting
      ? { key: "stateManualWaiting", tone: "positive" }
      : { key: "stateManualIdle", tone: "" };
  if (facts.hosting === "agent")
    return { key: "stateAgentOk", tone: "positive" };
  /* `window` — задача не отвечает, следит окно; `off` — не следит пока никто (перезапуск до подъёма дозора). */
  return facts.hosting === "window"
    ? { key: "stateAgentDown", tone: "attention" }
    : { key: "stateNoWatcher", tone: "attention" };
}

/** Какая из трёх строк «копия не из Rockstar Games Launcher» подходит этой платформе. */
export const calmKey = (platform) =>
  platform === "steam"
    ? "calmSteam"
    : platform === "epic"
      ? "calmEpic"
      : "calmOther";
