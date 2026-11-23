/*
 * Ссылка на конкретный ролик YouTube — для плеера в галерее карточки мода (24.10.2026 — пилюля «Обзор на YouTube»,
 * 25.10.2026 — сам ролик первым кадром; владелец: обзор показывается, только когда ролик правда есть).
 *
 * Те же правила, что у разбора публикации (`parseVideoUrl`, `@modovik/publishing`): хосты YouTube и номер из
 * одиннадцати знаков в `watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`, `v/`. Канал (`/@имя`, `/channel/…`),
 * плейлист, поиск, главная и ссылка без номера — не ролик, и пилюли у них нет. Своя копия, а не импорт: пакет
 * публикации тянет в стартовый кусок окна разбор постов, а здесь нужна одна проверка адреса.
 */

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
]);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Номер ролика в ссылке или пустая строка, если ссылка — не на конкретный ролик. */
export function youtubeVideoId(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return "";
  let id = "";
  if (host === "youtu.be") id = url.pathname.split("/")[1] || "";
  else if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
  else id = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] || "";
  return YOUTUBE_ID.test(id) ? id : "";
}

/**
 * Адрес встраиваемого плеера для карточки мода (25.10.2026): домен без кук, свои органы плеера, чужих роликов в конце нет.
 * Окно пускает его в рамку по политике контента (`frame-src` у `apps/api/src/security-middleware.js`). Скрипт YouTube
 * сюда не грузится: плеер — просто рамка. `enablejsapi` включён только ради ответа плеера на `postMessage` (его ошибку
 * читает `watchPlayerError`); `origin` — адрес окна, без него плеер на команды не отвечает.
 */
export function youtubePlayerUrl(id, origin = "") {
  const params = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1", enablejsapi: "1" });
  if (origin) params.set("origin", origin);
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`;
}

/** Ссылка «смотреть на YouTube» — её открывает системный браузер. */
export const youtubeWatchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

/**
 * Картинка ролика на сервере YouTube (кадр-обложка). Окно её пускает по `img-src`
 * (`apps/api/src/security-middleware.js`): только картинкой — ни скрипты, ни запросы окна туда не ходят.
 */
export const youtubePosterUrl = (id, size = "maxresdefault") => `https://i.ytimg.com/vi/${id}/${size}.jpg`;

/*
 * Ошибка плеера (25.10.2026, владелец: «Видео недоступно» вместо ролика). Автор запретил встраивание — плеер отвечает 101
 * или 150 и рисует в рамке свою страницу с кнопкой «Посмотреть на YouTube», а окно лаунчера новых окон не открывает
 * (`setWindowOpenHandler → deny`), и кнопка мертва. 100 — ролика нет или он закрыт, 152/153 — плеер не принял адрес
 * страницы, 2 и 5 — ссылка или плеер не поняли друг друга. Любая из них — повод показать свой кадр с кнопкой, которая
 * открывает системный браузер.
 */
const PLAYER_ORIGINS = new Set(["https://www.youtube-nocookie.com", "https://www.youtube.com"]);

/** Код ошибки из сообщения плеера или 0, если это не ошибка. */
export function readPlayerError(data) {
  let message = data;
  if (typeof data === "string") {
    try {
      message = JSON.parse(data);
    } catch {
      return 0;
    }
  }
  if (!message || typeof message !== "object" || message.event !== "onError") return 0;
  const code = Number(message.info);
  return Number.isFinite(code) && code > 0 ? code : 0;
}

/**
 * Слушает рамку плеера и зовёт `onError(код)`, когда он сообщил об ошибке. Плеер отвечает тем, кто сказал «слушаю»,
 * и только после своей загрузки: стучимся, пока не ответит, но не дольше десяти секунд. Возвращает отписку.
 */
export function watchPlayerError(iframe, onError) {
  if (!iframe) return () => {};
  let disposed = false;
  let handshake = 0;
  const post = () => {
    if (disposed || !iframe.contentWindow) return;
    let origin = "";
    try {
      origin = new URL(iframe.src).origin;
    } catch {
      return;
    }
    if (!PLAYER_ORIGINS.has(origin)) return;
    iframe.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), origin);
  };
  const onMessage = (event) => {
    if (event.source !== iframe.contentWindow || !PLAYER_ORIGINS.has(event.origin)) return;
    /* Плеер заговорил — рукопожатие состоялось. */
    window.clearInterval(handshake);
    const code = readPlayerError(event.data);
    if (code) onError(code);
  };
  window.addEventListener("message", onMessage);
  /* Стучимся только в загруженную рамку: до её «load» у окна адресата чужой (наш) адрес, и браузер сыплет в консоль
     «target origin does not match». Если «load» успел пройти до нашей подписки — через три секунды стучимся и так. */
  let started = false;
  const start = () => {
    started = true;
    window.clearInterval(handshake);
    let attempts = 0;
    post();
    handshake = window.setInterval(() => {
      attempts += 1;
      if (attempts > 40) window.clearInterval(handshake);
      else post();
    }, 250);
  };
  iframe.addEventListener("load", start);
  const late = window.setTimeout(() => {
    if (!started) start();
  }, 3000);
  return () => {
    disposed = true;
    window.clearTimeout(late);
    window.clearInterval(handshake);
    window.removeEventListener("message", onMessage);
    iframe.removeEventListener("load", start);
  };
}

/** Это ссылка на конкретный ролик. */
export const isYoutubeVideo = (value) => youtubeVideoId(value) !== "";

/*
 * Сборка-редукс — голова своего поста (слово владельца 22.11.2026: «в редуксах первым — ролик YouTube»): ролик поста — обзор именно этой сборки, даже если тот же пост несут и отдельные записи, что в её состав
 * не входят (прицел редукса, ганпак того же автора). Без этого ролик не стоял бы ни у одного редукса пилота: у каждого есть «Прицел …» с тем же роликом. У остальных записей правило прежнее.
 */
const isReduxHead = (mod) => mod?.publicationMode === "bundle" && includedOf(mod).length > 0;

/* Версии одного редукса («GTA 5 RP», «Majestic») — один носитель ролика: у них общая группа версий (`domain.variant.group`); у остальных носитель — сама запись. */
const carrierKey = (mod) => String(mod?.domain?.variant?.group || mod?.id || "");

/* Какие моды каталога несут какой ролик: считается один раз на список (страница мода спрашивает на каждой отрисовке). */
const carriersCache = new WeakMap();
function carriersOf(mods) {
  if (!Array.isArray(mods)) return new Map();
  let carriers = carriersCache.get(mods);
  if (carriers) return carriers;
  carriers = new Map();
  for (const mod of mods)
    for (const item of mod?.attribution?.sources || []) {
      if (item?.type !== "youtube") continue;
      const id = youtubeVideoId(item.url);
      if (!id) continue;
      if (!carriers.has(id)) carriers.set(id, new Map());
      carriers.get(id).set(mod.id, carrierKey(mod));
    }
  carriersCache.set(mods, carriers);
  return carriers;
}

/**
 * Ролик принадлежит одному этому моду (24.10.2026, решение ведущей): ролик поста — обзор поста, а не мода. Ролик, который
 * несут несколько модов каталога (часть редукса и его сборка, ганпак и его стволы: один пост — один ролик у всех), не
 * принадлежит никому из них и пилюлей не показывается — и на самом паке тоже. Версии одного редукса (общая `domain.variant.group`) — один носитель: ролик виден у каждой. `mods` — моды каталога, как их видит
 * страница; без списка судить не по чему, и ролик считается своим.
 */
export function isOwnVideo(id, mod, mods = null) {
  const carriers = carriersOf(mods).get(id);
  if (!carriers) return true;
  if (isReduxHead(mod)) return true;
  const own = carrierKey(mod);
  for (const [other, key] of carriers) if (other !== mod?.id && key !== own && !sameRedux(mod?.id, other, mods)) return false;
  return true;
}

/*
 * Часть редукса и его сборка — один пост и один ролик (15.11.2026, владелец: звуки из редукса — «ссылку на ролик прикрепляй»): ролик сборки не отнимает ролик
 * у части и наоборот. Связь — по составу сборки (`includedModIds`): одна входит в другую или обе входят в одну сборку каталога (две части одного редукса).
 * Две несвязанные записи с одним роликом по-прежнему прячут его у обеих.
 */
const includedOf = (mod) => (Array.isArray(mod?.includedModIds) ? mod.includedModIds : []);
function sameRedux(a, b, mods) {
  if (!a || !b || !Array.isArray(mods)) return false;
  for (const mod of mods) {
    const members = includedOf(mod);
    if (!members.length) continue;
    const has = (id) => mod.id === id || members.includes(id);
    if (has(a) && has(b)) return true;
  }
  return false;
}
