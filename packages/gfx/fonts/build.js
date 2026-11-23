/*
 * Шрифт игры из своего шрифта человека — одна арифметика у предпросмотра
 * окна и у установщика.
 *
 * Свой шрифт подгоняется под шрифт игры, на место которого встаёт: высота
 * заглавных — как у штатного (Chalet London — 179 единиц кегля), умноженная
 * на «Размер»; дальше — «Ширина» (буквы шире или уже, сотые высоты),
 * «Толщина» (сдвиг контуров наружу или внутрь, тысячные кегля),
 * «Интервал» (прибавка к ширине каждой буквы, тысячные кегля), «Наклон»
 * (градусы, верх буквы вправо), «Подъём» (сдвиг по высоте, доля высоты
 * заглавных) и «Межстрочный» (интерлиньяж, сотые кегля). Подъём и спуск строки остаются
 * штатными: поля текста в меню игры рассчитаны на них.
 *
 * Набор символов — штатный (латиница, кириллица, знаки): символ, которого
 * в своём шрифте нет, остаётся буквой игры, а не пустым квадратом.
 */

import { contourSegments, contoursBounds, emboldenContours, placeContours } from "./outline.js";
import { hasOverlaps, removeOverlaps } from "./overlap.js";

const KERNING_LIMIT = 8000;

/** Высота заглавных шрифта игры: по букве H, иначе три четверти подъёма. */
export function gameCapHeight(font) {
  const glyph = font.glyphs.find((item) => item.code === 0x48);
  if (glyph?.contours?.length && glyph.box[1] < 0) return -glyph.box[1];
  return Math.round(font.ascent * 0.75);
}

/** Глиф своего шрифта в единицах кегля игры: `{ contours, advance }` или `null`. */
export function sourceGlyph(source, code, layout) {
  const glyph = source.glyphOf(code);
  if (!glyph) return null;
  const contours = source
    .outline(glyph)
    .map(contourSegments)
    .filter(Boolean);
  const advance = source.advance(glyph);
  /* Пробел и другие пустые — только ширина. */
  if (!contours.length && advance <= 0) return null;
  const bold = layout.bold / layout.scale;
  const width = layout.width ?? 1;
  const placement = { scale: layout.scale, scaleX: layout.scale * width, skew: layout.skew ?? 0, dx: Math.max(0, layout.bold), dy: layout.dy };
  let placed = placeContours(emboldenContours(contours, bold), placement);
  /*
   * Наложенные контуры (вариативные шрифты, составные буквы) или толщина,
   * от которой сдвиг узлов завязал петли (просветы в «е», «а», «8»), —
   * буква пересобирается по растру исходных контуров с тем же сдвигом
   * границы: без наложений, с честно закрытыми просветами.
   */
  if (layout.solid !== false && hasOverlaps(placed)) placed = removeOverlaps(bold ? placeContours(contours, placement) : placed, { offset: layout.bold });
  return { contours: placed, advance: advance * layout.scale * width + layout.spacing + 2 * Math.max(0, layout.bold) };
}

/** Раскладка своего шрифта под шрифт игры: масштаб и сдвиги в единицах кегля. */
export function fontLayout(source, game, settings = {}) {
  const nominal = game.nominal || 256;
  const cap = game.cap || gameCapHeight(game);
  const size = (settings.size ?? 100) / 100;
  const scale = (cap * size) / Math.max(1, source.capHeight || source.unitsPerEm * 0.7);
  return {
    scale,
    width: (settings.width ?? 100) / 100,
    skew: Math.tan(((settings.slant ?? 0) * Math.PI) / 180),
    bold: ((settings.weight ?? 0) * nominal) / 1000,
    spacing: ((settings.spacing ?? 0) * nominal) / 1000,
    dy: -((settings.baseline ?? 0) / 100) * cap,
    leading: Math.round((game.leading ?? 0) + ((settings.leading ?? 0) * nominal) / 100),
  };
}

/**
 * Запись шрифта игры со своими глифами: `source` — `readFontFile`, `game` —
 * запись шрифта игры (`readCompactedFont`), `settings` — размер, ширина,
 * толщина, интервал, наклон, подъём, межстрочный. Ответ: `{ font, replaced, kept }` —
 * `font` для `encodeCompactedFont`, сколько символов своих и сколько
 * осталось штатными.
 */
export function compileGameFont(source, game, settings = {}) {
  const layout = fontLayout(source, game, settings);
  let replaced = 0;
  let kept = 0;
  const glyphs = game.glyphs.map((original) => {
    const own = sourceGlyph(source, original.code, layout);
    if (!own) {
      kept += 1;
      return { code: original.code, advance: original.advance, contours: original.contours };
    }
    replaced += 1;
    return { code: original.code, advance: own.advance, contours: own.contours };
  });
  /*
   * Кернинг своего шрифта — между символами набора; штатный к чужим буквам
   * не подходит. Пар у шрифта с кернингом по классам бывают десятки тысяч:
   * в файл идут самые заметные (у Chalet London игры их 7378), по порядку
   * кодов.
   */
  let kerning = [];
  const codes = game.glyphs.map((item) => item.code).filter((code) => source.glyphOf(code));
  for (const a of codes) {
    const left = source.glyphOf(a);
    for (const b of codes) {
      const advance = Math.round(source.kerning(left, source.glyphOf(b)) * layout.scale * layout.width);
      if (advance) kerning.push({ a, b, advance });
    }
  }
  if (kerning.length > KERNING_LIMIT) kerning = kerning.sort((x, y) => Math.abs(y.advance) - Math.abs(x.advance)).slice(0, KERNING_LIMIT);
  kerning.sort((x, y) => x.a - y.a || x.b - y.b);
  return {
    font: {
      id: game.id,
      name: game.name,
      flags: game.flags,
      nominal: game.nominal,
      ascent: game.ascent,
      descent: game.descent,
      leading: layout.leading,
      glyphs,
      kerning,
    },
    replaced,
    kept,
    bounds: contoursBounds(glyphs.flatMap((glyph) => glyph.contours)),
  };
}
