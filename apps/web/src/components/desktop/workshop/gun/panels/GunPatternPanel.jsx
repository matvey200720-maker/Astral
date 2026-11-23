import { createElement as el, Fragment, memo, useEffect, useRef, useState } from "react";
import Button from "../../../../ui/Button.jsx";
import { PATTERN_GROUPS, PATTERN_ROLES, PATTERNS, findPattern } from "@modovik/gun-studio";
import ColorField from "../../../../ui/ColorField.jsx";
import { ctx, tl, trKey } from "../gun-copy.js";
import SegmentedControl from "../../../../ui/SegmentedControl.jsx";
import { generatePattern } from "../gun-patterns-core.js";
import Select from "../../../../ui/Select.jsx";
import { BlendSelect } from "./GunLayerControls.jsx";
import Slider from "../../../../ui/Slider.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import SectionHeading from "../../../../../features/workshop/section-help.jsx";
import { ImageSquare, Shuffle } from "../../../../ui/icons.jsx";

const PANEL = "ui-panel gun-panel";
const TILE_WIDTH = 72;
const TILE_HEIGHT = 44;
const EDITABLE = { editable: true };

const LINKED_HINT = trKey("Узор лежит на нескольких деталях — цвета, масштаб и рисунок меняются на всех сразу.");

// Куда класть новый узор; "click" - плитка берётся в руку, узор ложится щелчком по детали.
const TARGETS = [
  { value: "body", label: trKey("Корпус") },
  { value: "mag", label: ctx("magazine") },
  { value: "all", label: trKey("Всё") },
  { value: "active", label: trKey("Деталь") },
  { value: "click", label: trKey("По щелчку") },
];

/* ---------- ступени потёртости ---------- */

// Пороги идут по возрастанию; ступень = сколько порогов пройдено (+1, если amount > 0).
const GRADE_LIMITS = [7, 15, 38, 45];
const GRADE_NAMES = [
  () => tr("Новая краска"),
  () => tr("Прямо с завода"),
  () => tr("Немного поношенное"),
  () => tr("После полевых"),
  () => tr("Поношенное"),
  () => tr("Закалённое в боях"),
];

export function wearGrade(amount) {
  const passed = GRADE_LIMITS.filter((limit) => !(amount < limit)).length;
  return GRADE_NAMES[amount <= 0 ? 0 : 1 + passed]();
}

/* ---------- мелкие чистые помощники ---------- */

const helpLines = (...lines) => lines.filter(Boolean);

function rollSeed() {
  const raw = Math.random() * 1000;
  return raw - (raw % 1);
}

// [узор, свой узор]: слой бывает либо узором, либо картинкой с tile.
function classifyLayer(layer) {
  const kind = layer?.kind;
  if (kind === "pattern") return [layer, null];
  if (kind === "image" && layer.tile) return [null, layer];
  return [null, null];
}

function targetOptions(canArm) {
  const options = [];
  for (const entry of TARGETS) {
    if (entry.value === "click" && !canArm) continue;
    options.push({ ...entry, label: tl(entry.label) });
  }
  return options;
}

const only = (extras, name) =>
  extras && Object.hasOwn(extras, name) ? { [name]: extras[name] } : null;

const setter = (patch, field) => (value) => patch({ [field]: value });

/* ---------- плитка узора ---------- */

const REVEAL_VIEW = { block: "start", behavior: "smooth" };

// Плитка просила показать настройки: один раз прокручиваем к секции, когда слой встал.
function revealChosen(reveal, section, patternId) {
  if (!patternId) return;
  if (!reveal.current) return;
  reveal.current = false;
  section?.scrollIntoView?.(REVEAL_VIEW);
}

function paintSwatch(canvas, pattern, colours) {
  const context = canvas?.getContext?.("2d");
  if (!context || typeof ImageData !== "function") return;
  const settings = { pattern, colours, scale: 100, seed: 7 };
  const pixels = generatePattern(settings, TILE_WIDTH, TILE_HEIGHT);
  context.putImageData(new ImageData(pixels, TILE_WIDTH, TILE_HEIGHT), 0, 0);
}

const PatternSwatch = memo(function PatternSwatch({ pattern, colours }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    paintSwatch(canvasRef.current, pattern, colours);
  }, [pattern, colours]);
  return el("canvas", {
    ref: canvasRef,
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    "aria-hidden": "true",
  });
});

/* ---------- ряды: вид -> построитель (первый аргумент - id, он же ключ) ---------- */

const DRAW = {
  node: (_id, element) => element,
  range(id, label, value, min, max, unit, extras, onChange) {
    const props = {
      key: id,
      label,
      ...only(extras, "hint"),
      value,
      min,
      max,
      ...(unit ? { unit } : null),
      ...only(extras, "editable"),
      onChange,
    };
    return el(Slider, props);
  },
  blend: (id, value, onChange) => el(BlendSelect, { key: id, value, onChange }),
  help: (id, text) => el(SectionHeading, { key: id, help: text }),
  pick: (id, label, value, options, onChange) =>
    el(Select, { key: id, label, value, options, onChange }),
  btn(id, variant, icon, attrs, text, onClick) {
    const props = {
      key: id,
      variant,
      size: "sm",
      ...(icon ? { icon: el(icon) } : null),
      ...attrs,
      onClick,
    };
    return text === undefined ? el(Button, props) : el(Button, props, text);
  },
};

const drawRows = (rows) =>
  rows.map((row) => (row ? DRAW[row[1]](row[0], ...row.slice(2)) : null));

function panel(rows, extra) {
  return el("section", { ...extra, className: PANEL }, drawRows(rows));
}

const heading = (...content) => ["title", "node", el("h2", { key: "title" }, ...content)];

// Кнопка-кубик рядом с ползунком варианта; slider уже построен.
function seedRow(id, slider, caption, roll) {
  const labels = { "aria-label": caption, title: caption };
  const dice = DRAW.btn("dice", "secondary", Shuffle, labels, undefined, roll);
  const frame = { key: "seed" + id, className: "gun-seed" };
  return ["seed" + id, "node", el("div", frame, slider, dice)];
}

// Масштаб и поворот одинаковы у обоих видов узора, различается только нижняя граница масштаба.
function turnRows(layer, patch, minScale) {
  const set = (field) => setter(patch, field);
  return [
    ["scale", "range", tr("Масштаб"), layer.scale, minScale, 400, "%", EDITABLE, set("scale")],
    ["rotation", "range", tr("Поворот"), layer.rotation, -180, 180, "°", EDITABLE, set("rotation")],
  ];
}

function finishRows(layer, patch) {
  const opacity = ["opacity", "range", tr("Непрозрачность"), layer.opacity, 0, 100, "%", null];
  return [
    ["blend", "blend", layer.blend, (blend) => patch({ blend })],
    [...opacity, setter(patch, "opacity")],
  ];
}

/* ---------- секция «Добавить узор» ---------- */

function tileFor(item, ctxt) {
  const { target, armed, onArm, onAddPattern, pattern, markReveal } = ctxt;
  const armMode = target === "click";
  const held = armed === item.id;
  const press = () => {
    if (armMode && onArm) {
      onArm(held ? "" : item.id);
      return;
    }
    markReveal();
    onAddPattern(item.id, target);
  };
  const lit = armMode ? held : pattern?.pattern === item.id;
  const props = {
    key: item.id,
    type: "button",
    className: lit ? "gun-pattern-tile is-active" : "gun-pattern-tile",
    title: tl(item.hint.ru),
    "aria-pressed": armMode ? held : undefined,
    onClick: press,
  };
  const swatch = el(PatternSwatch, { pattern: item.id, colours: item.colours });
  return el("button", props, swatch, el("span", null, tl(item.label.ru)));
}

function groupBlocks(ctxt) {
  return PATTERN_GROUPS.map((group) => {
    const members = PATTERNS.filter((item) => item.group === group.id);
    const tiles = members.map((item) => tileFor(item, ctxt));
    return el(
      "div",
      { key: group.id, className: "gun-pattern-group" },
      el("h3", null, tl(group.label.ru)),
      el("div", { className: "gun-pattern-grid" }, tiles),
    );
  });
}

function addSection(ctxt) {
  const { target, setTarget, onArm, onAddImagePattern } = ctxt;
  const switchTarget = (next) => {
    setTarget(next);
    if (next !== "click") onArm?.("");
  };
  const where = {
    label: tr("Куда"),
    size: "sm",
    options: targetOptions(onArm),
    value: target,
    onChange: switchTarget,
  };
  const intro = tr("Плитка кладёт новый слой узора на выбранную часть; цвета, масштаб и рисунок настраиваются ниже.");
  const armHint =
    target === "click" && onArm &&
    el(SectionHeading, { help: tr("Возьмите узор и щёлкните по детали — узор ляжет на неё.") });
  const imageButton =
    onAddImagePattern &&
    DRAW.btn(
      "image",
      "secondary",
      ImageSquare,
      { title: tr("Картинка повторится по детали, как узор: логотип, принт, текстура") },
      tr("Свой узор из картинки"),
      () => onAddImagePattern(target),
    );
  return el(
    "section",
    { className: PANEL },
    el("h2", null, tr("Добавить узор")),
    el(SectionHeading, { help: intro }),
    el(SegmentedControl, where),
    armHint,
    groupBlocks(ctxt),
    imageButton,
  );
}

/* ---------- секция «Свой узор» ---------- */

function ownSection({ ownPattern, linked, onReplaceImage, onLayerPatch }) {
  const patch = (fields) => onLayerPatch(ownPattern.id, fields);
  const notes = helpLines(
    tr("Картинка повторяется по детали. Масштаб — размер одной плитки, сдвиг двигает весь рисунок."),
    linked && tr(LINKED_HINT),
  );
  return panel([
    heading(tr("Свой узор")),
    ["notes", "help", notes],
    onReplaceImage && [
      "replace",
      "btn",
      "secondary",
      ImageSquare,
      null,
      tr("Другая картинка"),
      () => onReplaceImage(ownPattern.id),
    ],
    ...turnRows(ownPattern, patch, 1),
    ["x", "range", tr("Сдвиг вдоль"), ownPattern.x, -50, 150, "%", null, setter(patch, "x")],
    ["y", "range", tr("Сдвиг поперёк"), ownPattern.y, -50, 150, "%", null, setter(patch, "y")],
    ...finishRows(ownPattern, patch),
  ]);
}

/* ---------- секция «Выбранный узор» ---------- */

function inkGrid(pattern, roles, patch) {
  const recolour = (index) => (value) =>
    patch({ colours: Object.assign([...pattern.colours], { [index]: value }) });
  const fieldAt = (ink, index) => {
    if (!roles[index]) return null;
    const props = {
      key: index,
      label: tl(roles[index]),
      value: ink,
      editable: true,
      onChange: recolour(index),
    };
    return el(ColorField, props);
  };
  const fields = pattern.colours.map(fieldAt);
  const grid = el("div", { key: "inks", className: "gun-colour-grid" }, fields);
  return ["inks", "node", grid];
}

function chosenSection(desk, { linked, onLayerPatch, onPaletteFromImage }) {
  const { pattern, chosen, roles, chosenRef } = desk;
  const patch = (fields) => onLayerPatch(pattern.id, fields);
  const label = el("small", null, chosen ? tl(chosen.label.ru) : "");
  const contrast = pattern.contrast ?? 100;
  const seed = DRAW.range(
    "seedSlider",
    tr("Вариант рисунка"),
    pattern.seed,
    0,
    999,
    undefined,
    { hint: tr("Тот же узор — другое расположение пятен и полос"), ...EDITABLE },
    setter(patch, "seed"),
  );
  const paletteTitle = tr("Фото машины, кроссовок, обложки — узор возьмёт четыре главных цвета: самый частый станет основой");
  const designs = PATTERNS.map((item) => [item.id, tl(item.label.ru)]);
  const resetColours = () =>
    patch({ colours: [...(findPattern(pattern.pattern)?.colours || [])] });
  return panel(
    [
      heading(tr("Выбранный узор"), " ", label),
      ["notes", "help", helpLines(chosen && tl(chosen.hint.ru), linked && tr(LINKED_HINT))],
      ["pick", "pick", tr("Сменить рисунок"), pattern.pattern, designs, setter(patch, "pattern")],
      inkGrid(pattern, roles, patch),
      ["reset", "btn", "ghost", null, null, tr("Цвета узора по умолчанию"), resetColours],
      onPaletteFromImage && [
        "palette",
        "btn",
        "secondary",
        ImageSquare,
        { title: paletteTitle },
        tr("Цвета с картинки"),
        () => onPaletteFromImage(pattern.id),
      ],
      ...turnRows(pattern, patch, 10),
      seedRow("Pattern", seed, tr("Случайный вариант рисунка"), () => patch({ seed: rollSeed() })),
      ["contrast", "range", tr("Контраст"), contrast, 0, 200, "%", null, setter(patch, "contrast")],
      ...finishRows(pattern, patch),
    ],
    { ref: chosenRef },
  );
}

/* ---------- секция «Потёртость» ---------- */

function wearSection(wear, onWear) {
  const patchWear = (fields) => onWear(fields);
  const explain = tr("Краска сходит с металла пятнами и царапинами — как float у скинов CS2. Наклейки стираются отдельно, своим соскобом.");
  const roll = () => patchWear({ seed: rollSeed() });
  const setAmount = setter(patchWear, "amount");
  const seedSlider = () => {
    const apply = setter(patchWear, "seed");
    const label = tr("Рисунок потёртости");
    return DRAW.range("wearSeed", label, wear.seed, 0, 999, undefined, null, apply);
  };
  return panel([
    heading(tr("Потёртость")),
    ["notes", "help", explain],
    ["amount", "range", wearGrade(wear.amount), wear.amount, 0, 100, "%", null, setAmount],
    wear.amount > 0 && seedRow("Wear", seedSlider(), tr("Другой рисунок потёртости"), roll),
  ]);
}

/* ---------- состояние и сама панель ---------- */

// Состояние панели одним объектом. Порядок хуков: язык, режим, две ссылки, эффект прокрутки.
function usePatternDesk(layer) {
  useTr();
  const [target, setTarget] = useState("body");
  const [pattern, ownPattern] = classifyLayer(layer);
  const chosen = pattern ? findPattern(pattern.pattern) : null;
  const roles = chosen?.roles || PATTERN_ROLES;
  const chosenRef = useRef(null);
  const reveal = useRef(false);
  const patternId = pattern?.id || "";

  useEffect(() => {
    revealChosen(reveal, chosenRef.current, patternId);
  }, [patternId]);

  const markReveal = () => {
    reveal.current = true;
  };
  return { target, setTarget, pattern, ownPattern, chosen, roles, chosenRef, markReveal };
}

export default function GunPatternPanel(props) {
  const { layer, wear, onWear, onLayerPatch, onAddPattern, onPaletteFromImage } = props;
  const { linked = false, armed = "", onArm = null } = props;
  const { onAddImagePattern = null, onReplaceImage = null } = props;
  const desk = usePatternDesk(layer);
  const { pattern, ownPattern } = desk;

  return el(
    Fragment,
    null,
    addSection({ ...desk, armed, onArm, onAddPattern, onAddImagePattern }),
    ownPattern && ownSection({ ownPattern, linked, onReplaceImage, onLayerPatch }),
    pattern && chosenSection(desk, { linked, onLayerPatch, onPaletteFromImage }),
    wearSection(wear, onWear),
  );
}
