// Заставка до интерфейса (15.11.2026): неподвижный знак Astral на тёмном фоне — без текста, без движения, без скриптов и сетевых
// запросов. Знак стоит ровно там и такого размера, где его подхватит заставка «Контур» интерфейса
// (`apps/web/src/features/onboarding/splash/`: ширина `clamp(180, min(19 % ширины, 29 % высоты), 290)`, центр на 40,5 % высоты,
// пунктирный контур и слабый ореол — её кадр в нулевой миг), поэтому при смене страницы ничего не прыгает. Контуры знака те же,
// что в `star-glyph.js` и `assets/Astral-mark.svg`. Без `xmlns`: встроенному в страницу SVG он не нужен, а ссылок в странице нет.
const STAR_BODY =
  "M111 251C160 242 192 241 215 208C231 184 244 145 259 125C253 167 239 215 251 231C264 247 309 241 399 251C322 258 283 259 258 274C233 290 211 334 181 388C195 333 209 287 199 270C189 254 151 258 111 251Z";
const STAR_SWOOSH =
  "M231 371C230 326 242 291 274 275C304 260 344 257 399 263C347 266 310 273 283 288C256 303 238 333 231 371Z";
const SPLASH_PAGE =
  `<!doctype html><meta charset="utf-8"><style>` +
  `:root{--w:clamp(180px,min(19vw,29vh),290px)}` +
  `html,body{margin:0;height:100%;overflow:hidden;background:#050505}` +
  `body{background:radial-gradient(60% 55% at 50% 42%,#0d0d0e 0%,#050505 55%,#000 100%),#000}` +
  `.h,.s{position:absolute;left:50%;top:40.5%;translate:-50% -50%}` +
  `.h{width:calc(var(--w)*2.0833);aspect-ratio:1;border-radius:50%;opacity:.08;` +
  `background:radial-gradient(closest-side,rgba(255,255,255,.5),rgba(255,255,255,.12) 45%,rgba(255,255,255,0))}` +
  `.s{width:var(--w);aspect-ratio:288/263;overflow:visible;fill:rgba(255,255,255,.035);stroke:rgba(255,255,255,.2);` +
  `stroke-width:1.1;stroke-dasharray:2 5;stroke-linecap:round;stroke-linejoin:round}` +
  `</style><div class="h"></div>` +
  `<svg class="s" viewBox="111 125 288 263"><path d="${STAR_BODY}"/><path d="${STAR_SWOOSH}"/></svg>`;

export const SPLASH_URL = `data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_PAGE)}`;

// Паузы перед повторами неудачной загрузки главного кадра (мс); дальше неудачи уходят в onFailed.
const RETRY_DELAYS = [350, 700];
// Загрузка прервана самим окном — не неудача.
const LOAD_ABORTED = -3;

// История окна не нужна: «назад» вела бы к заставке или странице сна.
function forgetHistoryOnLoad(win) {
  win.webContents.on("did-finish-load", () => {
    win.webContents.navigationHistory.clear();
  });
}

function reloadLater(win, url, pause) {
  function reload() {
    if (win.isDestroyed()) return;
    win.loadURL(url);
  }
  setTimeout(reload, pause);
}

// Повторы общие для всех неудач окна: расходуются по очереди, потом неудача уходит в onFailed.
function retryFailedLoads(win, url, onFailed) {
  const pauses = [...RETRY_DELAYS];
  win.webContents.on("did-fail-load", function (_event, code, description, _address, isMainFrame) {
    const ignorable = !isMainFrame || code === LOAD_ABORTED;
    if (ignorable || win.isDestroyed()) return;
    const pause = pauses.shift();
    // Причина — слова Chromium и код (`ERR_CONNECTION_REFUSED (-102)`): уходит в окно ошибки и в журнал.
    if (pause === undefined) onFailed(`${description || "load failed"} (${code})`);
    else reloadLater(win, url, pause);
  });
}

function whenInterfaceLoaded(win, url, origin) {
  return new Promise((resolve) => {
    function onInterfaceLoaded() {
      if (win.webContents.getURL().startsWith(origin)) {
        win.webContents.removeListener("did-finish-load", onInterfaceLoaded);
        resolve();
      }
    }
    win.webContents.on("did-finish-load", onInterfaceLoaded);
    win.loadURL(url);
  });
}

export function loadAppWindow(win, options) {
  const { url, origin, onFailed } = options;
  forgetHistoryOnLoad(win);
  retryFailedLoads(win, url, onFailed);
  return whenInterfaceLoaded(win, url, origin);
}
