// Охрана локальной службы упакованного Astral: ходить в неё может только само окно.
//
// Служба слушает 127.0.0.1, но до окна достаёт и любая страница в браузере человека: простой запрос на `http://127.0.0.1:4174/...` уходит без предзапроса, а страница чужого сайта,
// чьё имя перенаправили на 127.0.0.1 (DNS rebinding), для браузера «своя» и читает ответы. Поэтому до всех маршрутов проверяются три вещи:
//   1. `Host` — только свой адрес: `127.0.0.1:<порт>` или `localhost:<порт>`, где порт — тот, на который пришло соединение (при занятом 4174 служба слушает случайный);
//      у rebinding в `Host` стоит имя чужого сайта;
//   2. `Origin` (если есть) — только origin самой службы, `Sec-Fetch-Site` (если есть) — только `same-origin` и `none`: запросы чужих страниц и страниц с других портов
//      127.0.0.1 (это `same-site`) отказываются, а у запросов окна и главного процесса таких заголовков нет либо они свои;
//   3. токен окна `X-Astral-Shell` на ЛЮБОЙ путь, когда он есть у этого запуска (закрытая сборка беты: главный процесс ставит его каждому запросу окна к своему серверу, какой бы
//      путь ни был, `apps/desktop/src/engine-window-wiring.js`; интерфейс из памяти его и так требует, `memory-web.js`); сверяется за постоянное время. Путь не разбирается вовсе:
//      Express сопоставляет маршруты без учёта регистра и по-своему читает `//`, `;`, `%`-кодирование, и любая своя проверка «это /api?» расходилась бы с маршрутизатором.
// Отказ — 403 без тела и без заголовков CORS. Вне упакованной сборки (разработка, песочница, тесты) охрана выключена: там в службу ходят через прокси и с портов Vite.
import { secretsMatch } from "./memory-web.js";

const SHELL_HEADER = "x-astral-shell";
const OWN_NAMES = ["127.0.0.1", "localhost"];
const OWN_FETCH_SITES = new Set(["same-origin", "none"]);

function refuse(response) {
  response.statusCode = 403;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", "0");
  response.end();
}

/**
 * @param {{ enabled?: boolean }} [options] `enabled` — охрана включена (упакованная служба).
 */
export function createLocalGuard({ enabled = false } = {}) {
  let shellKey = "";

  function middleware(request, response, next) {
    if (!enabled) return next();
    const headers = request.headers;
    const port = request.socket?.localPort;
    if (!port) return refuse(response);
    const hosts = OWN_NAMES.map((name) => `${name}:${port}`);
    if (!hosts.includes(String(headers.host ?? "").toLowerCase())) return refuse(response);
    if (headers.origin !== undefined && !hosts.map((host) => `http://${host}`).includes(String(headers.origin).toLowerCase())) return refuse(response);
    const site = headers["sec-fetch-site"];
    if (site !== undefined && !OWN_FETCH_SITES.has(String(site).toLowerCase())) return refuse(response);
    if (shellKey && !secretsMatch(headers[SHELL_HEADER], shellKey)) return refuse(response);
    return next();
  }

  return {
    middleware,
    get enabled() {
      return enabled;
    },
    /** Токен запуска (`accessToken` выдачи интерфейса из памяти); пустой — токена у этого запуска нет, и он не требуется. */
    useShellKey(token) {
      shellKey = String(token ?? "");
    },
  };
}
