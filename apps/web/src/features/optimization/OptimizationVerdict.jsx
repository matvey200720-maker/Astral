import { CheckCircle, Lightning } from "../../components/ui/icons.jsx";
import { pluralWord } from "../../plural.js";
import { useCountUp } from "./useCountUp.js";
import { tr, useTr } from "../../locales/ui.js";

// Формы слов собираются при отрисовке: до смены языка словарь ещё русский.
const FORMS = {
  gain: () => [tr("доступное улучшение"), tr("доступных улучшения"), tr("доступных улучшений")],
  check: () => [tr("настройка"), tr("настройки"), tr("настроек")],
  build: () => [tr("сборка активна"), tr("сборки активны"), tr("сборок активно")],
};
const say = (kind, n) => pluralWord(n, FORMS[kind]());

// Прочерк до ответа: ноль здесь значил бы «улучшений нет» и был бы ложью.
function Answer({ summary, settled, gained }) {
  if (settled) return <b>{tr("Всё уже настроено")}</b>;
  return (
    <>
      <strong>{summary ? gained : "—"}</strong>
      <span>{say("gain", summary?.actionable)}</span>
    </>
  );
}

function noteOf(summary, scanning, checked) {
  if (!summary) return scanning ? tr("Считаем проверки…") : tr("Проверки не выполнены");
  return tr("Проверено {0} {1}").replace("{0}", checked).replace("{1}", say("check", summary.checks));
}

function timeOf(summary, scanning) {
  if (scanning) return tr("Проверяем…");
  const at = summary?.scannedAt;
  return at ? tr("Диагностика {0}").replace("{0}", at) : "";
}

export default function OptimizationVerdict({ activeCount = 0, scanning = false, summary = null }) {
  useTr();
  const gained = useCountUp(summary?.actionable ?? 0);
  const checked = useCountUp(summary?.checks ?? 0);
  const settled = Boolean(summary) && !summary.actionable;

  let tone = "warn";
  let Glyph = Lightning;
  if (!summary) {
    tone = "idle";
  } else if (settled) {
    tone = "ok";
    Glyph = CheckCircle;
  }

  return (
    <section
      aria-busy={scanning ? "true" : undefined}
      aria-label={tr("Итог диагностики")}
      className="ui-panel optimization-verdict"
      data-tone={tone}
    >
      <span
        aria-hidden="true"
        className="optimization-verdict-mark"
      >
        <Glyph weight="fill" />
      </span>
      <p className="optimization-verdict-value">
        <Answer
          gained={gained}
          settled={settled}
          summary={summary}
        />
      </p>
      <p className="optimization-verdict-note">{noteOf(summary, scanning, checked)}</p>
      {activeCount > 0 ? <em className="optimization-verdict-active">{`${activeCount} ${say("build", activeCount)}`}</em> : null}
      <span className="optimization-verdict-time">{timeOf(summary, scanning)}</span>
    </section>
  );
}
