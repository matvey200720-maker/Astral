import { Warning } from "../../ui/icons.jsx";
import { planMessage, useEffectsCopy } from "./effects-lang.js";
import { memo } from "react";
import { tr } from "../../../locales/ui.js";

// 18.10.2026 (решение владельца): из подвала убран весь разбор «Изменится: …». Остаётся то, что
// человек исправляет сам: ошибка и замечания зон попаданий. «Появится ещё и там» (spill) и
// «досталась свободная запись» (borrowed) — свойства файла игры, строками не встают.
const line = (key, text, role) => (
  <p className={role === "alert" ? "fx-plan-line is-error" : "fx-plan-line"} key={key} role={role}>
    <Warning /> {text}
  </p>
);

export default memo(function EffectsPlanSummary(props) {
  const copy = useEffectsCopy();
  const { plan, mode, modeActive } = props;
  if (!(modeActive && plan)) return null;
  if (plan.error) return line("error", tr(plan.error), "alert");
  if (mode.part !== "impact") return null;
  return plan.warnings.flatMap(({ kind, zone, message }, index) =>
    ["empty", "heavy"].includes(kind) ? line(`${kind}:${zone}:${index}`, planMessage(copy, message), "note") : [],
  );
});
