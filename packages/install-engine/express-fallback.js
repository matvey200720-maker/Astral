// Откат экспресс-установки на старый путь (19.11.2026, работа «Astral быстрее», `INSTALL-RUST-EXPRESS.md` §14).
//
// Экспресс-путь (`express-dlc.js`, `express-item.js`) строит свой dlc движком сразу в игре. Любая его ошибка — отказ движка,
// сбой процесса, неясный ответ, отказ сверки построенного, имя в доме сборок не встало — раньше была ошибкой установки.
// Теперь транзакция по-прежнему откатывает всё снимками журнала (игра как была, недостроенное убрано), а установка ставит
// тот же пакет прежним путём: сборщиком в доме сборок, сверкой до подмены и подменой. Человек ошибки не видит; приложение
// получает строку для журнала (`expressInstall.onFallback`). Отмена не откатывается на прежний путь: это отмена.
//
// Модуль чистый и ничего не делает, пока в установке нет экспресс-сборок: `beginExpressFallback` отдаёт `null`.
import { deferredBuildFor, materializeDeferredBuild, registerDeferredBuild } from "./ops-build.js";

/** Метка, которую `transaction.js` вешает на ошибку экспресс-фазы: `{ target }`; отмена и чужие ошибки её не несут. */
export const expressFailureOf = (error) => (error && typeof error === "object" && error.expressFailure && typeof error.expressFailure === "object" ? error.expressFailure : null);

/** Откатываем ли на прежний путь: ошибка экспресс-фазы, и установку не отменяли. */
export const shouldFallBack = (error, signal = null) => signal?.aborted !== true && expressFailureOf(error) !== null;

/*
 * Экспресс-фаза вписывает в итоговое состояние два места на каждый пакет: отпечаток верхнего слоя и запись «последней сборки»
 * (отпечаток, метка `express`, снятая метка `deferred`). Прежний сборщик ведёт то же состояние через замыкание, которое держит
 * эти же объекты, — поэтому возвращать их надо на месте (не подменять копией), иначе его отпечаток уйдёт в пустоту.
 */
function stateHooksOf(next, build) {
  const target = next?.targets?.[build.targetKey];
  const resource = target?.resources?.[build.archiveTarget];
  const layer = Array.isArray(resource?.layers) ? resource.layers.at(-1) : null;
  const built = target?.archives?.[build.archiveTarget]?.lastBuilt;
  return [layer, built].filter((object) => object && typeof object === "object").map((object) => ({ object, saved: { ...object } }));
}

function restoreInPlace({ object, saved }) {
  for (const key of Object.keys(object)) delete object[key];
  Object.assign(object, saved);
}

/**
 * Перед транзакцией: запомнить, что откатывать. `express` — элементы списка установки, которые берёт экспресс-путь; их
 * отложенные сборки транзакция забирает, поэтому запросы запоминаются здесь, чтобы прежний путь мог их исполнить.
 */
export function beginExpressFallback({ express, next }) {
  if (!express?.size) return null;
  const builds = [...express].map((item) => ({ item, build: deferredBuildFor(item.sourcePath) })).filter((entry) => entry.build);
  if (builds.length !== express.size) return null;
  const hooks = builds.flatMap(({ build }) => stateHooksOf(next, build));
  return {
    /** Вернуть состояние и запросы сборки, собрать пакеты прежним способом. Ничего не пишет в игру: она уже откачена. */
    async fallBack({ error, onFallback = null }) {
      for (const hook of hooks) restoreInPlace(hook);
      for (const { item, build } of builds) {
        if (!deferredBuildFor(item.sourcePath)) registerDeferredBuild(item.sourcePath, build);
        delete item.verifyBuilt;
      }
      try {
        await onFallback?.({ target: expressFailureOf(error)?.target || "", reason: String(error?.message || error), code: error?.code ?? null, error });
      } catch {
        /* журнал не должен ронять установку */
      }
      for (const { item } of builds) await materializeDeferredBuild(item.sourcePath);
    },
  };
}
