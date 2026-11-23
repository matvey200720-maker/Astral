import { humanFailure } from "../../../utils/installFailure.js";
import Button from "../../ui/Button.jsx";
import { ArrowCounterClockwise, FolderOpen, HardDrives, Info, Trash, X } from "../../ui/icons.jsx";
import { formatBytes } from "./format-bytes.js";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import { createElement as h, Fragment, useEffect, useReducer } from "react";
import { desktopHost } from "../../../api.js";
import Switch from "../../ui/Switch.jsx";
import { driveOf, middlePath } from "./middle-path.js";
import {
  BACKUP_KINDS,
  budgetKindRows,
  budgetParts,
  kindPart,
  storageParts,
} from "./storage-parts.js";
import { detailedStorageCopy } from "./storage-copy.js";

const CACHE_FLAG_KEY = "modovik-cache-packages";
const PATH_LIMIT = 34;

const gigabytes = (...counts) => counts.map((count) => count * 1024 ** 3);
const LIMIT_CHOICES = gigabytes(2, 10, 15, 25, 40);

// Уведомление панели лежит под легендой, остальные цели — в своих строках.
const PANEL = "panel";
const LIST_SEPARATOR = " · ";

const STATUS_DEFAULTS = Object.fromEntries([
  ["cachePath", ""],
  ["defaultCachePath", ""],
  ["isCustomPath", false],
  ["usedBytes", 0],
  ["fileCount", 0],
  ["backupBytes", 0],
  ["diskFreeBytes", null],
  ["limitBytes", LIMIT_CHOICES[0]],
  ["limitOptions", LIMIT_CHOICES],
  ["downloadLimitMbps", 100],
  ["downloadLimitOptions", [0, 5, 10, 25, 50, 100]],
  ["moving", null],
]);

// Какие слова панели подписывают части в обзоре: при бюджете и без него.
const PART_WORDS = {
  budget: {
    mods: "partModsWorks",
    cache: "partFreeable",
    backups: "partRollback",
    other: "partOther",
  },
  plain: { mods: "partMods", cache: "partCache", backups: "partBackups", other: "partOther" },
};

// Работы мастерской узнаются по началу имени хранилища.
const WORK_PREFIXES = [
  ["local-legacy-roads-", "roads"],
  ["local-legacy-vegetation-", "vegetation"],
];

const guarded = (attempt, fallback) => {
  try {
    return attempt();
  } catch {
    return fallback;
  }
};
const readCacheFlag = () => guarded(() => localStorage.getItem(CACHE_FLAG_KEY) !== "0", true);
const writeCacheFlag = (enabled) =>
  guarded(() => localStorage.setItem(CACHE_FLAG_KEY, enabled ? "1" : "0"));

// Настройки одного вида: поле статуса и метод моста; ключ занятости совпадает с именем.
const SETTINGS = {
  limit: { field: "limitBytes", method: "setCacheLimit", skipSame: true },
  download: { field: "downloadLimitMbps", method: "setDownloadLimit", skipSame: true },
  cache: { field: "cacheEnabled", method: "setCacheEnabled", remember: writeCacheFlag },
};

// ---------- состояние ----------

const initialPanel = () => ({
  status: { ...STATUS_DEFAULTS, cacheEnabled: readCacheFlag() },
  loaded: false,
  busy: null,
  pending: null,
});

const TRANSITIONS = {
  merge: (state, { next, extra }) => ({
    ...state,
    status: { ...state.status, ...next, ...extra },
  }),
  loaded: (state) => (state.loaded ? state : { ...state, loaded: true }),
  busy: (state, { key }) => (state.busy === key ? state : { ...state, busy: key }),
  notice: (state, { pending }) => (state.pending === pending ? state : { ...state, pending }),
};
const reducePanel = (state, { type, ...payload }) => TRANSITIONS[type](state, payload);

// Что может случиться с экраном; все шаги идут через dispatch.
const bindUi = (dispatch) => ({
  merge: (next, extra) => dispatch({ type: "merge", next, extra }),
  loaded: () => dispatch({ type: "loaded" }),
  busy: (key) => dispatch({ type: "busy", key }),
  say: (target, how) => dispatch({ type: "notice", pending: { target, say: how } }),
  hush: () => dispatch({ type: "notice", pending: null }),
});

// Способы сказать: слово из словаря или человеческая подпись отказа.
const word = (key) => (words) => words[key];
const failure = (error) => (_words, lang) => humanFailure(error, lang);

// Подписка на ход копирования и первое чтение состояния; порядок: подписка, затем чтение.
function useBridgeSync(dispatch) {
  useEffect(() => {
    const ui = bindUi(dispatch);
    const bridge = desktopHost();
    const unsubscribe = bridge?.onStorageProgress?.((event) => ui.merge({ moving: event }));
    const onStatus = (next) => {
      if (!next) return;
      ui.merge(next);
      ui.loaded();
    };
    const onFailure = () => ui.say(PANEL, word("loadFailed"));
    bridge?.getStorageStatus?.().then(onStatus, onFailure);
    return () => {
      unsubscribe?.();
    };
  }, [dispatch]);
}

// ---------- действия ----------

// Собираются заново на каждую отрисовку и держат её значения (язык, onNotify, занятость).
function createActions(env) {
  const { host, ui, status, busy, moving, copy, size, onNotify } = env;
  const idle = !busy && !moving;

  function absorb(next, extra) {
    if (next) ui.merge(next, extra);
    return Boolean(next);
  }

  const refresh = async () => {
    if (!host?.getStorageStatus) return;
    try {
      const fresh = await host.getStorageStatus();
      if (absorb(fresh, { moving: null })) ui.loaded();
    } catch {
      // об исходной ошибке уже сказано, перечитывание молчит
    }
  };

  const succeed = (job, result) => {
    job.onDone?.(result);
    absorb(result, { moving: null });
  };

  const fail = async (job, error) => {
    if (error?.name !== "AbortError") ui.say(job.target, failure(error));
    await refresh();
  };

  // Одно действие за раз; занятость снимается всегда.
  const perform = async (job) => {
    if (!idle) return;
    ui.busy(job.key);
    ui.hush();
    try {
      succeed(job, await job.call());
    } catch (error) {
      await fail(job, error);
    } finally {
      ui.busy(null);
    }
  };

  // Метод моста как действие: нет метода — отвечает job.missing (если он есть).
  const launch = ({ method, args = [], missing, ...job }) => {
    if (!host?.[method]) {
      missing?.();
      return;
    }
    perform({ ...job, call: () => host[method](...args) });
  };

  const relocate = (method) =>
    launch({
      method,
      key: "move",
      target: "folder",
      missing: () => ui.say("folder", word("desktopOnlyMove")),
    });

  const clearCache = () => {
    const before = status.usedBytes;
    launch({
      method: "clearCache",
      key: "clear",
      target: "clear",
      missing: () => ui.say("clear", word("desktopOnlyClear")),
      onDone: (result) => {
        const tidied = Math.max(0, Number(result?.tidiedBytes) || 0);
        onNotify?.(copy.clearedSize(size(before + tidied)));
      },
    });
  };

  const freeKind = (kind) =>
    launch({
      method: "freeStorageKind",
      args: [kind],
      key: `free:${kind}`,
      target: `kind:${kind}`,
      onDone: (result) => onNotify?.(copy.freedSize(size(result?.freedBytes))),
    });

  // Лимит, скорости, «Беречь диск» и кэш: без метода моста значение меняется только в окне.
  const setting = (name) => (value) => {
    const { field, method, skipSame, remember } = SETTINGS[name];
    if (!idle || (skipSame && value === status[field])) return;
    launch({
      method,
      args: [value],
      key: name,
      target: PANEL,
      // Флаг кэша запоминаем, когда главный процесс согласился: после отказа он прежний.
      onDone: remember && (() => remember(value)),
      missing: () => {
        remember?.(value);
        ui.merge({ [field]: value });
      },
    });
  };

  const chooseBudget = (value) => {
    if (!idle || value === status.budget.value) return;
    launch({ method: "setStorageBudget", args: [value], key: "budget", target: "budget" });
  };

  const openFolder = async () => {
    if (!host?.openCacheDirectory) return ui.say("folder", word("desktopOnlyOpen"));
    ui.hush();
    try {
      await host.openCacheDirectory();
    } catch (error) {
      ui.say("folder", failure(error));
    }
  };

  return {
    relocate,
    clearCache,
    freeKind,
    setting,
    chooseBudget,
    openFolder,
    cancelMove() {
      host?.cancelCacheMove?.();
    },
  };
}

// ---------- вычисления ----------

function listParts(status, budget, copy) {
  const table = budget ? PART_WORDS.budget : PART_WORDS.plain;
  const words = {};
  for (const [id, key] of Object.entries(table)) words[id] = copy[key];
  return budget ? budgetParts(budget, words) : storageParts(status, words);
}

function headlineOf(copy, size, cachePath, total) {
  const drive = driveOf(cachePath);
  const lead = drive ? `${copy.disk(drive)} — ` : "";
  return lead + copy.occupied(size(total));
}

const barWidth = (bytes, total) => (bytes ? `max(3px, ${(bytes / Math.max(1, total)) * 100}%)` : 0);

function workKey(store) {
  const lowered = String(store || "").toLowerCase();
  for (const [prefix, key] of WORK_PREFIXES) {
    if (lowered.startsWith(prefix)) return key;
  }
  return "work";
}

function copyCaption(copy, size, move) {
  if (!move.totalBytes) return copy.preparing;
  const done = `${size(move.copiedBytes)} / ${size(move.totalBytes)}`;
  return move.file ? `${done}${LIST_SEPARATOR}${move.file}` : done;
}

// Подписи «название размер» через разделитель: виды копий и виды недобора.
function sizedList(pairs, size) {
  const parts = [];
  for (const [label, bytes] of pairs) parts.push(`${label} ${size(bytes)}`);
  return parts.join(LIST_SEPARATOR);
}

function toOptions(values, labelOf) {
  return values.map((value) => ({ value, label: labelOf(value) }));
}

const speedLabeler = (copy) => (mbps) => (mbps ? copy.writeSpeedMbps(mbps) : copy.writeSpeedOff);

// ---------- разметка ----------

// Разметка собирается вызовами createElement; JSX остался там, где текст читает тест проекта.

const tag = (name) => (props, ...kids) => h(name, props, ...kids);
const article = tag("article");
const section = tag("section");
const header = tag("header");
const div = tag("div");
const span = tag("span");
const bold = tag("b");
const small = tag("small");
const ital = tag("i");
const emph = tag("em");
const list = tag("ul");
const item = tag("li");
const title3 = tag("h3");

const rowAttrs = (setting) => ({ className: "settings-row", "data-setting": setting });
// key уходит в React и в разметку не попадает.
const itemAttrs = (key, className, dataName, value) => ({ key, className, [dataName]: value });

const infoMark = () => h(Info, { "aria-hidden": "true" });
const dot = (cls) => ital({ className: cls, "aria-hidden": "true" });

const NOTICE_TAGS = { [PANEL]: ["p", "storage-settings-notice"] };
const ROW_NOTICE_TAG = ["em", "storage-row-notice"];

function noticeAt(notice, target) {
  if (notice?.target !== target) return null;
  const [name, className] = NOTICE_TAGS[target] || ROW_NOTICE_TAG;
  return h(name, { className, role: "alert" }, infoMark(), notice.text);
}

// Ряд: название и пояснения слева, всё остальное — после них.
const row = (attrs, title, notes, ...tail) =>
  div(attrs, span({ className: "settings-row-copy" }, bold(null, ...title), ...notes), ...tail);

const controls = (...kids) => span({ className: "settings-row-control" }, ...kids);

// Ряд «название + сегменты справа».
const choiceRow = (setting, title, hint, notice, segmented) =>
  row(
    rowAttrs(setting),
    [title],
    [small(null, hint), notice],
    controls(h(SegmentedControl, { size: "sm", label: title, ...segmented })),
  );

// Строка вида, работы или мода: точка части, название, пояснение, размер и кнопка.
const itemRow = (attrs, part, name, hint, bytes, tail, notice) =>
  row(
    attrs,
    [dot(`storage-dot is-${part}`), name],
    [hint ? small(null, hint) : null, notice],
    controls(span({ className: "storage-size" }, bytes), tail),
  );

function usageCard(view) {
  const { copy, size, status, parts, total, headline, loaded, notice } = view;
  const sharedBytes = status.gameBackups?.shared?.bytes;
  const bars = [];
  const legend = [];
  for (const { id, label, bytes } of parts) {
    bars.push(ital({ key: id, className: `is-${id}`, style: { width: barWidth(bytes, total) } }));
    legend.push(item({ key: id }, dot(`is-${id}`), `${label} ${size(bytes)}`));
  }
  const overviewNote = (text) => small({ className: "storage-overview-note" }, text);
  return section(
    { className: "settings-card storage-overview", "data-setting": "usage" },
    header(
      { className: "storage-overview-head" },
      bold(null, headline),
      typeof status.diskFreeBytes === "number"
        ? span(null, copy.free(size(status.diskFreeBytes)))
        : null,
    ),
    <span className="storage-usage-meter" aria-hidden="true">
      {bars}
    </span>,
    list({ className: "storage-legend" }, legend),
    loaded ? null : overviewNote(copy.folderUnknown),
    sharedBytes > 0 ? overviewNote(copy.sharedNote(size(sharedBytes))) : null,
    noticeAt(notice, PANEL),
  );
}

function folderRow(view) {
  const { copy, status, moving, notice, act } = view;
  const flat = { size: "sm", disabled: moving };
  const where = status.cachePath
    ? small(
        { className: "storage-path", title: status.cachePath },
        middlePath(status.cachePath, PATH_LIMIT),
      )
    : small({ className: "storage-path-pending" }, copy.folderUnknown);
  const kindNote = small(
    { className: "storage-folder-kind" },
    status.isCustomPath ? copy.customFolder : copy.defaultFolder,
  );
  const restore = status.isCustomPath
    ? h(
        Button,
        {
          variant: "ghost",
          size: "sm",
          icon: h(ArrowCounterClockwise),
          title: copy.restoreHint,
          disabled: moving,
          onClick: () => act.relocate("resetCacheDirectory"),
        },
        copy.restore,
      )
    : null;
  return row(
    rowAttrs("folder"),
    [copy.folder],
    [where, kindNote, noticeAt(notice, "folder")],
    controls(
      <Button
        {...flat}
        variant="ghost"
        className="storage-open-cache"
        icon={<FolderOpen />}
        onClick={act.openFolder}
      >
        {copy.openFolder}
      </Button>,
      restore,
      h(
        Button,
        {
          ...flat,
          className: "storage-move-cache",
          icon: h(HardDrives),
          onClick: () => act.relocate("chooseCacheDirectory"),
        },
        copy.chooseFolder,
      ),
    ),
  );
}

function moveRow(view) {
  const { copy, size, status, act } = view;
  const move = status.moving || {};
  const percent = move.percent || 0;
  return row(
    { className: "settings-row storage-copy-row", "aria-live": "polite" },
    [copy.copying],
    [small(null, copyCaption(copy, size, move))],
    span(
      { className: "settings-row-control storage-copy-progress" },
      bold(null, `${percent}%`),
      ital(null, emph({ style: { width: `${percent}%` } })),
      h(
        Button,
        { variant: "ghost", size: "sm", icon: h(X), onClick: act.cancelMove },
        copy.stopMove,
      ),
    ),
  );
}

function clearRow(view) {
  const { act, busy, copy, moving, notice, size, status } = view;
  const used = status.usedBytes;
  const hint = used
    ? `${copy.usedHint(status.fileCount)}${LIST_SEPARATOR}${copy.clearHint}`
    : copy.clearEmpty;

  return row(
    rowAttrs("clear"),
    [dot("storage-dot is-cache"), copy.partCache],
    [small(null, hint), noticeAt(notice, "clear")],
    controls(
      <Button size="sm" className="settings-clear-cache"
        icon={<Trash />}
        disabled={busy === "clear" || moving}
        onClick={act.clearCache}
      >
        {busy === "clear" ? copy.clearing : used ? copy.clearSize(size(used)) : copy.clearButton}
      </Button>,
    ),
  );
}

function cacheRow(view) {
  const { copy, status, locked, act } = view;
  return row(
    rowAttrs("cache"),
    [copy.cache],
    [small(null, status.cacheEnabled ? copy.cacheOn : copy.cacheOff)],
    h(Switch, {
      className: "storage-cache-toggle",
      checked: status.cacheEnabled,
      label: copy.cache,
      disabled: locked("cache"),
      onChange: act.setting("cache"),
    }),
  );
}

function budgetRow(view) {
  const { act, budget, copy, locked, notice, size } = view;
  const hint =
    budget.value === "auto"
      ? copy.budgetHintAuto(size(budget.allowance))
      : copy.budgetHintFixed(size(budget.usedBytes), size(budget.limitBytes));
  const labelOf = (value) => (value === "auto" ? copy.budgetAuto : size(value));

  return choiceRow("budget", copy.budget, hint, noticeAt(notice, "budget"), {
    className: "storage-budget-options",
    disabled: locked("budget"),
    onChange: act.chooseBudget,
    options: toOptions(budget.options, labelOf),
    value: budget.value,
  });
}

function limitRow(view) {
  const { copy, size, status, locked, act } = view;
  const base = { size: "sm", label: copy.limit };
  return row(
    rowAttrs("limit"),
    [copy.limit],
    [small(null, copy.limitHint)],
    controls(
      <SegmentedControl
        {...base}
        className="storage-limit-options"
        options={toOptions(status.limitOptions, size)}
        value={status.limitBytes}
        disabled={locked("limit")}
        onChange={act.setting("limit")}
      />,
    ),
  );
}

// Недобор бюджета: предупреждение, затем работы и моды, которые держат место.
function shortfallRows(view) {
  const { copy, size, budget, locked, act, downloads } = view;
  const { shortfall } = budget;
  const kinds = shortfall.kinds.map(({ kind, bytes }) => [copy.kindNames[kind] || kind, bytes]);
  const raise =
    shortfall.enough !== "auto"
      ? h(
          Button,
          {
            size: "sm",
            disabled: locked("budget"),
            onClick: () => act.chooseBudget(shortfall.enough),
          },
          copy.raiseBudget(size(shortfall.enough)),
        )
      : null;
  const attrsFor = (key, store) =>
    itemAttrs(key, "settings-row storage-shortfall-item", "data-shortfall-item", store);
  const works = shortfall.works.map((work, index) =>
    itemRow(
      attrsFor(`work:${index}`, work.store),
      "mods",
      copy.workNames[work.name] || copy.workNames.work,
      copy.workHint,
      size(work.bytes),
      downloads,
    ),
  );
  const mods = shortfall.mods?.map((mod, index) =>
    itemRow(
      attrsFor(`mod:${index}`, mod.store),
      "mods",
      mod.title || mod.store,
      copy.modHint,
      size(mod.bytes),
      downloads,
    ),
  );
  return h(
    Fragment,
    null,
    row(
      { className: "settings-row storage-shortfall", "data-setting": "shortfall", role: "alert" },
      [infoMark(), copy.shortfallTitle(size(shortfall.needBytes), size(budget.limitBytes))],
      [
        small(null, copy.shortfallHint),
        small({ className: "storage-kinds" }, sizedList(kinds, size)),
      ],
      controls(raise),
    ),
    works,
    mods,
  );
}

function downloadRow(view) {
  const { copy, status, locked, act } = view;
  return choiceRow("download-speed", copy.downloadSpeed, copy.downloadSpeedHint, undefined, {
    className: "storage-download-options",
    options: toOptions(status.downloadLimitOptions, speedLabeler(copy)),
    value: status.downloadLimitMbps,
    disabled: locked("download"),
    onChange: act.setting("download"),
  });
}

function modsRow(view, part) {
  const { copy, size } = view;
  return row(
    rowAttrs("mods"),
    [dot("storage-dot is-mods"), copy.mods],
    [small(null, copy.modsHint)],
    span({ className: "storage-size" }, size(part.bytes)),
  );
}

function backupsRow(view, part) {
  const { copy, size, status } = view;
  const kinds = [];
  for (const kind of BACKUP_KINDS) {
    const label = copy.kinds[kind];
    const bytes = status.gameBackups?.parts?.[kind]?.bytes || 0;
    if (bytes > 0) kinds.push([label, bytes]);
  }
  return row(
    rowAttrs("backups"),
    [dot("storage-dot is-backups"), copy.backups],
    [
      small(null, copy.backupsHint),
      kinds.length > 0 ? small({ className: "storage-kinds" }, sizedList(kinds, size)) : null,
    ],
    span({ className: "storage-size" }, size(part.bytes)),
  );
}

function kindsCard(view) {
  const { copy, size, budget, busy, moving, notice, act, downloads } = view;
  const works = budget.works.map((work, index) =>
    itemRow(
      itemAttrs(`work:${index}`, "settings-row", "data-kind", "works"),
      "mods",
      copy.workNames[workKey(work.store)],
      copy.workHint,
      size(work.bytes),
      downloads,
    ),
  );
  const rows = budgetKindRows(budget).map(({ kind, cls, bytes, freeable }) =>
    itemRow(
      itemAttrs(kind, "settings-row", "data-kind", kind),
      kindPart(kind),
      copy.kindNames[kind] || kind,
      cls === "C" ? copy.keepHint : null,
      size(bytes),
      cls === "A" && freeable > 0
        ? h(
            Button,
            {
              size: "sm",
              icon: h(Trash),
              disabled: Boolean(busy) || moving,
              onClick: () => act.freeKind(kind),
            },
            copy.freeKind(size(freeable)),
          )
        : null,
      noticeAt(notice, `kind:${kind}`),
    ),
  );
  return section(
    { className: "settings-card storage-kinds-card", "data-setting": "kinds" },
    title3({ className: "storage-kinds-title" }, copy.kindsTitle),
    works,
    rows,
  );
}

export default function StoragePanel({ language, onNotify = null, onOpenDownloads = null }) {
  const copy = detailedStorageCopy[language] || detailedStorageCopy.en;
  const size = (bytes) => formatBytes(bytes, language);
  const host = desktopHost();

  const [state, dispatch] = useReducer(reducePanel, undefined, initialPanel);
  useBridgeSync(dispatch);
  const { status, loaded, busy, pending } = state;
  // Уведомление хранит способ сказать: язык может смениться, пока оно на экране.
  const notice = pending && { target: pending.target, text: pending.say(copy, language) };

  const budget = status.budget;
  const moving = busy === "move" || Boolean(status.moving);
  const locked = (key) => busy === key || moving;
  const ui = bindUi(dispatch);
  const act = createActions({ host, ui, status, busy, moving, copy, size, onNotify });

  const parts = listParts(status, budget, copy);
  let total = 0;
  for (const part of parts) total += part.bytes;
  const headline = headlineOf(copy, size, status.cachePath, total);

  const downloads = onOpenDownloads
    ? h(Button, { variant: "ghost", size: "sm", onClick: onOpenDownloads }, copy.openDownloads)
    : null;
  const view = { copy, size, status, budget, busy, moving, notice, locked, act, downloads };
  const modsPart = parts.find((part) => part.id === "mods");
  const backupsPart = parts.find((part) => part.id === "backups");

  return article(
    { className: "storage-settings settings-storage" },
    usageCard({ ...view, parts, total, headline, loaded }),
    section(
      { className: "settings-card" },
      folderRow(view),
      moving ? moveRow(view) : null,
      clearRow(view),
      cacheRow(view),
      budget ? budgetRow(view) : limitRow(view),
      budget?.shortfall ? shortfallRows(view) : null,
      downloadRow(view),
      !budget && modsPart ? modsRow(view, modsPart) : null,
      budget ? null : backupsRow(view, backupsPart),
    ),
    budget ? kindsCard(view) : null,
  );
}
