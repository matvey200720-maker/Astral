// Экран «Ставим <ветку> рядом»: версия, список фаз и итоговый блок.
import { h } from "../dom.js";
import { productName } from "../format.js";
import { button, callout, screen } from "../parts.js";
import { phaseList } from "./progress.js";

const DASH = "—";
// Фазы по порядку; через лаунчер перед ними идёт download: файлы скачивает лаунчер, своего процента у фазы нет.
const PHASES = ["verify", "unpack", "files", "shortcuts", "registry"];
// Кнопки итога: [ключ подписи, вид, значок слева].
const OPEN = ["side.launch", "primary", "play"];
const SHUT = ["common.close", "ghost", null];

// Узел по описанию [«тег.класс#id», свойства?, ...дети]; дети — узлы, строки или такие же описания.
const node = (spec) => {
  if (!Array.isArray(spec)) return spec;
  const [selector, ...kids] = spec;
  const [tag, ...marks] = selector.split(/(?=[.#])/);
  const props = kids[0]?.constructor === Object ? kids.shift() : {};
  const named = (sign) => marks.filter((m) => m[0] === sign).map((m) => m.slice(1));
  const [cls, [id]] = [named(".").join(" "), named("#")];
  return h(tag, { ...(cls && { class: cls }), ...(id && { id }), ...props }, ...kids.map(node));
};

export function mountSide(ctx) {
  const { t } = ctx;
  let { side } = ctx.state;
  // Ветка (чип), порядок фаз и их подписи читаются один раз; update их не пересобирает.
  const { channel: first, viaLauncher } = side;
  const order = viaLauncher ? ["download", ...PHASES] : PHASES;
  const label = (name) => t(`side.${name}`);
  const phases = phaseList(ctx, order, label);

  const [version, outcome, tail] = [node(["b"]), node(["div"]), node(["div.screen-foot"])];
  const name = productName(first);
  const el = screen("side", {
    body: [node(["div.versions.selectable", ["span.chip", name], version]), phases.el, outcome],
    title: t("side.title", { name }),
  });
  const heading = el.querySelector(".screen-title");
  // Свой подвал каркас не создаёт (foot не передан): он нужен всегда, даже пустой.
  el.append(tail);

  const press = ([key, variant, iconName], vars, action, ...args) =>
    button({ label: t(key, vars), variant, iconName, block: variant === "primary", onClick: () => ctx.actions[action](...args) });

  const views = {
    done: ({ channel, version: shipped }) => {
      const vars = { name: productName(channel) };
      const note = callout({ text: t("side.doneText", { version: shipped }), iconName: "check", tone: "info" });
      tail.replaceChildren(press(OPEN, vars, "launch", channel), node(["div.screen-foot-row", ["span"], press(SHUT, undefined, "quit")]));
      outcome.replaceChildren(note);
      phases.set(null, 0, { finished: true });
      heading.textContent = t("side.doneTitle", vars);
    },
    // Заголовок после итога не возвращается к «Ставим…»: его пишет только done.
    run: ({ phase, percent }) => {
      phases.set(phase ?? order[0], percent);
      [outcome, tail].forEach((box) => box.replaceChildren());
    },
  };
  const paint = () => {
    version.textContent = side.version || DASH;
    views[side.result === "done" ? "done" : "run"](side);
  };
  paint();

  return {
    el,
    update: (next) => {
      side = next.side;
      paint();
    },
  };
}
