import { useEffect, useState } from "react";
import { desktopHost, listLocalRestorePoints } from "../../api.js";
import { formatBytes } from "../../components/desktop/settings/format-bytes.js";

/*
 * Цифры для карточек «Место на диске» и «Точка возврата» (Библиотека Б, 15.11.2026): сколько занимают моды в игре и точки возврата, сколько свободно, и когда
 * снята последняя точка. Всё — из того, что приложение уже знает: хранилище (`getStorageStatus`) и стопка точек движка (`listRestorePoints`).
 *
 * Почему карточки были пустыми (разбор 16.11.2026): `getStorageStatus` на каждый вызов обходит весь кэш (опись «Хранилища»: тысячи файлов точек и модов, на ПК с
 * большим кэшем — секунды), а точки читаются через `readState` всего состояния движка. Окно ждало оба ответа разом и пока ждало — рисовало пустые строки нулевой высоты.
 * Теперь: каждая карточка получает свой ответ сама; прошлое значение лежит в `localStorage` и показывается сразу (`stale`), пока читается свежее; если читать
 * нечего — скелет на месте цифры, а не пустота; сбой чтения не стирает прошлое значение; два одновременных чтения одного и того же не плодятся.
 *
 * Значения: `undefined` — ещё читаем и прошлого нет; `null` — не вышло или это не приложение (песочница, сбой); иначе — данные.
 */

const MEMORY_KEY = "astral-library-numbers-1";

function recall() {
  try {
    const found = JSON.parse(globalThis.localStorage?.getItem(MEMORY_KEY));
    return found && typeof found === "object" ? found : {};
  } catch {
    return {};
  }
}

function remember(key, patch) {
  try {
    const all = recall();
    globalThis.localStorage?.setItem(
      MEMORY_KEY,
      JSON.stringify({ ...all, [key]: { ...all[key], ...patch } }),
    );
  } catch {
    /* хранилище закрыто или полно — цифры просто не запомнятся */
  }
}

/* Прошлое хранилище: тот же вид, что отдаёт движок, но только с тем, что читает карточка. */
function storageFromMemory(entry) {
  if (!entry || typeof entry.mods !== "number") return undefined;
  return {
    gameBackups: {
      mods: { bytes: entry.mods },
      parts: { restorePoints: { bytes: entry.points } },
    },
    diskFreeBytes: entry.free,
  };
}

/* Прошлые точки: одна последняя (карточке нужна только она); «точек не было» — пустая стопка. */
function pointsFromMemory(entry) {
  if (!entry) return undefined;
  if (entry.point === null) return [];
  if (entry.point && typeof entry.point.at === "string")
    return [{ createdAt: entry.point.at, installedCount: entry.point.count }];
  return undefined;
}

/* Одно чтение на ключ за раз: окно открыли и закрыли, а `changed` сменился дважды — опись кэша всё равно идёт одна. */
const reading = new Map();
const STUCK_MS = 60_000;
function readOnce(name, key, read) {
  const id = `${name}:${key}`;
  const known = reading.get(id);
  /* Чтение, что висит дольше минуты, не ждём вечно: следующее открытие начинает своё. */
  if (known && Date.now() - known.at < STUCK_MS) return known.job;
  const job = Promise.resolve()
    .then(read)
    .finally(() => {
      if (reading.get(id)?.job === job) reading.delete(id);
    });
  reading.set(id, { job, at: Date.now() });
  return job;
}

function startingNumbers(key) {
  const entry = recall()[key];
  const storage = storageFromMemory(entry);
  const points = pointsFromMemory(entry);
  return {
    storage,
    points,
    stale: { storage: storage !== undefined, points: points !== undefined },
  };
}

export function useLibraryNumbers(targetId, changed) {
  const key = targetId || "default";
  const [numbers, setNumbers] = useState(() => startingNumbers(key));
  useEffect(() => {
    let alive = true;
    const host = desktopHost();
    /* Ключ сменился (другая игра): начинаем с того, что помним про неё. */
    const start = startingNumbers(key);
    setNumbers((now) => ({
      storage: start.storage ?? now.storage,
      points: start.points ?? now.points,
      stale: {
        storage: start.stale.storage || now.stale.storage,
        points: start.stale.points || now.stale.points,
      },
    }));
    const fresh = (part, value) => {
      if (alive)
        setNumbers((now) => ({
          ...now,
          [part]: value,
          stale: { ...now.stale, [part]: false },
        }));
    };
    /* Не вышло: прошлое значение остаётся (оно честно помечено прошлым), а если его не было — «не удалось». */
    const failed = (part) => {
      if (alive)
        setNumbers((now) =>
          now[part] === undefined ? { ...now, [part]: null } : now,
        );
    };
    if (host?.getStorageStatus)
      readOnce("storage", key, () => host.getStorageStatus()).then(
        (found) => {
          if (!found) return failed("storage");
          const figures = diskFigures(found);
          if (figures && figures.mods !== null)
            remember(key, {
              mods: figures.mods,
              points: figures.points,
              free: figures.free,
            });
          fresh("storage", found);
        },
        () => failed("storage"),
      );
    else fresh("storage", null);
    readOnce("points", key, () =>
      listLocalRestorePoints({ targetId: key }),
    ).then(
      (found) => {
        if (!Array.isArray(found)) return failed("points");
        const last = lastPoint(found);
        remember(key, {
          point: last ? { at: last.at.toISOString(), count: last.count } : null,
        });
        fresh("points", found);
      },
      () => failed("points"),
    );
    return () => {
      alive = false;
    };
    /* `changed` — сколько всего стоит в игре: после удаления цифры читаются заново. */
  }, [key, changed]);
  return numbers;
}

const number = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Что считает карточка «Место на диске»: моды в игре, точки возврата, свободно на диске; чего нет — `null`. */
export function diskFigures(storage) {
  if (!storage) return null;
  const engine = storage.gameBackups;
  return {
    mods: number(engine?.mods?.bytes),
    points: number(engine?.parts?.restorePoints?.bytes),
    free: number(storage.diskFreeBytes),
  };
}

/** «1,5 ГБ» → число и единица раздельно: число крупно, единица мелко. */
export function splitBytes(bytes, language) {
  const text = formatBytes(bytes, language);
  const at = text.lastIndexOf(" ");
  return at < 0
    ? { value: text, unit: "" }
    : { value: text.slice(0, at), unit: text.slice(at + 1) };
}

/** Последняя точка возврата: `{ at: Date, count }`; нет точек или время не разобрать — `null`. Стопка идёт от новой к старой. */
export function lastPoint(points) {
  if (!Array.isArray(points)) return null;
  for (const point of points) {
    const at = new Date(point?.createdAt);
    if (!Number.isNaN(at.getTime()))
      return { at, count: number(point.installedCount) };
  }
  return null;
}

const startOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** «сегодня, 21:40» / «вчера, 21:40» / «14 нояб., 21:40» — словами языка окна через Intl. */
export function pointStamp(at, language, now = new Date()) {
  const clock = at.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const daysAgo = Math.round((startOfDay(now) - startOfDay(at)) / 86400000);
  if (daysAgo === 0 || daysAgo === 1) {
    const word = new Intl.RelativeTimeFormat(language, {
      numeric: "auto",
    }).format(-daysAgo, "day");
    return `${word}, ${clock}`;
  }
  return `${at.toLocaleDateString(language, { day: "numeric", month: "short" })}, ${clock}`;
}

const MODS = {
  ru: { one: "мод", few: "мода", many: "модов", other: "модов" },
  uk: { one: "мод", few: "моди", many: "модів", other: "модів" },
  en: { one: "mod", other: "mods" },
  de: { one: "Mod", other: "Mods" },
  pl: { one: "mod", few: "mody", many: "modów", other: "modów" },
  fr: { one: "mod", other: "mods" },
};

/** «26 модов»: слово «мод» по числу и языку (ru, uk, pl — три формы; en, de, fr — две). */
export function modsWord(count, language) {
  const forms = MODS[language] || MODS.en;
  return forms[new Intl.PluralRules(language).select(count)] || forms.other;
}
