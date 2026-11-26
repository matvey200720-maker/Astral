import {
  createElement as h,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import { useAttentionAllows } from "../../../attention.js";
import { desktopHost, sanitizeDesktopErrorMessage } from "../../../api.js";
import Button from "../../ui/Button.jsx";
import { communityLinks } from "../desktopShellDefaults.js";
import { ArrowClockwise, ArrowSquareOut } from "../../ui/icons.jsx";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import { logsCopyFor } from "./logs-copy.js";
import { DownloadSimple, Info, Trash } from "../../ui/icons.jsx";
import { openLink } from "./open-link.js";

export default function LogsPanel(props) {
  const { language = "ru" } = props;
  const copy = logsCopyFor(language);
  const live = bridgeHasLog();
  const attentive = useAttentionAllows("motion");
  const panel = usePanelModel(live && attentive);
  const { log, level } = panel.state;

  const options = useMemo(() => {
    return LEVELS.map((id) => ({ value: id, label: copy.levels[id] }));
  }, [copy]);
  const rows = useRows(log.entries, level, copy);

  if (!live) {
    return (
      <section {...shellProps(copy)}>
        <Note>{copy.browserOnly}</Note>
      </section>
    );
  }

  return (
    <section {...shellProps(copy)}>
      <LogBar copy={copy} panel={panel} options={options} shown={rows.length} />
      <ConfirmClear copy={copy} panel={panel} />
      <Statuses
        copy={copy}
        notice={panel.state.notice}
        problem={panel.state.problem}
      />
      <Listing copy={copy} rows={rows} total={log.entries.length} />
      <Note>{privacyLine(copy, log.sources)}</Note>
    </section>
  );
}

// ---- Куски разметки ---------------------------------------------------------

const shellProps = (copy) => ({
  className: "settings-logs",
  "aria-label": copy.title,
  "data-setting": "log",
});

// Абзац-замечание с иконкой: подпись внизу и ветка «журнала нет».
function Note({ children }) {
  return h(
    "p",
    { className: "settings-logs-note", role: "note" },
    h(Info, { weight: "bold" }),
    h("span", null, children),
  );
}

// Кнопки полосы и вопроса собираются из описаний с общим размером.
const renderButtons = (specs) =>
  specs.map(({ id, label, ...props }) => (
    <Button key={id} size="sm" {...props}>
      {label}
    </Button>
  ));

function LogBar({ copy, panel, options, shown }) {
  const { log, level, asking, busy } = panel.state;
  const buttons = [
    {
      id: "refresh",
      variant: "ghost",
      icon: <ArrowClockwise />,
      onClick: () => panel.refresh(),
      label: copy.refresh,
    },
    asking
      ? null
      : {
          id: "clear",
          variant: "ghost",
          icon: <Trash />,
          disabled: log.entries.length === 0 && !log.held,
          onClick: () => panel.ask(true),
          label: copy.clear,
        },
    {
      id: "discord",
      icon: <ArrowSquareOut />,
      onClick: () => openLink(communityLinks.discord),
      label: copy.discord,
    },
    {
      id: "download",
      variant: "primary",
      icon: <DownloadSimple />,
      disabled: busy,
      onClick: panel.download,
      label: busy ? copy.downloading : copy.download,
    },
  ].filter(Boolean);

  return h(
    "div",
    { className: "settings-logs-bar" },
    h(SegmentedControl, {
      label: copy.title,
      size: "sm",
      options,
      value: level,
      onChange: panel.setLevel,
    }),
    h(
      "span",
      { className: "settings-logs-count" },
      copy.count(shown, log.entries.length),
    ),
    h("span", { className: "settings-logs-actions" }, renderButtons(buttons)),
  );
}

function ConfirmClear({ copy, panel }) {
  if (!panel.state.asking) return null;
  const choices = [
    {
      id: "cancel",
      variant: "secondary",
      onClick: () => panel.ask(false),
      label: copy.clearCancel,
    },
    {
      id: "confirm",
      variant: "danger",
      onClick: panel.clearForGood,
      label: copy.clearConfirm,
    },
  ];
  return h(
    "div",
    { className: "settings-logs-confirm", role: "alert" },
    h("span", null, copy.clearAsk),
    ...renderButtons(choices),
  );
}

const STATUS_ATTRS = {
  notice: { className: "settings-logs-status", role: "status" },
  problem: { className: "settings-logs-status is-error", role: "alert" },
};

const NOTICE_TEXT = {
  saved: (copy, notice) => copy.saved(notice.name),
  canceled: (copy) => copy.canceled,
  cleared: (copy) => copy.cleared,
};

// Итог последней выгрузки или очистки и проблема; пустые не рисуются.
function Statuses({ copy, notice, problem }) {
  const lines = [
    ["notice", notice ? NOTICE_TEXT[notice.kind](copy, notice) : null],
    ["problem", problem ? problemText(copy, problem) : null],
  ];
  return lines.map(([tone, text]) =>
    text === null ? null : (
      <p key={tone} {...STATUS_ATTRS[tone]}>
        {text}
      </p>
    ),
  );
}

function Listing({ copy, rows, total }) {
  if (rows.length) {
    return h(
      "ol",
      { className: "settings-logs-list", "aria-label": copy.title },
      rows,
    );
  }
  return (
    <p className="settings-logs-empty">
      {total ? copy.emptyFiltered : copy.empty}
    </p>
  );
}

function LogRow({ entry, copy }) {
  const { t, level, source, message, detail, count } = entry;
  return h(
    "li",
    { className: `settings-logs-entry is-${level}` },
    h("time", { dateTime: t }, formatStamp(t)),
    h("b", { className: "settings-logs-level" }, copy.levelWord[level]),
    h("span", { className: "settings-logs-source" }, source),
    h(
      "p",
      null,
      message,
      count > 1
        ? h("small", { className: "settings-logs-repeat" }, ` ×${count}`)
        : null,
    ),
    detail
      ? h(
          "details",
          null,
          h("summary", null, copy.details),
          h("pre", null, detail),
        )
      : null,
  );
}

// ---- Состояние панели -------------------------------------------------------

const START = {
  log: { entries: [], sources: [] },
  level: "all",
  asking: false,
  busy: false,
  notice: null,
  problem: null,
};

// Меняет только то, что действительно изменилось; иначе отдаёт прежний объект.
const patch = (state, changes) =>
  Object.keys(changes).every((key) => Object.is(state[key], changes[key]))
    ? state
    : { ...state, ...changes };

const STEPS = {
  level: (state, level) => patch(state, { level }),
  asking: (state, asking) => patch(state, { asking }),
  notice: (state, notice) => patch(state, { notice }),
  problem: (state, problem) => patch(state, { problem }),
  exportBegin: (state) =>
    patch(state, { busy: true, notice: null, problem: null }),
  exportEnd: (state) => patch(state, { busy: false }),
  logRead: (state, next) =>
    patch(state, {
      log:
        sameTail(state.log.entries, next.entries) &&
        (state.log.held || 0) === next.held
          ? state.log
          : next,
      problem: null,
    }),
};

const reduce = (state, { type, value }) => STEPS[type](state, value);

// Состояние, обновление журнала и опрос. Обновление создаётся один раз.
function usePanelModel(polling) {
  const [state, dispatch] = useReducer(reduce, START);
  const refresh = useCallback(() => loadLog(dispatch), []);
  const setLevel = useCallback(
    (value) => dispatch({ type: "level", value }),
    [],
  );
  usePolling(refresh, polling);

  return {
    state,
    refresh,
    setLevel,
    ask: (value) => dispatch({ type: "asking", value }),
    download: () => (state.busy ? Promise.resolve() : exportLog(dispatch)),
    clearForGood: () => clearLog(dispatch, refresh),
  };
}

// Читает сразу, потом по кругу; возвращает остановку.
function startPolling(task) {
  task();
  const timer = setInterval(task, PERIOD.poll);
  return () => clearInterval(timer);
}

function usePolling(task, enabled) {
  useEffect(() => (enabled ? startPolling(task) : undefined), [task, enabled]);
}

// Новые записи сверху; тяжёлая сборка только при смене записей, уровня и слов.
function useRows(entries, level, copy) {
  return useMemo(() => {
    const rows = [];
    for (let at = entries.length - 1; at >= 0; at--) {
      const entry = entries[at];
      if (level !== "all" && entry.level !== level) continue;
      const key = entry.n ?? `${entry.t}${entry.message}`;
      rows.push(<LogRow key={key} entry={entry} copy={copy} />);
    }
    return rows;
  }, [entries, level, copy]);
}

// ---- Обращения к мосту ------------------------------------------------------

const bridgeHasLog = () => typeof desktopHost()?.listAppLog === "function";

async function loadLog(dispatch) {
  try {
    dispatch({
      type: "logRead",
      value: readLog(await desktopHost().listAppLog({})),
    });
  } catch (error) {
    const found = problemFrom(error, false);
    dispatch({ type: "problem", value: found.text ? found : null });
  }
}

// Ответ выгрузки читается по очереди: сохранён, отменён, текст для файла в окне.
const EXPORT_REPLIES = [
  ["saved", (reply) => ({ kind: "saved", name: reply.fileName })],
  ["canceled", () => ({ kind: "canceled" })],
  [
    "text",
    (reply) => {
      saveInWindow(reply.text);
      return { kind: "saved", name: EXPORT_FILE.name };
    },
  ],
];

function showExportReply(dispatch, reply) {
  const found = EXPORT_REPLIES.find(([field]) => reply?.[field]);
  if (found) dispatch({ type: "notice", value: found[1](reply) });
}

async function exportLog(dispatch) {
  dispatch({ type: "exportBegin" });
  try {
    showExportReply(dispatch, await desktopHost().exportAppLog());
  } catch (error) {
    dispatch({ type: "problem", value: problemFrom(error, true) });
  } finally {
    dispatch({ type: "exportEnd" });
  }
}

async function clearLog(dispatch, refresh) {
  dispatch({ type: "asking", value: false });
  try {
    await desktopHost().clearAppLog();
    dispatch({ type: "notice", value: { kind: "cleared" } });
    await refresh();
  } catch (error) {
    dispatch({ type: "problem", value: problemFrom(error, true) });
  }
}

// ---- Мелкие функции и постоянные --------------------------------------------

const LEVELS = ["all", "error", "warn", "info"];
const PERIOD = { poll: 4000, revoke: 1000 };
const EXPORT_FILE = {
  name: "astral-log.txt",
  type: "text/plain;charset=utf-8",
};

const DATE_PARTS = [(d) => d.getDate(), (d) => d.getMonth() + 1];
const CLOCK_PARTS = [
  (d) => d.getHours(),
  (d) => d.getMinutes(),
  (d) => d.getSeconds(),
];

const joinParts = (readers, glue, date) =>
  readers.map((read) => `${read(date)}`.padStart(2, "0")).join(glue);

// Местное «дд.мм чч:мм:сс»; не дата остаётся как есть, пустое даёт пустую строку.
function formatStamp(raw) {
  const moment = raw == null ? null : new Date(raw);
  if (!moment) return "";
  if (Number.isNaN(moment.getTime())) return String(raw);
  return `${joinParts(DATE_PARTS, ".", moment)} ${joinParts(CLOCK_PARTS, ":", moment)}`;
}

/*
 * Служебные записи, для поддержки: падения игры (`kind: "game-crash"`, владелец, 26.11.2026: они «только пугают людей») и
 * сверка с игрой (`kind: "hud-reconcile"`). В окне их нет, а в файле журнала («Скачать для тикета») они остаются. В
 * списке это были бы строки по-русски на любом языке окна. `held` — сколько таких записей в журнале: «Очистить журнал»
 * стирает и их.
 */
const HIDDEN_KINDS = new Set(["game-crash", "hud-reconcile"]);

function readLog(reply) {
  const all = reply?.entries ?? [];
  const entries = all.filter((entry) => !HIDDEN_KINDS.has(entry?.kind));
  const held = all.length - entries.length;
  if (!all.length) return { entries, sources: [], held };
  return { entries, sources: reply.sources ?? [], held };
}

const lastNumber = (list) => list.at(-1)?.n;

// Журнал считается прежним, если совпали число записей и номер последней.
const sameTail = (a, b) =>
  a.length === b.length && lastNumber(a) === lastNumber(b);

function privacyLine(copy, sources) {
  if (!sources.length) return copy.privacy;
  return `${copy.privacy} ${copy.sources(sources.map((source) => source.label).join(", "))}`;
}

const problemFrom = (error, failed) => ({
  text: sanitizeDesktopErrorMessage(error),
  failed,
});

const problemText = (copy, { text, failed }) =>
  failed ? `${copy.failed}: ${text}` : text;

// Файл собирается в окне; ссылка живёт секунду и отзывается.
const saveInWindow = (text) => {
  const blob = new Blob([text], { type: EXPORT_FILE.type });
  const href = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), {
    href,
    download: EXPORT_FILE.name,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), PERIOD.revoke);
};
