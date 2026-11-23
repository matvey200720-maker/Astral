import { Check } from "../../../components/ui/icons.jsx";
import { normalizeColourEffect } from "@modovik/climb-contract/recolor/colour-effects";
import ListGroup, { ListRow } from "../../../components/ui/ListGroup.jsx";
import { ZONES_LIMITS, ZONES_MOD_LOOKS, ZONES_MOD_SHAPE, ZONES_NEON_GLOW } from "@modovik/climb-contract/recolor/zones";
import Slider from "../../../components/ui/Slider.jsx";
import { createElement as h, useState } from "react";
import { fill, findZoneItem, glowText } from "./zones-text.js";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import { placedZonesOfKind, zoneEffect, zoneKindHasWidth, zonesShapeChanged } from "@modovik/climb-contract/recolor/zones";
import TextField from "../../../components/ui/TextField.jsx";
import { inDistrictsText, isWarKind, metresText, opacityOf, percentText } from "./zones-text.js";
import NavRow from "../../../components/ui/NavRow.jsx";
import { transparencyHint, transparencyOf, wallHeightText } from "./zones-text.js";
import PanelPage from "../../../components/ui/PanelPage.jsx";
import { zoneLabel, zoneSizeText, zonesCountText } from "./zones-text.js";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import { ZONES_SWATCHES, ZONE_DISTRICTS_BY_KIND } from "./zones-text.js";
import EffectSegmentField from "../effect-segment-field.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import ColourRow from "../../../components/ui/ColourRow.jsx";
import ZonesPresets from "./ZonesPresets.jsx";

/* ---------- мелкие помощники без состояния ---------- */

const lower = (text) => text.toLocaleLowerCase();

// Запись в группу вида: вид уже зашит, остаются правка и подпись шага.
const patcher = (kind, onGroup) => (patch, step) => onGroup(kind, patch, step);

// Ползунок: диапазон приходит парой, правка числом всегда разрешена.
const sliderOf = ({ range, ...rest }) =>
  h(Slider, { editable: true, min: range[0], max: range[1], ...rest });

const percentFromAlpha = (alpha) => {
  const clear = 1 - alpha;
  return Math.round(clear * 100);
};

const rowCaption = (zone, district = "") => {
  const redundant = !district || zoneLabel(zone).includes(district);
  return redundant ? zoneSizeText(zone) : district;
};

const districtCaption = (item, zoneId) => {
  const count = zonesCountText(item.zones.length);
  const picked = item.zones.find(({ id }) => id === zoneId);
  return picked ? [count, zoneLabel(picked)].join(" · ") : count;
};

// Пояснение к виду зон: у «войны» про обвод, у зелёных про шейдер.
const kindNote = (kind) => {
  if (isWarKind(kind)) {
    return tr(
      "Обвод зоны двумя линиями по рельефу: у мода внешняя синяя, внутренняя красная. Свой цвет у линии — в инструменте «Зоны». Файлы — под именами мода: если мод уже стоит, линии не задвоятся.",
    );
  }
  if (kind !== "green") return null;
  const placed = placedZonesOfKind(kind).length;
  return fill(
    "Зелёные зоны сервера — {0} по всей карте. У мода шейдер с вырезом, прозрачности он не знает: Astral ставит те же сетки своим прозрачным шейдером под именами мода — если мод уже стоит, зоны не задвоятся.",
    zonesCountText(placed),
  );
};

// Совпавшие зоны одним плоским списком, в порядке районов.
const matchZones = (districts, needle, translate) => {
  const hits = [];
  districts.forEach((item) => {
    const label = translate(item.label);
    const wholeDistrict = lower(label).includes(needle);
    item.zones.forEach((zone) => {
      if (wholeDistrict || lower(zoneLabel(zone)).includes(needle)) hits.push({ zone, label });
    });
  });
  return hits;
};

/* ---------- данные о состоянии вида ---------- */

const lookFacts = (project, kind) => {
  const transparency = transparencyOf(project, kind);
  return {
    group: project[kind],
    transparency,
    hint: transparencyHint(transparency),
    modTransparency: Math.round(100 - ZONES_MOD_LOOKS[kind].opacity),
    note: kindNote(kind),
    war: isWarKind(kind),
  };
};

const shapeFacts = (project, kind) => ({
  group: project[kind],
  hasWidth: zoneKindHasWidth(kind),
  modWidth: ZONES_MOD_SHAPE[kind].width,
  changed: zonesShapeChanged(project, kind),
  zones: placedZonesOfKind(kind).length,
});

const zoneFacts = (project, kind, zoneId) => {
  const zone = findZoneItem(zoneId, kind);
  const { perZone, zones } = project[kind];
  return { zone, own: perZone && Boolean(zones?.[zone.id]), war: isWarKind(kind) };
};

// Правка «форма как у мода»: ширина мода, без стенки и без неона.
const shapeStockPatch = (kind) => ({
  width: ZONES_MOD_SHAPE[kind].width,
  height: 0,
  neon: false,
  glow: ZONES_NEON_GLOW,
});

/* ---------- подсказки: список составителей, каждый возвращает строку ---------- */

const LOOK_HELP = [
  ({ hint }) => (hint.warning ? "" : hint.text),
  ({ modTransparency }) => fill("0 % — сплошной цвет, 100 % — зон не видно. У мода — {0} %.", modTransparency),
  ({ note }) => note,
  ({ group, tr, war }) => {
    if (!group.perZone) return "";
    return war ? tr("У линий свой цвет — инструмент «Зоны».") : tr("У зон свой цвет — инструмент «Зоны».");
  },
];

const SHAPE_HELP = [
  ({ tr, hasWidth, modWidth }) =>
    hasWidth
      ? fill(
          "У мода — {0}: тонкая лента по рельефу. Шире — заметнее, но лента перекрывает больше земли.",
          metresText(modWidth),
        )
      : tr("У запретных зон сплошная заливка участка — ширины у неё нет. Есть высота (коробка участка) и неон."),
  ({ tr, hasWidth }) => {
    const ribbon = tr("0 — стенки нет, как у мода. Выше нуля вдоль линии встаёт прозрачная стенка толщиной в ширину линии.");
    const box = tr("0 — стенки нет, как у мода. Выше нуля участок вытягивается вверх коробкой с прозрачными стенками.");
    return hasWidth ? ribbon : box;
  },
  ({ tr, group }) => {
    if (group.neon) {
      return tr("Шейдер зон меняется на светящийся: ночью зону видно издалека. Цвет и прозрачность — те же, что в «Облике».");
    }
    return tr("Неон — светящийся шейдер вместо шейдера мода: зону видно ночью издалека. Цвет и прозрачность — из «Облика».");
  },
  ({ tr, changed, zones }) =>
    changed
      ? fill(
          "Форма не как у мода: {0} вида Astral построит заново из сеток мода — под теми же именами, места те же.",
          zonesCountText(zones),
        )
      : tr("Форма как у мода: файлы автора как есть. Любая правка здесь пересобирает модели вида под теми же именами."),
];

const zoneOwnHelp = (tr, war) => {
  if (war) {
    return tr("«Как у всех» — цвет и прозрачность из «Облика» вида. «Свой цвет» — только у этой линии.");
  }
  return tr("«Как у всех» — цвет и прозрачность из «Облика» вида. «Свой цвет» — только у этой зоны.");
};

const listHelp = ({ tr, kind, districts }) => {
  if (isWarKind(kind)) {
    return tr("Одна зона — две линии обвода. Нажмите на линию, чтобы посмотреть её в кадре.");
  }
  const total = placedZonesOfKind(kind).length;
  return fill(
    "{0} {1}. Нажмите на зону, чтобы посмотреть её в кадре.",
    zonesCountText(total),
    inDistrictsText(districts.length),
  );
};

/* ---------- раздел формы: строки из таблицы ---------- */

const SHAPE_ROWS = [
  {
    name: "width",
    when: ({ hasWidth }) => hasWidth,
    caption: (tr) => tr("Ширина линии"),
    step: 0.01,
    show: metresText,
    journal: "Ширина линии зон",
  },
  {
    name: "height",
    caption: (tr) => tr("Высота стенки"),
    step: 0.5,
    show: wallHeightText,
    journal: "Высота стенки зон",
  },
  { name: "neon", toggle: true, caption: (tr) => tr("Неон") },
  {
    name: "glow",
    when: ({ group }) => group.neon,
    caption: (tr) => tr("Свечение"),
    step: 0.5,
    show: glowText,
    journal: "Свечение неона",
  },
];

// Включение неона заодно задаёт свечение, если его не было.
const neonWriter = ({ tr, group, send }) => (value) => {
  const patch = { neon: value };
  if (value && !group.glow) patch.glow = ZONES_NEON_GLOW;
  const phrase = value ? tr("Неон включён") : tr("Неон выключен");
  send(patch, phrase);
};

const shapeRowOf = (row, ctx) => {
  const { tr, group, send } = ctx;
  const label = row.caption(tr);
  if (row.toggle) return h(SwitchLine, { checked: group.neon, label, onChange: neonWriter(ctx) });
  return sliderOf({
    label,
    value: group[row.name],
    range: ZONES_LIMITS[row.name],
    step: row.step,
    format: row.show,
    onChange: (value) => send({ [row.name]: value }, row.journal),
  });
};

/* ---------- список зон ---------- */

function useZonesNavigator() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("");
  const needle = lower(query.trim());
  return { needle, page, query, setPage, setQuery };
}

// Что рисовать: найденные зоны, страницу района или список районов.
function pickView(districts, { needle, page }) {
  if (needle) return ["found"];
  const opened = districts.find((item) => item.label === page);
  return opened ? ["page", opened] : ["districts"];
}

const zoneRowOf = ({ zoneId, onSelect }, zone, caption) => {
  const selected = zone.id === zoneId;
  return h(NavRow, {
    key: zone.id,
    className: selected ? "is-selected" : "",
    "aria-pressed": selected,
    title: zoneLabel(zone),
    caption,
    trailing: selected ? h(Check, { "aria-hidden": "true" }) : null,
    onOpen: () => onSelect(zone.id),
  });
};

const districtRows = ({ tr, districts, zoneId, nav }) =>
  districts.map((item) =>
    h(NavRow, {
      key: item.label,
      title: tr(item.label),
      caption: districtCaption(item, zoneId),
      onOpen: () => nav.setPage(item.label),
    }),
  );

const foundRows = (ctx) => {
  const { tr, districts, nav } = ctx;
  const found = matchZones(districts, nav.needle, tr);
  if (found.length === 0) return h(ListRow, { title: tr("Ничего не найдено") });
  return found.map((hit) => zoneRowOf(ctx, hit.zone, rowCaption(hit.zone, hit.label)));
};

const LIST_BODIES = { districts: districtRows, found: foundRows };

const districtPage = (ctx, district) => {
  const { tr, nav } = ctx;
  const pageProps = {
    label: tr(district.label),
    note: zonesCountText(district.zones.length),
    backLabel: tr("Зоны на картах"),
    onBack: () => nav.setPage(""),
  };
  const zoneRows = district.zones.map((zone) => zoneRowOf(ctx, zone, zoneSizeText(zone)));
  return h(PanelPage, pageProps, h(ListGroup, { label: tr(district.label) }, zoneRows));
};

/* ---------- разделы инспектора ---------- */

const Panes = {
  // Облик вида: цвет, прозрачность и пояснения.
  Look({ project, kind, onGroup }) {
    const tr = useTr();
    const facts = { tr, ...lookFacts(project, kind) };
    const { group, transparency, hint } = facts;
    const send = patcher(kind, onGroup);
    const setOpacity = (percent) => send({ opacity: opacityOf(percent) }, "Прозрачность зон");
    const colourField = {
      label: tr("Цвет зон"),
      value: group.look,
      swatches: ZONES_SWATCHES,
      onChange: (look, step) => send({ look }, step),
      alpha: 1 - transparency / 100,
      onAlphaChange: (alpha) => setOpacity(percentFromAlpha(alpha)),
    };
    return h(
      ListGroup,
      { plain: true, label: tr("Облик зон"), help: LOOK_HELP.map((make) => make(facts)) },
      h(EffectSegmentField, colourField),
      sliderOf({
        label: tr("Прозрачность"),
        value: transparency,
        range: [0, 100],
        step: 1,
        format: percentText,
        onChange: setOpacity,
      }),
      hint.warning && h("p", { className: "fx-hint is-warning" }, hint.text),
    );
  },

  // Форма вида: ширина, стенка, неон, свечение.
  Shape({ project, kind, onGroup }) {
    const tr = useTr();
    const ctx = { tr, send: patcher(kind, onGroup), ...shapeFacts(project, kind) };
    const rows = SHAPE_ROWS.map((row) => (row.when && !row.when(ctx) ? false : shapeRowOf(row, ctx)));
    return h(
      ListGroup,
      { plain: true, label: tr("Форма зон"), help: SHAPE_HELP.map((make) => make(ctx)) },
      ...rows,
    );
  },

  // Кнопка возврата к форме мода: есть, только пока форма изменена.
  Stock({ project, kind, onGroup }) {
    const tr = useTr();
    const send = patcher(kind, onGroup);
    const stock = zonesShapeChanged(project, kind) && {
      id: "shape-stock",
      label: tr("Форма как у мода"),
      onClick: () => send(shapeStockPatch(kind), tr("Форма как у мода")),
    };
    return h(ActionRows, { actions: [stock] });
  },

  // Облик одной выбранной зоны.
  Zone({ project, kind, zoneId, onZoneOwn, onZoneLook }) {
    const tr = useTr();
    const { zone, own, war } = zoneFacts(project, kind, zoneId);
    const effectOf = () => zoneEffect(project, zone);
    const writeOwn = (colour) => {
      const effect = normalizeColourEffect(Object.assign({}, effectOf(), { mode: "solid", colour }));
      onZoneOwn(kind, zone, true, effect);
    };
    const relayLook = (look, step) => {
      onZoneLook(kind, zone.id, look, step);
    };
    const rowProps = {
      group: true,
      title: tr("Цвет зоны"),
      label: tr("Облик"),
      value: own ? effectOf().colour : null,
      caption: own ? null : tr("Как у всех зон"),
      auto: "Как у всех зон",
      colours: ZONES_SWATCHES,
      onChange: writeOwn,
      onClear: () => onZoneOwn(kind, zone, false),
      clearLabel: tr("как у всех зон"),
    };
    const ownField = own
      ? h(EffectSegmentField, {
          label: tr("Цвет зоны"),
          value: effectOf(),
          swatches: ZONES_SWATCHES,
          onChange: relayLook,
        })
      : undefined;
    const groupProps = {
      plain: true,
      title: fill("Зона «{0}»", zoneLabel(zone)),
      label: tr("Облик зоны"),
      help: zoneOwnHelp(tr, war),
    };
    return h(ListGroup, groupProps, h(ColourRow, rowProps, ownField));
  },

  // Поиск, районы и страница района.
  Rows({ kind, zoneId, onSelect }) {
    const tr = useTr();
    const nav = useZonesNavigator();
    const districts = ZONE_DISTRICTS_BY_KIND[kind];
    const ctx = { tr, kind, zoneId, onSelect, districts, nav };
    const [view, district] = pickView(districts, nav);
    if (view === "page") return districtPage(ctx, district);
    const search = h(TextField, {
      label: tr("Найти зону или район"),
      value: nav.query,
      placeholder: tr("Например: Альта, Вайнвуд"),
      onChange: nav.setQuery,
    });
    const list = h(
      ListGroup,
      { title: tr("Зоны на картах"), help: listHelp(ctx) },
      LIST_BODIES[view](ctx),
    );
    return (
      <>
        {search}
        {list}
      </>
    );
  },
};

/* ---------- корень: инструмент -> набор разделов ---------- */

const PANE_SETS = new Map([
  ["look", [Panes.Look]],
  ["shape", [Panes.Shape, Panes.Stock]],
  ["zone", [Panes.Zone, Panes.Rows]],
  ["zones", [Panes.Zone, Panes.Rows]],
]);

const ZonesInspector = (props) => {
  const { tool = "look", presetProject = props.project, onPreset = null } = props;
  const set = PANE_SETS.get(tool);
  const body = set ? (
    <>{set.map((Pane, at) => h(Pane, { ...props, key: at }))}</>
  ) : (
    onPreset &&
    h(ZonesPresets, {
      project: presetProject,
      kind: props.kind,
      zoneId: props.zoneId,
      onApply: onPreset,
    })
  );
  return h("div", { className: "fx-inspector recolor-inspector" }, body);
};

export default ZonesInspector;
