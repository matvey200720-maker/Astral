/*
 * Значки рейки — набор «Силуэт» (итог F, владелец 15.11.2026): залитые фигуры
 * на сетке 24×24 с вырезами по маске. Выбранный раздел от остальных отличает
 * не начертание значка, а плашка и полоска слева (`navigation-rail.css`), так
 * что у каждого раздела один значок, а не пара «контур / заливка».
 *
 * Значки лежат в стартовом куске окна, поэтому они сжаты: общий `<svg>` на
 * всех, у каждого — только фигуры и, если нужен, вырез.
 */
const MASK_ID = "rail-cut-";

const cut = (name, shapes, hole) => (
  <>
    <mask
      id={MASK_ID + name}
      maskUnits="userSpaceOnUse"
      x="0"
      y="0"
      width="24"
      height="24"
    >
      <rect width="24" height="24" fill="#fff" />
      {hole}
    </mask>
    <g mask={`url(#${MASK_ID + name})`}>{shapes}</g>
  </>
);

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const GLYPHS = {
  home: () =>
    cut(
      "home",
      <path d="M11.1 3.4a1.4 1.4 0 0 1 1.8 0l7 5.9c.4.4.6.8.6 1.4V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8.3c0-.6.2-1 .6-1.4z" />,
      <rect x="9.7" y="13.4" width="4.6" height="9" rx="2.3" fill="#000" />,
    ),
  catalog: () => (
    <>
      <rect x="3.4" y="3.4" width="7.6" height="7.6" rx="2.2" />
      <rect x="13" y="3.4" width="7.6" height="7.6" rx="2.2" />
      <rect x="3.4" y="13" width="7.6" height="7.6" rx="2.2" />
      <path d="M16.8 12.3Q16.8 15.72 21.3 16.8Q16.8 17.88 16.8 21.3Q16.8 17.88 12.3 16.8Q16.8 15.72 16.8 12.3Z" />
    </>
  ),
  workshop: () =>
    cut(
      "workshop",
      <path d="M20.4 7.6a4.8 4.8 0 0 1-6 4.7L7.9 18.9a2.3 2.3 0 0 1-3.3-3.3l6.5-6.5A4.8 4.8 0 0 1 16.3 3.2l-3 3 .4 2.6 2.6.4z" />,
      <circle cx="6.1" cy="17.9" r="1.1" fill="#000" />,
    ),
  library: () =>
    cut(
      "library",
      <>
        <rect x="3.4" y="3.4" width="5.2" height="17.2" rx="1.6" />
        <rect x="9.9" y="3.4" width="5.2" height="17.2" rx="1.6" />
        <rect
          x="16.2"
          y="4.6"
          width="5"
          height="16"
          rx="1.6"
          transform="rotate(-14 18.7 12.6)"
        />
      </>,
      <path d="M3.4 8.6h5.2M9.9 8.6h5.2" stroke="#000" strokeWidth="1.5" />,
    ),
  reshade: () =>
    cut(
      "reshade",
      <circle cx="12" cy="12" r="9.2" />,
      <path
        d="M12 6.2Q12 10.84 17.8 12Q12 13.16 12 17.8Q12 13.16 6.2 12Q12 10.84 12 6.2Z"
        fill="#000"
      />,
    ),
  "game-settings": () =>
    cut(
      "graphics",
      <>
        <rect x="2.8" y="3.8" width="18.4" height="13.4" rx="2.8" />
        <rect x="8.4" y="18.6" width="7.2" height="2.2" rx="1.1" />
      </>,
      <path
        d="M7.2 9h3.4M13.6 9h3.2M7.2 12.4h5.4M15.4 12.4h1.4"
        stroke="#000"
        strokeWidth="1.6"
        strokeLinecap="round"
      />,
    ),
  profiles: () => (
    <>
      <path d="M12 2.8l9.2 4.9-9.2 4.9-9.2-4.9z" />
      <path d="M3.5 12.3 12 16.8l8.5-4.5" {...STROKE} strokeWidth="2.3" />
      <path d="M3.5 16.3 12 20.8l8.5-4.5" {...STROKE} strokeWidth="2.3" />
    </>
  ),
  cart: () => (
    <>
      <path d="M4.6 8.4h14.8l-1.1 10.1a2.3 2.3 0 0 1-2.3 2H8a2.3 2.3 0 0 1-2.3-2z" />
      <path
        d="M8.8 8.4V7a3.2 3.2 0 0 1 6.4 0v1.4"
        {...STROKE}
        strokeWidth="1.9"
      />
    </>
  ),
  downloads: () => (
    <>
      <path d="M12 15.6l-5.2-5.4a.9.9 0 0 1 .65-1.5H10.4V3.9a1.6 1.6 0 0 1 3.2 0v4.8h2.95a.9.9 0 0 1 .65 1.5z" />
      <path d="M4 15.6h2.7v1.6c0 .6.4 1 1 1h8.6c.6 0 1-.4 1-1v-1.6H20v2.3a2.8 2.8 0 0 1-2.8 2.8H6.8A2.8 2.8 0 0 1 4 17.9z" />
    </>
  ),
  settings: () =>
    cut(
      "settings",
      <path d="M9.63 5.31 9.9 2.63 14.1 2.63 14.37 5.31A7.1 7.1 0 0 1 15.06 5.59L17.14 3.89 20.11 6.86 18.41 8.94A7.1 7.1 0 0 1 18.69 9.63L21.37 9.9 21.37 14.1 18.69 14.37A7.1 7.1 0 0 1 18.41 15.06L20.11 17.14 17.14 20.11 15.06 18.41A7.1 7.1 0 0 1 14.37 18.69L14.1 21.37 9.9 21.37 9.63 18.69A7.1 7.1 0 0 1 8.94 18.41L6.86 20.11 3.89 17.14 5.59 15.06A7.1 7.1 0 0 1 5.31 14.37L2.63 14.1 2.63 9.9 5.31 9.63A7.1 7.1 0 0 1 5.59 8.94L3.89 6.86 6.86 3.89 8.94 5.59A7.1 7.1 0 0 1 9.63 5.31Z" />,
      <circle cx="12" cy="12" r="3.2" fill="#000" />,
    ),
};

/* Значок раздела по его ключу в рейке (`overview` → дом). */
const ALIAS = { overview: "home" };

export default function RailGlyph({ id }) {
  const draw = GLYPHS[ALIAS[id] || id];
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {draw ? draw() : null}
    </svg>
  );
}

/* Подсказка у кнопки: имя, пояснение и сочетание клавиш. Читалке она не нужна —
   имя кнопки уже в `aria-label`. */
export function RailTip({ label, note, keys }) {
  return (
    <span className="rail-tip" aria-hidden="true">
      {label}
      {note ? <i>{note}</i> : null}
      {keys ? <kbd>{keys}</kbd> : null}
    </span>
  );
}

/* Число в углу кнопки: корзина — отложенное, загрузки — сколько модов качается сейчас. */
export function RailBadge({ count, className = "" }) {
  return (
    <b className={`rail-badge ${className}`.trim()} aria-hidden="true">
      {count > 99 ? "99+" : count}
    </b>
  );
}
