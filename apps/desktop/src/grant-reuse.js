/*
 * Ссылки на пакеты каталога выдаются не чаще 30 в минуту на устройство, и сервер пишет строку на каждую (`catalog/grants.go`:
 * `downloadGrantRateLimit`, `CreateDownloadGrant`); живёт ссылка 5 минут. Мастерская одежды и студия ствола просят её на каждое
 * чтение вещи или скина каталога: модель, цветная модель, персонаж, плитки полки — и каждый запрос стоит круга до облака с
 * подписью DPoP, а полка с десятками вещей упиралась в предел («download grant rate exceeded»). Выданная ссылка остаётся
 * годной, пока у неё осталось больше `margin` (скачивание идёт по адресу пакета, подписанному манифестом, а не по токену),
 * поэтому её отдаём повторно, а одновременные запросы на один мод ждут один ответ (29.10.2026, Хелпер 15).
 */

/** Повторная выдача ссылок по ключу (id мода): `get(key, request)` — из памяти или `request()`, `clear()` — при выходе из аккаунта. */
export function createGrantReuse({ now = () => Date.now(), margin = 60_000, limit = 64 } = {}) {
  const kept = new Map();
  const flights = new Map();
  return {
    async get(key, request) {
      const hit = kept.get(key);
      if (hit && hit.until > now()) return hit.grant;
      kept.delete(key);
      if (flights.has(key)) return flights.get(key);
      const flight = (async () => {
        try {
          const grant = await request();
          /* Остаток срока, а не `expiresAt`: при сбитых часах компьютера иначе протухшая ссылка
             отдавалась бы часами, а свежая не запоминалась. */
          const until = Number.isFinite(grant?.validForMs)
            ? now() + grant.validForMs - margin
            : Date.parse(grant?.expiresAt) - margin;
          if (Number.isFinite(until) && until > now()) {
            kept.set(key, { grant, until });
            while (kept.size > limit) kept.delete(kept.keys().next().value);
          }
          return grant;
        } finally {
          flights.delete(key);
        }
      })();
      flights.set(key, flight);
      return flight;
    },
    clear() {
      kept.clear();
    },
    /** Сколько ссылок лежит в памяти (для проб). */
    get size() {
      return kept.size;
    },
  };
}
