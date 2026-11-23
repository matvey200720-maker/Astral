import {
  LOGIN_CLOCK_TEXT,
  LOGIN_REJECTED_TEXT,
  LOGIN_SCOPE_TEXT,
  LOGIN_TIMEOUT_TEXT,
} from "./login-failure.js";

/*
 * Экраны первого входа без входа: только песочница и разработка (`?qa-first-run=<имя>` рядом с `?preview=before-registration&qa=isolated`).
 * В продуктовой сборке `import.meta.env.DEV` ложно, `readFirstRunQa()` отдаёт `null`, и экран живёт только настоящим входом.
 *
 * Имена: hello, cancel, wait, wait-link, wait-slow, done, search, found, missing, rejected, err-timeout, err-rejected, err-scope,
 * err-beta, err-clock, err-refused. `games`: `qa` — подставная копия Steam, `none` — игры нет.
 */

const SASHA = {
  name: "Sasha_Drift",
  displayName: "Sasha_Drift",
  avatarUrl: "",
};
const BETA_TEXT =
  "Код доступа не подошёл. Проверьте его на сайте или получите новый у бота Astral в Discord.";
const REFUSED_TEXT = "Облако Astral не приняло вход. Попробуйте войти ещё раз.";

const failure = (kind, text) => ({ step: "hello", failure: { kind, text } });

const screens = () => ({
  hello: { step: "hello" },
  cancel: { step: "hello", cancelled: true },
  wait: { step: "wait" },
  "wait-link": { step: "wait", link: true },
  "wait-slow": { step: "wait", link: true, slow: true },
  done: { step: "done", user: SASHA },
  search: { step: "game", scan: "searching", games: "none" },
  found: { step: "game", scan: "found", games: "qa" },
  missing: { step: "game", scan: "missing", games: "none" },
  rejected: { step: "game", scan: "missing", games: "none", rejected: true },
  "err-timeout": failure("timeout", LOGIN_TIMEOUT_TEXT),
  "err-rejected": failure("rejected", LOGIN_REJECTED_TEXT),
  "err-scope": failure("scope", LOGIN_SCOPE_TEXT),
  "err-beta": failure("beta", BETA_TEXT),
  "err-clock": failure("clock", LOGIN_CLOCK_TEXT),
  "err-refused": failure("refused", REFUSED_TEXT),
});

export function readFirstRunQa() {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const name = new URLSearchParams(window.location.search).get("qa-first-run");
  return (name && screens()[name]) || null;
}
