import { useCallback, useEffect, useRef, useState } from "react";
import { Warning } from "../../ui/icons.jsx";
import Button from "../../ui/Button.jsx";
import { getRpMigrateStatus, runRpMigrate } from "../../../api.js";
import { humanFailure } from "../../../utils/installFailure.js";
import { useTr } from "../../../locales/ui.js";
import { rpMigrateWords } from "./rp-migrate-words.js";

/*
 * Строка «Моды для серверов RAGE MP» (20.11.2026, `docs/RP-MIGRATE-OFFER.md`): клиент RAGE MP не открывает пакеты `astral_*`, и моды, поставленные до режима RP, на серверах не видны. Строка
 * появляется, только когда перенос включён и стоящему есть что переезжать; по кнопке «Пересобрать» Astral пересобирает установленное одной транзакцией. Молчаливого переноса нет.
 * «Позже» прячет строку до следующего запуска приложения.
 */

const postponed = new Set();

export default function RpMigrateRow({ language, targetId }) {
  useTr();
  const [offer, setOffer] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState(() => postponed.has(targetId));
  const operation = useRef("");

  const refresh = useCallback(async () => {
    if (!targetId) return;
    try {
      setOffer(await getRpMigrateStatus({ targetId }));
    } catch {
      setOffer(null);
    }
  }, [targetId]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (hidden && phase === "idle") return null;
  if (!offer?.enabled || (!offer.needed && phase !== "done")) return null;

  const run = async () => {
    operation.current = `rp-migrate-${Date.now()}`;
    setPhase("running");
    setError("");
    try {
      const answer = await runRpMigrate({
        targetId,
        operationId: operation.current,
      });
      setResult(answer);
      setPhase(answer?.ok === false ? "refused" : "done");
      await refresh();
    } catch (failure) {
      setError(humanFailure(failure, language));
      setPhase("failed");
    }
  };
  const later = () => {
    postponed.add(targetId);
    setHidden(true);
  };

  const words = rpMigrateWords({ offer, phase, result, error });
  const busy = phase === "running";
  return (
    <div
      className={phase === "done" ? "settings-row" : "settings-row is-alert"}
      data-setting="rp-migrate"
      data-state={phase}
    >
      <span className="settings-row-copy">
        <b>
          {phase === "done" ? null : (
            <Warning className="settings-row-alert-glyph" aria-hidden="true" />
          )}
          {words.title}
        </b>
        <small role="status">{words.note}</small>
      </span>
      <span className="settings-row-control">
        {phase === "done" ? null : (
          <>
            {busy ? null : (
              <Button size="sm" onClick={later}>
                {words.later}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={busy || (offer.spaceOk === false && phase !== "failed")}
              aria-busy={busy || undefined}
              onClick={run}
            >
              {busy ? words.working : words.action}
            </Button>
          </>
        )}
      </span>
    </div>
  );
}
