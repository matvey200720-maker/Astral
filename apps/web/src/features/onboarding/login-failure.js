/*
 * Чем кончился вход через браузер — для экрана первого входа (`FirstRunLogin.jsx`).
 *
 * Главный процесс (`apps/desktop/src/desktop-auth.js`) отвечает окну одной строкой: слова из его `LOGIN_*_TEXT`. Окно узнаёт
 * строку по тексту (код отказа до него не доходит) и выбирает заголовок экрана. Слова самих отказов лежат в словаре окна
 * (`locales/ui-text/zone-h3-login-2410.js` и др.), заголовки — в `zone-port-launch-1511.js`; здесь только русские ключи.
 */

export const LOGIN_CANCELLED_TEXT = "Desktop authorization was cancelled.";
export const LOGIN_TIMEOUT_TEXT =
  "Браузер не вернул вход за 15 минут. Нажмите «Войти» и закончите вход на сайте ещё раз.";
export const LOGIN_REJECTED_TEXT =
  "Ссылка входа из браузера не подошла. Нажмите «Войти» и войдите на сайте ещё раз.";
export const LOGIN_CLOCK_TEXT =
  "Часы компьютера сбиты, и облако Astral не приняло вход. Включите «Устанавливать время автоматически» в настройках Windows и войдите снова.";
/* Слова сайта (страница входа `/auth`, отказ `scope`): сняли галочку в Discord. */
export const LOGIN_SCOPE_TEXT =
  "Нужно разрешить Astral добавить вас на сервер Astral mods. Начните вход заново и не снимайте галочки.";
const LOGIN_BETA_TEXTS = new Set([
  "Для входа нужен код доступа: получите его у бота Astral в Discord и введите на сайте.",
  "Код доступа не подошёл. Проверьте его на сайте или получите новый у бота Astral в Discord.",
]);

const RETRY_LEAD = "Вход не завершился. Это поправляется одним повтором.";

/** Заголовок, вторая строка и подводка экрана по виду отказа. */
export const FAILURE_HEADS = {
  timeout: ["Браузер не ответил", "начнём заново", RETRY_LEAD],
  rejected: ["Ссылка не подошла", "войди ещё раз", RETRY_LEAD],
  scope: [
    "Не хватило разрешения",
    "начни вход заново",
    "Вход не завершён. Это поправляется одним повтором.",
  ],
  beta: [
    "Код доступа не подошёл",
    "получи новый у бота",
    "Для входа нужен код доступа: его выдаёт бот Astral в Discord.",
  ],
  clock: [
    "Часы сбиты",
    "поправь время в Windows",
    "Из-за разницы во времени облако не приняло вход.",
  ],
  refused: ["Не получилось", "попробуем ещё раз", RETRY_LEAD],
};

/**
 * Ошибка входа → `{ kind, text }`. `cancelled` — человек отменил или окно вернуло фокус: ничего красного, только тихая строка.
 * Остальное — вид отказа и его слова (русская строка главного процесса; окно переведёт её само).
 */
export function classifyLoginFailure(message) {
  const text = String(message || "").trim();
  if (text.includes("Desktop authorization was cancelled"))
    return { kind: "cancelled", text: "" };
  if (text === LOGIN_TIMEOUT_TEXT) return { kind: "timeout", text };
  if (text === LOGIN_REJECTED_TEXT) return { kind: "rejected", text };
  if (text === LOGIN_CLOCK_TEXT) return { kind: "clock", text };
  if (text === LOGIN_SCOPE_TEXT) return { kind: "scope", text };
  if (LOGIN_BETA_TEXTS.has(text)) return { kind: "beta", text };
  return {
    kind: "refused",
    text: text || "Облако Astral не приняло вход. Попробуйте войти ещё раз.",
  };
}
