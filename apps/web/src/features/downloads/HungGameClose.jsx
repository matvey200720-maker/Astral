import { useEffect, useState } from "react";
import Button from "../../components/ui/Button.jsx";
import Dialog from "../../components/ui/Dialog.jsx";
import { tr, useTr } from "../../locales/ui.js";
import { closeHungGame, listHungGames } from "./game-bridge.js";
import "./hung-game.css";

/*
 * «Закрыть зависшую GTA V» (26.11.2026). Появляется, только когда главный процесс уверен, что игра зависла (окна нет или оно
 * не отвечает, и процесс не только что запущен: `game-process-facts.js`). Сам Astral игру не закрывает: по кнопке спрашивает
 * подтверждение, а главный процесс перед закрытием проверяет всё заново.
 */
export const HUNG_POLL_MS = 10_000;

const OUTCOMES = {
  closed: "Зависшая GTA V закрыта",
  gone: "GTA V уже закрыта",
  responding: "GTA V снова отвечает — Astral её не закрывает",
  denied: "Не получилось закрыть GTA V: завершите её в диспетчере задач",
};

export default function HungGameClose({ pollMs = HUNG_POLL_MS }) {
  useTr();
  const [games, setGames] = useState([]);
  const [asking, setAsking] = useState(null);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let gone = false;
    const look = () =>
      listHungGames().then((found) => {
        if (!gone) setGames(found);
      });
    look();
    const timer = setInterval(look, pollMs);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [pollMs]);

  const game = games[0] || null;
  if (!game && !outcome) return null;

  async function confirm() {
    if (!asking || busy) return;
    setBusy(true);
    const answer = await closeHungGame(asking.pid);
    setBusy(false);
    setAsking(null);
    setOutcome(
      answer.closed
        ? "closed"
        : OUTCOMES[answer.reason]
          ? answer.reason
          : "denied",
    );
    if (answer.closed || answer.reason === "gone") setGames([]);
  }

  return (
    <div className="hung-game">
      {game ? (
        <>
          <p>
            {tr("GTA V запущена, но не отвечает: окна нет или оно зависло.")}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setOutcome("");
              setAsking(game);
            }}
          >
            {tr("Закрыть зависшую GTA V")}
          </Button>
        </>
      ) : null}
      {outcome ? <p role="status">{tr(OUTCOMES[outcome])}</p> : null}
      <Dialog
        open={Boolean(asking)}
        size="sm"
        title={tr("Закрыть зависшую GTA V?")}
        description={tr(
          "Всё, что не сохранено в игре, пропадёт. Закрывайте, только если игра и правда зависла.",
        )}
        closeLabel={tr("Закрыть")}
        onClose={() => setAsking(null)}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setAsking(null)}>
              {tr("Отмена")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={confirm}
            >
              {tr("Закрыть игру")}
            </Button>
          </>
        }
      />
    </div>
  );
}
