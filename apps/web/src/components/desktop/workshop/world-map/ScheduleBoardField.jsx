import { useEffect, useRef } from "react";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Поле правки прямо на табло «Расписания» (задача 36 ТЗ 19.10.2026: «два раза нажал по тексту — и правишь»).
 *
 * Поле стоит на буквах названия, времени или заголовка тем же шрифтом, кеглем и цветом — табло выглядит тем же, только
 * с кареткой. Выровнено так же, как текст: название — от левого края, время — от правого, заголовок — по середине,
 * поэтому оно растёт в нужную сторону. Enter — к следующему полю (название → время → название следующей строки),
 * Esc или щелчок мимо — готово; у названия Shift+Enter — вторая строчка (строка табло становится «в две строчки»).
 * Текст пишется в проект сразу — одной отменой на поле.
 */

const ORIGIN = Object.freeze({ start: "0% 50%", middle: "50% 50%", end: "100% 50%" });
const SHIFT = Object.freeze({ start: "0", middle: "-50%", end: "-100%" });

export default function ScheduleBoardField({
  draft,
  left,
  top,
  rotation = 0,
  align = "start",
  font,
  multiline = false,
  focusKey = "",
  onChange,
  onNext,
  onDone,
}) {
  useTr();
  const input = useRef(null);

  useEffect(() => {
    const take = () => {
      const element = input.current;
      if (!element || document.activeElement === element) return;
      element.focus({ preventScroll: true });
      element.select?.();
    };
    take();
    const frame = requestAnimationFrame(take);
    const late = setTimeout(take, 60);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(late);
    };
  }, [focusKey]);

  const look = {
    fontFamily: font.family,
    fontWeight: font.weight,
    fontSize: `${font.size}px`,
    lineHeight: `${font.lineHeight}px`,
    letterSpacing: "0px",
    textTransform: font.upper ? "uppercase" : "none",
    color: font.color,
    textAlign: align === "middle" ? "center" : align === "end" ? "right" : "left",
  };
  const lines = draft.split("\n").length;

  return (
    <div
      className="wmc-label-edit wmc-schedule-field"
      data-map-type=""
      style={{
        left,
        top,
        minWidth: `${font.size * 1.5}px`,
        transformOrigin: ORIGIN[align],
        transform: `translate(${SHIFT[align]}, -50%) rotate(${rotation}deg)`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {/* Невидимый двойник текста задаёт размер поля: оно растёт по тексту. */}
      <span className="wmc-label-edit-size" aria-hidden="true" style={look} data-audit-ignore="type-min type-scale caps">
        {`${draft || " "}\u200b`}
      </span>
      <textarea
        ref={input}
        className="wmc-label-edit-input"
        value={draft}
        rows={lines}
        spellCheck={false}
        autoComplete="off"
        aria-label={tr("Текст на табло")}
        data-audit-ignore="type-min type-scale caps hit-target"
        style={look}
        onChange={(event) => onChange(event.target.value.replace(/\r\n?/g, "\n"))}
        onBlur={onDone}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onDone();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            /* Shift+Enter — вторая строчка названия (не больше двух). */
            if (event.shiftKey && multiline) {
              if (lines < 2) onChange(`${draft}\n`);
              return;
            }
            (onNext || onDone)();
          }
          if (event.key === "Tab") {
            event.preventDefault();
            (onNext || onDone)();
          }
        }}
      />
    </div>
  );
}
