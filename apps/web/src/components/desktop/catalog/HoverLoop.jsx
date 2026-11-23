import "./hover-loop.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HOVER_DELAY_MS } from "../../../features/catalog/hover-loop.js";
import { useMotionEnabled } from "../../../motion-preference.js";
import { useVirtualScrolled } from "../../ui/virtual-scrolled.js";

/*
 * Петля на плитке каталога при наведении (ТЗ владельца 10.11.2026). Живёт внутри карточки как невидимый маячок: ловит наведение и фокус на самой
 * карточке, через `HOVER_DELAY_MS` кладёт `<video>` в рамку её кадра и убирает, когда мышь ушла. Одновременно играет одна плитка — под мышью; при
 * выключенных анимациях Astral и пока сетка листается, петля не стартует.
 */

export default function HoverLoop({ loop }) {
  const marker = useRef(null);
  const motion = useMotionEnabled();
  const scrolled = useVirtualScrolled();
  const [frame, setFrame] = useState(null);

  useEffect(() => {
    const card = marker.current?.closest(".ui-media-card");
    if (!card || !motion) return undefined;
    let timer = 0;
    const start = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setFrame(card.querySelector(".ui-media-card-frame")), HOVER_DELAY_MS);
    };
    const stop = () => {
      clearTimeout(timer);
      setFrame(null);
    };
    card.addEventListener("pointerenter", start);
    card.addEventListener("pointerleave", stop);
    card.addEventListener("focusin", start);
    card.addEventListener("focusout", stop);
    return () => {
      clearTimeout(timer);
      card.removeEventListener("pointerenter", start);
      card.removeEventListener("pointerleave", stop);
      card.removeEventListener("focusin", start);
      card.removeEventListener("focusout", stop);
      setFrame(null);
    };
  }, [motion, loop.src]);

  return (
    <>
      <span ref={marker} className="astral-hover-loop-marker" hidden />
      {frame && !scrolled
        ? createPortal(
            <video className="astral-hover-loop" src={loop.src} poster={loop.poster || undefined} muted loop autoPlay playsInline preload="auto" aria-hidden="true" tabIndex={-1} />,
            frame,
          )
        : null}
    </>
  );
}
