/*
 * Выключатель в шапке «Загрузок» (значок, слова, переключатель). Пояснение к нему — под выключателем: появляется при
 * наведении и фокусе, а после выключения «Ускоренной загрузки» стоит несколько секунд само (`shown`); читалка получает
 * его всегда (`role="status"`). Прежние слова пояснений остались те же: что ускоряет, что нагрузит, что будет при выключении.
 */
export default function DlToggle({
  icon: Icon,
  label,
  on,
  note,
  shown = false,
  onToggle,
  className = "",
}) {
  const wrap = ["dl-toggle-wrap", shown ? "is-shown" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={wrap}>
      <button
        type="button"
        className={on ? "dl-toggle is-on" : "dl-toggle"}
        aria-pressed={on}
        onClick={onToggle}
      >
        <Icon weight={on ? "fill" : "regular"} aria-hidden="true" />
        <span>{label}</span>
        <i className="dl-sw" aria-hidden="true" />
      </button>
      <p className="dl-tip" role="status" aria-live="polite">
        <span>{note}</span>
      </p>
    </div>
  );
}
