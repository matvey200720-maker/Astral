import { catalogDownloadCount } from "../../catalog-utils.js";
import { modCoverSha } from "../library/mod-picture.js";
import { postedTime } from "./recommend.js";

/*
 * Одинаковые арены в списке «Арены» (владелец 22.11.2026: «с аренами… зачисти вот эти всякие дубликаты, это не гуд»).
 *
 * Арены лежат в каталоге частями сборок редуксов, и одну и ту же арену несут сразу несколько сборок: у них одна обложка
 * (sha256 картинки совпадает байт в байт) и почти один пакет. На сервере такую часть не скрыть — скрытие части скрывает и
 * сборку, — поэтому окно показывает одну карточку на арену. Остальные, как у «Быстрого входа» (`catalog-page-mods.js`),
 * помечаются `catalogUnlisted`: в разделе, счётчике и «Всех» их нет, а внутри своей сборки они на месте, и страница
 * редукса с его составом не меняется. Поиск по названию скрытой части ведёт на её сборку, как у любой другой скрытой части.
 */

const ARENAS_SLOT = "arenas";

const slotOf = (mod) => String(mod.catalogSlot || mod.slot || "");

/* Без даты — позже любой датированной: раньше опубликованной считается та, у которой дата есть и она меньше. */
const postedOrder = (mod) => postedTime(mod) || Number.POSITIVE_INFINITY;

/* Какая из двух одинаковых карточек остаётся: больше скачиваний, при равенстве — раньше опубликованная, дальше по id (порядок не зависит от порядка ответа). */
function better(first, second) {
  const byDownloads = catalogDownloadCount(second) - catalogDownloadCount(first);
  if (byDownloads) return byDownloads > 0 ? second : first;
  const byDate = postedOrder(first) - postedOrder(second);
  if (byDate) return byDate > 0 ? second : first;
  return String(second.id) < String(first.id) ? second : first;
}

/**
 * Карточки арен, которых в каталоге быть не должно: у них та же обложка, что у другой карточки слота «Арены», а та лучше.
 * Запись без обложки не объединяется ни с чем. Другие слоты не затронуты.
 * @param {object[]} visible записи каталога, что видит человек (без служебных)
 * @returns {Set<string>} id скрываемых карточек
 */
export function arenaTwinsQuiet(visible) {
  const kept = new Map();
  const seen = [];
  for (const mod of visible) {
    if (slotOf(mod) !== ARENAS_SLOT) continue;
    const cover = modCoverSha(mod);
    if (!cover) continue;
    seen.push({ mod, cover });
    const prior = kept.get(cover);
    kept.set(cover, prior ? better(prior, mod) : mod);
  }
  const quiet = new Set();
  for (const { mod, cover } of seen) if (kept.get(cover) !== mod) quiet.add(mod.id);
  return quiet;
}
