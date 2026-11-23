/*
 * Шрифты надписи вместо метки (дополнение владельца 19.10.2026): те же системные шрифты Windows с кириллицей, что у
 * надписей меток залазов, — как их зовёт холст, знает `climb-editor/climb-fonts.js`. Договор держит только выбор
 * (`GROUP_MARKER_FONTS`); имена гарнитур — собственные названия, их не переводят.
 */

import { GROUP_MARKER_DEFAULT_FONT, GROUP_MARKER_FONTS } from "@modovik/minimap-contract/group-markers";
import { applyClimbFont, climbCssFont } from "../climb-editor/climb-fonts.js";
import { isWorkshopFontAsset } from "../emblem/emblem-fonts.js";

const LABELS = Object.freeze({
  impact: "Impact",
  bahnschrift: "Bahnschrift",
  "arial-black": "Arial Black",
  "segoe-black": "Segoe UI Black",
  franklin: "Franklin Gothic",
  consolas: "Consolas",
  georgia: "Georgia",
  comic: "Comic Sans",
  ink: "Ink Free",
  script: "Segoe Script",
});

export const GROUP_MARKER_FONT_LIST = Object.freeze(GROUP_MARKER_FONTS.map((id) => Object.freeze({ id, label: LABELS[id] || id })));

export const groupMarkerFontOf = (id) => (GROUP_MARKER_FONTS.includes(id) ? id : GROUP_MARKER_DEFAULT_FONT);

/** Шрифт надписи для холста: шрифт набора или `custom:<ключ файла>`, если выбран свой (общий ключ с залазами). */
export const groupMarkerFontKey = (id, fontAsset = "") => (id === "custom" && isWorkshopFontAsset(fontAsset) ? `custom:${fontAsset}` : groupMarkerFontOf(id));

/** Поставить шрифт холсту. */
export const applyGroupMarkerFont = (context, id, pixels, fontAsset = "") => applyClimbFont(context, groupMarkerFontKey(id, fontAsset), pixels);

/** Шрифт для CSS — образец на плитке выбора пишет своё имя им же. */
export const groupMarkerCssFont = (id) => climbCssFont(groupMarkerFontOf(id));
