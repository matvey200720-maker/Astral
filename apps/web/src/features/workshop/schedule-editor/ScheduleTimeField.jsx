/*
 * Время строки «Расписания» (задача 4 ТЗ 11.10.2026, утро: «время — удобным
 * вводом: часы:минуты, диапазоны, несколько времён»).
 *
 * «Часами» — список времён: у каждого поле часов («9», «930», «9:30» — всё
 * станет «09:30»; стрелки ↑ и ↓ — ±15 минут, с Shift — ±1 час), у
 * промежутка — «С» и «До»; «+ Время» и «+ Промежуток» добавляют следующее,
 * «×» убирает. «Своим текстом» — как написано: «24/7», «по выходным».
 * Строка, которая на часы не делится, открывается своим текстом.
 *
 * На щит уходит строка: «12:00–14:00, 18:00» (`schedule-time.js`).
 */

import { useEffect, useState } from "react";
import { Plus, X } from "../../../components/ui/icons.jsx";
import { SCHEDULE_LIMITS } from "@modovik/climb-contract/recolor/schedule";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import TextField from "../../../components/ui/TextField.jsx";
import { formatClock, formatTimes, nextClock, parseClock, parseTimes, shiftClock, timesFit } from "./schedule-time.js";
import { tr, useTr } from "../../../locales/ui.js";

const MODES = Object.freeze([
  { value: "clock", label: "Часами", title: "Часы и промежутки полями: «18:00», «12:00–14:00», несколько через запятую" },
  { value: "text", label: "Своим текстом", title: "Как написано: «24/7», «по выходным»" },
]);
/* Поле часов — под «00:00» с запасом на рамку; ряд времени — по низу полей. */
const CLOCK_WIDTH = { width: 92 };
const ROW_ALIGN = { alignItems: "flex-end" };

/**
 * Поле часов: пишется как угодно («930»), на выходе — «09:30». Готовое время
 * уходит сразу, недописанное — по уходу с поля (иначе возвращается прежнее).
 */
export function ClockInput({ label, minutes, onChange, autoFocus = false }) {
  const [draft, setDraft] = useState(formatClock(minutes));
  useEffect(() => setDraft(formatClock(minutes)), [minutes]);
  const settle = () => {
    const value = parseClock(draft);
    if (value === null) setDraft(formatClock(minutes));
    else {
      setDraft(formatClock(value));
      if (value !== minutes) onChange(value);
    }
  };
  return (
    <TextField
      label={label}
      value={draft}
      maxLength={5}
      inputMode="numeric"
      autoComplete="off"
      placeholder="18:00"
      autoFocus={autoFocus}
      style={CLOCK_WIDTH}
      onChange={(text) => {
        const clean = text.replace(/[^\d:.]/g, "");
        setDraft(clean);
        /* «18:30» — сразу на табло; «18:3» ждёт. */
        if (/^\d{1,2}[:.]\d{2}$/.test(clean)) {
          const value = parseClock(clean);
          if (value !== null && value !== minutes) onChange(value);
        }
      }}
      onBlur={settle}
      onKeyDown={(event) => {
        if (event.key === "Enter") settle();
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const step = (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 60 : 15);
          onChange(shiftClock(parseClock(draft) ?? minutes, step));
        }
      }}
    />
  );
}

export default function ScheduleTimeField({ value, onChange }) {
  useTr();
  const items = parseTimes(value);
  const [mode, setMode] = useState(items ? "clock" : "text");
  /* Время сменилось не здесь (в кадре написали «24/7») — своим текстом. */
  useEffect(() => {
    if (!parseTimes(value)) setMode("text");
  }, [value]);
  const set = (next) => onChange(formatTimes(next));
  const add = (range) => {
    const list = items || [];
    const from = nextClock(list);
    const next = [...list, { from, to: range ? shiftClock(from, 120) : null }];
    if (timesFit(next)) set(next);
  };
  const canAdd = (range) => timesFit([...(items || []), { from: 0, to: range ? 0 : null }]);
  const switchMode = (next) => {
    /* Своим текстом → часами: то, что на часы не делится, становится одним временем. */
    if (next === "clock" && !items) onChange(formatTimes([{ from: 12 * 60, to: null }]));
    setMode(next);
  };
  return (
    <div className="finish-field">
      <p className="recolor-subhead">{tr("Время")}</p>
      <SegmentedControl label={tr("Как записать время")} size="sm" options={MODES} value={mode} onChange={switchMode} />
      {mode === "text" || !items ? (
        <>
          <TextField
            label={tr("Время на табло")}
            value={value}
            maxLength={SCHEDULE_LIMITS.time}
            placeholder={tr("Например, 24/7 или по выходным")}
            onChange={onChange}
          />
        </>
      ) : (
        <>
          {items.map((item, index) => (
            <div key={index} className="recolor-actions" style={ROW_ALIGN} role="group" aria-label={item.to === null ? `Время ${index + 1}` : `Промежуток ${index + 1}`}>
              <ClockInput label={item.to === null ? `Время ${index + 1}` : tr("С")} minutes={item.from} onChange={(from) => set(items.map((other, at) => (at === index ? { ...other, from } : other)))} />
              {item.to !== null && <ClockInput label={tr("До")} minutes={item.to} onChange={(to) => set(items.map((other, at) => (at === index ? { ...other, to } : other)))} />}
              <Button
                size="sm"
                variant="ghost"
                icon={<X />}
                ariaLabel={item.to === null ? `Убрать время ${formatClock(item.from)}` : `Убрать промежуток ${formatClock(item.from)}–${formatClock(item.to)}`}
                onClick={() => set(items.filter((_, at) => at !== index))}
              />
            </div>
          ))}
          <div className="recolor-actions">
            {canAdd(false) && <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => add(false)}>
              {tr("Время")}
            </Button>}
            {canAdd(true) && <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => add(true)}>
              {tr("Промежуток")}
            </Button>}
          </div>
          {/* Что встанет на табло — подписью поля, одной строкой состояния, а не абзацем (правило 1 `design-qa.md`). */}
          <small className="fx-hint">
            {tr("Время на табло")}: {value ? `«${value}»` : tr("без времени")}
          </small>
        </>
      )}
    </div>
  );
}
