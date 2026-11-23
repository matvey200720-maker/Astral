import * as React from "react";
import Button from "../../components/ui/Button.jsx";
import * as icons from "../../components/ui/icons.jsx";
import UpdateBar from "./UpdateBar.jsx";
import * as dict from "./branches-copy.js";
import VersionText from "./VersionText.jsx";
import * as model from "./channels-model.js";
import * as store from "./channels-store.js";
import * as updatesCopy from "./copy.js";
import * as format from "./format.js";

const CLS = {
  copy: "settings-row-copy",
  control: "settings-row-control",
  chip: "updates-chip",
};
const PHASE_WORD = new Map([
  ["handing-off", "handingOff"],
  ["applying", "applying"],
]);

const merge = (prev, patch) => ({ ...prev, ...patch });

// Основная строка занятой ветки — по фазе; цифры хода сокращают её до этапа.
function busyHeadline(words, { phase, percent }, facts) {
  if (phase !== "downloading")
    return words[PHASE_WORD.get(phase) ?? "checking"];
  if (!facts) return words.downloading(percent);
  return facts.stage === "verify" ? words.verifying : words.downloading(null);
}

// Доступную версию называем, только если она отличается от установленной.
function offeredVersion({ installed, available }) {
  const offered = available?.version;
  return offered && offered !== installed?.version ? offered : undefined;
}

function headline(kind, copy, branch, facts) {
  const { available, busy, installed } = branch;
  const { line } = copy;
  const byKind = new Map([
    ["available", () => line.available(available?.version)],
    ["current", () => line.current(installed?.version)],
    ["denied", () => line.denied(Boolean(installed))],
    ["error", () => dict.branchErrorCopy(copy, busy.error)],
    [
      "installed",
      () => line.installed(installed?.version, offeredVersion(branch)),
    ],
  ]);
  const pick = byKind.get(kind);
  return pick ? pick() : busyHeadline(copy.busy, busy, facts);
}

// Чип у названия: открытая, стоящая рядом и та, у которой доступ снят, а файлы остались.
function chipKeyOf(kind, installed) {
  if (kind === "current") return "current";
  return kind === "installed" || (kind === "denied" && installed)
    ? "installed"
    : null;
}

// Полоса бывает только у занятой ветки; при проверке файлов она показывает проверку.
function barPercent(kind, facts, busy) {
  if (kind !== "busy") return null;
  if (facts?.stage === "verify") return facts.verifyPercent ?? 0;
  return busy.percent;
}

// Строки текстового блока — [тег или компонент, свойства, содержимое]; пустая не рисуется.
function renderLines(rows) {
  const filled = Object.entries(rows).filter(([, row]) => row);
  return filled.map(([key, [Tag, attrs, content]]) => (
    <Tag key={key} {...attrs}>
      {content}
    </Tag>
  ));
}

// Строка настроек: слева текст, справа (если передано) управление.
function Line(props) {
  const { cls, attrs, live, control, rows } = props;
  return (
    <div className={`settings-row ${cls}`} {...attrs}>
      {cls === "branches-row" ? (
        <span className="settings-row-icon" aria-hidden="true">
          <icons.Stack />
        </span>
      ) : null}
      <span className={CLS.copy} aria-live={live}>
        {renderLines(rows)}
      </span>
      {control === undefined ? null : (
        <span className={CLS.control}>{control}</span>
      )}
    </div>
  );
}

function Row(props) {
  const { branch, copy, language } = props;
  const { channel, installed, available, busy, name } = branch;
  const kind = model.branchKind(branch);
  const action = model.branchAction(branch);
  const facts = kind === "busy" ? model.busyFacts(busy) : null;
  const flow = facts
    ? format.transferLines(
        facts,
        language,
        updatesCopy.updatesCopyFor(language),
      )
    : {};
  const chipKey = chipKeyOf(kind, installed);
  const percent = barPercent(kind, facts, busy);
  // Номера версий оборачиваем только в этих видах: в «Скачиваем… 42 %» искать нечего.
  const versions = ["current", "installed", "available"].includes(kind)
    ? [installed?.version, available?.version]
    : [];
  const notice = { className: "updates-notice", role: "status" };
  const rows = {
    head: [
      "b",
      null,
      [
        name,
        chipKey && (
          <span key="chip" className={CLS.chip}>
            {copy.chip[chipKey]}
          </span>
        ),
      ],
    ],
    text: [
      "small",
      null,
      <VersionText
        text={headline(kind, copy, branch, facts)}
        versions={versions}
      />,
    ],
    flow: flow.line && ["small", null, flow.line],
    bar: percent !== null && [UpdateBar, { percent, label: name }],
    hint: flow.note && ["small", notice, flow.note],
    note: props.note && ["small", notice, props.note],
  };
  const label = copy.actions[action];
  const button = action ? (
    <Button
      size="sm"
      onClick={() => props.onPress(channel, action)}
      icon={action === "retry" ? <icons.ArrowClockwise /> : undefined}
      variant={action === "install" ? "primary" : undefined}
    >
      {label}
    </Button>
  ) : null;
  const attrs = {
    "data-setting": `branch-${channel}`,
    "data-kind": kind,
    "data-branch": channel,
  };
  const line = {
    cls: "branches-row",
    live: "polite",
    attrs,
    control: button,
    rows,
  };
  return <Line {...line} />;
}

function footText(state, copy, language) {
  const { knownAt } = state;
  let when = copy.neverRefreshed;
  if (knownAt)
    when = copy.refreshed(format.formatWhen(knownAt, language, copy));
  return model.hasOtherBranches(state) ? when : `${when} · ${copy.none}`;
}

const BranchesCard = (props) => {
  const { language } = props;
  const { loaded, state } = store.useChannels();
  // Заметка относится к одному нажатию и не живёт дольше карточки, поэтому не в хранилище.
  const [{ note, refreshing }, patch] = React.useReducer(merge, {
    note: null,
    refreshing: false,
  });
  const copy = dict.branchesCopyFor(language);
  if (!(loaded && state.enabled)) return null;

  const press = async (channel, action) => {
    patch({ note: null });
    const answer =
      await store.channelActions[action === "open" ? "open" : "install"](
        channel,
      );
    const text =
      answer?.started === false
        ? dict.branchNoticeCopy(copy, answer.reason)
        : "";
    if (text) patch({ note: { channel, text } });
  };

  // Кнопка шапки заперта, пока идёт запрос, чтобы нажатия не копились.
  const refresh = async () => {
    patch({ note: null, refreshing: true });
    await store.channelActions
      .refresh()
      .finally(() => patch({ refreshing: false }));
  };

  const refreshLabel = copy.actions.refresh;
  const renderBranch = (branch) => {
    const own = note?.channel === branch.channel;
    return (
      <Row
        {...{ branch, copy, language }}
        key={branch.channel}
        note={own ? note.text : ""}
        onPress={press}
      />
    );
  };
  return (
    <section
      className="settings-group branches-group"
      data-setting-group="branches"
    >
      <div className="branches-group-head" data-setting="branches">
        <span className="branches-group-copy">
          <span className="settings-group-title" data-audit-ignore="caps">
            {copy.heading}
          </span>
          <small>{copy.lead}</small>
        </span>
        <Button
          onClick={refresh}
          disabled={refreshing}
          size="sm"
          icon={<icons.ArrowClockwise />}
        >
          {refreshLabel}
        </Button>
      </div>
      <div className="settings-card branches-card">
        {model.visibleBranches(state).map(renderBranch)}
        <Line
          cls="branches-foot"
          attrs={{ "data-setting": "branches-info" }}
          rows={{ foot: ["small", null, footText(state, copy, language)] }}
        />
      </div>
    </section>
  );
};

export default BranchesCard;
