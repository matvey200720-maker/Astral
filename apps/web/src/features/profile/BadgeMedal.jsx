/*
 * Медаль значка (макет 15.11.2026: `r7/shared/badge-art.js`, вид — `profile.css`, блок `.ba`).
 * Монохром: белое, серебро, графит. Состояния: получен, в процессе (кольцо пути),
 * закрыт и «скоро» (рисуется как закрытый). Подписи состояний пишет вызывающий.
 */
const GLYPHS = {
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.6 10.4 4.4 4.4 4.4-4.4" />
      <path d="M5 20h14" />
    </>
  ),
  undo: (
    <>
      <path d="M9 5.5 4.5 10 9 14.5" />
      <path d="M4.5 10H15a5 5 0 0 1 0 10h-3" />
    </>
  ),
  discord: (
    <>
      <path d="M7 7.3c1.6-.8 3.2-1.2 5-1.2s3.4.4 5 1.2c1.6 2.5 2.6 5.3 3 8.5-1.4 1.1-2.9 1.8-4.5 2.2l-.9-1.6c-.8.2-1.7.3-2.6.3s-1.8-.1-2.6-.3l-.9 1.6C6.9 17.6 5.4 16.9 4 15.8c.4-3.2 1.4-6 3-8.5z" />
      <circle className="f" cx="9.5" cy="12.4" r="1.15" />
      <circle className="f" cx="14.5" cy="12.4" r="1.15" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 4.8-9 4.8-9-4.8z" />
      <path d="m3 12 9 4.8 9-4.8" />
      <path d="m3 16.2 9 4.8 9-4.8" />
    </>
  ),
  link: (
    <>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3.2-3.2a3.6 3.6 0 0 0-5.1-5.1l-1 1" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3.2 3.2a3.6 3.6 0 0 0 5.1 5.1l1-1" />
    </>
  ),
  heart: (
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z" />
  ),
  box: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
    </>
  ),
  crosshair: (
    <>
      <circle cx="12" cy="12" r="6.6" />
      <path d="M12 3v4.4M12 16.6V21M3 12h4.4M16.6 12H21" />
      <circle className="f" cx="12" cy="12" r="1.1" />
    </>
  ),
  shirt: (
    <path d="M8.6 4 3.8 6.4l1.9 4.2 2.3-1V20h8V9.6l2.3 1 1.9-4.2L15.4 4c-.5 1.5-1.9 2.3-3.4 2.3S9.1 5.5 8.6 4z" />
  ),
  moon: (
    <>
      <path d="M19.2 14.3A7.9 7.9 0 0 1 9.7 4.8a7.9 7.9 0 1 0 9.5 9.5z" />
      <path d="M17.4 3.8v3M15.9 5.3h3" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.6" height="6.6" rx="1.6" />
      <rect x="13.4" y="4" width="6.6" height="6.6" rx="1.6" />
      <rect x="4" y="13.4" width="6.6" height="6.6" rx="1.6" />
      <rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.6" />
    </>
  ),
  wrench: (
    <g transform="rotate(45 12 12)">
      <path d="M8.2 2.6h2.2v3.6h3.2V2.6h2.2v4.7a4 4 0 0 1-1.7 3.3H9.9a4 4 0 0 1-1.7-3.3z" />
      <rect x="10.3" y="10.6" width="3.4" height="10.8" rx="1.7" />
    </g>
  ),
  hanger: (
    <>
      <path d="M12 12v-1.3c0-1.4 2.4-1.8 2.4-3.7a2.4 2.4 0 1 0-4.8 0" />
      <path d="m12 12-8.3 5.6a1.3 1.3 0 0 0 .7 2.4h15.2a1.3 1.3 0 0 0 .7-2.4z" />
    </>
  ),
  gauge: (
    <>
      <path d="M4.4 17.5a8.2 8.2 0 1 1 15.2 0" />
      <path d="m12 14 3.6-4.6" />
      <circle className="f" cx="12" cy="14" r="1.3" />
      <path d="M12 6.6v1.4M6.5 9.3l1 .9M17.5 9.3l-1 .9" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="12" r="4.3" />
      <path d="M12 12 18.2 5.8" />
      <circle className="f" cx="15.4" cy="14.8" r="1" />
    </>
  ),
  alpha: (
    <text
      className="f"
      x="12"
      y="18"
      textAnchor="middle"
      fontFamily="Inter,system-ui,sans-serif"
      fontSize="20"
      fontWeight="600"
    >
      α
    </text>
  ),
  beta: (
    <text
      className="f"
      x="12"
      y="18.7"
      textAnchor="middle"
      fontFamily="Inter,system-ui,sans-serif"
      fontSize="20"
      fontWeight="600"
    >
      β
    </text>
  ),
  bug: (
    <>
      <path d="M9 7.5a3 3 0 0 1 6 0" />
      <path d="M8 9.5h8V15a4 4 0 0 1-8 0z" />
      <path d="M3 10.5l5 2M21 10.5l-5 2M3 19l5-2.2M21 19l-5-2.2M12 9.5V19" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  gift: (
    <>
      <rect x="4" y="10.2" width="16" height="9.8" rx="2" />
      <rect x="3" y="7" width="18" height="3.4" rx="1.2" />
      <path d="M12 7v13M12 7C11 3.8 7 3.6 7 5.8 7 7 12 7 12 7zm0 0c1-3.2 5-3.4 5-1.2C17 7 12 7 12 7z" />
    </>
  ),
};

const LOCK = (
  <>
    <rect x="5.5" y="11" width="13" height="9" rx="2.2" />
    <path d="M8.5 11V8.4a3.5 3.5 0 0 1 7 0V11" />
  </>
);

/**
 * @param {object} props
 * @param {{ id: string, icon: string, name: string }} props.badge
 * @param {ReturnType<import("./badge-defs.js").badgeInfo>} props.info
 * @param {number=} props.size размер в пикселях (иначе 64)
 * @param {string=} props.label подпись для читалки; без неё медаль — украшение рядом с текстом
 * @param {boolean=} props.hover подъём при наведении (по умолчанию нет)
 * @param {{ state?: string }=} props.force подмена состояния — для всплывашки «получен»
 */
export default function BadgeMedal({
  badge,
  info,
  size,
  label,
  hover = false,
  force,
}) {
  const state = force?.state || (info.state === "soon" ? "lock" : info.state);
  const ring = force ? false : info.ring;
  const cls = [
    "ba",
    `ba-${state}`,
    hover ? "hv" : "",
    size && size <= 42 ? "ba-xs" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const stage = state === "got" && info.stage ? info.stage : 0;
  return (
    <span
      className={cls}
      style={size ? { "--ba": `${size}px` } : undefined}
      data-badge={badge.id}
      data-state={state}
      data-stage={stage || undefined}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : "true"}
    >
      <i className="ba-ring" />
      <i className="ba-in" />
      <svg className="ba-g" viewBox="0 0 24 24" aria-hidden="true">
        {GLYPHS[badge.icon] || GLYPHS.box}
      </svg>
      {ring && (
        <svg className="ba-pr" viewBox="0 0 64 64" aria-hidden="true">
          <circle className="t" cx="32" cy="32" r="30.4" />
          <circle
            className="a"
            cx="32"
            cy="32"
            r="30.4"
            pathLength="100"
            strokeDasharray={`${(Math.max(0, Math.min(1, info.pct)) * 100).toFixed(1)} 100`}
          />
        </svg>
      )}
      <i className="ba-sh" />
      {state === "got" && stage ? <b className="ba-n">{stage}</b> : null}
      {state === "lock" ? (
        <b className="ba-n">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {LOCK}
          </svg>
        </b>
      ) : null}
    </span>
  );
}
