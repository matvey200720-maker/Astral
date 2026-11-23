/*
 * Значок украшения ствола (задача 13 ТЗ 10.10.2026) — в его цветах: ромашка
 * белая с жёлтой серединой, брелок-сердце розовое на колечке; с 11.10 —
 * лоза вокруг ствола, тюльпан, лилия и голограмма. Рисунок свой, а не из
 * набора значков: у Phosphor нет брелока, лозы и веточки, а каждый новый
 * значок набора ложится в стартовый кусок окна.
 */

import { decorationVariant } from "@modovik/gun-studio";

const petals = (count, render) =>
  Array.from({ length: count }, (_, index) => render((index * 360) / count, index));

function FlowerArt({ variant, colour, accent }) {
  if (variant === "tulip")
    return (
      <>
        <path d="M12 21v-7M12 17c-2.6-.4-4.4-2-5-4.6 2.6.2 4.4 1.6 5 4.6zM12 18.4c1.8-1.4 3.6-1.8 5.4-1.4-1 1.8-2.8 2.4-5.4 1.4z" fill={accent} stroke={accent} strokeWidth="1.2" strokeLinecap="round" />
        <path d="M6.6 6.2c1.6 1.2 2.6 2 3.4 3.2.4-2.4 1-4.4 2-6 1 1.6 1.6 3.6 2 6 .8-1.2 1.8-2 3.4-3.2.4 4.4-.4 8-5.4 8.4-5-.4-5.8-4-5.4-8.4z" fill={colour} />
        <path d="M12 3.4c-1 1.6-1.6 3.6-2 6 .6 1.2 1.2 2.4 2 3.6.8-1.2 1.4-2.4 2-3.6-.4-2.4-1-4.4-2-6z" fill="rgba(0,0,0,.18)" />
      </>
    );
  if (variant === "lily")
    return (
      <>
        {petals(6, (angle, index) => (
          <path
            key={angle}
            d="M12 12c-1.4-2.4-1.6-5.4-.2-8.8.4 1.4 1.2 2.4 2 3.2-.2 2.2-.8 4-1.8 5.6z"
            fill={colour}
            opacity={index % 2 ? 0.86 : 1}
            transform={`rotate(${angle} 12 12)`}
          />
        ))}
        {petals(5, (angle) => (
          <g key={angle} transform={`rotate(${angle} 12 12)`}>
            <path d="M12 12l0 -5" stroke={accent} strokeWidth="0.7" />
            <circle cx="12" cy="6.8" r="0.9" fill={accent} />
          </g>
        ))}
      </>
    );
  if (variant === "rose")
    return (
      <>
        <path d="M5 17c2-4 5-4 7-2-3 1-4 3-7 2zM19 17c-2-4-5-4-7-2 3 1 4 3 7 2z" fill={accent} />
        <circle cx="12" cy="10.5" r="6.4" fill={colour} />
        <path d="M12 6.4c2.6 0 4 1.8 4 3.8 0 2.4-2 3.9-4.1 3.9-1.8 0-3.1-1.2-3.1-2.8 0-1.4 1-2.4 2.4-2.4 1.1 0 1.9.7 1.9 1.7" fill="none" stroke="rgba(0,0,0,.35)" strokeWidth="1.1" strokeLinecap="round" />
      </>
    );
  if (variant === "sakura")
    return (
      <>
        {petals(5, (angle) => (
          <ellipse key={angle} cx="12" cy="6.6" rx="3.3" ry="4.4" fill={colour} transform={`rotate(${angle} 12 12)`} />
        ))}
        <circle cx="12" cy="12" r="2.1" fill={accent} />
      </>
    );
  return (
    <>
      {petals(10, (angle) => (
        <ellipse key={angle} cx="12" cy="6.4" rx="1.5" ry="4.6" fill={colour} transform={`rotate(${angle} 12 12)`} />
      ))}
      <circle cx="12" cy="12" r="2.9" fill={accent} />
    </>
  );
}

function TwigArt({ variant, colour, accent }) {
  return (
    <>
      <path d="M5 20C8 15 11 10 18.5 3.5" fill="none" stroke={accent} strokeWidth="1.7" strokeLinecap="round" />
      {variant === "blossom"
        ? [
            [8.6, 14.2],
            [12.6, 9.4],
            [17, 4.8],
          ].map(([x, y]) => (
            <g key={x}>
              {petals(5, (angle) => (
                <ellipse key={angle} cx={x} cy={y - 1.5} rx="1.2" ry="1.6" fill={colour} transform={`rotate(${angle} ${x} ${y})`} />
              ))}
            </g>
          ))
        : [
            [7.4, 15.6, -40],
            [9.6, 12.4, 50],
            [12.4, 9.4, -40],
            [14.8, 7, 50],
          ].map(([x, y, angle]) => (
            <ellipse key={x} cx={x} cy={y} rx="1.5" ry="3.1" fill={colour} transform={`rotate(${angle} ${x} ${y})`} />
          ))}
    </>
  );
}

const starPoints = (cx, cy, outer, inner, points = 5) =>
  Array.from({ length: points * 2 }, (_, index) => {
    const radius = index % 2 ? inner : outer;
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    return `${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`;
  }).join(" ");

/* Снежинка: шесть лучей с веточками и середина вторым цветом. */
function SnowflakeArt({ colour, accent, cx = 12, cy = 12, r = 9 }) {
  return (
    <>
      {petals(6, (angle) => (
        <g key={angle} transform={`rotate(${angle} ${cx} ${cy})`} stroke={colour} strokeWidth={r * 0.16} strokeLinecap="round">
          <path d={`M${cx} ${cy}V${cy - r}`} />
          <path d={`M${cx} ${cy - r * 0.48}l${-r * 0.24} ${-r * 0.24}M${cx} ${cy - r * 0.48}l${r * 0.24} ${-r * 0.24}`} />
        </g>
      ))}
      <circle cx={cx} cy={cy} r={r * 0.22} fill={accent} />
    </>
  );
}

function StarArt({ variant, colour, accent }) {
  if (variant === "snowflake") return <SnowflakeArt colour={colour} accent={accent} />;
  if (variant === "sparkle")
    return (
      <>
        <polygon points={starPoints(12, 12, 9.5, 2.4, 4)} fill={colour} />
        <circle cx="12" cy="12" r="1.6" fill={accent} />
      </>
    );
  return (
    <>
      <polygon points={starPoints(12, 12.6, 9.4, 3.9)} fill={colour} />
      <polygon points={starPoints(12, 12.6, 4.2, 1.8)} fill={accent} opacity="0.7" />
    </>
  );
}

function CharmArt({ variant, colour, accent }) {
  return (
    <>
      <circle cx="12" cy="3.6" r="2.1" fill="none" stroke={accent} strokeWidth="1.3" />
      <circle cx="12" cy="7.4" r="0.95" fill="none" stroke={accent} strokeWidth="1" />
      <circle cx="12" cy="9.8" r="0.95" fill="none" stroke={accent} strokeWidth="1" />
      {variant === "dice" ? (
        <>
          <rect x="7.4" y="12" width="9.2" height="9.2" rx="1.8" fill={colour} stroke="rgba(0,0,0,.35)" strokeWidth="0.8" />
          {[
            [9.8, 14.4],
            [12, 16.6],
            [14.2, 18.8],
          ].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="0.95" fill="#1b1b1e" />
          ))}
        </>
      ) : variant === "star" ? (
        <polygon points={starPoints(12, 16.6, 5.6, 2.4)} fill={colour} />
      ) : variant === "bell" ? (
        <>
          <path d="M12 11.2c-2.6 0-4 2-4 4.8v2.6l-1.8 1.8h11.6L16 18.6V16c0-2.8-1.4-4.8-4-4.8z" fill={colour} />
          <circle cx="12" cy="21.2" r="1.1" fill={accent} />
        </>
      ) : variant === "ball" ? (
        <>
          <rect x="10.6" y="10.6" width="2.8" height="2" rx="0.5" fill={accent} />
          <circle cx="12" cy="17.2" r="5" fill={colour} />
          <ellipse cx="10" cy="15.4" rx="1.3" ry="0.8" fill="#ffffff" opacity="0.7" />
        </>
      ) : variant === "snowflake" ? (
        <SnowflakeArt colour={colour} accent={accent} cy={16.4} r={5.4} />
      ) : (
        <path d="M12 21.4c-3.6-2.5-6-4.6-6-7.1 0-1.7 1.3-3 2.9-3 1.3 0 2.4.8 3.1 1.9.7-1.1 1.8-1.9 3.1-1.9 1.6 0 2.9 1.3 2.9 3 0 2.5-2.4 4.6-6 7.1z" fill={colour} />
      )}
    </>
  );
}

/* Лоза: стебель волной вокруг «ствола» (штрих) с листьями и цветами или ягодами. */
function VineArt({ variant, colour, accent }) {
  const leaf = variant === "holly" ? "M0 0c1.2-1 2.6-.6 3.2.6-.6-.2-1.2.2-1.4.8-.2-.6-.8-.8-1.4-.6.2.6-.2 1.2-.4.8z" : "M0 0c1.4-2 4-2 4.6 0-1.2 1.6-3.4 2-4.6 0z";
  return (
    <>
      <rect x="3" y="10.2" width="18" height="3.6" rx="1.4" fill="currentColor" opacity="0.28" />
      <path d="M2.5 17.5C5 8 7.5 8 9.5 12s4.5 4 6.5 0 4-4.5 5.5-6" fill="none" stroke={colour} strokeWidth="1.5" strokeLinecap="round" />
      {[
        [5.2, 10.4, -30],
        [9.6, 12.6, 40],
        [13.6, 14.6, -20],
        [18.2, 8.6, 30],
      ].map(([x, y, angle]) => (
        <path key={x} d={leaf} fill={colour} transform={`translate(${x} ${y}) rotate(${angle}) scale(0.9)`} />
      ))}
      {variant !== "ivy" &&
        [
          [7.6, 9.4],
          [16.4, 12.6],
        ].map(([x, y]) =>
          variant === "holly" ? (
            <g key={x}>
              <circle cx={x} cy={y} r="1.2" fill={accent} />
              <circle cx={x + 1.6} cy={y + 0.6} r="1.1" fill={accent} />
            </g>
          ) : (
            <g key={x}>
              {petals(5, (angle) => (
                <ellipse key={angle} cx={x} cy={y - 1.2} rx="0.9" ry="1.3" fill={accent} transform={`rotate(${angle} ${x} ${y})`} />
              ))}
              {variant === "bloom" && <circle cx={x} cy={y} r="0.6" fill="#ffc83d" />}
            </g>
          ),
        )}
    </>
  );
}

/* Голограмма: объёмная фигура (грань со спинкой) или светящаяся над излучателем. */
function HologramArt({ variant, colour, accent }) {
  if (variant === "glow")
    return (
      <>
        <path d="M9.6 20.4l-3.6-6.6h12l-3.6 6.6z" fill={colour} opacity="0.22" />
        <rect x="8.4" y="19.6" width="7.2" height="2.2" rx="1" fill={accent === "#1a2a36" ? "currentColor" : accent} opacity="0.85" />
        <path d="M12 2.6l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" fill={colour} opacity="0.78" />
        {[5, 7.6, 10.2, 12.8].map((y) => (
          <path key={y} d={`M5 ${y}h14`} stroke="#000" strokeOpacity="0.22" strokeWidth="0.6" />
        ))}
      </>
    );
  return (
    <>
      <path d="M13.4 3.8l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M11 4.6l2.3 4.7 5.2.8-3.8 3.6.9 5.1L11 16.4l-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" fill={colour} stroke="rgba(0,0,0,.35)" strokeWidth="0.8" strokeLinejoin="round" />
    </>
  );
}

/*
 * Гирлянда вокруг модели (ТЗ 17.10.2026): «ствол» штрихом и волна вокруг
 * него — звенья, цветочки, мишура, лампочки или бусины.
 */
function GarlandArt({ variant, colour, accent }) {
  const spots = [
    [3.6, 15.6],
    [6.6, 10.2],
    [9.8, 9.4],
    [12.8, 13.4],
    [15.8, 15.2],
    [18.8, 11],
    [21, 8.6],
  ];
  const second = (index) => (index % 2 && accent !== colour ? accent : colour);
  return (
    <>
      <rect x="2" y="10.4" width="20" height="3.2" rx="1.2" fill="currentColor" opacity="0.28" />
      {variant !== "chain" && (
        <path d="M2.5 17C5 8 8 8 10 12s5 5 7 1 3.5-5 4.5-6" fill="none" stroke={variant === "flowers" ? "#3f8f3a" : variant === "tinsel" ? colour : "#2b2f36"} strokeWidth={variant === "tinsel" ? 1.1 : 0.9} strokeLinecap="round" />
      )}
      {variant === "chain" &&
        spots.map(([x, y], index) =>
          index % 2 ? (
            <ellipse key={x} cx={x} cy={y} rx="1.9" ry="0.7" fill="none" stroke={second(index)} strokeWidth="1" />
          ) : (
            <ellipse key={x} cx={x} cy={y} rx="1.9" ry="1.2" fill="none" stroke={second(index)} strokeWidth="1.1" />
          ),
        )}
      {variant === "flowers" &&
        spots.filter((_, index) => index % 2 === 0).map(([x, y]) => (
          <g key={x}>
            {petals(5, (angle) => (
              <ellipse key={angle} cx={x} cy={y - 1.2} rx="1" ry="1.4" fill={colour} transform={`rotate(${angle} ${x} ${y})`} />
            ))}
            <circle cx={x} cy={y} r="0.7" fill={accent} />
          </g>
        ))}
      {variant === "tinsel" &&
        spots.flatMap(([x, y], index) =>
          [-50, -10, 30, 70].map((angle) => (
            <path key={`${x}:${angle}`} d={`M${x} ${y}l0 -3.2`} stroke={(index + angle) % 3 === 1 ? accent : colour} strokeWidth="0.8" strokeLinecap="round" transform={`rotate(${angle + index * 17} ${x} ${y})`} />
          )),
        )}
      {variant === "lights" &&
        spots.map(([x, y], index) => (
          <g key={x}>
            <circle cx={x} cy={y - 1.6} r="2.2" fill={second(index)} opacity="0.25" />
            <ellipse cx={x} cy={y - 1.5} rx="0.95" ry="1.4" fill={second(index)} />
          </g>
        ))}
      {variant === "beads" && spots.map(([x, y], index) => <circle key={x} cx={x} cy={y} r="1.35" fill={second(index)} />)}
    </>
  );
}

/* Бант: две петли, узелок и хвосты ласточкой. */
function BowArt({ colour, accent }) {
  return (
    <>
      <path d="M12 11C9 6.6 3.6 5.6 3.4 9.2c-.2 3 4.6 3.6 8.6 1.8zM12 11c3-4.4 8.4-5.4 8.6-1.8.2 3-4.6 3.6-8.6 1.8z" fill={colour} />
      <path d="M11.2 11.6L7.4 20.4l2-0.8 1 1.6 2.2-8.8zM12.8 11.6l3.8 8.8-2-0.8-1 1.6-2.2-8.8z" fill={colour} opacity="0.85" />
      <ellipse cx="12" cy="11" rx="2" ry="1.7" fill={accent} />
    </>
  );
}

/* Лента: серпантин спиралью вниз или волна вдоль ствола, с каймой. */
function RibbonArt({ variant, colour, accent }) {
  if (variant === "wave")
    return (
      <>
        <path d="M2.5 12c3-4 5.5-4 8 0s5 4 8 0l3-1" fill="none" stroke={accent} strokeWidth="5" strokeLinecap="round" />
        <path d="M2.5 12c3-4 5.5-4 8 0s5 4 8 0l3-1" fill="none" stroke={colour} strokeWidth="3" strokeLinecap="round" />
      </>
    );
  return (
    <>
      <circle cx="12" cy="3.6" r="1.6" fill={accent} />
      <path d="M12 5c4 1 4 3 0 4s-4 3 0 4 4 3 0 4-4 3 0 4" fill="none" stroke={accent} strokeWidth="3.2" strokeLinecap="round" />
      <path d="M12 5c4 1 4 3 0 4s-4 3 0 4 4 3 0 4-4 3 0 4" fill="none" stroke={colour} strokeWidth="1.8" strokeLinecap="round" />
    </>
  );
}

/* Шипы на ремешке или заклёпки. */
function SpikeArt({ variant, colour, accent }) {
  return (
    <>
      <rect x="2.5" y="15" width="19" height="4.4" rx="1.2" fill={accent === "#1b1b1e" ? "currentColor" : accent} opacity={accent === "#1b1b1e" ? 0.55 : 1} />
      {[5.4, 9.2, 13, 16.8, 20.6].map((x) =>
        variant === "studs" ? (
          <polygon key={x} points={`${x - 1.7},15 ${x + 1.7},15 ${x},11.6`} fill={colour} />
        ) : (
          <polygon key={x} points={`${x - 1.5},15 ${x + 1.5},15 ${x},6`} fill={colour} />
        ),
      )}
    </>
  );
}

/* Своя модель на стволе: объёмный кубик-модель на подставке. */
function ModelArt({ colour }) {
  return (
    <>
      <path d="M12 3.5l7 4v8l-7 4-7-4v-8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5 7.5l7 4 7-4M12 11.5v8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.7" />
      <path d="M12 11.5l7-4v8l-7 4z" fill={colour === "#ffffff" ? "currentColor" : colour} opacity="0.35" />
    </>
  );
}

function LogoArt({ image }) {
  return (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {image ? (
        <image href={image} x="5" y="5" width="14" height="14" preserveAspectRatio="xMidYMid meet" />
      ) : (
        <path d="M6.5 17l3.6-4.6 2.6 3 1.8-2.2 3 3.8zM15.4 9.2a1.6 1.6 0 1 0 0-.01" fill="currentColor" />
      )}
    </>
  );
}

const ART = {
  flower: FlowerArt,
  twig: TwigArt,
  star: StarArt,
  charm: CharmArt,
  logo: LogoArt,
  vine: VineArt,
  hologram: HologramArt,
  garland: GarlandArt,
  bow: BowArt,
  ribbon: RibbonArt,
  spike: SpikeArt,
  model: ModelArt,
};

/** `decoration` — украшение или черновик в руке: `{ kind, variant, colour?, accent? }`. */
export default function DecorationGlyph({ decoration, image = "" }) {
  const look = decorationVariant(decoration?.kind, decoration?.variant);
  const Art = ART[decoration?.kind] || FlowerArt;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <Art
        variant={look.id}
        colour={decoration?.colour || look.colour}
        accent={decoration?.accent || look.accent}
        image={image}
      />
    </svg>
  );
}
