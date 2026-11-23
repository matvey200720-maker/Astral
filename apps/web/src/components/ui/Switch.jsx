/*
 * Двухпозиционный переключатель.
 *
 * Скин `.ui-switch` живёт в дизайн-системе (packages/astral-design/ui.css), а
 * разметку под него три мастерских выписывали руками — одну и ту же кнопку с
 * role="switch" и одним <i/> внутри. Копий было три, и расходиться им никто не
 * мешал: в одной уже не было aria-label, в другой — обработчика с клавиатуры.
 * Здесь она одна.
 */
export default function Switch({
  checked,
  onChange,
  label,
  className = "",
  disabled = false,
}) {
  return (
    <button
      type="button"
      className={`ui-switch${checked ? " is-on" : ""}${className ? ` ${className}` : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}
