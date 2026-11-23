// Экраны хода: скачивание, установка, обновление, удаление, и общий список фаз.
import { h, icon } from "../dom.js";
import { formatBytes, formatClock, formatDuration, formatSpeed, percentOf, productName } from "../format.js";
import { bar, button, callout, nextSteps, screen, stepper } from "../parts.js";

// Число попыток в пометке жёсткое: хост шлёт только номер текущей.
const ATTEMPTS_TOTAL = 3;
const FILES = [
  [1, "package", "download.launcher"],
  [2, "layout", "download.interface"],
];
const PHASES = {
  install: ["verify", "unpack", "shortcuts", "finalize"],
  update: ["download", "verify", "unpack", "swap", "start"],
  uninstall: ["files", "shortcuts", "registry"],
};
// Метка фазы: прошедшая — галочка, упавшая — крестик.
const MARKS = { done: "check", error: "x" };
// Экраны: [номер шага (0 — шагов нет), ключ заголовка].
const TITLES = {
  download: [3, "download.title"],
  install: [3, "install.title"],
  update: [0, "update.title"],
  "uninstall-progress": [0, "uninstall.progressTitle"],
};

// Узел по описанию [«тег.класс#id», свойства?, ...дети]; дети — узлы, строки или такие же описания.
const node = (spec) => {
  if (!Array.isArray(spec)) return spec;
  const [selector, ...kids] = spec;
  const [tag, ...marks] = selector.split(/(?=[.#])/);
  const props = kids[0]?.constructor === Object ? kids.shift() : {};
  const named = (sign) => marks.filter((m) => m[0] === sign).map((m) => m.slice(1));
  return h(tag, { class: named(".").join(" ") || undefined, id: named("#")[0], ...props }, ...kids.map(node));
};

const action = (t, key, variant, onClick, block) => button({ label: t(key), variant, block, onClick });
const pct = (n) => (Number.isFinite(n) ? `${Math.round(n)}%` : "");

// Каркас экрана по таблице TITLES; `vars` подставляются в заголовок.
function frame(t, name, body, foot, vars) {
  const [step, titleKey] = TITLES[name];
  return screen(name, { lead: step ? stepper(t, step) : null, title: t(titleKey, vars), text: null, body, ...(foot && { foot }) });
}

// Экран с одним состоянием: рисует по `draw(state)` при показе и на каждый update.
function live(ctx, el, draw) {
  draw(ctx.state);
  return { el, update: (next) => draw(next) };
}

// Список фаз: прошедшие с галочкой, текущая крутится и показывает процент, дальше серые.
export function phaseList(ctx, order, labelOf) {
  const rows = order.map((name) => {
    const [mark, percentEl] = [node(["span.phase-mark"]), node(["span.phase-percent"])];
    const el = node(["li.phase", { "data-phase": name, "data-state": "pending" }]);
    el.append(mark, h("span", null, labelOf(name)), percentEl);
    return { el, mark, percentEl };
  });

  const set = (current, percent = 0, { failed = false, finished = false } = {}) => {
    // Позиция текущей фазы: -1 — «никакая», длина списка — «все пройдены».
    const at = current === null ? (finished ? order.length : -1) : order.indexOf(current);
    for (const [i, { el, mark, percentEl }] of rows.entries()) {
      const state = i < at ? "done" : i > at ? "pending" : failed ? "error" : "active";
      el.setAttribute("data-state", state);
      mark.replaceChildren(...[MARKS[state]].filter(Boolean).map((sign) => icon(sign, { strokeWidth: 3 })));
      percentEl.textContent = state === "active" ? pct(percent) : "";
    }
  };

  return { el: node(["ol.phases", ...rows.map((row) => row.el)]), set };
}

// Список фаз экрана: подписи берутся из словаря по `<вид>.<фаза>`.
const phasesOf = (ctx, kind, order = PHASES[kind]) => phaseList(ctx, order, (name) => ctx.t(`${kind}.${name}`));

// Что показать про файл по последней записи события; не объект читается как «ещё не пришло».
function fileFacts(record, t, locale) {
  const { total: rawTotal, received: rawGot, etaSec, bytesPerSec } = record ?? {};
  const [total, got] = [rawTotal, rawGot].map((v) => Number(v) || 0);
  const done = got >= total && total > 0;
  const bytes = (n) => formatBytes(n, { t, locale });
  const left = formatDuration(etaSec, { t });
  return {
    state: done ? "done" : got > 0 ? "active" : "pending",
    percent: done ? 100 : percentOf(got, total),
    tone: done ? "positive" : "",
    size: total ? `${bytes(got)} / ${bytes(total)}` : "",
    speed: done ? "" : formatSpeed(bytesPerSec, { t, locale }),
    eta: done || !left ? "" : t("download.eta", { time: left }),
  };
}

// Блок одного файла: значок, имя, размер, полоса, скорость и оставшееся время.
function fileBlock(t, [id, iconName, labelKey]) {
  const [sizeEl, speedEl, etaEl] = [node(["span.file-size"]), node(["span"]), node(["span"])];
  const label = t(labelKey);
  const meter = bar({ label });
  const el = node([
    "div.file",
    { "data-file": id },
    ["div.file-head", ["span.file-icon", icon(iconName)], ["span.file-name", label], sizeEl],
    meter.el,
    ["div.file-meta", speedEl, etaEl],
  ]);
  const paint = (record, locale) => {
    const f = fileFacts(record, t, locale);
    el.setAttribute("data-state", f.state);
    meter.set(f.percent);
    meter.tone(f.tone);
    [[sizeEl, f.size], [speedEl, f.speed], [etaEl, f.eta]].forEach(([target, text]) => {
      target.textContent = text;
    });
  };
  return { id, el, paint };
}

export function mountDownload(ctx) {
  const t = ctx.t;
  const blocks = FILES.map((file) => fileBlock(t, file));
  const overallEl = node(["span.selectable"]);
  const noteEl = node(["div.meta-line"]);
  const statusEl = node(["div", { role: "status" }]);
  const nextEl = nextSteps(t, "next.afterTitle", { compact: true });
  const body = blocks.map((block) => block.el).concat(node(["div.meta-line", ["span", t("download.overall")], overallEl]), noteEl, statusEl, nextEl);
  const el = frame(t, "download", body, [node(["div.screen-foot-row", ["span"], action(t, "download.cancel", "ghost", () => ctx.actions.requestCancel())])]);

  // Отсчёт до следующей попытки в очереди: раз в секунду перерисовывает подпись, пока она на экране.
  let current = ctx.state;
  const queueLine = (queue) => {
    if (!queue) return null;
    const left = Math.max(0, Math.ceil((queue.until - Date.now()) / 1000));
    return callout({ tone: "info", iconName: "refresh", text: left > 0 ? t("download.queue", { time: formatClock(left) }) : t("download.queueNow") });
  };
  // Секундный таймер живёт, только пока идёт очередь: без неё экран ничего не заводит (и тесты окна не зависают на нём).
  let ticker = 0;
  const keepTicker = (on) => {
    if (on && !ticker) {
      ticker = window.setInterval(() => {
        if (current.download?.queue) statusEl.replaceChildren(queueLine(current.download.queue));
      }, 1000);
    } else if (!on && ticker) {
      window.clearInterval(ticker);
      ticker = 0;
    }
  };

  const drawn = live(ctx, el, ({ download }) => {
    current = { ...current, download };
    const { files, attempt, online, queue } = download;
    blocks.forEach((block) => block.paint(files[block.id], ctx.locale));
    const attemptLine = attempt > 1 ? t("download.attempt", { n: attempt, total: ATTEMPTS_TOTAL }) : "";
    [[overallEl, `${percentOf(download.overallReceived, download.overallTotal)}%`], [noteEl, attemptLine]].forEach(([target, text]) => {
      target.textContent = text;
    });
    statusEl.replaceChildren(...[queueLine(queue), online === false && !queue && callout({ tone: "warning", text: t("download.offline") })].filter(Boolean));
    // В очереди подпись «ждём» занимает место блока «После установки»: экран не выше панели.
    nextEl.hidden = Boolean(queue);
    keepTicker(Boolean(queue));
  });
  return { ...drawn, destroy: () => keepTicker(false) };
}

export function mountInstall(ctx) {
  const phases = phasesOf(ctx, "install");
  const el = frame(ctx.t, "install", [phases.el, nextSteps(ctx.t, "next.afterTitle")]);
  return live(ctx, el, ({ install }) => phases.set(install.phase, install.percent));
}

// Окно обновления в макете А1 (16.11.2026): версии, полоса с текущим шагом и процентом, строка шагов точками. Звезда с кольцом и заголовок —
// в левой половине окна (hero.js, orbit.js), app.css ставит всё в один столбец по центру. «Скачано» всегда позади: лаунчер скачал и проверил
// файлы до запуска установщика; дальше идут фазы хоста (BRIDGE.md, «Режим обновления»).
const UPDATE_STEPS = ["download", "verify", "unpack", "swap", "start"];

export function mountUpdate(ctx) {
  const { t, locale } = ctx;
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const [versions, label, pctEl, outcome] = [node(["div.upd-versions.selectable"]), node(["span.upd-label"]), node(["span.upd-pct"]), node(["div.upd-outcome"])];
  const meter = bar({ label: t("update.title") });
  const steps = UPDATE_STEPS.map((name) => node(["li", { "data-step": name, "data-state": "pending" }, t(`update.step.${name}`)]));
  const el = node([
    "div.screen.upd",
    { "data-screen": "update" },
    versions,
    ["div.upd-prog", ["div.upd-lbl", label, pctEl], meter.el],
    ["ol.upd-steps", { "aria-label": t("update.steps") }, ...steps],
    outcome,
  ]);

  return live(ctx, el, ({ update }) => {
    const finished = update.result === "done";
    versions.textContent = `${update.fromVersion || "—"} → ${update.toVersion || "—"}`;
    const phase = UPDATE_STEPS.includes(update.phase) ? update.phase : "verify";
    const at = finished ? UPDATE_STEPS.length : UPDATE_STEPS.indexOf(phase);
    const share = finished ? 100 : Math.min(100, Math.max(0, Number(update.overall) || 0));
    steps.forEach((step, index) => {
      step.setAttribute("data-state", index < at ? "done" : index === at ? "current" : "pending");
      if (index === at) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    label.textContent = finished ? t("update.doneText", { version: update.toVersion ?? "" }) : t(`update.${phase}`);
    pctEl.textContent = percent.format(share / 100);
    meter.set(share);
    if (update.result === "rolledback") {
      const back = update.rolledback ?? {};
      const text = t("update.failedText", { version: back.version ?? update.toVersion ?? "", restored: back.restored ?? update.fromVersion ?? "" });
      outcome.replaceChildren(node(["p.upd-failed", text]), action(t, "common.close", "primary", () => ctx.actions.quit()));
    } else {
      outcome.replaceChildren();
    }
  });
}

export function mountUninstallProgress(ctx) {
  const { channel, deleteUserData } = ctx.state.uninstall;
  // Набор фаз зависит от галочки «данные» на момент показа и дальше не меняется.
  const phases = phasesOf(ctx, "uninstall", deleteUserData ? [...PHASES.uninstall, "data"] : PHASES.uninstall);
  const el = frame(ctx.t, "uninstall-progress", [phases.el], null, { name: productName(channel) });
  return live(ctx, el, ({ uninstall }) => phases.set(uninstall.phase, uninstall.percent));
}
