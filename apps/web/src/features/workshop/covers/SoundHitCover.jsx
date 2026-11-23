import {
  CHARACTER_IMAGE,
  FIGURE_VIEW,
  ZONE_ANCHORS,
} from "../../../components/desktop/workshop/impact-figure.js";

/*
 * Обложка звука попадания — та же мишень, что в студии, и отметка попадания
 * там, где звучит звук: в голове или в корпусе.
 *
 * Кадр — не вся фигура (в плитке она была бы спичкой), а то место, куда
 * попадают: голова с плечами или корпус. Отметка — крест, как у шутеров;
 * у головы красный, у тела белый, как в кадре студии. Дуги справа — знак
 * звука: карточка про то, что слышно, а не про кровь.
 */

/* Кадр вокруг точки попадания — в пикселях рендера. */
const FRAMES = Object.freeze({
  head: { width: 520, height: 330 },
  body: { width: 700, height: 440 },
});

const MARK = Object.freeze({ head: "#ff4d4d", body: "#ffffff" });

export default function SoundHitCover({ slotId = "" }) {
  const part = slotId === "hit-sounds-body" ? "body" : "head";
  const [ax, ay] = ZONE_ANCHORS[part];
  const x = ax * FIGURE_VIEW.width;
  const y = ay * FIGURE_VIEW.height;
  const frame = FRAMES[part];
  const unit = frame.height * 0.1;
  const arms = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  return (
    <svg
      className="workshop-cover-canvas"
      viewBox={`${x - frame.width / 2} ${y - frame.height / 2} ${frame.width} ${frame.height}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <image
        href={CHARACTER_IMAGE}
        x="0"
        y="0"
        width={FIGURE_VIEW.width}
        height={FIGURE_VIEW.height}
        opacity="0.9"
      />
      <g
        stroke={MARK[part]}
        strokeWidth={unit * 0.24}
        strokeLinecap="round"
        fill="none"
      >
        {arms.map(([dx, dy]) => (
          <line
            key={`${dx}${dy}`}
            x1={x + dx * unit * 0.5}
            y1={y + dy * unit * 0.5}
            x2={x + dx * unit * 1.25}
            y2={y + dy * unit * 1.25}
          />
        ))}
        {[2.1, 2.9].map((radius, index) => (
          <path
            key={radius}
            d={`M ${x + unit * radius * Math.cos(-0.6)} ${y + unit * radius * Math.sin(-0.6)} A ${unit * radius} ${unit * radius} 0 0 1 ${x + unit * radius * Math.cos(0.6)} ${y + unit * radius * Math.sin(0.6)}`}
            opacity={0.8 - index * 0.3}
          />
        ))}
      </g>
    </svg>
  );
}
