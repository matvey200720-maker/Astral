import * as copyApi from "./copy.js";
import * as memory from "./memory.js";
import * as model from "./model.js";
import * as store from "./store.js";
import { createPortal } from "react-dom";
import { useOverlayHost } from "./overlay-host.js";
import WhatsNewDialog from "./WhatsNewDialog.jsx";
import UpdateFailureDialog from "./UpdateFailureDialog.jsx";
import UpdatePrompt from "./UpdatePrompt.jsx";
import UpdateLock from "./UpdateLock.jsx";

// Главное действие карточки и окна «Что нового» одно: [ключ подписи, метод хранилища].
const mainAction = (kind) => (kind === "ready" ? ["restart", "apply"] : ["download", "download"]);

const makePrimary = (copy, kind) => {
  const [word, call] = mainAction(kind);
  return {
    label: copy.actions[word],
    onClick: () => {
      store.updateActions[call]();
    },
  };
};

// Карточка в углу: её кнопки говорят хосту через обработчики слоя.
const PromptCard = ({ layer, primary }) => {
  const { candidate, language, promptKind, state } = layer;
  // «Скрыть» прячет ход только в памяти запуска, «Позже» — на 12 часов в хранилище.
  const hide = promptKind === "downloading" ? memory.hideProgress : memory.snooze;
  return (
    <UpdatePrompt
      onWhatsNew={() => layer.onOpenRelease(candidate)}
      onPrimary={primary.onClick}
      onLater={() => {
        hide(candidate);
        layer.onSnoozed();
      }}
      notice={layer.notice}
      language={language}
      kind={promptKind}
      facts={model.describe(state).facts}
      canShowNotes={Boolean(candidate && model.pickNotes(candidate.notes, language))}
      candidate={candidate}
    />
  );
};

const UpdatesLayers = (props) => {
  const { state, notice, language, locked, promptKind, release, afterUpdate } = props;
  const host = useOverlayHost();
  const failure = state.lastFailure;
  const primary = promptKind ? makePrimary(copyApi.updatesCopyFor(language), promptKind) : null;
  // Пока открыто любое окно, карточка в углу молчит: внимание человека занято окном.
  const quiet = !(locked || failure || afterUpdate || release);

  // Порядок слоёв = порядок монтирования порталов. Замок перекрывает остальное;
  // «после обновления» уступает записи о неудаче, окно по просьбе — нет.
  return [
    locked && <UpdateLock key="lock" state={state} notice={notice} language={language} />,
    !locked && failure && <UpdateFailureDialog key="failure" language={language} failure={failure} />,
    !locked && !failure && afterUpdate && (
      <WhatsNewDialog
        key="after"
        release={afterUpdate}
        onClose={props.onCloseAfterUpdate}
        language={language}
        justUpdated
      />
    ),
    !locked && release && (
      <WhatsNewDialog
        key="release"
        release={release}
        primary={primary}
        onClose={props.onCloseRelease}
        language={language}
      />
    ),
    // Карточке окно не нужно, её слой — оверлей оболочки или, пока оболочки нет, корень приложения.
    promptKind && quiet && host && createPortal(<PromptCard layer={props} primary={primary} />, host, "card"),
  ];
};

export default UpdatesLayers;
