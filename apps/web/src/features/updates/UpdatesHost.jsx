import { useEffect, useMemo, useReducer, useRef } from "react";
import { useUiLanguage } from "../../locales/ui.js";
import { noteBuild } from "../downloads/build-id.js";
import { LazyUpdatesCard, LazyUpdatesLayers } from "./lazy-ui.js";
import * as memory from "./memory.js";
import * as model from "./model.js";
import * as store from "./store.js";

// Пока окно не оглядится, главному процессу о готовности не пишем.
const READY_DELAY_MS = 1200;
// Заметки "Что нового" всплывают не сразу, а когда интерфейс уже прорисован.
const NOTES_DELAY_MS = 2500;

const NOTHING_OPEN = { afterUpdate: null, release: null };
const mergeOpen = (current, patch) => ({ ...current, ...patch });

/**
 * Что делает окно при входе, пока обновления включены. Сделанное помним на
 * экземпляре, а не в эффекте: выключение и включение не повторяют его.
 * Язык для заметок берём последний: он мог смениться, пока ответ был в пути.
 */
function useEntrySteps(active, languageNow, patchOpen) {
  const done = useRef({ ready: false, versionMatched: false });
  const language = useRef(languageNow);
  useEffect(() => {
    language.current = languageNow;
  });

  useEffect(() => {
    if (!active) return undefined;
    LazyUpdatesCard.preload();
    let stale = false;
    let notesTimer;
    const readyTimer = done.current.ready
      ? undefined
      : setTimeout(() => {
          done.current.ready = true;
          store.updateActions.ready();
        }, READY_DELAY_MS);
    if (!done.current.versionMatched) {
      store.updateActions.installed().then((release) => {
        if (stale || !release?.version) return;
        const { version, build } = release;
        noteBuild(`${version}+${build || ""}`);
        done.current.versionMatched = true;
        const before = memory.seenVersion();
        memory.markSeen(version);
        if (
          before &&
          before !== version &&
          model.hasReleaseNotes(release, language.current)
        ) {
          notesTimer = setTimeout(
            () => patchOpen({ afterUpdate: release }),
            NOTES_DELAY_MS,
          );
        }
      });
    }
    return () => {
      stale = true;
      clearTimeout(readyTimer);
      clearTimeout(notesTimer);
    };
  }, [active, patchOpen]);
}

/** Действия слоя; пустая правка даёт новое состояние и пересчитывает подсказку. */
const bindHandlers = (patchOpen) => ({
  onCloseAfterUpdate: () => patchOpen({ afterUpdate: null }),
  onCloseRelease: () => patchOpen({ release: null }),
  onOpenRelease: (release) => patchOpen({ release }),
  onSnoozed: () => patchOpen({}),
});

const UpdatesHost = () => {
  const language = useUiLanguage();
  const { loaded, notice, state } = store.useUpdates();
  const view = model.describe(state);
  const kind = model.promptKind(state, {
    progressHidden: memory.isProgressHidden(view.candidate),
    snoozed: memory.isSnoozed(view.candidate),
  });

  const [open, patchOpen] = useReducer(mergeOpen, NOTHING_OPEN);
  useEntrySteps(Boolean(loaded) && view.mode !== "off", language, patchOpen);
  const handlers = useMemo(() => bindHandlers(patchOpen), []);

  const somethingToShow =
    view.locked ||
    state.lastFailure ||
    open.afterUpdate ||
    open.release ||
    kind !== null;
  return somethingToShow ? (
    <LazyUpdatesLayers
      {...handlers}
      afterUpdate={open.afterUpdate}
      candidate={view.candidate}
      language={language}
      locked={view.locked}
      notice={notice}
      promptKind={kind}
      release={open.release}
      state={state}
    />
  ) : null;
};

export default UpdatesHost;
