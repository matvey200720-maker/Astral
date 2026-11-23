import { useCallback, useEffect, useRef, useState } from "react";
import { cancelLoginAccount, loginAccount, loginAccountLink } from "../api.js";
import { copyText } from "../clipboard.js";
import { openLink } from "../components/desktop/settings/open-link.js";
import { useDocumentHolds } from "../components/ui/useHolds.js";
import FirstRunFrame from "../features/onboarding/FirstRunFrame.jsx";
import {
  FirstRunDone,
  FirstRunHello,
  FirstRunWait,
} from "../features/onboarding/FirstRunLogin.jsx";
import GamePickerStep from "../features/onboarding/GamePickerStep.jsx";
import { matchConfirmedGame } from "../features/onboarding/confirmed-game.js";
import { readFirstRunQa } from "../features/onboarding/first-run-qa.js";
import { classifyLoginFailure } from "../features/onboarding/login-failure.js";
import { useTr } from "../locales/ui.js";
import "../features/onboarding/first-run.css";

/*
 * Первый вход: «привет» → ожидание браузера → «готово» → GTA V. Вход один — через Discord (браузер, пароль в окно не попадает).
 * GTA V обязательна: без подтверждённой папки в приложение не попасть. Вид — `features/onboarding/` (макет `r8/onboard/first-run`).
 * Слова — `locales/ui-text/zone-port-launch-1511.js`. Проект («где вы играете») здесь не спрашивается: он нужен только каталогу как фильтр.
 */

/* Сколько вошедшего человека держит поиск игры, прежде чем показать шаг игры с «ищем». */
const AFTER_LOGIN_SCAN_MS = 8000;
/* «Готово» видно не меньше этого, даже если игра нашлась сразу: человек успевает увидеть своё имя. */
const DONE_MIN_MS = 1800;
/* Через сколько после «Продолжить» показать ссылку входа и как часто спрашивать, ждёт ли вход ещё. */
const LOGIN_LINK_DELAY_MS = 5000;
const LOGIN_LINK_POLL_MS = 2000;
/* Через сколько ожидания подсказать про discord.com в браузере. */
const LOGIN_SLOW_MS = 20000;
/* Панель уходит вверх, потом окно открывается Главной (макет `first-run-transition`): сколько она уходит. */
const LEAVE_MS = 420;

const steamQaGame = {
  id: "qa-steam-legacy",
  store: "Steam",
  edition: "Legacy",
  installReadiness: "ready",
  path: "D:\\SteamLibrary\\steamapps\\common\\Grand Theft Auto V",
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default function ProductOnboarding({
  language,
  games,
  selectedGameId,
  onChooseGame,
  onSelectGame,
  onRefreshGames,
  onAccount,
  onFinish,
  onLanguage,
  firstRun = true,
  /* Человек уже вошёл, а папки игры нет (не выбирал или пропала): сразу шаг игры, без входа (`features/onboarding/game-gate.js`). */
  gameOnly = false,
  /* Облако отказало во входе, который был: экран говорит почему. */
  sessionEnded = false,
}) {
  /* `body` и `#root` знают, что в них первый запуск, меткой, а не `:has(.product-onboarding)` (`useHolds.js`). */
  useDocumentHolds("product-onboarding");
  useTr();
  /* Экраны без входа для песочницы (`?qa-first-run=`, только разработка) и прежний `?qa=steam` — сразу шаг игры. */
  const qaParams =
    import.meta.env.DEV && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const steamPreview =
    qaParams?.get("qa") === "steam" && qaParams?.get("signed-out") !== "1";
  const [qa] = useState(
    () =>
      readFirstRunQa() ??
      (steamPreview ? { step: "game", scan: "found", games: "qa" } : null),
  );
  const [step, setStep] = useState(qa?.step ?? (gameOnly ? "game" : "hello"));
  const [busy, setBusy] = useState(false);
  /* «Использовать эту копию» нажата: панель уходит, потом первый запуск кончается. */
  const [leaving, setLeaving] = useState(false);
  /* Чем кончился вход: отказ (слова и вид — `login-failure.js`) или тихая отмена. */
  const [failure, setFailure] = useState(qa?.failure ?? null);
  const [cancelled, setCancelled] = useState(Boolean(qa?.cancelled));
  const [signedIn, setSignedIn] = useState(qa?.user ?? null);
  /* Ссылка входа, если браузер за несколько секунд не забрал вход: открыть ещё раз или скопировать (25.10.2026 — у тестеров альфы браузер не открывался). */
  const [loginLink, setLoginLink] = useState(
    qa?.link ? "https://astral-mods.online/oauth2/authorize?qa=1" : "",
  );
  const [linkCopied, setLinkCopied] = useState(false);
  const [slow, setSlow] = useState(Boolean(qa?.slow));
  /* Отказ выбранной вручную папки — флажком, а не готовой строкой: слова переводит шаг игры в момент показа. */
  const [folderRejected, setFolderRejected] = useState(Boolean(qa?.rejected));
  const [gameScanState, setGameScanState] = useState(qa?.scan ?? (gameOnly ? "searching" : "idle"));
  const gameScanPromiseRef = useRef(null);
  /* Подставная игра — только превью шага игры; первый запуск целиком видит то, что нашёл мост, в том числе «ничего». */
  const visibleGames =
    qa?.games === "qa"
      ? games.length
        ? games
        : [steamQaGame]
      : qa?.games === "none"
        ? []
        : games;
  const selectedGame =
    visibleGames.find((item) => item.id === selectedGameId) || visibleGames[0];

  const startGameScan = useCallback(
    ({ force = false } = {}) => {
      if (!force && gameScanPromiseRef.current) {
        return gameScanPromiseRef.current;
      }
      const request = Promise.resolve().then(() =>
        onRefreshGames ? onRefreshGames() : games,
      );
      gameScanPromiseRef.current = request;
      request.catch(() => {
        if (gameScanPromiseRef.current === request) {
          gameScanPromiseRef.current = null;
        }
      });
      return request;
    },
    [games, onRefreshGames],
  );

  /* Ищем игру тихо, пока человек входит: итог показывается только после входа, экран входа остаётся про вход.
     Если он уже вошёл (`gameOnly`), итог поиска сразу ложится на шаг игры. */
  useEffect(() => {
    if (qa) return;
    const scan = startGameScan();
    if (gameOnly) scan.then((found) => setGameScanState(found?.length ? "found" : "missing"), () => setGameScanState("missing"));
    else scan.catch(() => {});
  }, [qa, gameOnly, startGameScan]);

  /* Пока вход ждёт браузер: ссылка входа (через несколько секунд) и подсказка про discord.com (если Discord отвечает долго). */
  useEffect(() => {
    if (step !== "wait" || qa) return undefined;
    let alive = true;
    let timer = null;
    const ask = () => {
      void loginAccountLink()
        .catch(() => "")
        .then((link) => {
          if (!alive) return;
          setLoginLink(link);
          timer = setTimeout(ask, LOGIN_LINK_POLL_MS);
        });
    };
    timer = setTimeout(ask, LOGIN_LINK_DELAY_MS);
    const slowTimer = setTimeout(() => alive && setSlow(true), LOGIN_SLOW_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(slowTimer);
      setLoginLink("");
      setLinkCopied(false);
      setSlow(false);
    };
  }, [step, qa]);

  async function signIn() {
    setBusy(true);
    setFailure(null);
    setCancelled(false);
    setStep("wait");
    try {
      const result = await loginAccount();
      /* Вход состоялся: «готово» с настоящими именем и аватаром, пока поиск игры не кончится — но не дольше AFTER_LOGIN_SCAN_MS,
         после них шаг игры открывается со словом «ищем», а итог ложится, когда поиск кончится. */
      setSignedIn(result.user);
      setStep("done");
      const shownAt = Date.now();
      const scan = startGameScan().catch(() => []);
      const found = await Promise.race([
        scan,
        pause(AFTER_LOGIN_SCAN_MS).then(() => null),
      ]);
      await onAccount(result.user);
      await pause(Math.max(0, DONE_MIN_MS - (Date.now() - shownAt)));
      if (found === null) {
        setGameScanState("searching");
        setStep("game");
        scan.then((late) =>
          setGameScanState(late?.length ? "found" : "missing"),
        );
        return;
      }
      /* Папку подтверждают один раз. Если она на месте и разбор нашёл ту же установку — второй раз спрашивать не о чем: человек
         попадает сразу в приложение. Переехала или пропала — экран честно появляется снова. */
      const remembered = matchConfirmedGame(found);
      if (remembered) {
        onFinish(remembered);
        return;
      }
      setGameScanState(found?.length ? "found" : "missing");
      setStep("game");
    } catch (reason) {
      const outcome = classifyLoginFailure(
        reason?.message ||
          "Облако Astral не приняло вход. Попробуйте войти ещё раз.",
      );
      if (outcome.kind === "cancelled") setCancelled(true);
      else setFailure(outcome);
      setStep("hello");
    } finally {
      setBusy(false);
    }
  }

  async function chooseFolder() {
    setBusy(true);
    setFolderRejected(false);
    try {
      const selected = await onChooseGame();
      setGameScanState(selected || selectedGame ? "found" : "missing");
    } catch {
      /* Не та папка — найденные копии остаются на месте, под ними причина. */
      setGameScanState(selectedGame ? "found" : "missing");
      setFolderRejected(true);
    } finally {
      setBusy(false);
    }
  }

  /* «Повторить поиск»: игру могли поставить, пока окно было открыто. */
  async function retryScan() {
    setBusy(true);
    setFolderRejected(false);
    setGameScanState("searching");
    try {
      const found = await startGameScan({ force: true });
      setGameScanState(found?.length ? "found" : "missing");
    } catch {
      setGameScanState("missing");
    } finally {
      setBusy(false);
    }
  }

  /* Игра подтверждена: панель уходит вверх, и только потом окно открывается Главной (в этот миг первый запуск кончается). */
  function finish(target) {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => onFinish(target), LEAVE_MS);
  }

  return (
    <div
      className={`product-onboarding first-run${leaving ? " is-leaving" : ""}`}
      data-language={language}
      data-step={step}
    >
      <FirstRunFrame language={language} onLanguage={onLanguage}>
        {step === "game" ? (
          <GamePickerStep
            games={visibleGames}
            selectedGame={selectedGame}
            busy={busy || leaving}
            searching={gameScanState === "searching"}
            error={folderRejected}
            onSelectGame={onSelectGame}
            onChooseFolder={chooseFolder}
            onRetry={retryScan}
            onFinish={finish}
          />
        ) : step === "done" ? (
          <FirstRunDone user={signedIn} />
        ) : step === "wait" ? (
          <FirstRunWait
            link={loginLink}
            copied={linkCopied}
            slow={slow}
            onCancel={() => void cancelLoginAccount().catch(() => {})}
            onReopen={() => openLink(loginLink)}
            onCopy={() => void copyText(loginLink).then(setLinkCopied)}
          />
        ) : (
          <FirstRunHello
            firstRun={firstRun}
            sessionEnded={sessionEnded}
            failure={failure}
            cancelled={cancelled}
            busy={busy}
            onSignIn={signIn}
          />
        )}
      </FirstRunFrame>
    </div>
  );
}
