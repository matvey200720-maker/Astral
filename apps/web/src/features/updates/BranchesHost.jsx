import { useEffect, useMemo, useReducer, useState } from "react";
import { useUiLanguage } from "../../locales/ui.js";
import * as channelsModel from "./channels-model.js";
import { useChannels } from "./channels-store.js";
import { LazyBranchesLayers } from "./lazy-ui.js";
import * as memory from "./memory.js";
import * as model from "./model.js";
import { useUpdates } from "./store.js";

// Сколько ветки должны проработать подряд, прежде чем можно что-то предлагать:
// так предложение не наезжает на заставку и вход.
const QUIET_AFTER_MS = 6000;

/**
 * Признак "окно притихло": взводится после delay мс непрерывной работы и уже
 * не сбрасывается. Если работа прервалась раньше, отсчёт отменяется.
 */
function useQuietFlag(working, delay) {
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    let timer = null;
    if (working && !quiet) {
      timer = setTimeout(() => setQuiet(true), delay);
    }
    return () => clearTimeout(timer);
  }, [working, quiet, delay]);
  return quiet;
}

/**
 * Два действия над памятью, собранные одним вызовом. Память лежит вне
 * хранилища веток, поэтому после записи окно приходится перерисовывать самим.
 */
function useMemoryActions() {
  const [, redraw] = useReducer((turn) => turn + 1, 0);
  return useMemo(() => {
    const writing = (write) => (channel) => {
      write(channel);
      redraw();
    };
    return {
      onHide: writing(memory.hideInstall),
      onLater: writing(memory.dismissOffer),
    };
  }, []);
}

const BranchesHost = () => {
  const channels = useChannels();
  const { state: appState } = useUpdates();
  const language = useUiLanguage();
  const active = Boolean(channels.loaded && channels.state.enabled);
  const quiet = useQuietFlag(active, QUIET_AFTER_MS);
  const actions = useMemoryActions();
  if (!active) return null;

  // Предложение уступает дорогу вопросу о ветке, закрытому доступу и
  // обновлениям приложения (замок, подсказка в углу или сбой).
  const { state, dismissed } = channels;
  const { switchRequest } = state;
  const denied =
    state.denied && !dismissed.includes(state.denied.channel)
      ? state.denied
      : null;
  const roomTaken =
    Boolean(switchRequest) ||
    Boolean(denied) ||
    Boolean(model.describe(appState).locked) ||
    model.promptKind(appState) !== null ||
    Boolean(appState.lastFailure);
  // Сперва идущая установка, потом (когда тихо) кандидат.
  const offer = roomTaken
    ? null
    : channelsModel.installingBranch(state, {
        hidden: memory.isInstallHidden,
      }) ||
      (quiet
        ? channelsModel.offerCandidate(state, {
            dismissed: memory.isOfferDismissed,
          })
        : null);
  return switchRequest || denied || offer ? (
    <LazyBranchesLayers
      {...actions}
      denied={denied}
      language={language}
      offer={offer}
      switchRequest={switchRequest}
    />
  ) : null;
};

export default BranchesHost;
