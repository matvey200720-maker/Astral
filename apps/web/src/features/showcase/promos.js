// Свои анонсы Astral на месте показа, пока для него нет оплаченного креатива.

const DAY_MS = 24 * 60 * 60 * 1000;
const HIDDEN_KEY = "astral.showcase.promo-hidden.v1";

// Сутки по UTC от начала эпохи.
const dayOf = (now) => Math.floor(now / DAY_MS);

// Хеш слота по знакам: код первой кодовой единицы каждого знака, по модулю 2^32.
const slotHash = (text) => [...text].reduce((hash, sign) => (Math.imul(hash, 31) + sign.charCodeAt(0)) >>> 0, 0);

const promoCopy = (language) => PROMO_COPY[language] || PROMO_COPY.en;

function promoFor(args) {
  const { place, available = {}, now = Date.now(), slot = place } = args;
  const pool = [];
  for (const id of PLACE_PROMOS[place] ?? []) {
    if (available[id]) pool.push(id);
  }
  return pool.length ? pool[(dayOf(now) + slotHash(String(slot))) % pool.length] : null;
}

function attempt(job, fallback) {
  try {
    return job();
  } catch {
    return fallback;
  }
}

// Хранилище: JSON-объект «место → срок»; нечитаемое и пустое даёт {}, запись не бросает.
const loadHidden = (storage) => attempt(() => JSON.parse(storage.getItem(HIDDEN_KEY)), null) || {};

const saveHidden = (storage, hidden) => attempt(() => storage.setItem(HIDDEN_KEY, JSON.stringify(hidden)));

function promoHidden(place, options = {}) {
  const { storage = globalThis.localStorage, now = Date.now() } = options;
  return (Number(loadHidden(storage)[place]) || 0) > now;
}

function hidePromoForDay(place, options = {}) {
  const { storage = globalThis.localStorage, now = Date.now() } = options;
  const hidden = loadHidden(storage);
  Object.keys(hidden)
    .filter((name) => Number(hidden[name]) <= now)
    .forEach((name) => delete hidden[name]);
  hidden[place] = now + DAY_MS;
  saveHidden(storage, hidden);
}

const PROMO_IDS = Object.freeze(["builds", "discord", "news"]);

// Кадры из каталога редуксов, по порядку анонсов.
const PROMO_SCENES = Object.freeze(
  Object.fromEntries(
    PROMO_IDS.map((id, at) => [id, `/media/showcase/${["sky-dawn", "lights-violet", "vegetation-lake"][at]}.webp`]),
  ),
);

// Порядок анонсов задаёт PROMO_IDS: на home нет news, на mod и builds нет builds.
const PLACE_PROMOS = {
  home: PROMO_IDS.slice(0, 2),
  feed: PROMO_IDS,
  mod: PROMO_IDS.slice(1),
  builds: PROMO_IDS.slice(1),
};

// язык → [заголовок и строка builds, заголовок и строка discord, заголовок news, «Открыть», «Скрыть»]
const COPY_ROWS = {
  ru: [
    "Собери сборку и поделись кодом",
    "Моды каталога и работы мастерской другу одним кодом.",
    "Сообщество Astral в Discord",
    "Новые моды, помощь с установкой и анонсы первыми.",
    "Новое в Astral",
    "Открыть",
    "Скрыть на сутки",
  ],
  en: [
    "Build a set and share its code",
    "Catalog mods and workshop works in one code for a friend.",
    "The Astral community on Discord",
    "New mods, install help and announcements first.",
    "What's new in Astral",
    "Open",
    "Hide for a day",
  ],
  uk: [
    "Збери збірку й поділись кодом",
    "Моди каталогу й роботи майстерні другові одним кодом.",
    "Спільнота Astral у Discord",
    "Нові моди, допомога з встановленням і анонси першими.",
    "Нове в Astral",
    "Відкрити",
    "Сховати на добу",
  ],
  de: [
    "Stell ein Set zusammen und teile den Code",
    "Katalog-Mods und Werkstatt-Arbeiten in einem Code für Freunde.",
    "Die Astral-Community auf Discord",
    "Neue Mods, Hilfe bei der Installation und News zuerst.",
    "Neu in Astral",
    "Öffnen",
    "Für einen Tag ausblenden",
  ],
  pl: [
    "Złóż zestaw i udostępnij kod",
    "Mody z katalogu i prace z warsztatu jednym kodem dla znajomego.",
    "Społeczność Astral na Discordzie",
    "Nowe mody, pomoc w instalacji i ogłoszenia jako pierwsi.",
    "Nowości w Astral",
    "Otwórz",
    "Ukryj na dobę",
  ],
  fr: [
    "Créez un build et partagez son code",
    "Les mods du catalogue et les travaux de l\u2019Atelier pour un ami, en un seul code.",
    "La communauté Astral sur Discord",
    "Nouveaux mods, aide à l\u2019installation et annonces en avant-première.",
    "Nouveautés d\u2019Astral",
    "Ouvrir",
    "Masquer pour 24 h",
  ],
};

const PROMO_COPY = Object.freeze(
  Object.fromEntries(
    Object.entries(COPY_ROWS).map(([language, [buildsTitle, buildsText, discordTitle, discordText, newsTitle, open, hide]]) => [
      language,
      {
        builds: { title: buildsTitle, text: buildsText },
        discord: { title: discordTitle, text: discordText },
        news: { title: newsTitle, text: "" },
        open,
        hide,
      },
    ]),
  ),
);

export { PROMO_COPY, PROMO_IDS, PROMO_SCENES, hidePromoForDay, promoCopy, promoFor, promoHidden };
