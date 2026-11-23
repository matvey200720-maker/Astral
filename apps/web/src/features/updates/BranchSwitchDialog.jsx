import { branchesCopyFor as copyFor } from "./branches-copy.js";
import Dialog from "../../components/ui/Dialog.jsx";
import * as store from "./channels-store.js";
import Button from "../../components/ui/Button.jsx";

// Общие свойства окна-вопроса; заголовок, тексты и ответы добавляет сам компонент.
const FRAME = {
  size: "sm",
  role: "alertdialog",
  className: "updates-dialog branches-dialog",
  backdropClassName: "updates-backdrop",
  titleId: "branches-switch-title",
  descriptionId: "branches-switch-text",
};

function BranchSwitchDialog({ language, request }) {
  const { actions: shared, switch: prompt } = copyFor(language);
  const { fromName, id, toName } = request;
  const answer = (verdict) => () => store.channelActions.answer(id, verdict);
  const stay = answer(false);
  const confirmLabel = prompt.confirm(toName);
  const buttons = [
    <Button key={prompt.stay} onClick={stay} variant="ghost">
      {prompt.stay}
    </Button>,
    <Button key={confirmLabel} onClick={answer(true)} variant="primary">
      {confirmLabel}
    </Button>,
  ];
  return (
    <Dialog {...FRAME} actions={buttons} closeLabel={shared.close} onClose={stay} title={prompt.title(toName)}>
      <p id={FRAME.descriptionId}>{prompt.text(fromName, toName)}</p>
      <p className="branches-detail">{prompt.detail}</p>
    </Dialog>
  );
}

export default BranchSwitchDialog;
