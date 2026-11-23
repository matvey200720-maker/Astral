import * as React from "react";
import Button from "../../components/ui/Button.jsx";
import * as dict from "./branches-copy.js";
import UpdateBar from "./UpdateBar.jsx";
import * as flow from "./channels-model.js";
import UpdateOrbit from "./UpdateOrbit.jsx";
import * as store from "./channels-store.js";
import VersionText from "./VersionText.jsx";
import * as updatesCopy from "./copy.js";
import * as format from "./format.js";
import * as memory from "./memory.js";

const ROOT = { role: "dialog", "aria-modal": "false" };
const STATUS = { role: "status" };
const TITLE_KEY = { "handing-off": "handingOffTitle", verify: "verifyingTitle" };

const latest = (_, next) => next;

// Строка с номером версии, который не должен переноситься.
const versioned = (text, version) => <VersionText text={text} versions={[version]} />;

// «Установить рядом» и «Повторить» делают одно: вернуть карточку, позвать установку,
// а на отказ с понятной причиной показать заметку. Заметка живёт, пока вид не сменится.
function useInstallStart(channel, copy) {
  const [note, say] = React.useReducer(latest, "");
  const start = async () => {
    say("");
    memory.showInstall(channel);
    const answer = await store.channelActions.install(channel);
    say(answer?.started === false ? dict.branchNoticeCopy(copy, answer.reason) : "");
  };
  return [note, start];
}

// Этап хода установки; от него зависят заголовок, знак и полоса.
function stageOf(busy, facts) {
  if (busy.phase === "handing-off") return "handing-off";
  if (facts?.stage === "verify") return "verify";
  return busy.phase === "checking" || !facts ? "prepare" : "download";
}

// Каждый вид описывает себя: корень, знак, строки текстового блока и кнопки. Строка —
// [тег или компонент, свойства, содержимое]; пустая (ложная) строка не рисуется.
const MODELS = {
  offer({ branch, copy, note, start, onLater }) {
    const { name, available } = branch;
    const { offer } = copy;
    const version = available?.version ?? "";
    return {
      root: { className: "update-prompt branch-offer", "aria-label": offer.label, "data-kind": "offer" },
      orbit: { kind: "idle" },
      lines: {
        head: ["b", null, offer.title(name)],
        text: ["span", null, versioned(offer.text(name, version), version)],
        note: note && ["em", STATUS, note],
      },
      buttons: [
        ["ghost", offer.later, onLater],
        ["primary", offer.install, start],
      ],
    };
  },

  run(ctx) {
    const { branch, copy, language, onHide } = ctx;
    const words = copy.installing;
    const { available, busy, name } = branch;
    const facts = flow.busyFacts(busy);
    const stage = stageOf(busy, facts);
    // Подготовка и передача — без цифр для полосы: знак «ждёт», полосы нет.
    const waiting = stage === "handing-off" || stage === "prepare";
    const title = words[TITLE_KEY[stage] ?? (facts ? "title" : "preparingTitle")](name);
    const progress =
      facts && stage !== "handing-off"
        ? format.transferLines(facts, language, updatesCopy.updatesCopyFor(language))
        : {};
    const { line = "", note = "" } = progress;
    const version = facts?.version ?? available?.version ?? "";
    const percent = (stage === "verify" ? facts.verifyPercent : busy.percent) ?? 0;
    return {
      root: {
        className: "update-prompt update-prompt-transfer branch-offer",
        "aria-label": words.label,
        "data-kind": "install",
        "data-stage": stage,
      },
      orbit: { kind: waiting ? "wait" : "progress", value: (busy.percent ?? 0) / 100 },
      lines: {
        head: ["b", null, title],
        text: version && ["span", null, versioned(`${name} ${version}`, version)],
        line: [
          "span",
          { className: "update-prompt-line" },
          stage === "handing-off" ? words.handingOff : line || (waiting ? words.preparing : ""),
        ],
        bar: !waiting && [UpdateBar, { percent, label: title }],
        foot: note ? ["em", STATUS, note] : ["small", null, words.hideNote(copy.heading)],
      },
      buttons: [["ghost", words.hide, onHide]],
    };
  },

  fail({ branch, copy, note, start, onHide }) {
    const { installing: words, actions } = copy;
    return {
      root: { className: "update-prompt branch-offer", "aria-label": words.label, "data-kind": "install-error" },
      orbit: { kind: "error" },
      lines: {
        head: ["b", null, words.failedTitle(branch.name)],
        text: ["span", null, dict.branchErrorCopy(copy, branch.busy.error)],
        note: note && ["em", STATUS, note],
      },
      buttons: [
        ["ghost", actions.close, onHide],
        ["primary", actions.retry, start],
      ],
    };
  },
};

function Card(props) {
  const { branch, kind } = props;
  const copy = dict.branchesCopyFor(props.language);
  const [note, start] = useInstallStart(branch.channel, copy);
  const view = MODELS[kind]({ ...props, copy, note, start });
  const rows = Object.entries(view.lines).filter(([, row]) => row);
  return (
    <section {...ROOT} {...view.root} data-branch={branch.channel}>
      <UpdateOrbit size="sm" {...view.orbit} />
      <div className="update-prompt-copy">
        {rows.map(([key, [Tag, attrs, content]]) => (
          <Tag key={key} {...attrs}>
            {content}
          </Tag>
        ))}
      </div>
      <div className="update-prompt-actions">
        {view.buttons.map(([variant, label, onClick]) => (
          <Button size="sm" key={label} variant={variant} onClick={onClick}>
            {label}
          </Button>
        ))}
      </div>
    </section>
  );
}

// Вид решает занятость ветки: чужое по роду (обновление) — всё ещё предложение.
function viewKey(busy) {
  if (!busy || busy.kind !== "install") return "offer";
  return busy.phase === "error" ? "fail" : "run";
}

const BranchOffer = (props) => {
  const kind = viewKey(props.branch.busy);
  return <Card key={kind} {...props} kind={kind} />;
};

export default BranchOffer;
