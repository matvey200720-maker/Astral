// Эффекты автора редукса: значок группы, запись окна «Компоненты» и окно с подробностями.
import { useId } from "react";
import {
  TEXTURE_DICTIONARY_GLYPHS,
  knownTextureDictionary,
} from "../../../../features/catalog/redux-effects.js";
import { reduxEffectsCopy } from "../../../../features/catalog/redux-effects-copy.js";
import Button from "../../../ui/Button.jsx";
import Dialog from "../../../ui/Dialog.jsx";
import { Fire, HourglassMedium } from "../../../ui/icons.jsx";

/* ---------- узлы: [тег или компонент, свойства, ...дети] и один обходчик ---------- */

const build = (spec, at) => {
  if (!Array.isArray(spec)) return spec;
  const [Tag, props, ...kids] = spec;
  return (
    <Tag key={at} {...props}>
      {kids.map(build)}
    </Tag>
  );
};

const NO_TRANSLATE = { translate: "no", "data-no-translate": "" };

/* ---------- контуры значков ---------- */

const line = (d, extra = {}) => ["path", { d, ...extra }];
const dot = (cx, cy, r) => ["circle", { cx, cy, r }];
const frame = (x, y, width, height) => ["rect", { x, y, width, height, rx: 4 }];

const CLOUD = "M14 46 C6 46 6 34 15 34 C14 24 28 22 30 30 C34 20 50 22 48 34 C58 34 58 46 48 46 Z";
const SPOTS = [dot(18, 20, 5), dot(44, 16, 4), dot(32, 36, 6), dot(14, 48, 4), dot(50, 44, 5)];

const GLYPHS = {
  other: SPOTS,
  water: [line("M32 6 C40 20 48 30 48 40 C48 50 40 58 32 58 C24 58 16 50 16 40 C16 30 24 20 32 6 Z")],
  table: [frame(8, 12, 48, 40), line("M8 26 H56 M8 39 H56 M26 12 V52")],
  sheet: [frame(8, 12, 48, 40), dot(22, 25, 4), line("M8 46 L24 34 L34 42 L42 36 L56 46")],
  dictionary: [frame(12, 8, 40, 48), line("M20 20 H44 M20 30 H44 M20 40 H36")],
  weather: [
    line("M17 38 C8 38 8 25 18 25 C18 15 32 13 35 21 C39 12 55 15 52 27 C61 27 61 38 51 38 Z"),
    line("M22 46 L18 56 M34 46 L30 56 M46 46 L42 56"),
  ],
  smoke: [line(CLOUD), line("M22 54 H44")],
  impacts: [
    dot(32, 32, 7),
    line("M32 6 V18 M32 46 V58 M6 32 H18 M46 32 H58 M14 14 L22 22 M42 42 L50 50 M50 14 L42 22 M22 42 L14 50"),
  ],
  fire: [
    line(
      "M32 6 C40 18 48 24 48 38 C48 50 40 58 32 58 C24 58 16 50 16 38 C16 28 24 24 26 14 C30 22 32 24 32 28 C36 22 34 14 32 6 Z",
    ),
  ],
  flashes: [line("M32 6 L37 24 L56 20 L42 32 L56 44 L37 40 L32 58 L27 40 L8 44 L22 32 L8 20 L27 24 Z")],
  blood: [
    line("M28 14 C34 24 40 30 40 38 C40 46 34 50 28 50 C22 50 16 46 16 38 C16 30 22 24 28 14 Z"),
    dot(46, 18, 3),
    dot(50, 44, 4),
    dot(12, 56, 2.5),
  ],
  tracers: [
    line("M8 50 L44 14"),
    line("M14 56 L50 20", { strokeDasharray: "4 6" }),
    line("M44 14 L56 8 L50 20 Z"),
  ],
};

const SVG_BASE = {
  viewBox: "0 0 64 64",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "4.5",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  focusable: "false",
};

// Чёрная черта вырезает диагональ из контура, белая рисуется поверх.
const DIAGONAL = "M8 56 L56 8";
const cutMask = (maskId) =>
  build([
    "defs",
    {},
    [
      "mask",
      { id: maskId, maskUnits: "userSpaceOnUse" },
      ["rect", { x: "0", y: "0", width: "64", height: "64", fill: "#fff" }],
      ["path", { d: DIAGONAL, stroke: "#000", strokeWidth: "11" }],
    ],
  ]);
const strike = () => build(["path", { d: DIAGONAL, strokeWidth: "4" }]);

/* ---------- обложка записи ---------- */

const SPARSE_UP_TO = 3;

// Знак обложки: { id, off, count, added }; число и «+N» показываются только больше нуля.
const signSpec = ({ id, off, count, added }) => [
  "span",
  { className: "mod-effects-chip" },
  [EffectGlyph, { id, off }],
  count > 0 && ["b", {}, count],
  added > 0 && ["small", {}, `+${added}`],
];

const redrawnSigns = ({ redrawn }) =>
  redrawn.map(({ id, textures, added }) => ({ id, count: textures, added }));

// Известные словари текстур — каждый своим знаком один раз, остальные — одним листом с числом.
const textureSigns = (names) => {
  const known = new Map();
  let rest = 0;
  for (const name of names) {
    const key = knownTextureDictionary(name);
    const glyph = key ? TEXTURE_DICTIONARY_GLYPHS[key] : null;
    if (glyph && glyph !== "sheet") known.set(key, glyph);
    else rest += 1;
  }
  const own = [...known.values()].map((id) => ({ id, off: true }));
  return rest > 0 ? [...own, { id: "sheet", off: true, count: rest }] : own;
};

const switchedOffSigns = (effects) => {
  const groups = effects.disabled.map(({ id, count }) => ({ id, off: true, count }));
  const particles =
    effects.emptyDictionaries > 0
      ? [{ id: "dictionary", off: true, count: effects.emptyDictionaries }]
      : [];
  return [...groups, ...particles, ...textureSigns(effects.emptyTextureDictionaries)];
};

const namedSigns = ({ dictionaries, textureDictionaries, tables }) =>
  [
    ["dictionary", dictionaries],
    ["sheet", textureDictionaries],
    ["table", tables],
  ]
    .filter(([, names]) => names.length > 0)
    .map(([id, names]) => ({ id, count: names.length }));

const coverSpec = (effects) => {
  const redrawn = redrawnSigns(effects);
  const off = switchedOffSigns(effects);
  const named = redrawn.length > 0 || off.length > 0 ? [] : namedSigns(effects);
  const total = redrawn.length + named.length + off.length;
  const rows = [
    ["is-redrawn", redrawn],
    ["is-redrawn", named],
    ["is-off", off],
  ]
    .filter(([, signs]) => signs.length > 0)
    .map(([kind, signs]) => ["span", { className: `mod-effects-row ${kind}` }, ...signs.map(signSpec)]);
  const sparse = total <= SPARSE_UP_TO ? " is-sparse" : "";
  return [
    "span",
    { className: `workshop-cover mod-effects-cover${sparse}`, "aria-hidden": "true" },
    ...rows,
  ];
};

const EffectsCover = ({ effects }) => build(coverSpec(effects));

/* ---------- окно с подробностями ---------- */

// Строка списка: значок, название (<b> или имя файла в <code>) и необязательная подробность.
const lineSpec = ({ glyph, off, name, code, detail }) => [
  "li",
  {},
  [EffectGlyph, { id: glyph, off }],
  [
    "span",
    {},
    code === undefined ? ["b", {}, name] : ["code", NO_TRANSLATE, code],
    detail ? ["span", { className: "mod-effects-detail" }, ` · ${detail}`] : null,
  ],
];

const nameList = (names) => [
  "ul",
  { className: "mod-effects-names" },
  ...names.map((name) => ["li", {}, ["code", NO_TRANSLATE, name]]),
];

const redrawnRows = (effects, copy) =>
  effects.redrawn.map(({ id, textures, added, ownParticles }) => ({
    glyph: id,
    name: copy.groups[id],
    detail: [
      textures > 0 && copy.textures(textures),
      added > 0 && copy.own(added),
      ownParticles && copy.ownParticles,
    ]
      .filter(Boolean)
      .join(", "),
  }));

const sheetRow = (name, copy) => {
  const key = knownTextureDictionary(name);
  if (!key) return { glyph: "sheet", off: true, code: name };
  return { glyph: TEXTURE_DICTIONARY_GLYPHS[key], off: true, name: copy.sheets[key] };
};

const disabledRows = (effects, copy) => [
  ...effects.disabled.map(({ id, count }) => ({
    glyph: id,
    off: true,
    name: copy.groups[id],
    detail: copy.textures(count),
  })),
  ...effects.emptyTextureDictionaries.map((name) => sheetRow(name, copy)),
  ...(effects.emptyDictionaries > 0
    ? [{ glyph: "dictionary", off: true, name: copy.emptyDictionaries(effects.emptyDictionaries) }]
    : []),
];

// Секции окна по порядку; пустая секция не рисуется. body отдаёт список узлов.
const SECTIONS = [
  {
    id: "mod-effects-redrawn",
    heading: "redrawn",
    shown: (fx) => fx.redrawn.length > 0,
    body: (fx, copy) => [["ul", { className: "mod-effects-list" }, ...redrawnRows(fx, copy).map(lineSpec)]],
  },
  {
    id: "mod-effects-disabled",
    heading: "disabled",
    shown: (fx) =>
      fx.disabled.length > 0 || fx.emptyDictionaries > 0 || fx.emptyTextureDictionaries.length > 0,
    body: (fx, copy) => [
      ["ul", { className: "mod-effects-list" }, ...disabledRows(fx, copy).map(lineSpec)],
      ["p", { className: "mod-peek-note" }, copy.disabledNote],
    ],
  },
  {
    id: "mod-effects-dictionaries",
    heading: "dictionaries",
    shown: (fx) => fx.dictionaries.length > 0,
    body: (fx) => [nameList(fx.dictionaries)],
  },
  {
    id: "mod-effects-texture-dictionaries",
    heading: "textureDictionaries",
    shown: (fx) => fx.textureDictionaries.length > 0,
    body: (fx) => [nameList(fx.textureDictionaries)],
  },
  {
    id: "mod-effects-tables",
    heading: "tables",
    shown: (fx) => fx.tables.length > 0,
    body: (fx) => [nameList(fx.tables)],
  },
];

const sectionSpec = ({ id, heading, body }, effects, copy) => [
  "section",
  { className: "mod-peek-section", "aria-labelledby": id },
  ["h3", { id }, copy[heading]],
  ...body(effects, copy),
];

/* ---------- экспорты ---------- */

export function ReduxEffectsDialog({ effects, language, onClose }) {
  const copy = reduxEffectsCopy(language);
  const waiting = [
    "span",
    { className: "mod-effects-status" },
    [HourglassMedium, { weight: "bold", "aria-hidden": "true" }],
    `${copy.soon} · ${copy.waits}`,
  ];
  const sections = SECTIONS.filter(({ shown }) => shown(effects)).map((section, at) =>
    build(sectionSpec(section, effects, copy), at),
  );
  const frameProps = {
    open: true,
    onClose,
    kicker: copy.section,
    title: copy.title,
    description: copy.about,
    size: "md",
    className: "mod-peek mod-effects-peek",
    bodyClassName: "mod-peek-body",
    status: effects.waits ? build(waiting) : null,
    actions: (
      <Button variant="secondary" onClick={onClose}>
        {copy.done}
      </Button>
    ),
  };
  return (
    <Dialog {...frameProps}>
      <>{sections}</>
    </Dialog>
  );
}

export function effectsEntry(effects, language, onOpen) {
  const { title, soon, waits } = reduxEffectsCopy(language);
  const pending = effects.waits
    ? { sub: soon, meta: `${soon}: ${waits}` }
    : { sub: null, meta: null };
  const thumb = { media: <Fire weight="regular" /> };
  const face = { media: <EffectsCover effects={effects} /> };
  return {
    key: "redux-effects",
    title,
    sub: pending.sub,
    ariaLabel: pending.meta ? `${title}. ${pending.meta}` : title,
    thumb,
    face,
    meta: pending.meta,
    actions: null,
    onOpen,
  };
}

export function EffectGlyph({ id, off = false, className = "" }) {
  const maskId = `effects-off-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const shapes = Object.hasOwn(GLYPHS, id) ? GLYPHS[id] : GLYPHS.other;
  const classes = ["mod-effects-glyph", off && "is-off", className].filter(Boolean).join(" ");
  return (
    <svg className={classes} data-glyph={id} {...SVG_BASE}>
      {off && cutMask(maskId)}
      <g mask={off ? `url(#${maskId})` : undefined}>{shapes.map(build)}</g>
      {off && strike()}
    </svg>
  );
}
