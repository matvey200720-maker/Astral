import { trFill } from "../../../locales/tr-fill.js";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import {
  FLAG_BRIGHTNESS,
  FLAG_FOLDS,
  FLAG_OFFSET,
  FLAG_SATURATION,
  FLAG_ZOOM,
} from "@modovik/climb-contract/recolor/flags";
import { countryThumb } from "./flags-art.js";
import Slider from "../../../components/ui/Slider.jsx";
import {
  FLAG_CLOTH_ASPECT,
  FLAG_COUNTRIES,
  FLAG_KINDS,
  FLAG_TOTAL,
} from "@modovik/climb-contract/recolor/flags";
import { createElement as h, memo, useState } from "react";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import {
  flagCountry,
  flagImagePlacement,
  flagIsOwn,
  flagKind,
} from "@modovik/climb-contract/recolor/flags";
import NavRow from "../../../components/ui/NavRow.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { Flag } from "../../../components/ui/icons.jsx";
import {
  flagLookDraws,
  flagLookIsStock,
  flagLookOf,
  flagsProjectIsStock,
} from "@modovik/climb-contract/recolor/flags";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import { loadSceneImage } from "../model-stage/scene-textures.js";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import { useSurfaceStock } from "../surface-stock.js";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import {
  HANGAR_EMBLEM_ACCEPT,
  convertedImageText,
  saveHangarEmblem,
  useHangarEmblemUrl,
} from "../hangar-editor/hangar-emblem.js";
import SurfaceFit from "../../../components/ui/SurfaceFit.jsx";
import { flagStudioSurface } from "./flags-studio.js";
import StudioPictureButton from "../texture-studio/StudioPictureButton.jsx";
import {
  ALL_FLAGS,
  FLAG_SWATCHES,
  flagsText,
  frameKindOf,
  kindModelsText,
  kindStateText,
  lookText,
  offsetText,
  percentText,
  targetLabel,
} from "./flags-text.js";

const FLAG_ROWS_SHOWN = 5;
const IMAGE_HINT = "Любая картинка. Лучше вытянутая, как флаг. Остаётся на этом компьютере.";

// какие пропсы нужны каждому инструменту
const COUNTRY_PROPS = ["project", "target", "onCountry", "onStock", "onStandard"];
const TOOL_PROPS = ["project", "target", "onTarget", "onLook", "onClearOwn", "onStock", "onTool", "onNotice"];

// порядок разделов колонки основного инструмента
const PART_ORDER = ["Picture", "Fit", "More", "Folds", "Kinds", "Actions"];

// миниатюра под картинку по режиму вида
const THUMBS = { country: (look) => countryThumb(look.country, 380, 200) };

// ---------- фабрики ----------

const pair = (left, right) => `${left} · ${right}`;
const when = (cond, make) => cond && make();
const pick = (source, names) => Object.fromEntries(names.map((name) => [name, source[name]]));
const countryName = (code) => flagCountry(code)?.label;

// запись в журнал правок: «<цель>: <шаг>»
const noted = (onLook, name) => (patch, label) => onLook(patch, `${name}: ${label}`);
// обработчик одного поля вида
const patcher = (set, field, note) => (next) => set({ [field]: next }, note);
const adopter = (set) => (image) => set({ mode: "image", image }, tr("своя картинка"));
// ползунок: значение, границы и запись
const ranged = (look, set, field, [min, max], note) => ({
  value: look[field],
  min,
  max,
  onChange: patcher(set, field, note),
});
// строки кнопок: [условие, id, подпись, действие, добавка]; ложное условие остаётся на месте
const actionRows = (rules) =>
  rules.map(([ok, id, label, onClick, extra]) => ok && { id, label, ...extra, onClick });
const section = (id, props, ...kids) =>
  h(ListGroup, { key: id, ...props, "data-flags-section": id }, ...kids);

const lookFor = (project, target) => {
  if (target !== ALL_FLAGS) return flagLookOf(project, target);
  return project.all;
};

const ratioOf = ({ width, height }) => (width && height ? width / height : FLAG_CLOTH_ASPECT);

// ---------- тексты ----------

// подпись под картинкой: первая подошедшая пара [проверка, подпись]
const CAPTIONS = [
  [(look) => look.mode === "country", (look) => countryName(look.country) || tr("Флаг страны")],
  [(look) => look.mode === "image" && look.image.asset, (look) => look.image.name || tr("Своя картинка")],
];

const lookCaption = (look) => {
  for (const [applies, text] of CAPTIONS) if (applies(look)) return text(look);
  return "";
};

const pictureCaption = (look, own) => {
  const text = lookCaption(look);
  if (!text) return text;
  return own || flagLookIsStock(look) ? text : pair(tr("Как у всех флагов"), text);
};

const allNote = (own) => {
  const total = flagsText(FLAG_TOTAL);
  return [
    trFill("Ляжет на все {0} карты — на флагштоках у домов, на крышах, у полиции и пожарных, на яхтах.", total),
    own ? trFill("Виды со своим флагом ({0}) остаются своими.", own) : null,
  ];
};

const kindNote = (kind) => {
  const [label, count, models] = [tr(kind.label), flagsText(kind.count), kindModelsText(kind)];
  return [trFill("Ляжет только на «{0}»: {1} на карте ({2}).", label, count, models)];
};

const targetNote = (project, target) =>
  target === ALL_FLAGS ? allNote(Object.keys(project.kinds).length) : kindNote(flagKind(target));

const allCaption = (look) => {
  const total = flagsText(FLAG_TOTAL);
  return flagLookIsStock(look) ? total : pair(total, lookText(look));
};

const kindCaption = (project, id) => {
  const item = flagKind(id);
  if (!item) return allCaption(project.all);
  const count = flagsText(item.count);
  return flagIsOwn(project, id) ? pair(count, kindStateText(project, id)) : count;
};

// ---------- геометрия и данные ----------

const cropOf = (look) => {
  const { left: x, top: y, width: w, height: ht } = flagImagePlacement(
    look,
    look.image,
    FLAG_CLOTH_ASPECT,
  );
  const farEdge = (start, size, lead) => (lead - start) / size;
  return [-x / w, -y / ht, farEdge(x, w, FLAG_CLOTH_ASPECT), farEdge(y, ht, 1)];
};

// по длине полотнища картинка вылезает за кадр?
const alongOf = (look) => {
  const gap = ratioOf(look.image) - FLAG_CLOTH_ASPECT;
  return look.fit === "cover" ? gap > 0 : gap < 0;
};

const pictureSource = (look, picture, url) => {
  if (picture) return url;
  const thumb = THUMBS[look.mode];
  return thumb ? thumb(look) : "";
};

// [поле, подпись, концы шкалы, запись в журнал, по длине?]
const offsetTable = () => [
  ["offsetX", tr("Сдвиг по длине"), [tr("к древку"), tr("к краю")], tr("сдвиг по длине"), true],
  ["offsetY", tr("Сдвиг по высоте"), [tr("вверх"), tr("вниз")], tr("сдвиг по высоте"), false],
];

const offsetRows = ({ look, set, alongX, zoomed }) =>
  offsetTable().map(
    ([field, label, ends, note, lengthwise]) =>
      (alongX === lengthwise || zoomed) && {
        label,
        ...ranged(look, set, field, [FLAG_OFFSET.min, FLAG_OFFSET.max], note),
        format: (value) => offsetText(value, ends),
      },
  );

const sceneArgsOf = ({ files, sheet, width, height }) => [
  { game: files[0].at, texture: sheet },
  Math.max(width, height),
];

const sceneLoaderOf = (frame) => (frame ? () => loadSceneImage(...sceneArgsOf(frame)) : null);

// приём файла: сохранить, поставить на цель, сказать, если картинку пришлось перевести
const receiveFile = (adopt, onNotice) => async (file) => {
  const say = (text, level) => onNotice?.(text, level);
  try {
    const result = await saveHangarEmblem(file);
    const { converted, ...saved } = result;
    adopt(saved);
    if (converted) say(convertedImageText(converted), "info");
  } catch (error) {
    say(String(error?.message || error), "error");
  }
};

// ---------- хуки ----------

// сколько строк списка видов показано; выбранный далёкий вид раскрывает список сам
const useKindRows = (target) => {
  const rows = [ALL_FLAGS].concat(FLAG_KINDS.map((item) => item.id));
  const [more, setMore] = useState(false);
  const expanded = more || rows.indexOf(target) >= FLAG_ROWS_SHOWN;
  return {
    rows,
    expanded,
    shown: expanded ? rows : rows.slice(0, FLAG_ROWS_SHOWN),
    expand: () => setMore(true),
  };
};

// вид цели, адрес своей картинки и кадр «как в игре» для подложки
const useTargetView = (project, target) => {
  const look = lookFor(project, target);
  const url = useHangarEmblemUrl(look.image.asset);
  const frame = frameKindOf(target);
  const current = useSurfaceStock(sceneLoaderOf(frame), frame?.id || "");
  const kind = flagKind(target);
  return { look, url, current, kind, own: kind ? flagIsOwn(project, target) : true };
};

// всё, что нужно разделам колонки
const useToolContext = (props) => {
  const { project, target } = props;
  const name = targetLabel(target);
  useTr();
  const rowsView = useKindRows(target);
  const view = useTargetView(project, target);
  const set = noted(props.onLook, name);
  const adopt = adopter(set);
  return {
    ...props,
    ...rowsView,
    ...view,
    set,
    adopt,
    name,
    take: receiveFile(adopt, props.onNotice),
    picture: view.look.mode === "image" && Boolean(view.look.image.asset),
    ownCount: Object.keys(project.kinds).length,
    alongX: alongOf(view.look),
    zoomed: view.look.zoom > FLAG_ZOOM.standard,
  };
};

// ---------- разделы основного инструмента ----------

const pictureFrame = ({ look, picture, url, current }) => {
  const framed = picture && look.image.width && look.image.height;
  const boxed = picture && look.fit === "contain";
  return {
    src: pictureSource(look, picture, url),
    current,
    aspect: FLAG_CLOTH_ASPECT,
    fit: picture ? look.fit : "stretch",
    background: boxed ? look.background : "",
    crop: framed ? cropOf(look) : null,
  };
};

const pictureWords = ({ look, own, kind, name }) => ({
  label: `${name}: ${tr("своя картинка")}`,
  caption: pictureCaption(look, own),
  empty: tr("Своя картинка"),
  hint: tr(IMAGE_HINT),
  dropLabel: trFill("Отпустите — встанет на {0}", name),
  clearLabel: kind ? tr("Как у всех флагов") : tr("как в игре"),
});

// сброс картинки: у вида — «как у всех», у «всех» — «как в игре»
const clearOf = (c) => {
  if (c.kind) return c.own ? () => c.onFollow(c.target) : null;
  return flagLookIsStock(c.look) ? null : c.onStock;
};

const pictureActs = (c) => ({ accept: HANGAR_EMBLEM_ACCEPT, onFile: c.take, onClear: clearOf(c) });

const kindRow = (c, id) => {
  const picked = id === c.target;
  return h(ListRow, {
    key: id,
    className: picked ? "is-selected" : "",
    "aria-current": picked ? "true" : undefined,
    title: targetLabel(id),
    caption: kindCaption(c.project, id),
    trailing: null,
    onOpen: () => c.onTarget(id),
  });
};

const Parts = {
  Picture(c) {
    const hints = [tr(IMAGE_HINT), tr("Меняется только картинка. Ткань и ветер — как в игре.")];
    const props = { ...pictureFrame(c), ...pictureWords(c), ...pictureActs(c) };
    return section(
      "picture",
      { title: tr("Картинка"), help: targetNote(c.project, c.target).concat(hints), plain: true },
      h(SurfacePicture, props),
    );
  },

  Fit(c) {
    if (!c.picture) return false;
    const { look, set } = c;
    const fitted = look.fit !== "stretch";
    return h(SurfaceFit, {
      key: "fit",
      "data-flags-section": "fit",
      fit: look.fit,
      onFit: patcher(set, "fit", tr("подгонка")),
      help: tr(
        "«Заполнить» — без полей, лишнее обрежется; «Вписать» — картинка целиком, поля цветом фона; «Растянуть» — по полотнищу. Сдвиг выбирает, какая часть картинки попадёт на флаг.",
      ),
      zoom: fitted
        ? {
            ...ranged(look, set, "zoom", [FLAG_ZOOM.min, FLAG_ZOOM.max], tr("масштаб")),
            step: 5,
            format: percentText,
          }
        : null,
      offsets: fitted ? offsetRows(c) : [],
      background:
        look.fit === "contain"
          ? {
              value: look.background,
              swatches: FLAG_SWATCHES,
              onChange: patcher(set, "background", tr("фон полей")),
            }
          : null,
    });
  },

  More(c) {
    const { look, target } = c;
    const national = look.mode === "country";
    const studio = {
      caption: tr("Кисть, слои, текст"),
      label: tr("Нарисовать в студии"),
      slug: `flag-${target}`,
      getSurface: () => flagStudioSurface(target),
      image: c.picture ? look.image : null,
      onImage: c.adopt,
      onNotice: c.onNotice,
    };
    const country = {
      icon: h(Flag),
      title: tr("Флаг страны"),
      caption: national ? countryName(look.country) : null,
      onOpen: () => c.onTool("countries"),
    };
    return section("more", { title: tr("Страна и рисунок") }, h(NavRow, country), h(StudioPictureButton, studio));
  },

  Folds(c) {
    if (c.look.mode === "standard") return false;
    const slider = {
      label: tr("Складки ткани"),
      ...ranged(c.look, c.set, "folds", [FLAG_FOLDS.min, FLAG_FOLDS.max], tr("складки ткани")),
      format: percentText,
    };
    const help = tr(
      "Складки — мягкие тени ткани на своём рисунке, как на листах игры. В игре полотнище ещё и колышется ветром: свет и тень от волны добавит сама игра.",
    );
    return section("folds", { label: tr("Складки ткани"), help, plain: true }, h(Slider, slider));
  },

  Kinds(c) {
    const rest = () =>
      h(NavRow, { title: trFill("Ещё {0}", c.rows.length - FLAG_ROWS_SHOWN), onOpen: c.expand });
    return section(
      "kinds",
      { title: tr("Флаги игры") },
      c.shown.map((id) => kindRow(c, id)),
      when(!c.expanded, rest),
    );
  },

  Actions(c) {
    const { kind, own, look } = c;
    const back = (field, standard, note) => () => c.set({ [field]: standard }, note);
    const rules = [
      [!flagLookIsStock(look) && flagLookDraws(look), "stock", tr("Как в игре"), c.onStock],
      [kind && own, "follow-all", tr("Как у всех флагов"), () => c.onFollow(c.target)],
      [
        own && look.brightness !== FLAG_BRIGHTNESS.standard,
        "brightness",
        tr("Вернуть яркость как в игре"),
        back("brightness", FLAG_BRIGHTNESS.standard, tr("яркость как в игре")),
      ],
      [
        own && look.saturation !== FLAG_SATURATION.standard,
        "saturation",
        tr("Вернуть цвет как в игре"),
        back("saturation", FLAG_SATURATION.standard, tr("цвет как в игре")),
      ],
      [
        !kind && c.ownCount > 0,
        "clear-own",
        tr("Сделать все флаги одинаковыми"),
        c.onClearOwn,
        { title: trFill("Виды со своим флагом ({0}) станут как все", c.ownCount) },
      ],
    ];
    return h(ActionRows, { key: "actions", actions: actionRows(rules) });
  },
};

// ---------- полка стран ----------

const countryTile = (country, current, onCountry) => {
  const url = countryThumb(country.id);
  const media = url ? h("img", { src: url, alt: "" }) : h("i", { "aria-hidden": "true" });
  return h(ChoiceTile, {
    key: country.id,
    className: "recolor-preset",
    selected: country.id === current,
    media,
    title: country.label,
    onClick: () => onCountry(country),
  });
};

const ShelfBody = ({ current, onCountry }) => {
  useTr();
  const shelf = {
    title: tr("Флаги стран"),
    label: tr("Шаблоны флагов стран"),
    className: "recolor-presets",
    collapsible: false,
  };
  return h(
    PresetShelf,
    shelf,
    FLAG_COUNTRIES.map((country) => countryTile(country, current, onCountry)),
  );
};

const CountryShelf = memo(ShelfBody);

// ---------- инструменты ----------

const CountriesTool = (props) => {
  const { project, target } = props;
  useTr();
  const look = lookFor(project, target);
  const actions = actionRows([
    [look.mode !== "standard", "stock", trFill("Как в игре: {0}", targetLabel(target)), props.onStock],
    [!flagsProjectIsStock(project), "standard", tr("Все флаги как в игре"), props.onStandard],
  ]);
  const current = look.mode === "country" ? look.country : "";
  return [
    h(CountryShelf, { key: "shelf", current, onCountry: props.onCountry }),
    h(ActionRows, { key: "actions", actions }),
  ];
};

const FlagTool = (props) => {
  const ctx = useToolContext(props);
  return PART_ORDER.map((name) => Parts[name](ctx));
};

const FlagsInspector = (props) =>
  props.tool === "countries"
    ? h(CountriesTool, pick(props, COUNTRY_PROPS))
    : h(FlagTool, { ...pick(props, TOOL_PROPS), onFollow: (id) => props.onOwn(id, false) });

export default FlagsInspector;
