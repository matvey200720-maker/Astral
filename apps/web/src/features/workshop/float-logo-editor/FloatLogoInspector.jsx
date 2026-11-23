import { trFill } from "../../../locales/tr-fill.js";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import { FontControls } from "../emblem/EmblemSection.jsx";
import { EMBLEM_TEXT_LIMIT, normalizeEmblemText } from "@modovik/climb-contract/recolor/emblems";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import {
  HANGAR_EMBLEM_ACCEPT,
  convertedImageText,
  saveHangarEmblem,
  useHangarEmblemUrl,
} from "../hangar-editor/hangar-emblem.js";
import Slider from "../../../components/ui/Slider.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import OutlineControl from "../emblem/OutlineControl.jsx";
import NavRow from "../../../components/ui/NavRow.jsx";
import { floatLogoStudioSurface } from "./float-logo-studio.js";
import TextField from "../../../components/ui/TextField.jsx";
import {
  FLOAT_LOGO_LIMITS,
  FLOAT_LOGO_MOD,
  FLOAT_LOGO_MOTIONS,
  FLOAT_LOGO_MOTION_LABELS,
  FLOAT_LOGO_PRESETS,
  matchingFloatLogoPreset,
} from "@modovik/climb-contract/recolor/float-logo";
import { Check, ImageSquare, TextT } from "../../../components/ui/icons.jsx";
import StudioPictureButton from "../texture-studio/StudioPictureButton.jsx";
import SectionHeading from "../section-help.jsx";
import ColorField from "../../../components/ui/ColorField.jsx";
import { useStudioLive } from "../texture-studio/StudioLive.jsx";
import FloatLogoPresets from "./FloatLogoPresets.jsx";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import {
  FLOAT_LOGO_SWATCHES,
  distanceText,
  distanceWarning,
  glowText,
  metresText,
  percentText,
  speedText,
} from "./float-logo-text.js";
import ColourEffectField from "../colour-effects/ColourEffectField.jsx";
import SurfacePicture from "../../../components/ui/SurfacePicture.jsx";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import { createElement as h, useState } from "react";

const IMAGE_HELP =
  "PNG с прозрачным фоном — по контуру картинки встанет объёмная фигура. Картинка остаётся на этом компьютере: в код для друга она не едет.";

// Ползунки лого: поле проекта -> подпись, шаг, формат и запись в журнале.
// extra добавляет подсказку, которая зависит от проекта.
const SLIDERS = {
  speed: { title: () => tr("Скорость"), step: 0.05, show: speedText, journal: "Скорость движения" },
  size: { title: () => tr("Размер"), step: 0.5, show: metresText, journal: "Размер лого" },
  height: {
    title: () => tr("Высота над землёй"),
    step: 0.5,
    show: metresText,
    journal: "Высота лого",
  },
  depth: {
    title: () => tr("Толщина"),
    step: 1,
    show: (value) => `${Math.round(value)} ${tr("см")}`,
    journal: "Толщина лого",
  },
  glow: {
    title: () => tr("Свечение"),
    step: 0.1,
    journal: "Свечение лого",
    extra: () => ({ hint: trFill("Как в игре: {0}", glowText(FLOAT_LOGO_MOD.glow)) }),
  },
  drawDistance: {
    title: () => tr("Видно с расстояния"),
    step: 50,
    show: distanceText,
    journal: "Дальность лого",
    extra: (project) => ({ hint: distanceWarning(project.size, project.drawDistance) || undefined }),
  },
};

const action = (id, label, onClick) => ({ id, label, onClick });

// «Одно поле проекта -> одна запись в журнале»; convert меняет значение слайдера.
const patcher =
  (onPatch, key, journal, convert = (value) => value) =>
  (next) =>
    onPatch({ [key]: convert(next) }, journal);

const stepPatcher = (onPatch, key) => (next, step) => onPatch({ [key]: next }, step);

const ranged = (limits, rest) => h(Slider, { max: limits[1], min: limits[0], ...rest });

function dial(name, project, onPatch) {
  const spec = SLIDERS[name];
  return ranged(FLOAT_LOGO_LIMITS[name], {
    label: spec.title(),
    onChange: patcher(onPatch, name, spec.journal),
    step: spec.step,
    value: project[name],
    ...(spec.show && { format: spec.show }),
    ...(spec.extra && spec.extra(project)),
  });
}

// Панель с заголовком; name уже переведено и служит и заголовком, и подписью.
const panel = (name, ...kids) => h(Panel, { label: name, title: name }, ...kids);

const Panel = (props) => {
  const { title, label, help = null, children } = props;
  return h(
    "section",
    { className: "ui-panel fx-section recolor-section", "aria-label": label || title },
    h(SectionHeading, { help, title }),
    children,
  );
};

const toggleStep = (own) => {
  if (own) return tr("Свой цвет лого");
  return tr("Цвет как на картинке");
};

const toggleOwn = (onPatch) => (ownColour) => {
  onPatch({ ownColour }, toggleStep(ownColour));
};

const modeStep = (mode) => {
  if (mode === "text") return tr("Лого: надпись");
  return tr("Лого: картинка");
};

const sourceOf = (mode, chosen) => {
  if (mode === "text") return "text";
  return mode === "none" ? chosen || "image" : "image";
};

// Какой источник показан: картинка или надпись. Пока в проекте нет ни того
// ни другого, выбор запоминается здесь.
const useSourceChoice = (project, onPatch) => {
  const slot = useState(null);
  const [chosen, setChosen] = slot;
  const choose = (mode) => {
    const stored = !project.image && mode === "image" ? "none" : mode;
    setChosen(mode);
    onPatch({ mode: stored }, modeStep(mode));
  };
  return { choose, source: sourceOf(project.mode, chosen) };
};

// Страница вида: какая открыта, как открыть и как вернуться.
const useBrowse = () => {
  const slot = useState("");
  const [page, setPage] = slot;
  return { page, open: setPage, close: () => setPage("") };
};

// Режим и картинка уходят одним патчем, в таком порядке ключей.
const setLogo = (onPatch, mode, image, journal) => onPatch({ mode, image }, journal);

const editorFor = (text, onPatch) => ({
  patchText(values, label) {
    const merged = normalizeEmblemText(Object.assign({}, text, values));
    onPatch({ mode: "text", text: merged }, label);
  },
});

const ratioOf = (image) => {
  if (!image?.width || !image?.height) return 1;
  return image.width / image.height;
};

const captionOf = (image) => {
  if (!image?.asset) return "";
  return image.name || tr("Своя картинка");
};

const absorb = async (file, onImage, onNotice) => {
  const stored = await saveHangarEmblem(file);
  const { converted, ...saved } = stored;
  onImage(saved);
  if (!converted) return;
  const note = convertedImageText(converted);
  onNotice?.(note, "info");
};

const reportFailure = (onNotice) => (error) => {
  const message = String(error?.message || error);
  onNotice?.(message, "error");
};

function findPreset(id) {
  for (const preset of FLOAT_LOGO_PRESETS) {
    if (preset.id === id) return preset;
  }
  return undefined;
}

// Группа «Надпись»: слова, шрифт, цвет и обводка; каждое поле правит свой ключ текста.
const textGroup = (text, edit, onNotice) => {
  const field = (key, step) => (next) => edit.patchText({ [key]: next }, step);
  const words = h(TextField, {
    label: tr("Надпись"),
    maxLength: EMBLEM_TEXT_LIMIT,
    onChange: field("value", "Лого: слова"),
    value: text.value,
  });
  const tint = h(ColorField, {
    editable: true,
    onChange: field("colour", "Лого: цвет надписи"),
    swatches: FLOAT_LOGO_SWATCHES,
    label: tr("Цвет надписи"),
    value: text.colour,
  });
  const outline = h(OutlineControl, {
    onChange: field("outline", "Лого: обводка"),
    value: text.outline,
  });
  return h(
    ListGroup,
    { "data-float-logo-section": "text", plain: true, title: tr("Надпись") },
    words,
    h(FontControls, { edit, onNotice, text }),
    tint,
    outline,
  );
};

// Кнопка смены источника: с картинки на надпись и обратно.
const swapRow = (source, project, choose) => {
  const toText = source === "image";
  const [Icon, title, target] = toText
    ? [TextT, tr("Надпись вместо картинки"), "text"]
    : [ImageSquare, tr("Картинка вместо надписи"), "image"];
  const extra = toText ? {} : { caption: project.image?.name || null };
  return h(NavRow, { icon: h(Icon), onOpen: () => choose(target), title, ...extra });
};

function moreTitle(source) {
  if (source !== "image") return tr("Картинка и рисунок");
  return tr("Надпись и рисунок");
}

const moreGroup = (kit, project, setImage, onNotice) => {
  const { choose, live, source } = kit;
  const studio = h(StudioPictureButton, {
    caption: tr("Кисть, слои, текст"),
    getSurface: () => floatLogoStudioSurface({ live }),
    image: project.image,
    label: tr("Нарисовать в студии"),
    onImage: setImage,
    onNotice,
    slug: "float-logo",
  });
  return h(
    ListGroup,
    { "data-float-logo-section": "more", title: moreTitle(source) },
    swapRow(source, project, choose),
    studio,
  );
};

const motionRow = (project, onPatch, motion) => {
  const name = FLOAT_LOGO_MOTION_LABELS[motion];
  const taken = motion === project.motion;
  return h(ListRow, {
    "aria-pressed": taken,
    className: taken ? "is-selected" : "",
    key: motion,
    onOpen: () => onPatch({ motion }, `Движение: ${name.toLowerCase()}`),
    title: tr(name),
    trailing: taken ? h(Check, { "aria-hidden": "true" }) : null,
  });
};

const colourEffect = (project, onPatch) => {
  const leftRight = tr("Слева направо");
  return h(ColourEffectField, {
    directionLabels: { along: leftRight, across: leftRight, height: tr("Сверху вниз") },
    onChange: stepPatcher(onPatch, "look"),
    swatches: FLOAT_LOGO_SWATCHES,
    value: project.look,
    label: tr("Цвет лого"),
  });
};

// Разделы колонки. Ключи с заглавной буквы: каждый — отдельный компонент.
const Sections = {
  Picture(props) {
    const { image, onImage, onNotice } = props;
    const { onClear = null } = props;
    const asset = image?.asset;
    useTr();
    const url = useHangarEmblemUrl(asset || "");
    const surface = {
      accept: HANGAR_EMBLEM_ACCEPT,
      aspect: ratioOf(image),
      caption: captionOf(image),
      dropLabel: tr("Отпустите — встанет над городом"),
      fit: "contain",
      empty: tr("Своя картинка"),
      onClear: asset ? onClear : null,
      hint: tr(IMAGE_HELP),
      label: tr("Картинка лого"),
      onFile: (file) => absorb(file, onImage, onNotice).catch(reportFailure(onNotice)),
      src: asset ? url : "",
    };
    return h(
      ListGroup,
      {
        "data-float-logo-section": "picture",
        help: tr(IMAGE_HELP),
        plain: true,
        title: tr("Картинка"),
      },
      h(SurfacePicture, surface),
    );
  },

  Content({ project, onPatch, onNotice }) {
    useTr();
    const kit = { live: useStudioLive(), ...useSourceChoice(project, onPatch) };
    const setImage = (image) => setLogo(onPatch, "image", image, "Лого: картинка");
    const dropImage = () => setLogo(onPatch, "none", null, "Лого: картинка убрана");
    const upper =
      kit.source === "image"
        ? h(Sections.Picture, {
            image: project.image,
            onClear: dropImage,
            onImage: setImage,
            onNotice,
          })
        : textGroup(project.text, editorFor(project.text, onPatch), onNotice);
    return (
      <>
        {upper}
        {moreGroup(kit, project, setImage, onNotice)}
      </>
    );
  },

  Motion({ project, onPatch }) {
    useTr();
    const rows = FLOAT_LOGO_MOTIONS.map((motion) => motionRow(project, onPatch, motion));
    const speed =
      project.motion === "none"
        ? null
        : h(ListGroup, { label: tr("Скорость"), plain: true }, dial("speed", project, onPatch));
    return (
      <>
        {h(ListGroup, { "data-float-logo-section": "motion", label: tr("Как движется") }, rows)}
        {speed}
      </>
    );
  },

  Range({ project, onPatch }) {
    useTr();
    return panel(tr("Дальность"), dial("drawDistance", project, onPatch));
  },

  Colour({ project, onPatch }) {
    useTr();
    const toggle = h(SwitchLine, {
      checked: project.ownColour,
      onChange: toggleOwn(onPatch),
      label: tr("Свой цвет поверх картинки"),
    });
    const opacity = h(Slider, {
      format: percentText,
      label: tr("Прозрачность"),
      max: 100 - FLOAT_LOGO_LIMITS.opacity[0],
      min: 0,
      onChange: patcher(onPatch, "opacity", "Прозрачность лого", (value) => 100 - value),
      step: 1,
      value: 100 - project.opacity,
    });
    return panel(
      tr("Цвет и свечение"),
      toggle,
      project.ownColour ? colourEffect(project, onPatch) : null,
      dial("glow", project, onPatch),
      opacity,
    );
  },

  Look({ project, onPatch }) {
    useTr();
    const nav = useBrowse();

    if (nav.page) {
      const { heading, Body } = LOOK_PAGES[nav.page === "colour" ? "colour" : "range"];
      const bar = {
        backLabel: tr("Ко всему виду"),
        onBack: nav.close,
        label: heading(),
        note: tr("Вид"),
      };
      return (
        <>
          {h(PanelPage, bar)}
          {h(Body, { onPatch, project })}
        </>
      );
    }

    const place = ["size", "height", "depth"].map((name) => dial(name, project, onPatch));
    const entries = [
      ["colour", tr("Цвет и свечение"), trFill("свечение {0}", glowText(project.glow))],
      ["range", tr("Дальность"), trFill("видно с {0}", distanceText(project.drawDistance))],
    ];
    const links = entries.map(([target, title, caption]) =>
      h(NavRow, { caption, key: target, onOpen: () => nav.open(target), title }),
    );
    return (
      <>
        {panel(tr("Размер и место"), ...place)}
        {h(ListGroup, { label: tr("Цвет и дальность") }, links)}
      </>
    );
  },
};

// Заголовок берётся лениво: язык читается в момент отрисовки.
const LOOK_PAGES = {
  colour: { Body: Sections.Colour, heading: () => tr("Цвет и свечение") },
  range: { Body: Sections.Range, heading: () => tr("Дальность") },
};

// Инструмент колонки -> раздел и свойства, которые ему нужны.
const TOOLS = new Map([
  ["content", [Sections.Content, ["project", "onPatch", "onNotice"]]],
  ["motion", [Sections.Motion, ["project", "onPatch"]]],
  ["look", [Sections.Look, ["project", "onPatch"]]],
]);

const modAction = (presetProject, onPreset) => {
  if (matchingFloatLogoPreset(presetProject) === "mod") return false;
  return action("mod", tr("Как в игре"), () => onPreset(findPreset("mod")));
};

const removeAction = (onStandard) => ({
  ...action("standard", tr("Убрать лого"), onStandard),
  danger: true,
  title: tr("Убрать лого: над городом станет пусто"),
});

const bodyNodes = (tool, ctx) => {
  const entry = TOOLS.get(tool);
  if (!entry) {
    const { presetProject, onPreset } = ctx;
    return [
      h(FloatLogoPresets, { onApply: onPreset, project: presetProject }),
      h(ActionRows, { actions: [modAction(presetProject, onPreset)], label: tr("Шаблоны") }),
    ];
  }
  const [Body, keys] = entry;
  return [h(Body, Object.fromEntries(keys.map((key) => [key, ctx[key]])))];
};

const FloatLogoInspector = (props) => {
  useTr();
  const { project, onStandard } = props;
  const { tool = "content", presetProject = project } = props;

  const nodes = bodyNodes(tool, { ...props, presetProject });
  const removal =
    tool !== "templates" && project.mode !== "none"
      ? h(ActionRows, { actions: [removeAction(onStandard)] })
      : null;

  return h("div", { className: "fx-inspector recolor-inspector" }, ...nodes, removal);
};

export default FloatLogoInspector;
