/*
 * Журнал значков на этом компьютере: когда окно впервые увидело значок
 * полученным и какие из них человек уже смотрел.
 *
 * Сервер значков окну не присылает, поэтому «новый» — это значок, который
 * окно застало полученным уже после первого раза, когда считало значки, и
 * который человек ещё не открывал во вкладке «Значки». Первый подсчёт ничего
 * не объявляет новым: у давнего игрока набор получен давно, а не сегодня.
 * Даты получения журнал не хранит и не показывает: окно знает только, когда
 * увидело значок, а не когда человек его заслужил.
 */
const KEY = "astral.profile.badges.v1";
const LIMIT = 64;

const empty = () => ({ earned: {}, seen: [] });

function read(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const earned =
      parsed.earned &&
      typeof parsed.earned === "object" &&
      !Array.isArray(parsed.earned)
        ? parsed.earned
        : {};
    const seen = Array.isArray(parsed.seen)
      ? parsed.seen.filter((id) => typeof id === "string")
      : [];
    return { earned, seen };
  } catch {
    return null;
  }
}

function write(storage, ledger) {
  try {
    storage?.setItem(
      KEY,
      JSON.stringify({
        earned: ledger.earned,
        seen: ledger.seen.slice(-LIMIT),
      }),
    );
  } catch {
    /* хранилище закрыто — значки остаются без памяти о «новых» */
  }
}

/**
 * Сверить журнал с тем, что получено сейчас.
 * @returns {{ ledger: { earned: Record<string, number>, seen: string[] }, fresh: string[] }}
 *   `fresh` — получено с прошлого подсчёта (для всплывашки); первый подсчёт даёт пустой список.
 */
export function syncLedger(
  earnedIds,
  { now = Date.now(), storage = globalThis.localStorage } = {},
) {
  const known = read(storage);
  if (!known) {
    const first = {
      earned: Object.fromEntries(earnedIds.map((id) => [id, 0])),
      seen: [...earnedIds],
    };
    write(storage, first);
    return { ledger: first, fresh: [] };
  }
  const fresh = earnedIds.filter((id) => !(id in known.earned));
  if (!fresh.length) return { ledger: known, fresh };
  const ledger = {
    earned: {
      ...known.earned,
      ...Object.fromEntries(fresh.map((id) => [id, now])),
    },
    seen: known.seen,
  };
  write(storage, ledger);
  return { ledger, fresh };
}

/** Получены, но ещё не открыты во вкладке «Значки». */
export const unseenIds = (ledger, earnedIds) =>
  earnedIds.filter((id) => !ledger.seen.includes(id));

export function markSeen(ids, { storage = globalThis.localStorage } = {}) {
  const known = read(storage) || empty();
  const seen = [...new Set([...known.seen, ...ids])];
  if (seen.length === known.seen.length) return known;
  const ledger = { earned: known.earned, seen };
  write(storage, ledger);
  return ledger;
}

/** Получены, от недавних к давним (при равенстве — в порядке набора). */
export const recentIds = (ledger, earnedIds) =>
  earnedIds
    .map((id, order) => ({ id, order, at: Number(ledger.earned[id]) || 0 }))
    .sort((a, b) => b.at - a.at || a.order - b.order)
    .map((item) => item.id);
