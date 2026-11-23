/*
 * База эффектов из игры игрока в окне — одна на сеанс и на три редактора.
 *
 * Трейсеры, попадания и огонь читают одну и ту же базу (`readPtfxBase`:
 * выписки правил, листы ядра, свет таймцикла). Раньше каждый вход в редактор
 * начинался с пустого места и ждал её заново: сцена попаданий стояла пустой,
 * огонь показывал нарисованное пятно, пока главный процесс читал архив
 * (владелец, 25.09.2026: «ждал секунд пять»).
 *
 * Теперь база живёт здесь, пока открыто окно. Редактор открывается сразу с
 * ней, а при каждом входе спрашивает главный процесс, та ли она ещё: у того
 * свой кэш под отпечатком update.rpf (`apps/desktop/src/ptfx-base-cache.js`),
 * и ответ «без изменений» приходит за миллисекунды без самой базы. Мастерская
 * просит базу заранее (`prefetchPtfxBase`), пока человек выбирает редактор,
 * — к входу в «Эффекты попадания» её обычно уже нечего ждать.
 *
 * Модуль лёгкий нарочно: его зовёт полка мастерской, а она лежит в общем
 * куске приложения — ни движка частиц, ни каталога эффектов здесь нет.
 */

import { useSyncExternalStore } from "react";
import {
  detectInstallations,
  hasDesktopBridge,
  readPtfxBase,
} from "../../../../api.js";

const EMPTY = Object.freeze({
  /** База как её отдал главный процесс, плюс `gameRoot`; `null` — её нет. */
  base: null,
  gameRoot: "",
  fingerprint: "",
  /**
   * К какой установке набора относится прочитанное ядро (`restorePointId`
   * записи установки на момент проверки). Опись клонов прежней сборки
   * говорит о том ядре, которое было прочитано, а не о поставленном после.
   */
  readFor: undefined,
  /** Идёт чтение или проверка. */
  loading: false,
  error: null,
});

let snapshot = EMPTY;
let pending = null;
const listeners = new Set();

function publish(change) {
  snapshot = Object.freeze({ ...snapshot, ...change });
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Что известно сейчас, без ожидания. */
export function peekPtfxBase() {
  return snapshot;
}

/**
 * Установка, чью базу читать: первая найденная GTA V Legacy — как у остальных
 * редакторов. Ядро Enhanced (gen9) читается разбором Legacy как мусор
 * («illegal position!» внутри CodeWalker), а моды Astral в Enhanced не
 * ставятся (`edition-support.js`): читать его незачем.
 */
async function targetGame() {
  const installations = await detectInstallations();
  /* Мост приложения отдаёт список игр как есть, веб-API — под ключом
     `games`; обе формы принимаются. */
  const games = Array.isArray(installations)
    ? installations
    : installations?.games || [];
  return (
    games.find(
      (game) =>
        game?.path && String(game.edition || "Legacy").toLowerCase() === "legacy",
    ) || null
  );
}

/**
 * Прочитать базу или убедиться, что держим ту же.
 *
 * Одновременные просьбы ждут одну проверку. `readFor` — установка, к которой
 * относится прочитанное (у полки мастерской её нет, у редактора — есть).
 * Отказ главного процесса отдаётся вызвавшему; держимая база при этом не
 * теряется — она верна для того состояния игры, в котором прочитана.
 */
export function loadPtfxBase({ readFor, cachedOnly = false } = {}) {
  if (!hasDesktopBridge()) return Promise.resolve(snapshot);
  if (pending) return pending;
  publish({ loading: !cachedOnly });
  pending = (async () => {
    try {
      const game = await targetGame();
      if (!game) {
        publish({ ...EMPTY });
        return snapshot;
      }
      const known = snapshot.gameRoot === game.path ? snapshot.fingerprint : "";
      const result = await readPtfxBase({
        gameRoot: game.path,
        known,
        ...(cachedOnly ? { cachedOnly: true } : {}),
      });
      if (result?.notCached) {
        publish({ loading: false });
        return snapshot;
      }
      if (result?.unchanged) {
        publish({
          loading: false,
          error: null,
          ...(readFor !== undefined ? { readFor } : {}),
        });
        return snapshot;
      }
      /* Опись ядра принимается и без `bloodfx.dat`: разбор базы попаданий
         может не удаться (чужой редукс, пустой файл), а сказать «слотов
         Astral в ядре нет» надо всё равно. */
      if (result?.bloodfx || result?.core) {
        const { fingerprint = "", ...base } = result;
        publish({
          base: { ...base, gameRoot: game.path },
          gameRoot: game.path,
          fingerprint,
          readFor,
          loading: false,
          error: null,
        });
      } else publish({ loading: false });
      return snapshot;
    } catch (error) {
      publish({ loading: false, error });
      throw error;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/**
 * Папка игры, в которую ставить набор: та, чья база прочитана, а если базу
 * прочитать не вышло (ядро чужой сборки не разбирается) — та же первая Legacy.
 * Редактор работает на эталоне, и «Применить» не должно из-за этого спрашивать
 * папку игры, которую Astral и так знает. `""` — игры не нашлось.
 */
export async function ptfxGameRoot() {
  if (snapshot.gameRoot) return snapshot.gameRoot;
  if (!hasDesktopBridge()) return "";
  try {
    return (await targetGame())?.path || "";
  } catch {
    return "";
  }
}

/*
 * Заранее — пока человек на полке мастерской. Базу уже держим — ничего не
 * делаем: свежесть проверит сам редактор при входе. Отказ здесь молчит: о нём
 * скажет редактор, если в него зайдут.
 */
export function prefetchPtfxBase() {
  if (snapshot.base || pending) return;
  try {
    if (!hasDesktopBridge()) return;
    loadPtfxBase().catch(() => {});
  } catch {
    /* Заранее — значит необязательно: мост без чтения базы не повод
       ронять полку. */
  }
}

/*
 * Только уже прочитанное (18.10.2026) — для обложки огня. Главный процесс
 * отдаёт базу из своей памяти или с диска, а нет её там — отвечает «нет» и
 * архив игры не открывает: чтение update.rpf на старте роняло Astral на
 * редуксах (бета 16.10). База ложится на диск при первом входе в любой
 * редактор эффектов и дальше живёт до смены игры.
 */
export function loadCachedPtfxBase() {
  if (snapshot.base || pending) return pending || Promise.resolve(snapshot);
  try {
    if (!hasDesktopBridge()) return Promise.resolve(snapshot);
    return loadPtfxBase({ cachedOnly: true }).catch(() => snapshot);
  } catch {
    return Promise.resolve(snapshot);
  }
}

/** База и её состояние для React. */
export function usePtfxBase() {
  return useSyncExternalStore(subscribe, peekPtfxBase, peekPtfxBase);
}

/** Для тестов: каждый начинает с окна, в котором базу ещё не читали. */
export function resetPtfxBaseStore() {
  pending = null;
  snapshot = EMPTY;
  for (const listener of listeners) listener();
}
