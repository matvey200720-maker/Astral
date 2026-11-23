/*
 * Маршрут установки заменёнки по вещи-цели (14.11.2026, `docs/clothing/server-routes.md`).
 *
 * Маршрут берётся из самой цели (`target.server`), а не из вкладки окна: вещь знает, где лежит и кто её увидит.
 *
 *  • Штатная вещь игры (проекта нет) — замена на месте в паке игры, где вещь лежит: этот пак грузят и RAGE MP, и Majestic (если он в белом списке клиента).
 *    Так ставят заменёнки авторы (`update\x64\dlcpacks\<пак>`), одна установка видна обоим клиентам. Нет места в белом паке — вещь базовой игры, пак новее списка Majestic
 *    или без файлов — остаётся Astral Clothing DLC, и это сказано: Majestic его не монтирует, а клиент RAGE MP (GTA 5 RP) пакеты Astral не подключает вовсе — факт 18.11.2026 (журнал тестера beta.108 и владелец): заменёнка в `astral_clothing` видна в сюжетном режиме и не видна на сервере.
 *  • Majestic — вещь белого пака ставится на месте (как штатная); вещь серверного пака (`…_clothes_pack0..3`) — overlay в `patchday16ng` (гипотеза по файлу владельца).
 *  • GTA 5 RP и прочие проекты — Astral Clothing DLC под именем серверной коллекции: клиент RAGE MP пакеты Astral не подключает: на GTA 5 RP такая заменёнка не видна (факт 18.11.2026, прежнее «перекроют ли паки сервера — не проверено» снято).
 *    Вещь проекта, чьи файлы лежат и в играх (папка штатной коллекции), ставится как штатная — это та же вещь.
 *  • Цвет вещи (бронежилет: цель с `drawables[]` и `letter`) — то же правило, но по каждой модели кроя: цвет ложится на месте, когда у КАЖДОЙ модели есть место в одном белом паке игры
 *    и в нём есть файл этого цвета (одна запись `replace` на модель, одной транзакцией); иначе — Astral Clothing DLC, а на Majestic — отказ, и причина названа (находка 3 ревью, 14.11.2026).
 *
 * Чистый модуль: ни диска, ни игры. Место вещи в паке — из `deps` (`packPlace` с отказом словами, `gamePlace` без отказа).
 */

import { majesticPlaceProblem } from "@modovik/clothing/game-assortment";
import { majesticLoadsPack } from "@modovik/clothing/majestic-dlc";
import {
  MAJESTIC_OVERLAY_INNER,
  MAJESTIC_OVERLAY_PACK,
  majesticOverlayFolder,
} from "@modovik/clothing/majestic-dlc";

const SERVER_ID = /^[a-z0-9_-]{1,32}$/;

/** Проект вещи-цели: у цели с полем `server` — оно (пусто — штатная вещь), у цели без него — проект вкладки окна (старые окна, цвет бронежилета). */
export function serverOfTarget(target, fallback = "") {
  if (target && Object.hasOwn(target, "server"))
    return SERVER_ID.test(String(target.server || ""))
      ? String(target.server)
      : "";
  return SERVER_ID.test(String(fallback || "")) ? String(fallback) : "";
}

const refusal = (code, message) => Object.assign(new Error(message), { code });

export const missingPackPlace = async () => {
  throw refusal(
    "CLOTHING_REPLACE_MAJESTIC_PACK",
    "Не удалось найти вещь в файлах игры: замена на Majestic идёт в пак игры.",
  );
};

/*
 * Собственные коллекции проекта: файлов такой вещи в играх нет и быть не может (`…_mp_m_gta5rp_skins2`, `…_grpclothes`), оглавление игры ей не нужно — оно не читается вовсе
 * (находка 3б ревью 2, 14.11.2026: сбой чтения оглавления не должен бить по вещам GTA 5 RP, которым оно ни к чему). Вещь проекта в штатной папке (≈ 21 из 5187) оглавление читает, как штатная.
 */
const OWN_COLLECTION = { gta5rp: /_mp_[mf]_(?:gta5rp_|grpclothes)/ };
export const needsGameIndex = (target, server) =>
  !OWN_COLLECTION[server]?.test(String(target?.folder || ""));

/** Отказ чтения оглавления: слова — по коду в окне (`installFailure.js`), сырая ошибка — только в журнал. */
function indexFailure(error, target, deps) {
  if (/^CLOTHING_REPLACE_/.test(String(error?.code))) return error;
  const name = target?.name || target?.folder || "?";
  deps?.journal?.({
    level: "warn",
    message: `Замена: не удалось прочитать файлы игры для вещи «${name}»: ${String(error?.message || error).slice(0, 160)}`,
  });
  return Object.assign(
    refusal(
      "CLOTHING_REPLACE_INDEX_FAILED",
      `Не удалось прочитать файлы вашей игры, чтобы найти, где лежит вещь «${name}». Заменёнка не установлена — закройте игру и повторите.`,
    ),
    { cause: error },
  );
}

/**
 * Место вещи в файлах игры. `null` — вещи там нет (честный ответ читателя) или оглавление ей не нужно; сбой чтения (оглавление занято, нет ключей) и неполное оглавление
 * (`CLOTHING_REPLACE_INDEX_INCOMPLETE`) — отказ с причиной, а не тихое «вещи нет»: иначе вещь, лежащая в паке игры, молча уходила бы в Astral Clothing DLC под неверной причиной.
 */
export async function readGamePlace(deps, target, server) {
  if (!deps?.gamePlace || !needsGameIndex(target, server)) return null;
  try {
    return (await deps.gamePlace(target)) || null;
  } catch (error) {
    throw indexFailure(error, target, deps);
  }
}

/** Пак-виновник причины «later»: первая копия файлов вещи в паке, которого Majestic не грузит; `null` — такой копии нет (причина в форме вложенного архива копии). */
const laterBlockerOf = (place) =>
  (place?.laterCopies || []).find((copy) => !majesticLoadsPack(copy.pack))
    ?.pack || null;

/** Место в паке игры для Majestic: отказ словами остаётся как есть, сбой чтения — тот же отказ, что у остальных. */
async function readPackPlace(deps, target) {
  try {
    return await (deps.packPlace || missingPackPlace)(target);
  } catch (error) {
    throw indexFailure(error, target, deps);
  }
}

/* Файл цвета в текстурах вещи пака: `task_diff_001_a_uni.ytd` → буква «a». */
const COLOUR_LETTER = /_diff_[0-9]{3}_([a-z])(?:_[a-z]{3})?[.]ytd$/i;
const colourFile = (place, letter) =>
  (place?.textures || []).find(
    (name) => COLOUR_LETTER.exec(name)?.[1]?.toLowerCase() === letter,
  ) || null;

/** Запись в пак игры для цвета вещи: пак первой модели кроя и копии листа этой буквы у всех моделей, слитые по паку копии. */
const colourPackOf = (places, letter) => {
  const [first] = places;
  const merged = new Map();
  for (const place of places) {
    const file = colourFile(place, letter);
    for (const copy of packOf(place, file ? [file] : []).copies || []) {
      /* Слияние по паре (пак, вложенный архив): один пак держит копии и в двух архивах (мелочь 12 ревью). */
      const id = `${copy.pack}|${copy.inner}`;
      const have = merged.get(id) || {
        pack: copy.pack,
        inner: copy.inner,
        names: [],
      };
      have.names.push(...copy.names);
      merged.set(id, have);
    }
  }
  return {
    pack: first.pack,
    inner: first.inner,
    ...(merged.size ? { copies: [...merged.values()] } : {}),
  };
};

/*
 * Запись в пак игры: пак вещи, его вложенный архив и копии файлов вещи в паках, что грузятся позже (`@modovik/clothing/later-copies`: патч-паки). `names` копии — файлы вещи в её архиве;
 * без копий поле `copies` не пишется. `only` — оставить в копиях только эти файлы (цвет вещи: лист одной буквы).
 */
const packOf = (place, only = null) => {
  const copies = [];
  for (const copy of place?.laterCopies || []) {
    const names = only
      ? copy.names.filter((name) => only.includes(name))
      : [...copy.names];
    if (names.length)
      copies.push({ pack: copy.pack, inner: copy.inner, names });
  }
  return {
    pack: place.pack,
    inner: place.inner,
    ...(copies.length ? { copies } : {}),
  };
};

/**
 * Видимость заменёнки по клиентам: `yes` — архив грузит клиент (практика авторов), `unproven` — гипотеза, в игре не проверено, `no` — клиент архив не грузит.
 * @typedef {{ route: "pack"|"overlay"|"astral", server: string, pack: string|null, why: string|null, ragemp: "yes"|"unproven"|"no", majestic: "yes"|"unproven"|"no" }} ClothingRoute
 */

/**
 * Куда и как ставить заменёнку на вещь-цель.
 * @returns {Promise<{ summary: ClothingRoute, pack: {pack: string, inner: string, action?: string}|null, place: object|null }>} `pack` — запись в пак игры (`place` — файлы вещи в нём); `null` — Astral Clothing DLC.
 */
export async function routeOfTarget({ target, server = "", deps = {} }) {
  if (target?.colour) return routeOfColour({ target, server, deps });
  /* Majestic: серверная вещь — overlay в белом паке, вещь белого пака — на месте; прочее — отказ словами (`packPlace`). */
  if (server === "majestic") {
    if (majesticOverlayFolder(target?.folder)) {
      const pack = {
        pack: MAJESTIC_OVERLAY_PACK,
        inner: MAJESTIC_OVERLAY_INNER,
        action: "import",
      };
      return {
        summary: {
          route: "overlay",
          server,
          pack: pack.pack,
          why: null,
          ragemp: "no",
          majestic: "unproven",
        },
        pack,
        place: null,
      };
    }
    const place = await readPackPlace(deps, target);
    return {
      summary: {
        route: "pack",
        server,
        pack: place.pack,
        why: null,
        ragemp: "yes",
        majestic: "yes",
      },
      pack: packOf(place),
      place,
    };
  }
  /* Штатная вещь и вещь любого другого проекта: файлы вещи есть в паке игры — замена на месте; нет — Astral Clothing DLC. */
  const place = await readGamePlace(deps, target, server);
  if (place) {
    const problem = majesticPlaceProblem(place);
    if (!problem)
      return {
        summary: {
          route: "pack",
          server,
          pack: place.pack,
          why: null,
          ragemp: "yes",
          majestic: "yes",
        },
        pack: packOf(place),
        place,
      };
    /* Вещь в играх есть, но писать на месте нельзя: базовая игра (`base`), пак вне белого списка (`pack`) или нет файлов (`files`). */
    /* Причина «later»: пак с копией вне белого списка — в слова окна (`astral-later`, «{pack}»); остальные причины называют пак вещи. */
    const blocker = problem === "later" ? laterBlockerOf(place) : null;
    return {
      summary: {
        route: "astral",
        server,
        pack: blocker || place.pack || null,
        why: problem,
        ragemp: "unproven",
        majestic: "no",
      },
      pack: null,
      place: null,
      /* Место вещи в игре, уже прочитанное: писателям (`place`) оно не нужно, а покраске — ради доп. моделей цели, без второго чтения оглавления (ревью 15.11.2026, №13). */
      gamePlace: place,
    };
  }
  /* Вещи нет в файлах игры: у GTA 5 RP — вещь сервера, у штатной цели — вещь, которой игра игрока не знает. */
  return {
    summary: {
      route: "astral",
      server,
      pack: null,
      why: server ? "server" : "unknown",
      ragemp: "unproven",
      majestic: "no",
    },
    pack: null,
    place: null,
  };
}

/*
 * Цвет вещи (бронежилет): место — у каждой модели кроя. Majestic: `packPlace` отказывает словами, если у какой-то модели нет места в белом паке (база, чужой пак, нет файлов) —
 * Astral Clothing DLC клиент не берёт, ставить некуда. Остальные: нет места хотя бы у одной модели — Astral Clothing DLC с причиной (`base` / `pack` / `files` / `colour` / `split`
 * или «вещи нет» — `server` / `unknown`). `colourTextures` — имена файлов цвета в паке игры, по порядку `drawables`: под ними и пишется замена (раса — как у вещи в игре).
 * @returns {Promise<{ summary: ClothingRoute, pack: {pack: string, inner: string}|null, place: null, colourTextures?: string[] }>}
 */
async function routeOfColour({ target, server, deps }) {
  const drawables = target.drawables || [];
  const one = (drawable) => ({
    name: target.name,
    gender: target.gender,
    folder: target.folder,
    component: target.component,
    drawable,
  });
  const majestic = server === "majestic";
  const find = majestic
    ? (item) => readPackPlace(deps, item)
    : (item) => readGamePlace(deps, item, server);
  const places = [];
  if (find)
    for (const drawable of drawables) places.push(await find(one(drawable)));
  /* Пустой список моделей — места нет ни у одной: не «пак», а запасной маршрут (раньше `places[0]` падал TypeError). */
  const complete =
    drawables.length > 0 &&
    places.length === drawables.length &&
    places.every(Boolean);
  let why = complete ? null : server ? "server" : "unknown";
  if (complete) {
    why =
      places.map((place) => majesticPlaceProblem(place)).find(Boolean) || null;
    if (!why && places.some((place) => !colourFile(place, target.letter)))
      why = "colour";
    if (
      !why &&
      new Set(places.map((place) => `${place.pack}|${place.inner}`)).size > 1
    )
      why = "split";
  }
  if (!why) {
    const [first] = places;
    return {
      summary: {
        route: "pack",
        server,
        pack: first.pack,
        why: null,
        ragemp: "yes",
        majestic: "yes",
      },
      pack: colourPackOf(places, target.letter),
      place: null,
      colourTextures: places.map((place) => colourFile(place, target.letter)),
    };
  }
  const name = target.name || target.folder;
  if (majestic) {
    /* Слова — по причине: «нет такого цвета», «разные архивы», иначе (нет моделей, неизвестная причина) — общие, но верные. */
    const reasons = {
      colour: `У бронежилета «${name}» в паке игры нет такого цвета — заменять нечего.`,
      later: `Файлы цвета бронежилета «${name}» перекрыты копиями в паках игры, которые Majestic не грузит: цвет в паке вещи в игре не появился бы, а в Astral Clothing DLC Majestic не смотрит.`,
      order: `Не все файлы вашей игры удалось прочитать (не открылись: dlclist.xml): порядок паков неизвестен, а файлы бронежилёта «${name}» лежат в нескольких архивах. Astral не станет писать вслепую.`,
      split: `Бронежилет «${name}» лежит в нескольких архивах игры: цвет одной записью на месте не заменить, а в Astral Clothing DLC Majestic не смотрит.`,
    };
    throw refusal(
      "CLOTHING_REPLACE_MAJESTIC_PACK",
      reasons[why] ||
        `Для цвета бронежилета «${name}» нет места в паке игры, а в Astral Clothing DLC Majestic не смотрит.`,
    );
  }
  /* Причина «later»: слова называют пак-виновник — тот, что перекрывает файлы цвета, а не пак самой вещи (ревью 15.11, №8в). Как у вещи целиком (`routeOfTarget`). */
  const blocker =
    why === "later"
      ? places
          .map((place) =>
            majesticPlaceProblem(place) === "later"
              ? laterBlockerOf(place)
              : null,
          )
          .find(Boolean)
      : null;
  return {
    summary: {
      route: "astral",
      server,
      pack: blocker || (complete ? places[0].pack || null : null),
      why,
      ragemp: "unproven",
      majestic: "no",
    },
    pack: null,
    place: null,
  };
}
