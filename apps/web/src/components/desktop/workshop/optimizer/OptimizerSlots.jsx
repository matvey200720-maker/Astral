import { createPortal } from "react-dom";

/*
 * Кадр и панель одной вкладки оптимизации — в разных местах окна.
 *
 * Раньше вкладка была одной секцией: кадр слева, панель справа. В студии оптимизации (ТЗ 22.10.2026, п. F) кадр
 * лежит в сцене редактора, а панель — в инспекторе каркаса, как у мастерских оружия и одежды. Состояние вкладки
 * (выбранная ступень, ползунок, очередь установки) живёт в одном компоненте и не должно разъезжаться на два, поэтому
 * компонент остаётся один, а два его куска переезжают порталом в гнёзда студии (`slots.stage`, `slots.panel`); третье гнездо — `slots.strip`, полоса на всю ширину под ними (плёнка шагов).
 * Без гнёзд — прежняя секция: кадр и панель вместе.
 *
 * Имя области (`aria-label`) стоит на панели: по нему читалка и тесты находят вкладку, а кадр — просто картинка.
 */
export default function OptimizerSlots({ className = "", label, slots = null, stage, panel, strip = null }) {
  if (slots?.stage && slots?.panel)
    return (
      <>
        {createPortal(stage, slots.stage)}
        {/* Полоса под кадром и панелью (плёнка шагов, дизайн 15.11.2026): у вкладок без неё гнездо остаётся пустым. */}
        {strip && slots.strip ? createPortal(strip, slots.strip) : null}
        {createPortal(
          <section className={`optimizer-slot ${className}`.trim()} aria-label={label}>
            {panel}
          </section>,
          slots.panel,
        )}
      </>
    );
  return (
    <section className={`texture-downgrade ${className}`.trim()} aria-label={label}>
      {stage}
      {panel}
      {strip}
    </section>
  );
}
