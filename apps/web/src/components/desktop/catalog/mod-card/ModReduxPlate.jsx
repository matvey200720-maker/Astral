import { createElement as h } from "react";
import ModName from "../ModName.jsx";
import { ArrowRight } from "../../../ui/icons.jsx";
import Button from "../../../ui/Button.jsx";
import { mappingSetWords } from "../../../../features/catalog/mapping-sets.js";
import { reduxMonogram } from "../../../../features/catalog/redux-groups.js";
import { reduxAvatarOf } from "../../../../features/catalog/catalog-page-mods.js";
import { isCatalogBundle } from "../../../../catalog-utils.js";

// Редукс — сборка из раздела redux или со слотом redux-pack; запись null тут не падает.
function isRedux(mod) {
  if (!isCatalogBundle(mod)) return false;
  return mod.catalogSection === "redux" || mod.catalogSlot === "redux-pack";
}

// Где искать, по порядку: свой список редуксов, сборки части, моды того же поста.
const SOURCES = [(view) => view.reduxes?.find(isRedux), (view) => view.rails.parents.find(isRedux), (view) => view.rails.mates.find(isRedux)];

export function reduxOfPart(view) {
  if (!view.mod || isCatalogBundle(view.mod)) return null;
  for (const lookup of SOURCES) {
    const found = lookup(view);
    if (found) return found;
  }
  return null;
}

export function isReduxPart(view) {
  return Boolean(reduxOfPart(view));
}

// Лицо плашки: аватарка, потом обложка-строка, потом буква имени.
function faceOf(redux) {
  const own = reduxAvatarOf(redux);
  const picture = own || (typeof redux.cover === "string" ? redux.cover : "");
  return picture ? h("img", { alt: "", src: picture }) : reduxMonogram(redux.name);
}

// Сама плашка для найденного редукса.
function plateFor(redux, view) {
  const { partOf, openRedux } = mappingSetWords(view.language);
  const goTo = () => {
    view.rails.onSelect(redux);
  };
  return h(
    "div",
    { className: "mod-card-redux-plate" },
    h("span", { className: "mod-card-redux-plate-face", "aria-hidden": "true" }, faceOf(redux)),
    h("span", { className: "mod-card-redux-plate-copy" }, h("small", null, partOf), h("strong", null, h(ModName, { name: redux.name }))),
    h(Button, { variant: "secondary", size: "sm", trailing: h(ArrowRight, { weight: "bold" }), onClick: goTo }, openRedux),
  );
}

export default function ModReduxPlate({ view }) {
  const redux = reduxOfPart(view);
  return redux ? plateFor(redux, view) : null;
}
