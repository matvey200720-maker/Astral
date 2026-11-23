// Экраны «Подтвердите в браузере» (confirm) и «Установка подтверждена» (ready).
import { h, icon } from "../dom.js";
import { branchList, chosenRelease } from "../branches.js";
import { formatBytes, formatClock, productName, shortenPath } from "../format.js";
import { button, callout, check, kv, screen, spinner, stepper } from "../parts.js";
import { channelLabel } from "./welcome.js";

const CLOCK_MS = 1000;
const COPIED_MS = 1600;
// Размеры чужой ветки хост узнает только при установке, поэтому вместо них прочерк.
const UNKNOWN = "—";
const FOLDER_TEXT = { FOLDER_NOT_ALLOWED: "ready.folderProtected", FOLDER_NOT_WRITABLE: "ready.folderReadOnly" };
// Кнопки экранов: [ключ подписи, вид, значок, на всю ширину, действие].
const BUTTONS = {
  reopen: ["confirm.reopen", "secondary", "external", true, "openVerifyUrl"],
  cancel: ["confirm.cancel", "ghost", null, false, "cancelConfirm"],
  install: ["ready.install", "primary", "download", true, "startInstall"],
  change: ["ready.change", "ghost", "folder", false, "chooseInstallDir"],
  branch: ["branch.change", "ghost", null, false, "backToBranch"],
};

function makeButton({ t, actions }, name, extra) {
  const [key, variant, iconName, block, act] = BUTTONS[name];
  return button({ label: t(key), variant, iconName, block, onClick: () => actions[act](), ...extra });
}

// Узел по описанию [«тег.класс#id», свойства?, ...дети]; дети — узлы, строки или такие же описания.
const node = (spec) => {
  if (!Array.isArray(spec)) return spec;
  const [selector, ...kids] = spec;
  const [tag, ...marks] = selector.split(/(?=[.#])/);
  const props = kids[0]?.constructor === Object ? kids.shift() : {};
  const named = (sign) => marks.filter((m) => m[0] === sign).map((m) => m.slice(1));
  return h(tag, { class: named(".").join(" ") || undefined, id: named("#")[0], ...props }, ...kids.map(node));
};
// Нижний ряд подвала: пустой слева, кнопка справа.
const footRow = (...kids) => node(["div.screen-foot-row", ["span"], ...kids]);

export function mountConfirm(ctx) {
  const { t } = ctx;
  let live = ctx.state;
  let revert = 0;
  let mounted = true;

  const codeValue = node(["span.usercode-value.selectable", { "aria-live": "off" }]);
  const copyLabel = node(["span", t("common.copy")]);
  const waitLabel = node(["span.grow"]);
  const waitRow = node(["div.wait-row", { role: "status" }, spinner(), waitLabel]);
  const timeLine = node(["div.meta-line"]);

  const paint = () => {
    const info = live.confirm;
    if (!info) return;
    const offline = info.online === false;
    const secondsLeft = Math.max(0, (info.deadline - Date.now()) / 1000);
    codeValue.textContent = info.userCode ?? "";
    waitLabel.textContent = t(offline ? "confirm.offline" : "confirm.waiting");
    waitRow.setAttribute("data-offline", String(offline));
    timeLine.textContent = t("confirm.expires", { time: formatClock(secondsLeft) });
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(live.confirm.userCode);
    } catch {
      return;
    }
    if (!mounted) return;
    copyLabel.textContent = t("common.copied");
    window.clearTimeout(revert);
    revert = window.setTimeout(() => {
      copyLabel.textContent = t("common.copy");
    }, COPIED_MS);
  };

  const codeBlock = node([
    "div.usercode",
    ["div", ["span.usercode-label", t("confirm.codeLabel")], codeValue],
    ["button.field-action", { type: "button", onClick: copyCode }, icon("copy"), copyLabel],
  ]);
  const body = [
    codeBlock,
    node(["div", waitRow, timeLine]),
    callout({ iconName: "shield", text: t("confirm.warning"), tone: "info" }),
  ];
  const foot = [makeButton(ctx, "reopen"), footRow(makeButton(ctx, "cancel"))];

  paint();
  const ticker = window.setInterval(paint, CLOCK_MS);

  return {
    destroy() {
      mounted = false;
      window.clearInterval(ticker);
      window.clearTimeout(revert);
    },
    el: screen("confirm", {
      body,
      foot,
      lead: stepper(t, 2),
      text: t("confirm.text"),
      title: t("confirm.title"),
    }),
    update(fresh) {
      live = fresh;
      paint();
    },
  };
}

// Приветствие плюс план: что именно ставим (ветка из списка хоста или версия и канал сервера).
function introText(t, info, chosen) {
  const name = productName(chosen.channel);
  const [key, vars] = !chosen.branches
    ? ["ready.text", { channel: channelLabel(info.channel), version: info.version }]
    : chosen.version
      ? ["ready.textBranch", { name, version: chosen.version }]
      : ["ready.textBranchUnknown", { name }];
  const hello = t(info.accountName ? "ready.hello" : "ready.helloAnon", { name: info.accountName });
  return `${hello} ${t(key, vars)}`;
}

// Блок фактов: размеры, папка, ошибки. Возвращает узлы и признак «места не хватает».
function factsFor(ctx, state) {
  const { t, locale } = ctx;
  const { confirmed, selected, init, choosingDir, folderError } = state;
  const info = confirmed || {};
  const { requiredBytes: need, freeBytes: free, downloadBytes: pull } = info;
  const pick = chosenRelease(info, selected);
  const size = (bytes) => formatBytes(bytes, { t, locale });
  // Нехватка считается только для ветки сервера: у других размеров нет.
  const lacking = pick.sameAsServer && Number.isFinite(need) && Number.isFinite(free) && need > free;
  const canChoose = Boolean(init && init.canChooseDir);
  // Папка выбранной ветки: запись списка, потом общая папка подтверждения, потом папка с первого экрана.
  const entries = branchList(info).filter((b) => b.channel === pick.channel).map((b) => b.installDir);
  const dir = [...entries, info.installDir, init?.installDir].find(Boolean) || "";

  const rows = [
    ["ready.download", pick.sameAsServer ? size(pull) : UNKNOWN],
    ["ready.need", pick.sameAsServer ? size(need) : UNKNOWN],
    ["ready.free", size(free), lacking],
  ].map(([key, value, danger]) => ({ label: t(key), value, ...(danger ? { tone: "danger" } : {}) }));

  const folderKey = Object.hasOwn(FOLDER_TEXT, folderError) ? FOLDER_TEXT[folderError] : "ready.folderFailed";
  const alerts = [
    folderError && t(folderKey),
    lacking && t(canChoose ? "ready.noSpaceChoose" : "ready.noSpace", { free: size(free), need: size(need) }),
  ]
    .filter(Boolean)
    .map((text) => callout({ tone: "danger", text }));

  const folderBlock =
    dir &&
    node([
      "div.ready-folder",
      ["div.ready-folder-text", ["span.ready-folder-label", t("ready.folder")], ["span.path.selectable", { title: dir }, shortenPath(dir)]],
      canChoose && makeButton(ctx, "change", { disabled: choosingDir === true }),
    ]);

  return { nodes: [kv(rows), folderBlock, ...alerts].filter(Boolean), lacking };
}

export function mountReady(ctx) {
  const { actions, locale, t } = ctx;
  const env = { actions, locale, t };
  let live = ctx.state;
  const info = live.confirmed || {};
  const chosen = chosenRelease(info, live.selected);

  const installBtn = makeButton(env, "install");
  const factsBox = node(["div.ready-facts"]);
  const refreshFacts = () => {
    const { lacking, nodes } = factsFor(env, live);
    factsBox.replaceChildren(...nodes);
    installBtn.disabled = lacking;
  };
  refreshFacts();

  const shortcutOptions = [
    ["ready.desktop", "desktopShortcut"],
    ["ready.menu", "startMenu"],
  ];
  const ticks = shortcutOptions.map(([key, option]) =>
    check({
      checked: live.options[option],
      label: t(key),
      onChange: (on) => actions.setOption(option, on),
    }),
  );

  const otherBranch = chosen.branches > 1 ? footRow(makeButton(env, "branch")) : null;

  return {
    el: screen("ready", {
      body: [factsBox, node(["div", ...ticks])],
      foot: [installBtn, otherBranch],
      lead: stepper(t, 3),
      text: introText(t, info, chosen),
      title: t("ready.title"),
    }),
    update(fresh) {
      const prior = live;
      live = fresh;
      const watched = ["confirmed", "folderError", "choosingDir"];
      if (watched.some((field) => prior[field] !== fresh[field])) refreshFacts();
    },
  };
}
