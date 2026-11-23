import { createElement as h } from "react";
import { tr, useTr } from "../../locales/ui.js";
import ColorField from "./ColorField.jsx";
import ListGroup from "./ListGroup.jsx";
import SegmentedControl from "./SegmentedControl.jsx";
import Slider from "./Slider.jsx";

// Способы подгонки в каноническом порядке; fits лишь отбирает из них.
export const SURFACE_FITS = Object.freeze(["cover", "contain", "stretch"]);

const FIT_WORDS = {
  cover: () => tr("Заполнить"),
  contain: () => tr("Вписать"),
  stretch: () => tr("Растянуть"),
};

// Умолчания действуют только для не заданных (undefined).
const DEFAULTS = { fits: SURFACE_FITS, label: "", zoom: null, offsets: [], background: null, help: null, children: null };
const NAMED = [...Object.keys(DEFAULTS), "fit", "onFit"];

function settle(props) {
  const given = Object.fromEntries(Object.entries(props).filter(([, one]) => one !== undefined));
  const extra = Object.fromEntries(Object.entries(props).filter(([name]) => !NAMED.includes(name)));
  return [{ ...DEFAULTS, ...given }, extra];
}

// Строка с ползунком по описанию: подпись даёт место, шаг по умолчанию 1.
function FitSlider({ label, spec }) {
  const { ariaLabel, value, min, max, step, format, onChange } = spec;
  return h(Slider, { label, ariaLabel, value, min, max, step: step ?? 1, format, onChange });
}

export default function SurfaceFit(props) {
  const [cfg, extra] = settle(props);
  useTr();
  const options = SURFACE_FITS.filter((name) => cfg.fits.includes(name)).map((name) => ({ value: name, label: FIT_WORDS[name]() }));
  const ways = h(SegmentedControl, { label: cfg.label || tr("Если пропорция другая"), size: "sm", options, value: props.fit, onChange: props.onFit });
  const zoom = cfg.zoom && h(FitSlider, { label: tr("Масштаб"), spec: cfg.zoom });
  const shifts = cfg.offsets.filter(Boolean).map((item) => h(FitSlider, { key: item.label, label: item.label, spec: item }));
  const back = cfg.background && h(ColorField, { label: cfg.background.label || tr("Фон полей"), ariaLabel: cfg.background.ariaLabel, value: cfg.background.value, swatches: cfg.background.swatches, editable: true, onChange: cfg.background.onChange });
  return h(ListGroup, { title: tr("Подгонка"), help: cfg.help, plain: true, ...extra }, ways, zoom, shifts, back, cfg.children);
}
