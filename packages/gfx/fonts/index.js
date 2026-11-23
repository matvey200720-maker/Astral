/*
 * «Шрифты» мастерской: чтение своего шрифта (TTF, OTF, TTC, WOFF),
 * подгонка глифов под шрифт игры и запись в библиотеку Scaleform GTA V.
 * Один модуль у окна (предпросмотр) и у установщика.
 */
export { readFontFile } from "./sfnt.js";
export { contourSegments, contoursBounds, emboldenContours, placeContours } from "./outline.js";
export { encodeCompactedFont, encodeGlyph, readCompactedFont } from "./compacted.js";
export { listGfxFonts, replaceGfxFonts } from "./gfx-fonts.js";
export { compileGameFont, fontLayout, gameCapHeight, sourceGlyph } from "./build.js";
export { hasOverlaps, removeOverlaps } from "./overlap.js";
