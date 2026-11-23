import { SHOP_SWATCHES, fill, plural } from "./shops-text.js";
import SectionHeading from "../section-help.jsx";
import { createElement as h } from "react";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import { placeLabel } from "./shops-outside-text.js";
import TextField from "../../../components/ui/TextField.jsx";
import { EMBLEM_TEXT_LIMIT } from "@modovik/climb-contract/recolor/emblems";
import ColorField from "../../../components/ui/ColorField.jsx";
import { nameOnFace, namesOf } from "./sign-names.js";
import OutlineControl from "../emblem/OutlineControl.jsx";
import { OUTSIDE_BRANDS, OUTSIDE_NAME_LIMIT } from "@modovik/climb-contract/recolor/shops-outside";
import { trFill } from "../../../locales/tr-fill.js";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import NavRow from "../../../components/ui/NavRow.jsx";
import { FontControls } from "../emblem/EmblemSection.jsx";

const metres = (value) => `${Math.round(value * 10) / 10}`.replace(".", ",");

const TEXT_SWATCHES = Object.freeze(
  "f6f6f6 101114 f2c200 d9621f a4161a 1f5fae 2e8b57 7b2cff".split(" ").map((hex) => `#${hex}`),
);

// Правила «условие -> значение»: берём первое сработавшее, значение считаем лениво.
const firstHit = (rules) => rules.find(([hit]) => hit)[1]();
const onlyIf = (ok, make) => ok && make();

const Section = ({ children, id, title, note = "", help = null }) => {
  const frame = { className: "ui-panel fx-section recolor-section", "aria-label": title, "data-shops-section": id };
  if (!help && !note) return h("section", frame, h("h3", null, title), children);
  return h("section", frame, h(SectionHeading, { title, help, note }), children);
};

// Слова и вид плашки: пять органов подряд, каждый пишет в стиль свою долю.
const nameSection = ({ place, style, onStyle, onNotice }) => {
  const patch = (key) => (next) => onStyle({ [key]: next });
  const where = placeLabel(place);
  const controls = [
    [
      TextField,
      {
        label: tr("Название"),
        value: style.value,
        maxLength: EMBLEM_TEXT_LIMIT,
        placeholder: tr("Например, название заправки"),
        onChange: patch("value"),
      },
    ],
    [
      FontControls,
      {
        text: style,
        edit: {
          patchText(values) {
            onStyle(values);
          },
        },
        onNotice,
      },
    ],
    [
      ColorField,
      { label: tr("Цвет букв"), value: style.colour, swatches: TEXT_SWATCHES, editable: true, onChange: patch("colour") },
    ],
    [OutlineControl, { value: style.outline, onChange: patch("outline") }],
    [
      ColorField,
      {
        label: tr("Фон плашки — цвет вывески"),
        value: style.backdrop,
        swatches: SHOP_SWATCHES,
        editable: true,
        onChange: patch("backdrop"),
      },
    ],
  ];
  const sectionProps = {
    id: "name",
    title: fill(tr("Название — {0}"), where),
    help: tr("Слова встанут плашкой перед вывеской станции и закроют старую надпись целиком: фон — цвет вывески, размер — с её грань. Плашка видна с 200 м, в игру едет вместе с названием."),
  };
  return h(Section, sectionProps, controls.map(([Control, props], slot) => h(Control, { key: slot, ...props })));
};

// Строка одной вывески: пока названия нет ни в стиле, ни на ней, строка без действий.
const faceRow = (view, face, index) => {
  const { place, mine, filled, onToggle } = view;
  const on = !!nameOnFace(mine, place.id, face);
  const [across, tall] = ["width", "height"].map((side) => metres(face[side]));
  const caption = on
    ? trFill("{0} × {1} м · название стоит", across, tall)
    : trFill("{0} × {1} м · без названия", across, tall);
  const text = { title: fill(tr("Вывеска {0}"), index + 1), caption };
  if (!filled && !on) return h(ListRow, { key: face.id, ...text });
  return h(NavRow, {
    key: face.id,
    className: on ? "is-selected" : "",
    "aria-pressed": on,
    ...text,
    trailing: null,
    onOpen: () => onToggle(face),
  });
};

const facesSection = (view) => {
  const { faces, loading, filled, full } = view;
  const found = faces.length > 0;

  const note = firstHit([
    [loading, () => tr("Ищем вывески станции в сцене…")],
    [!found, () => tr("Вывесок на станции не нашлось")],
    [full, () => fill(tr("Предел плашек — {0}. Уберите лишние."), OUTSIDE_NAME_LIMIT)],
    [true, () => ""],
  ]);

  const help = firstHit([
    [loading, () => null],
    [
      found,
      () => [
        tr("Вывески найдены по модели станции в кадре: если плашка встала не туда — снимите её с вывески. Как она выглядит в самой игре, в Astral проверить нельзя."),
        onlyIf(!filled, () => tr("Впишите название — тогда его можно поставить на вывеску.")),
        onlyIf(full, () => fill(tr("Больше {0} плашек с названиями в работе не поставить — уберите лишние."), OUTSIDE_NAME_LIMIT)),
      ],
    ],
    [true, () => tr("На этой станции вывесок не нашлось — название тут не поставить. Свою надпись можно поставить на стену инструментом «Текст».")],
  ]);

  const list =
    !loading &&
    found &&
    h(ListGroup, { label: tr("Вывески станции") }, faces.map((face, index) => faceRow(view, face, index)));

  return h(Section, { id: "faces", title: fill(tr("Вывески станции · {0}"), faces.length), note, help }, list);
};

const action = (id, label, onClick, extra) => ({ id, label, onClick, ...extra });

const brandAction = ({ brand, brandCount, busy, onBrand }) => {
  const stations = plural(brandCount, [tr("станция"), tr("станции"), tr("станций")]);
  const hint = fill(tr("Такое же название, шрифт и цвета — на две самые большие вывески каждой из остальных станций {0}: {1} {2}."), brand, brandCount, stations);
  const caption = fill(tr("Всем станциям бренда {0}"), brand);
  const press = () => {
    if (!busy) onBrand();
  };
  return action("name-brand", busy ? tr("Ставим…") : caption, press, { title: hint });
};

const actionRows = (view) => {
  const { mine, filled, full } = view;
  const { brand, brandCount, busy } = view;
  const canName = filled && !full;
  const rules = [
    [canName, () => action("name-all", tr("На все вывески станции"), view.onAll)],
    [Boolean(brand) && brandCount > 0 && (canName || busy), () => brandAction(view)],
    [mine.length > 0, () => action("name-clear", tr("Убрать название"), view.onClear, { danger: true })],
  ];
  const actions = rules.map(([ok, make]) => (ok ? make() : false));
  return h(ActionRows, { label: tr("Название"), actions });
};

const ShopsNameInspector = (props) => {
  useTr();
  const { place, names, style } = props;
  const view = {
    ...props,
    mine: namesOf(names, place?.id),
    brand: OUTSIDE_BRANDS[place?.brand] || "",
    filled: `${style.value || ""}`.trim() !== "",
    full: names.length >= OUTSIDE_NAME_LIMIT,
  };
  return (
    <>
      {nameSection(view)}
      {facesSection(view)}
      {actionRows(view)}
    </>
  );
};

export default ShopsNameInspector;
