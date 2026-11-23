/*
 * Журнал сверки с игрой (ТЗ H1, 14.11.2026, раздел 4).
 *
 * При каждом «Применить» экрана игры (мини-карта, прицел, счётчик патронов,
 * счётчик урона) и при перестановке карты под новый экран пишется ОДНА запись,
 * по которой цепочка «что человек выставил → какой у него экран → что посчитано →
 * что записано → что прочитано обратно» восстанавливается целиком. Запись —
 * JSON: она лежит в записи установки работы (`record.reconcile`), в журнале
 * приложения (`kind: "hud-reconcile"`, `data`) и показывается человеческими
 * строками в «Настройки › Логи › Сверка с игрой».
 *
 * ФОРМАТ (версия 1)
 *
 *   v        1
 *   at       ISO-время записи
 *   astral   версия Astral (строка; пусто — не узнали)
 *   formula  `HUD_SCREEN_FORMULA` — версия формулы «экран → место»
 *   editor   "minimap" | "reticle" | "ammo" | "damage"
 *   trigger  "apply" («Применить») | "remap" (перестановка при запуске) | "repair" (автопересборка работы после починки фильма)
 *   work     { id, name } | null — работа проекта
 *   game     экран игры: сырьё → форма и отступ → источник
 *              { known, reason, resolution, width, height, aspect, form, stretched,
 *                safeZone, safeZoneStep, inset, sources: { aspect, inset },
 *                raw: { aspectRatio, windowed, settingsFile: { path, mtime },
 *                       profile: { name, file, mtime }, safeZoneStep } }
 *   window   экран окна, под который собирал человек { aspect, form, inset, source }
 *   chosen   что выставил человек — параметры редактора (JSON)
 *   computed что посчитано. Мини-карта:
 *              { placement: { offsetX, offsetY, scale, stretch, expanded },
 *                stockPlace, entries: [{ name, before, after }],
 *                windowRect, gameRect (доли экрана), gameRectPx (пиксели экрана игры),
 *                clamps: [{ field, wanted, used, limit }], moved }
 *            Прицел, патроны, урон — числа, которые ушли в файл: точки сцены, доли
 *            экрана, масштаб сцены и экран, под который он взят.
 *   written  [{ target, size, sha256 }] — что записано в игру
 *   verify   { engine: итог фазы verify движка | null,
 *              frontend: { read, diffs, matches } | null } — что прочитано обратно
 *   problems коды расхождений ("frontend-mismatch", "verify-missing" …)
 *   trimmed  true — запись ужата, чтобы влезть в журнал приложения
 *
 * Числа округлены до шести знаков, строки обрезаны: запись не должна быть больше
 * `RECONCILE_MAX_BYTES` (предел `data` журнала приложения — 12 КБ).
 */

import {
  describeGameScreen,
  HUD_SCREEN_FORMULA,
  rectInPixels,
} from "./game-screen.js";

export const RECONCILE_VERSION = 1;
export const RECONCILE_KIND = "hud-reconcile";
export const RECONCILE_EDITORS = Object.freeze([
  "minimap",
  "reticle",
  "ammo",
  "damage",
]);
export const RECONCILE_TRIGGERS = Object.freeze(["apply", "remap", "repair"]);

/** Запись должна влезать в `data` журнала приложения (12288 байт) с запасом. */
export const RECONCILE_MAX_BYTES = 11000;

const TEXT_LIMIT = 240;
const LIST_LIMIT = 40;
const DEPTH_LIMIT = 6;

const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Значение, которое переживёт JSON: конечные числа с шестью знаками, короткие строки, без `undefined`. */
export function jsonSafe(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number")
    return Number.isFinite(value) ? round(value) : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string")
    return value.length > TEXT_LIMIT
      ? `${value.slice(0, TEXT_LIMIT - 1)}…`
      : value;
  if (depth >= DEPTH_LIMIT) return null;
  if (Array.isArray(value))
    return value.slice(0, LIST_LIMIT).map((item) => jsonSafe(item, depth + 1));
  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === "function") continue;
      result[key] = jsonSafe(item, depth + 1);
    }
    return result;
  }
  return null;
}

const bytesOf = (value) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

/** Сведения о файле: путь и время изменения (мс от эпохи → ISO). */
function fileFact(file) {
  if (!file || typeof file !== "object") return null;
  const mtime = Number(file.mtimeMs ?? file.mtime);
  return {
    path: file.path ?? file.file ?? null,
    ...(file.name ? { name: file.name } : {}),
    mtime:
      Number.isFinite(mtime) && mtime > 0
        ? new Date(mtime).toISOString()
        : null,
  };
}

/**
 * Экран игры как он пишется в запись: итог (`describeGameScreen`) и сырьё
 * из settings.xml и профиля. `raw` — ответ `readGameScreen`.
 */
export function reconcileGameScreen(raw) {
  const info = describeGameScreen(raw);
  const source = raw && typeof raw === "object" ? raw : {};
  const rawFacts = source.raw || {};
  return {
    known: info.known,
    reason: info.reason,
    resolution: info.resolution,
    width: info.width,
    height: info.height,
    aspect: info.aspect,
    form: info.form,
    stretched: info.stretched,
    safeZone: info.safeZone,
    safeZoneStep: info.safeZoneStep,
    inset: info.inset,
    sources: info.sources,
    raw: {
      aspectRatio: rawFacts.aspectRatio ?? source.aspectRatioSetting ?? null,
      windowed: rawFacts.windowed ?? source.windowed ?? null,
      settingsFile: fileFact(rawFacts.settingsFile),
      profile: fileFact(rawFacts.profile),
      safeZoneStep: info.safeZoneStep,
    },
  };
}

/**
 * Собрать запись сверки. Всё, чего нет, остаётся `null` или пустым списком:
 * запись всегда одной формы, и строки журнала не гадают о полях.
 */
export function buildReconcileRecord({
  editor,
  trigger = "apply",
  work = null,
  astral = "",
  at = new Date().toISOString(),
  gameScreen = null,
  windowScreen = null,
  chosen = {},
  computed = {},
  written = [],
  verify = {},
  problems = [],
} = {}) {
  const game = reconcileGameScreen(gameScreen);
  const record = {
    v: RECONCILE_VERSION,
    at,
    astral: String(astral || ""),
    formula: HUD_SCREEN_FORMULA,
    editor: RECONCILE_EDITORS.includes(editor) ? editor : String(editor || ""),
    trigger: RECONCILE_TRIGGERS.includes(trigger) ? trigger : "apply",
    work:
      work && (work.id || work.name)
        ? { id: String(work.id || ""), name: String(work.name || "") }
        : null,
    game,
    window: windowScreen
      ? {
          aspect:
            Number(windowScreen.aspect) > 0
              ? Number(windowScreen.aspect)
              : null,
          form: windowScreen.form ?? null,
          inset:
            windowScreen.inset !== null &&
            windowScreen.inset !== undefined &&
            Number.isFinite(Number(windowScreen.inset))
              ? Number(windowScreen.inset)
              : null,
          source: windowScreen.source ?? null,
        }
      : null,
    chosen,
    computed,
    written: (Array.isArray(written) ? written : []).map((item) => ({
      target: String(item?.target || item?.file || ""),
      size: Number(item?.size) || 0,
      sha256: String(item?.sha256 || ""),
    })),
    verify: {
      engine: verify?.engine ?? null,
      frontend: verify?.frontend ?? null,
    },
    problems: [...new Set(Array.isArray(problems) ? problems.map(String) : [])],
  };
  return fitReconcileRecord(jsonSafe(record));
}

/**
 * Влезает ли запись в журнал: если нет, по очереди убирается самое второстепенное
 * (прежние числа записей, сырьё экрана, выбор человека), запись помечается `trimmed`.
 */
export function fitReconcileRecord(record, maxBytes = RECONCILE_MAX_BYTES) {
  if (bytesOf(record) <= maxBytes) return record;
  const next = JSON.parse(JSON.stringify(record));
  next.trimmed = true;
  const steps = [
    () => {
      for (const entry of next.computed?.entries || []) delete entry.before;
    },
    () => {
      if (next.game) next.game.raw = null;
    },
    () => {
      next.chosen = null;
    },
    () => {
      if (next.computed) next.computed.entries = [];
    },
  ];
  for (const step of steps) {
    step();
    if (bytesOf(next) <= maxBytes) break;
  }
  return next;
}

/**
 * Записи frontend.xml, прочитанные из установленного архива, против посчитанных.
 * `expected` — `{ имя: { posX, posY, sizeX, sizeY } }`, `readEntries` — то же,
 * что вернул `readMinimapFrontend`. Допуск — запись пишется с шестью знаками.
 *
 * @returns {{ read: object, diffs: object[], matches: boolean }}
 */
export function compareFrontendEntries(
  expected,
  readEntries,
  tolerance = 2e-6,
) {
  const read = {};
  const diffs = [];
  for (const [name, entry] of Object.entries(expected || {})) {
    const found = readEntries?.[name];
    if (!found) {
      diffs.push({ name, key: "entry", expected: null, read: null });
      continue;
    }
    read[name] = Object.fromEntries(
      ["posX", "posY", "sizeX", "sizeY"].map((key) => [
        key,
        Number(found[key]),
      ]),
    );
    for (const key of ["posX", "posY", "sizeX", "sizeY"]) {
      const want = Number(entry[key]);
      const got = Number(found[key]);
      if (!(Math.abs(want - got) <= tolerance))
        diffs.push({ name, key, expected: want, read: got });
    }
  }
  return {
    read,
    diffs,
    matches: diffs.length === 0 && Object.keys(read).length > 0,
  };
}

/** Записи «было → стало» для журнала: только строки карты, четыре числа каждая. */
export function frontendDelta(before, after) {
  const pick = (entry) =>
    entry
      ? Object.fromEntries(
          ["posX", "posY", "sizeX", "sizeY"].map((key) => [
            key,
            Number(entry[key]),
          ]),
        )
      : null;
  return Object.keys(after || {}).map((name) => ({
    name,
    before: pick(before?.[name]),
    after: pick(after[name]),
  }));
}

/** Прямоугольник на экране: в долях и в пикселях экрана игры (разрешения нет — только доли). */
export function reconcileRect(rect, screen) {
  if (!rect) return null;
  const width = Number(screen?.width);
  const height = Number(screen?.height);
  return {
    fractions: {
      left: round(rect.left),
      top: round(rect.top),
      width: round(rect.width),
      height: round(rect.height),
    },
    pixels:
      width > 0 && height > 0 ? rectInPixels(rect, { width, height }) : null,
  };
}
