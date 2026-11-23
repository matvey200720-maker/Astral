import { tr, useTr } from "../../../locales/ui.js";
import { trFill } from "../../../locales/tr-fill.js";

/*
 * Правило расцветок под плитками «Расцветка мода» (25.10.2026): полоска из
 * цветов вещи, у каждого — расцветка мода, которая на него ляжет, и слова про
 * правило. Цвет без пары автора — пунктиром: ему достанется выбранная
 * расцветка. Пары те же, что считает установщик.
 */
export default function ColourRule({ rule, className = "" }) {
  useTr();
  if (!rule) return null;
  const { summary, pairs } = rule;
  const upper = (letter) => String(letter).toUpperCase();
  const words = !summary
    ? tr("Каждый цвет вещи получит свою расцветку мода — по буквам автора; цвета без пары — выбранную здесь.")
    : summary.single
      ? tr("на все цвета вещи")
      : summary.rest.length
        ? trFill(
            "Своя расцветка мода — у {0} из {1} цветов вещи; остальные ({2}) получат выбранную здесь.",
            summary.own,
            summary.total,
            summary.rest.map(upper).join(", "),
          )
        : tr("Каждый цвет вещи получит свою расцветку мода — по буквам автора.");
  return (
    <div className={`clothing-colour-rule ${className}`.trim()}>
      {summary && !summary.single ? (
        <ol className="clothing-colour-rule-strip" aria-label={tr("Расцветки мода по цветам вещи")}>
          {pairs.map((pair) => (
            <li
              key={pair.target}
              className={`clothing-colour-rule-dot${pair.own ? "" : " is-fallback"}`}
              style={pair.swatch ? { background: pair.swatch } : undefined}
              title={trFill(
                pair.own
                  ? "Цвет вещи {0}: расцветка мода {1}"
                  : "Цвет вещи {0}: выбранная расцветка {1}",
                upper(pair.target),
                upper(pair.source),
              )}
            >
              <span>{upper(pair.target)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="clothing-colour-rule-note">{words}</p>
    </div>
  );
}
