import { useId } from "react";
import { blackworkAlong } from "../../../features/clothing/blackwork.js";

/*
 * Значок плитки блэкворка, когда снять настоящую часть тела нельзя (игра не найдена, нет Astral Desktop; снимок — `BlackworkTilePicture.jsx`): фигурка и на ней то, что закроют чернила, с тем же мягким краем. Это схема, а не кадр из игры.
 */

const LIMBS = Object.freeze({
  "left-arm": Object.freeze({ x: 40.5, y: 22, width: 5.5, height: 36 }),
  "right-arm": Object.freeze({ x: 14, y: 22, width: 5.5, height: 36 }),
  "left-leg": Object.freeze({ x: 31, y: 55, width: 7.5, height: 41 }),
  "right-leg": Object.freeze({ x: 21.5, y: 55, width: 7.5, height: 41 }),
  torso: Object.freeze({ x: 20, y: 18, width: 20, height: 38 }),
  neck: Object.freeze({ x: 27, y: 13, width: 6, height: 6 }),
});
const STOPS = 16;

/* Голова на схеме: от макушки (V 0) до воротника (V 0,8) — круг головы и шея под ним. */
const HEAD = Object.freeze({ x: 23.5, y: 1.5, width: 13, height: 17.5, collar: 0.8 });
const FACE = Object.freeze({ cx: 30, cy: 9, rx: 4.2, ry: 5.6 });

function Ink({ id, limb, mask }) {
  return (
    <>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        {Array.from({ length: STOPS + 1 }, (_, index) => (
          <stop key={index} offset={index / STOPS} stopColor="currentColor" stopOpacity={blackworkAlong(mask, index / STOPS)} />
        ))}
      </linearGradient>
      <rect className="wear-black-ink" x={limb.x} y={limb.y} width={limb.width} height={limb.height} rx="2.4" fill={`url(#${id})`} />
    </>
  );
}

/* Голова: чернила идут сверху вниз по V; у «лица» — только овал лица, у «шеи и головы» лицо остаётся кожей. */
function HeadInk({ id, mask }) {
  return (
    <>
      <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
        {Array.from({ length: STOPS + 1 }, (_, index) => (
          <stop key={index} offset={index / STOPS} stopColor="currentColor" stopOpacity={blackworkAlong(mask, (index / STOPS) * HEAD.collar)} />
        ))}
      </linearGradient>
      <clipPath id={`${id}-clip`}>
        {mask.side ? (
          <ellipse cx={FACE.cx} cy={FACE.cy} rx={FACE.rx} ry={FACE.ry} />
        ) : (
          <>
            <circle cx="30" cy="8" r="6.5" />
            <rect x={LIMBS.neck.x} y={LIMBS.neck.y} width={LIMBS.neck.width} height={LIMBS.neck.height} />
          </>
        )}
      </clipPath>
      <rect className="wear-black-ink" x={HEAD.x} y={HEAD.y} width={HEAD.width} height={HEAD.height} clipPath={`url(#${id}-clip)`} fill={`url(#${id}-fill)`} />
      {mask.hole && <ellipse className="wear-black-body" cx={FACE.cx} cy={FACE.cy} rx={FACE.rx} ry={FACE.ry} />}
    </>
  );
}

export default function BlackworkFigure({ item }) {
  const base = useId();
  return (
    <svg className="wear-black-figure" viewBox="0 0 60 100" aria-hidden="true">
      <circle className="wear-black-body" cx="30" cy="8" r="6.5" />
      {Object.values(LIMBS).map((limb, index) => (
        <rect key={index} className="wear-black-body" x={limb.x} y={limb.y} width={limb.width} height={limb.height} rx="2.4" />
      ))}
      {item.zone === "head" ? <HeadInk id={base} mask={item.blackwork} /> : <Ink id={base} limb={LIMBS[item.zone]} mask={item.blackwork} />}
    </svg>
  );
}
