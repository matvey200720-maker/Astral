import Dialog from "../../components/ui/Dialog.jsx";
import * as store from "./channels-store.js";
import Button from "../../components/ui/Button.jsx";
import * as dict from "./branches-copy.js";
import VersionText from "./VersionText.jsx";
import * as React from "react";

// Свойства окна, общие для всех показов.
const FRAME = {
  size: "sm",
  role: "alertdialog",
  className: "updates-dialog branches-dialog",
  backdropClassName: "updates-backdrop",
  titleId: "branches-denied-title",
  descriptionId: "branches-denied-text",
};
const CLS = { list: "branches-alt", name: "branches-alt-copy", detail: "branches-detail" };
const NOTICE = { className: "updates-notice", role: "status" };

// Прежняя ветка всё равно непригодна, поэтому вопроса о закрытии нет: confirm: false.
// Блокировки на время ответа нет: два быстрых нажатия дают два вызова (так и было).
const START = {
  open: (channel) => store.channelActions.open(channel, { confirm: false }),
  install: (channel) => store.channelActions.install(channel),
};

const latest = (_, next) => next;

// Подпись под именем: у установленной номер не показываем никогда, у доступной он в тексте.
function Caption({ alt, words }) {
  const { installed, name, version } = alt;
  const tag = installed ? words.installedTag : version && words.availableTag(version);
  const text = <VersionText text={tag || ""} versions={installed ? [] : [version]} />;
  return (
    <span className={CLS.name}>
      <b>{name}</b>
      <small>{text}</small>
    </span>
  );
}

function Choices({ alts, words, onPick }) {
  const row = (alt) => {
    const { channel, installed, name } = alt;
    return (
      <li key={channel} data-branch={channel}>
        <Caption alt={alt} words={words} />
        <Button onClick={() => onPick(alt)} variant={installed ? "primary" : "secondary"} size="sm">
          {words[installed ? "open" : "install"](name)}
        </Button>
      </li>
    );
  };
  // Нет ни одной альтернативы: подсказка писать тому, кто выдаёт доступ.
  if (!alts.length) return <p className={CLS.detail}>{words.none}</p>;
  const items = alts.map(row);
  return (
    <>
      <p className={CLS.detail}>{words.openHint}</p>
      <ul className={CLS.list}>{items}</ul>
    </>
  );
}

const BranchDeniedDialog = (props) => {
  const { denied: access } = props;
  const copy = dict.branchesCopyFor(props.language);
  const { actions, denied: words } = copy;
  const [note, say] = React.useReducer(latest, "");

  // Закрытый экран не возвращается до конца запуска: это память, не localStorage
  // (docs/beta/channels-launcher.md, §3 и §5), поэтому моста закрытие не зовёт.
  const dismiss = () => store.channelActions.dismissDenied(access.channel);

  const pick = async (alt) => {
    say("");
    const answer = await START[alt.installed ? "open" : "install"](alt.channel);
    say(answer?.started === false ? dict.branchNoticeCopy(copy, answer.reason) : "");
  };

  const dialog = {
    ...FRAME,
    title: words.title(access.name),
    closeLabel: actions.close,
    onClose: dismiss,
    actions: (
      <Button onClick={dismiss} variant="ghost">
        {actions.ok}
      </Button>
    ),
  };
  return (
    <Dialog {...dialog}>
      <p id={FRAME.descriptionId}>{words.text}</p>
      <Choices words={words} onPick={pick} alts={access.alternatives} />
      {note ? <p {...NOTICE}>{note}</p> : null}
    </Dialog>
  );
};

export default BranchDeniedDialog;
