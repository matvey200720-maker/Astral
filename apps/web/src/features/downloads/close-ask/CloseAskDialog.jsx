import { useEffect, useRef, useState } from "react";
import DesktopOverlayPortal from "../../../components/desktop/overlays/DesktopOverlayPortal.jsx";
import { closeAskCopyFor, closeAskPercent, closeAskText } from "./close-ask-copy.js";
import "./close-ask.css";

/*
 * Окно «Закрыть Astral?» поверх приложения (макет В1 «Короткий вопрос», 16.11.2026), вместо системного окна Windows. Кольцо показывает, сколько уже
 * скачано; главный совет — «Свернуть в трей», пусть докачивает. Ответ уходит `onAnswer(действие, не_спрашивать)`: «tray», «quit» или «cancel».
 * Escape — «Отмена»; фокус на главной кнопке, Tab ходит по кругу внутри окна.
 */

const FOCUSABLE = "button, input, [href]";

const textNode = (piece, index) => (typeof piece === "string" ? piece : <b key={index}>{piece.strong}</b>);

export function CloseAskDialog({ language, summary, onAnswer, onShown }) {
  const copy = closeAskCopyFor(language);
  const [dontAsk, setDontAsk] = useState(false);
  const card = useRef(null);
  const main = useRef(null);

  // Окно на экране: фокус на главной кнопке и «показал» главному процессу (иначе он спросит системным окном).
  useEffect(() => {
    main.current?.focus();
    onShown?.();
  }, [onShown]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onAnswer("cancel", false);
        return;
      }
      if (event.key !== "Tab" || !card.current) return;
      const stops = [...card.current.querySelectorAll(FOCUSABLE)];
      if (!stops.length) return;
      const edge = stops[event.shiftKey ? 0 : stops.length - 1];
      if (document.activeElement === edge || !card.current.contains(document.activeElement)) {
        event.preventDefault();
        stops[event.shiftKey ? stops.length - 1 : 0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onAnswer]);

  const answer = (action) => () => onAnswer(action, action === "cancel" ? false : dontAsk);

  return (
    <DesktopOverlayPortal>
      <div className="close-ask" data-close-ask>
        <div className="close-ask-card" ref={card} role="alertdialog" aria-modal="true" aria-labelledby="close-ask-title" aria-describedby="close-ask-text">
          <div className="close-ask-ring" role="img" aria-label={copy.ring(closeAskPercent(language, summary.percent))}>
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <circle className="t" cx="32" cy="32" r="29" />
              <circle className="a" cx="32" cy="32" r="29" pathLength="100" strokeDasharray={`${summary.percent} 100`} />
            </svg>
            <img src="/brand/astral-star-ring.webp" alt="" draggable="false" />
          </div>
          <h3 className="close-ask-title" id="close-ask-title">
            {copy.title}
          </h3>
          <p className="close-ask-text" id="close-ask-text">
            {closeAskText(language, summary).map(textNode)}
          </p>
          <div className="close-ask-buttons">
            <button type="button" className="close-ask-btn is-main" ref={main} onClick={answer("tray")}>
              {copy.tray}
            </button>
            <button type="button" className="close-ask-btn" onClick={answer("quit")}>
              {copy.quit}
            </button>
            <span className="close-ask-spacer" />
            <button type="button" className="close-ask-link" onClick={answer("cancel")}>
              {copy.cancel}
            </button>
          </div>
          <label className="close-ask-check">
            <input type="checkbox" checked={dontAsk} onChange={(event) => setDontAsk(event.target.checked)} />
            <span className="box" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 12.5 10 17.5 19 7" />
              </svg>
            </span>
            <span className="label">{copy.dontAsk}</span>
          </label>
        </div>
      </div>
    </DesktopOverlayPortal>
  );
}

export default CloseAskDialog;
