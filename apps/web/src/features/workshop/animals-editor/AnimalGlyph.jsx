import { Glyph } from "@astral/glyphs";

/*
 * Значок «Животные» (05.11.2026): отпечаток лапы — четыре пальца и подушка. Своего в наборе Astral нет; нарисован в канве набора
 * (`Glyph`: 24×24, линия 1,5, цвет от текста), поэтому стоит в ряду с остальными значками рейки и плитки.
 */
export default function Paw(props) {
  return (
    <Glyph {...props}>
      <path d="M12 12.5c-2.4 0-4.6 2.6-4.6 4.7 0 1.5 1.1 2.3 2.4 2.3 .9 0 1.4-.4 2.2-.4s1.3.4 2.2.4c1.3 0 2.4-.8 2.4-2.3 0-2.1-2.2-4.7-4.6-4.7Z" />
      <ellipse cx="5.6" cy="11" rx="1.7" ry="2.2" transform="rotate(-18 5.6 11)" />
      <ellipse cx="9.4" cy="6.6" rx="1.8" ry="2.4" transform="rotate(-6 9.4 6.6)" />
      <ellipse cx="14.6" cy="6.6" rx="1.8" ry="2.4" transform="rotate(6 14.6 6.6)" />
      <ellipse cx="18.4" cy="11" rx="1.7" ry="2.2" transform="rotate(18 18.4 11)" />
    </Glyph>
  );
}
