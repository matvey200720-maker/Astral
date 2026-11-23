import { Fragment, createElement as h } from "react";

import * as Studio from "@modovik/gun-studio";
import FontSources from "../../../../../features/workshop/emblem/FontSources.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";
import * as Copy from "../gun-copy.js";
import Select from "../../../../ui/Select.jsx";
import { TEXT_FONTS } from "../gun-canvas.js";

const OWN_FONT = "custom";

/** Номер режима для показа: найденный по id, иначе нулевой (первый в каталоге). */
const modeIndex = (value) => Math.max(0, Studio.BLEND_MODES.findIndex((mode) => mode.id === value));

/** Пары [id, подпись] плоским списком: группы по порядку каталога, внутри группы порядок каталога. */
function blendChoices() {
  const bucket = new Map(Studio.BLEND_GROUPS.map((group) => [group.id, []]));
  for (const mode of Studio.BLEND_MODES) bucket.get(mode.group)?.push([mode.id, tr(mode.label.ru)]);
  return [...bucket.values()].flat();
}

/** Шрифты окна, а за ними свой шрифт слоя, если он загружен. */
function* fontChoices(layer) {
  for (const { id, label } of TEXT_FONTS) yield [id, tr(label)];
  if (layer.fontAsset) {
    const name = layer.fontName || tr("шрифт");
    yield [OWN_FONT, Copy.fill(tr("Свой: {name}"), { name })];
  }
}

export function BlendSelect({ onChange, value, label = Copy.trKey("Наложение") }) {
  useTr();
  const shown = Studio.BLEND_MODES[modeIndex(value)];
  const relay = (id) => onChange?.(id);

  return h(Select, {
    hint: tr(shown.hint.ru),
    onChange: relay,
    options: blendChoices(),
    label: tr(label),
    value: shown.id,
  });
}

export function TextFontSelect({ onNotice = null, onPatch, layer }) {
  useTr();
  const choices = [...fontChoices(layer)];

  return h(
    Fragment,
    null,
    h(Select, {
      options: choices,
      label: tr("Шрифт"),
      value: layer.font,
      onChange: (font) => onPatch({ font }),
    }),
    h(FontSources, {
      onNotice,
      onFont: (fields) => onPatch({ font: OWN_FONT, ...fields }),
    }),
  );
}
