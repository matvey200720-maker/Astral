/*
 * Штатные бороды GTA V — «Бороды игры» (Ц3в, решение общей ведущей 16.11.2026: модель бороды ложится плоским рисунком в лист выбранного номера).
 *
 * Бороды цирюльника — наложения головы, а не модели: данные в `common/data/effects/peds/facial_overlays.meta`, раздел `facialHair`, одни имена листов, без места, масштаба и цены. Номер штатной бороды в парикмахерской —
 * порядковый номер строки этого раздела; значение наложения у скрипта игры — `index` (0…28), в окне — `number` (1…29). Листы `mp_fm_faov_beard_NNN` лежат на развёртке кожи головы (UV0), как грим (`facial-overlays.js`).
 *
 * Hipster-бороды (10 строк `ng_Hip_faov_beard_000…009`) целями пока не показываются: в списке игры они зовутся `ng_Hip_…`, а файлы в `mphipster` — `mp_hip_faov_beard_…`; как игра их сопоставляет, не выяснено (`reason: "hipster-name"`).
 *
 * Чистый JS: работает в окне, в главном процессе и в тестах. Договор окна с Desktop — `NOTE-game-beards-api-1611.md`.
 */

/* Цвет листа на плитке по умолчанию: игра красит бороду палитрой волос; на плитке нужен спокойный тёплый коричневый, который читается на тёмном поле (прежний #3a2218 на кадре Electron 17.11.2026 тонул в нём). */
export const GAME_BEARD_TINT = "#a9774f";

/* Строки раздела с этим началом — из дополнения hipster. */
const HIPSTER_NAME = /^ng_hip_/i;

/* Причина, по которой номер не цель. */
export const GAME_BEARD_NOT_TARGET = Object.freeze({ hipster: "hipster-name" });

/*
 * Вид бороды по самому листу (16.11.2026, решение общей ведущей: чип «Бороды и усы игры», если среди штатных есть усы). Лист — RGBA 512×512 на развёртке головы; чем он закрашен, считалось по альфе
 * 19 основных листов игры (`mp_fm_faov_beard_000…018`, этот ПК, Legacy). Зоны листа: «над губой» — строки выше 275, пиксели в полосе ±50 от середины лица (x 259); «подбородок» — те же столбцы ниже 275;
 * «стороны» — всё правее и левее полосы (щёки, скулы, бакенбарды). Полоса и линия губ взяты по листам №9 (усы: закрашено строками 235–271) и №3 (подбородочный клочок начинается ниже 290).
 * Числа по строке: [закрашено, % листа; средняя альфа закрашенного; доля над губой; доля подбородка; доля сторон].
 */
export const BEARD_SHEET_STATS = Object.freeze({
  mp_fm_faov_beard_000: [7.06, 0.3, 0.09, 0.31, 0.61],
  mp_fm_faov_beard_001: [1.23, 0.59, 0.3, 0.69, 0.02],
  mp_fm_faov_beard_002: [2.06, 0.69, 0.25, 0.72, 0.03],
  mp_fm_faov_beard_003: [1.28, 0.76, 0.33, 0.67, 0],
  mp_fm_faov_beard_004: [0.56, 0.66, 0, 1, 0],
  mp_fm_faov_beard_005: [3.69, 0.56, 0.05, 0.55, 0.4],
  mp_fm_faov_beard_006: [1.27, 0.62, 0, 0.31, 0.69],
  mp_fm_faov_beard_007: [5.45, 0.55, 0.05, 0.26, 0.7],
  mp_fm_faov_beard_008: [0.91, 0.61, 0.66, 0.34, 0],
  mp_fm_faov_beard_009: [0.42, 0.72, 1, 0, 0],
  mp_fm_faov_beard_010: [8.66, 0.66, 0.08, 0.21, 0.71],
  mp_fm_faov_beard_011: [7.98, 0.5, 0.09, 0.34, 0.57],
  mp_fm_faov_beard_012: [1.33, 0.6, 0.23, 0.77, 0],
  mp_fm_faov_beard_013: [4.45, 0.34, 0.13, 0.28, 0.58],
  mp_fm_faov_beard_014: [5.13, 0.56, 0.04, 0.23, 0.73],
  mp_fm_faov_beard_015: [1.74, 0.55, 0.13, 0.23, 0.63],
  mp_fm_faov_beard_016: [2.19, 0.59, 0.13, 0.59, 0.28],
  mp_fm_faov_beard_017: [2.83, 0.31, 0, 0, 1],
  mp_fm_faov_beard_018: [11.96, 0.66, 0.07, 0.25, 0.68],
});

/**
 * Вид бороды по долям листа: `moustache` — почти всё над губой и ничего по сторонам (одни усы); `stubble` — редкая широкая щетина (закрашено ≥ 4 % листа при средней альфе ≤ 0,5); остальное — `beard`
 * (подбородок, щёки, бакенбарды, линии по челюсти, усы с клочком под губой). Правило считает по числам таблицы, правится в одном месте.
 */
export function classifyBeardSheet([coverage, meanAlpha, above, , sides]) {
  if (above >= 0.85 && sides <= 0.1) return "moustache";
  if (meanAlpha <= 0.5 && coverage >= 4) return "stubble";
  return "beard";
}

/* Спорные номера: числа на границе правила или форма, которую правило читает иначе, чем глаз. №5 — мягкий «пух» усов и подбородка (по форме борода, по густоте близко к щетине); №8 — усы с короткой полоской под губой (над губой 0,66);
   №11 — средняя альфа ровно на границе щетины (0,50); №13 — тонкий серый контур «подковой» (по форме борода, по густоте щетина); №17 — только бакенбарды на скулах, без усов и подбородка. */
export const DISPUTED_BEARD_SHEETS = Object.freeze(["mp_fm_faov_beard_005", "mp_fm_faov_beard_008", "mp_fm_faov_beard_011", "mp_fm_faov_beard_013", "mp_fm_faov_beard_017"]);

/** Имена листов раздела `facialHair` в порядке файла (строчными, без повторов). Нет раздела — пусто. */
export function parseFacialHair(text) {
  const clean = String(text || "").replace(/<!--[\s\S]*?-->/g, "");
  const block = /<facialHair>([\s\S]*?)<\/facialHair>/i.exec(clean)?.[1] || "";
  const seen = new Set();
  const names = [];
  for (const [, raw] of block.matchAll(/<item>\s*([^<]*?)\s*<\/item>/gi)) {
    const name = raw.toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** Подпись бороды: «Борода игры №6». `translate` — словарь окна; подписи цирюльника в файлах игры нет. */
export const gameBeardTitle = (number, translate = (text) => text) => `${translate("Борода игры")} №${number}`;

/** Ключ бороды в окне: как у грима, `facial_overlays:<имя листа>`. */
export const gameBeardKey = (name) => `facial_overlays:${String(name || "").toLowerCase()}`;

/**
 * Записи бород по именам раздела: `{ key, index, number, name, family, title, target, reason }`. Порядок — как в файле игры; `index` — номер строки с нуля.
 * Игра без части строк (другое число бород) — столько, сколько есть.
 */
export function gameBeardEntries(names, translate) {
  return (names || []).map((name, index) => {
    const hipster = HIPSTER_NAME.test(name);
    return {
      key: gameBeardKey(name),
      index,
      number: index + 1,
      name,
      family: hipster ? "hipster" : "base",
      title: gameBeardTitle(index + 1, translate),
      target: !hipster,
      reason: hipster ? GAME_BEARD_NOT_TARGET.hipster : "",
      /* Вид по листу: `moustache` | `beard` | `stubble`; пусто — лист не размечен (hipster, новый номер новой игры). `shapeDisputed` — спорный номер, правило и глаз расходятся. */
      shape: BEARD_SHEET_STATS[name] ? classifyBeardSheet(BEARD_SHEET_STATS[name]) : "",
      shapeDisputed: DISPUTED_BEARD_SHEETS.includes(name),
    };
  });
}
