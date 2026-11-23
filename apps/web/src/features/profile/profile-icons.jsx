/*
 * Значки страницы «Профиль» (макет 15.11.2026, `r6/profile-app/pa.js`): линия 1,7,
 * сетка 24 × 24, цвет — от текста. Свои, а не Phosphor: у профиля набор мельче
 * и тоньше, чем у рейки.
 */
const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  ext: <path d="M7 17 17 7M9 7h8v8" />,
  pen: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4.5 4.5" />,
  out: (
    <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h10" />
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2.5" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  upload: (
    <path d="M12 15V4M8 8l4-4 4 4M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
    </>
  ),
  library: <path d="M5 4v16M9 4v16M13.5 5.5l5 14M13.5 5.5l-2 .6" />,
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  discord: (
    <>
      <path d="M7 7.5c1.6-.8 3.2-1.2 5-1.2s3.4.4 5 1.2c1.6 2.5 2.6 5.3 3 8.5-1.4 1.1-2.9 1.8-4.5 2.2l-.9-1.6c-.8.2-1.7.3-2.6.3s-1.8-.1-2.6-.3l-.9 1.6C6.9 17.8 5.4 17.1 4 16c.4-3.2 1.4-6 3-8.5z" />
      <circle cx="9.4" cy="12.6" r="1.1" />
      <circle cx="14.6" cy="12.6" r="1.1" />
    </>
  ),
  server: (
    <>
      <rect x="3.5" y="4" width="17" height="6.5" rx="2" />
      <rect x="3.5" y="13.5" width="17" height="6.5" rx="2" />
      <path d="M7 7.2h.01M7 16.8h.01M11 7.2h5M11 16.8h5" />
    </>
  ),
  telegram: (
    <path d="M20.5 4.5 3.5 11l5.2 2 1.8 5.6 2.9-3.6 4.6 3.4zM8.7 13l8.6-5.6" />
  ),
  youtube: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="4" />
      <path d="M10.5 9.6v4.8l4.2-2.4z" fill="currentColor" />
    </>
  ),
  tiktok: (
    <path d="M14 4v10.2a3.6 3.6 0 1 1-3.6-3.6M14 4c.3 2.4 1.9 4 4.6 4.2" />
  ),
  twitch: <path d="M5 3.5h14.5v10.5l-4 4h-3.5l-3 3v-3H5zM10.5 8v4M15 8v4" />,
};

export default function ProfileIcon({
  name,
  size = 18,
  weight = 1.7,
  className = "i",
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name] || null}
    </svg>
  );
}

export const CONTACT_KINDS = [
  "discord",
  "server",
  "telegram",
  "youtube",
  "tiktok",
  "twitch",
];
