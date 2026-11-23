import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  isEmptyCatalog,
  mayShowCatalog,
  withFreshPackage,
} from "./catalog-freeze.js";

/*
 * Аккаунт окна и связь с облаком.
 *
 * Вход живёт в главном процессе, а окну нужен ответ на два вопроса: «кто
 * вошёл» и «всё ли из облака доехало». Раньше второго вопроса не было. Сессия
 * не ответила — окно показывало экран входа человеку, который уже вошёл;
 * сессия ответила, а избранное или сборки нет — `Promise.all` ронял
 * активацию, и человек опять оказывался на входе. Каталог, не пришедший за
 * полминуты повторов, оставался пустым до перезапуска, и никто не говорил
 * почему.
 *
 * Теперь недостача записывается («пробел» — `gap`): чего нет — сессии,
 * библиотеки или каталога. Пока пробел есть, окно работает с тем, что лежит
 * на компьютере, строка в заголовке говорит «нет связи», а хук сам
 * переподключается: по нарастающей паузе, сразу, когда система сообщает о
 * сети, и когда человек возвращается в окно.
 */

/* Паузы между попытками: сначала часто, потом не чаще двух минут. */
export const RECONNECT_DELAYS = Object.freeze([
  5_000, 15_000, 30_000, 60_000, 120_000,
]);

/* Возвращение в окно — повод попробовать, но не чаще этого. */
const FOCUS_RETRY_GAP = 5_000;

export function reconnectDelay(attempt) {
  return RECONNECT_DELAYS[
    Math.min(Math.max(0, attempt), RECONNECT_DELAYS.length - 1)
  ];
}

/*
 * Вход есть, профиля ещё нет: учётка из версии до запоминания профиля, а
 * облако не отвечает. Окну аккаунт нужен как пропуск — ни имя, ни почта в
 * нём не читаются, — поэтому пропуск выдаётся, а профиль приедет с первой
 * удачной попыткой.
 */
export const PENDING_PROFILE_ACCOUNT = Object.freeze({
  id: "",
  name: "",
  displayName: "",
  email: "",
  role: "user",
  pendingProfile: true,
});

/** Кого пускать в окно по ответу сессии главного процесса. */
export function sessionAccount(session) {
  if (session?.user) return session.user;
  if (session?.signedIn) return PENDING_PROFILE_ACCOUNT;
  return null;
}

const withGap = (gap, part) => ({ ...(gap || {}), [part]: true });
const withoutGap = (gap, part) => {
  if (!gap?.[part]) return gap;
  const { [part]: _dropped, ...rest } = gap;
  return Object.keys(rest).length ? rest : null;
};

/**
 * `localOnly` — песочница, демо, локальный разработчик: облака нет, и
 * аккаунт ставится как есть. `loadLibrary()` → `{ favorites, builds }` из
 * облака (любая часть может отказать), `loadCatalog()` — каталог,
 * `loadSession()` — сессия главного процесса. `onLibrary` раскладывает
 * пришедшее по состоянию оболочки, `onCatalog` — каталог.
 * `subscribeCatalog(listener)` — каталог, который главный процесс присылает
 * сам (Т-27): первые страницы, пока идут остальные (`partial`), и свежий
 * после запомненного; ответ — отписка.
 *
 * Каталог в окно кладёт только `acceptCatalog`: у каталога из главного
 * процесса есть номер (`revision`), и ответ на старый запрос, пришедший
 * после события, не ложится поверх свежего.
 *
 * Каталог сеанса не меняется на глазах (владелец, 16.11.2026): в показ ложится
 * первый каталог сеанса, а следующие, пришедшие пока окно открыто, ждут
 * перезапуска (`catalog-freeze.js`; свежий каталог на диске главный процесс
 * уже записал). Исключения — первые страницы и первый целый каталог, пустой
 * (закрытый) каталог, закрытый каталог взамен открытого и смена аккаунта.
 * Отложенный каталог не пропадает: установка берёт у него свежий пакет мода
 * (`freshMod`), не трогая видимый список.
 *
 * `ended` — облако отказало во входе (на старте или при переподключении):
 * экран входа говорит об этом сам, иначе человек, которого только что
 * выпустило из аккаунта, не понял бы, почему видит вход.
 */
export function useCloudSession({
  initialAccount = null,
  localOnly = false,
  loadSession,
  loadLibrary,
  loadCatalog,
  onLibrary,
  onCatalog,
  subscribeCatalog = null,
}) {
  const [account, setAccount] = useState(initialAccount);
  const [gap, setGap] = useState(null);
  const [ended, setEnded] = useState(false);
  /* В окне первые страницы каталога, остальные ещё идут. */
  const [catalogLoading, setCatalogLoading] = useState(false);
  const handlers = useRef(null);
  handlers.current = {
    loadSession,
    loadLibrary,
    loadCatalog,
    onLibrary,
    onCatalog,
  };

  const catalogRevision = useRef(0);
  /* В окне весь каталог — не первые страницы. */
  const catalogComplete = useRef(false);
  /* Показанный каталог пуст (закрытый, гостя): откладывать нечего, доступ мог открыться. */
  const catalogEmpty = useRef(false);
  /* Каталог, пришедший после показанного и ждущий перезапуска. */
  const deferred = useRef(null);
  /* Сменился аккаунт: следующий целый каталог — про другого человека и ложится в показ. */
  const catalogThawed = useRef(false);
  const acceptCatalog = useCallback((catalog) => {
    if (!catalog) return false;
    const revision = Number(catalog.revision);
    if (Number.isFinite(revision)) {
      if (revision < catalogRevision.current) return false;
      catalogRevision.current = revision;
    }
    if (
      !mayShowCatalog({
        catalog,
        shownComplete: catalogComplete.current,
        shownEmpty: catalogEmpty.current,
        thawed: catalogThawed.current,
      })
    ) {
      deferred.current = catalog;
      return true;
    }
    deferred.current = null;
    catalogEmpty.current = !catalog.partial && isEmptyCatalog(catalog);
    if (!catalog.partial) catalogThawed.current = false;
    /* Каталог в окно ложится переходом, а не срочным обновлением (30.10.2026, старт окна): главная, каталог и поиск перерисовываются на тысячи модов, и срочным
       это был один кадр в 500–800 мс при ×4. Переход React режет на куски по 5 мс, отдаёт кадры браузеру, а эффекты (мерки раскладки) гонит уже после отрисовки. */
    startTransition(() => handlers.current.onCatalog(catalog));
    catalogComplete.current = !catalog.partial;
    setCatalogLoading(Boolean(catalog.partial));
    if (!catalog.partial) setGap((current) => withoutGap(current, "catalog"));
    return true;
  }, []);

  useEffect(
    () => subscribeCatalog?.((catalog) => void acceptCatalog(catalog)),
    [acceptCatalog, subscribeCatalog],
  );

  /* Мод для установки: видимая запись, а пакет — из отложенного каталога, если там мод уже новее; видимый список остаётся прежним. */
  const freshMod = useCallback(
    (mod) =>
      withFreshPackage(
        mod,
        deferred.current?.mods?.find((one) => one.id === mod?.id),
      ),
    [],
  );

  /* Библиотека аккаунта: что пришло — раскладывается, что нет — пробел. */
  const syncLibrary = useCallback(async () => {
    const [favorites, builds] = await Promise.allSettled(
      handlers.current.loadLibrary(),
    );
    handlers.current.onLibrary({
      favorites: favorites.status === "fulfilled" ? favorites.value : null,
      builds: builds.status === "fulfilled" ? builds.value : null,
    });
    const complete =
      favorites.status === "fulfilled" && builds.status === "fulfilled";
    setGap((current) =>
      complete ? withoutGap(current, "library") : withGap(current, "library"),
    );
    return complete;
  }, []);

  /*
   * Пустить человека в окно. `connection: "offline"` — облако не ответило:
   * аккаунт ставится сразу, библиотека ждёт связи. `ended` — вместо
   * человека пришёл отказ во входе.
   */
  const accountId = useRef(null);
  const activateCloudAccount = useCallback(
    async (user, { connection = "online", ended: rejected = false } = {}) => {
      /* Первый ответ сеанса — не смена: каталог, что пришёл до него (запомненный), остаётся. Дальше другой человек, выход или вход — прежний каталог не про него. */
      const id = user?.id ?? "";
      if (accountId.current !== null && accountId.current !== id) {
        catalogThawed.current = true;
        deferred.current = null;
      }
      accountId.current = id;
      setEnded(!user && rejected);
      if (!user) {
        setAccount(null);
        setGap(null);
        return;
      }
      if (localOnly) {
        setAccount(user);
        return;
      }
      if (connection === "offline") {
        setGap((current) => withGap(current, "session"));
        setAccount(user);
        return;
      }
      setGap((current) => withoutGap(current, "session"));
      await syncLibrary();
      setAccount(user);
    },
    [localOnly, syncLibrary],
  );

  /*
   * Каталог не доехал на старте — тоже пробел, и строка связи говорит об этом
   * сразу, пока старт ещё повторяет свой запрос (`catalogLater`), а не через
   * полминуты тишины на пустой главной. Во всех режимах: каталог грузится и
   * у локальной сборки, и в песочнице, а «перезапуск API» (co-founder, 25.09)
   * — как раз про локальную сборку. Пока повторы старта идут, цикл
   * переподключения каталог не спрашивает — второй поток тех же запросов.
   */
  const catalogWait = useRef(null);
  const awaitCatalog = useCallback(
    (later) => {
      /* Весь каталог уже пришёл событием — ждать нечего, ответ старта
         (старее) ляжет или не ляжет по номеру. */
      if (!catalogComplete.current)
        setGap((current) => withGap(current, "catalog"));
      const wait = Promise.resolve(later)
        .catch(() => null)
        .then((catalog) => {
          if (catalogWait.current !== wait) return;
          catalogWait.current = null;
          /* Повторы кончились: первые страницы — всё, что есть. */
          if (!catalog) setCatalogLoading(false);
          else acceptCatalog(catalog);
        });
      catalogWait.current = wait;
    },
    [acceptCatalog],
  );

  const gapRef = useRef(gap);
  gapRef.current = gap;

  /* Одна попытка закрыть всё, чего не хватает. `force` — «Повторить» руками:
     каталог спрашивается сейчас, даже если повторы старта ещё идут. */
  const recover = useCallback(
    async ({ force = false } = {}) => {
      const missing = gapRef.current;
      if (!missing) return "online";
      if (missing.session) {
        const session = await handlers.current.loadSession();
        if (session?.ended) {
          setGap(null);
          setAccount(null);
          setEnded(true);
          return "ended";
        }
        if (session?.connection === "offline" || !session?.user)
          return "offline";
        setAccount(session.user);
        setGap((current) => withGap(withoutGap(current, "session"), "library"));
        if (!(await syncLibrary())) return "offline";
      } else if (missing.library && !(await syncLibrary())) {
        return "offline";
      }
      if (missing.catalog) {
        if (catalogWait.current && !force) return "offline";
        const catalog = await handlers.current.loadCatalog().catch(() => null);
        if (!catalog) {
          setCatalogLoading(false);
          return "offline";
        }
        catalogWait.current = null;
        acceptCatalog(catalog);
      }
      return "online";
    },
    [acceptCatalog, syncLibrary],
  );

  const reconnect = useReconnect({ active: Boolean(gap), recover });
  return {
    account,
    ended,
    activateCloudAccount,
    acceptCatalog,
    awaitCatalog,
    freshMod,
    /* Пока остальные страницы идут, каталог не «не загрузился»: строка
       связи молчит о нём, а каталог говорит, что догружается. */
    connection: {
      gap: catalogLoading ? withoutGap(gap, "catalog") : gap,
      catalogLoading,
      ...reconnect,
    },
  };
}

/*
 * Переподключение по нарастающей паузе, пока `active`. Попытка одна за раз;
 * `retry()` — «Повторить» из заголовка — не ждёт паузы.
 */
function useReconnect({ active, recover }) {
  const [state, setState] = useState({ trying: false, nextAt: 0 });
  const attempt = useRef(0);
  const running = useRef(false);
  const lastTry = useRef(0);
  const timer = useRef(0);
  const recoverRef = useRef(recover);
  recoverRef.current = recover;

  const tryNow = useCallback(async (options) => {
    if (running.current) return;
    running.current = true;
    window.clearTimeout(timer.current);
    lastTry.current = Date.now();
    setState({ trying: true, nextAt: 0 });
    let result = "offline";
    try {
      result = await recoverRef.current(options);
    } catch {
      result = "offline";
    }
    running.current = false;
    if (result !== "offline") {
      attempt.current = 0;
      setState({ trying: false, nextAt: 0 });
      return;
    }
    const delay = reconnectDelay(attempt.current);
    attempt.current += 1;
    setState({ trying: false, nextAt: Date.now() + delay });
    timer.current = window.setTimeout(tryNow, delay);
  }, []);

  useEffect(() => {
    if (!active) {
      window.clearTimeout(timer.current);
      attempt.current = 0;
      setState({ trying: false, nextAt: 0 });
      return undefined;
    }
    /* Первая попытка — после первой паузы: старт только что спрашивал сам. */
    const delay = reconnectDelay(attempt.current);
    attempt.current += 1;
    setState({ trying: false, nextAt: Date.now() + delay });
    timer.current = window.setTimeout(tryNow, delay);
    const onOnline = () => void tryNow();
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastTry.current > FOCUS_RETRY_GAP
      )
        void tryNow();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, tryNow]);

  /* «Повторить» — руками: не ждёт ни паузы, ни повторов старта. */
  const retry = useCallback(() => tryNow({ force: true }), [tryNow]);
  return { ...state, retry };
}
