import { createElement, useMemo, useRef, useEffect } from "react";
import { PanelSection } from "./MapPanelParts.jsx";
import { MapTexturePanel } from "../WorldMapStylePanels.jsx";
import { MapInGamePanel } from "../WorldMapGamePanels.jsx";
import { useTr, tr } from "../../../../locales/ui.js";
import { worldMapVideoWeight, worldMapDiffersFromGame } from "@modovik/vector-map";
import { SquaresFour, GameController } from "../../../ui/icons.jsx";

const h = createElement;

const FLASH_MS = 1600;
const CALM_QUERY = "(prefers-reduced-motion: reduce)";

const glyph = (Icon) => h(Icon, { "aria-hidden": "true" });
const gamePage = (...kids) => h("div", { className: "wmc-game-page" }, ...kids);

// Вес считается только при наличии сцены и пересчитывается при смене сцены или проекта.
function useVideoWeight(scene, config) {
  const compute = () => (scene ? worldMapVideoWeight(scene, config) : null);
  return useMemo(compute, [scene, config]);
}

// Правки раздела: каждая собирает свою часть проекта и отдаёт onSection.
function sectionEditors(config, onSection) {
  const send = (section, change, caption, property) => onSection({ [section]: change }, caption, property);
  return {
    detail: (detail) =>
      send("export", { ...config.export, detail }, tr("Чёткость карты в игре"), "export.detail"),
    zoom: (zoom) => send("zoom", { ...config.zoom, ...zoom }, tr("Отдаление карты в игре"), "zoom.distance"),
    pauseMap: (patch, caption) => send("pauseMap", { ...config.pauseMap, ...patch }, caption, "pauseMap.blur"),
  };
}

function motionIsOff() {
  const switchedOff = document.querySelector(".desktop-app[data-motion='off']");
  if (switchedOff) return true;
  return typeof window.matchMedia === "function" && window.matchMedia(CALM_QUERY).matches;
}

function restartFlash(anchor) {
  const classes = anchor.classList;
  classes.remove("is-flash");
  void anchor.offsetWidth;
  classes.add("is-flash");
}

// Переход к органу: прокрутка, фокус на выбранный вариант, подсветка на 1600 мс.
function jumpToAnchor(root, target) {
  if (!root || !target) return undefined;
  const anchor = root.querySelector(`[data-map-anchor="${target}"]`);
  if (!anchor) return undefined;
  const behavior = motionIsOff() ? "auto" : "smooth";
  anchor.scrollIntoView?.({ block: "center", behavior });
  anchor.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  restartFlash(anchor);
  const timer = setTimeout(() => anchor.classList.remove("is-flash"), FLASH_MS);
  return () => clearTimeout(timer);
}

export function TexturePage(props) {
  const { base, patchBase, onTexture } = props;
  useTr();
  const panel = h(MapTexturePanel, {
    base,
    hasOwnTexture: Boolean(base.textureAssetId),
    onPatch: patchBase,
    onUpload: (file) => onTexture && onTexture(file),
  });
  return h(PanelSection, { title: tr("Фактура поверх карты"), icon: glyph(SquaresFour) }, panel);
}

export function DetailPage(props) {
  const { config, onSection } = props;
  const tileSide = props.tileSide === undefined ? 0 : props.tileSide;
  const weightScene = props.weightScene === undefined ? null : props.weightScene;
  const live = props.live === undefined ? null : props.live;
  useTr();
  const weight = useVideoWeight(weightScene, config);
  const edits = sectionEditors(config, onSection);
  const panel = h(MapInGamePanel, { part: "detail", config, tileSide, weight, live, onDetail: edits.detail });
  const section = h(PanelSection, { title: tr("Чёткость при приближении"), icon: glyph(GameController) }, panel);
  return gamePage(section);
}

export function GamePage(props) {
  const { config, tileSide, previewImage, atlas, onSection } = props;
  const weightScene = props.weightScene === undefined ? null : props.weightScene;
  const live = props.live === undefined ? null : props.live;
  const focus = props.focus === undefined ? null : props.focus;
  useTr();
  const rootRef = useRef(null);
  const weight = useVideoWeight(weightScene, config);
  const vectorLayer = !worldMapDiffersFromGame(config);
  const target = focus?.target;
  const stamp = focus?.stamp;

  useEffect(() => jumpToAnchor(rootRef.current, target), [target, stamp]);

  const edits = sectionEditors(config, onSection);
  const zoomPanel = h(MapInGamePanel, {
    part: "zoom",
    config,
    tileSide,
    vectorLayer,
    previewImage,
    atlas,
    weight,
    live,
    onZoom: edits.zoom,
    onDetail: edits.detail,
  });
  const blurPanel = h(MapInGamePanel, { part: "blur", config, onPauseMap: edits.pauseMap });
  return h(
    "div",
    { className: "wmc-game-page", ref: rootRef },
    h(PanelSection, { title: tr("Отдаление и чёткость"), icon: glyph(GameController) }, zoomPanel),
    h(PanelSection, null, blurPanel),
  );
}
