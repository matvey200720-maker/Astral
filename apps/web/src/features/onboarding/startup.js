// Старт окна: четыре ответа собираются так, чтобы ни один отказ не ронял вход
// (жалоба co-founder 25.09.2026: после перезапуска API вошедший видел «С возвращением»).
export const STARTUP_RETRIES = Object.freeze([700, 2000, 4000]);
export const CATALOG_BUDGET_MS = 3500;

// Каталог не держит вход, поэтому ему даны паузы подлиннее.
const CATALOG_RETRIES = [700, 2000, 4000, 8000, 15000];
// Итог каталога, который не успел: ни ответа, ни отказа.
const MISSED = {};

// Каждый раз новый объект: окно дописывает в каталог свои моды.
const emptyCatalog = () => ({ mods: [], platforms: [], categories: [] });

function pause(ms) {
  return new Promise((go) => {
    setTimeout(go, ms);
  });
}

// Итог запроса: { v } с ответом или { e, x } с причиной отказа.
const settle = (p) => Promise.resolve(p).then((v) => ({ v }), (e) => ({ e, x: 1 }));

export async function withRetries(request, delays = STARTUP_RETRIES, wait = pause) {
  const last = delays.length;
  // После отказа n-й попытки: пауза и следующая попытка, а после последней — тот же отказ.
  const retry = (n, failure) =>
    n < last
      ? Promise.resolve(wait(delays[n])).then(() => attempt(n + 1))
      : Promise.reject(failure);
  // Синхронный throw из request обрабатывается сразу, в том же такте (пауза вызывается до
  // возврата управления вызывающему); отказ обещания — позже, как и ожидание await.
  function attempt(n) {
    let pending;
    try {
      pending = request();
    } catch (failure) {
      return retry(n, failure);
    }
    return Promise.resolve(pending).catch((failure) => retry(n, failure));
  }
  return attempt(0);
}

// Каталог «не успел»: вышел бюджет (сеть теряет пакеты молча) или выполнился
// catalogShown (Т-27: первые страницы уже на экране). Выполненный catalogShown
// обгоняет даже мгновенный каталог на один такт микрозадач.
function cutoff(first, ms, shown) {
  const early = shown?.then(() => MISSED);
  let timer;
  const rung = new Promise((resolve) => (timer = setTimeout(resolve, ms, MISSED)));
  const stop = () => clearTimeout(timer);
  return Promise.race([settle(first), rung, early].filter(Boolean)).finally(stop);
}

// Номера четырёх запросов в порядке лучей знака заставки «Контур» (`splash/`): `opts.onStage(номер)` зовётся, когда запрос
// закрылся — ответом, отказом или (каталог) выходом бюджета, для хода заставки это одно и то же.
export const STARTUP_STAGE = Object.freeze({ session: 0, installations: 1, profile: 2, catalog: 3 });

// Сообщить о закрытии этапа, не трогая сам запрос: обработчик висит сбоку и ничего не задерживает.
function reportStage(onStage, index, request) {
  if (!onStage) return;
  const tell = () => {
    try {
      onStage(index);
    } catch {
      // заставка не должна ронять запуск
    }
  };
  Promise.resolve(request).then(tell, tell);
}

export async function loadStartup({ catalog: source, installations, profile, session }, opts = {}) {
  const wait = opts.wait;
  const budget = opts.catalogBudgetMs === undefined ? CATALOG_BUDGET_MS : opts.catalogBudgetMs;
  // Каталог вызывается на следующем такте, уже после игры, профиля и сессии.
  const first = Promise.resolve().then(source),
    verdict = cutoff(first, budget, opts.catalogShown);
  // Профиль спрашивается один раз; его синхронный throw роняет весь старт (как в прежней версии,
  // чинится отдельно), а ещё идущий поиск игры тогда остаётся без обработчика.
  const games = withRetries(installations, STARTUP_RETRIES, wait);
  const local = profile();
  const account = withRetries(session, STARTUP_RETRIES, wait);
  reportStage(opts.onStage, STARTUP_STAGE.catalog, verdict);
  reportStage(opts.onStage, STARTUP_STAGE.installations, games);
  reportStage(opts.onStage, STARTUP_STAGE.profile, local);
  reportStage(opts.onStage, STARTUP_STAGE.session, account);
  const results = await Promise.all([verdict, ...[games, local, account].map(settle)]);
  const [cat, inst, prof, sess] = results;
  // Каталог не пришёл сразу: он догружается тем же запросом, а при отказе — с длинными повторами.
  const later = () =>
    first.catch(() => withRetries(source, CATALOG_RETRIES, wait)).catch(() => null);
  return {
    catalog: cat.v ?? emptyCatalog(),
    ...("v" in cat ? null : { catalogLater: later() }),
    found: inst.v ?? [],
    // Пустой found при foundKnown = false значит «неизвестно»: запомненную игру стирать нельзя.
    foundKnown: !inst.x,
    profile: prof.v ?? { installed: [] },
    session: sess.v ?? { user: null },
    failures: results.flatMap((o) => (o.x ? [o.e] : [])),
  };
}
