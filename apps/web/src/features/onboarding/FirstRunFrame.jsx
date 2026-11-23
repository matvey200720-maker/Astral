import { useEffect, useRef, useState } from "react";
import { Brand, Button } from "@astral/design";
import { supportedLanguages } from "../../locales/desktop.js";
import { tr, useTr } from "../../locales/ui.js";

/*
 * Общая рама первого входа и выбора игры (макет `r8/onboard/first-run`): заголовок окна, кадр игры «Рассвет над городом»,
 * подпись кадра и сцена под панель. Вход (`FirstRunLogin.jsx`) и шаг игры (`GamePickerStep.jsx`) кладут в неё свои экраны.
 * Лист — `first-run.css` (едет вместе со страницей входа).
 */

const ICONS = {
  dc: (
    <>
      <path d="M6.2 6.3C8 5 10 4.4 12 4.4s4 .6 5.8 1.9c1.8 2.5 2.7 5.5 2.9 9-1.6 1.3-3.3 2.1-5.1 2.7l-1.1-1.7M6.2 6.3C4.4 8.8 3.5 11.8 3.3 15.3c1.6 1.3 3.3 2.1 5.1 2.7l1.1-1.7M8.7 16.6c2 .6 4.6.6 6.6 0" />
      <circle cx="9" cy="11.6" r="1.1" fill="currentColor" />
      <circle cx="15" cy="11.6" r="1.1" fill="currentColor" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  ok: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  okc: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.4 2.7 2.7L16.2 9.6" />
    </>
  ),
  spin: <path d="M12 3a9 9 0 1 0 9 9" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16.2v.1" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9S14.6 18.4 12 21M12 3C9.4 5.6 8.1 8.6 8.1 12s1.3 6.4 3.9 9" />
    </>
  ),
  chev: <path d="m6 9 6 6 6-6" />,
  folder: <path d="M3 7h6l2 2h10v10H3z" />,
  retry: <path d="M19 8a8 8 0 1 0 .8 5M19 4v4h-4" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  ext: (
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" />
      <path d="m8.8 12.2 2.3 2.3 4.2-4.3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  file: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <circle cx="12" cy="14" r="2.4" />
      <path d="m14 16 2.5 2.5" />
    </>
  ),
  wifi: (
    <path d="M3 9a14 14 0 0 1 18 0M6 12.5a9 9 0 0 1 12 0M9 16a4.5 4.5 0 0 1 6 0M12 19.5v.1" />
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  hdd: (
    <>
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M3 13l2.5-7h13L21 13M7 16.5h.01M11 16.5h.01" />
    </>
  ),
};

/** Знак на макетной сетке 24 × 24: контур, цвет — от текста. */
export function FrIcon({ name, className = "" }) {
  return (
    <svg
      className={`fr-i${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

const STAR_PATH =
  "M111 251C160 242 192 241 215 208C231 184 244 145 259 125C253 167 239 215 251 231C264 247 309 241 399 251C322 258 283 259 258 274C233 290 211 334 181 388C195 333 209 287 199 270C189 254 151 258 111 251Z";
const STAR_TAIL =
  "M231 371C230 326 242 291 274 275C304 260 344 257 399 263C347 266 310 273 283 288C256 303 238 333 231 371Z";

/** Знак Astral в кольце: ищем, нашли, не нашли (шаг игры). */
export function FrOrbit({ kind }) {
  const ring =
    kind === "found" ? "is-done" : kind === "search" ? "is-run" : "is-miss";
  return (
    <div className="fr-orbit" aria-hidden="true">
      <svg className="fr-o" viewBox="0 0 96 96">
        <circle className="fr-t" cx="48" cy="48" r="46" />
        <circle className={`fr-a ${ring}`} cx="48" cy="48" r="46" />
      </svg>
      <span className={`fr-st${kind === "miss" ? " is-dim" : ""}`}>
        <svg viewBox="111 125 288 263">
          <path fill="currentColor" d={STAR_PATH} />
          <path fill="currentColor" d={STAR_TAIL} />
        </svg>
      </span>
      {kind === "found" ? (
        <span className="fr-bd">
          <FrIcon name="ok" />
        </span>
      ) : kind === "miss" ? (
        <span className="fr-bd is-x">
          <FrIcon name="x" />
        </span>
      ) : null}
    </div>
  );
}

/** Знак над заголовком: плашка («Единый аккаунт Astral») или кольцо шага игры. */
export function FrHead({ pill, orbit, title, sub, lead }) {
  return (
    <>
      {orbit ? (
        <FrOrbit kind={orbit} />
      ) : pill ? (
        <span className="fr-pill fr-rise" style={{ "--d": 0 }}>
          <i />
          {pill}
        </span>
      ) : null}
      <h1 className="fr-h1 fr-rise" style={{ "--d": 1 }} id="first-run-title">
        {title}
        {sub ? <em>{sub}</em> : null}
      </h1>
      {lead ? (
        <p className="fr-lead fr-rise" style={{ "--d": 2 }}>
          {lead}
        </p>
      ) : null}
    </>
  );
}

/** Стеклянная панель под заголовком. */
export function FrGlass({ wide = false, children, ...rest }) {
  return (
    <main
      className={`fr-glass fr-rise${wide ? " is-wide" : ""}`}
      style={{ "--d": 3 }}
      {...rest}
    >
      {children}
    </main>
  );
}

/* Короткие подписи языков — как в шапке сайта (RUS, UA, ENG, DE, PL), французский — FR. */
const SHORT = { ru: "RUS", uk: "UA", en: "ENG", de: "DE", pl: "PL", fr: "FR" };

function LanguageChip({ language, onLanguage }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useTr();
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="fr-lang" ref={root}>
      <Button
        size="sm"
        className="fr-lang-btn"
        icon={<FrIcon name="globe" />}
        trailing={<FrIcon name="chev" />}
        aria-haspopup="menu"
        aria-expanded={open}
        ariaLabel={tr("Язык")}
        onClick={() => setOpen((value) => !value)}
      >
        {SHORT[language] || "RUS"}
      </Button>
      {open ? (
        <ul className="fr-lang-list" role="menu" aria-label={tr("Язык")}>
          {supportedLanguages.map((item) => (
            <li key={item.id} role="none">
              <Button
                variant="ghost"
                size="sm"
                className="fr-lang-item"
                role="menuitemradio"
                aria-checked={item.id === language}
                trailing={SHORT[item.id]}
                onClick={() => {
                  setOpen(false);
                  if (item.id !== language) onLanguage(item.id);
                }}
              >
                {item.native}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Окно первого входа: шапка (знак — там же и того же размера, что у шапки оболочки), кадр, подпись, сцена.
 * `onLanguage` нет — переключателя языка в шапке нет (тесты, песочницы без выбора).
 */
export default function FirstRunFrame({ language, onLanguage, children }) {
  useTr();
  return (
    <>
      <header className="fr-tb">
        <Brand
          className="desktop-titlebar-brand"
          markClassName="desktop-titlebar-brand-mark"
          wordmarkAs="b"
        />
        <span className="fr-sp" />
        {onLanguage ? (
          <LanguageChip language={language} onLanguage={onLanguage} />
        ) : null}
      </header>
      <div className="fr-bg" aria-hidden="true">
        <div className="fr-sky" />
        <div className="fr-shade" />
      </div>
      <div className="fr-stage">
        <div className="fr-core">{children}</div>
      </div>
      <p className="fr-cap">
        <b data-audit-ignore="caps">{tr("Кадр из игры")}</b>{" "}
        {tr("Рассвет над городом · небо Astral")}
      </p>
    </>
  );
}
