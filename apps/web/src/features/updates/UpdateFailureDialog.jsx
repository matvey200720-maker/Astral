import { default as Dialog } from "../../components/ui/Dialog.jsx";
import * as words from "./copy.js";
import * as store from "./store.js";
import Button from "../../components/ui/Button.jsx";

// Любой способ закрыть окно (кнопка, крестик, Esc, подложка) стирает запись о неудаче;
// само окно уходит, когда UpdatesLayers увидит снимок без lastFailure.
const closeAll = () => {
  store.updateActions.dismissFailure();
};

// Слова причины и сам код; незнакомый код показываем как есть, чтобы поддержка его видела.
const reasonLine = (copy, code) => {
  const known = words.reasonCopy(copy, code);
  const codeTag = <code key="code">{code}</code>;
  return known ? [known, " (", codeTag, ")"] : [codeTag];
};

function UpdateFailureDialog({ failure, language }) {
  const copy = words.updatesCopyFor(language);
  const { actions, failed } = copy;
  const { reason, restored, version } = failure;
  const reasonBlock = reason ? (
    <p className="updates-failure-reason">
      {`${failed.reason}: `}
      {reasonLine(copy, reason)}
    </p>
  ) : null;
  const buttons = [
    <Button key={actions.ok} onClick={closeAll} variant="primary">
      {actions.ok}
    </Button>,
  ];
  return (
    <Dialog
      actions={buttons}
      backdropClassName="updates-backdrop"
      className="updates-dialog updates-failure-dialog"
      closeLabel={actions.close}
      descriptionId="updates-failure-text"
      onClose={closeAll}
      role="alertdialog"
      size="sm"
      title={failed.title}
      titleId="updates-failure-title"
    >
      <p id="updates-failure-text">{failed.text(version, restored)}</p>
      {reasonBlock}
      <p className="updates-failure-logs">{failed.logs}</p>
    </Dialog>
  );
}

export default UpdateFailureDialog;
