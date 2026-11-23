import { createElement as h, Fragment, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { tr, useTr } from "../../../../locales/ui.js";
import { mapText } from "./map-copy.js";
import { counted } from "../../../../plural.js";
import {
  MAP_DETAIL_LEVELS,
  MAP_TEXTURE_MAP,
  MOD_PACK_TEMPLATE,
  mapColorModel,
  normalizeRadarTilt,
} from "@modovik/vector-map";
import { writeMapMemory } from "../world-map-memory.js";
import { NavRow, PanelSection } from "./MapPanelParts.jsx";
import VolumeLines from "./MapVolume.jsx";
import TiltLines from "./MapTilt.jsx";
import { tiltAvailable } from "./tilt-gate.js";
import { LookPicture, currentLook, lookNote, lookTitle } from "./MapLooks.jsx";
import ReliefPage, { ReliefSwitch, reliefCaption } from "./MapRelief.jsx";
import { DetailPage, TexturePage } from "./MapPanelPages.jsx";
import MapLookPage from "./MapLookPage.jsx";
import MapDoubtful from "./MapDoubtful.jsx";
import ModName from "../../catalog/ModName.jsx";
import { Swatches } from "../world-map-panel-parts.jsx";
import Button from "../../../ui/Button.jsx";
import Switch from "../../../ui/Switch.jsx";
import Slider from "../../../ui/Slider.jsx";
import {
  CaretRight,
  GridFour,
  MagnifyingGlassPlus,
  MapTrifold,
  Mountains,
  Scissors,
  Waves,
} from "../../../ui/icons.jsx";

// ---------- таблица страниц ----------

export const MAP_PAGES = Object.freeze({
  home: { label: "Карта", note: "Вид, цвета, рельеф и сетка" },
  look: { label: "Вид карты", note: "Карта, её цвета и тон" },
  relief: { label: "Рельеф", note: "Горы штата из высот игры" },
  texture: { label: "Текстура", note: "Бумага, зерно, сетка — поверх карты" },
  detail: { label: "Чёткость карты", note: "Как резко карта выглядит в игре при приближении" },
});

const PAGE_NAMES = new Set(Object.keys(MAP_PAGES));

function pageKey(page) {
  if (typeof page !== "string") return "home";
  return PAGE_NAMES.has(page) ? page : "home";
}

const VECTOR_SOURCES = new Set(["pack", "game"]);

export function mapIsVector(config, context = {}) {
  const { source } = mapColorModel(config, context);
  return VECTOR_SOURCES.has(source);
}

export function mapPanelHead(page, { config, onBack, onSection, vector = true }) {
  const key = pageKey(page);
  const { label, note } = MAP_PAGES[key];
  const head = { label: tr(label), note: tr(note) };
  if (key === "home") return { ...head, icon: h(MapTrifold) };

  // Проект читается в момент щелчка, а не при сборке шапки.
  const patchBase = (patch, caption, prop) =>
    onSection({ base: { ...config.base, ...patch } }, caption, prop);
  const actions =
    key === "relief" && vector ? h(ReliefSwitch, { base: config.base, patchBase }) : null;
  return { ...head, back: { label: tr("Назад к карте"), onClick: onBack }, actions };
}

// ---------- мелкие помощники разметки ----------

const node = (name, cls, more, ...kids) => h(name, { className: cls, ...more }, ...kids);
const pressable = (cls, more, ...kids) =>
  h("button", { type: "button", className: cls, ...more }, ...kids);

const FALLBACKS = {
  page: "home",
  onPage: null,
  thumbs: {},
  geometry: false,
  onTexture: null,
  source: "",
  mapColors: [],
  memoryId: "",
  onFocusObject: null,
  onSplitPack: null,
  tileSide: 0,
  weightScene: null,
  live: null,
};

// Умолчания только для «не задано»: null и ложные значения остаются как есть.
function withFallbacks(given) {
  const out = { ...given };
  for (const key of Object.keys(FALLBACKS)) {
    if (out[key] === undefined) out[key] = FALLBACKS[key];
  }
  return out;
}

const pick = (source, names) => Object.fromEntries(names.map((name) => [name, source[name]]));

// ---------- подписи строк главной ----------

const COLOR_WORDS = ["цвет", "цвета", "цветов"];
const STRIP_FALLBACK = ["#3a3a3a", "#6b6b6b", "#b4b4b4"];

function colorsNote({ groups, changed, source }) {
  if (groups.length === 0) {
    return tr(source === "image" ? "Снимок — меняется только тон" : "Тон и общий цвет");
  }
  if (!(changed > 0)) return tr("Дороги, суша, пляжи — любой цвет");
  const forms = COLOR_WORDS.map((word) => tr(word));
  return mapText("Изменено: {count}", { count: counted(changed, forms) });
}

function textureNote(textureId) {
  const label = textureId === "image" ? "Своя картинка" : MAP_TEXTURE_MAP[textureId]?.label;
  return tr(label || "Нет");
}

function detailNote(config) {
  const level = MAP_DETAIL_LEVELS.find(({ value }) => value === config.export?.detail);
  return level ? tr(level.label) : null;
}

const NAV_ROWS = {
  relief: { Icon: Mountains, title: "Рельеф" },
  texture: { Icon: Waves, title: "Текстура" },
  detail: { Icon: MagnifyingGlassPlus, title: "Чёткость карты" },
};

function navRow(page, caption, open) {
  const { Icon, title } = NAV_ROWS[page];
  return h(NavRow, { page, icon: h(Icon), title: tr(title), caption, onOpen: open });
}

// ---------- первая секция: вид, цвета, «Разрезать» ----------

// Картинка вида для предпросмотра наклона радара: та же, что на карточке вида.
const radarPicture = (config, thumbs) => h(LookPicture, { look: currentLook(config), thumbs });

function lookCard(config, thumbs, open) {
  const look = currentLook(config);
  return pressable(
    "wmc-look-card",
    { "data-map-page": "look", onClick: () => open("look") },
    node("span", "wmc-look-card-picture", null, h(LookPicture, { look, thumbs })),
    node(
      "span",
      "wmc-look-card-copy",
      null,
      h("b", null, lookTitle(look)),
      h("small", null, h(ModName, { name: lookNote(look, config) })),
    ),
    node("span", "wmc-look-card-action", null, tr("Сменить")),
  );
}

function colorsRow(model, memoryId, open) {
  const tones = model.strip.length > 0 ? model.strip : STRIP_FALLBACK;
  const go = () => {
    writeMapMemory(memoryId, "colorsOpen", true);
    open("look");
  };
  return pressable(
    "wmc-colors-row",
    { "data-map-page": "look", "data-map-focus": "colors", onClick: go },
    node(
      "span",
      "wmc-colors-strip",
      { "aria-hidden": "true" },
      ...tones.map((tone, i) => h("i", { key: i, style: { background: tone } })),
    ),
    node("span", "wmc-colors-copy", null, h("b", null, tr("Цвета карты")), h("small", null, colorsNote(model))),
    h(CaretRight),
  );
}

function splitAction(templateId, onSplitPack) {
  if (templateId !== MOD_PACK_TEMPLATE || !onSplitPack) return null;
  return h(
    Button,
    {
      className: "wmc-nav-row",
      variant: "ghost",
      block: true,
      icon: h(Scissors),
      caption: tr("Подписи, точки, зоны и значки — отдельными объектами"),
      onClick: onSplitPack,
    },
    tr("Разрезать на слои"),
  );
}

// ---------- сетка координат ----------

const GRID_NOTES = {
  gridStep: "Шаг сетки",
  gridOpacity: "Видимость сетки",
  gridColor: "Цвет сетки",
  gridLabels: "Подписи сетки",
  gridLabelColor: "Цвет букв сетки",
  gridLabelSize: "Размер букв сетки",
};

// Обработчик правки одного поля раздела base: (поле, подпись) -> (значение) -> patchBase.
const committer =
  (patchBase) =>
  (field, note = GRID_NOTES[field]) =>
  (value) =>
    patchBase({ [field]: value }, tr(note), `base.${field}`);

function gridSlider(commit, label, field, value, [min, max, step], unit) {
  const props = { label: tr(label), value, min, max, step, onChange: commit(field) };
  if (unit) props.unit = unit;
  return h(Slider, props);
}

function gridSwitch(extra, icon, text, aria, checked, onChange) {
  return node("label", `ui-field wmc-switch-line${extra}`, null, h("span", null, icon, text), h(Switch, { checked, label: aria, onChange }));
}

function colorField(caption, label, value, onChange, ...tail) {
  return node(
    "div",
    "wmc-field-block",
    null,
    node("small", "wmc-field-caption", null, caption),
    h(Swatches, { label, value, onChange }),
    ...tail,
  );
}

function lettersControls(base, commit) {
  const colored = Boolean(base.gridLabelColor);
  const unlink = colored
    ? h(
        Button,
        {
          variant: "ghost",
          size: "sm",
          onClick: () => commit("gridLabelColor", "Цвет букв сетки как у линий")(""),
        },
        tr("Как у линий"),
      )
    : null;
  return [
    colorField(
      tr(colored ? "Цвет букв и цифр" : "Цвет букв и цифр · как у линий"),
      tr("Цвет букв и цифр"),
      base.gridLabelColor,
      commit("gridLabelColor"),
      unlink,
    ),
    gridSlider(commit, "Размер букв и цифр", "gridLabelSize", base.gridLabelSize, [50, 200, 5], "%"),
  ];
}

function gridControls(base, patchBase) {
  const commit = committer(patchBase);
  return node(
    "div",
    "wmc-list-sub",
    null,
    gridSlider(commit, "Клеток в ширину", "gridStep", base.gridStep, [4, 24, 1]),
    gridSlider(commit, "Видимость", "gridOpacity", base.gridOpacity, [5, 100, 1], "%"),
    colorField(
      tr("Цвет линий сетки"),
      tr("Цвет линий сетки"),
      base.gridColor,
      commit("gridColor"),
    ),
    gridSwitch("", null, tr("Буквы и цифры по краям"), tr("Буквы и цифры сетки"), base.gridLabels, commit("gridLabels")),
    ...(base.gridLabels ? lettersControls(base, commit) : []),
  );
}

// ---------- главная ----------

function HomePage({ p, kit }) {
  useTr();
  const { config, thumbs, memoryId, onFocusObject, onSplitPack, onSection } = p;
  const { base, model, vector, patchBase, patchTilt, open } = kit;
  const gridOn = base.gridOpacity > 0;
  const toggleGrid = (on) => committer(patchBase)("gridOpacity", on ? "Сетка показана" : "Сетка скрыта")(on ? 34 : 0);

  const first = h(
    PanelSection,
    { title: tr("Вид карты"), icon: h(MapTrifold) },
    lookCard(config, thumbs, open),
    colorsRow(model, memoryId, open),
    splitAction(base.templateId, onSplitPack),
  );
  const list = node(
    "section",
    "ui-panel wmc-section wmc-map-section wmc-map-list",
    { "aria-label": tr("Рельеф, сетка, текстура и чёткость") },
    navRow("relief", reliefCaption(base, vector), open),
    // «3D-здания» (21.11): настоящие здания в мини-карте; включение зданий включает и наклон радара.
    h(VolumeLines, { config, patchBase, onSection }),
    // «Наклон радара» как в машине: настоящая камера игры, не картинка (`tilt-gate.js`).
    tiltAvailable(config)
      ? h(TiltLines, {
          tilt: normalizeRadarTilt(config.radar?.tilt),
          patchTilt,
          picture: radarPicture(config, thumbs),
        })
      : null,
    gridSwitch(" wmc-list-switch", h(GridFour), tr("Сетка координат"), tr("Сетка координат"), gridOn, toggleGrid),
    gridOn ? gridControls(base, patchBase) : null,
    base.source === "schematic" ? null : navRow("texture", textureNote(base.textureId), open),
    navRow("detail", detailNote(config), open),
  );
  return h(Fragment, null, first, h(MapDoubtful, { config, onFocusObject, patchBase }), list);
}

// ---------- переход между страницами ----------

// Направление последнего перехода выставляется в той же отрисовке, где сменилась страница.
function useDirection(name) {
  const [track, move] = useReducer(
    (_, next) => ({ name: next, dir: next === "home" ? "back" : "forward" }),
    { name, dir: null },
  );
  if (track.name !== name) move(name);
  return track.dir;
}

// Прокрутка панели и фокус после смены страницы.
function settle(column, from, to, savedScroll) {
  const scroller = column?.closest(".ui-editor-panel");
  if (!scroller) return;
  const homeward = to === "home";
  scroller.scrollTop = homeward ? savedScroll : 0;
  const target = homeward
    ? column.querySelector(`[data-map-page="${from}"]`)
    : column.closest(".ui-editor-inspector")?.querySelector(".ui-editor-panel-back");
  target?.focus({ preventScroll: true });
}

function useLanding(column, name, saved) {
  const before = useRef(name);
  useLayoutEffect(() => {
    const from = before.current;
    before.current = name;
    if (from !== name) settle(column.current, from, name, saved.current);
  }, [name, column, saved]);
}

const PAGE_VIEWS = {
  home: (p, kit) => h(HomePage, { p, kit }),
  look: (p, kit) =>
    h(MapLookPage, {
      ...pick(p, ["config", "thumbs", "geometry", "mapColors", "source", "memoryId", "onConfig"]),
      onChoose: p.onChooseLook,
      patchBase: kit.patchBase,
    }),
  relief: (p, kit) => h(ReliefPage, { base: kit.base, vector: kit.vector, patchBase: kit.patchBase }),
  texture: (p, kit) =>
    h(TexturePage, { base: kit.base, patchBase: kit.patchBase, onTexture: p.onTexture }),
  detail: (p) => h(DetailPage, pick(p, ["config", "tileSide", "weightScene", "live", "onSection"])),
};

export default function MapPanel(props) {
  const p = withFallbacks(props);
  const { config, onSection, onPage } = p;
  const base = config.base;
  const name = pageKey(p.page);
  const column = useRef(null);
  const homeScroll = useRef(0);
  const dir = useDirection(name);
  useLanding(column, name, homeScroll);

  const detected = p.mapColors.length > 0;
  const { geometry } = p;
  const context = useMemo(() => ({ geometry, detected }), [geometry, detected]);
  // Одна модель цветов на колонку: из неё же берётся и «векторная ли подложка».
  const model = useMemo(() => mapColorModel(config, context), [config, context]);
  const patchBase = useMemo(
    () => (patch, label, prop) => onSection({ base: { ...base, ...patch } }, label, prop),
    [base, onSection],
  );
  // Наклон радара: сила и выключатель лежат в `config.radar.tilt`, остальное в `radar` не трогается.
  const patchTilt = useMemo(
    () => (patch, label, prop) =>
      onSection(
        { radar: { ...config.radar, tilt: { ...normalizeRadarTilt(config.radar?.tilt), ...patch } } },
        label,
        prop,
      ),
    [config.radar, onSection],
  );
  const open = (target) => {
    const scroller = column.current?.closest(".ui-editor-panel");
    if (scroller) homeScroll.current = scroller.scrollTop;
    onPage?.(target);
  };
  const kit = { base, model, vector: VECTOR_SOURCES.has(model.source), patchBase, patchTilt, open };

  return node(
    "div",
    "wmc-map-panel",
    { ref: column },
    node(
      "div",
      "wmc-map-page",
      { key: name, "data-page": name, "data-dir": dir || undefined },
      PAGE_VIEWS[name](p, kit),
    ),
  );
}
