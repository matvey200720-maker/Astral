import { useCallback, useEffect, useReducer } from "react";
import { readErrorReportingState, setErrorReportingEnabled } from "./report.js";

// Согласие хранит главный процесс (Т-130, docs/runbooks/app-errors.md): окно показывает своё значение сразу,
// а откат при отказе моста берёт последнее подтверждённое им (07.11.2026).
// Действия: [1, ответ моста], [2, мгновенный отклик], [0] — отказ. Ответ после размонтирования React отбрасывает сам.
const step = (s, [kind, v]) =>
  kind === 1 ? { ...v, ok: v.enabled } : { ...s, enabled: kind ? v : s.ok };

export function useErrorReporting() {
  const [{ available, enabled }, put] = useReducer(step, { available: false, enabled: true, ok: true });

  useEffect(() => {
    readErrorReportingState().then((reply) => put([1, reply]), () => {});
  }, []);

  const setEnabled = useCallback(async (value) => {
    put([2, value]);
    put(await setErrorReportingEnabled(value).then((reply) => [1, reply], () => [0]));
  }, []);

  return { available, enabled, setEnabled };
}
