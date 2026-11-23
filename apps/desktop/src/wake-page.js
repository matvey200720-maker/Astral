// Страница сна окна (`hibernation.js`, `sleepPageUrl`) — экран пробуждения (15.11.2026, макет `wake.html`): тёмное окно; когда лаунчер
// будит окно, он ставит `<html class="waking">`, знак тлеет и разгорается, под ним слова «Просыпаемся…». Дальше окно
// загружается, и интерфейс (`apps/web/src/features/onboarding/splash/StartupSplash.jsx`) показывает тот же знак на том же месте
// (центр на 44 % высоты, ширина `min(14 %, 22 %)`) и увозит его в заголовок, когда окно открылось.
// Страница без скриптов, картинок и сетевых шрифтов; движется только transform и opacity, и только при `waking`. Без `xmlns`:
// SVG внутри страницы он не нужен, а ссылок в странице быть не должно.

const WAKE_STYLE = [
  'html,body{margin:0;height:100%;background:#050505;color:#d9d9dc;overflow:hidden;font:500 15px/1.4 "Segoe UI",system-ui,sans-serif}',
  ".wake{position:fixed;inset:0;visibility:hidden;--s:min(14vw,22vh)}",
  "html.waking .wake{visibility:visible}",
  ".fr{position:absolute;inset:0;background:radial-gradient(closest-side at 50% 44%,#0f0f10,#050505)}",
  ".ch{position:absolute;inset:0;opacity:0}",
  ".ch i{position:absolute;background:rgba(255,255,255,.07)}",
  ".ch .a{left:0;right:0;top:40px;height:1px}",
  ".ch .b{left:64px;top:41px;bottom:0;width:1px}",
  ".ch .c{position:absolute;left:10px;top:89px;display:flex;flex-direction:column;gap:8px}",
  ".ch .c b{width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,.035)}",
  ".core{position:absolute;left:50%;top:44%;width:0;height:0}",
  ".hw{position:absolute;left:0;top:0}",
  ".halo{position:absolute;left:calc(var(--s)*-1.1);top:calc(var(--s)*-1.1);width:calc(var(--s)*2.2);height:calc(var(--s)*2.2);border-radius:50%;background:radial-gradient(closest-side,rgba(255,255,255,.36),rgba(255,255,255,.09) 55%,rgba(255,255,255,0));opacity:0}",
  ".st{position:absolute;left:calc(var(--s)*-.5);top:calc(var(--s)*-.4565);width:var(--s);height:calc(var(--s)*.9132);overflow:visible}",
  ".dim{fill:rgba(255,255,255,.07);stroke:rgba(255,255,255,.3);stroke-width:1.3;stroke-linejoin:round}",
  ".sh{transform:translateX(-80px)}",
  ".cw{position:absolute;left:0;right:0;top:calc(44% + var(--s)*.46 + 40px)}",
  ".cp{text-align:center}",
  ".cp b{display:block;font-size:18px;font-weight:600;color:#f1f1f3;opacity:0}",
  ".cp span{display:block;margin-top:5px;font-size:14px;color:#9a9aa1;opacity:0}",
  "html.waking .ch{animation:fi .9s ease-out .5s both}",
  "html.waking .dim{animation:em .5s ease-out both;transform-origin:255px 256px}",
  "html.waking .lit{animation:ig 1.3s ease-out .45s both}",
  "html.waking .halo{animation:hl 1.4s ease-out .55s both,br 2.4s ease-in-out 1.95s infinite alternate}",
  "html.waking .sh{animation:sw .9s ease-in-out 1.05s both}",
  "html.waking .cp b{animation:up .6s ease-out 1.05s both}",
  "html.waking .cp span{animation:up .6s ease-out 1.2s both}",
  "@keyframes fi{to{opacity:1}}",
  "@keyframes em{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}",
  "@keyframes ig{0%{opacity:0}18%{opacity:.5}30%{opacity:.34}55%{opacity:.82}70%{opacity:.7}100%{opacity:1}}",
  "@keyframes hl{0%{opacity:0;transform:scale(.7)}60%{opacity:.85;transform:scale(1.05)}100%{opacity:.6;transform:none}}",
  "@keyframes br{from{opacity:.6}to{opacity:.4}}",
  "@keyframes sw{from{transform:translateX(-80px)}to{transform:translateX(520px)}}",
  "@keyframes up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}",
  "@media(prefers-reduced-motion:reduce){html.waking *{animation-duration:.01s!important;animation-delay:0s!important;animation-iteration-count:1!important}}",
].join("");

// Контуры знака — те же, что у заставки (`apps/web/src/features/onboarding/splash/star-glyph.js`).
const STAR_BODY =
  "M111 251C160 242 192 241 215 208C231 184 244 145 259 125C253 167 239 215 251 231C264 247 309 241 399 251C322 258 283 259 258 274C233 290 211 334 181 388C195 333 209 287 199 270C189 254 151 258 111 251Z";
const STAR_SWOOSH =
  "M231 371C230 326 242 291 274 275C304 260 344 257 399 263C347 266 310 273 283 288C256 303 238 333 231 371Z";

const STAR_SVG =
  '<svg class="st" viewBox="111 125 288 263" aria-hidden="true"><defs>' +
  `<path id="a" d="${STAR_BODY}"/><path id="b" d="${STAR_SWOOSH}"/>` +
  '<linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#c8c8ce"/><stop offset="1" stop-color="#fff"/></linearGradient>' +
  '<linearGradient id="s"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
  '<clipPath id="c"><use href="#a"/><use href="#b"/></clipPath></defs>' +
  '<g class="dim"><use href="#a"/><use href="#b"/></g>' +
  '<g class="lit" fill="url(#g)"><use href="#a"/><use href="#b"/></g>' +
  '<g clip-path="url(#c)"><g transform="rotate(18 255 256)"><rect class="sh" y="90" width="64" height="340" fill="url(#s)"/></g></g></svg>';

// Слова под знаком: заголовок и пояснение. Те же, что в словаре окна (`zone-port-launch-splash-1511.js`).
export const WAKE_CAPTIONS = {
  ru: ["Просыпаемся…", "Возвращаем всё, как было"],
  uk: ["Прокидаємося…", "Повертаємо все, як було"],
  en: ["Waking up…", "Putting everything back where you left it"],
  de: ["Astral wacht auf …", "Alles wird so wiederhergestellt, wie es war"],
  pl: ["Budzimy się…", "Przywracamy wszystko tak, jak było"],
  fr: ["Réveil en cours…", "Nous remettons tout comme avant"],
};

/** HTML страницы сна на языке окна (неизвестный язык — русский). */
export function wakePageHtml(language = "ru") {
  const lang = WAKE_CAPTIONS[language] ? language : "ru";
  const [title, detail] = WAKE_CAPTIONS[lang];
  return [
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Astral</title>`,
    `<style>${WAKE_STYLE}</style></head>`,
    '<body><div class="wake"><div class="fr"></div>',
    '<div class="ch"><i class="a"></i><i class="b"></i><div class="c"><b></b><b></b><b></b><b></b><b></b><b></b><b></b></div></div>',
    `<div class="core"><div class="hw"><div class="halo"></div></div>${STAR_SVG}</div>`,
    `<div class="cw"><div class="cp"><b>${title}</b><span>${detail}</span></div></div>`,
    "</div></body></html>",
  ].join("");
}
