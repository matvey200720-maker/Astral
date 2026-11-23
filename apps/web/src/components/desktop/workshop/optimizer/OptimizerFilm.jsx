import { useId, useRef, useState } from "react";
import { CaretDown, Check, Info } from "../../../ui/icons.jsx";
import "./optimizer-film.css";

/*
 * Плёнка под сценой «Оптимизации» (дизайн 15.11.2026, макеты r6/opt2/opt2-a-textures, -distance): шапка с подсказкой и раскрывашкой «Как это устроено»,
 * ряд кадров по одному на шаг (выбранный в белой рамке, стоящий в игре — с галочкой), под ним ручка на рельсе и подписи шагов.
 *
 * Ручка — тот же ползунок, что был в панели: тянут её или жмут на кадр, плёнка только зовёт `onChange` вкладки, а выбор и «Установить» остаются
 * в состоянии вкладки. Положение ручки `value` — дробный номер шага (0 … число шагов − 1): у «Дальности» между кадрами ручка стоит там, где
 * стоит дальность. Рельс и ручка двигаются только transform (расчёт в CSS: ширина колонки берётся из контейнера, `cqw`).
 */

/* Шапка плёнки и раскрывашка заметок справа. `notes`: `{ title, count, content }`. */
export function FilmCard({
  title,
  hint = "",
  notes = null,
  className = "",
  children,
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className={`opf-film2 ${className}`.trim()} aria-label={title}>
      <header className="opf-film2-head">
        <span>
          {title}
          {hint ? <span className="opf-film2-hint">{hint}</span> : null}
        </span>
        {notes ? (
          <button
            type="button"
            className="opf-notes-chip"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
          >
            <Info aria-hidden="true" />
            {notes.title}
            {notes.count ? <em>{notes.count}</em> : null}
            <CaretDown className="opf-notes-caret" aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {notes && open ? (
        <div className="opf-notes-body" id={bodyId}>
          {notes.content}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* Ряд кадров: кнопки; `items[i]` — `{ key, label, thumb, on, inGame }`. */
export function FilmTiles({ items, gap, tileHeight, onPick, position = "" }) {
  return (
    <div
      className="opf-tiles"
      style={{
        "--n": items.length,
        "--g": `${gap}px`,
        "--tile-h": `${tileHeight}px`,
        ...(position ? { "--opf-pos": position } : null),
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.key ?? index}
          type="button"
          className="opf-tile"
          aria-pressed={item.on}
          aria-label={item.label}
          title={item.label}
          disabled={item.disabled}
          onClick={() => onPick(index)}
        >
          {item.thumb}
          {item.inGame ? (
            <span className="opf-tile-mark" aria-hidden="true">
              <Check weight="bold" />
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/*
 * Рельс с ручкой. `count` — число шагов, `value` — положение ручки (дробное), `onChange(дробный номер)` — нажатие или тяга,
 * `onNudge(±1)` и `onJump("start" | "end")` — клавиши.
 */
export function FilmRail({
  count,
  gap,
  value,
  label,
  valueText,
  onChange,
  onNudge,
  onJump,
  disabled = false,
}) {
  const rail = useRef(null);
  const [drag, setDrag] = useState(false);
  const at = (event) => {
    const box = rail.current?.getBoundingClientRect();
    if (!box || !box.width) return 0;
    const column = (box.width - (count - 1) * gap) / count;
    return Math.max(
      0,
      Math.min(
        count - 1,
        (event.clientX - box.left - column / 2) / (column + gap),
      ),
    );
  };
  const onKeyDown = (event) => {
    if (disabled) return;
    const keys = {
      ArrowLeft: () => onNudge(-1),
      ArrowDown: () => onNudge(-1),
      ArrowRight: () => onNudge(1),
      ArrowUp: () => onNudge(1),
      Home: () => onJump("start"),
      End: () => onJump("end"),
    };
    const act = keys[event.key];
    if (!act) return;
    event.preventDefault();
    act();
  };
  return (
    <div
      ref={rail}
      className="opf-rail"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={count - 1}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      data-drag={drag || undefined}
      style={{ "--n": count, "--g": `${gap}px`, "--k": value }}
      onPointerDown={(event) => {
        if (disabled || event.button > 0) return;
        try {
          rail.current?.setPointerCapture?.(event.pointerId);
        } catch {
          /* Нажатие без живого указателя (тест, синтетическое событие) — тянуть можно и так, пока курсор над рельсом. */
        }
        setDrag(true);
        onChange(at(event));
      }}
      onPointerMove={(event) => {
        if (drag) onChange(at(event));
      }}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onKeyDown={onKeyDown}
    >
      <span className="opf-rail-track">
        <i className="opf-rail-fill" />
      </span>
      {Array.from({ length: count }, (_, index) => (
        <i
          key={index}
          className="opf-rail-tick"
          data-on={index <= value + 0.001}
          style={{ "--i": index }}
        />
      ))}
      <i className="opf-rail-knob" />
    </div>
  );
}

/* Подписи шагов под рельсом: `items[i]` — `{ label, sub, on }`. */
export function FilmLabels({ items, gap }) {
  return (
    <div
      className="opf-labels"
      style={{ "--n": items.length, "--g": `${gap}px` }}
    >
      {items.map((item, index) => (
        <div key={index} data-on={item.on}>
          <b>{item.label}</b>
          {item.sub ? <small>{item.sub}</small> : null}
        </div>
      ))}
    </div>
  );
}
