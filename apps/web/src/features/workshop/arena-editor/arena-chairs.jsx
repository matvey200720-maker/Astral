import ListGroup from "../../../components/ui/ListGroup.jsx";
import { trFill } from "../../../locales/tr-fill.js";
import { CaretDown, CaretUp, Check } from "../../../components/ui/icons.jsx";
import { arenaChairVariants } from "@modovik/climb-contract/recolor/arenas";
import { ownUiText, tr, useTr, useUiLanguage } from "../../../locales/ui.js";
import NavRow from "../../../components/ui/NavRow.jsx";
import { createElement as h, useState } from "react";

const FIRST = 6;
const COLLAPSED = false;
const LANGS = ["ru", "uk", "en", "de", "pl", "fr"];

// Названия материала: тексты идут в порядке LANGS.
const nameSet = (...texts) => Object.fromEntries(LANGS.map((code, k) => [code, texts[k]]));

// Материал -> модели, которым он подходит.
const MATERIAL_GROUPS = [
  [nameSet("Пластик", "Пластик", "Plastic", "Kunststoff", "Plastik", "Plastique"), ["stadium", "plastic"]],
  [nameSet("Дерево", "Дерево", "Wood", "Holz", "Drewno", "Bois"), ["wood", "wood-dark"]],
  [nameSet("Металл", "Метал", "Metal", "Metall", "Metal", "Métal"), ["metal"]],
  [nameSet("Сетка", "Сітка", "Mesh", "Netzstoff", "Siatka", "Maille"), ["office-mesh"]],
];

const MATERIAL_OF = new Map(MATERIAL_GROUPS.flatMap(([names, ids]) => ids.map((id) => [id, names])));

const materialName = (id, language) => {
  const names = MATERIAL_OF.get(id);
  return names ? ownUiText(names[language] || names.ru) : "";
};

// Подсказка строки: материал и имя модели в игре, что есть из двух.
const joinHint = (material, archetype) => (material && archetype ? `${material} · ${archetype}` : material || archetype);

const invert = (open) => !open;

// Подписка на смену языка и сам язык.
const useLanguage = () => {
  useTr();
  return useUiLanguage();
};

const visibleOf = (variants, all, index) =>
  all ? variants : variants.filter((_, place) => place < FIRST || place === index);

const chairRow = ({ id, label: name, archetype }, { value, language, onChange }) => {
  const picked = id === value;
  return h(NavRow, {
    key: id,
    className: picked ? "is-selected" : "",
    "aria-pressed": picked,
    title: tr(name),
    caption: id === "stadium" ? tr("Как в игре") : null,
    tooltip: joinHint(materialName(id, language), archetype) || undefined,
    trailing: picked ? h(Check, { "aria-hidden": "true" }) : null,
    "data-chair": id,
    onOpen: () => onChange(id),
  });
};

const toggleTitle = (all, count) => {
  if (all) return tr("Свернуть");
  return trFill("Все модели ({0})", count);
};

const toggleRow = (all, count, setAll) => {
  const Caret = all ? CaretUp : CaretDown;
  return h(NavRow, {
    title: toggleTitle(all, count),
    "aria-expanded": all,
    trailing: h(Caret, { "aria-hidden": "true" }),
    onOpen: () => setAll(invert),
  });
};

const ChairPicker = ({ label, value = "stadium", onChange, title = "" }) => {
  const [all, setAll] = useState(COLLAPSED);
  const language = useLanguage();

  const variants = arenaChairVariants();
  const index = variants.map(({ id }) => id).indexOf(value);
  const rows = visibleOf(variants, all, index).map((variant) => chairRow(variant, { value, language, onChange }));
  const more = variants.length > FIRST && toggleRow(all, variants.length, setAll);

  return h(ListGroup, { title, label, className: "arena-chairs", "data-arena-chairs": "" }, rows, more);
};

export default ChairPicker;
