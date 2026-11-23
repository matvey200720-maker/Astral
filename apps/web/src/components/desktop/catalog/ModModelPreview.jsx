import { createElement, Fragment, lazy, Suspense, useState } from "react";
import { isClothingCard } from "./mod-card/ModCardParts.jsx";
import { Cube as CubeGlyph } from "../../ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import DesktopOverlayPortal from "../overlays/DesktopOverlayPortal.jsx";

// Тяжёлый просмотрщик подгружается один раз за жизнь окна и только после нажатия.
const Viewer = lazy(() => import("../../../WeaponModelViewer.jsx"));

// Адрес модели: у записей сервера строка, у черновиков объект { url }; не истинное — пусто.
export function modModelUrl(mod) {
  const model = mod?.model;
  return typeof model === "string" ? model : model?.url || "";
}

// Кнопка запуска по умолчанию.
const launchButton = (word, open) =>
  createElement("button", { type: "button", className: "mod-model-preview-button", title: word, onClick: open }, createElement(CubeGlyph, { "aria-hidden": "true" }), createElement("span", null, word));

// Плита на время загрузки модуля просмотрщика.
const loadingPlate = (word) =>
  createElement(
    DesktopOverlayPortal,
    null,
    createElement("div", { className: "weapon-viewer-backdrop", "aria-live": "polite" }, createElement("div", { className: "weapon-viewer-module-loading" }, createElement(CubeGlyph), createElement("span", null, word))),
  );

// Просмотрщик в Suspense: пока грузится модуль, стоит плита.
const viewerFor = ({ mod, url, cover, language, word, close }) =>
  createElement(
    Suspense,
    { fallback: loadingPlate(word) },
    createElement(Viewer, { modelUrl: url, previewUrl: cover, title: mod.name, language, kind: isClothingCard(mod) ? "clothing" : "weapon", onClose: close }),
  );

// Всё, что стоит после хуков: запуск и, если открыто, просмотрщик.
function assemble({ mod, cover, language, renderTrigger, shown, setShown, url }) {
  const word = language === "ru" ? tr("Покрутить в 3D") : "Rotate in 3D";
  const open = () => {
    setShown(true);
  };
  const close = () => {
    setShown(false);
  };
  const launcher = renderTrigger ? renderTrigger({ label: word, open }) : launchButton(word, open);
  return createElement(Fragment, null, launcher, shown ? viewerFor({ mod, url, cover, language, word, close }) : null);
}

export default function ModModelPreview({ mod, cover, language = "ru", renderTrigger = null }) {
  useTr();
  const slot = useState(false);
  const url = modModelUrl(mod);
  return url ? assemble({ mod, cover, language, renderTrigger, shown: slot[0], setShown: slot[1], url }) : null;
}
