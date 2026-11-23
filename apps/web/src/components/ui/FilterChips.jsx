const joinClasses = (...names) => names.filter(Boolean).join(" ");

// Число показывается только конечное; ноль у выбранного варианта ряд не гасит.
const countBadge = (amount) => (Number.isFinite(amount) ? <span className="ui-chip-count">{amount}</span> : null);

function chipFor({ value, label, count }, selected, pick) {
  const active = value === selected;
  const classes = joinClasses("ui-chip", active && "is-active", !active && count === 0 && "is-empty");
  const press = () => {
    pick?.(value);
  };
  return (
    <button key={value} type="button" className={classes} aria-pressed={active} onClick={press}>
      <span>{label}</span>
      {countBadge(count)}
    </button>
  );
}

export default function FilterChips(props) {
  const { options = [], value, onChange, label, className = "" } = props;
  const chips = options.map((option) => chipFor(option, value, onChange));
  return (
    <div className={joinClasses("ui-chips", className)} role="group" aria-label={label}>
      {chips}
    </div>
  );
}
