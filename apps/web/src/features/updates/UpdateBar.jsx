// Нечисловой процент читается как ноль: кривой снимок от главного процесса
// не должен рисовать «NaN %» (docs/beta/release-channels.md, §5.4).
const UpdateBar = ({ percent, label }) => {
  const now = Math.round(Math.min(Math.max(Number.isFinite(percent) ? percent : 0, 0), 100));
  const width = now + "%";
  return (
    <span
      aria-valuemax="100"
      aria-valuemin="0"
      aria-valuenow={now}
      aria-label={label}
      className="updates-bar"
      role="progressbar"
    >
      <i style={{ width }} />
    </span>
  );
};

export default UpdateBar;
