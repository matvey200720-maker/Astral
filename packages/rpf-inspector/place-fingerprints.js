/*
 * Опознание мест по отпечаткам (план Б, 24.10.2026): какая это арена, какой ангар, банкоматы, ганшоп, будки,
 * остановки — по файлам, а не по умолчанию.
 *
 * Раньше сервер арены решал первый подходящий префикс, а «по умолчанию» дорисовывало остальное: квартал `sp1_10_*`
 * у GTA 5 RP и Majestic один и тот же, но имя `sp1_10_stadium` отдавало арену GTA 5 RP, а слово «GTA 5 RP» в посте
 * ставило платформу карточки. Новая арена со своими моделями становилась «арены GTA 5 RP» без единой проверки.
 *
 * Здесь место опознаётся только сравнением набора файлов с отпечатками мастерской (`place-fingerprints-data.js`,
 * её генерирует `scripts/build-place-fingerprints.mjs` из описей редакторов):
 *
 *   • имя файла сводится к основе — без пути, расширения и суффикса подробной версии (`+hi`, `+hidr`, `+hifr`);
 *   • у арен сравниваются только собственные имена (квартал, зал, словари); имя, которое есть у обеих арен
 *     (`sp1_10_*`), ничего не доказывает и весит ноль: сервер доказывают совпадения, которых у другой арены нет;
 *   • сервер доказан, когда своих совпадений не меньше пяти и не меньше чем втрое больше, чем у другой арены;
 *   • одни общие имена — «арена не доказана»: файлы квартала годятся обоим серверам, платформа — обе;
 *   • имена арены, каких нет ни в одной известной (`xs_arena_*`, свой зал), — «новая арена, на проверку»: ни
 *     «GTA 5 RP», ни «Majestic» ей не ставится;
 *   • координаты (если разбор их дал) — вторая проверка: расставлено далеко от арены — это не арена, а чужая карта.
 *
 * Модуль без импортов Node — его читают и разбор, и окно (`apps/web`, «Редактировать»).
 */

import { ARENA_STOCK_NAMES } from "./arena-stock-names.js";
import { PLACE_FINGERPRINTS } from "./place-fingerprints-data.js";

/** Основа имени файла: без пути, расширения и суффикса подробной версии. */
export function stemOf(name) {
  return String(name || "")
    .toLowerCase()
    .split(/[\\/]/)
    .pop()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .replace(/\+(hi|hidr|hifr)$/, "");
}

/* Эталоны по видам: основы имён и опорная точка. */
const REFERENCES = Object.freeze(
  Object.fromEntries(
    Object.entries(PLACE_FINGERPRINTS).map(([kind, refs]) => [
      kind,
      Object.freeze(
        Object.entries(refs).map(([id, ref]) =>
          Object.freeze({
            id,
            label: ref.label,
            stems: new Set(ref.names.map(stemOf)),
            centre: ref.centre || null,
            radius: ref.radius || 0,
          }),
        ),
      ),
    ]),
  ),
);

/** Виды мест, которые знает таблица. */
export const PLACE_KINDS = Object.freeze(Object.keys(REFERENCES));

/*
 * Штатные имена квартала и зала арены из самой игры (237 имён, снято с индекса игры; ветка Хелпера 3 `h3-planb-spare`):
 * файл `sp1_10_*` / `v_62_*` / `xs_arena_*`, которого здесь нет, — добавлен автором, как бы он ни назывался.
 */
const STOCK = new Set([...ARENA_STOCK_NAMES].map(stemOf));

/**
 * Сколько совпадений доказывает место (арены — своих, остальных — любых). Арена: `share` — доля файлов арены в
 * наборе (по имени), ниже которой набор больше `small` файлов — не арена (2125 текстур, 14 из них арена Arena War, —
 * общий пакет текстур, а не «арена, сервер не доказан»); `foreignShare` — доля моделей арены вне штатных, с которой
 * арена автора считается новой, даже если в ней есть и штатный зал.
 */
export const ENOUGH = Object.freeze({
  arena: Object.freeze({ own: 5, dominance: 3, shared: 3, fresh: 3, share: 0.05, small: 12, foreignShare: 0.25 }),
  hangar: Object.freeze({ hits: 3 }),
  atm: Object.freeze({ hits: 2 }),
  busstop: Object.freeze({ hits: 2 }),
  booth: Object.freeze({ hits: 1 }),
  gunshop: Object.freeze({ hits: 2 }),
});

/*
 * Имена, которые сервер даёт арене по соглашению: зал GTA 5 RP — `v_62_*` (штатный зал Rockstar), Majestic —
 * `mj_ma_*`, `mj_gun_*`, `mazearena*`. Они свои у сервера, даже когда их нет в описи мастерской: мод правит файл
 * арены, а не выдумывает чужой префикс. Квартал `sp1_10*` — общий у обоих (`QUARTER`), по нему сервер не доказать.
 */
const QUARTER = /^sp1_10/;
/** Имена, что сервер выдумал сам: чужими для арены они не бывают (штатных у игры для них нет). */
const SERVER_NAMES = /^(mj_ma_|mj_gun_|mazearena)/;
/* Зал GTA 5 RP — штатный `v_62_*` из игры: доказывает сервер только имя, которое есть в игре; `v_62_*`, которого в игре нет,
   — модель автора (она не доказывает сервер, а считается своей моделью арены). */
const OWN_NAME = Object.freeze({
  gta5rp: (stem) => /^v_62_/.test(stem) && STOCK.has(stem),
  majestic: (stem) => SERVER_NAMES.test(stem),
});

/*
 * Ядро сервера — то, что доказывает арену без «пяти своих файлов» (26.10, арены автора): у Blink x Skye звезда — отдельный контейнер
 * `animhate.rpf` из пяти файлов (`hatemod.ydr`, клип, карта, `v_int_62.ytyp`), у de_por_vida — три `mj_ma_int*_shell.ydr`. Тип интерьера
 * `v_int_62.ytyp` есть только у арены GTA 5 RP, `mj_ma_*` — только у арены Majestic: другого сервера у этих файлов не бывает.
 */
const GTA5RP_INTERIOR_TYPE = /(^|[\\/])v_int_62\.ytyp$/i;
const MAJESTIC_CORE = /^mj_ma_/;

/**
 * Имя «арены вообще» (своя арена автора): в имени слово arena или имя из собственных имён известных арен и Arena War.
 * У Majestic арене принадлежат только `mj_ma_*` (зал) и `mj_gun_*` (оружейная зона зала). Остальное `mj_*` — чужой маппинг сервера:
 * `mj_leo_*` — магазин Leopold (valorant v3, `opt3.rpf`: сумки, лампы, касса), его раньше принимали за «Арену · Вариант 2» (10.11.2026).
 */
const ARENA_LIKE = /(^|_)arena|^(sp1_10|v_62_|mj_ma_|mj_gun_|mazearena|xs_arena|xs_int_arena)/;
const MODEL_FILE = /\.(ydr|yft|ydd)$/i;

const inside = (point, reference) =>
  reference.centre && Math.hypot(point[0] - reference.centre[0], point[1] - reference.centre[1]) <= reference.radius * 1.2;

const plural = (n, one, few, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};
const files = (n) => `${n} ${plural(n, "файл", "файла", "файлов")}`;

/** Доля координат `positions` внутри хотя бы одного эталона вида; `null` — координат нет. */
function placement(kind, positions) {
  const points = (positions || []).filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (!points.length) return null;
  const refs = REFERENCES[kind].filter((reference) => reference.centre);
  if (!refs.length) return null;
  const near = points.filter((point) => refs.some((reference) => inside(point, reference))).length;
  return { points: points.length, near, share: near / points.length };
}

function arenaVerdict(names, positions) {
  const [first, second] = REFERENCES.arena;
  const stems = [...new Set(names.map(stemOf))];
  const shared = new Set(first.stems);
  for (const stem of [...first.stems]) if (!second.stems.has(stem)) shared.delete(stem);
  /* Своё у сервера: из описи мастерской, чего нет у другого, и по соглашению об именах. */
  const unique = new Map(
    REFERENCES.arena.map((reference) => [
      reference.id,
      stems.filter(
        (stem) =>
          !QUARTER.test(stem) && !shared.has(stem) && (reference.stems.has(stem) || OWN_NAME[reference.id]?.(stem)),
      ),
    ]),
  );
  const sharedHits = stems.filter((stem) => shared.has(stem) || QUARTER.test(stem));
  const known = new Set(REFERENCES.arena.flatMap((reference) => [...reference.stems]));
  const isKnown = (stem) => known.has(stem) || STOCK.has(stem) || SERVER_NAMES.test(stem);
  /* Модели арены, которых нет ни в одной известной: свой зал автора. */
  const arenaModels = names.filter((name) => MODEL_FILE.test(name) && ARENA_LIKE.test(stemOf(name)));
  const strangers = [...new Set(arenaModels.map(stemOf))].filter((stem) => !isKnown(stem));
  /* Доля арены в наборе: 14 файлов арены среди 2125 — общий пакет текстур, а не арена. */
  const arenaLike = stems.filter((stem) => ARENA_LIKE.test(stem));
  const coverage = stems.length ? arenaLike.length / stems.length : 0;
  const sparse = stems.length > ENOUGH.arena.small && coverage < ENOUGH.arena.share;
  /* Автор добавил в арену много своих моделей (больше четверти): арена своя, даже если штатный зал на месте. */
  const arenaModelStems = new Set(arenaModels.map(stemOf));
  const foreignDominates = strangers.length >= ENOUGH.arena.fresh && strangers.length >= arenaModelStems.size * ENOUGH.arena.foreignShare;
  const where = placement("arena", positions);
  const scores = Object.fromEntries(REFERENCES.arena.map((reference) => [reference.id, { unique: unique.get(reference.id).length }]));

  /* Ядро сервера в наборе, где арена не капля (большой пакет с одним `v_int_62.ytyp` — не арена). */
  const core = {
    gta5rp: !sparse && names.some((name) => GTA5RP_INTERIOR_TYPE.test(name)),
    majestic: !sparse && stems.some((stem) => MAJESTIC_CORE.test(stem)),
  };
  const proven = (reference) => unique.get(reference.id).length >= ENOUGH.arena.own || Boolean(core[reference.id]);
  const best = REFERENCES.arena
    .map((reference) => ({ reference, own: unique.get(reference.id).length, proven: proven(reference) }))
    .sort((left, right) => Number(right.proven) - Number(left.proven) || right.own - left.own)[0];
  const other = REFERENCES.arena.find((reference) => reference.id !== best.reference.id);
  const rivals = unique.get(other.id).length;

  /* Расставлено не там, где арена: чужая карта, а не арена (если разбор дал координаты). */
  const elsewhere = where && where.share < 0.5 && (best.own >= ENOUGH.arena.own || sharedHits.length >= ENOUGH.arena.shared || strangers.length);

  /* Обе арены доказаны в одном наборе: это не одна из них, а две — их разделяет контейнер (`classifyWorld`). */
  if (best.proven && proven(other))
    return {
      status: "unproven",
      mixed: true,
      matched: best.own + rivals,
      unique: best.own,
      shared: sharedHits.length,
      strangers: strangers.length,
      scores,
      evidence: `в наборе обе арены — ${best.reference.label} (${best.own}) и ${other.label} (${rivals}): разделите по контейнерам`,
    };

  /* Ядро сервера доказывает арену и без перевеса в числе файлов: другой сервер при этом не доказан (иначе выше — «две арены»). */
  const dominant = best.own >= ENOUGH.arena.dominance * Math.max(rivals, 1) || (core[best.reference.id] && !proven(other));
  const coreWords = best.reference.id === "gta5rp" ? "тип интерьера арены v_int_62.ytyp" : "файлы mj_ma_* — зал только этого сервера";
  const knownEvidence = [
    best.own ? `${files(best.own)} её зала и словарей, которых нет у другой арены` : "",
    core[best.reference.id] && best.own < ENOUGH.arena.own ? coreWords : "",
  ]
    .filter(Boolean)
    .join("; ");
  if (best.proven && dominant && !elsewhere && !foreignDominates)
    return {
      status: "known",
      id: best.reference.id,
      server: best.reference.id,
      label: best.reference.label,
      matched: Math.max(best.own, 1),
      unique: best.own,
      shared: sharedHits.length,
      strangers: strangers.length,
      scores,
      evidence: `арена ${best.reference.label}: ${knownEvidence}${rivals ? ` (у другой — ${rivals})` : ""}${strangers.length ? `; ещё ${files(strangers.length)} арены, которых нет в известных` : ""}`,
    };

  if ((strangers.length >= ENOUGH.arena.fresh && !sparse) || (elsewhere && (sharedHits.length || strangers.length)))
    return {
      status: "new",
      matched: 0,
      unique: 0,
      shared: sharedHits.length,
      strangers: strangers.length,
      scores,
      evidence: elsewhere
        ? `новая арена: ${where.points - where.near} из ${where.points} расстановок лежат вне Maze Bank Arena — на проверку`
        : `новая арена: ${files(strangers.length)} арены (${strangers.slice(0, 3).join(", ")}${strangers.length > 3 ? "…" : ""}) не из известных арен GTA 5 RP и Majestic — на проверку`,
    };

  if ((sharedHits.length >= ENOUGH.arena.shared || best.own > 0) && !sparse)
    return {
      status: "unproven",
      matched: sharedHits.length + best.own,
      unique: best.own,
      shared: sharedHits.length,
      strangers: strangers.length,
      scores,
      evidence: `арена, сервер не доказан: ${files(sharedHits.length)} квартала арены общие у GTA 5 RP и Majestic${best.own ? `, своих — только ${best.own}` : ""}`,
    };

  /* Арены в большом наборе капля: пакет текстур или карты, а не арена — место не называется. */
  if (sparse && (arenaLike.length || best.own))
    return {
      status: "none",
      sparse: true,
      matched: 0,
      unique: 0,
      shared: 0,
      strangers: 0,
      coverage,
      scores,
      evidence: `арены в наборе ${arenaLike.length} из ${stems.length} файлов — это не арена`,
    };
  return { status: "none", matched: 0, unique: 0, shared: 0, strangers: 0, scores, evidence: "" };
}

function singleVerdict(kind, names) {
  const [reference] = REFERENCES[kind];
  const stems = [...new Set(names.map(stemOf))];
  const hits = stems.filter((stem) => reference.stems.has(stem));
  const enough = ENOUGH[kind].hits;
  if (hits.length >= enough)
    return {
      status: "known",
      id: reference.id,
      label: reference.label,
      matched: hits.length,
      unique: hits.length,
      shared: 0,
      strangers: 0,
      scores: { [reference.id]: { unique: hits.length } },
      evidence: `${reference.label.toLowerCase()}: ${hits.length} из ${reference.stems.size} моделей и словарей мастерской (${hits.slice(0, 3).join(", ")}${hits.length > 3 ? "…" : ""})`,
    };
  return { status: "none", matched: hits.length, unique: 0, shared: 0, strangers: 0, scores: { [reference.id]: { unique: hits.length } }, evidence: "" };
}

/**
 * Опознание места вида `kind` (`PLACE_KINDS`) по именам файлов.
 *
 * @param {string} kind
 * @param {{ names?: string[], positions?: number[][] }} [input] — `names`: имена файлов (путь и регистр не важны);
 *   `positions`: координаты расстановки `[x, y, z]`, если разбор их прочитал
 * @returns {{ kind: string, status: "known"|"unproven"|"new"|"none", id?: string, server?: string, label?: string,
 *   matched: number, unique: number, shared: number, strangers: number, evidence: string, scores: object }}
 */
export function identifyPlace(kind, { names = [], positions = [] } = {}) {
  if (!REFERENCES[kind]) return { kind, status: "none", matched: 0, unique: 0, shared: 0, strangers: 0, scores: {}, evidence: "" };
  const result = kind === "arena" ? arenaVerdict(names, positions) : singleVerdict(kind, names);
  return { kind, ...result };
}

/** Все места, что опознаны в наборе файлов: известные — по числу совпадений, потом новые и недоказанные. */
export function identifyPlaces(input = {}) {
  const order = { known: 0, new: 1, unproven: 2 };
  return PLACE_KINDS.map((kind) => identifyPlace(kind, input))
    .filter((result) => result.status !== "none")
    .sort((left, right) => order[left.status] - order[right.status] || right.matched - left.matched);
}

/**
 * Какая арена: сервер, если доказан файлами, иначе пусто. Для обложки и «Редактировать»: сцена мастерской берётся
 * только у доказанного сервера, «по умолчанию» её нет.
 *
 * Мягче `identifyPlace`: правка одного-двух файлов арены (один `v_62_*`, один `mj_ma_*`) сервер называет, если у
 * другого сервера своих файлов нет совсем и в наборе нет чужих арен. Общий квартал, свои модели автора и две арены сразу
 * сервера не дают.
 */
export const arenaServerOf = (names = [], positions = []) => {
  const result = identifyPlace("arena", { names, positions });
  if (result.status === "known") return result.server;
  if (result.status !== "unproven" || result.mixed || result.strangers) return "";
  const own = Object.entries(result.scores).filter(([, score]) => score.unique > 0);
  return own.length === 1 ? own[0][0] : "";
};

/*
 * Чей файл в наборе арены (26.10.2026): «арены в одном контейнере» (vendetta_v1: 122 файла Majestic и 50 GTA 5 RP) делятся по файлам, а
 * файлы арены в чужом контейнере («оптимизация» автора, 314/prop.rpf) берутся поштучно.
 *   • "gta5rp" / "majestic" — своё у сервера (зал `v_62_*`, тип `v_int_62`, `mj_*`, `mazearena*`, свои файлы из описей мастерской);
 *   • "shared" — общий квартал `sp1_10*` и штатные файлы арены: годятся обоим серверам;
 *   • "" — не арена (чужой файл, карта травы квартала `sp1_10_grass_0.ymap` — это «без травы», а не чаша).
 */
const ARENA_SHARED = (() => {
  const [first, second] = REFERENCES.arena;
  return new Set([...first.stems].filter((stem) => second.stems.has(stem)));
})();

export function arenaFileOwner(name) {
  /* `hi@` — подробная коллизия (`hi@v_stadium.ybn`): чья она, того и файл. */
  const stem = stemOf(String(name || "").replace(/(^|[\\/])hi@/i, "$1"));
  if (!stem || /_grass_\d+$/.test(stem)) return "";
  const [first, second] = REFERENCES.arena;
  /* Квартал `sp1_10*` у обоих серверов один (в описях он неполный у каждого — по описи сервер им не доказать). */
  if (QUARTER.test(stem)) return "shared";
  if (SERVER_NAMES.test(stem) || (second.stems.has(stem) && !ARENA_SHARED.has(stem))) return "majestic";
  if (/^v_(62_|int_62$|stadium$)/.test(stem) || (first.stems.has(stem) && !ARENA_SHARED.has(stem))) return "gta5rp";
  if (QUARTER.test(stem) || ARENA_SHARED.has(stem) || STOCK.has(stem) || ARENA_LIKE.test(stem)) return "shared";
  return "";
}
