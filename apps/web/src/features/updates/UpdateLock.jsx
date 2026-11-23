import * as copyApi from "./copy.js";
import * as formatApi from "./format.js";
import * as modelApi from "./model.js";
import * as statusApi from "./status.js";
import * as storeApi from "./store.js";
import { useEffect } from "react";
import { default as Dialog } from "../../components/ui/Dialog.jsx";
import UpdateSteps from "./UpdateSteps.jsx";
import { default as UpdateOrbit } from "./UpdateOrbit.jsx";
import UpdateBar from "./UpdateBar.jsx";
import Button from "../../components/ui/Button.jsx";
import VersionText from "./VersionText.jsx";

// Нет сети или сервер молчит: экран сам повторяет попытку (docs/beta/release-channels.md).
const RETRY_AFTER_MS = 30000;
const STEP_MODES = ["downloading", "ready", "applying"];
const none = () => {};

// Исход экрана; условия проверяются сверху вниз.
const outcomeOf = (mode, noticeKind) => {
  if (mode === "error") return "failed";
  if (mode === "ready" && (noticeKind === "helper" || noticeKind === "failed")) return "stuck";
  return mode === "ready" || mode === "applying" ? "restart" : "wait";
};

// Слова исхода: [заголовок, основной текст, подсказка, вид орбиты].
const WORDS = {
  failed: (c, x) => [
    c.lock.failed,
    copyApi.errorCopy(c, x.err?.code)[0],
    `${statusApi.errorHint(x.err, c, x.language)} ${c.lock.help}`,
    "error",
  ],
  stuck: (c, x) => [c.lock.failed, c.notice[x.noticeKind], c.lock.help, "error"],
  restart: (c, x) => [
    c.lock.restarting,
    x.mode === "ready" && x.noticeKind === "busy" ? c.lock.waiting : c.lock.bodyReady,
    "",
    "done",
  ],
  wait: (c, x) => [
    x.version ? c.lock.title(x.version) : c.lock.checking,
    c.lock.body,
    "",
    x.mode === "downloading" ? "progress" : "wait",
  ],
};

// Кнопка «Повторить» есть не у всякого исхода. В «застряли» повтор идёт через retryApply: он забывает
// прежний отказ по этому выпуску (иначе после «занято» никто не спрашивает, и замок остаётся запертым).
const AGAIN = {
  failed: () => storeApi.updateActions.retry(),
  stuck: (view) => storeApi.updateActions.retryApply(view.sequence),
};

// Экран сам проходит путь: находит, скачивает, по готовности перезапускает.
const AUTOPILOT = new Map([
  ["available", () => storeApi.updateActions.download()],
  ["ready", (sequence) => storeApi.updateActions.applyWhenFree(sequence)],
]);

function useAutopilot(mode, sequence) {
  useEffect(() => {
    AUTOPILOT.get(mode)?.(sequence);
  }, [mode, sequence]);
}

function useRetryTimer(mode, err) {
  const retryable = err?.retryable;
  useEffect(() => {
    if (mode !== "error" || !retryable) return undefined;
    const timer = setTimeout(() => {
      storeApi.updateActions.retry();
    }, RETRY_AFTER_MS);
    return () => clearTimeout(timer);
  }, [mode, retryable, err]);
}

// Всё, что экран решает по снимку, собрано в одном месте; разметка только показывает.
function lockView({ state, notice, language }) {
  const err = state.error;
  const copy = copyApi.updatesCopyFor(language);
  const { mode, candidate, facts } = modelApi.describe(state);
  const noticeKind = notice?.kind;
  const version = candidate?.version;
  const kind = outcomeOf(mode, noticeKind);
  const [heading, body, help, orbit] = WORDS[kind](copy, { err, language, mode, noticeKind, version });
  return { body, copy, err, facts, heading, help, kind, language, mode, orbit, sequence: candidate?.sequence, version };
}

const Para = ({ cls, role, children }) => (
  <p role={role} className={cls}>
    {children}
  </p>
);

const Foot = ({ from, version, channel }) => {
  if (!version) return null;
  const route = from ? `${from} → ${version}` : version;
  return (
    <small className="updates-lock-foot">
      <VersionText versions={[from, version]} text={channel ? `${route} · ${channel}` : route} />
    </small>
  );
};

const Stage = ({ state, view }) => {
  const { body, copy, facts, heading, help, kind, language, mode, orbit, version } = view;
  const flow = facts ? formatApi.transferLines(facts, language, copy) : null;
  const meterPercent = facts?.stage === "verify" ? (facts.verifyPercent ?? 0) : facts?.percent;
  const orbitShare = facts ? facts.share : 0;
  const retryAction = AGAIN[kind];
  return (
    <div className="updates-lock-stage" data-mode={mode}>
      <UpdateOrbit kind={orbit} size="lg" value={orbitShare} />
      <small className="updates-lock-kicker" data-audit-ignore="caps">
        {copy.lock.kicker}
      </small>
      <h2>
        <VersionText text={heading} versions={[version]} />
      </h2>
      <p aria-live="polite" className="updates-lock-body">
        {body}
      </p>
      {flow ? (
        <>
          <Para cls="updates-lock-progress">{flow.line}</Para>
          <UpdateBar label={heading} percent={meterPercent} />
        </>
      ) : null}
      {flow?.note ? (
        <Para cls="updates-lock-note" role="status">
          {flow.note}
        </Para>
      ) : null}
      {STEP_MODES.includes(mode) ? <UpdateSteps copy={copy} state={state} /> : null}
      {help ? <Para cls="updates-lock-help">{help}</Para> : null}
      {retryAction ? (
        <Button onClick={() => retryAction(view)} variant="primary">
          {copy.actions.retry}
        </Button>
      ) : null}
      <Foot channel={modelApi.channelLabel(state.channel)} from={state.current?.version} version={version} />
    </div>
  );
};

const UpdateLock = (props) => {
  const view = lockView(props);
  useAutopilot(view.mode, view.sequence);
  useRetryTimer(view.mode, view.err);
  return (
    <Dialog
      showClose={false}
      role="alertdialog"
      open
      onClose={none}
      dismissible={false}
      className="updates-lock"
      backdropClassName="updates-backdrop updates-lock-backdrop"
      ariaLabel={view.copy.lock.label}
    >
      <Stage view={view} state={props.state} />
    </Dialog>
  );
};

export default UpdateLock;
