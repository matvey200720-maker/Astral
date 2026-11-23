import { formatSize } from "../../../catalog-utils.js";
import { Warning } from "../../ui/icons.jsx";

/*
 * Сводка открытой сборки (ТЗ 24.10.2026, вечер, п. C) — колонка «О сборке» слева, вместо «Работ мастерской 9» и списка:
 * сколько всего в сборке, сколько заменят ваши (число с «!»), сколько новых, сколько из каталога и сколько своих (работ
 * мастерской). Ниже — только то, что есть: уже в игре, останутся в сборке, вес.
 *
 * «0» — тоже ответ: сборка ничего вашего не тронет. Пока каталог не довёз часть модов или не разобрались коды работ, ответа
 * ещё нет — прочерк вместо «заменят» и «новых», а не ноль. \`summary\` — \`buildContentsSummary\`.
 */
export default function BuildSummaryFacts({ summary, totalSize = 0, language, copy, className = "" }) {
  const pending = summary.unknown > 0;
  return (
    <dl className={className ? `builds-summary-facts ${className}` : "builds-summary-facts"}>
      <dt>{copy.factTotal}</dt>
      <dd data-fact="total">{summary.total}</dd>
      <dt>{copy.factReplaceAny}</dt>
      <dd data-fact="replace" className={summary.replacing > 0 ? "is-caution" : undefined}>
        {summary.replacing > 0 && <Warning weight="fill" aria-hidden="true" />}
        {pending ? "—" : summary.replacing}
      </dd>
      <dt>{copy.factNew}</dt>
      <dd data-fact="fresh">{pending ? "—" : summary.fresh}</dd>
      <dt>{copy.factCatalog}</dt>
      <dd data-fact="catalog">{summary.catalog}</dd>
      <dt>{copy.factOwn}</dt>
      <dd data-fact="own">{summary.own}</dd>
      {summary.already > 0 && (
        <>
          <dt>{copy.factAlready}</dt>
          <dd data-fact="already">{summary.already}</dd>
        </>
      )}
      {summary.stays > 0 && (
        <>
          <dt>{copy.factStays}</dt>
          <dd data-fact="stays">{summary.stays}</dd>
        </>
      )}
      {totalSize > 0 && (
        <>
          <dt>{copy.factSize}</dt>
          <dd data-fact="size">{formatSize(totalSize, language)}</dd>
        </>
      )}
    </dl>
  );
}
