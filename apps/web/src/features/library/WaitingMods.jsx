import { useState } from "react";
import Button from "../../components/ui/Button.jsx";
import { Warning } from "../../components/ui/icons.jsx";
import { waitingCopyFor } from "./waiting-copy.js";
import { waitingUpdatePlan } from "./waiting-mods.js";

/*
 * «Библиотека»: компоненты, которые после обновления игры ждут новой версии (А10, шаг 3). Строка с причиной на языке окна; кнопка «Обновить» ставит версию из
 * каталога, а не старые файлы (кнопок «поставить силой» нет); нет мода в каталоге — сказано, что встанет само. Движок отказал релизу каталога («в каталоге пока
 * прежняя версия», `refusedRelease` у снятой записи) — вместо кнопки строка об этом, пока не выйдет другой релиз.
 */
export default function WaitingMods({ items, mods, language = "ru", onInstall = null }) {
  const copy = waitingCopyFor(language);
  const [busy, setBusy] = useState(() => new Set());
  const { rows } = waitingUpdatePlan({ removed: items, mods });
  if (!rows.length) return null;
  const update = async (row) => {
    if (!row.mod || !onInstall) return;
    setBusy((current) => new Set(current).add(row.item.modId));
    try {
      await onInstall(row.mod);
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(row.item.modId);
        return next;
      });
    }
  };
  return (
    <section className="ui-panel workshop-library-drift workshop-library-waiting" role="status" data-drift="waiting">
      <Warning aria-hidden="true" />
      <div>
        <b>{copy.title}</b>
        <p>{copy.hint}</p>
        <ul className="workshop-library-waiting-list">
          {rows.map((row) => (
            <li key={row.item.modId} data-waiting-mod={row.item.modId}>
              <span className="workshop-library-waiting-name">{row.title}</span>
              <span className="workshop-library-waiting-line">{copy.line}</span>
              {row.canUpdate && onInstall ? (
                <Button size="sm" variant="secondary" disabled={busy.has(row.item.modId)} onClick={() => update(row)}>
                  {busy.has(row.item.modId) ? copy.updating : copy.update}
                </Button>
              ) : (
                <span className="workshop-library-waiting-missing" data-refused={row.refused ? "true" : undefined}>
                  {row.refused ? copy.same : copy.missing}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
