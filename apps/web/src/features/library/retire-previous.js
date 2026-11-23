import {
  planLibraryRemoval,
  removeFromLibrary,
  retirePreviousInstalls,
} from "../../api.js";
import { applyLibraryRemovalResult } from "../../workshop-library.js";
import { tr } from "../../locales/ui.js";

/*
 * Смена версии работы и откат из редактора — через ту же стопку, что и
 * корзина библиотеки.
 *
 * Редактор ставит новую версию работы поверх прежней. Прежняя остаётся в
 * стопке точек отката: два гигабайта на диске и ловушка — удаление новой
 * версии вернуло бы в игру не чистый файл, а прежнюю версию. Здесь прежние
 * версии уходят сразу после установки новой: если новая закрывает их
 * целиком, приложение просто сливает точки, иначе снимает прежние обычным
 * удалением из библиотеки.
 *
 * Откат из редактора раньше шёл прямо в хост, который умеет снять только
 * верхнюю точку: мини-карта под поставленным позже прицелом не откатывалась
 * вовсе. Теперь откат — это удаление одной работы из библиотеки, с перемоткой
 * и возвратом того, что лежит сверху.
 *
 * Оба пути сразу переписывают записи установок в хранилище, в том числе
 * записи других работ, если их пришлось поставить заново под новыми именами
 * точек.
 */

const GONE = new Set(["squashed", "remove", "forget", "missing"]);

const nativeOf = (install) => ({
  restorePointId: String(install?.restorePointId || ""),
  patch: String(install?.patch || ""),
});

/**
 * @returns {Promise<{ result: object, gone: Set<string>, remap: object } | null>}
 *   `gone` — имена точек прежних версий, которых больше нет; `remap` — новые
 *   имена точек, в том числе у только что поставленной версии.
 */
export async function retireReplacedInstalls({
  gameRoot = "",
  successorId,
  previous = [],
}) {
  const natives = previous
    .map(nativeOf)
    .filter(
      (install) =>
        install.restorePointId && install.restorePointId !== successorId,
    );
  if (!successorId || !natives.length) return null;
  const result = await retirePreviousInstalls({
    ...(gameRoot ? { gameRoot } : {}),
    successor: { restorePointId: successorId },
    natives,
  });
  if (!result) return null;
  applyLibraryRemovalResult(globalThis.localStorage, result);
  return {
    result,
    gone: new Set(
      (result.natives || [])
        .filter((item) => GONE.has(item.action))
        .map((item) => item.restorePointId),
    ),
    remap: result.remap || {},
  };
}

/**
 * Новая версия не встала обратно, когда убирали прежнюю (бета 15.10,
 * kevake): она в `lost` и под новым именем не появилась. Окно стёрло бы её
 * запись молча — вызывающий показывает ошибку.
 */
export function successorLost(retired, successorId) {
  if (!retired || !successorId || retired.remap?.[successorId]) return false;
  return (retired.result?.lost || []).some((item) => item?.restorePointId === successorId);
}

export const SUCCESSOR_LOST_MESSAGE =
  "Новая версия не встала в игру, когда Astral убирал прежнюю. Нажмите «Применить» ещё раз.";

/**
 * Откат установок работы — одной или нескольких сразу (прежние версии,
 * оставшиеся стопкой до того, как новая версия стала заменять прежнюю).
 * Мод слоя Astral рядом с точкой (`layerModId`, у фонарей — модели пакетом
 * движка) снимается той же операцией: половина работы в игре — это не откат.
 * Бросает, если снять нельзя, — вызывающий показывает причину человеку.
 */
function rollBackRequest({ gameRoot = "", install, installs }) {
  const list = installs || [install];
  const natives = list.map(nativeOf).filter((item) => item.restorePointId);
  const mods = [
    ...new Set(
      list.map((item) => String(item?.layerModId || "")).filter(Boolean),
    ),
  ];
  if (!natives.length && !mods.length)
    throw new Error("Установка без точки отката.");
  return {
    ...(gameRoot ? { gameRoot } : {}),
    natives,
    ...(mods.length ? { mods } : {}),
  };
}

/**
 * Что помешает откату — по плану библиотеки, без записи в игру. Ошибка
 * отката до окна доходит только текстом: код через мост окна не проходит.
 *
 * `problems` — коды отказа всего плана (`backup-missing` — копии архива под
 * точкой нет, `replay-unavailable`, `space`, …); `stuck` — причины, по
 * которым точку не снять перемоткой (`buried`, `unknown`,
 * `foreign-archive`): архив пересобирали мимо цепочки точек.
 */
export async function rollBackPlan({ gameRoot = "", install, installs }) {
  const plan = await planLibraryRemoval(
    rollBackRequest({ gameRoot, install, installs }),
  );
  return {
    problems: (plan?.problems || []).map((problem) => problem.code),
    stuck: (plan?.natives || [])
      .filter((item) => item.action === "blocked")
      .map((item) => item.reason || "unknown"),
  };
}

export async function rollBackInstall({ gameRoot = "", install, installs }) {
  const result = await removeFromLibrary(
    rollBackRequest({ gameRoot, install, installs }),
  );
  const blocked = (result?.natives || []).find(
    (item) => item.action === "blocked",
  );
  if (blocked) {
    const error = new Error(blocked.message || tr("Эту установку сейчас снять нельзя."));
    /* Причина — для того, кто снимает пачку работ (сборка): «погребена» — это не поломка,
       а архив, пересобранный поверх; такие работы выводятся из строя иначе, чем сбой записи. */
    error.reason = String(blocked.reason || "");
    throw error;
  }
  /* Точки на диске нет, а другого способа снять работу у записи нет: что
     осталось в игре, неизвестно. Молча «снято» — неправда; запись остаётся,
     а человеку — путь, который снимает всё (Т-162). */
  const natives = result?.natives || [];
  const removedMods = (result?.mods || []).filter((item) => item?.action === "remove");
  if (natives.length && natives.every((item) => item?.action === "missing") && !removedMods.length) {
    const error = new Error(
      "Копии архива под этой работой на диске нет — снять её отдельно нельзя. Верните GTA V без модов: Настройки → Обслуживание.",
    );
    error.reason = "missing";
    throw error;
  }
  applyLibraryRemovalResult(globalThis.localStorage, result);
  const failed = (result?.failedMods || [])[0];
  if (failed)
    throw new Error(
      failed.message || failed.error || tr("Часть установки снять не удалось."),
    );
  return result;
}
