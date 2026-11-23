/*
 * Готовые кадры обложек — между запусками окна.
 *
 * Обложку таймциклов рисует шейдер неба: город, тени, отражения. Снять её —
 * значит поднять контекст WebGL2, собрать программу в семьдесят килобайт и
 * отрисовать кадр, и всё это в главном потоке окна. Прежде кадр помнился до
 * перезагрузки окна, то есть снимался заново при каждом запуске приложения —
 * ровно в тот момент, когда человек впервые открывал мастерскую и полка
 * въезжала на экран (замер 25.09.2026: два блока по 60–75 мс подряд).
 *
 * Кадр зависит только от того, что на нём нарисовано, поэтому его можно
 * хранить: ключ называет и содержимое (погода, отпечаток правки), и версию
 * рисовальщика — поменялся шейдер, и старый кадр просто не найдётся. Хранилище
 * — IndexedDB: запись и чтение идут мимо главного потока, а не синхронно, как
 * у `localStorage`. Кадров немного и они маленькие (WebP в десятки килобайт);
 * старые вытесняются, чтобы правки человека не копились годами.
 *
 * Хранилище — удобство, а не память: нет IndexedDB, приватное окно, битая
 * база — обложка просто снимается заново, как раньше.
 */

const DB_NAME = "astral-cover-frames";
const STORE = "frames";
/* Версия 2 (оптимизация ночи 12.10.2026): указатель `at` — вытеснение идёт
   по нему, не читая сами картинки. */
const DB_VERSION = 2;
const BY_AGE = "at";
/*
 * Сколько кадров держать. Кроме обложек полки и библиотеки здесь же лежат
 * снимки плиток «Готовых видов» во всех 3D-редакторах (`scene-snapshot.js`,
 * 06.10.2026): кадр — WebP в десятки килобайт. Было четыреста, и вытеснялись
 * самые давно ЗАПИСАННЫЕ — то есть обложки полки, снятые первыми и
 * открываемые каждый день: плиток шаблонов у тридцати шести редакторов
 * больше четырёхсот, и после пары редакторов полка снималась заново
 * («картинки прогружаются очень долго», 12.10.2026). Теперь кадр, который
 * читают, освежается (`touch`), а предел — полторы тысячи (~60 МБ).
 */
export const COVER_FRAME_LIMIT = 1500;
/* Сколько кадров сверх предела терпеть до вытеснения. */
const PRUNE_SLACK = 60;
/* Прочитанный кадр освежается не чаще раза в час — и пачкой, одной записью. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;
const TOUCH_DELAY_MS = 3000;

let opening = null;

function openStore() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains(STORE)
        ? request.transaction.objectStore(STORE)
        : request.result.createObjectStore(STORE);
      if (!store.indexNames.contains(BY_AGE)) store.createIndex(BY_AGE, BY_AGE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

/* Одна операция над хранилищем; любой отказ — `fallback`, а не исключение. */
async function withStore(mode, work, fallback = null) {
  const db = await openStore();
  if (!db) return fallback;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE, mode);
      const store = transaction.objectStore(STORE);
      let result = fallback;
      work(store, (value) => {
        result = value;
      });
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => resolve(fallback);
      transaction.onabort = () => resolve(fallback);
    } catch {
      resolve(fallback);
    }
  });
}

/*
 * Освежить прочитанные кадры: одна запись на пачку чтений (полка — десятки
 * обложек разом), не раньше, чем окно затихнет, и только у давних кадров.
 */
const touched = new Set();
let touchTimer = 0;
function scheduleTouch(key) {
  touched.add(key);
  if (touchTimer) return;
  touchTimer = setTimeout(() => {
    touchTimer = 0;
    const keys = [...touched];
    touched.clear();
    const at = Date.now();
    void withStore(
      "readwrite",
      (store) => {
        for (const item of keys) {
          const request = store.get(item);
          request.onsuccess = () => {
            const value = request.result;
            if (value && typeof value === "object") store.put({ ...value, at }, item);
          };
        }
      },
      false,
    );
  }, TOUCH_DELAY_MS);
}

/**
 * Кадр под ключом с временем съёмки: `{ url, made }` или `null`. `made` —
 * когда кадр сняли (у записей до 13.10.2026 его нет — тогда время последнего
 * чтения), чтобы печь обложек могла переснять давний кадр.
 */
export function readCoverFrameEntry(key) {
  return withStore("readonly", (store, done) => {
    const request = store.get(String(key));
    request.onsuccess = () => {
      const url = request.result?.url;
      const ok = typeof url === "string" && url.startsWith("data:image/");
      if (ok && Date.now() - (Number(request.result?.at) || 0) > TOUCH_AFTER_MS) scheduleTouch(String(key));
      const title = typeof request.result?.title === "string" ? request.result.title : "";
      done(ok ? { url, made: Number(request.result?.made ?? request.result?.at) || 0, title } : null);
    };
  });
}

/** Кадр под ключом (`data:`-адрес) или `null`. */
export function readCoverFrame(key) {
  return readCoverFrameEntry(key).then((entry) => entry?.url || null);
}

/**
 * Запомнить кадр; самые давние сверх предела уходят. `title` — подсказка
 * обложки («постановочный кадр, не снимок из игры»): готовая картинка полки
 * говорит то же, что живая обложка.
 */
export function writeCoverFrame(key, url, { title = "" } = {}) {
  if (typeof url !== "string" || !url.startsWith("data:image/"))
    return Promise.resolve(false);
  return withStore(
    "readwrite",
    (store, done) => {
      const now = Date.now();
      store.put({ url, at: now, made: now, ...(title ? { title } : {}) }, String(key));
      /* Вытеснение читает все кадры (сотни картинок) — только когда их
         заметно больше предела, а не на каждой записи: запись держит
         хранилище, и чтения плиток ждали её (ТЗ 12.10.2026, задача 1). */
      const counted = store.count();
      counted.onsuccess = () => {
        let extra = counted.result - COVER_FRAME_LIMIT;
        if (counted.result <= COVER_FRAME_LIMIT + PRUNE_SLACK) {
          done(true);
          return;
        }
        /* Самые давние по указателю `at` — ключи без самих картинок. */
        const cursor = store.index(BY_AGE).openKeyCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (entry && extra > 0) {
            store.delete(entry.primaryKey);
            extra -= 1;
            entry.continue();
            return;
          }
          done(true);
        };
      };
    },
    false,
  );
}

/** Для тестов: следующее обращение открывает базу заново. */
export function forgetCoverFrameStore() {
  opening = null;
  touched.clear();
  if (touchTimer) clearTimeout(touchTimer);
  touchTimer = 0;
}
