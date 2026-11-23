// Страница, которую браузер видит после возврата входа на локальный адрес лаунчера.
// Самодостаточна: стили и знак внутри разметки, ни скриптов, ни внешних файлов.

const LANGUAGES = ["ru", "uk", "en", "de", "pl", "fr"];

// [заголовок, текст] для каждого исхода и языка; слова вставляются в разметку как есть.
const WORDS = {
  ru: {
    ok: ["Вход выполнен", "Можно закрыть эту вкладку и вернуться в Astral."],
    bad: ["Ссылка входа устарела", "Вернитесь в Astral и нажмите «Войти» ещё раз."],
    refused: ["Вход не получился", "Вернитесь в Astral — там написано, что случилось."],
  },
  uk: {
    ok: ["Вхід виконано", "Можна закрити цю вкладку й повернутися до Astral."],
    bad: ["Посилання для входу застаріло", "Поверніться до Astral і натисніть «Увійти» ще раз."],
    refused: ["Вхід не вдався", "Поверніться до Astral — там написано, що сталося."],
  },
  en: {
    ok: ["You're signed in", "You can close this tab and return to Astral."],
    bad: ["This sign-in link has expired", "Go back to Astral and press “Sign in” again."],
    refused: ["Sign-in didn't work out", "Go back to Astral — it says what happened."],
  },
  de: {
    ok: ["Du bist angemeldet", "Du kannst diesen Tab schließen und zu Astral zurückkehren."],
    bad: ["Dieser Anmeldelink ist abgelaufen", "Geh zurück zu Astral und drücke erneut „Anmelden“."],
    refused: ["Anmeldung fehlgeschlagen", "Geh zurück zu Astral — dort steht, was passiert ist."],
  },
  pl: {
    ok: ["Zalogowano", "Możesz zamknąć tę kartę i wrócić do Astral."],
    bad: ["Link logowania wygasł", "Wróć do Astral i naciśnij „Zaloguj się” jeszcze raz."],
    refused: ["Logowanie się nie udało", "Wróć do Astral — tam napisano, co się stało."],
  },
  fr: {
    ok: ["Connexion réussie", "Vous pouvez fermer cet onglet et retourner dans Astral."],
    bad: [
      "Le lien de connexion a expiré",
      "Retournez dans Astral et cliquez de nouveau sur « Se connecter ».",
    ],
    refused: ["La connexion n’a pas abouti", "Retournez dans Astral — ce qui s’est passé y est indiqué."],
  },
};

export const CALLBACK_PAGE_HEADERS = Object.freeze({
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
});

// Одна запись заголовка: код языка (до первого дефиса) и вес.
function parseRange(raw) {
  const [tag, ...params] = raw.trim().toLowerCase().split(";");
  const weightParam = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
  const weight = weightParam === undefined ? 1 : Number(weightParam.split("=")[1]);
  return { code: tag.split("-")[0], weight: Number.isFinite(weight) ? weight : 0 };
}

export function callbackLanguage(acceptLanguage = "") {
  const ranges = String(acceptLanguage)
    .split(",")
    .map(parseRange)
    .filter(({ code, weight }) => code !== "" && weight > 0);
  // сортировка устойчива: при равных весах остаётся порядок заголовка
  ranges.sort((a, b) => b.weight - a.weight);
  return ranges.find(({ code }) => LANGUAGES.includes(code))?.code ?? "ru";
}

const STYLE = `
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:grid;place-items:center;padding:16px;background:#050506;color:#f4f4f5;
font:13px/1.55 Inter,"Segoe UI",system-ui,-apple-system,sans-serif;overflow:hidden}
.sky{position:fixed;inset:0;pointer-events:none;
background:radial-gradient(60% 50% at 70% 20%,rgba(120,110,255,.10),transparent 70%),
radial-gradient(50% 45% at 20% 85%,rgba(90,160,255,.07),transparent 70%)}
.star{position:absolute;width:2px;height:2px;border-radius:50%;background:#fff;opacity:.15;
animation:twinkle var(--d) ease-in-out var(--w) infinite alternate}
.card{position:relative;width:min(420px,100%);padding:32px 30px 26px;border:1px solid rgba(255,255,255,.09);
border-radius:22px;background:rgba(16,16,18,.72);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
box-shadow:0 30px 90px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.04);text-align:center;
animation:rise .5s cubic-bezier(.22,.72,.24,1) both}
.orbit{position:relative;width:72px;height:72px;margin:0 auto 20px;border-radius:50%;
border:1.5px solid rgba(255,255,255,.22);display:grid;place-items:center;
animation:ring .9s cubic-bezier(.22,.72,.24,1) .15s both}
.orbit::after{content:"";position:absolute;inset:-7px;border-radius:50%;border:1px solid rgba(255,255,255,.07)}
.mark{width:56px;height:56px;color:#fff;filter:drop-shadow(0 0 12px rgba(255,255,255,.35));
animation:pop .7s cubic-bezier(.34,1.56,.64,1) .25s both}
.badge{position:absolute;right:-4px;bottom:-2px;width:24px;height:24px;border-radius:50%;
display:grid;place-items:center;border:2px solid #101012;animation:pop .6s cubic-bezier(.34,1.56,.64,1) .55s both}
.ok .badge{background:#4ade80}.bad .badge{background:#f87171}
.badge svg{width:12px;height:12px;color:#0b0b0c}
h1{margin:0 0 8px;font-size:20px;font-weight:600;letter-spacing:-.01em;\
animation:rise .5s cubic-bezier(.22,.72,.24,1) .3s both}
p{margin:0;color:#a1a1aa;animation:rise .5s cubic-bezier(.22,.72,.24,1) .38s both}
.foot{margin-top:24px;color:#5f5f66;font-size:11px;letter-spacing:.04em}
@keyframes rise{from{opacity:0;transform:translate3d(0,10px,0)}}
@keyframes pop{from{opacity:0;transform:scale(.6)}}
@keyframes ring{from{opacity:0;transform:scale(.85) rotate(-40deg)}}
@keyframes twinkle{to{opacity:.85}}
`;

const MARK_PATHS = [
  [
    "M111 251C160 242 192 241 215 208C231 184 244 145 259 125C253 167 239 215 251 231",
    "C264 247 309 241 399 251C322 258 283 259 258 274C233 290 211 334 181 388",
    "C195 333 209 287 199 270C189 254 151 258 111 251Z",
  ].join(""),
  "M231 371C230 326 242 291 274 275C304 260 344 257 399 263C347 266 310 273 283 288C256 303 238 333 231 371Z",
];
const MARK = `<svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><g fill="currentColor">${MARK_PATHS.map(
  (d) => `<path d="${d}"/>`,
).join("")}</g></svg>`;

const badgeIcon = (d, joint = "") =>
  `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor"` +
  ` stroke-width="2.2" stroke-linecap="round"${joint}/></svg>`;
const ICONS = {
  ok: badgeIcon("M3.5 8.5l3 3 6-7", ' stroke-linejoin="round"'),
  bad: badgeIcon("M5 5l6 6M11 5l-6 6"),
};

// Сорок звёзд: положение — дробные части арифметической последовательности с иррациональным шагом.
const star = (n) => {
  const left = (((0.5 + n * 0.7548776662466927) % 1) * 100).toFixed(2);
  const top = (((0.5 + n * 0.5698402909980532) % 1) * 100).toFixed(2);
  return `<i class="star" style="left:${left}%;top:${top}%;--d:${3 + (n % 5)}s;--w:${-((n * 7) % 9)}s"></i>`;
};
const SKY = Array.from({ length: 40 }, (_, index) => star(index + 1)).join("");

export function oauthCallbackPage({ ok, refused = false, language = "ru" }) {
  const lang = LANGUAGES.includes(language) ? language : "ru";
  const outcome = ok ? "ok" : refused ? "refused" : "bad";
  const [title, text] = WORDS[lang][outcome];
  const tone = ok ? "ok" : "bad";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>Astral — ${title}</title><style>${STYLE}</style></head>
<body><div class="sky" aria-hidden="true">${SKY}</div>
<main class="card ${tone}"><div class="orbit">${MARK}<span class="badge">${ICONS[tone]}</span></div>
<h1>${title}</h1><p>${text}</p><div class="foot">Astral</div></main></body></html>`;
}
