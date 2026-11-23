import "./clothing-projects.css";
import { createElement, Fragment, useMemo, useState } from "react";
import { default as Dialog } from "../../ui/Dialog.jsx";
import { default as Button } from "../../ui/Button.jsx";
import { Check } from "../../ui/icons.jsx";
import { default as useTabListKeys } from "../../ui/useTabListKeys.js";
import { PROJECTS } from "../../../features/catalog/catalog-projects.js";
import { occupantOf, useOccupiedClothing } from "../../../features/clothing/clothing-occupied.js";
import { projectInstalls } from "../../../features/clothing/project-targets.js";
import { colourRuleOf, modColoursOf } from "../../../features/clothing/colour-rule.js";
import { default as ColourRule } from "../clothing/ColourRule.jsx";
import { coverFor } from "../../../utils/catalogMedia.js";
import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";
import { dataLangOf } from "./data-lang.js";


// Теги разметки как функции «(свойства, ...дети) → элемент».
const [section, header, div, span, h4, img, button] = ["section", "header", "div", "span", "h4", "img", "button"].map(
  (name) =>
    (props, ...kids) =>
      createElement(name, props, ...kids),
);

// Сколько целей видно до «Ещё N»; пустой ключ — «Не ставить».
const VISIBLE = 12;
const SKIP = "";

// Класс из пар «условие → имя»: имена идут в порядке пар.
const classes = (base, ...pairs) => [base, ...pairs.filter(([on]) => on).map(([, name]) => name)].join(" ");

// Вес рюкзака: «10 кг», «7.5 кг», « 7,5 КГ. » — но не «10kg» и не «10 кг макс».
const WEIGHT = new RegExp(String.raw`^\s*\d+(?:[.,]\d+)?\s*кг\.?\s*$`, "i");
const weighs = (option) => WEIGHT.test(option.shop);

// Крупная строка цели: вес (магазин как есть) или имя.
const headline = (option) => (weighs(option) ? option.shop : option.name);

// Знак проекта берётся из общего списка; у неизвестного сервера знака нет.
const badgeOf = (server) => PROJECTS.find((one) => one.id === server);

const Mark = ({ badge, className }) => (badge ? img({ className: `${className} is-${badge.fit}`, alt: "", draggable: false, src: badge.logo }) : null);

// Подпись плитки: замена чужой заменёнки, иначе второе из пары «имя — магазин».
const noteOf = (option, occupant) => {
  if (occupant) return trFill("заменит «{0}»", occupant.title || tr("другой мод"));
  return weighs(option) ? option.name : option.shop;
};

const Tile = (props) => {
  const { option, selected, occupant, onPick } = props;
  const big = headline(option);
  const note = noteOf(option, occupant);
  return button(
    {
      type: "button",
      role: "radio",
      "aria-checked": selected,
      tabIndex: selected ? 0 : -1,
      className: classes("clothing-target", [selected, "is-selected"], [weighs(option), "is-weight"]),
      onClick: () => {
        onPick(selected ? SKIP : option.key);
      },
    },
    span({ className: "clothing-target-title", lang: dataLangOf(big) }, big),
    note ? span({ className: classes("clothing-target-note", [occupant, "is-occupied"]), lang: occupant ? undefined : dataLangOf(note) }, note) : null,
    span({ className: "clothing-target-check", "aria-hidden": "true" }, createElement(Check, { weight: "bold" })),
  );
};

// Показаны первые цели и выбранная, если она дальше; остальное прячет «Ещё N».
const visibleOf = (options, value, opened) => {
  if (opened || options.length <= VISIBLE) return options;
  const head = options.slice(0, VISIBLE);
  const chosen = options.find((one) => one.key === value);
  return chosen && !head.includes(chosen) ? [...head, chosen] : head;
};

const ProjectCard = (props) => {
  const { project, value, occupied, onChange } = props;
  const [opened, setOpened] = useState(false);
  const badge = badgeOf(project.server);
  const shown = visibleOf(project.options, value, opened);
  const hidden = project.options.length - shown.length;
  const picked = value !== SKIP;
  const keys = useTabListKeys({
    options: [SKIP, ...shown.map((one) => one.key)].map((key) => ({ value: key })),
    value,
    onChange,
    orientation: "both",
    itemSelector: '[role="radio"]',
  });
  const heading = `clothing-project-${project.server}`;
  return section(
    {
      className: classes("clothing-project", [picked, "is-on"]),
      style: badge ? { "--clothing-project-accent": badge.accent } : undefined,
      role: "radiogroup",
      "aria-labelledby": heading,
      ref: keys.listRef,
      onKeyDown: keys.onKeyDown,
    },
    header(
      { className: "clothing-project-head" },
      createElement(Mark, { badge, className: "clothing-project-mark" }),
      h4({ id: heading }, badge ? badge.label : project.server),
      span({ className: "clothing-project-count", "aria-hidden": "true" }, project.options.length),
      button(
        {
          type: "button",
          role: "radio",
          "aria-checked": !picked,
          tabIndex: picked ? -1 : 0,
          className: classes("clothing-project-skip", [!picked, "is-selected"]),
          onClick: () => {
            onChange(SKIP);
          },
        },
        tr("Не ставить"),
      ),
    ),
    div(
      { className: "clothing-project-grid" },
      shown.map((one) => createElement(Tile, { key: one.key, option: one, selected: one.key === value, occupant: occupantOf(occupied, one.item), onPick: onChange })),
      hidden > 0
        ? button(
            {
              type: "button",
              className: "clothing-project-more",
              onClick: () => {
                setOpened(true);
              },
            },
            trFill("Ещё {0}", hidden),
          )
        : null,
    ),
  );
};

// Кнопка расцветки в колонке слева: образец цветом или картинкой и название набора.
const ColourButton = ({ one, chosen, onVariant }) =>
  button(
    {
      type: "button",
      "aria-pressed": chosen,
      className: classes("clothing-colour", [chosen, "is-selected"]),
      onClick: () => {
        onVariant(one.key);
      },
    },
    span({ className: "clothing-colour-swatch", style: one.swatch && !one.image ? { background: one.swatch } : undefined }, one.image ? img({ alt: "", loading: "lazy", src: one.image }) : null),
    span({ lang: dataLangOf(one.setLabel) }, one.setLabel),
  );

// Колонка слева: обложка вещи и, если расцветок несколько, выбор расцветки с правилом.
const SidePanel = (props) => {
  const { mod, variants, variant, rule, onVariant } = props;
  const colours =
    variants.length > 1
      ? section(
          { className: "clothing-projects-colours", "aria-label": tr("Расцветка мода") },
          h4(null, tr("Расцветка мода")),
          createElement(ColourRule, { rule }),
          div({ className: "clothing-colour-list" }, variants.map((one) => createElement(ColourButton, { key: one.key, one, chosen: variant?.key === one.key, onVariant }))),
        )
      : null;
  return createElement(Fragment, null, div({ className: "clothing-projects-cover" }, img({ alt: "", src: coverFor(mod) })), colours);
};

// Выбор по проектам и всё, что из него считается: установки и правило расцветок.
const useChoice = (mod, projects, variants, variant) => {
  const [picks, setPicks] = useState({});
  const installs = useMemo(() => projectInstalls(mod, projects, picks), [mod, projects, picks]);
  const colourCount = installs.reduce((most, one) => Math.max(most, one.target.textures), 0);
  const rule = useMemo(() => colourRuleOf(variants, variant, colourCount), [variants, variant, colourCount]);
  return { picks, setPicks, installs, rule };
};

// Ответ окна: ключи именно в этом порядке, replace — только если есть что заменять.
const answerOf = ({ installs, variant, variants, occupied }) => {
  const replace = [...new Set(installs.map((one) => occupantOf(occupied, one.item)?.modId).filter(Boolean))];
  const [first] = installs;
  return Object.fromEntries([
    ["server", first.server],
    ["variant", variant.letter],
    ["colours", modColoursOf(variants, variant)],
    ["target", first.target],
    ["targets", installs.map((one) => one.target)],
    ["installs", installs],
    ...(replace.length > 0 ? [["replace", replace]] : []),
  ]);
};

// Нижняя строка: выбранные цели по проектам в их порядке.
const SummaryLine = ({ projects, picks }) => {
  const chosen = projects.flatMap((project) => {
    const option = project.options.find((one) => one.key === picks[project.server]);
    return option ? [{ badge: badgeOf(project.server), option }] : [];
  });
  if (chosen.length === 0) return span({ className: "clothing-projects-summary is-empty" }, tr("Выбери вещь хотя бы в одном проекте"));
  return span(
    { className: "clothing-projects-summary" },
    chosen.map(({ badge, option }) => span({ key: option.key, className: "clothing-projects-pick" }, createElement(Mark, { badge, className: "clothing-projects-pick-mark" }), span({ lang: dataLangOf(headline(option)) }, headline(option)))),
  );
};

const ClothingProjectsDialog = (props) => {
  const { mod, projects, kicker, variants = [], variant, onVariant = () => {}, onClose, onConfirm } = props;
  useTr();
  const occupied = useOccupiedClothing();
  const { picks, setPicks, installs, rule } = useChoice(mod, projects, variants, variant);
  const ready = installs.length > 0 && Boolean(variant);

  return createElement(
    Dialog,
    {
      open: true,
      onClose,
      title: tr("На что поставить?"),
      kicker,
      description: tr("Одна вещь на проект, любой можно пропустить"),
      className: "clothing-install-dialog clothing-projects-dialog",
      bodyClassName: "clothing-projects-body",
      size: "wide",
      asideLabel: mod.name,
      asideClassName: "clothing-projects-aside",
      aside: createElement(SidePanel, { mod, variants, variant, rule, onVariant }),
      status: createElement(SummaryLine, { projects, picks }),
      actions: createElement(
        Fragment,
        null,
        createElement(Button, { variant: "ghost", onClick: onClose }, tr("Отмена")),
        createElement(
          Button,
          {
            variant: "primary",
            disabled: !ready,
            onClick: () => {
              if (ready) onConfirm(answerOf({ installs, variant, variants, occupied }));
            },
          },
          tr("Установить"),
        ),
      ),
    },
    projects.map((project) =>
      createElement(ProjectCard, {
        key: project.server,
        project,
        value: picks[project.server] || SKIP,
        occupied,
        onChange: (key) => {
          setPicks((now) => ({ ...now, [project.server]: key }));
        },
      }),
    ),
  );
};

export default ClothingProjectsDialog;
