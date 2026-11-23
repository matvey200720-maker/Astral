import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { HandbagSimple, Info } from "../../ui/icons.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { COMPONENT_ICONS } from "./ClothingTargetPicker.jsx";

/*
 * Разделы «Сделать заменёнку» чипами с иконками (владелец, 14.11.2026, макет «Две панели»): вместо выпадашки «Раздел» — ряд кнопок
 * «Верх, Низ, Обувь, Головные уборы…» (вид мода — первым, `cross-sections.js`). Выбор и список те же, что у выпадашки: нажатие — `onPick(запись)`.
 *
 * Макет «Витрина» (16.11.2026): ряд один — свой вид и столько соседних, сколько влезает целыми словами (ширина ряда меряется, слова не режутся многоточием), остальные под «Ещё» (нажал — разделы
 * раскрываются в несколько рядов, «Свернуть» возвращает один). Выбранный раздел всегда на виду: за пределами ряда он встаёт на место последнего. «· другой вид» уходит в подсказку и имя кнопки.
 * Без замера (тесты, `ResizeObserver` нет) — свой вид и три соседних.
 *
 * Правка владельца 18.11.2026: ряд один у всех видов вещей — и у масок, и у частей тела (руки, ногти, причёски). Свой вид в начале ряда может быть НЕСКОЛЬКИМИ чипами («Маски | Бороды | Усы», «Перчатки | Ногти»,
 * `section-kinds.js`): они не уезжают под «Ещё» и считаются одной группой — черта стоит после последнего. У записи ряда: `key` (по умолчанию `id`), `own` (группа своего вида), `blocked` (чип выключен: часть тела
 * встаёт только на такое же место, причина — подсказка).
 */
const FALLBACK_VISIBLE = 4;
/* Ширина чипа по числу знаков: значок и отступы 56 px, знак ≈ 7,4 px (кегль «body», вес 600) плюс зазор между чипами. */
const chipCost = (entry, lastOwn) => 56 + 6 + Math.round(tr(entry.label).length * 7.4) + (lastOwn ? 12 : 0);
const MORE_COST = 76;
const keyOf = (entry) => entry.key || entry.id;
/* Свой вид в начале ряда: сколько записей подряд (хотя бы одна). */
const ownGroup = (sections) => {
  let count = 0;
  while (count < sections.length && sections[count].own && !sections[count].cross) count += 1;
  return Math.max(1, count);
};

/* Какие разделы идут в ряд: индексы по порядку. Группа своего вида — всегда; остальные — если влезают (слишком длинное название пропускается, короткое после него встаёт); не влезли все — место под «Ещё». */
function fitting(sections, room, pinned) {
  if (!room) return sections.length <= FALLBACK_VISIBLE + 1 ? sections.map((_, at) => at) : sections.slice(0, Math.max(pinned, FALLBACK_VISIBLE)).map((_, at) => at);
  const cost = (at) => chipCost(sections[at], at === pinned - 1 && sections[at].own && !sections[at].cross);
  const all = sections.reduce((sum, _, at) => sum + cost(at), 0);
  if (all <= room) return sections.map((_, at) => at);
  const budget = room - MORE_COST;
  const picked = Array.from({ length: pinned }, (_, at) => at);
  let used = picked.reduce((sum, at) => sum + cost(at), 0);
  for (let at = pinned; at < sections.length; at += 1) {
    if (used + cost(at) > budget) continue;
    used += cost(at);
    picked.push(at);
  }
  return picked;
}

/* `note` — строка о разделах, которых в ряду нет («Причёски и руки — части тела…», М2, 16.11.2026): не в подвале окна, а здесь — значком в конце ряда (подсказка) и строкой под раскрытым рядом. */
export default function SectionChips({ sections, activeKey, onPick, note = "" }) {
  useTr();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const read = () => setRoom(node.clientWidth);
    read();
    if (typeof ResizeObserver !== "function") return undefined;
    const watcher = new ResizeObserver(read);
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);
  const pinned = useMemo(() => ownGroup(sections), [sections]);
  const { shown, hidden, collapsible } = useMemo(() => {
    /* Значок строки о частях тела занимает место в конце ряда. */
    const keep = fitting(sections, room && note ? room - 36 : room, pinned);
    const collapsible = keep.length < sections.length;
    if (open || !collapsible) return { shown: sections, hidden: 0, collapsible };
    const head = keep.map((at) => sections[at]);
    const picked = sections.find((entry) => keyOf(entry) === activeKey);
    /* Выбранный раздел всегда на виду: не влез в ряд — встаёт на место последнего (группа своего вида не трогается). */
    const row = picked && !head.includes(picked) ? [...head.slice(0, Math.max(pinned, head.length - 1)), picked] : head;
    return { shown: row, hidden: sections.length - row.length, collapsible };
  }, [open, sections, activeKey, room, note, pinned]);
  const lastOwn = sections[pinned - 1] && sections[pinned - 1].own && !sections[pinned - 1].cross ? sections[pinned - 1] : null;
  return (
    <div ref={ref} className={`clothing-section-chips${open ? " is-open" : ""}`} role="group" aria-label={tr("Раздел")}>
      {shown.map((entry) => {
        const Icon = COMPONENT_ICONS[entry.id] || HandbagSimple;
        const label = tr(entry.label);
        const base = entry.cross ? `${label} · ${tr("другой вид")}` : label;
        /* Раздел без вещей на этой вкладке (`section-presence.js`) — приглушён, причина в подсказке; имя кнопки прежнее. Часть тела на чужое место не встаёт — чип выключен, причина там же. */
        const hint = entry.blocked
          ? `${label} · ${tr("Часть тела встаёт только на такое же место: сюда её не поставить")}`
          : entry.muted
            ? `${base} · ${tr("На этой вкладке таких вещей нет")}`
            : base;
        return (
          <button
            key={keyOf(entry)}
            type="button"
            className={`clothing-section-chip${entry === lastOwn ? " is-own" : ""}${entry.muted ? " is-muted" : ""}${entry.blocked ? " is-blocked" : ""}`}
            aria-pressed={keyOf(entry) === activeKey}
            aria-disabled={entry.blocked ? "true" : undefined}
            aria-label={base}
            title={hint}
            tabIndex={entry.blocked ? -1 : undefined}
            onClick={entry.blocked ? undefined : () => onPick(entry)}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
      {hidden > 0 ? (
        <button type="button" className="clothing-section-chip is-more" aria-expanded="false" title={note ? tr(note) : undefined} onClick={() => setOpen(true)}>
          <span>{`${tr("Ещё")} ${hidden}`}</span>
        </button>
      ) : null}
      {open && collapsible ? (
        <button type="button" className="clothing-section-chip is-more" aria-expanded="true" onClick={() => setOpen(false)}>
          <span>{tr("Свернуть")}</span>
        </button>
      ) : null}
      {note ? (
        <span className="clothing-section-note" role="img" aria-label={tr(note)} title={tr(note)} tabIndex={0}>
          <Info aria-hidden="true" />
        </span>
      ) : null}
      {note && open ? <p className="clothing-pick-bodyline">{tr(note)}</p> : null}
    </div>
  );
}
