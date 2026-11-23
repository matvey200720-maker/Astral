import { Package as DefaultGlyph } from "./icons.jsx";

export default function EmptyState({ role = "status", title, headingLevel = 2, icon: Icon = DefaultGlyph, text, size = "page", actions, tone = "neutral", children, className, ...rest }) {
  const HeadTag = `h${headingLevel}`;
  const glyph = (
    <span className="ui-empty-glyph">
      <Icon weight="regular" />
    </span>
  );
  return (
    <section className={`ui-empty is-${size} is-${tone}${className ? ` ${className}` : ""}`} role={role} {...rest}>
      <div className="ui-empty-art" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span key={n} className={`ui-empty-card is-${n}`}>
            {n > 2 && glyph}
          </span>
        ))}
      </div>
      <HeadTag className="ui-empty-title">
        {title}
      </HeadTag>
      {text ? <p className="ui-empty-text">{text}</p> : text}
      {children}
      {actions ? <div className="ui-empty-actions">{actions}</div> : actions}
    </section>
  );
}
